import "dotenv/config";
import express from "express";
import { createServer } from "http";
import { WebSocketServer } from "ws";
import cors from "cors";
import type { IncomingMessage } from "http";
import { prisma } from "./lib/prisma";
import { decrypt } from "./lib/crypto";
import { createSSHSocket } from "./lib/ssh";

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ noServer: true });

app.use(cors());
app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

interface ConnectionRow {
  id: number;
  name: string;
  host: string;
  port: number;
  username: string;
  authType: string;
  passwordEncrypted: string | null;
  privateKeyEncrypted: string | null;
}

server.on("upgrade", (req: IncomingMessage, socket, head) => {
  const pathname = req.url ? new URL(req.url, "http://localhost").pathname : "";

  if (pathname === "/ws/ssh") {
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit("connection", ws, req);
    });
  } else {
    socket.destroy();
  }
});

wss.on("connection", async (ws, req) => {
  const rawUrl = req.url || "";
  const u = new URL(rawUrl, "http://localhost");
  const connId = parseInt(u.searchParams.get("connectionId") || "0", 10);

  if (!connId) {
    ws.send(JSON.stringify({ type: "error", message: "Missing connectionId" }));
    ws.close();
    return;
  }

  const row = (await prisma.connection.findUnique({
    where: { id: connId },
  })) as ConnectionRow | null;
  if (!row) {
    ws.send(JSON.stringify({ type: "error", message: "Connection not found" }));
    ws.close();
    return;
  }

  const secret = process.env.ENCRYPTION_SECRET;
  if (!secret) {
    ws.send(
      JSON.stringify({ type: "error", message: "ENCRYPTION_SECRET not set" }),
    );
    ws.close();
    return;
  }

  const connection: {
    id: number;
    name: string;
    host: string;
    port: number;
    username: string;
    authType: "password" | "key";
    password?: string;
    privateKey?: string;
  } = {
    id: row.id,
    name: row.name,
    host: row.host,
    port: row.port,
    username: row.username,
    authType: row.authType as "password" | "key",
  };

  if (row.passwordEncrypted) {
    connection.password = decrypt(row.passwordEncrypted, secret);
  }
  if (row.privateKeyEncrypted) {
    connection.privateKey = decrypt(row.privateKeyEncrypted, secret);
  }

  createSSHSocket(connection, ws as Parameters<typeof createSSHSocket>[1]);
});

const PORT = process.env.WS_PORT || 3001;
server.listen(PORT, () => {
  console.log(`WebSocket server running on port ${PORT}`);
});