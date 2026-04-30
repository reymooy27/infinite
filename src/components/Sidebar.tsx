"use client";

import { useState, useRef, useCallback } from "react";
import SSHPanel from "./SSHPanel";

const MENU_ITEMS = [
  {
    id: "ssh",
    label: "SSH",
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 17l6-6-6-6" />
        <path d="M10 17l6-6-6-6" />
      </svg>
    ),
  },
];

export default function Sidebar() {
  const [activePanel, setActivePanel] = useState<string | null>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  const startY = useRef(0);
  const startTransform = useRef(0);

  const togglePanel = (id: string) => {
    setActivePanel((prev) => (prev === id ? null : id));
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
      setActivePanel(null);
    }
    sheetRef.current.style.transform = "";
    try {
      sheetRef.current.releasePointerCapture(e.pointerId);
    } catch {}
  }, []);

  return (
    <div className="fixed top-4 left-4 sm:bottom-4 sm:left-1/2 sm:-translate-x-1/2 sm:top-auto z-[9999] flex items-start sm:items-end gap-0">
      <div className="flex flex-col gap-1 bg-neutral-900/90 backdrop-blur-md border border-neutral-700 rounded-xl shadow-2xl p-1.5 sm:hidden">
        {MENU_ITEMS.map((item) => (
          <button
            key={item.id}
            onClick={() => togglePanel(item.id)}
            className={`w-10 h-10 flex items-center justify-center rounded-lg transition-colors cursor-pointer ${
              activePanel === item.id
                ? "bg-blue-600 text-white"
                : "text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800"
            }`}
            title={item.label}
          >
            {item.icon}
          </button>
        ))}
      </div>

      <div className="hidden sm:flex flex-col gap-1 bg-neutral-900/90 backdrop-blur-md border border-neutral-700 rounded-xl shadow-2xl p-1.5">
        {MENU_ITEMS.map((item) => (
          <button
            key={item.id}
            onClick={() => togglePanel(item.id)}
            className={`w-10 h-10 flex items-center justify-center rounded-lg transition-colors cursor-pointer ${
              activePanel === item.id
                ? "bg-blue-600 text-white"
                : "text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800"
            }`}
            title={item.label}
          >
            {item.icon}
          </button>
        ))}
      </div>

      {activePanel === "ssh" && (
        <div
          ref={sheetRef}
          className="fixed sm:absolute bottom-0 sm:bottom-auto left-0 sm:left-auto right-0 sm:right-auto sm:ml-3 sm:mt-0 w-full sm:w-80 bg-neutral-900/95 backdrop-blur-md border border-neutral-700 rounded-t-2xl sm:rounded-xl shadow-2xl overflow-hidden sm:max-h-[60vh] max-h-[70vh] flex flex-col transition-transform touch-none"
          style={{ transform: "translateY(0)" }}
        >
          <div
            className="sm:hidden w-full flex justify-center pt-3 pb-2 cursor-grab active:cursor-grabbing"
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
          >
            <div className="w-10 h-1 bg-neutral-600 rounded-full" />
          </div>
          <div className="flex items-center justify-between px-4 py-3 border-b border-neutral-700 shrink-0">
            <h2 className="text-sm font-semibold text-neutral-200">SSH Connections</h2>
            <button
              onClick={() => setActivePanel(null)}
              className="w-6 h-6 flex items-center justify-center rounded hover:bg-neutral-800 text-neutral-400 hover:text-neutral-200 cursor-pointer transition-colors"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
          </div>
          <div className="flex-1 overflow-hidden">
            <SSHPanel />
          </div>
        </div>
      )}
    </div>
  );
}
