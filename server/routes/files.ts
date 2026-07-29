import { Router } from "express";
import { readdir, readFile, writeFile, stat } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import { Client } from "ssh2";
import { prisma } from "../lib/prisma.js";
import { decrypt } from "../lib/crypto.js";
import { logger } from "../lib/logger.js";

const LOCAL_USER_ID = "local-user";
const MAX_FILE_SIZE = 512 * 1024; // 512KB
const router = Router();

type FileEntry = {
  name: string;
  path: string;
  isDir: boolean;
  size: number;
  mtime: string;
};

type SSHConnectionConfig = {
  id: number;
  name: string;
  host: string;
  port: number;
  username: string;
  authType: "password" | "key";
  password?: string;
  privateKey?: string;
};

async function loadProject(projectId: string) {
  const project = await prisma.project.findFirst({
    where: { id: projectId, userId: LOCAL_USER_ID },
    select: { id: true, name: true, directory: true },
  });
  if (!project) throw new Error("Project not found");
  return project;
}

async function loadConnection(connectionId: number): Promise<SSHConnectionConfig> {
  const row = await prisma.connection.findFirst({
    where: { id: connectionId, userId: LOCAL_USER_ID },
    select: {
      id: true, name: true, host: true, port: true, username: true,
      authType: true, passwordEncrypted: true, privateKeyEncrypted: true,
    },
  });
  if (!row) throw new Error("Connection not found");

  const secret = process.env.ENCRYPTION_SECRET;
  if (!secret) throw new Error("ENCRYPTION_SECRET not set");

  const conn: SSHConnectionConfig = {
    id: row.id, name: row.name, host: row.host, port: row.port,
    username: row.username, authType: row.authType as "password" | "key",
  };
  if (row.passwordEncrypted) conn.password = decrypt(row.passwordEncrypted, secret);
  if (row.privateKeyEncrypted) conn.privateKey = decrypt(row.privateKeyEncrypted, secret);
  return conn;
}

function resolvePath(baseDir: string, requestedPath: string): string {
  const resolved = resolve(baseDir, requestedPath);
  if (!resolved.startsWith(baseDir)) throw new Error("Path traversal not allowed");
  return resolved;
}

async function isBinaryFile(filePath: string): Promise<boolean> {
  try {
    const handle = await readFile(filePath);
    const chunk = handle.subarray(0, 8192);
    for (let i = 0; i < chunk.length; i++) {
      if (chunk[i] === 0) return true;
    }
    return false;
  } catch {
    return false;
  }
}

function runSFTP<T>(
  connection: SSHConnectionConfig,
  fn: (sftp: import("ssh2").SFTPWrapper) => Promise<T>,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const conn = new Client();
    let settled = false;

    const done = (err: Error | null, result?: T) => {
      if (settled) return;
      settled = true;
      conn.end();
      if (err) reject(err);
      else resolve(result as T);
    };

    conn.on("ready", () => {
      conn.sftp((err, sftp) => {
        if (err) return done(err);
        fn(sftp)
          .then((result) => done(null, result))
          .catch((e) => done(e instanceof Error ? e : new Error(String(e))));
      });
    });

    conn.on("error", (err) => done(err));

    const config: Record<string, unknown> = {
      host: connection.host,
      port: connection.port || 22,
      username: connection.username,
      readyTimeout: 15000,
      keepaliveInterval: 30000,
    };
    if (connection.authType === "key" && connection.privateKey) {
      config.privateKey = connection.privateKey;
    } else {
      config.password = connection.password;
    }
    conn.connect(config);
  });
}

