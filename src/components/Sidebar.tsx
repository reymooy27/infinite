"use client";

import { useState } from "react";
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

  const togglePanel = (id: string) => {
    setActivePanel((prev) => (prev === id ? null : id));
  };

  return (
    <div className="fixed top-4 left-4 z-[9999] flex items-start gap-0">
      <div className="flex flex-col gap-1 bg-neutral-900/90 backdrop-blur-md border border-neutral-700 rounded-xl shadow-2xl p-1.5">
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
        <div className="ml-3 w-80 bg-neutral-900/95 backdrop-blur-md border border-neutral-700 rounded-xl shadow-2xl overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-neutral-700">
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
          <SSHPanel />
        </div>
      )}
    </div>
  );
}
