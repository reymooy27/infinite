"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertCircle, GitBranch, RefreshCw, X } from "lucide-react";

type GitChange = {
  path: string;
  originalPath: string | null;
  indexStatus: string;
  workTreeStatus: string;
  label: string;
  staged: boolean;
  unstaged: boolean;
  untracked: boolean;
  conflicted: boolean;
};

type GitStatusPayload = {
  projectId: string;
  projectName: string;
  directory: string | null;
  available: boolean;
  isRepo: boolean;
  reason: string | null;
  repoRoot: string | null;
  branch: string | null;
  detached: boolean;
  upstream: string | null;
  ahead: number;
  behind: number;
  stagedCount: number;
  unstagedCount: number;
  untrackedCount: number;
  conflictedCount: number;
  clean: boolean;
  changes: GitChange[];
  scannedAt: string;
};

interface FocusModeGitPanelProps {
  open: boolean;
  projectId: string | null;
  directory?: string;
  onClose: () => void;
}

function getChipClassName(change: GitChange) {
  if (change.conflicted) return "border-red-500/30 bg-red-500/10 text-red-200";
  if (change.untracked) return "border-emerald-500/30 bg-emerald-500/10 text-emerald-200";
  if (change.staged && change.unstaged) return "border-amber-500/30 bg-amber-500/10 text-amber-100";
  if (change.staged) return "border-sky-500/30 bg-sky-500/10 text-sky-100";
  return "border-neutral-700 bg-neutral-800 text-neutral-200";
}

