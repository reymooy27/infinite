// @ts-nocheck
import { useEffect, useRef, useState, useCallback } from "react";
import { api, API_BASE } from "@/lib/api";
import { normalizeRouterUsageBaseUrl } from "@/lib/routerUsage";
import { useProjectStore } from "@/stores/useProjectStore";
import { useSettingsStore } from "@/stores/useSettingsStore";
import { useActivityStore, anyTerminalBusy } from "@/stores/useActivityStore";
import type { Project } from "@/types";

interface ProjectSwitcherProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  onOpenSection: (section: string) => void;
  embedded?: boolean;
}

const SIDEBAR_SECTIONS = [
  { id: "ssh", label: "SSH Manager", icon: "ssh" },
  { id: "settings", label: "Settings", icon: "settings" },
] as const;

const RECENT_PROJECTS_KEY = "infinite-recent-projects";
const SESSIONS_PER_PROJECT = 5;
const OC_POLL_MS = 5000;

interface OcSession {
  id: string;
  title?: string;
  time?: { created?: number; updated?: number };
}

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

function sortProjectsByRecentOpen(
  projects: Project[],
  activeProjectId: string | null,
) {
  const recencyRank = new Map(
    readRecentProjectIds().map((id, index) => [id, index]),
  );

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
  const now = Date.now();
  const diffMs = Math.max(0, now - date.getTime());
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHr = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHr / 24);
  if (diffSec < 60) return `${diffSec}s ago`;
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHr < 24) return `${diffHr}h ago`;
  if (diffDay < 30) return `${diffDay}d ago`;
  return date.toLocaleString("en-US", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function formatSessionTime(updated: number | undefined) {
  if (!updated) return "";
  return formatDate(new Date(updated).toISOString());
}

function Spinner({ className = "text-blue-400" }: { className?: string }) {
  return (
    <svg
      className={`animate-spin ${className}`}
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      aria-label="working"
    >
      <circle
        cx="12"
        cy="12"
        r="9"
        stroke="currentColor"
        strokeWidth="3"
        opacity="0.25"
      />
      <path
        d="M21 12a9 9 0 00-9-9"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  );
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`shrink-0 text-neutral-500 transition-transform duration-150 ${open ? "rotate-90" : ""}`}
    >
      <path d="M9 18l6-6-6-6" />
    </svg>
  );
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
  const terminals = useActivityStore((s) => s.terminals);
  const activeProjectName =
    projects.find((p) => p.id === activeProjectId)?.name ?? null;
  const [switching, setSwitching] = useState<string | null>(null);
  const [usageStats, setUsageStats] =
    useState<ProjectSwitcherUsageStats | null>(null);
  const [usageLoading, setUsageLoading] = useState(false);
  const [usageError, setUsageError] = useState("");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [ocSessions, setOcSessions] = useState<Record<string, OcSession[]>>({});
  const [ocBusy, setOcBusy] = useState<Record<string, Record<string, boolean>>>({});
  const [, setTick] = useState(0);
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
      const isMobile = typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches;
      if (!isMobile) {
        requestAnimationFrame(() => dropdownRef.current?.focus());
      }
    }
  }, [isOpen]);

  // Refresh "terminal busy" countdown rendering + opencode busy state
  useEffect(() => {
    if (!isOpen) return;
    const id = window.setInterval(() => setTick((t) => t + 1), 1000);
    return () => window.clearInterval(id);
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
        const body = await api.get<Record<string, unknown>>(
          `/api/router-usage/stats?${query.toString()}`,
        );

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

  // Poll opencode status/sessions per project while the panel is open.
  // /status tells if serve runs; only then /proxy/session/status reports busy sessions.
  useEffect(() => {
    if (!isOpen || projects.length === 0) return;

    const controller = new AbortController();
    const fetchJson = async (path: string) => {
      const res = await fetch(`${API_BASE}${path}`, {
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(String(res.status));
      return res.json();
    };

    const poll = async () => {
      const nextBusy: Record<string, Record<string, boolean>> = {};
      const nextSessions: Record<string, OcSession[]> = {};
      await Promise.all(
        projects.map(async (project) => {
          const pid = encodeURIComponent(project.id);
          try {
            const st = await fetchJson(`/api/opencode/${pid}/status`);
            if (!st?.running) {
              nextSessions[project.id] = [];
              return;
            }
            const status = await fetchJson(
              `/api/opencode/${pid}/proxy/session/status`,
            );
            const busy: Record<string, boolean> = {};
            for (const [sid, entry] of Object.entries(status ?? {})) {
              const type = (entry as { type?: string })?.type;
              if (type && type !== "idle") busy[sid] = true;
            }
            nextBusy[project.id] = busy;
            const list = await fetchJson(`/api/opencode/${pid}/proxy/session`);
            if (Array.isArray(list)) {
              nextSessions[project.id] = [...list]
                .sort(
                  (a: OcSession, b: OcSession) =>
                    (b.time?.updated ?? 0) - (a.time?.updated ?? 0),
                )
                .slice(0, SESSIONS_PER_PROJECT);
            }
          } catch {
            // serve down or proxy failed — no activity for this project
          }
        }),
      );
      if (!controller.signal.aborted) {
        setOcBusy(nextBusy);
        setOcSessions((prev) => {
          const next = { ...prev };
          for (const project of projects) {
            const fresh = nextSessions[project.id];
            if (fresh) next[project.id] = fresh;
          }
          return next;
        });
      }
    };

    void poll();
    const intervalId = window.setInterval(() => void poll(), OC_POLL_MS);
    return () => {
      controller.abort();
      window.clearInterval(intervalId);
    };
  }, [isOpen, projects]);

  const nonActiveProjects = sortProjectsByRecentOpen(projects, activeProjectId);
  const recentRequests = (usageStats?.recentRequests ?? []).slice(0, 3);
  const terminalBusy = anyTerminalBusy(terminals);

  const handleSwitch = useCallback(
    async (id: string) => {
      if (id === activeProjectId || switching) return;
      setSwitching(id);
      await switchProject(id);
      setSwitching(null);
      onOpenChange(false);
    },
    [activeProjectId, onOpenChange, switchProject, switching],
  );

  const handleOpenSection = useCallback(
    (section: string) => {
      onOpenChange(false);
      onOpenSection(section);
    },
    [onOpenChange, onOpenSection],
  );

  const toggleExpanded = (id: string) => {
    setExpanded((prev) => {
      const open = prev[id] ?? (ocSessions[id]?.length ?? 0) > 0;
      return { ...prev, [id]: !open };
    });
  };

  const [focusedIdx, setFocusedIdx] = useState(0);

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [focusedIdx, handleOpenSection, handleSwitch, nonActiveProjects],
  );

  const handleButtonClick = () => {
    setFocusedIdx(0);
    onOpenChange(!isOpen);
  };

  const itemClassName = (index: number, base = "") =>
    `${base} ${focusedIdx === index ? "bg-neutral-800 text-neutral-100" : ""}`;

  const renderProject = (project: Project, index: number, isActive: boolean) => {
    const busyMap = ocBusy[project.id] ?? {};
    const projectBusy = Object.keys(busyMap).length > 0;
    const sessions = ocSessions[project.id];
    const isOpenRow = expanded[project.id] ?? (sessions?.length ?? 0) > 0;
    return (
      <div key={project.id}>
        <div
          role="option"
          aria-selected={isActive || focusedIdx === index}
          onClick={() => (isActive ? onOpenChange(false) : handleSwitch(project.id))}
          className={`${isActive ? "bg-blue-950/30" : "hover:bg-neutral-800"} ${itemClassName(index)} flex w-full items-center gap-1.5 px-2 py-2 text-left transition-colors cursor-pointer ${switching === project.id ? "opacity-50" : ""}`}
        >
          <button
            onClick={(e) => {
              e.stopPropagation();
              toggleExpanded(project.id);
            }}
            className="flex h-5 w-5 shrink-0 items-center justify-center rounded hover:bg-neutral-700 cursor-pointer"
            title={isOpenRow ? "Hide sessions" : "Show sessions"}
            aria-expanded={isOpenRow}
          >
            <Chevron open={isOpenRow} />
          </button>
          <div className="flex-1 min-w-0">
            <div className={`text-[13px] truncate ${isActive ? "font-medium text-neutral-100" : "text-neutral-100"}`}>
              {switching === project.id ? "Switching…" : project.name}
            </div>
            {project.directory && (
              <div className="text-[10px] text-neutral-500 font-mono truncate">
                {project.directory}
              </div>
            )}
          </div>
          {projectBusy && <Spinner />}
          {isActive && (
            <span className="text-[10px] text-blue-400 shrink-0">active</span>
          )}
        </div>

        {isOpenRow && (
          <div className="ml-6 border-l border-neutral-800 pl-2 pb-1">
            {sessions === undefined ? (
              <div className="flex items-center gap-1.5 px-2 py-1.5 text-[11px] text-neutral-500">
                <Spinner className="text-neutral-500" /> Sessions…
              </div>
            ) : sessions.length === 0 ? (
              <div className="px-2 py-1.5 text-[11px] text-neutral-600">
                No sessions
              </div>
            ) : (
              sessions.map((session) => (
                <div
                  key={session.id}
                  className="flex items-center gap-1.5 px-2 py-1 rounded hover:bg-neutral-800/60 cursor-pointer"
                  onClick={() => !isActive && handleSwitch(project.id)}
                  title={session.title}
                >
                  {busyMap[session.id] ? (
                    <Spinner />
                  ) : (
                    <span className="w-1.5 h-1.5 rounded-full bg-neutral-700 shrink-0" />
                  )}
                  <span className="flex-1 min-w-0 truncate text-[11px] text-neutral-300">
                    {session.title || session.id}
                  </span>
                  <span className="shrink-0 text-[10px] text-neutral-600 whitespace-nowrap">
                    {formatSessionTime(session.time?.updated)}
                  </span>
                </div>
              ))
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className={embedded ? "relative" : ""}>
      <button
        ref={buttonRef}
        onClick={handleButtonClick}
        className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1 transition-colors cursor-pointer ${
          embedded ? "" : "fixed top-4 left-4 z-[10000] shadow-2xl backdrop-blur-md"
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
        <span className="max-w-24 truncate text-[11px] font-medium">
          {activeProjectName ?? "Menu"}
        </span>
        {(terminalBusy || Object.keys(ocBusy[activeProjectId ?? ""] ?? {}).length > 0) && (
          <Spinner className="text-amber-300" />
        )}
      </button>

      {isOpen && (
        <div
          ref={dropdownRef}
          role="listbox"
          tabIndex={-1}
          onKeyDown={handleDropdownKeyDown}
          className="fixed top-0 left-0 bottom-0 z-[10002] w-72 max-w-[85vw] bg-neutral-900 border-r border-neutral-700 shadow-2xl flex flex-col outline-none animate-[fadeSlideIn_0.12s_ease-out]"
        >
          <div className="flex items-center justify-between px-3 py-2.5 border-b border-neutral-800 shrink-0">
            <h2 className="text-[13px] font-semibold text-neutral-200">
              Projects
            </h2>
            <div className="flex items-center gap-2">
              {terminalBusy && (
                <span className="flex items-center gap-1 text-[10px] text-amber-300">
                  <Spinner className="text-amber-300" /> terminal
                </span>
              )}
              <button
                onClick={() => onOpenChange(false)}
                className="flex h-6 w-6 items-center justify-center rounded-md text-neutral-400 transition-colors cursor-pointer hover:bg-neutral-800 hover:text-neutral-200"
                title="Close"
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
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto py-1">
            {projects.length === 0 && (
              <div className="px-3 py-3 text-[12px] text-neutral-500 text-center">
                No projects yet
              </div>
            )}

            {(() => {
              const active = projects.find((p) => p.id === activeProjectId);
              if (!active) return null;
              return renderProject(active, -1, true);
            })()}

            {nonActiveProjects.map((project, index) =>
              renderProject(project, index, false),
            )}
          </div>

          <div className="shrink-0 border-t border-neutral-800">
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
                    <svg
                      width="14"
                      height="14"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className="shrink-0"
                    >
                      <path d="M4 17l6-6-6-6" />
                      <path d="M10 17l6-6-6-6" />
                    </svg>
                  ) : (
                    <svg
                      width="14"
                      height="14"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className="shrink-0"
                    >
                      <circle cx="12" cy="12" r="3" />
                      <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09a1.65 1.65 0 00-1-1.51 1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83 0 2 2 0 010-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09a1.65 1.65 0 001.51-1 1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 010-2.83 2 2 0 012.83 0l.06.06a1.65 1.65 0 001.82.33h.01A1.65 1.65 0 009 3.09V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51h.01a1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 0 2 2 0 010 2.83l-.06.06a1.65 1.65 0 00-.33 1.82v.01a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" />
                    </svg>
                  )}
                  {section.label}
                  <svg
                    width="12"
                    height="12"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="ml-auto shrink-0 text-neutral-600"
                  >
                    <path d="M9 18l6-6-6-6" />
                  </svg>
                </button>
              );
            })}

            <button
              type="button"
              role="option"
              aria-selected={
                focusedIdx === nonActiveProjects.length + SIDEBAR_SECTIONS.length
              }
              onClick={() => handleOpenSection("usage")}
              className={itemClassName(
                nonActiveProjects.length + SIDEBAR_SECTIONS.length,
                "block w-full border-t border-neutral-800 bg-neutral-950/70 px-3 py-2 text-left transition-colors cursor-pointer hover:bg-neutral-900",
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
              {!usageLoading && !usageError && recentRequests.length > 0 && (
                <div className="mt-1.5 border-t border-neutral-800 pt-1.5">
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
              )}
            </button>

            <button
              role="option"
              aria-selected={
                focusedIdx ===
                nonActiveProjects.length + SIDEBAR_SECTIONS.length + 1
              }
              onClick={() => handleOpenSection("projects")}
              className={itemClassName(
                nonActiveProjects.length + SIDEBAR_SECTIONS.length + 1,
                "flex w-full items-center gap-2 border-t border-neutral-800 px-3 py-2.5 text-left text-[12px] text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800 transition-colors cursor-pointer",
              )}
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
                className="shrink-0"
              >
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
