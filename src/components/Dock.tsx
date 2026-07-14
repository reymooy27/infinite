"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import registry from "@/apps/registry";
import { useFileTransferStore } from "@/stores/useFileTransferStore";
import { useSSHStore } from "@/stores/useSSHStore";
import { useWindowStore } from "@/stores/useWindowStore";
import { useSettingsStore } from "@/stores/useSettingsStore";
import { centerWindowById } from "@/lib/focusWindow";
import type { AppId, SSHConnection } from "@/types";

const DOCK_APPS: AppId[] = ["notes", "ssh", "docker"];
const BROWSER_DOCK_APPS: AppId[] = ["devBrowser", "browserCanvas"];
const BROWSER_CHOICES: Array<{
  appId: (typeof BROWSER_DOCK_APPS)[number];
  label: string;
  description: string;
}> = [
  {
    appId: "devBrowser",
    label: "Dev Web",
    description: "Open dev browser window for local web testing.",
  },
  {
    appId: "browserCanvas",
    label: "Puppeteer",
    description: "Open streamed browser window backed by Puppeteer.",
  },
];

function SSHConnectionChoices({
  connections,
  onSelect,
}: {
  connections: SSHConnection[];
  onSelect: (conn: SSHConnection) => void;
}) {
  return (
    <div className="mt-4 space-y-2">
      {connections.map((conn) => (
        <button
          key={conn.id}
          onClick={() => onSelect(conn)}
          className="flex w-full items-start gap-3 rounded-xl border border-neutral-700 bg-neutral-800/70 px-3 py-3 text-left transition-colors cursor-pointer hover:border-blue-500 hover:bg-neutral-800"
        >
          <span className="mt-0.5 text-blue-400">
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M4 17l6-6-6-6" />
              <path d="M10 17l6-6-6-6" />
            </svg>
          </span>
          <span className="min-w-0">
            <span className="block text-sm font-medium text-neutral-100">
              {conn.name}
            </span>
            <span className="mt-1 block text-xs text-neutral-400">
              {conn.username}@{conn.host}:{conn.port}
            </span>
          </span>
        </button>
      ))}
    </div>
  );
}

