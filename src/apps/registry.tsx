// @ts-nocheck
import type { AppDefinition, AppId } from "@/types";
import { getSSHMetadata } from "@/types";
import { ClipboardAddon } from "@xterm/addon-clipboard";
import { FitAddon } from "@xterm/addon-fit";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { Terminal as XTerminal } from "@xterm/xterm";
import {
  Copy,
  Download,
  FileTerminal,
  Globe,
  Loader2,
  Mic,
  NotepadText,
  RefreshCw,
  Upload,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { QuickBar } from "@/components/QuickBar";
import { ShortcutDrawer } from "@/components/ShortcutDrawer";
import VoiceInputOverlay from "@/components/VoiceInputOverlay";
import TerminalNextButton from "@/components/TerminalNextButton";
import FileTransferWindow from "@/components/FileTransferModal";
import DevBrowser from "./DevBrowser";
import Notes from "./Notes";
import { useFileTransferStore } from "@/stores/useFileTransferStore";
import { useSettingsStore } from "@/stores/useSettingsStore";
import { useTerminalSessionStore } from "@/stores/useTerminalSessionStore";
import { useWindowStore } from "@/stores/useWindowStore";
import { useSSHStore } from "@/stores/useSSHStore";
import { useProjectStore } from "@/stores/useProjectStore";
import { buildWsUrl } from "@/lib/ws";
import { getNextSSHTerminalTarget } from "@/lib/sshWindowNavigation";
import { saveBuffer, getBuffer, deleteBuffer } from "@/lib/terminalBufferCache";
import { resolveTerminalLinkTarget } from "@/lib/terminalLinks";
import { registerTerminalCleanup, unregisterTerminalCleanup } from "@/lib/terminalCleanup";

export const SSHPane = ({
  connectionId,
  windowId,
  tabId,
  isActive,
  hasNavigated,
  keyboardHeight,
  refreshNonce,
  enableTouchScroll = false,
  isModalOpen = false,
}: {
  connectionId?: number;
  windowId?: string;
  tabId: string;
  isActive: boolean;
  hasNavigated?: boolean;
  keyboardHeight?: number;
  refreshNonce?: number;
  enableTouchScroll?: boolean;
  isModalOpen?: boolean;
}) => {
  const terminalRef = useRef<HTMLDivElement>(null);
  const termInstanceRef = useRef<XTerminal | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const isModalOpenRef = useRef(isModalOpen);
  isModalOpenRef.current = isModalOpen;
  const [status, setStatus] = useState<string>("connecting");
  const [retryKey, setRetryKey] = useState(0);
  const [copyFeedback, setCopyFeedback] = useState(false);
  const [pasteFeedback, setPasteFeedback] = useState(false);
  const [isMobile, setIsMobile] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.matchMedia("(max-width: 767px)").matches;
  });
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [voiceOverlayOpen, setVoiceOverlayOpen] = useState(false);
  const [micPos, setMicPos] = useState<{ x: number; y: number } | null>(null);
  const micDragStartRef = useRef({ x: 0, y: 0 });
  const micDragOriginRef = useRef({ x: 0, y: 0 });
  const micDragMovedRef = useRef(false);
  const showTerminalShortcuts = useSettingsStore(
    (s) => s.showTerminalShortcuts,
  );
  const showTmuxShortcuts = useSettingsStore((s) => s.showTmuxShortcuts);
  const quickBarSlots = useSettingsStore((s) => s.quickBarSlots);
  const autoTmux = useSettingsStore((s) => s.autoTmux);
  const terminalFontSize = useSettingsStore((s) => s.terminalFontSize);
  const setTerminalCwd = useTerminalSessionStore((s) => s.setTerminalCwd);
  const activeProjectId = useProjectStore((s) => s.activeProjectId);
  const projectDirectory = useProjectStore((s) => {
    const project = s.projects.find((p) => p.id === s.activeProjectId);
    return project?.directory;
  });
  const sessionId = [windowId || "", tabId, activeProjectId].filter(Boolean).join("-");
  const bufferKeyRef = useRef(sessionId);
  const ctrlWBlockedRef = useRef(false);
  const keyboardLockedRef = useRef(false);
  const statusRef = useRef(status);
  const isActiveRef = useRef(isActive);
  const hasAutoNavigatedRef = useRef(hasNavigated ?? false);

  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  useEffect(() => {
    isActiveRef.current = isActive;
  }, [isActive]);

  const viewportOffsetRef = useRef(0);
  const pendingViewportRestoreRef = useRef<number | null>(null);
  const restoreViewportRafRef = useRef<number | null>(null);
  const resizeSyncRafRef = useRef<number | null>(null);
  const lastKnownViewportYRef = useRef(0);
  const suppressViewportTrackingUntilRef = useRef(0);
  const lastKeyboardHeightRef = useRef(keyboardHeight ?? 0);
  const pendingOsc52Ref = useRef("");
  const osc52CarryRef = useRef("");
  const osc7CarryRef = useRef("");
  const isScrolledUpRef = useRef(false);
  const suppressTouchFocusRef = useRef(false);
  // When we drive tmux copy-mode scrolling (autoTmux on), xterm's local
  // viewport stays pinned to the live tail, so isScrolledUpRef can't tell us
  // we're in the history. This flag tracks that we entered copy-mode via a
  // swipe; it gates the keyboard and is cleared on the tap that exits it.
  const tmuxCopyActiveRef = useRef(false);

  const showCopyFeedback = useCallback(() => {
    setCopyFeedback(true);
    setTimeout(() => setCopyFeedback(false), 1200);
  }, []);

  const showPasteFeedback = useCallback(() => {
    setPasteFeedback(true);
    setTimeout(() => setPasteFeedback(false), 1200);
  }, []);

  useEffect(() => {
    bufferKeyRef.current = sessionId;
  }, [sessionId]);

  const getViewportOffsetFromBottom = useCallback(() => {
    const term = termInstanceRef.current;
    if (!term) return 0;
    const buffer = term.buffer.active;
    const viewportY =
      buffer === term.buffer.normal
        ? buffer.viewportY
        : Math.max(0, lastKnownViewportYRef.current);
    const offset = Math.max(0, buffer.baseY - viewportY);
    isScrolledUpRef.current = offset > 0;
    return offset;
  }, []);

  const clampViewportOffset = useCallback((offset: number) => {
    const term = termInstanceRef.current;
    if (!term) return 0;
    return Math.min(Math.max(0, offset), term.buffer.active.baseY);
  }, []);

  const restoreViewportOffset = useCallback(
    (offsetFromBottom?: number) => {
      const term = termInstanceRef.current;
      if (!term) return;
      const buffer = term.buffer.active;
      const offset = clampViewportOffset(
        typeof offsetFromBottom === "number"
          ? offsetFromBottom
          : viewportOffsetRef.current,
      );
      const targetLine = offset <= 1 ? buffer.baseY : buffer.baseY - offset;
      suppressViewportTrackingUntilRef.current = performance.now() + 260;
      (
        term as XTerminal & {
          scrollToLine: (line: number, disableSmoothScroll?: boolean) => void;
        }
      ).scrollToLine(targetLine, true);
      lastKnownViewportYRef.current = targetLine;
      viewportOffsetRef.current = offset <= 1 ? 0 : offset;
    },
    [clampViewportOffset],
  );

  const scheduleViewportRestore = useCallback(
    (offsetFromBottom?: number) => {
      const offset = clampViewportOffset(
        typeof offsetFromBottom === "number"
          ? offsetFromBottom
          : (pendingViewportRestoreRef.current ?? viewportOffsetRef.current),
      );

      pendingViewportRestoreRef.current = offset;

      if (restoreViewportRafRef.current !== null) {
        cancelAnimationFrame(restoreViewportRafRef.current);
      }

      restoreViewportRafRef.current = requestAnimationFrame(() => {
        restoreViewportRafRef.current = requestAnimationFrame(() => {
          const pendingOffset =
            pendingViewportRestoreRef.current ?? viewportOffsetRef.current;
          restoreViewportOffset(pendingOffset);
          pendingViewportRestoreRef.current = null;
          restoreViewportRafRef.current = null;
        });
      });
    },
    [clampViewportOffset, restoreViewportOffset],
  );

  const snapshotTerminalBuffer = useCallback(() => {
    const term = termInstanceRef.current;
    if (!term) return;

    const lines: string[] = [];
    const buffer = term.buffer.active;
    for (let y = 0; y < buffer.length; y++) {
      lines.push(buffer.getLine(y)?.translateToString() ?? "");
    }

    while (lines.length > 0 && lines[lines.length - 1].trim() === "") {
      lines.pop();
    }

    const viewportOffset = isActiveRef.current
      ? clampViewportOffset(getViewportOffsetFromBottom())
      : clampViewportOffset(viewportOffsetRef.current);
    viewportOffsetRef.current = viewportOffset;
    saveBuffer(bufferKeyRef.current, lines, viewportOffset);
  }, [clampViewportOffset, getViewportOffsetFromBottom]);

  const syncTerminalLayout = useCallback(
    (recreateCanvas = false) => {
      const term = termInstanceRef.current;
      const fit = fitRef.current;
      if (!term || !fit || !isActiveRef.current) return;
      const fitWithPropose = fit as FitAddon & {
        proposeDimensions?: () => { cols: number; rows: number } | undefined;
      };
      const proposed = fitWithPropose.proposeDimensions?.();
      if (
        !recreateCanvas &&
        proposed &&
        proposed.cols === term.cols &&
        proposed.rows === term.rows
      ) {
        return;
      }
      const viewportOffset = clampViewportOffset(getViewportOffsetFromBottom());
      viewportOffsetRef.current = viewportOffset;
      pendingViewportRestoreRef.current = viewportOffset;
      suppressViewportTrackingUntilRef.current = performance.now() + 320;

      fit.fit();
      if (term.rows > 0) {
        term.refresh(0, term.rows - 1);
      }
      if (recreateCanvas && term.cols > 0 && term.rows > 0) {
        term.resize(term.cols + 1, term.rows);
        term.resize(term.cols - 1, term.rows);
        term.refresh(0, term.rows - 1);
      }
      scheduleViewportRestore(viewportOffset);
    },
    [clampViewportOffset, getViewportOffsetFromBottom, scheduleViewportRestore],
  );

  const forceTerminalRepaint = useCallback(() => {
    syncTerminalLayout(true);
  }, [syncTerminalLayout]);

  const handleTerminalResize = useCallback(() => {
    syncTerminalLayout(false);
  }, [syncTerminalLayout]);

  const focusTerminal = useCallback(() => {
    if (!isActiveRef.current) return;
    // Mobile: only focus when at the live tail — scrolling up (xterm buffer
    // or tmux copy-mode) suppresses the virtual keyboard so the user can
    // scroll freely first.
    if (isMobile) {
      if (isScrolledUpRef.current) return;
      if (autoTmux && tmuxCopyActiveRef.current) return;
    } else {
      // Desktop: don't steal focus from external inputs
      const active = document.activeElement;
      if (
        active &&
        active !== document.body &&
        !terminalRef.current?.contains(active) &&
        (active.tagName === "INPUT" ||
          active.tagName === "TEXTAREA" ||
          (active as HTMLElement).contentEditable === "true")
      ) {
        return;
      }
    }
    termInstanceRef.current?.focus();
  }, [isMobile, autoTmux]);

  // Ctrl+W is a browser-reserved shortcut; the only way to intercept it is
  // the Keyboard Lock API, which only captures reserved keys in fullscreen.
  // Chromium-only + needs a user gesture, so we trigger from a terminal click.
  const lockKeyboard = useCallback(async () => {
    if (keyboardLockedRef.current) return;
    if (isMobile) return;
    const kb = (navigator as any).keyboard;
    if (!kb?.lock) return; // ponytail: Chromium-only; other browsers keep native Ctrl+W
    try {
      if (!document.fullscreenElement) {
        await document.documentElement.requestFullscreen();
      }
      await kb.lock(["KeyW"]);
      keyboardLockedRef.current = true;
    } catch {
      /* denied or unsupported — fall back to native behavior */
    }
  }, [isMobile]);

  const forwardReservedTerminalShortcut = useCallback(
    (event: KeyboardEvent) => {
      if (
        event.type !== "keydown" ||
        !isActiveRef.current ||
        !terminalRef.current
      ) {
        return false;
      }

      if (event.defaultPrevented) return true;

      const active = document.activeElement;
      if (!active || !terminalRef.current.contains(active)) {
        return false;
      }

      const isCloseShortcut =
        (event.metaKey || event.ctrlKey) &&
        !event.altKey &&
        event.key.toLowerCase() === "w";
      const isEscape = event.key === "Escape";

      if (!isCloseShortcut && !isEscape) {
        return false;
      }

      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();

      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(
          JSON.stringify({
            type: "data",
            data: isCloseShortcut ? "\x17" : "\x1b",
          }),
        );
      }

      return true;
    },
    [],
  );

  // Ctrl+W — handled at window capture level to block browser close-tab.
  // Runs before xterm's textarea handler (which also calls forwardReservedTerminalShortcut).
  const handleWindowCtrlW = useCallback((event: KeyboardEvent) => {
    if (!isActiveRef.current) return;
    const mod = event.metaKey || event.ctrlKey;
    if (!mod || event.altKey || event.key.toLowerCase() !== "w") return;

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();

    // Set flag so beforeunload can also block the close (safety net)
    ctrlWBlockedRef.current = true;
    setTimeout(() => {
      ctrlWBlockedRef.current = false;
    }, 500);

    if (wsRef.current?.readyState === WebSocket.OPEN) {
      // Forward \x17 (Ctrl+W = delete word) to shell
      wsRef.current.send(JSON.stringify({ type: "data", data: "\x17" }));
    } else {
      // Focus terminal; next Ctrl+W will be forwarded
      termInstanceRef.current?.focus();
    }
  }, []);

  const refreshTerminal = useCallback(() => {
    snapshotTerminalBuffer();
    const ws = wsRef.current;
    if (
      ws &&
      (ws.readyState === WebSocket.OPEN ||
        ws.readyState === WebSocket.CONNECTING)
    ) {
      ws.close();
    }
    setRetryKey((k) => k + 1);
  }, [snapshotTerminalBuffer]);

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 767px)");
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  const wsUrl = useMemo(() => {
    if (!connectionId) return null;
    return buildWsUrl("/ws/ssh", {
      connectionId,
      directory: projectDirectory || "",
      windowId: sessionId,
      projectId: activeProjectId || "",
      tabId,
      replay: "1",
      useTmux: autoTmux ? "1" : "0",
      r: retryKey,
    });
  }, [autoTmux, connectionId, projectDirectory, sessionId, activeProjectId, tabId, retryKey]);

  useEffect(() => {
    const handleScrollEvent = (e: Event) => {
      if (!isActiveRef.current) return;
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        const { action } = (e as CustomEvent).detail as { action: string };
        const key = action === "pageup" ? "\x1b[5~" : "\x1b[6~";
        wsRef.current.send(JSON.stringify({ type: "data", data: key }));
      }
    };

    window.addEventListener(`app-page-${windowId}`, handleScrollEvent);
    return () =>
      window.removeEventListener(`app-page-${windowId}`, handleScrollEvent);
  }, [windowId]);

  useEffect(() => {
    const handleVisibility = () => {
      if (document.hidden) {
        snapshotTerminalBuffer();
        return;
      }
      if (!document.hidden) {
        const ws = wsRef.current;
        const isStale =
          !ws ||
          ws.readyState === WebSocket.CLOSED ||
          ws.readyState === WebSocket.CLOSING;
        if (
          isStale ||
          statusRef.current === "disconnected" ||
          statusRef.current === "error"
        ) {
          setRetryKey((k) => k + 1);
        }
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () =>
      document.removeEventListener("visibilitychange", handleVisibility);
  }, [snapshotTerminalBuffer]);

  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      snapshotTerminalBuffer();
      // Block close if triggered by Ctrl+W (browser may bypass keydown preventDefault)
      if (ctrlWBlockedRef.current) {
        ctrlWBlockedRef.current = false;
        e.preventDefault();
        e.returnValue = "";
      }
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [snapshotTerminalBuffer]);

  // Prevent browser from intercepting Ctrl+W (close tab) and Escape
  // when terminal is focused — forward them to the terminal instead
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      handleWindowCtrlW(e);
      forwardReservedTerminalShortcut(e);
    };
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [handleWindowCtrlW, forwardReservedTerminalShortcut]);

  useEffect(() => {
    if (!terminalRef.current) return;

    const term = new XTerminal({
      theme: {
        foreground: "#e0e0e0",
        background: "#0a0a0a",
        cursor: "#e0e0e0",
      },
      fontSize: terminalFontSize,
      fontFamily: '"JetBrains Mono", monospace',
      allowProposedApi: true,
      cursorBlink: true,
      scrollback: 3000,
    });
    termInstanceRef.current = term;

    const fit = new FitAddon();
    fitRef.current = fit;
    term.loadAddon(fit);
    const links = new WebLinksAddon((_event, uri) => {
      const popup = window.open("", "_blank");

      void resolveTerminalLinkTarget(uri)
        .then((targetUrl) => {
          if (!targetUrl) {
            popup?.close();
            return;
          }

          if (popup) {
            try {
              popup.opener = null;
            } catch {}
            popup.location.replace(targetUrl);
            return;
          }

          window.open(targetUrl, "_blank", "noopener,noreferrer");
        })
        .catch((error) => {
          popup?.close();
          console.error("Failed to open terminal link", error);
        });
    });
    term.loadAddon(links);
    const unicode11Addon = new Unicode11Addon();
    term.loadAddon(unicode11Addon);
    term.unicode.activeVersion = "11";
    const clipboardAddon = new ClipboardAddon();
    term.loadAddon(clipboardAddon);
    term.open(terminalRef.current);
    term.attachCustomKeyEventHandler((event) => {
      if (!(event instanceof KeyboardEvent)) return true;
      return !forwardReservedTerminalShortcut(event);
    });

    requestAnimationFrame(focusTerminal);

    const cached = getBuffer(bufferKeyRef.current);
    if (cached && cached.lines.length > 0) {
      viewportOffsetRef.current = clampViewportOffset(
        cached.scrollOffsetFromBottom,
      );
      term.write(cached.lines.join("\r\n"), () => {
        scheduleViewportRestore(cached.scrollOffsetFromBottom);
      });
    }
    deleteBuffer(bufferKeyRef.current);

    let bellTitle = "Terminal";
    let askedNotify = false;

    term.onData((data) => {
      // Asking here keeps the prompt inside a real keydown gesture (Safari requires it).
      // Once per session: onData fires per keystroke, and a dismissed prompt leaves
      // permission at "default" forever, so an unguarded call would re-ask on every key.
      if (!askedNotify && "Notification" in window && Notification.permission === "default") {
        askedNotify = true;
        void Notification.requestPermission();
      }
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: "data", data }));
      }
    });

    // Claude Code (and any CLI) rings the bell when it finishes; forward it to the OS
    // only while the tab is in the background, otherwise it's just noise.
    term.onBell(() => {
      if (!("Notification" in window) || Notification.permission !== "granted") return;
      if (!document.hidden && document.hasFocus()) return;
      // Read stores at fire time, not capture time: this closure outlives project
      // switches and cwd changes, so a captured value would go stale.
      const { projects, activeProjectId: pid } = useProjectStore.getState();
      const projectName = projects.find((p) => p.id === pid)?.name;
      const cwd = useTerminalSessionStore.getState().terminalCwds[sessionId];
      const n = new Notification(
        projectName ? `${projectName} — ${bellTitle}` : bellTitle,
        {
          // bellTitle is the terminal title, which Claude Code sets to what it is
          // working on; cwd answers "where", so together they identify the turn.
          body: cwd ? `Selesai di ${cwd}` : "Proses selesai",
          icon: "/icon-192.png",
          // Same tag as the service worker's push notification so the two paths
          // collapse into one entry instead of double-notifying.
          tag: "claude-code",
        },
      );
      n.onclick = () => {
        window.focus();
        n.close();
      };
    });

    term.onResize(({ cols, rows }) => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: "resize", cols, rows }));
      }
      if (pendingViewportRestoreRef.current !== null) {
        scheduleViewportRestore(pendingViewportRestoreRef.current);
      }
    });

    term.onTitleChange((newTitle) => {
      if (newTitle) bellTitle = newTitle;
      if (!windowId || !newTitle || !tabId) return;
      useWindowStore.getState().setActiveTabTitle(windowId, tabId, newTitle);
    });

    term.onScroll(() => {
      const term = termInstanceRef.current;
      if (!term) return;
      if (!isActiveRef.current) return;
      if (performance.now() < suppressViewportTrackingUntilRef.current) return;

      lastKnownViewportYRef.current = term.buffer.active.viewportY;
      viewportOffsetRef.current = getViewportOffsetFromBottom();
      if (!isScrolledUpRef.current) {
        suppressTouchFocusRef.current = false;
      }
    });

    const observer = new ResizeObserver(() => {
      if (resizeSyncRafRef.current !== null) {
        cancelAnimationFrame(resizeSyncRafRef.current);
      }
      resizeSyncRafRef.current = requestAnimationFrame(() => {
        resizeSyncRafRef.current = null;
        handleTerminalResize();
      });
    });
    observer.observe(terminalRef.current);

    // Periodically save terminal buffer to cache (for project switch persistence)
    const saveTimer = setInterval(() => {
      snapshotTerminalBuffer();
    }, 3000);

    // Force a canvas re-creation after the initial layout completes.
    // This works around a GPU compositing issue where the canvas
    // renderer doesn't paint under CSS transforms until the canvas
    // is recreated (e.g. on manual resize).
    let kickRaf = 0;
    const kickCanvas = () => forceTerminalRepaint();
    kickRaf = requestAnimationFrame(kickCanvas);

    return () => {
      cancelAnimationFrame(kickRaf);
      clearInterval(saveTimer);
      // Save buffer before unmount so content persists across project switches
      snapshotTerminalBuffer();
      observer.disconnect();
      if (restoreViewportRafRef.current !== null) {
        cancelAnimationFrame(restoreViewportRafRef.current);
      }
      if (resizeSyncRafRef.current !== null) {
        cancelAnimationFrame(resizeSyncRafRef.current);
      }
      pendingViewportRestoreRef.current = null;
      term.dispose();
      termInstanceRef.current = null;
      fitRef.current = null;
    };
  }, [
    clampViewportOffset,
    connectionId,
    focusTerminal,
    forceTerminalRepaint,
    forwardReservedTerminalShortcut,
    getViewportOffsetFromBottom,
    handleTerminalResize,
    scheduleViewportRestore,
    snapshotTerminalBuffer,
    tabId,
    terminalFontSize,
    windowId,
  ]);

  useEffect(() => {
    if (isActive) {
      requestAnimationFrame(() => {
        // Sync viewport tracking refs from actual terminal state before repainting.
        // onScroll tracking is paused while inactive, so these can go stale
        // when the agent writes output to a hidden tab.
        const term = termInstanceRef.current;
        if (term) {
          lastKnownViewportYRef.current = term.buffer.active.viewportY;
          viewportOffsetRef.current = getViewportOffsetFromBottom();
        }
        forceTerminalRepaint();
        // On mobile, don't steal focus when a tab becomes active (e.g. next/prev
        // navigation) — that pops the on-screen keyboard. Let the user tap the
        // terminal to focus. Desktop keeps auto-focus.
        if (!isModalOpenRef.current && !isMobile) focusTerminal();
      });
    }
  }, [
    focusTerminal,
    forceTerminalRepaint,
    getViewportOffsetFromBottom,
    isActive,
    isMobile,
  ]);

  useEffect(() => {
    if (termInstanceRef.current) {
      termInstanceRef.current.options.fontSize = terminalFontSize;
      forceTerminalRepaint();
    }
  }, [forceTerminalRepaint, terminalFontSize]);

  useEffect(() => {
    if (!isMobile || !isActiveRef.current || !termInstanceRef.current) return;

    const previousHeight = lastKeyboardHeightRef.current;
    const nextHeight = keyboardHeight ?? 0;
    if (Math.abs(nextHeight - previousHeight) < 24) return;
    lastKeyboardHeightRef.current = nextHeight;

    const term = termInstanceRef.current;
    const viewportOffset = getViewportOffsetFromBottom();
    viewportOffsetRef.current = viewportOffset;
    pendingViewportRestoreRef.current = viewportOffset;
    lastKnownViewportYRef.current = term.buffer.active.viewportY;
    suppressViewportTrackingUntilRef.current = performance.now() + 400;

    requestAnimationFrame(() => {
      handleTerminalResize();
      if (pendingViewportRestoreRef.current !== null) {
        scheduleViewportRestore(pendingViewportRestoreRef.current);
      }
      requestAnimationFrame(() => {
        if (!isModalOpenRef.current) focusTerminal();
      });
    });
  }, [
    focusTerminal,
    getViewportOffsetFromBottom,
    handleTerminalResize,
    isMobile,
    keyboardHeight,
    scheduleViewportRestore,
  ]);

  useEffect(() => {
    if (!refreshNonce) return;
    snapshotTerminalBuffer();
    const ws = wsRef.current;
    if (
      ws &&
      (ws.readyState === WebSocket.OPEN ||
        ws.readyState === WebSocket.CONNECTING)
    ) {
      ws.close();
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setRetryKey((k) => k + 1);
  }, [refreshNonce, snapshotTerminalBuffer]);

  useEffect(() => {
    const container = terminalRef.current;
    if (!container) return;

    let startPos = { x: 0, y: 0 };
    let lastPos = { x: 0, y: 0 };
    let touchStartAt = 0;
    let touchScrollRemainder = 0;
    let isDragSelection = false;
    let gestureMode: "pending" | "scroll" | "selection" = "pending";
    let tmuxEnteredThisGesture = false;

    const getXterm = (): HTMLElement | null =>
      container.querySelector(".xterm");

    const getScreen = (): HTMLElement | null =>
      container.querySelector(".xterm-screen");

    const dispatchDoc = (type: string, props: Record<string, number>) => {
      document.dispatchEvent(
        new MouseEvent(type, { bubbles: true, cancelable: true, ...props }),
      );
    };

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) return;
      const screen = getScreen();
      if (!screen || !screen.contains(e.target as Node)) return;

      startPos = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      lastPos = startPos;
      touchStartAt = Date.now();
      isDragSelection = false;
      gestureMode = "pending";
      tmuxEnteredThisGesture = false;

      // Termux-style: scrolling up suppresses the keyboard; a tap at the
      // live tail focuses. Read scroll state *before* this gesture moves it.
      suppressTouchFocusRef.current =
        isScrolledUpRef.current && !keyboardHeight;
    };

    const onTouchMove = (e: TouchEvent) => {
      if (e.touches.length !== 1) return;

      const touch = e.touches[0];
      const dx = touch.clientX - startPos.x;
      const dy = touch.clientY - startPos.y;
      const absDx = Math.abs(dx);
      const absDy = Math.abs(dy);
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist < 2) return;

      if (enableTouchScroll && isMobile && gestureMode === "pending") {
        const longPressSelection = Date.now() - touchStartAt > 250;
        if (!longPressSelection && absDy > 6 && absDy > absDx) {
          gestureMode = "scroll";
        } else if (dist > 8) {
          gestureMode = "selection";
        }
      }

      if (enableTouchScroll && isMobile && gestureMode === "scroll") {
        const term = termInstanceRef.current;
        if (!term) return;
        e.preventDefault();
        const cellHeight =
          term.element
            ?.querySelector(".xterm-rows > div")
            ?.getBoundingClientRect().height || 16;
        touchScrollRemainder += (lastPos.y - touch.clientY) / cellHeight;
        const lines =
          touchScrollRemainder < 0
            ? Math.ceil(touchScrollRemainder)
            : Math.floor(touchScrollRemainder);

        if (lines !== 0) {
          if (autoTmux) {
            // Drive tmux copy-mode instead of xterm's local buffer: tmux owns
            // the real history, so scrolling has to happen there.
            const up = lines > 0; // scrolling up = viewing older lines
            if (!tmuxCopyActiveRef.current && !tmuxEnteredThisGesture) {
              // Enter tmux copy-mode (prefix + "["), inlined to avoid TDZ —
              // sendTmux is declared later in this component body.
              if (wsRef.current?.readyState === WebSocket.OPEN) {
                wsRef.current.send(JSON.stringify({ type: "data", data: "\x02" }));
                setTimeout(() => {
                  if (wsRef.current?.readyState === WebSocket.OPEN) {
                    wsRef.current.send(JSON.stringify({ type: "data", data: "[" }));
                  }
                }, 80);
              }
              tmuxCopyActiveRef.current = true;
              tmuxEnteredThisGesture = true;
            }
            for (let i = 0; i < Math.abs(lines); i++) {
              wsRef.current?.send(JSON.stringify({ type: "data", data: up ? "k" : "j" }));
            }
          } else {
            term.scrollLines(lines);
          }
          touchScrollRemainder -= lines;
        }
        lastPos = { x: touch.clientX, y: touch.clientY };
        return;
      }

      const xtermEl = getXterm();
      if (!xtermEl) return;

      e.preventDefault();

      if (!isDragSelection && dist > 8) {
        isDragSelection = true;
        xtermEl.dispatchEvent(
          new MouseEvent("mousedown", {
            bubbles: true,
            cancelable: true,
            clientX: startPos.x,
            clientY: startPos.y,
            button: 0,
            buttons: 1,
            detail: 1,
          }),
        );
      }

      if (isDragSelection) {
        dispatchDoc("mousemove", {
          clientX: touch.clientX,
          clientY: touch.clientY,
          button: 0,
          buttons: 1,
        });
      }

      lastPos = { x: touch.clientX, y: touch.clientY };
    };

    const onTouchEnd = (e: TouchEvent) => {
      const suppress = suppressTouchFocusRef.current;
      const pendingTap =
        !isDragSelection &&
        !suppress &&
        gestureMode === "pending" &&
        !tmuxEnteredThisGesture;

      if (pendingTap) {
        setTimeout(() => {
          const term = termInstanceRef.current;
          if (!term || !isActiveRef.current) return;
          // A tap is the explicit "I'm done reading history" signal — exit
          // tmux copy-mode, then focus so the keyboard is available.
          if (autoTmux && tmuxCopyActiveRef.current) {
            wsRef.current?.send(JSON.stringify({ type: "data", data: "q" }));
            tmuxCopyActiveRef.current = false;
          }
          if (!isScrolledUpRef.current) term.focus();
        }, 50);
      }

      suppressTouchFocusRef.current = false;

      if (isDragSelection && e.changedTouches.length === 1) {
        const t = e.changedTouches[0];
        dispatchDoc("mouseup", {
          clientX: t.clientX,
          clientY: t.clientY,
          button: 0,
          buttons: 1,
        });
        e.preventDefault();
      }
      isDragSelection = false;
      gestureMode = "pending";
      touchScrollRemainder = 0;
    };

    const onAuxClick = (e: MouseEvent) => {
      if (e.button === 1) {
        e.preventDefault();
        e.stopPropagation();
      }
    };

    container.addEventListener("touchstart", onTouchStart, { passive: false });
    container.addEventListener("touchmove", onTouchMove, { passive: false });
    container.addEventListener("touchend", onTouchEnd, { passive: false });
    container.addEventListener("auxclick", onAuxClick, true);

    return () => {
      container.removeEventListener("touchstart", onTouchStart);
      container.removeEventListener("touchmove", onTouchMove);
      container.removeEventListener("touchend", onTouchEnd);
      container.removeEventListener("auxclick", onAuxClick, true);
    };
  }, [enableTouchScroll, isMobile, autoTmux]);

  const sendShortcut = useCallback((data: string) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: "data", data }));
    }
  }, []);

  const sendTmux = useCallback((key: string) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: "data", data: "\x02" }));
      setTimeout(() => {
        if (wsRef.current?.readyState === WebSocket.OPEN) {
          wsRef.current.send(JSON.stringify({ type: "data", data: key }));
        }
      }, 80);
    }
  }, []);

  const tmuxButtons = useMemo(() => {
    const tmux = quickBarSlots.filter((s) => s.isTmux);
    if (tmux.length === 0) return null;
    // eslint-disable-next-line react-hooks/refs
    const buttons = tmux.map((s) => (
      <button
        key={s.data}
        onClick={sendTmux.bind(null, s.data)}
        className="flex-1 h-7 px-1 flex items-center justify-center rounded-md text-[10px] text-neutral-500 hover:text-white hover:bg-neutral-700 transition-colors cursor-pointer font-mono"
      >
        {s.label}
      </button>
    ));
    return (
      <div className="flex items-center gap-1 px-2 py-1.5 bg-neutral-900/80 backdrop-blur-sm border border-neutral-600 rounded-lg">
        <span className="text-[9px] text-neutral-600 font-mono shrink-0 mr-0.5">
          tmux
        </span>
        {buttons}
      </div>
    );
  }, [quickBarSlots, sendTmux]);

  const writeClipboardText = useCallback(async (text: string) => {
    if (!text) return false;

    try {
      if (!navigator.clipboard?.writeText)
        throw new Error("Clipboard API unavailable");
      await navigator.clipboard.writeText(text);
      return true;
    } catch {}

    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.top = "0";
      ta.style.left = "0";
      ta.style.opacity = "0";
      ta.style.pointerEvents = "none";
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      const copied = document.execCommand("copy");
      document.body.removeChild(ta);
      return copied;
    } catch {
      return false;
    }
  }, []);

  const decodeOsc52Payload = useCallback((payload: string) => {
    try {
      return decodeURIComponent(escape(atob(payload)));
    } catch {
      return "";
    }
  }, []);

  const captureOsc52Clipboard = useCallback(
    (chunk: string) => {
      if (!chunk) return;

      const source = `${osc52CarryRef.current}${chunk}`;
      const osc52Pattern =
        /\u001b]52;[^;]*;([A-Za-z0-9+/=]*)(?:\u0007|\u001b\\)/g;
      let match: RegExpExecArray | null = null;

      while ((match = osc52Pattern.exec(source))) {
        const decoded = decodeOsc52Payload(match[1]);
        if (!decoded) continue;
        pendingOsc52Ref.current = decoded;
        void writeClipboardText(decoded);
      }

      const lastStart = source.lastIndexOf("\u001b]52;");
      if (lastStart === -1) {
        osc52CarryRef.current = "";
        return;
      }

      const tail = source.slice(lastStart);
      if (tail.includes("\u0007") || tail.includes("\u001b\\")) {
        osc52CarryRef.current = "";
        return;
      }

      osc52CarryRef.current = tail.slice(-4096);
    },
    [decodeOsc52Payload, writeClipboardText],
  );

  const captureOsc7Directory = useCallback(
    (chunk: string) => {
      if (!chunk || !sessionId) return;

      const source = `${osc7CarryRef.current}${chunk}`;
      const osc7Pattern =
        /\u001b]7;file:\/\/[^/\u0007\u001b]*([^\u0007\u001b]*)(?:\u0007|\u001b\\)/g;
      let match: RegExpExecArray | null = null;

      while ((match = osc7Pattern.exec(source))) {
        const rawDirectory = match[1] || "/";
        try {
          setTerminalCwd(sessionId, decodeURIComponent(rawDirectory));
        } catch {
          setTerminalCwd(sessionId, rawDirectory);
        }
      }

      const lastStart = source.lastIndexOf("\u001b]7;file://");
      if (lastStart === -1) {
        osc7CarryRef.current = "";
        return;
      }

      const tail = source.slice(lastStart);
      if (tail.includes("\u0007") || tail.includes("\u001b\\")) {
        osc7CarryRef.current = "";
        return;
      }

      osc7CarryRef.current = tail.slice(-4096);
    },
    [sessionId, setTerminalCwd],
  );

  useEffect(() => {
    if (!wsUrl) return;

    const term = termInstanceRef.current;
    const fit = fitRef.current;

    const ws = new WebSocket(wsUrl);
    ws.binaryType = "arraybuffer";
    wsRef.current = ws;
    const isCurrentSocket = () => wsRef.current === ws;
    /* eslint-disable-next-line react-hooks/set-state-in-effect */
    setStatus("connecting");

    ws.onopen = () => {
      if (!isCurrentSocket()) {
        ws.close();
        return;
      }
      if (fit && term) {
        ws.send(
          JSON.stringify({
            type: "resize",
            cols: term.cols,
            rows: term.rows,
          }),
        );
        requestAnimationFrame(() => {
          forceTerminalRepaint();
          // Skip auto-focus on mobile so reconnect/refresh doesn't pop the keyboard.
          if (!isMobile) focusTerminal();
        });
      }
      setStatus("connected");
    };

    // Send ping every 20s to keep connection alive through proxies/firewalls
    const pingInterval = setInterval(() => {
      if (isCurrentSocket() && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "ping" }));
      }
    }, 20000);

    ws.onclose = () => {
      clearInterval(pingInterval);
      if (!isCurrentSocket()) return;
      snapshotTerminalBuffer();
      setStatus("disconnected");
    };
    ws.onerror = () => {
      clearInterval(pingInterval);
      if (!isCurrentSocket()) return;
      snapshotTerminalBuffer();
      setStatus("error");
    };

    ws.onmessage = (e) => {
      if (!isCurrentSocket()) return;
      try {
        if (e.data instanceof ArrayBuffer) {
          if (term) {
            if (!hasAutoNavigatedRef.current) {
              hasAutoNavigatedRef.current = true;
              if (windowId && tabId) {
                useWindowStore.getState().markTabNavigated(windowId, tabId);
              }
            }
            const bytes = new Uint8Array(e.data);
            const decoded = new TextDecoder().decode(bytes);
            captureOsc52Clipboard(decoded);
            captureOsc7Directory(decoded);
            term.write(bytes);
          }
          return;
        }

        const msg = JSON.parse(e.data);

        if (msg.type === "data" && term) {
          // First data from server means the shell is ready — send auto-cd now
          if (!hasAutoNavigatedRef.current) {
            hasAutoNavigatedRef.current = true;
            if (windowId && tabId) {
              useWindowStore.getState().markTabNavigated(windowId, tabId);
            }
          }
          const binaryStr = atob(msg.data);
          const bytes = new Uint8Array(binaryStr.length);
          for (let i = 0; i < binaryStr.length; i++) {
            bytes[i] = binaryStr.charCodeAt(i);
          }
          captureOsc52Clipboard(binaryStr);
          captureOsc7Directory(binaryStr);
          term.write(bytes);
        } else if (msg.type === "error" && term) {
          term.write(`\r\n${msg.message}\r\n`);
        }
      } catch (err) {
        console.warn("[SSHTerminal] Failed to process message:", err);
      }
    };

    return () => {
      clearInterval(pingInterval);
      snapshotTerminalBuffer();
      if (wsRef.current === ws) {
        wsRef.current = null;
      }
      ws.close();
    };
  }, [
    captureOsc52Clipboard,
    captureOsc7Directory,
    focusTerminal,
    forceTerminalRepaint,
    isMobile,
    snapshotTerminalBuffer,
    tabId,
    windowId,
    wsUrl,
  ]);

  useEffect(() => {
    if (!windowId || !autoTmux) return;
    const key = `${windowId}:${tabId}`;
    const cleanup = () => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: "cleanup" }));
      }
    };
    registerTerminalCleanup(key, cleanup);
    return () => unregisterTerminalCleanup(key);
  }, [windowId, tabId, autoTmux]);

  const handleCopy = useCallback(async () => {
    const term = termInstanceRef.current;
    if (!term) return;
    const selection = term.getSelection() || pendingOsc52Ref.current;
    if (!selection) return;

    if (await writeClipboardText(selection)) {
      showCopyFeedback();
      return;
    }

    // 3. Try OSC 52 self-feed through terminal parser (triggers ClipboardAddon)
    try {
      const b64 = btoa(unescape(encodeURIComponent(selection)));
      term.write(`\x1b]52;c;${b64}\x07`);
      showCopyFeedback();
    } catch {}
  }, [showCopyFeedback, writeClipboardText]);

  const handlePaste = useCallback(async () => {
    if (wsRef.current?.readyState !== WebSocket.OPEN) return;

    try {
      if (!navigator.clipboard?.readText)
        throw new Error("Clipboard read unavailable");
      const text = await navigator.clipboard.readText();
      if (!text) return;
      wsRef.current.send(JSON.stringify({ type: "data", data: text }));
      showPasteFeedback();
    } catch {}
  }, [showPasteFeedback]);

  const handleUploadClick = useCallback(() => {
    if (!connectionId) return;
    const conns = useSSHStore.getState().connections;
    const conn = conns.find((c) => c.id === connectionId);
    if (conn) useFileTransferStore.getState().openUpload(conn);
  }, [connectionId]);

  const handleDownloadClick = useCallback(() => {
    if (!connectionId) return;
    const conns = useSSHStore.getState().connections;
    const conn = conns.find((c) => c.id === connectionId);
    if (conn) useFileTransferStore.getState().openDownload(conn);
  }, [connectionId]);

  const handleVoiceSend = useCallback((text: string) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: "data", data: text + "\r" }));
    }
  }, []);

  const openVoiceOverlay = useCallback(() => {
    setVoiceOverlayOpen(true);
  }, []);

  const closeVoiceOverlay = useCallback(() => {
    setVoiceOverlayOpen(false);
  }, []);

  // Tap-vs-drag: pointerup with no movement = tap (opens overlay), so no onClick here.
  const MIC_DRAG_THRESHOLD = 6;
  const handleMicPointerDown = useCallback((e: React.PointerEvent<HTMLButtonElement>) => {
    const el = e.currentTarget;
    micDragOriginRef.current = { x: el.offsetLeft, y: el.offsetTop };
    micDragStartRef.current = { x: e.clientX, y: e.clientY };
    micDragMovedRef.current = false;
    el.setPointerCapture(e.pointerId);
  }, []);

  const handleMicPointerMove = useCallback((e: React.PointerEvent<HTMLButtonElement>) => {
    const el = e.currentTarget;
    if (!el.hasPointerCapture(e.pointerId)) return;
    const dx = e.clientX - micDragStartRef.current.x;
    const dy = e.clientY - micDragStartRef.current.y;
    if (!micDragMovedRef.current && Math.hypot(dx, dy) < MIC_DRAG_THRESHOLD) return;
    micDragMovedRef.current = true;
    const parent = el.offsetParent ?? el.parentElement;
    const maxX = parent ? parent.clientWidth - el.offsetWidth : 0;
    const maxY = parent ? parent.clientHeight - el.offsetHeight : 0;
    setMicPos({
      x: Math.max(0, Math.min(maxX, micDragOriginRef.current.x + dx)),
      y: Math.max(0, Math.min(maxY, micDragOriginRef.current.y + dy)),
    });
  }, []);

  const handleMicPointerUp = useCallback(
    (e: React.PointerEvent<HTMLButtonElement>) => {
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {}
      if (!micDragMovedRef.current) openVoiceOverlay();
      micDragMovedRef.current = false;
    },
    [openVoiceOverlay],
  );

  const mobileBottomInset = isMobile
    ? (keyboardHeight ?? 0) + (showTerminalShortcuts ? 56 : 0)
    : 0;

  const translateVoice = useCallback(async (text: string) => {
    try {
      const { ninerouterApiKey, ninerouterModel } = useSettingsStore.getState();
      const res = await fetch("/api/voice/translate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text,
          apiKey: ninerouterApiKey || undefined,
          model: ninerouterModel || undefined,
        }),
      });
      if (!res.ok) throw new Error("Translation failed");
      const data = await res.json();
      return data.translated || text;
    } catch {
      return text;
    }
  }, []);

  return (
    <div
      style={{
        visibility: isActive ? "visible" : "hidden",
        position: "absolute",
        inset: 0,
        paddingBottom: mobileBottomInset ? `${mobileBottomInset}px` : undefined,
      }}
      className={`bg-[#0a0a0a] ${
        isMobile
          ? ""
          : showTerminalShortcuts
            ? showTmuxShortcuts
              ? "pb-28"
              : "pb-16"
            : ""
      }`}
    >
      <div
        ref={terminalRef}
        onMouseDown={lockKeyboard}
        className="w-full h-full"
        style={
          enableTouchScroll && isMobile
            ? { touchAction: "pan-y", overscrollBehavior: "contain" }
            : undefined
        }
      />

      {/* Mobile UI */}
      {status === "connected" && isMobile && showTerminalShortcuts && (
        <>
          <button
            onPointerDown={handleMicPointerDown}
            onPointerMove={handleMicPointerMove}
            onPointerUp={handleMicPointerUp}
            onPointerCancel={handleMicPointerUp}
            className={`absolute z-30 mb-2 w-12 h-12 rounded-full bg-blue-600 hover:bg-blue-500 flex items-center justify-center text-white shadow-xl transition-colors active:scale-95 touch-none cursor-grab active:cursor-grabbing ${
              micPos ? "" : "left-1/2 -translate-x-1/2"
            }`}
            style={
              micPos
                ? { left: micPos.x, top: micPos.y }
                : {
                    position: "absolute",
                    bottom: keyboardHeight ? `${keyboardHeight + 64}px` : "4rem",
                  }
            }
            title="Voice Input"
            aria-label="Voice Input"
          >
            <Mic className="w-6 h-6" />
          </button>
          <div
            className="absolute left-1 right-1 z-30"
            style={{
              bottom: keyboardHeight ? `${keyboardHeight + 4}px` : "0.25rem",
            }}
          >
            <QuickBar
              onSend={sendShortcut}
              onTmux={sendTmux}
              onCopy={handleCopy}
              onPaste={handlePaste}
              onToggleDrawer={() => setDrawerOpen((o) => !o)}
              copyFeedback={copyFeedback}
              pasteFeedback={pasteFeedback}
              drawerOpen={drawerOpen}
            />
          </div>
        </>
      )}
      {status === "connected" &&
        isMobile &&
        showTerminalShortcuts &&
        drawerOpen && (
          <ShortcutDrawer
            open={drawerOpen}
            onClose={() => setDrawerOpen(false)}
            onSend={sendShortcut}
            onTmux={sendTmux}
            anchorRef={terminalRef}
          />
        )}

      {/* Desktop UI */}
      {status === "connected" && !isMobile && showTerminalShortcuts && (
        <div className="absolute bottom-2 left-2 right-2 z-40 flex flex-col gap-1.5">
          <div className="flex items-center gap-1 px-2 py-1.5 bg-neutral-900/80 backdrop-blur-sm border border-neutral-700 rounded-lg">
            <button
              onClick={() => sendShortcut("\x03")}
              className="flex-1 h-7 px-1 flex items-center justify-center rounded-md text-[10px] text-neutral-400 hover:text-white hover:bg-neutral-700 transition-colors cursor-pointer font-mono"
              title="Ctrl+C (interrupt)"
            >
              C-c
            </button>
            <button
              onClick={() => sendShortcut("\x04")}
              className="flex-1 h-7 px-1 flex items-center justify-center rounded-md text-[10px] text-neutral-400 hover:text-white hover:bg-neutral-700 transition-colors cursor-pointer font-mono"
              title="Ctrl+D (EOF)"
            >
              C-d
            </button>
            <button
              onClick={() => sendShortcut("\x15")}
              className="flex-1 h-7 px-1 flex items-center justify-center rounded-md text-[10px] text-neutral-400 hover:text-white hover:bg-neutral-700 transition-colors cursor-pointer font-mono"
              title="Ctrl+U (clear line)"
            >
              C-u
            </button>
            <button
              onClick={() => sendShortcut("\x17")}
              className="flex-1 h-7 px-1 flex items-center justify-center rounded-md text-[10px] text-neutral-400 hover:text-white hover:bg-neutral-700 transition-colors cursor-pointer font-mono"
              title="Ctrl+W (delete word)"
            >
              C-w
            </button>
            <button
              onClick={() => sendShortcut("\x0c")}
              className="flex-1 h-7 px-1 flex items-center justify-center rounded-md text-[10px] text-neutral-400 hover:text-white hover:bg-neutral-700 transition-colors cursor-pointer font-mono"
              title="Ctrl+L (clear screen)"
            >
              C-l
            </button>
            <div className="w-px h-4 bg-neutral-700" />
            <button
              onClick={() => sendShortcut("\x1b[A")}
              className="flex-1 h-7 px-1 flex items-center justify-center rounded-md text-sm text-neutral-400 hover:text-white hover:bg-neutral-700 transition-colors cursor-pointer"
              title="Arrow Up"
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <polyline points="18 15 12 9 6 15" />
              </svg>
            </button>
            <button
              onClick={() => sendShortcut("\x1b[B")}
              className="flex-1 h-7 px-1 flex items-center justify-center rounded-md text-sm text-neutral-400 hover:text-white hover:bg-neutral-700 transition-colors cursor-pointer"
              title="Arrow Down"
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </button>
            <div className="w-px h-4 bg-neutral-700" />
            <button
              onClick={() => sendShortcut("\x09")}
              className="flex-1 h-7 px-1 flex items-center justify-center rounded-md text-[10px] text-neutral-400 hover:text-white hover:bg-neutral-700 transition-colors cursor-pointer font-mono"
              title="Tab"
            >
              Tab
            </button>
            <button
              onClick={() => sendShortcut("\r")}
              className="flex-1 h-7 px-1 flex items-center justify-center rounded-md text-[10px] text-neutral-400 hover:text-white hover:bg-neutral-700 transition-colors cursor-pointer font-mono"
              title="Enter"
            >
              Enter
            </button>
            <div className="w-px h-4 bg-neutral-700" />
            <button
              onClick={handleCopy}
              className="flex-1 h-7 px-1 flex items-center justify-center rounded-md text-[10px] text-neutral-400 hover:text-white hover:bg-neutral-700 transition-colors cursor-pointer font-mono"
              title="Copy selected text"
            >
              {copyFeedback ? (
                <span className="text-green-400">Copied!</span>
              ) : (
                <Copy size={12} />
              )}
            </button>
            <button
              onClick={handlePaste}
              className="flex-1 h-7 px-1 flex items-center justify-center rounded-md text-[10px] text-neutral-400 hover:text-white hover:bg-neutral-700 transition-colors cursor-pointer font-mono"
              title="Paste device clipboard"
            >
              {pasteFeedback ? (
                <span className="text-green-400">Pasted!</span>
              ) : (
                <span>Paste</span>
              )}
            </button>
            <div className="w-px h-4 bg-neutral-700" />
            <button
              onClick={openVoiceOverlay}
              className="flex-1 h-7 px-1 flex items-center justify-center rounded-md text-[10px] text-blue-400 hover:text-blue-300 hover:bg-blue-600/20 transition-colors cursor-pointer font-mono"
              title="Voice Input (Speech to Text)"
            >
              <Mic className="w-4 h-4" />
            </button>
            <div className="w-px h-4 bg-neutral-700" />
            <button
              onClick={handleUploadClick}
              className="flex-1 h-7 px-1 flex items-center justify-center rounded-md text-[10px] text-neutral-400 hover:text-white hover:bg-neutral-700 transition-colors cursor-pointer"
              title="Upload file to remote"
            >
              <Upload size={12} />
            </button>
            <button
              onClick={handleDownloadClick}
              className="flex-1 h-7 px-1 flex items-center justify-center rounded-md text-[10px] text-neutral-400 hover:text-white hover:bg-neutral-700 transition-colors cursor-pointer"
              title="Download file from remote"
            >
              <Download size={12} />
            </button>
          </div>
          {showTmuxShortcuts && tmuxButtons}
        </div>
      )}
      {status !== "connected" && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/80 text-white text-sm z-50">
          {status === "connecting" && (
            <span className="text-neutral-400">Connecting...</span>
          )}
          {status === "error" && (
            <div className="text-center">
              <p className="text-red-400 mb-4">Connection error</p>
              <button
                onClick={refreshTerminal}
                className="px-4 py-2 bg-neutral-800 hover:bg-neutral-700 border border-neutral-700 rounded-md transition-colors text-xs"
              >
                Refresh
              </button>
            </div>
          )}
          {status === "disconnected" && (
            <div className="text-center">
              <p className="text-neutral-400 mb-4">Disconnected</p>
              <button
                onClick={refreshTerminal}
                className="px-4 py-2 bg-neutral-800 hover:bg-neutral-700 border border-neutral-700 rounded-md transition-colors text-xs"
              >
                Refresh
              </button>
            </div>
          )}
        </div>
      )}
      <VoiceInputOverlay
        isOpen={voiceOverlayOpen}
        onClose={closeVoiceOverlay}
        onSend={handleVoiceSend}
        isMobile={isMobile}
        onTranslate={translateVoice}
      />
    </div>
  );
};