// GET /api/projects/:id/files?path=...&connectionId=...
router.get("/:id/files", async (req, res) => {
  try {
    const project = await loadProject(req.params.id);
    const relativePath = (req.query.path as string) || "";
    const connectionIdParam = req.query.connectionId as string;
    const connectionId = connectionIdParam ? parseInt(connectionIdParam, 10) : null;
    const baseDir = project.directory;

    if (!baseDir) {
      res.status(400).json({ error: "Project directory not configured" });
      return;
    }

    if (connectionId) {
      // Remote via SFTP
      const connection = await loadConnection(connectionId);
      const remotePath = relativePath ? `${baseDir}/${relativePath}` : baseDir;

      const entries = await runSFTP(connection, (sftp) =>
        new Promise<FileEntry[]>((resolveEntries, rejectEntries) => {
          sftp.readdir(remotePath, (err, list) => {
            if (err) return rejectEntries(err);
            const entries: FileEntry[] = (list || [])
              .filter((item) => !item.filename.startsWith(".") || relativePath !== "")
              .map((item) => ({
                name: item.filename,
                path: relativePath ? `${relativePath}/${item.filename}` : item.filename,
                isDir: (item.attrs.mode & 0o170000) === 0o040000,
                size: item.attrs.size,
                mtime: new Date(item.attrs.mtime * 1000).toISOString(),
              }))
              .sort((a, b) => {
                if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
                return a.name.localeCompare(b.name);
              });
            resolveEntries(entries);
          });
        }),
      );

      res.json({ path: relativePath, entries });
    } else {
      // Local filesystem
      const fullPath = resolvePath(baseDir, relativePath);
      const dirStat = await stat(fullPath);
      if (!dirStat.isDirectory()) {
        res.status(400).json({ error: "Not a directory" });
        return;
      }

      const items = await readdir(fullPath, { withFileTypes: true });
      const entries: FileEntry[] = [];

      for (const item of items) {
        if (item.name.startsWith(".")) continue;
        try {
          const itemPath = join(fullPath, item.name);
          const itemStat = await stat(itemPath);
          entries.push({
            name: item.name,
            path: relativePath ? `${relativePath}/${item.name}` : item.name,
            isDir: item.isDirectory(),
            size: itemStat.size,
            mtime: itemStat.mtime.toISOString(),
          });
        } catch {
          // skip inaccessible entries
        }
      }

      entries.sort((a, b) => {
        if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
        return a.name.localeCompare(b.name);
      });

      res.json({ path: relativePath, entries });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to list files";
    if (message === "Project not found") {
      res.status(404).json({ error: message });
      return;
    }
    logger.error("[Files] List failed", { error: message });
    res.status(500).json({ error: message });
  }
});

// GET /api/projects/:id/files/read?path=...&connectionId=...
router.get("/:id/files/read", async (req, res) => {
  try {
    const project = await loadProject(req.params.id);
    const relativePath = (req.query.path as string)?.trim();
    const connectionIdParam = req.query.connectionId as string;
    const connectionId = connectionIdParam ? parseInt(connectionIdParam, 10) : null;

    if (!relativePath) {
      res.status(400).json({ error: "File path is required" });
      return;
    }

    const baseDir = project.directory;
    if (!baseDir) {
      res.status(400).json({ error: "Project directory not configured" });
      return;
    }

    if (connectionId) {
      const connection = await loadConnection(connectionId);
      const remotePath = `${baseDir}/${relativePath}`;

      const content = await runSFTP(connection, (sftp) =>
        new Promise<string>((resolveContent, rejectContent) => {
          const chunks: Buffer[] = [];
          const stream = sftp.createReadStream(remotePath, { highWaterMark: MAX_FILE_SIZE });

          stream.on("data", (chunk: Buffer) => {
            chunks.push(chunk);
            const totalSize = chunks.reduce((sum, c) => sum + c.length, 0);
            if (totalSize > MAX_FILE_SIZE) {
              stream.destroy();
              rejectContent(new Error("File too large"));
            }
          });

          stream.on("end", () => {
            const buf = Buffer.concat(chunks);
            // Check for binary
            const checkLen = Math.min(buf.length, 8192);
            for (let i = 0; i < checkLen; i++) {
              if (buf[i] === 0) {
                rejectContent(new Error("Binary file"));
                return;
              }
            }
            resolveContent(buf.toString("utf8"));
          });

          stream.on("error", (err: Error) => rejectContent(err));
        }),
      );

      res.json({ path: relativePath, content });
    } else {
      const fullPath = resolvePath(baseDir, relativePath);
      const fileStat = await stat(fullPath);

      if (fileStat.isDirectory()) {
        res.status(400).json({ error: "Cannot read a directory" });
        return;
      }
      if (fileStat.size > MAX_FILE_SIZE) {
        res.status(400).json({ error: "File too large" });
        return;
      }
      if (await isBinaryFile(fullPath)) {
        res.status(400).json({ error: "Binary file" });
        return;
      }

      const content = await readFile(fullPath, "utf8");
      res.json({ path: relativePath, content });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to read file";
    if (message === "Project not found") {
      res.status(404).json({ error: message });
      return;
    }
    logger.error("[Files] Read failed", { error: message });
    res.status(500).json({ error: message });
  }
});

// PUT /api/projects/:id/files/write
router.put("/:id/files/write", async (req, res) => {
  try {
    const project = await loadProject(req.params.id);
    const { path: relativePath, content } = req.body as { path?: string; content?: string };
    const connectionIdParam = req.query.connectionId as string;
    const connectionId = connectionIdParam ? parseInt(connectionIdParam, 10) : null;

    if (!relativePath || typeof relativePath !== "string") {
      res.status(400).json({ error: "File path is required" });
      return;
    }
    if (typeof content !== "string") {
      res.status(400).json({ error: "Content is required" });
      return;
    }
    if (content.length > MAX_FILE_SIZE) {
      res.status(400).json({ error: "Content too large" });
      return;
    }

    const baseDir = project.directory;
    if (!baseDir) {
      res.status(400).json({ error: "Project directory not configured" });
      return;
    }

    if (connectionId) {
      const connection = await loadConnection(connectionId);
      const remotePath = `${baseDir}/${relativePath}`;

      await runSFTP(connection, (sftp) =>
        new Promise<void>((resolveWrite, rejectWrite) => {
          const stream = sftp.createWriteStream(remotePath);
          stream.on("error", (err: Error) => rejectWrite(err));
          stream.on("close", () => resolveWrite());
          stream.end(Buffer.from(content, "utf8"));
        }),
      );

      res.json({ ok: true, path: relativePath });
    } else {
      const fullPath = resolvePath(baseDir, relativePath);
      await writeFile(fullPath, content, "utf8");
      res.json({ ok: true, path: relativePath });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to write file";
    if (message === "Project not found") {
      res.status(404).json({ error: message });
      return;
    }
    logger.error("[Files] Write failed", { error: message });
    res.status(500).json({ error: message });
  }
});

export default router;