function WindowList({
  windows,
  onFocus,
  onMinimize,
  onClose,
  onRename,
  mobile = false,
}: {
  windows: ReturnType<typeof useWindowStore.getState>["windows"];
  onFocus: (win: (typeof windows)[0]) => void;
  onMinimize: (id: string) => void;
  onClose: (id: string) => void;
  onRename: (id: string, currentTitle: string) => void;
  mobile?: boolean;
}) {
  if (windows.length === 0)
    return (
      <div className="px-3 py-4 text-xs text-neutral-600 text-center">
        No open windows
      </div>
    );
  return (
    <>
      {windows.map((win) => {
        const app = registry[win.appId];
        if (!app) return null;
        const title = (win.metadata?.title as string) || app.title;

        if (mobile) {
          return (
            <div key={win.id} className="px-2.5 py-1.5 w-full">
              <div className="flex w-full items-center justify-between rounded-lg border border-neutral-700 bg-neutral-800/70 px-3 py-2.5 hover:border-neutral-600 hover:bg-neutral-800 transition-colors">
                <button
                  onClick={() => onFocus(win)}
                  className="flex items-center gap-2.5 flex-1 min-w-0 text-left cursor-pointer"
                >
                  <span className="scale-90 text-neutral-300 shrink-0">
                    {app.icon}
                  </span>
                  <span className="text-[13px] font-medium text-neutral-100 truncate">
                    {title}
                  </span>
                  {win.minimized && (
                    <span className="text-[10px] text-neutral-500 shrink-0 ml-1">
                      minimized
                    </span>
                  )}
                </button>
                <div className="flex items-center gap-1 shrink-0 ml-2">
                  <button onClick={() => onRename(win.id, title)} className="w-8 h-8 flex items-center justify-center rounded hover:bg-neutral-700 text-neutral-500 hover:text-neutral-200 cursor-pointer" title="Rename">
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                  </button>
                  {!win.minimized && (
                    <button
                      onClick={() => onMinimize(win.id)}
                      className="w-8 h-8 flex items-center justify-center rounded hover:bg-neutral-700 text-neutral-500 hover:text-neutral-200 cursor-pointer"
                      title="Minimize"
                    >
                      <svg width="10" height="1" viewBox="0 0 10 1">
                        <rect width="10" height="1" fill="currentColor" />
                      </svg>
                    </button>
                  )}
                  <button
                    onClick={() => onClose(win.id)}
                    className="w-8 h-8 flex items-center justify-center rounded hover:bg-red-600 text-neutral-500 hover:text-white cursor-pointer"
                    title="Close"
                  >
                    <svg
                      width="8"
                      height="8"
                      viewBox="0 0 10 10"
                      stroke="currentColor"
                      strokeWidth="1.5"
                    >
                      <path d="M0 0L10 10M10 0L0 10" />
                    </svg>
                  </button>
                </div>
              </div>
            </div>
          );
        }

        return (
          <div
            key={win.id}
            className="flex items-center gap-2 px-3 py-2 hover:bg-neutral-800 group"
          >
            <button
              onClick={() => onFocus(win)}
              className="flex items-center gap-2 flex-1 min-w-0 text-left cursor-pointer"
            >
              <span className="text-sm shrink-0 text-neutral-400">
                {app.icon}
              </span>
              <span className="text-sm text-neutral-200 truncate">{title}</span>
              {win.minimized && (
                <span className="text-[10px] text-neutral-500 shrink-0">
                  minimized
                </span>
              )}
            </button>
            <div className="flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
              <button onClick={() => onRename(win.id, title)} className="w-6 h-6 flex items-center justify-center rounded hover:bg-neutral-700 text-neutral-500 hover:text-neutral-200 cursor-pointer" title="Rename">
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
              </button>
              {!win.minimized && (
                <button
                  onClick={() => onMinimize(win.id)}
                  className="w-6 h-6 flex items-center justify-center rounded hover:bg-neutral-700 text-neutral-500 hover:text-neutral-200 cursor-pointer"
                  title="Minimize"
                >
                  <svg width="10" height="1" viewBox="0 0 10 1">
                    <rect width="10" height="1" fill="currentColor" />
                  </svg>
                </button>
              )}
              <button
                onClick={() => onClose(win.id)}
                className="w-6 h-6 flex items-center justify-center rounded hover:bg-red-600 text-neutral-500 hover:text-white cursor-pointer"
                title="Close"
              >
                <svg
                  width="8"
                  height="8"
                  viewBox="0 0 10 10"
                  stroke="currentColor"
                  strokeWidth="1.5"
                >
                  <path d="M0 0L10 10M10 0L0 10" />
                </svg>
              </button>
            </div>
          </div>
        );
      })}
    </>
  );
}

function FTConnectionList({
  connections,
  onTransfer,
}: {
  connections: { id: number; name: string; username: string; host: string; port: number }[];
  onTransfer: (conn: { id: number; name: string }, action: "upload" | "download") => void;
}) {
  if (connections.length === 0) {
    return <div className="px-3 py-4 text-xs text-neutral-600 text-center">No SSH connections</div>;
  }
  return (
    <>
      {connections.map((conn) => (
        <div key={conn.id} className="flex items-center gap-2 px-3 py-2.5 hover:bg-neutral-800">
          <div className="flex-1 min-w-0">
            <div className="text-xs text-neutral-200 truncate">{conn.name}</div>
            <div className="text-[10px] text-neutral-500 truncate">{conn.username}@{conn.host}:{conn.port}</div>
          </div>
          <button
            onClick={() => onTransfer(conn, "upload")}
            className="shrink-0 px-2 py-1 text-[10px] bg-blue-600/20 text-blue-400 hover:bg-blue-600 hover:text-white rounded-md transition-colors cursor-pointer"
          >
            Upload
          </button>
          <button
            onClick={() => onTransfer(conn, "download")}
            className="shrink-0 px-2 py-1 text-[10px] bg-green-600/20 text-green-400 hover:bg-green-600 hover:text-white rounded-md transition-colors cursor-pointer"
          >
            Download
          </button>
        </div>
      ))}
    </>
  );
}