function formatTimestamp(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Now";
  return date.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export default function FocusModeGitPanel({
  open,
  projectId,
  directory,
  onClose,
}: FocusModeGitPanelProps) {
  const [data, setData] = useState<GitStatusPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const loadStatus = useCallback(
    async (signal?: AbortSignal, silent = false) => {
      if (!projectId) {
        setData(null);
        setError("");
        return;
      }

      if (!silent) {
        setLoading(true);
      }
      setError("");

      try {
        const query = new URLSearchParams();
        if (directory?.trim()) {
          query.set("directory", directory.trim());
        }
        const suffix = query.size > 0 ? `?${query.toString()}` : "";
        const res = await fetch(`/api/projects/${projectId}/git-status${suffix}`, {
          cache: "no-store",
          signal,
        });
        const body = await res.json();

        if (!res.ok) {
          throw new Error(body.error || "Failed to load git status");
        }

        setData(body);
      } catch (err) {
        if (signal?.aborted) return;
        setError(err instanceof Error ? err.message : "Failed to load git status");
      } finally {
        if (!signal?.aborted && !silent) {
          setLoading(false);
        }
      }
    },
    [directory, projectId],
  );

  useEffect(() => {
    if (!open) return;

    const controller = new AbortController();
    const initialLoadId = window.setTimeout(() => {
      void loadStatus(controller.signal);
    }, 0);

    const intervalId = window.setInterval(() => {
      void loadStatus(controller.signal, true);
    }, 5000);

    return () => {
      controller.abort();
      window.clearTimeout(initialLoadId);
      window.clearInterval(intervalId);
    };
  }, [loadStatus, open]);

  if (!open) return null;

  return (
    <aside className="absolute inset-y-0 right-0 z-20 w-full max-w-[24rem] border-l border-neutral-800 bg-neutral-950/95 backdrop-blur-md shadow-2xl">
      <div className="flex h-full flex-col">
        <div className="flex items-center gap-2 border-b border-neutral-800 px-4 py-3">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <GitBranch size={15} className="shrink-0 text-neutral-300" />
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-neutral-100">Git changes</p>
              <p className="truncate text-[11px] text-neutral-500">
                {data?.projectName ?? "Active project"}
              </p>
            </div>
          </div>
          <button
            onClick={() => void loadStatus()}
            title="Refresh git status"
            className="rounded p-1.5 text-neutral-500 transition-colors hover:bg-neutral-800 hover:text-white"
          >
            <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
          </button>
          <button
            onClick={onClose}
            title="Close git sidebar"
            className="rounded p-1.5 text-neutral-500 transition-colors hover:bg-neutral-800 hover:text-white"
          >
            <X size={14} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-3">
          {loading && !data && (
            <div className="rounded-xl border border-neutral-800 bg-neutral-900/80 px-3 py-6 text-center text-sm text-neutral-400">
              Loading git status...
            </div>
          )}

          {!loading && error && (
            <div className="rounded-xl border border-red-500/20 bg-red-500/10 px-3 py-3 text-sm text-red-200">
              {error}
            </div>
          )}

          {!error && data && (
            <div className="space-y-3">
              <div className="rounded-xl border border-neutral-800 bg-neutral-900/80 p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-full border border-neutral-700 bg-neutral-800 px-2 py-0.5 text-[11px] text-neutral-100">
                    {data.detached ? "Detached HEAD" : data.branch ?? "No branch"}
                  </span>
                  {data.upstream && (
                    <span className="rounded-full border border-neutral-800 px-2 py-0.5 text-[11px] text-neutral-400">
                      {data.upstream}
                    </span>
                  )}
                  {data.ahead > 0 && (
                    <span className="rounded-full border border-sky-500/30 bg-sky-500/10 px-2 py-0.5 text-[11px] text-sky-100">
                      ahead {data.ahead}
                    </span>
                  )}
                  {data.behind > 0 && (
                    <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[11px] text-amber-100">
                      behind {data.behind}
                    </span>
                  )}
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                  <div className="rounded-lg border border-neutral-800 bg-neutral-950/60 px-3 py-2 text-neutral-400">
                    <p>Staged</p>
                    <p className="mt-1 text-lg text-neutral-100">{data.stagedCount}</p>
                  </div>
                  <div className="rounded-lg border border-neutral-800 bg-neutral-950/60 px-3 py-2 text-neutral-400">
                    <p>Modified</p>
                    <p className="mt-1 text-lg text-neutral-100">{data.unstagedCount}</p>
                  </div>
                  <div className="rounded-lg border border-neutral-800 bg-neutral-950/60 px-3 py-2 text-neutral-400">
                    <p>Untracked</p>
                    <p className="mt-1 text-lg text-neutral-100">{data.untrackedCount}</p>
                  </div>
                  <div className="rounded-lg border border-neutral-800 bg-neutral-950/60 px-3 py-2 text-neutral-400">
                    <p>Conflicts</p>
                    <p className="mt-1 text-lg text-neutral-100">{data.conflictedCount}</p>
                  </div>
                </div>
                <div className="mt-3 text-[11px] text-neutral-500">
                  <p className="truncate">{data.directory ?? "No directory"}</p>
                  <p className="truncate">Updated {formatTimestamp(data.scannedAt)}</p>
                </div>
              </div>

              {!data.available && (
                <div className="flex gap-2 rounded-xl border border-neutral-800 bg-neutral-900/80 px-3 py-3 text-sm text-neutral-300">
                  <AlertCircle size={16} className="mt-0.5 shrink-0 text-neutral-500" />
                  <p>{data.reason ?? "Project directory not configured"}</p>
                </div>
              )}

              {data.available && !data.isRepo && (
                <div className="flex gap-2 rounded-xl border border-neutral-800 bg-neutral-900/80 px-3 py-3 text-sm text-neutral-300">
                  <AlertCircle size={16} className="mt-0.5 shrink-0 text-neutral-500" />
                  <p>{data.reason ?? "Directory is not a git repository"}</p>
                </div>
              )}

              {data.isRepo && data.clean && (
                <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-3 py-3 text-sm text-emerald-200">
                  Working tree clean
                </div>
              )}

              {data.isRepo && data.changes.length > 0 && (
                <div className="space-y-2">
                  {data.changes.map((change) => (
                    <div
                      key={`${change.path}-${change.indexStatus}-${change.workTreeStatus}`}
                      className="rounded-xl border border-neutral-800 bg-neutral-900/80 px-3 py-2.5"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate font-mono text-xs text-neutral-100">{change.path}</p>
                          {change.originalPath && (
                            <p className="truncate font-mono text-[11px] text-neutral-500">
                              from {change.originalPath}
                            </p>
                          )}
                        </div>
                        <span
                          className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-[0.16em] ${getChipClassName(change)}`}
                        >
                          {change.label}
                        </span>
                      </div>
                      <div className="mt-2 flex items-center gap-2 text-[11px] text-neutral-500">
                        <span>Index {change.indexStatus}</span>
                        <span>Worktree {change.workTreeStatus}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </aside>
  );
}