const SSHTerminal = ({
  connectionId,
  windowId,
}: {
  connectionId?: number;
  windowId?: string;
}) => {
  const win = useWindowStore((s) => s.windows.find((w) => w.id === windowId));
  const windows = useWindowStore((s) => s.windows);
  const addTerminalTab = useWindowStore((s) => s.addTerminalTab);
  const closeTerminalTab = useWindowStore((s) => s.closeTerminalTab);
  const setActiveTerminalTab = useWindowStore((s) => s.setActiveTerminalTab);
  const focusWindow = useWindowStore((s) => s.focusWindow);

  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const keyboardRafRef = useRef<number | null>(null);

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 767px)");
    if (!mq.matches) return;
    const vv = window.visualViewport;
    if (!vv) return;

    const update = () => {
      if (keyboardRafRef.current !== null) {
        cancelAnimationFrame(keyboardRafRef.current);
      }
      keyboardRafRef.current = requestAnimationFrame(() => {
        const viewportBottom = Math.max(0, vv.height + vv.offsetTop);
        const rawHeight = Math.max(0, window.innerHeight - viewportBottom);
        const h = rawHeight < 80 ? 0 : rawHeight;
        setKeyboardHeight((prev) => (Math.abs(prev - h) > 2 ? h : prev));
        keyboardRafRef.current = null;
      });
    };
    update();
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    return () => {
      if (keyboardRafRef.current !== null) {
        cancelAnimationFrame(keyboardRafRef.current);
      }
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
    };
  }, []);

  const sshMeta = win ? getSSHMetadata(win) : null;
  const tabs = sshMeta?.tabs ?? [
    { id: "default", label: "Tab 1", connectionId },
  ];
  const activeTabId = sshMeta?.activeTabId ?? tabs[0]?.id ?? "default";
  const [paneRefreshKey, setPaneRefreshKey] = useState(0);
  const nextTerminal = getNextSSHTerminalTarget(windows, windowId, activeTabId);

  const handleAddTab = () => {
    if (!windowId) return;
    const newTabId = `tab-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    addTerminalTab(windowId, {
      id: newTabId,
      label: `Tab ${tabs.length + 1}`,
      connectionId,
    });
  };

  const handleCloseTab = (e: React.MouseEvent, tabId: string) => {
    e.stopPropagation();
    if (windowId && tabs.length > 1) closeTerminalTab(windowId, tabId);
  };

  const handleRefresh = () => {
    setPaneRefreshKey((k) => k + 1);
  };

  const handleNextWindow = () => {
    if (!nextTerminal) return;
    setActiveTerminalTab(nextTerminal.windowId, nextTerminal.tabId);
    focusWindow(nextTerminal.windowId);
  };

  return (
    <div className="w-full h-full flex flex-col bg-[#0a0a0a]">
      <div className="flex items-center h-9 bg-neutral-950 border-b border-neutral-800 shrink-0 overflow-x-auto scrollbar-none">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => windowId && setActiveTerminalTab(windowId, tab.id)}
            className={`flex items-center gap-1 px-3 h-full text-xs shrink-0 border-r border-neutral-800 transition-colors cursor-pointer ${
              tab.id === activeTabId
                ? "text-white bg-[#0a0a0a]"
                : "text-neutral-500 hover:text-neutral-300 hover:bg-neutral-900"
            }`}
          >
            <span className="max-w-[6rem] truncate">
              {tab.title ?? tab.label}
            </span>
            {tabs.length > 1 && (
              <span
                onClick={(e) => handleCloseTab(e, tab.id)}
                className="ml-0.5 leading-none text-neutral-600 hover:text-white transition-colors"
              >
                ×
              </span>
            )}
          </button>
        ))}
        <button
          onClick={handleRefresh}
          title="Refresh terminal"
          className="px-2.5 h-full text-neutral-600 hover:text-white transition-colors cursor-pointer shrink-0"
        >
          <RefreshCw size={14} />
        </button>
        <TerminalNextButton
          onClick={handleNextWindow}
          disabled={!nextTerminal}
          iconOnly
          className="px-2.5 h-full text-neutral-600 hover:text-white transition-colors cursor-pointer shrink-0 disabled:opacity-30 disabled:cursor-not-allowed inline-flex items-center justify-center"
        />
        <button
          onClick={handleAddTab}
          title="New tab"
          className="px-2.5 h-full text-neutral-600 hover:text-white transition-colors cursor-pointer text-base leading-none shrink-0"
        >
          +
        </button>
      </div>

      <div className="relative flex-1 min-h-0">
        {tabs.map((tab) => (
          <SSHPane
            key={tab.id}
            tabId={tab.id}
            windowId={windowId}
            connectionId={tab.connectionId ?? connectionId}
            isActive={tab.id === activeTabId}
            hasNavigated={tab.hasNavigated}
            keyboardHeight={keyboardHeight}
            refreshNonce={paneRefreshKey}
            enableTouchScroll
          />
        ))}
      </div>
    </div>
  );
};

export const registry: Record<AppId, AppDefinition> = {
  notes: {
    id: "notes",
    title: "Notes",
    icon: <NotepadText />,
    component: Notes as React.ComponentType<{
      connectionId?: number;
      windowId?: string;
    }>,
    defaultWidth: 600,
    defaultHeight: 450,
  },
  ssh: {
    id: "ssh",
    title: "SSH",
    icon: <FileTerminal />,
    component: SSHTerminal as React.ComponentType<{
      connectionId?: number;
      windowId?: string;
    }>,
    defaultWidth: 800,
    defaultHeight: 600,
  },
  devBrowser: {
    id: "devBrowser",
    title: "Dev Browser",
    icon: <Globe />,
    component: DevBrowser as React.ComponentType<{
      connectionId?: number;
      windowId?: string;
      initialUrl?: string;
    }>,
    defaultWidth: 1024,
    defaultHeight: 768,
  },
  fileTransfer: {
    id: "fileTransfer",
    title: "File Transfer",
    icon: <Download />,
    component: FileTransferWindow as React.ComponentType<{
      connectionId?: number;
      windowId?: string;
    }>,
    defaultWidth: 560,
    defaultHeight: 520,
  },
};

export default registry;
