"use client";

import { useCallback, useRef, useState } from "react";
import SSHPanel from "./SSHPanel";
import AgentPanel from "./AgentPanel";
import SettingsPanel from "./SettingsPanel";

const ROOT_ITEMS = [
  {
    id: "ssh",
    label: "SSH Manager",
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 17l6-6-6-6" />
        <path d="M10 17l6-6-6-6" />
      </svg>
    ),
  },
  {
    id: "agents",
    label: "Agents",
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2" y="3" width="20" height="14" rx="2" />
        <path d="M8 21h8M12 17v4" />
        <circle cx="12" cy="10" r="2" />
      </svg>
    ),
  },
  {
    id: "settings",
    label: "Settings",
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09a1.65 1.65 0 00-1-1.51 1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83 0 2 2 0 010-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09a1.65 1.65 0 001.51-1 1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 010-2.83 2 2 0 012.83 0l.06.06a1.65 1.65 0 001.82.33h.01A1.65 1.65 0 009 3.09V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51h.01a1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 0 2 2 0 010 2.83l-.06.06a1.65 1.65 0 00-.33 1.82v.01a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" />
      </svg>
    ),
  },
] as const;

export default function Sidebar() {
  const [isOpen, setIsOpen] = useState(false);
  const [activePage, setActivePage] = useState<
    "root" | "ssh" | "agents" | "settings" | "settings-terminal"
  >("root");
  const sheetRef = useRef<HTMLDivElement>(null);
  const startY = useRef(0);
  const startTransform = useRef(0);

  const togglePanel = () => {
    setIsOpen((prev) => {
      const next = !prev;
      if (next) setActivePage("root");
      return next;
    });
  };

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    if (e.target instanceof HTMLButtonElement) return;
    startY.current = e.clientY;
    startTransform.current = 0;
    sheetRef.current?.setPointerCapture(e.pointerId);
  }, []);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!sheetRef.current) return;
    const delta = e.clientY - startY.current;
    const newTransform = Math.max(0, delta);
    startTransform.current = newTransform;
    sheetRef.current.style.transform = `translateY(${newTransform}px)`;
  }, []);

  const handlePointerUp = useCallback((e: React.PointerEvent) => {
    if (!sheetRef.current) return;
    if (startTransform.current > 100) {
      setIsOpen(false);
      setActivePage("root");
    }
    sheetRef.current.style.transform = "";
    try {
      sheetRef.current.releasePointerCapture(e.pointerId);
    } catch {}
  }, []);

  const title =
    activePage === "root"
      ? "Menu"
      : activePage === "ssh"
        ? "SSH Manager"
        : activePage === "agents"
          ? "Agents"
          : activePage === "settings"
            ? "Settings"
            : "Terminal";

  const handleClose = () => {
    setIsOpen(false);
    setActivePage("root");
  };

  const handleBack = () => {
    if (activePage === "settings-terminal") {
      setActivePage("settings");
      return;
    }
    if (activePage === "ssh" || activePage === "agents" || activePage === "settings") {
      setActivePage("root");
    }
  };

  return (
    <div className="fixed top-4 left-4 z-[10000] flex items-start gap-0">
      <button
        onClick={togglePanel}
        className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 shadow-2xl backdrop-blur-md transition-colors cursor-pointer ${
          isOpen
            ? "border-blue-500 bg-blue-600 text-white"
            : "border-neutral-700 bg-neutral-900/90 text-neutral-300 hover:bg-neutral-800"
        }`}
        title="Open menu"
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
          <path d="M4 6h16" />
          <path d="M4 12h16" />
          <path d="M4 18h16" />
        </svg>
        <span className="text-[11px] font-medium">Menu</span>
      </button>

      {isOpen && (
        <>
          <div
            className="fixed inset-0 bg-black/50 z-[9999] sm:hidden"
            onClick={handleClose}
          />
          <div
            ref={sheetRef}
            className="fixed bottom-0 left-0 right-0 sm:top-4 sm:left-4 sm:bottom-auto sm:right-auto sm:ml-2.5 w-full sm:w-[28rem] bg-neutral-900/95 backdrop-blur-md border border-neutral-700 rounded-t-2xl sm:rounded-xl shadow-2xl overflow-hidden sm:max-h-[62vh] max-h-[70vh] flex flex-col transition-transform touch-none z-[10000] animate-[slideUp_0.3s_ease-out] sm:animate-none"
          >
            <div
              className="sm:hidden w-full flex justify-center pt-3 pb-2 cursor-grab active:cursor-grabbing"
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
            >
              <div className="w-10 h-1 bg-neutral-600 rounded-full" />
            </div>
            <div className="flex items-center justify-between border-b border-neutral-700 px-3 py-2.5 shrink-0">
              <div className="flex items-center gap-1.5">
                {activePage !== "root" && (
                  <button
                    onClick={handleBack}
                    className="flex h-6 w-6 items-center justify-center rounded-md text-neutral-400 transition-colors cursor-pointer hover:bg-neutral-800 hover:text-neutral-200"
                    title="Back"
                  >
                    <svg
                      width="14"
                      height="14"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M15 18l-6-6 6-6" />
                    </svg>
                  </button>
                )}
                <h2 className="text-[13px] font-semibold text-neutral-200">
                  {title}
                </h2>
              </div>
              <button
                onClick={handleClose}
                className="flex h-6 w-6 items-center justify-center rounded-md text-neutral-400 transition-colors cursor-pointer hover:bg-neutral-800 hover:text-neutral-200"
              >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M18 6L6 18M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto">
              {activePage === "root" && (
                <div className="p-2.5">
                  <div className="space-y-1.5">
                    {ROOT_ITEMS.map((item) => (
                      <button
                        key={item.id}
                        onClick={() => setActivePage(item.id)}
                        className="flex w-full items-center justify-between rounded-lg border border-neutral-700 bg-neutral-800/70 px-3 py-2.5 text-left transition-colors cursor-pointer hover:border-neutral-600 hover:bg-neutral-800"
                      >
                        <div className="flex items-center gap-2.5">
                          <span className="scale-90 text-neutral-300">
                            {item.icon}
                          </span>
                          <span className="text-[13px] font-medium text-neutral-100">
                            {item.label}
                          </span>
                        </div>
                        <svg
                          width="14"
                          height="14"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          className="shrink-0 text-neutral-500"
                        >
                          <path d="M9 18l6-6-6-6" />
                        </svg>
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {activePage === "ssh" && <SSHPanel />}
              {activePage === "agents" && <AgentPanel />}
              {(activePage === "settings" ||
                activePage === "settings-terminal") && (
                <SettingsPanel
                  currentPage={
                    activePage === "settings-terminal" ? "terminal" : "root"
                  }
                  onOpenTerminal={() => setActivePage("settings-terminal")}
                />
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
