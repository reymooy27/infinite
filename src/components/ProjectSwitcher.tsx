"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { normalizeRouterUsageBaseUrl } from "@/lib/routerUsage";
import { useProjectStore } from "@/stores/useProjectStore";
import { useSettingsStore } from "@/stores/useSettingsStore";
import type { Project } from "@/types";

interface ProjectSwitcherProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  onOpenSection: (section: string) => void;
  embedded?: boolean;
}

const SIDEBAR_SECTIONS = [
  { id: "ssh", label: "SSH Manager", icon: "ssh" },
  { id: "agents", label: "Agents", icon: "agents" },
  { id: "settings", label: "Settings", icon: "settings" },
] as const;

const RECENT_PROJECTS_KEY = "infinite-recent-projects";

function readRecentProjectIds(): string[] {
  if (typeof window === "undefined") return [];

  try {
    const stored = localStorage.getItem(RECENT_PROJECTS_KEY);
    const parsed = stored ? JSON.parse(stored) : [];
    return Array.isArray(parsed)
      ? parsed.filter((id): id is string => typeof id === "string")
      : [];
  } catch {
    return [];
  }
}

function sortProjectsByRecentOpen(projects: Project[], activeProjectId: string | null) {
  const recencyRank = new Map(readRecentProjectIds().map((id, index) => [id, index]));

  return projects
    .filter((project) => project.id !== activeProjectId)
    .sort((a, b) => {
      const aRank = recencyRank.get(a.id) ?? Number.POSITIVE_INFINITY;
      const bRank = recencyRank.get(b.id) ?? Number.POSITIVE_INFINITY;
      return aRank - bRank;
    });
}

type ProjectSwitcherUsageStats = {
  totalPromptTokens?: number;
  recentRequests?: Array<{
    timestamp: string;
    model: string;
    provider?: string;
    promptTokens: number;
    completionTokens: number;
  }>;
};

function formatCompact(value: number | undefined) {
  return new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value ?? 0);
}

