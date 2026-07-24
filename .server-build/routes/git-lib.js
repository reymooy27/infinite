import { access } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { Client } from "ssh2";
import { prisma } from "../lib/prisma.js";
import { decrypt } from "../lib/crypto.js";
const LOCAL_USER_ID = "local-user";
const execFileAsync = promisify(execFile);
const GIT_MAX_BUFFER = 1024 * 1024;
const CONFLICT_STATUSES = new Set(["DD", "AU", "UD", "UA", "DU", "AA", "UU"]);
export class GitActionError extends Error {
    stdout;
    stderr;
    statusCode;
    constructor(message, options) {
        super(message);
        this.name = "GitActionError";
        this.stdout = options?.stdout ?? "";
        this.stderr = options?.stderr ?? "";
        this.statusCode = options?.statusCode ?? 400;
    }
}
function createBasePayload(projectId, projectName, directory) {
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
        hasUpstream: false,
        ahead: 0,
        behind: 0,
        stagedCount: 0,
        unstagedCount: 0,
        untrackedCount: 0,
        conflictedCount: 0,
        stashCount: 0,
        branches: [],
        lastCommit: null,
        recentCommits: [],
        stashes: [],
        clean: true,
        changes: [],
        scannedAt: new Date().toISOString(),
    };
}
function quoteShellArg(value) {
    return `'${value.replace(/'/g, `'\\''`)}'`;
}
function getChangeLabel(indexStatus, workTreeStatus, conflicted, untracked) {
    if (conflicted)
        return "Conflict";
    if (untracked)
        return "Untracked";
    if (indexStatus === "R" || workTreeStatus === "R")
        return "Renamed";
    if (indexStatus === "D" || workTreeStatus === "D")
        return "Deleted";
    if (indexStatus === "A")
        return workTreeStatus === " " ? "Staged" : "Added + modified";
    if (indexStatus === "M" && workTreeStatus === "M")
        return "Staged + modified";
    if (indexStatus === "M")
        return "Staged";
    if (workTreeStatus === "M")
        return "Modified";
    if (indexStatus === "C" || workTreeStatus === "C")
        return "Copied";
    return "Changed";
}
function formatGitCommandError(stdout, stderr, exitCode) {
    const message = stderr.trim() || stdout.trim() || `Git command failed with exit ${exitCode}`;
    return new GitActionError(message, { stdout, stderr });
}
function getSSHConfig(connection) {
    return {
        host: connection.host,
        port: connection.port || 22,
        username: connection.username,
        readyTimeout: 15000,
        keepaliveInterval: 30000,
        keepaliveCountMax: 10,
        ...(connection.authType === "key" && connection.privateKey
            ? { privateKey: connection.privateKey }
            : { password: connection.password }),
    };
}
async function loadConnection(connectionId) {
    const row = await prisma.connection.findFirst({
        where: { id: connectionId, userId: LOCAL_USER_ID },
        select: {
            id: true,
            name: true,
            host: true,
            port: true,
            username: true,
            authType: true,
            passwordEncrypted: true,
            privateKeyEncrypted: true,
        },
    });
    if (!row) {
        throw new GitActionError("Connection not found", { statusCode: 404 });
    }
    const secret = process.env.ENCRYPTION_SECRET;
    if (!secret) {
        throw new GitActionError("ENCRYPTION_SECRET not set", { statusCode: 500 });
    }
    const connection = {
        id: row.id,
        name: row.name,
        host: row.host,
        port: row.port,
        username: row.username,
        authType: row.authType,
    };
    if (row.passwordEncrypted) {
        connection.password = decrypt(row.passwordEncrypted, secret);
    }
    if (row.privateKeyEncrypted) {
        connection.privateKey = decrypt(row.privateKeyEncrypted, secret);
    }
    return connection;
}
async function runLocalGit(directory, args) {
    try {
        const { stdout, stderr } = await execFileAsync("git", args, {
            cwd: directory,
            maxBuffer: GIT_MAX_BUFFER,
        });
        return {
            ok: true,
            stdout: stdout.trimEnd(),
            stderr: stderr.trimEnd(),
            exitCode: 0,
        };
    }
    catch (error) {
        const stdout = error && typeof error === "object" && "stdout" in error && typeof error.stdout === "string"
            ? error.stdout.trimEnd()
            : "";
        const stderr = error && typeof error === "object" && "stderr" in error && typeof error.stderr === "string"
            ? error.stderr.trimEnd()
            : "";
        const exitCode = error && typeof error === "object" && "code" in error && typeof error.code === "number"
            ? error.code
            : 1;
        return {
            ok: false,
            stdout,
            stderr,
            exitCode,
        };
    }
}
async function runRemoteGit(connection, directory, args) {
    const command = `cd -- ${quoteShellArg(directory)} && git ${args.map(quoteShellArg).join(" ")}`;
    const conn = new Client();
    return await new Promise((resolve) => {
        let stdout = "";
        let stderr = "";
        let settled = false;
        const finish = (result) => {
            if (settled)
                return;
            settled = true;
            conn.end();
            resolve(result);
        };
        conn.once("ready", () => {
            conn.exec(command, (err, stream) => {
                if (err) {
                    finish({ ok: false, stdout, stderr: err.message, exitCode: 1 });
                    return;
                }
                stream.on("data", (chunk) => {
                    stdout += chunk.toString("utf8");
                });
                stream.stderr.on("data", (chunk) => {
                    stderr += chunk.toString("utf8");
                });
                stream.on("close", (code) => {
                    const exitCode = typeof code === "number" ? code : 0;
                    finish({
                        ok: exitCode === 0,
                        stdout: stdout.trimEnd(),
                        stderr: stderr.trimEnd(),
                        exitCode,
                    });
                });
            });
        });
        conn.once("error", (error) => {
            finish({ ok: false, stdout, stderr: error.message, exitCode: 1 });
        });
        try {
            conn.connect(getSSHConfig(connection));
        }
        catch (error) {
            finish({
                ok: false,
                stdout,
                stderr: error instanceof Error ? error.message : "SSH connection failed",
                exitCode: 1,
            });
        }
    });
}
async function getProject(projectId) {
    const project = await prisma.project.findFirst({
        where: { id: projectId, userId: LOCAL_USER_ID },
        select: { id: true, name: true, directory: true },
    });
    if (!project) {
        throw new GitActionError("Project not found", { statusCode: 404 });
    }
    return {
        id: project.id,
        name: project.name,
        directory: project.directory ?? null,
    };
}
export async function createExecutionContext(projectId, requestedDirectory, connectionId) {
    const project = await getProject(projectId);
    const directory = requestedDirectory?.trim() || project.directory;
    if (!directory) {
        throw new GitActionError("Project directory not configured");
    }
    if (connectionId) {
        const connection = await loadConnection(connectionId);
        return {
            project,
            directory,
            runGit: (args) => runRemoteGit(connection, directory, args),
        };
    }
    try {
        await access(directory, fsConstants.R_OK);
    }
    catch {
        throw new GitActionError("Project directory unavailable");
    }
    return {
        project,
        directory,
        runGit: (args) => runLocalGit(directory, args),
    };
}
function parseBranchSummary(line, payload) {
    const summary = line.slice(3).trim();
    if (summary === "HEAD (no branch)") {
        payload.branch = "HEAD";
        payload.detached = true;
        payload.hasUpstream = false;
        return;
    }
    if (summary.startsWith("No commits yet on ")) {
        payload.branch = summary.slice("No commits yet on ".length).trim() || null;
        payload.hasUpstream = false;
        return;
    }
    const bracketStart = summary.indexOf(" [");
    const branchInfo = bracketStart >= 0 ? summary.slice(0, bracketStart) : summary;
    const aheadBehindInfo = bracketStart >= 0 ? summary.slice(bracketStart + 2, -1) : "";
    const [branchName, upstream] = branchInfo.split("...");
    payload.branch = branchName || null;
    payload.upstream = upstream || null;
    payload.hasUpstream = Boolean(upstream);
    for (const token of aheadBehindInfo.split(",")) {
        const trimmed = token.trim();
        if (!trimmed)
            continue;
        const match = trimmed.match(/^(ahead|behind)\s+(\d+)$/);
        if (!match)
            continue;
        const value = Number.parseInt(match[2], 10);
        if (match[1] === "ahead") {
            payload.ahead = value;
        }
        else {
            payload.behind = value;
        }
    }
}
function parseChanges(output, payload) {
    const lines = output.split("\n").filter(Boolean);
    for (const line of lines) {
        if (line.startsWith("## ")) {
            parseBranchSummary(line, payload);
            continue;
        }
        if (line.length < 3)
            continue;
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
        if (staged)
            payload.stagedCount += 1;
        if (unstaged)
            payload.unstagedCount += 1;
        if (untracked)
            payload.untrackedCount += 1;
        if (conflicted)
            payload.conflictedCount += 1;
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
function parseBranchList(output) {
    return output
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .sort((a, b) => a.localeCompare(b));
}
function parseLastCommit(output) {
    const [hash, subject, relativeDate, authorName] = output.split("\t");
    if (!hash || !subject || !relativeDate || !authorName)
        return null;
    return { hash, subject, relativeDate, authorName };
}
function parseRecentCommits(output) {
    return output
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => parseLastCommit(line))
        .filter((entry) => Boolean(entry));
}
function parseStashCount(output) {
    const trimmed = output.trim();
    if (!trimmed)
        return 0;
    return trimmed.split("\n").filter(Boolean).length;
}
function parseStashes(output) {
    return output
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => {
        const [selector, subject] = line.split("\t");
        if (!selector || !subject)
            return null;
        return { selector, subject };
    })
        .filter((entry) => Boolean(entry));
}
export async function execGitOrThrow(ctx, args) {
    const result = await ctx.runGit(args);
    if (!result.ok) {
        throw formatGitCommandError(result.stdout, result.stderr, result.exitCode);
    }
    return result.stdout;
}
function sanitizeCommitHash(hash) {
    const trimmed = hash.trim();
    if (!/^[0-9a-fA-F]{1,40}$/.test(trimmed)) {
        throw new GitActionError("Invalid commit hash");
    }
    return trimmed;
}
export async function getCommitDiff(options) {
    const ctx = await createExecutionContext(options.projectId, options.requestedDirectory, options.connectionId);
    const hash = sanitizeCommitHash(options.hash);
    const diff = await execGitOrThrow(ctx, ["show", "--no-color", "--format=", hash]);
    return { diff: diff || "No changes" };
}
export async function getGitStatus(options) {
    const ctx = await createExecutionContext(options.projectId, options.requestedDirectory, options.connectionId);
    const payload = createBasePayload(ctx.project.id, ctx.project.name, ctx.directory);
    try {
        payload.repoRoot = await execGitOrThrow(ctx, ["rev-parse", "--show-toplevel"]);
        payload.isRepo = true;
        const [statusOutput, branchesOutput, lastCommitOutput, recentCommitsOutput, stashOutput] = await Promise.all([
            execGitOrThrow(ctx, ["status", "--short", "--branch", "--untracked-files=all"]),
            execGitOrThrow(ctx, ["branch", "--format=%(refname:short)"]).catch(() => ""),
            execGitOrThrow(ctx, ["log", "-1", "--pretty=format:%h%x09%s%x09%cr%x09%an"]).catch(() => ""),
            execGitOrThrow(ctx, ["log", "-12", "--pretty=format:%h%x09%s%x09%cr%x09%an"]).catch(() => ""),
            execGitOrThrow(ctx, ["stash", "list", "--format=%gd%x09%gs"]).catch(() => ""),
        ]);
        parseChanges(statusOutput, payload);
        payload.branches = parseBranchList(branchesOutput);
        payload.lastCommit = parseLastCommit(lastCommitOutput);
        payload.recentCommits = parseRecentCommits(recentCommitsOutput);
        payload.stashes = parseStashes(stashOutput);
        payload.stashCount = parseStashCount(stashOutput);
        payload.scannedAt = new Date().toISOString();
        return payload;
    }
    catch (error) {
        const message = error instanceof GitActionError ? error.message : "Git command failed";
        if (message.includes("not a git repository")) {
            payload.reason = "Directory is not a git repository";
            payload.scannedAt = new Date().toISOString();
            return payload;
        }
        throw error;
    }
}
function requirePaths(paths) {
    if (!Array.isArray(paths) || paths.length === 0) {
        throw new GitActionError("No file paths provided");
    }
    const sanitized = paths
        .filter((value) => typeof value === "string")
        .map((value) => value.trim())
        .filter(Boolean);
    if (sanitized.length === 0) {
        throw new GitActionError("No file paths provided");
    }
    return sanitized;
}
export async function runGitAction(options) {
    const ctx = await createExecutionContext(options.projectId, options.requestedDirectory, options.connectionId);
    let args = [];
    switch (options.action) {
        case "stage":
            args = ["add", "--", ...requirePaths(options.paths)];
            break;
        case "stage_all":
            args = ["add", "-A"];
            break;
        case "unstage":
            args = ["restore", "--staged", "--", ...requirePaths(options.paths)];
            break;
        case "unstage_all":
            args = ["restore", "--staged", "--", "."];
            break;
        case "discard": {
            const paths = requirePaths(options.paths);
            const status = await getGitStatus({
                projectId: options.projectId,
                requestedDirectory: ctx.directory,
                connectionId: options.connectionId,
            });
            const trackedPaths = new Set(status.changes.filter((change) => !change.untracked).map((change) => change.path));
            const untrackedPaths = paths.filter((path) => !trackedPaths.has(path));
            const trackedSelection = paths.filter((path) => trackedPaths.has(path));
            if (trackedSelection.length > 0) {
                const trackedResult = await ctx.runGit(["restore", "--", ...trackedSelection]);
                if (!trackedResult.ok) {
                    throw formatGitCommandError(trackedResult.stdout, trackedResult.stderr, trackedResult.exitCode);
                }
            }
            if (untrackedPaths.length > 0) {
                const cleanResult = await ctx.runGit(["clean", "-f", "--", ...untrackedPaths]);
                if (!cleanResult.ok) {
                    throw formatGitCommandError(cleanResult.stdout, cleanResult.stderr, cleanResult.exitCode);
                }
            }
            const nextStatus = await getGitStatus({
                projectId: options.projectId,
                requestedDirectory: ctx.directory,
                connectionId: options.connectionId,
            });
            return { ok: true, stdout: "", stderr: "", nextStatus };
        }
        case "commit": {
            const message = options.message?.trim();
            if (!message) {
                throw new GitActionError("Commit message is required");
            }
            args = ["commit", "-m", message];
            break;
        }
        case "checkout_branch": {
            const branch = options.branch?.trim();
            if (!branch) {
                throw new GitActionError("Branch name is required");
            }
            args = ["checkout", branch];
            break;
        }
        case "create_branch": {
            const branch = options.branch?.trim();
            if (!branch) {
                throw new GitActionError("Branch name is required");
            }
            args = ["checkout", "-b", branch];
            break;
        }
        case "pull":
            args = ["pull", "--ff-only"];
            break;
        case "push":
            args = ["push"];
            break;
        default:
            throw new GitActionError("Unsupported git action");
    }
    const result = await ctx.runGit(args);
    if (!result.ok) {
        throw formatGitCommandError(result.stdout, result.stderr, result.exitCode);
    }
    const nextStatus = await getGitStatus({
        projectId: options.projectId,
        requestedDirectory: ctx.directory,
        connectionId: options.connectionId,
    });
    return {
        ok: true,
        stdout: result.stdout,
        stderr: result.stderr,
        nextStatus,
    };
}
