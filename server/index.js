import "dotenv/config";
import express from "express";
import { createServer } from "http";
import { WebSocketServer } from "ws";
import cors from "cors";
import url from "url";
import { listConnections, createConnection, deleteConnection, getConnection } from "./lib/store.js";
import { createSSHSocket } from "./lib/ssh.js";

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server, path: "/ws/ssh" });

app.use(cors());
app.use(express.json());

app.get("/api/connections", (req, res) => {
  try {
    res.json(listConnections());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/connections", (req, res) => {
  try {
    const conn = createConnection(req.body);
    res.json(conn);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete("/api/connections/:id", (req, res) => {
  try {
    deleteConnection(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

wss.on("connection", (ws, req) => {
  const params = new URLSearchParams(url.parse(req.url).query);
  const connId = parseInt(params.get("connectionId"), 10);

  if (!connId) {
    ws.send(JSON.stringify({ type: "error", message: "Missing connectionId" }));
    ws.close();
    return;
  }

  const connection = getConnection(connId);
  if (!connection) {
    ws.send(JSON.stringify({ type: "error", message: "Connection not found" }));
    ws.close();
    return;
  }

  createSSHSocket(connection, ws);
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});