export default function Dock() {
  const windows = useWindowStore((s) => s.windows);
  const placingAppId = useWindowStore((s) => s.placingAppId);
  const setPlacingApp = useWindowStore((s) => s.setPlacingApp);
  const clearPlacing = useWindowStore((s) => s.clearPlacing);
  const clearFocus = useWindowStore((s) => s.clearFocus);
  const restoreWindow = useWindowStore((s) => s.restoreWindow);
  const focusWindow = useWindowStore((s) => s.focusWindow);
  const bringToFront = useWindowStore((s) => s.bringToFront);
  const closeWindow = useWindowStore((s) => s.closeWindow);
  const minimizeWindow = useWindowStore((s) => s.minimizeWindow);
  const renameWindow = useWindowStore((s) => s.renameWindow);

  const handleRename = (id: string, currentTitle: string) => {
    const next = window.prompt("Rename window:", currentTitle);
    if (next !== null && next.trim()) renameWindow(id, next.trim());
  };

  const [showWinMenu, setShowWinMenu] = useState(false);
  const [showFileTransfer, setShowFileTransfer] = useState(false);
  const [showBrowserPicker, setShowBrowserPicker] = useState(false);
  const [showSshPicker, setShowSshPicker] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const fileTransferRef = useRef<HTMLDivElement>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  const ftSheetRef = useRef<HTMLDivElement>(null);
  const dragStartY = useRef(0);
  const dragDelta = useRef(0);
  const ftDragStartY = useRef(0);
  const ftDragDelta = useRef(0);

  const [isMobile, setIsMobile] = useState(false);
  const [dockPos, setDockPos] = useState<{ x: number; y: number } | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const dockRef = useRef<HTMLDivElement>(null);
  const isDraggingRef = useRef(false);
  const dragStartRef = useRef({ x: 0, y: 0 });
  const dragOriginRef = useRef({ x: 0, y: 0 });

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 767px)");
    const update = (e?: MediaQueryList | MediaQueryListEvent) => setIsMobile(e?.matches ?? mq.matches);
    update(mq);
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  const handleDockPointerDown = (e: React.PointerEvent) => {
    const el = dockRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const pos = { x: rect.left, y: rect.top };
    setDockPos(pos);
    dragOriginRef.current = { x: pos.x, y: pos.y };
    dragStartRef.current = { x: e.clientX, y: e.clientY };
    isDraggingRef.current = true;
    setIsDragging(true);
    el.setPointerCapture(e.pointerId);
  };

  const handleDockPointerMove = (e: React.PointerEvent) => {
    if (!isDraggingRef.current) return;
    const dx = e.clientX - dragStartRef.current.x;
    const dy = e.clientY - dragStartRef.current.y;
    const el = dockRef.current;
    if (!el) return;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const dw = el.offsetWidth;
    const dh = el.offsetHeight;
    setDockPos({
      x: Math.max(0, Math.min(vw - dw, dragOriginRef.current.x + dx)),
      y: Math.max(0, Math.min(vh - dh, dragOriginRef.current.y + dy)),
    });
  };

  const handleDockPointerUp = (e: React.PointerEvent) => {
    if (!isDraggingRef.current) return;
    isDraggingRef.current = false;
    setIsDragging(false);
    try {
      dockRef.current?.releasePointerCapture(e.pointerId);
    } catch {}
  };

  const sshConnections = useSSHStore((s) => s.connections);
  const fetchConnections = useSSHStore((s) => s.fetchConnections);

  useEffect(() => {
    fetchConnections();
  }, [fetchConnections]);

  const handleSheetPointerDown = (e: React.PointerEvent) => {
    if (e.target instanceof HTMLButtonElement) return;
    dragStartY.current = e.clientY;
    dragDelta.current = 0;
    sheetRef.current?.setPointerCapture(e.pointerId);
  };
  const handleSheetPointerMove = (e: React.PointerEvent) => {
    if (!sheetRef.current) return;
    const delta = Math.max(0, e.clientY - dragStartY.current);
    dragDelta.current = delta;
    sheetRef.current.style.transform = `translateY(${delta}px)`;
  };
  const handleSheetPointerUp = (e: React.PointerEvent) => {
    if (!sheetRef.current) return;
    if (dragDelta.current > 80) setShowWinMenu(false);
    sheetRef.current.style.transform = "";
    try {
      sheetRef.current.releasePointerCapture(e.pointerId);
    } catch {}
  };

  const handleFtSheetPointerDown = (e: React.PointerEvent) => {
    if (e.target instanceof HTMLButtonElement) return;
    ftDragStartY.current = e.clientY;
    ftDragDelta.current = 0;
    ftSheetRef.current?.setPointerCapture(e.pointerId);
  };
  const handleFtSheetPointerMove = (e: React.PointerEvent) => {
    if (!ftSheetRef.current) return;
    const delta = Math.max(0, e.clientY - ftDragStartY.current);
    ftDragDelta.current = delta;
    ftSheetRef.current.style.transform = `translateY(${delta}px)`;
  };
  const handleFtSheetPointerUp = (e: React.PointerEvent) => {
    if (!ftSheetRef.current) return;
    if (ftDragDelta.current > 80) setShowFileTransfer(false);
    ftSheetRef.current.style.transform = "";
    try {
      ftSheetRef.current.releasePointerCapture(e.pointerId);
    } catch {}
  };

  const focusMode = useSettingsStore((s) => s.focusMode);
  const focusModeWindowId = useSettingsStore((s) => s.focusModeWindowId);
  const setFocusMode = useSettingsStore((s) => s.setFocusMode);

  const hasWindows = windows.length > 0;
  const isSshPlacing = placingAppId === "ssh";
  const isDockerPlacing = placingAppId === "docker";
  const isBrowserPlacing =
    placingAppId !== null && BROWSER_DOCK_APPS.includes(placingAppId);
  const isBrowserOpen = windows.some((w) =>
    BROWSER_DOCK_APPS.includes(w.appId),
  );

  const handleRestore = (winId: string) => {
    restoreWindow(winId);
    focusWindow(winId);
    bringToFront(winId);
    centerWindowById(winId);
  };

  const handleFocusFromMenu = (win: (typeof windows)[0]) => {
    if (win.minimized) {
      handleRestore(win.id);
    } else {
      clearFocus();
      focusWindow(win.id);
      centerWindowById(win.id);
    }
    setShowWinMenu(false);
  };

  const handleToggleFocusMode = () => {
    if (focusMode && focusModeWindowId) {
      const activeFocusWindow = windows.find((w) => w.id === focusModeWindowId);
      if (activeFocusWindow) {
        focusWindow(activeFocusWindow.id);
      }
    }
    setFocusMode(!focusMode);
  };

  const handleTransfer = useCallback((conn: { id: number; name: string }, action: "upload" | "download") => {
    setShowFileTransfer(false);
    if (action === "upload") {
      useFileTransferStore.getState().openUpload(conn);
    } else {
      useFileTransferStore.getState().openDownload(conn);
    }
  }, []);

  const handleBrowserLauncher = () => {
    setShowWinMenu(false);
    setShowFileTransfer(false);
    setShowSshPicker(false);
    if (isBrowserPlacing) {
      clearPlacing();
      setShowBrowserPicker(false);
      return;
    }
    setShowBrowserPicker((v) => !v);
  };

  const handleBrowserChoice = (appId: (typeof BROWSER_DOCK_APPS)[number]) => {
    setShowBrowserPicker(false);
    setPlacingApp(appId);
  };

  const handleDockerLauncher = () => {
    setShowWinMenu(false);
    setShowFileTransfer(false);
    setShowBrowserPicker(false);
    setShowSshPicker(false);
    if (isDockerPlacing) {
      clearPlacing();
      return;
    }
    setPlacingApp("docker");
  };

  const handleSshLauncher = () => {
    setShowWinMenu(false);
    setShowFileTransfer(false);
    setShowBrowserPicker(false);
    if (isSshPlacing) {
      clearPlacing();
      setShowSshPicker(false);
      return;
    }
    if (sshConnections.length > 1) {
      setShowSshPicker((v) => !v);
      return;
    }
    if (sshConnections.length === 1) {
      const conn = sshConnections[0];
      setShowSshPicker(false);
      setPlacingApp("ssh", {
        connectionId: conn.id,
        title: conn.name,
      });
      return;
    }
    setShowSshPicker(false);
    setPlacingApp("ssh");
  };

  const handleSshChoice = (conn: SSHConnection) => {
    setShowSshPicker(false);
    setPlacingApp("ssh", {
      connectionId: conn.id,
      title: conn.name,
    });
  };

  useEffect(() => {
    if (!showBrowserPicker) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setShowBrowserPicker(false);
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [showBrowserPicker]);

  useEffect(() => {
    if (!showSshPicker) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setShowSshPicker(false);
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [showSshPicker]);

  // Close menus on outside click
  useEffect(() => {
    if (!showWinMenu && !showFileTransfer) return;
    const handler = (e: MouseEvent) => {
      if (sheetRef.current?.contains(e.target as Node)) return;
      if (ftSheetRef.current?.contains(e.target as Node)) return;
      if (menuRef.current && !menuRef.current.contains(e.target as Node) && showWinMenu) {
        setShowWinMenu(false);
      }
      if (fileTransferRef.current && !fileTransferRef.current.contains(e.target as Node) && showFileTransfer) {
        setShowFileTransfer(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showWinMenu, showFileTransfer]);

  return (
    <>
      {showBrowserPicker && (
        <div className="fixed inset-0 z-[10020] flex items-center justify-center p-4">
          <button
            type="button"
            aria-label="Close browser picker"
            className="absolute inset-0 bg-black/55"
            onClick={() => setShowBrowserPicker(false)}
          />
          <div className="relative z-[10021] w-full max-w-sm rounded-2xl border border-neutral-700 bg-neutral-900/95 p-4 shadow-2xl backdrop-blur-md">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-neutral-100">
                  Open Browser
                </h2>
                <p className="mt-1 text-xs text-neutral-400">
                  Pick browser mode, then place window on canvas.
                </p>
              </div>
              <button
                onClick={() => setShowBrowserPicker(false)}
                className="flex h-8 w-8 items-center justify-center rounded-md text-neutral-500 transition-colors cursor-pointer hover:bg-neutral-800 hover:text-neutral-200"
                title="Close"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M18 6L6 18M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="mt-4 space-y-2">
              {BROWSER_CHOICES.map((choice) => {
                const app = registry[choice.appId];
                return (
                  <button
                    key={choice.appId}
                    onClick={() => handleBrowserChoice(choice.appId)}
                    className="flex w-full items-start gap-3 rounded-xl border border-neutral-700 bg-neutral-800/70 px-3 py-3 text-left transition-colors cursor-pointer hover:border-blue-500 hover:bg-neutral-800"
                  >
                    <span className="mt-0.5 text-neutral-200">{app.icon}</span>
                    <span className="min-w-0">
                      <span className="block text-sm font-medium text-neutral-100">
                        {choice.label}
                      </span>
                      <span className="mt-1 block text-xs text-neutral-400">
                        {choice.description}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {showSshPicker && (
        <div className="fixed inset-0 z-[10020] flex items-center justify-center p-4">
          <button
            type="button"
            aria-label="Close SSH picker"
            className="absolute inset-0 bg-black/55"
            onClick={() => setShowSshPicker(false)}
          />
          <div className="relative z-[10021] w-full max-w-sm rounded-2xl border border-neutral-700 bg-neutral-900/95 p-4 shadow-2xl backdrop-blur-md">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-neutral-100">
                  Open SSH
                </h2>
                <p className="mt-1 text-xs text-neutral-400">
                  Pick connection, then place terminal on canvas.
                </p>
              </div>
              <button
                onClick={() => setShowSshPicker(false)}
                className="flex h-8 w-8 items-center justify-center rounded-md text-neutral-500 transition-colors cursor-pointer hover:bg-neutral-800 hover:text-neutral-200"
                title="Close"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M18 6L6 18M6 6l12 12" />
                </svg>
              </button>
            </div>
            <SSHConnectionChoices
              connections={sshConnections}
              onSelect={handleSshChoice}
            />
          </div>
        </div>
      )}

      {/* Mobile backdrop + sheet — outside dock bar so backdrop covers it */}
      {showWinMenu && (
        <div className="sm:hidden">
          <div
            className="fixed inset-0 bg-black/50 z-[10000]"
            onClick={() => setShowWinMenu(false)}
          />
          <div
            ref={sheetRef}
            className="fixed bottom-0 left-0 right-0 z-[10001] bg-neutral-900/95 backdrop-blur-md border border-neutral-700 rounded-t-2xl shadow-2xl flex flex-col max-h-[70vh] transition-transform touch-none animate-[slideUp_0.3s_ease-out]"
          >
            <div
              className="w-full flex justify-center pt-3 pb-2 cursor-grab active:cursor-grabbing"
              onPointerDown={handleSheetPointerDown}
              onPointerMove={handleSheetPointerMove}
              onPointerUp={handleSheetPointerUp}
            >
              <div className="w-10 h-1 bg-neutral-600 rounded-full" />
            </div>
            <div className="flex items-center justify-between border-b border-neutral-700 px-3 py-2.5 shrink-0">
              <h2 className="text-[13px] font-semibold text-neutral-200">
                Windows ({windows.length})
              </h2>
              <button
                onClick={() => setShowWinMenu(false)}
                className="flex h-6 w-6 items-center justify-center rounded-md text-neutral-400 transition-colors cursor-pointer hover:bg-neutral-800 hover:text-neutral-200"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M18 6L6 18M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="overflow-y-auto pb-6 min-h-0 flex-1">
              <WindowList
                windows={windows}
                onFocus={handleFocusFromMenu}
                onMinimize={minimizeWindow}
                onClose={closeWindow}
                onRename={handleRename}
                mobile
              />
            </div>
          </div>
        </div>
      )}

      {/* Mobile backdrop + sheet for File Transfer */}
      {showFileTransfer && (
        <div className="sm:hidden">
          <div
            className="fixed inset-0 bg-black/50 z-[10000]"
            onClick={() => setShowFileTransfer(false)}
          />
          <div
            ref={ftSheetRef}
            className="fixed bottom-0 left-0 right-0 z-[10001] bg-neutral-900/95 backdrop-blur-md border border-neutral-700 rounded-t-2xl shadow-2xl flex flex-col max-h-[70vh] transition-transform touch-none animate-[slideUp_0.3s_ease-out]"
          >
            <div
              className="w-full flex justify-center pt-3 pb-2 cursor-grab active:cursor-grabbing"
              onPointerDown={handleFtSheetPointerDown}
              onPointerMove={handleFtSheetPointerMove}
              onPointerUp={handleFtSheetPointerUp}
            >
              <div className="w-10 h-1 bg-neutral-600 rounded-full" />
            </div>
            <div className="flex items-center justify-between border-b border-neutral-700 px-3 py-2.5 shrink-0">
              <h2 className="text-[13px] font-semibold text-neutral-200">
                File Transfer
              </h2>
              <button
                onClick={() => setShowFileTransfer(false)}
                className="flex h-6 w-6 items-center justify-center rounded-md text-neutral-400 transition-colors cursor-pointer hover:bg-neutral-800 hover:text-neutral-200"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M18 6L6 18M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="overflow-y-auto pb-6 min-h-0 flex-1">
              <FTConnectionList
                connections={sshConnections}
                onTransfer={handleTransfer}
              />
            </div>
          </div>
        </div>
      )}

      <div
        ref={dockRef}
        className={`flex items-center p-3 sm:p-4 ${
          isMobile ? 'touch-none select-none cursor-grab active:cursor-grabbing' : ''
        }`}
        style={{
          position: 'fixed',
          zIndex: 9999,
          ...(isMobile && dockPos
            ? { left: dockPos.x, top: dockPos.y }
            : { bottom: 4, left: '50%', transform: 'translateX(-50%)' }
          ),
        }}
        onPointerDown={isMobile ? handleDockPointerDown : undefined}
        onPointerMove={isMobile ? handleDockPointerMove : undefined}
        onPointerUp={isMobile ? handleDockPointerUp : undefined}
      >
      <div className={`flex gap-1 sm:gap-2 p-0 bg-neutral-900/90 backdrop-blur-md border rounded-xl shadow-2xl items-center transition-colors ${
        isDragging ? 'border-blue-500' : 'border-neutral-700'
      }`}>
        {DOCK_APPS.map((appId, index) => {
          const app = registry[appId];
          const isOpen = windows.some((w) => w.appId === appId);
          const isPlacing = placingAppId === appId;
          return (
            <div key={appId} className="contents">
              {index === 1 && (
                <button
                  onClick={handleBrowserLauncher}
                  className={`flex flex-col items-center gap-0.5 px-1.5 py-1.5 rounded-lg transition-colors cursor-pointer group ${
                    isBrowserPlacing
                      ? "bg-blue-600 text-white"
                      : showBrowserPicker
                        ? "bg-neutral-700 text-white"
                        : "text-neutral-200 hover:bg-neutral-800 hover:text-white"
                  }`}
                  title="Browser"
                >
                  <span className="text-base leading-none">
                    {registry.devBrowser.icon}
                  </span>
                  {isBrowserOpen && (
                    <span
                      className={`w-1 h-1 rounded-full ${
                        isBrowserPlacing ? "bg-white" : "bg-blue-400"
                      }`}
                    />
                  )}
                </button>
              )}
              <button
                onClick={() => {
                  setShowBrowserPicker(false);
                  if (appId === "ssh") {
                    handleSshLauncher();
                    return;
                  }
                  if (appId === "docker") {
                    handleDockerLauncher();
                    return;
                  }
                  setShowSshPicker(false);
                  if (isPlacing) {
                    clearPlacing();
                  } else {
                    setPlacingApp(appId);
                  }
                }}
                className={`flex flex-col items-center gap-0.5 px-1.5 py-1.5 rounded-lg transition-colors cursor-pointer group ${
                  isPlacing
                    ? "bg-blue-600 text-white"
                    : "text-neutral-200 hover:bg-neutral-800 hover:text-white"
                }`}
                title={app.title}
              >
                <span className="text-base leading-none">{app.icon}</span>
                {isOpen && (
                  <span
                    className={`w-1 h-1 rounded-full ${
                      isPlacing ? "bg-white" : "bg-blue-400"
                    }`}
                  />
                )}
              </button>
            </div>
          );
        })}
          {hasWindows && (<>
          <div className="w-px h-6 sm:h-8 bg-neutral-700 mx-0.5 sm:mx-1" />
            <div className="relative" ref={menuRef}>
              <button
                onClick={() => { setShowWinMenu((v) => !v); setShowFileTransfer(false); setShowBrowserPicker(false); }}
                className={`flex flex-col items-center gap-0.5 px-1.5 py-1.5 rounded-lg transition-colors cursor-pointer group ${
                  showWinMenu
                    ? "bg-neutral-700 text-white"
                    : "hover:bg-neutral-800 text-neutral-400 hover:text-neutral-200"
                }`}
                title="Windows"
              >
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <rect x="3" y="3" width="7" height="7" rx="1" />
                  <rect x="14" y="3" width="7" height="7" rx="1" />
                  <rect x="3" y="14" width="7" height="7" rx="1" />
                  <rect x="14" y="14" width="7" height="7" rx="1" />
                </svg>
              </button>

              {showWinMenu && (
                /* Desktop: upward dropdown only */
                <div className="hidden sm:block absolute bottom-full mb-2 left-1/2 -translate-x-1/2 w-64 bg-neutral-900 border border-neutral-700 rounded-xl shadow-2xl overflow-hidden z-[9999]">
                  <div className="px-3 py-2 border-b border-neutral-800 text-xs text-neutral-500 font-medium">
                    Open Windows ({windows.length})
                  </div>
                  <div className="max-h-72 overflow-y-auto">
                    <WindowList
                      windows={windows}
                      onFocus={handleFocusFromMenu}
                      onMinimize={minimizeWindow}
                      onClose={closeWindow}
                      onRename={handleRename}
                    />
                  </div>
                </div>
              )}
            </div>
          </>
        )}
        {/* File transfer button */}
        <div className="relative" ref={fileTransferRef}>
          <button
            onClick={() => { setShowFileTransfer((v) => !v); setShowWinMenu(false); setShowBrowserPicker(false); }}
            className={`flex flex-col items-center gap-0.5 px-1.5 py-1.5 rounded-lg transition-colors cursor-pointer group ${
              showFileTransfer
                ? "bg-blue-600 text-white"
                : "text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200"
            }`}
            title="File Transfer"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
          </button>

          {/* Desktop panel */}
          {showFileTransfer && (
            <div className="hidden sm:block absolute bottom-full mb-2 left-1/2 -translate-x-1/2 w-72 bg-neutral-900 border border-neutral-700 rounded-xl shadow-2xl overflow-hidden z-[9999]">
              <div className="px-3 py-2 border-b border-neutral-800 text-xs text-neutral-500 font-medium">
                File Transfer
              </div>
              <div className="max-h-72 overflow-y-auto">
                <FTConnectionList
                  connections={sshConnections}
                  onTransfer={handleTransfer}
                />
              </div>
            </div>
          )}
        </div>

        {/* Focus mode toggle */}
        <button
          onClick={handleToggleFocusMode}
          title={focusMode ? "Switch to canvas mode" : "Focus mode (terminal only)"}
          className={`flex flex-col items-center gap-0.5 px-1.5 py-1.5 rounded-lg transition-colors cursor-pointer group ${
            focusMode
              ? "bg-blue-600 text-white"
              : "text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200"
          }`}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <path d="M7 8l4 4-4 4" />
            <path d="M13 16h4" />
          </svg>
        </button>
      </div>
    </div>
    </>
  );
}
