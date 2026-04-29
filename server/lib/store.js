import Database from "better-sqlite3";
import { mkdirSync } from "fs";
import { dirname } from "path";
import { encrypt, decrypt } from "./crypto.js";

const DB_PATH = process.env.SSH_DB_PATH || "./data/ssh.sqlite";
const SECRET = process.env.ENCRYPTION_SECRET;

if (!SECRET) {
  console.error("ENCRYPTION_SECRET env var is required. Copy .env.example to .env and set it.");
  process.exit(1);
}

let db;

export function getDb() {
  if (!db) {
    mkdirSync(dirname(DB_PATH), { recursive: true });
    db = new Database(DB_PATH);
    db.pragma("journal_mode = WAL");
    db.exec(`
      CREATE TABLE IF NOT EXISTS connections (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        host TEXT NOT NULL,
        port INTEGER NOT NULL DEFAULT 22,
        username TEXT NOT NULL,
        auth_type TEXT NOT NULL DEFAULT 'password',
        password_encrypted TEXT,
        private_key_encrypted TEXT,
        created_at TEXT DEFAULT (datetime('now'))
      )
    `);
  }
  return db;
}

export function listConnections() {
  const db = getDb();
  return db.prepare("SELECT id, name, host, port, username, auth_type, created_at FROM connections ORDER BY created_at DESC").all();
}

export function getConnection(id) {
  const db = getDb();
  const row = db.prepare("SELECT * FROM connections WHERE id = ?").get(id);
  if (!row) return null;
  const result = {
    id: row.id,
    name: row.name,
    host: row.host,
    port: row.port,
    username: row.username,
    authType: row.auth_type,
  };
  if (row.password_encrypted) {
    result.password = decrypt(row.password_encrypted, SECRET);
  }
  if (row.private_key_encrypted) {
    result.privateKey = decrypt(row.private_key_encrypted, SECRET);
  }
  return result;
}

export function createConnection({ name, host, port, username, authType, password, privateKey }) {
  const db = getDb();
  const result = db.prepare(`
    INSERT INTO connections (name, host, port, username, auth_type, password_encrypted, private_key_encrypted)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    name,
    host,
    port || 22,
    username,
    authType || "password",
    password ? encrypt(password, SECRET) : null,
    privateKey ? encrypt(privateKey, SECRET) : null,
  );
  return { id: result.lastInsertRowid, name, host, port: port || 22, username, authType: authType || "password" };
}

export function deleteConnection(id) {
  const db = getDb();
  return db.prepare("DELETE FROM connections WHERE id = ?").run(id);
}