function formatDate(value: string | undefined) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("en-US", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function ProjectSwitcher({
  isOpen,
  onOpenChange,
  onOpenSection,
  embedded = false,
}: ProjectSwitcherProps) {
  const projects = useProjectStore((s) => s.projects);
  const activeProjectId = useProjectStore((s) => s.activeProjectId);
  const switchProject = useProjectStore((s) => s.switchProject);
  const routerUsageBaseUrl = useSettingsStore((s) => s.routerUsageBaseUrl);
  const activeProjectName = projects.find((p) => p.id === activeProjectId)?.name ?? null;
  const [switching, setSwitching] = useState<string | null>(null);
  const [focusedIdx, setFocusedIdx] = useState(0);
  const [usageStats, setUsageStats] = useState<ProjectSwitcherUsageStats | null>(null);
  const [usageLoading, setUsageLoading] = useState(false);
  const [usageError, setUsageError] = useState("");
  const dropdownRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node) &&
        buttonRef.current &&
        !buttonRef.current.contains(e.target as Node)
      ) {
        onOpenChange(false);
      }
    };
    document.addEventListener("mousedown", handler, true);
    return () => document.removeEventListener("mousedown", handler, true);
  }, [isOpen, onOpenChange]);

  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onOpenChange(false);
        buttonRef.current?.focus();
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [isOpen, onOpenChange]);

  useEffect(() => {
    if (isOpen) {
      requestAnimationFrame(() => dropdownRef.current?.focus());
    }
  }, [isOpen]);

  const loadUsage = useCallback(
    async (signal?: AbortSignal, silent = false) => {
      if (!silent) {
        setUsageLoading(true);
      }
      setUsageError("");

      try {
        const query = new URLSearchParams({
          period: "today",
          baseUrl: normalizeRouterUsageBaseUrl(routerUsageBaseUrl),
        });
        const res = await fetch(`/api/router-usage/stats?${query.toString()}`, {
          cache: "no-store",
          signal,
        });
        const body = await res.json();

        if (!res.ok) {
          throw new Error(body.error || "Failed to load usage");
        }

        setUsageStats(body);
      } catch (err) {
        if (signal?.aborted) return;
        setUsageError(
          err instanceof Error ? err.message : "Failed to load usage",
        );
      } finally {
        if (!signal?.aborted && !silent) {
          setUsageLoading(false);
        }
      }
    },
    [routerUsageBaseUrl],
  );

  useEffect(() => {
    if (!isOpen) return;

    const controller = new AbortController();
    const initialLoadId = window.setTimeout(() => {
      void loadUsage(controller.signal);
    }, 0);

    const intervalId = window.setInterval(() => {
      void loadUsage(controller.signal, true);
    }, 5000);

    return () => {
      controller.abort();
      window.clearTimeout(initialLoadId);
      window.clearInterval(intervalId);
    };
  }, [isOpen, loadUsage]);

  const nonActiveProjects = sortProjectsByRecentOpen(projects, activeProjectId);
  const recentRequests = (usageStats?.recentRequests ?? []).slice(0, 3);

  const handleSwitch = useCallback(async (id: string) => {
    if (id === activeProjectId || switching) return;
    setSwitching(id);
    await switchProject(id);
    setSwitching(null);
    onOpenChange(false);
  }, [activeProjectId, onOpenChange, switchProject, switching]);

  const handleOpenSection = useCallback((section: string) => {
    onOpenChange(false);
    onOpenSection(section);
  }, [onOpenChange, onOpenSection]);

  const handleDropdownKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const items = nonActiveProjects;
      const totalItems = items.length + SIDEBAR_SECTIONS.length + 2;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setFocusedIdx((prev) => Math.min(prev + 1, totalItems - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setFocusedIdx((prev) => Math.max(prev - 1, 0));
      } else if (e.key === "Enter") {
        e.preventDefault();
        const sectionIdx = items.length;
        const usageIdx = items.length + SIDEBAR_SECTIONS.length;
        const manageIdx = usageIdx + 1;
        if (focusedIdx < items.length) {
          handleSwitch(items[focusedIdx].id);
        } else if (focusedIdx < usageIdx) {
          handleOpenSection(SIDEBAR_SECTIONS[focusedIdx - sectionIdx].id);
        } else if (focusedIdx === usageIdx) {
          handleOpenSection("usage");
        } else {
          handleOpenSection("projects");
        }
      }
    },
    [focusedIdx, handleOpenSection, handleSwitch, nonActiveProjects],
  );

  const handleButtonClick = () => {
    setFocusedIdx(0);
    onOpenChange(!isOpen);
  };

  const itemClassName = (index: number, base = "") =>
    `${base} ${focusedIdx === index ? "bg-neutral-800 text-neutral-100" : ""}`;

  return (
    <div className={embedded ? "relative" : "fixed top-4 left-4 z-[10000]"}>
      <button
        ref={buttonRef}
        onClick={handleButtonClick}
        className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 transition-colors cursor-pointer ${
          embedded ? "" : "shadow-2xl backdrop-blur-md"
        } ${
          isOpen
            ? "border-blue-500 bg-blue-600 text-white"
            : embedded
              ? "border-neutral-700 bg-neutral-800 text-neutral-200 hover:bg-neutral-700 hover:text-white"
              : "border-neutral-700 bg-neutral-900/90 text-neutral-300 hover:bg-neutral-800"
        }`}
        title={isOpen ? "Close menu" : "Switch project"}
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
        <span className="text-[11px] font-medium">
          {activeProjectName ?? "Menu"}
        </span>
      </button>

      {isOpen && (
        <div
          ref={dropdownRef}
          role="listbox"
          tabIndex={-1}
          onKeyDown={handleDropdownKeyDown}
          className="absolute top-full left-0 mt-1.5 w-56 bg-neutral-900 border border-neutral-700 rounded-xl shadow-2xl overflow-hidden animate-[fadeSlideIn_0.12s_ease-out]"
        >
          <div className="max-h-40 overflow-y-auto py-1 sm:max-h-56">
            {projects.length === 0 && (
              <div className="px-3 py-3 text-[12px] text-neutral-500 text-center">
                No projects yet
              </div>
            )}

            {activeProjectId && (() => {
              const active = projects.find((p) => p.id === activeProjectId);
              if (!active) return null;
              return (
                <button
                  key={active.id}
                  role="option"
                  aria-selected
                  onClick={() => onOpenChange(false)}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors cursor-pointer bg-blue-950/30"
                >
                  <span className="w-1.5 h-1.5 rounded-full bg-blue-400 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="text-[13px] font-medium text-neutral-100 truncate">
                      {active.name}
                    </div>
                    {active.directory && (
                      <div className="text-[10px] text-neutral-500 font-mono truncate">
                        {active.directory}
                      </div>
                    )}
                  </div>
                  <span className="text-[10px] text-blue-400 shrink-0">active</span>
                </button>
              );
            })()}

            {nonActiveProjects.map((project, index) => (
              <button
                key={project.id}
                role="option"
                aria-selected={focusedIdx === index}
                disabled={switching === project.id}
                onClick={() => handleSwitch(project.id)}
                className={itemClassName(
                  index,
                  "flex w-full items-center gap-2 px-3 py-2 text-left transition-colors cursor-pointer hover:bg-neutral-800 disabled:opacity-50 text-neutral-100",
                )}
              >
                <span className="w-1.5 h-1.5 rounded-full bg-neutral-600 shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="text-[13px] text-neutral-100 truncate">
                    {switching === project.id ? "Switching…" : project.name}
                  </div>
                  {project.directory && (
                    <div className="text-[10px] text-neutral-500 font-mono truncate">
                      {project.directory}
                    </div>
                  )}
                </div>
              </button>
            ))}
          </div>

          <div className="border-t border-neutral-700">
            {SIDEBAR_SECTIONS.map((section, sectionIndex) => {
              const index = nonActiveProjects.length + sectionIndex;
              return (
                <button
                  key={section.id}
                  role="option"
                  aria-selected={focusedIdx === index}
                  onClick={() => handleOpenSection(section.id)}
                  className={itemClassName(
                    index,
                    "flex w-full items-center gap-2 px-3 py-2.5 text-left text-[12px] text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800 transition-colors cursor-pointer",
                  )}
                >
                  {section.icon === "ssh" ? (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
                      <path d="M4 17l6-6-6-6" />
                      <path d="M10 17l6-6-6-6" />
                    </svg>
                  ) : section.icon === "agents" ? (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
                      <rect x="2" y="3" width="20" height="14" rx="2" />
                      <path d="M8 21h8M12 17v4" />
                      <circle cx="12" cy="10" r="2" />
                    </svg>
                  ) : (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
                      <circle cx="12" cy="12" r="3" />
                      <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09a1.65 1.65 0 00-1-1.51 1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83 0 2 2 0 010-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09a1.65 1.65 0 001.51-1 1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 010-2.83 2 2 0 012.83 0l.06.06a1.65 1.65 0 001.82.33h.01A1.65 1.65 0 009 3.09V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51h.01a1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 0 2 2 0 010 2.83l-.06.06a1.65 1.65 0 00-.33 1.82v.01a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" />
                    </svg>
                  )}
                  {section.label}
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="ml-auto shrink-0 text-neutral-600">
                    <path d="M9 18l6-6-6-6" />
                  </svg>
                </button>
              );
            })}
          </div>

          <button
            type="button"
            role="option"
            aria-selected={focusedIdx === nonActiveProjects.length + SIDEBAR_SECTIONS.length}
            onClick={() => handleOpenSection("usage")}
              className={itemClassName(
                nonActiveProjects.length + SIDEBAR_SECTIONS.length,
                "block w-full border-t border-neutral-700 rounded-b-xl bg-neutral-950/70 px-3 py-2.5 text-left transition-colors cursor-pointer hover:bg-neutral-900",
              )}
          >
            <div className="flex items-center justify-between gap-2">
              <div className="text-[10px] uppercase tracking-wide text-neutral-500">
                Usage Today
              </div>
              <div className="text-[10px] text-neutral-400">
                Input {formatCompact(usageStats?.totalPromptTokens)}
              </div>
            </div>

            {usageLoading ? (
              <div className="mt-2 text-[11px] text-neutral-500">
                Loading usage...
              </div>
            ) : usageError ? (
              <div className="mt-2 text-[11px] text-red-300">
                {usageError}
              </div>
            ) : !usageStats?.totalPromptTokens ? (
              <div className="mt-2 text-[11px] text-neutral-500">
                No usage yet.
              </div>
            ) : (
              <div className="mt-2 text-[11px] text-neutral-300">
                Total input today:{" "}
                <span className="font-mono text-neutral-100">
                  {formatCompact(usageStats.totalPromptTokens)}
                </span>
              </div>
            )}

            {!usageLoading && !usageError && recentRequests.length > 0 && (
              <div className="mt-2 border-t border-neutral-800 pt-2">
                <div className="text-[10px] uppercase tracking-wide text-neutral-500">
                  Recent Usage
                </div>
                <div className="mt-1.5 space-y-1">
                  {recentRequests.map((item, index) => (
                    <div
                      key={`${item.timestamp}-${item.model}-${index}`}
                      className="flex items-center justify-between gap-2 text-[10px]"
                    >
                      <div className="min-w-0 truncate text-neutral-300">
                        {item.model}
                      </div>
                      <div className="shrink-0 text-neutral-500 whitespace-nowrap">
                        {formatDate(item.timestamp)}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </button>

          <div className="border-t border-neutral-700">
            <button
              role="option"
              aria-selected={focusedIdx === nonActiveProjects.length + SIDEBAR_SECTIONS.length + 1}
              onClick={() => handleOpenSection("projects")}
              className={itemClassName(
                nonActiveProjects.length + SIDEBAR_SECTIONS.length + 1,
                "flex w-full items-center gap-2 px-3 py-2.5 text-left text-[12px] text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800 transition-colors cursor-pointer",
              )}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
                <path d="M2 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H4a2 2 0 01-2-2V7z" />
              </svg>
              Manage projects...
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
