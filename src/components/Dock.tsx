"use client";

import registry from "@/apps/registry";
import { useWindowStore } from "@/stores/useWindowStore";
import type { AppId } from "@/types";

const DOCK_APPS: AppId[] = ["notes", "browser", "devBrowser", "ssh"];

export default function Dock() {
  const windows = useWindowStore((s) => s.windows);
  const placingAppId = useWindowStore((s) => s.placingAppId);
  const setPlacingApp = useWindowStore((s) => s.setPlacingApp);
  const clearPlacing = useWindowStore((s) => s.clearPlacing);
  const focusLastWindow = useWindowStore((s) => s.focusLastWindow);
  const clearFocus = useWindowStore((s) => s.clearFocus);
  const restoreWindow = useWindowStore((s) => s.restoreWindow);
  const focusWindow = useWindowStore((s) => s.focusWindow);
  const bringToFront = useWindowStore((s) => s.bringToFront);

  const minimized = windows.filter((w) => w.minimized);
  const hasWindows = windows.length > 0;

  const handleRestore = (winId: string) => {
    restoreWindow(winId);
    focusWindow(winId);
    bringToFront(winId);
  };

  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[9999] flex items-center p-3 sm:p-4">
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
              className={`flex flex-col items-center gap-0.5 sm:gap-1 px-2 sm:px-4 py-2 sm:py-2.5 rounded-lg transition-colors cursor-pointer group ${
                isPlacing ? "bg-blue-600 text-white" : "text-neutral-200 hover:bg-neutral-800 hover:text-white"
              }`}
              title={app.title}
            >
              <span className="text-xl sm:text-2xl leading-none">{app.icon}</span>
              <span
                className={`text-[8px] sm:text-[10px] transition-colors hidden sm:block ${
                  isPlacing
                    ? "text-blue-200"
                    : "text-neutral-500 group-hover:text-neutral-300"
                }`}
              >
                {app.title}
              </span>
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
            <button
              onClick={() => {
                clearFocus();
                focusLastWindow();
              }}
              className="flex flex-col items-center gap-0.5 sm:gap-1 px-2 sm:px-4 rounded-lg hover:bg-neutral-800 transition-colors cursor-pointer group"
              title="Focus last window"
            >
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="text-neutral-400 group-hover:text-neutral-200"
              >
                <circle cx="12" cy="12" r="3" />
                <path d="M12 2v4M12 18v4M2 12h4M18 12h4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
              </svg>
              <span className="text-[8px] sm:text-[10px] text-neutral-500 group-hover:text-neutral-300 transition-colors hidden sm:block">
                Focus
              </span>
            </button>
          </>
        )}
      </div>

{minimized.length > 0 && (
        <div className="flex gap-1 sm:gap-1 ml-1 sm:ml-2 px-2 sm:px-3 py-2 sm:py-2.5 bg-neutral-900/90 backdrop-blur-md border border-neutral-700 rounded-xl shadow-2xl items-center">
          {minimized.map((win) => {
            const app = registry[win.appId];
            if (!app) return null;
            return (
              <button
                key={win.id}
                onClick={() => handleRestore(win.id)}
                className="flex items-center gap-1 px-1.5 sm:px-2 py-1 rounded-md hover:bg-neutral-800 transition-colors cursor-pointer group min-w-0 text-neutral-200"
                title={(win.metadata?.title as string) || app.title}
              >
                <span className="text-sm leading-none">{app.icon}</span>
                <span className="text-[9px] sm:text-[11px] text-neutral-400 group-hover:text-neutral-200 truncate max-w-[60px] sm:max-w-[80px]">
                  {(win.metadata?.title as string) || app.title}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
