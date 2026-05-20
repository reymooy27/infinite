import type { AppDefinition, AppId } from "@/types";
import { ClipboardAddon } from "@xterm/addon-clipboard";
import { FitAddon } from "@xterm/addon-fit";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { Terminal as XTerminal } from "@xterm/xterm";
import { Code2, Copy, FileText, Monitor } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import DevBrowser from "./DevBrowser";
import { useSettingsStore } from "@/stores/useSettingsStore";

const Notes = () => {
  const [content, setContent] = useState("");

  return (
    <textarea
      className="w-full h-full p-4 bg-neutral-800 text-neutral-100 resize-none outline-none text-sm leading-relaxed"
      placeholder="Start typing..."
      value={content}
      onChange={(e) => setContent(e.target.value)}
      autoFocus
    />
  );
};

const SSHTerminal = ({
  connectionId,
  windowId,
}: {
  connectionId?: number;
  windowId?: string;
}) => {
  const terminalRef = useRef<HTMLDivElement>(null);
  const termInstanceRef = useRef<XTerminal | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const [status, setStatus] = useState<string>("connecting");
  const [retryKey, setRetryKey] = useState(0);
  const [copyFeedback, setCopyFeedback] = useState(false);
  const showTerminalShortcuts = useSettingsStore(
    (s) => s.showTerminalShortcuts,
  );
  const showTmuxShortcuts = useSettingsStore((s) => s.showTmuxShortcuts);
  const statusRef = useRef(status);
  statusRef.current = status;

  const wsUrl = useMemo(() => {
    if (!connectionId) return null;
    const configured = process.env.NEXT_PUBLIC_WS_URL;
    if (configured) {
      if (configured.startsWith("ws://") || configured.startsWith("wss://")) {
        return `${configured}/ws/ssh?connectionId=${connectionId}&windowId=${windowId}&r=${retryKey}`;
      }
      const proto = configured.startsWith("https") ? "wss:" : "ws:";
      const base = configured.replace(/^https?:\/\//, "");
      return `${proto}//${base}/ws/ssh?connectionId=${connectionId}&windowId=${windowId}&r=${retryKey}`;
    }
    const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
    return `${proto}//${window.location.hostname}:3001/ws/ssh?connectionId=${connectionId}&windowId=${windowId}&r=${retryKey}`;
  }, [connectionId, windowId, retryKey]);

  useEffect(() => {
    const handleScrollEvent = (e: any) => {
      if (termInstanceRef.current) {
        const { direction } = e.detail;
        if (direction === "up") {
          termInstanceRef.current.scrollLines(-5);
        } else {
          termInstanceRef.current.scrollLines(5);
        }
      }
    };

    window.addEventListener(`app-scroll-${windowId}`, handleScrollEvent);
    return () =>
      window.removeEventListener(`app-scroll-${windowId}`, handleScrollEvent);
  }, [windowId]);

  useEffect(() => {
    const handleVisibility = () => {
      if (
        !document.hidden &&
        (statusRef.current === "disconnected" || statusRef.current === "error")
      ) {
        setRetryKey((k) => k + 1);
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () =>
      document.removeEventListener("visibilitychange", handleVisibility);
  }, []);

  useEffect(() => {
    if (!terminalRef.current) return;

    const term = new XTerminal({
      theme: {
        foreground: "#e0e0e0",
        background: "#0a0a0a",
        cursor: "#e0e0e0",
      },
      fontSize: 13,
      fontFamily: '"JetBrains Mono", "JetBrainsMono Nerd Font", monospace',
      allowProposedApi: true,
      cursorBlink: true,
    });
    termInstanceRef.current = term;

    const fit = new FitAddon();
    fitRef.current = fit;
    term.loadAddon(fit);
    const links = new WebLinksAddon();
    term.loadAddon(links);
    const unicode11Addon = new Unicode11Addon();
    term.loadAddon(unicode11Addon);
    term.unicode.activeVersion = "11";
    const clipboardAddon = new ClipboardAddon();
    term.loadAddon(clipboardAddon);
    term.open(terminalRef.current);
    fit.fit();

    term.onData((data) => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: "data", data }));
      }
    });

    term.onResize(({ cols, rows }) => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: "resize", cols, rows }));
      }
    });

    const observer = new ResizeObserver(() => fit.fit());
    observer.observe(terminalRef.current);

    return () => {
      observer.disconnect();
      term.dispose();
      termInstanceRef.current = null;
      fitRef.current = null;
    };
  }, []);

  useEffect(() => {
    const container = terminalRef.current;
    if (!container) return;

    let startPos = { x: 0, y: 0 };
    let isDragSelection = false;

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
      isDragSelection = false;
    };

    const onTouchMove = (e: TouchEvent) => {
      if (e.touches.length !== 1) return;

      const dx = e.touches[0].clientX - startPos.x;
      const dy = e.touches[0].clientY - startPos.y;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist < 2) return;

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
        const t = e.touches[0];
        dispatchDoc("mousemove", {
          clientX: t.clientX,
          clientY: t.clientY,
          button: 0,
          buttons: 1,
        });
      }
    };

    const onTouchEnd = (e: TouchEvent) => {
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
    };

    container.addEventListener("touchstart", onTouchStart, { passive: false });
    container.addEventListener("touchmove", onTouchMove, { passive: false });
    container.addEventListener("touchend", onTouchEnd, { passive: false });

    return () => {
      container.removeEventListener("touchstart", onTouchStart);
      container.removeEventListener("touchmove", onTouchMove);
      container.removeEventListener("touchend", onTouchEnd);
    };
  }, []);

  useEffect(() => {
    if (!wsUrl) return;

    const term = termInstanceRef.current;
    const fit = fitRef.current;

    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;
    setStatus("connecting");

    ws.onopen = () => {
      if (fit && term) {
        fit.fit();
        ws.send(
          JSON.stringify({
            type: "resize",
            cols: term.cols,
            rows: term.rows,
          }),
        );
      }
      setStatus("connected");
    };

    ws.onclose = () => setStatus("disconnected");
    ws.onerror = () => setStatus("error");

    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.type === "data" && term) {
          const binaryStr = atob(msg.data);
          const bytes = new Uint8Array(binaryStr.length);
          for (let i = 0; i < binaryStr.length; i++) {
            bytes[i] = binaryStr.charCodeAt(i);
          }
          term.write(bytes);
        } else if (msg.type === "error" && term) {
          term.write(`\r\n${msg.message}\r\n`);
        }
      } catch {
        term?.write(e.data);
      }
    };

    return () => {
      ws.close();
    };
  }, [wsUrl]);

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

  const handleCopy = useCallback(async () => {
    const term = termInstanceRef.current;
    if (!term) return;
    const selection = term.getSelection();
    if (!selection) return;

    const showFeedback = () => {
      setCopyFeedback(true);
      setTimeout(() => setCopyFeedback(false), 1200);
    };

    // 1. Try modern clipboard API (secure context / localhost)
    try {
      await navigator.clipboard.writeText(selection);
      showFeedback();
      return;
    } catch {}

    // 2. Try legacy execCommand fallback (works on more mobile browsers)
    try {
      const ta = document.createElement("textarea");
      ta.value = selection;
      ta.style.position = "fixed";
      ta.style.top = "0";
      ta.style.left = "0";
      ta.style.opacity = "0";
      ta.style.pointerEvents = "none";
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      showFeedback();
      return;
    } catch {}

    // 3. Try OSC 52 self-feed through terminal parser (triggers ClipboardAddon)
    try {
      const b64 = btoa(unescape(encodeURIComponent(selection)));
      term.write(`\x1b]52;c;${b64}\x07`);
      showFeedback();
    } catch {}
  }, []);

  return (
    <div
      className={`relative w-full h-full px-2 bg-[#0a0a0a] ${
        showTerminalShortcuts
          ? showTmuxShortcuts
            ? "pt-2 pb-28"
            : "pt-2 pb-16"
          : "py-2"
      }`}
    >
      <div ref={terminalRef} className="w-full h-full" />
      {status === "connected" && showTerminalShortcuts && (
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
          </div>
          {showTmuxShortcuts && (
            <div className="flex items-center gap-1 px-2 py-1.5 bg-neutral-900/80 backdrop-blur-sm border border-neutral-600 rounded-lg">
              <span className="text-[9px] text-neutral-600 font-mono shrink-0 mr-0.5">
                tmux
              </span>
              <button
                onClick={() => sendTmux("n")}
                className="flex-1 h-7 px-1 flex items-center justify-center rounded-md text-[10px] text-neutral-500 hover:text-white hover:bg-neutral-700 transition-colors cursor-pointer font-mono"
                title="Next window"
              >
                next
              </button>
              <button
                onClick={() => sendTmux("p")}
                className="flex-1 h-7 px-1 flex items-center justify-center rounded-md text-[10px] text-neutral-500 hover:text-white hover:bg-neutral-700 transition-colors cursor-pointer font-mono"
                title="Previous window"
              >
                prev
              </button>
              <button
                onClick={() => sendTmux("c")}
                className="flex-1 h-7 px-1 flex items-center justify-center rounded-md text-[10px] text-neutral-500 hover:text-white hover:bg-neutral-700 transition-colors cursor-pointer font-mono"
                title="New window"
              >
                new
              </button>
              <div className="w-px h-4 bg-neutral-700" />
              <button
                onClick={() => sendTmux("%")}
                className="flex-1 h-7 px-1 flex items-center justify-center rounded-md text-[10px] text-neutral-500 hover:text-white hover:bg-neutral-700 transition-colors cursor-pointer font-mono"
                title="Split vertical"
              >
                vsplt
              </button>
              <button
                onClick={() => sendTmux('"')}
                className="flex-1 h-7 px-1 flex items-center justify-center rounded-md text-[10px] text-neutral-500 hover:text-white hover:bg-neutral-700 transition-colors cursor-pointer font-mono"
                title="Split horizontal"
              >
                hsplt
              </button>
              <div className="w-px h-4 bg-neutral-700" />
              <button
                onClick={() => sendTmux("z")}
                className="flex-1 h-7 px-1 flex items-center justify-center rounded-md text-[10px] text-neutral-500 hover:text-white hover:bg-neutral-700 transition-colors cursor-pointer font-mono"
                title="Zoom pane"
              >
                zoom
              </button>
              <button
                onClick={() => sendTmux("x")}
                className="flex-1 h-7 px-1 flex items-center justify-center rounded-md text-[10px] text-neutral-500 hover:text-white hover:bg-neutral-700 transition-colors cursor-pointer font-mono"
                title="Kill pane"
              >
                kill
              </button>
              <button
                onClick={() => sendTmux("d")}
                className="flex-1 h-7 px-1 flex items-center justify-center rounded-md text-[10px] text-neutral-500 hover:text-white hover:bg-neutral-700 transition-colors cursor-pointer font-mono"
                title="Detach"
              >
                detach
              </button>
            </div>
          )}
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
                onClick={() => setRetryKey((k) => k + 1)}
                className="px-4 py-2 bg-neutral-800 hover:bg-neutral-700 border border-neutral-700 rounded-md transition-colors text-xs"
              >
                Reconnect
              </button>
            </div>
          )}
          {status === "disconnected" && (
            <div className="text-center">
              <p className="text-neutral-400 mb-4">Disconnected</p>
              <button
                onClick={() => setRetryKey((k) => k + 1)}
                className="px-4 py-2 bg-neutral-800 hover:bg-neutral-700 border border-neutral-700 rounded-md transition-colors text-xs"
              >
                Reconnect
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export const registry: Record<AppId, AppDefinition> = {
  notes: {
    id: "notes",
    title: "Notes",
    icon: <FileText />,
    component: Notes as React.ComponentType<{
      connectionId?: number;
      windowId?: string;
    }>,
    defaultWidth: 380,
    defaultHeight: 350,
  },
  ssh: {
    id: "ssh",
    title: "SSH",
    icon: <Monitor />,
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
    icon: <Code2 />,
    component: DevBrowser as React.ComponentType<{
      connectionId?: number;
      windowId?: string;
    }>,
    defaultWidth: 1024,
    defaultHeight: 768,
  },
};

export default registry;
