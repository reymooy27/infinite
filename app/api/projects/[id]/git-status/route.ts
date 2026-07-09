import { access } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { LOCAL_USER_ID } from "@/lib/auth";

const execFileAsync = promisify(execFile);
const GIT_MAX_BUFFER = 1024 * 1024;
const CONFLICT_STATUSES = new Set(["DD", "AU", "UD", "UA", "DU", "AA", "UU"]);

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

function createBasePayload(projectId: string, projectName: string, directory: string | null): GitStatusPayload {
  return {
    projectId,
    projectName,
    directory,
    available: Boolean(directory),
    isRepo: false,
    reason: null,
    repoRoot: null,
    branch: null,
    detached: false,
    upstream: null,
    ahead: 0,
    behind: 0,
    stagedCount: 0,
    unstagedCount: 0,
    untrackedCount: 0,
    conflictedCount: 0,
    clean: true,
    changes: [],
    scannedAt: new Date().toISOString(),
  };
}

function formatGitError(error: unknown) {
  if (error && typeof error === "object") {
    const stderr = "stderr" in error && typeof error.stderr === "string" ? error.stderr.trim() : "";
    const stdout = "stdout" in error && typeof error.stdout === "string" ? error.stdout.trim() : "";
    const message = "message" in error && typeof error.message === "string" ? error.message.trim() : "";
    return stderr || stdout || message || "Git command failed";
  }
  return "Git command failed";
}

async function runGit(directory: string, args: string[]) {
  const { stdout } = await execFileAsync("git", args, {
    cwd: directory,
    maxBuffer: GIT_MAX_BUFFER,
  });
  return stdout.trimEnd();
}

function parseBranchSummary(line: string, payload: GitStatusPayload) {
  const summary = line.slice(3).trim();

  if (summary === "HEAD (no branch)") {
    payload.branch = "HEAD";
    payload.detached = true;
    return;
  }

  if (summary.startsWith("No commits yet on ")) {
    payload.branch = summary.slice("No commits yet on ".length).trim() || null;
    return;
  }

  const bracketStart = summary.indexOf(" [");
  const branchInfo = bracketStart >= 0 ? summary.slice(0, bracketStart) : summary;
  const aheadBehindInfo = bracketStart >= 0 ? summary.slice(bracketStart + 2, -1) : "";
  const [branchName, upstream] = branchInfo.split("...");

  payload.branch = branchName || null;
  payload.upstream = upstream || null;

  for (const token of aheadBehindInfo.split(",")) {
    const trimmed = token.trim();
    if (!trimmed) continue;
    const match = trimmed.match(/^(ahead|behind)\s+(\d+)$/);
    if (!match) continue;
    const value = Number.parseInt(match[2], 10);
    if (match[1] === "ahead") {
      payload.ahead = value;
    } else {
      payload.behind = value;
    }
  }
}

function getChangeLabel(indexStatus: string, workTreeStatus: string, conflicted: boolean, untracked: boolean) {
  if (conflicted) return "Conflict";
  if (untracked) return "Untracked";
  if (indexStatus === "R" || workTreeStatus === "R") return "Renamed";
  if (indexStatus === "D" || workTreeStatus === "D") return "Deleted";
  if (indexStatus === "A") return workTreeStatus === " " ? "Staged" : "Added + modified";
  if (indexStatus === "M" && workTreeStatus === "M") return "Staged + modified";
  if (indexStatus === "M") return "Staged";
  if (workTreeStatus === "M") return "Modified";
  if (indexStatus === "C" || workTreeStatus === "C") return "Copied";
  return "Changed";
}

function parseChanges(output: string, payload: GitStatusPayload) {
  const lines = output.split("\n").filter(Boolean);

  for (const line of lines) {
    if (line.startsWith("## ")) {
      parseBranchSummary(line, payload);
      continue;
    }

    if (line.length < 3) continue;

    const status = line.slice(0, 2);
    const indexStatus = status[0] ?? " ";
    const workTreeStatus = status[1] ?? " ";
    const rawPath = line.slice(3).trim();

    const renameParts = rawPath.includes(" -> ") ? rawPath.split(" -> ") : null;
    const originalPath = renameParts ? renameParts[0] ?? null : null;
    const path = renameParts ? renameParts[renameParts.length - 1] ?? rawPath : rawPath;
    const untracked = status === "??";
    const conflicted = CONFLICT_STATUSES.has(status);
    const staged = indexStatus !== " " && indexStatus !== "?";
    const unstaged = workTreeStatus !== " " && workTreeStatus !== "?";

    if (staged) payload.stagedCount += 1;
    if (unstaged) payload.unstagedCount += 1;
    if (untracked) payload.untrackedCount += 1;
    if (conflicted) payload.conflictedCount += 1;

    payload.changes.push({
      path,
      originalPath,
      indexStatus,
      workTreeStatus,
      label: getChangeLabel(indexStatus, workTreeStatus, conflicted, untracked),
      staged,
      unstaged,
      untracked,
      conflicted,
    });
  }

  payload.clean = payload.changes.length === 0;
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const project = await prisma.project.findFirst({
      where: { id, userId: LOCAL_USER_ID },
      select: { id: true, name: true, directory: true },
    });

    if (!project) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const payload = createBasePayload(project.id, project.name, project.directory ?? null);

    if (!project.directory) {
      payload.reason = "Project directory not configured";
      return NextResponse.json(payload);
    }

    try {
      await access(project.directory, fsConstants.R_OK);
    } catch {
      payload.reason = "Project directory unavailable";
      return NextResponse.json(payload);
    }

    try {
      payload.repoRoot = await runGit(project.directory, ["rev-parse", "--show-toplevel"]);
      payload.isRepo = true;
      const statusOutput = await runGit(project.directory, [
        "status",
        "--short",
        "--branch",
        "--untracked-files=all",
      ]);
      parseChanges(statusOutput, payload);
      payload.scannedAt = new Date().toISOString();
      return NextResponse.json(payload);
    } catch (error) {
      const message = formatGitError(error);
      if (message.includes("not a git repository")) {
        payload.reason = "Directory is not a git repository";
        payload.scannedAt = new Date().toISOString();
        return NextResponse.json(payload);
      }
      throw error;
    }
  } catch {
    return NextResponse.json({ error: "Failed to fetch git status" }, { status: 500 });
  }
}
