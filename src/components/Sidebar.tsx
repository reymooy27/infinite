"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import SSHPanel from "./SSHPanel";
import AgentPanel from "./AgentPanel";
import SettingsPanel from "./SettingsPanel";
import ProjectsPanel from "./ProjectsPanel";
import { useProjectStore } from "@/stores/useProjectStore";

type SidebarPage =
  | "root"
  | "projects"
  | "ssh"
  | "agents"
  | "settings"
  | "settings-terminal"
  | "settings-api-management";

const ROOT_ITEMS = [
  {
    id: "projects",
    label: "Projects",
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M2 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H4a2 2 0 01-2-2V7z" />
      </svg>
    ),
  },
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

export default function Sidebar({
  openSection,
  onOpenSectionConsumed,
}: {
  openSection?: string | null;
  onOpenSectionConsumed?: () => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [activePage, setActivePage] = useState<SidebarPage>("root");
  const activeProjectName = useProjectStore((s) => {
    const p = s.projects.find((p) => p.id === s.activeProjectId);
    return p?.name ?? null;
  });
  const sheetRef = useRef<HTMLDivElement>(null);
  const startY = useRef(0);
  const startTransform = useRef(0);

  const isSidebarPage = (value: string): value is SidebarPage =>
    value === "root" ||
    value === "projects" ||
    value === "ssh" ||
    value === "agents" ||
    value === "settings" ||
    value === "settings-terminal" ||
    value === "settings-api-management";

  // Open to a specific section on external request
  useEffect(() => {
    if (openSection && isSidebarPage(openSection)) {
      const frame = requestAnimationFrame(() => {
        setActivePage(openSection);
        setIsOpen(true);
        onOpenSectionConsumed?.();
      });
      return () => cancelAnimationFrame(frame);
    }
  }, [openSection, onOpenSectionConsumed]);

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

  const handleClose = useCallback(() => {
    setIsOpen(false);
    setActivePage("root");
  }, []);

  useEffect(() => {
    if (!isOpen) return;

    const handlePointerDownOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      if (sheetRef.current && !sheetRef.current.contains(target)) {
        handleClose();
      }
    };

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        handleClose();
      }
    };

    document.addEventListener("mousedown", handlePointerDownOutside, true);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handlePointerDownOutside, true);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [handleClose, isOpen]);

  const title =
    activePage === "root"
      ? "Menu"
      : activePage === "projects"
        ? "Projects"
        : activePage === "ssh"
          ? "SSH Manager"
          : activePage === "agents"
            ? "Agents"
            : activePage === "settings"
              ? "Settings"
              : activePage === "settings-terminal"
                ? "Terminal"
                : "API Management";

  const handleBack = () => {
    if (
      activePage === "settings-terminal" ||
      activePage === "settings-api-management"
    ) {
      setActivePage("settings");
      return;
    }
    if (activePage === "ssh" || activePage === "agents" || activePage === "settings" || activePage === "projects") {
      setActivePage("root");
    }
  };

  return (
    <>
      {isOpen && (
        <>
          <div
            className="fixed inset-0 bg-black/50 z-[9999] sm:hidden"
            onClick={handleClose}
          />
          <div className="sm:fixed sm:top-4 sm:left-4 sm:z-[10000]">
            <div
              ref={sheetRef}
              className="fixed bottom-0 left-0 right-0 sm:absolute sm:top-full sm:left-0 sm:right-auto sm:bottom-auto sm:mt-3 w-full sm:w-[28rem] bg-neutral-900/95 backdrop-blur-md border border-neutral-700 rounded-t-2xl sm:rounded-xl shadow-2xl overflow-hidden sm:max-h-[62vh] max-h-[70vh] flex flex-col transition-transform touch-none z-[10000] animate-[slideUp_0.3s_ease-out] sm:animate-[fadeSlideIn_0.12s_ease-out]"
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
                            <div className="flex flex-col">
                              <span className="text-[13px] font-medium text-neutral-100">
                                {item.label}
                              </span>
                              {item.id === "projects" && activeProjectName && (
                                <span className="text-[11px] text-neutral-500">
                                  {activeProjectName}
                                </span>
                              )}
                            </div>
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
                {activePage === "projects" && <ProjectsPanel />}
                {activePage === "ssh" && <SSHPanel />}
                {activePage === "agents" && <AgentPanel />}
                {(activePage === "settings" ||
                  activePage === "settings-terminal" ||
                  activePage === "settings-api-management") && (
                  <SettingsPanel
                    currentPage={
                      activePage === "settings-terminal"
                        ? "terminal"
                        : activePage === "settings-api-management"
                          ? "api-management"
                          : "root"
                    }
                    onOpenTerminal={() => setActivePage("settings-terminal")}
                    onOpenApiManagement={() =>
                      setActivePage("settings-api-management")
                    }
                  />
                )}
              </div>
            </div>
          </div>
        </>
      )}
    </>
  );
}
