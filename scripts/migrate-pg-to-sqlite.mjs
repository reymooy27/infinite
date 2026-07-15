// One-off migration: copy data from a legacy PostgreSQL database into the new
// SQLite database. Encrypted credential columns (passwordEncrypted,
// privateKeyEncrypted, apiKeyEncrypted) are copied verbatim — the
// ENCRYPTION_SECRET is unchanged, so the app can still decrypt them.
//
// Usage:
//   OLD_DATABASE_URL=postgresql://infinite:infinite@localhost:5432/infinite \
//   DATABASE_URL=file:./infinite.db \
//   node scripts/migrate-pg-to-sqlite.mjs
//
// Requires `prisma generate` to have run so @prisma/client exists.

import { Pool } from "pg";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "@prisma/client";

const OLD_DATABASE_URL = process.env.OLD_DATABASE_URL;
const DATABASE_URL = process.env.DATABASE_URL;

if (!OLD_DATABASE_URL || !DATABASE_URL) {
  console.error(
    "Set OLD_DATABASE_URL (Postgres) and DATABASE_URL (SQLite) before running.",
  );
  process.exit(1);
}

const oldPool = new Pool({ connectionString: OLD_DATABASE_URL });
const sqliteAdapter = new PrismaBetterSqlite3({ url: DATABASE_URL });
const sqlite = new PrismaClient({ adapter: sqliteAdapter });

async function tableCount(model, table) {
  const res = await oldPool.query(`SELECT COUNT(*)::int AS n FROM ${table}`);
  return Number(res.rows[0].n);
}

async function migrateTable(table, insertFn) {
  const count = await tableCount(table, table);
  if (count === 0) {
    console.log(`- ${table}: empty, skipping`);
    return;
  }
  const existing = await sqlite[model].count();
  if (existing > 0) {
    console.log(`- ${table}: target already has ${existing} rows, skipping`);
    return;
  }
  const res = await oldPool.query(`SELECT * FROM ${table}`);
  for (const row of res.rows) {
    await insertFn(row);
  }
  console.log(`- ${table}: copied ${res.rows.length} rows`);
}

async function main() {
  console.log("Migrating Postgres -> SQLite");

  await migrateTable("connections", (r) =>
    sqlite.connection.create({
      data: {
        id: r.id,
        name: r.name,
        host: r.host,
        port: r.port,
        username: r.username,
        authType: r.auth_type,
        passwordEncrypted: r.password_encrypted,
        privateKeyEncrypted: r.private_key_encrypted,
        createdAt: r.created_at,
        userId: r.user_id,
        agentId: r.agent_id,
      },
    }),
  );

  await migrateTable("layouts", (r) =>
    sqlite.layout.create({
      data: {
        id: r.id,
        userId: r.user_id,
        data: r.data,
        updatedAt: r.updated_at,
      },
    }),
  );

  await migrateTable("agents", (r) =>
    sqlite.agent.create({
      data: {
        id: r.id,
        name: r.name,
        token: r.token,
        userId: r.user_id,
        createdAt: r.created_at,
      },
    }),
  );

  await migrateTable("bookmarks", (r) =>
    sqlite.bookmark.create({
      data: {
        id: r.id,
        url: r.url,
        userId: r.user_id,
        createdAt: r.created_at,
      },
    }),
  );

  await migrateTable("notes", (r) =>
    sqlite.note.create({
      data: {
        id: r.id,
        title: r.title,
        content: r.content,
        userId: r.user_id,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      },
    }),
  );

  await migrateTable("projects", (r) =>
    sqlite.project.create({
      data: {
        id: r.id,
        name: r.name,
        userId: r.user_id,
        directory: r.directory,
        canvasData: r.canvas_data,
        canvasTransform: r.canvas_transform,
        isDefault: r.is_default,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      },
    }),
  );

  await migrateTable("ai_providers", (r) =>
    sqlite.aIProvider.create({
      data: {
        id: r.id,
        name: r.name,
        baseUrl: r.base_url,
        userId: r.user_id,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      },
    }),
  );

  await migrateTable("ai_keys", (r) =>
    sqlite.aIKey.create({
      data: {
        id: r.id,
        label: r.label,
        apiKeyEncrypted: r.api_key_encrypted,
        providerId: r.provider_id,
        userId: r.user_id,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      },
    }),
  );

  console.log("Done.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await oldPool.end();
    await sqlite.$disconnect();
  });
