"use client";

import { useEffect, useRef, useState } from "react";

import registry from "@/apps/registry";
import { useWindowStore } from "@/stores/useWindowStore";
import { canvasTransform } from "@/lib/canvasTransform";
import type { AppId } from "@/types";

const DOCK_APPS: AppId[] = ["notes", "devBrowser", "ssh"];

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
  const menuRef = useRef<HTMLDivElement>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  const dragStartY = useRef(0);
  const dragDelta = useRef(0);

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

  const minimized = windows.filter((w) => w.minimized);
  const hasWindows = windows.length > 0;

  const handleRestore = (winId: string) => {
    restoreWindow(winId);
    focusWindow(winId);
    bringToFront(winId);
    const win = windows.find((w) => w.id === winId);
    if (win) canvasTransform.centerOnWindow(win);
  };

  const handleFocusFromMenu = (win: (typeof windows)[0]) => {
    if (win.minimized) {
      handleRestore(win.id);
    } else {
      clearFocus();
      focusWindow(win.id);
      canvasTransform.centerOnWindow(win);
    }
    setShowWinMenu(false);
  };

  // Close menu on outside click (desktop only — mobile uses backdrop)
  useEffect(() => {
    if (!showWinMenu) return;
    const handler = (e: MouseEvent) => {
      if (sheetRef.current?.contains(e.target as Node)) return;
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setShowWinMenu(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showWinMenu]);

  return (
    <>
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
      <div className="fixed bottom-1 left-1/2 -translate-x-1/2 z-[9999] flex items-center p-3 sm:p-4">
      <div className="flex gap-1 sm:gap-2 p-0 bg-neutral-900/90 backdrop-blur-md border border-neutral-700 rounded-xl shadow-2xl items-center">
        {DOCK_APPS.map((appId) => {
          const app = registry[appId];
          const isOpen = windows.some((w) => w.appId === appId);
          const isPlacing = placingAppId === appId;
          return (
            <button
              key={appId}
              onClick={() => {
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
          );
        })}
        {hasWindows && (
          <>
            <div className="w-px h-6 sm:h-8 bg-neutral-700 mx-0.5 sm:mx-1" />
            {/* Window manager button */}
            <div className="relative" ref={menuRef}>
              <button
                onClick={() => setShowWinMenu((v) => !v)}
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
      </div>

      {minimized.length > 0 && (
        <div className="flex gap-1 sm:gap-1 ml-1 sm:ml-2 px-2 sm:px-3 py-2 sm:py-2.5 bg-neutral-900/90 backdrop-blur-md border border-neutral-700 rounded-xl shadow-2xl items-center">
          {minimized.map((win) => {
            const app = registry[win.appId];
            if (!app) return null;
            const title = (win.metadata?.title as string) || app.title;
            return (
              <button
                key={win.id}
                onClick={() => handleRestore(win.id)}
                className="flex items-center gap-1.5 px-1.5 sm:px-2 py-1 rounded-md hover:bg-neutral-800 transition-colors cursor-pointer group min-w-0 text-neutral-200 max-w-[120px]"
                title={title}
              >
                <span className="text-base leading-none shrink-0">
                  {app.icon}
                </span>
                <span className="text-xs text-neutral-400 truncate group-hover:text-neutral-200">
                  {title}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
    </>
  );
}
