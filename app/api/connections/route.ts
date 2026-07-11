import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { encrypt } from "@/lib/crypto";
import { logger, logApiRequest } from "@/lib/logger";
import { LOCAL_USER_ID } from "@/lib/auth";

export async function GET(_req: NextRequest) {
  void _req;
  const start = Date.now();
  const method = "GET";
  const path = "/api/connections";

  try {
    logger.info(`[${method}] ${path} Start`);

    const connections = await prisma.connection.findMany({
      where: { userId: LOCAL_USER_ID },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        name: true,
        host: true,
        port: true,
        username: true,
        authType: true,
        agentId: true,
        createdAt: true,
      },
    });

    const duration = Date.now() - start;
    logApiRequest(method, path, 200, duration);
    return NextResponse.json({ connections, limit: 999, plan: "local" });
  } catch (err) {
    const duration = Date.now() - start;
    const error = err instanceof Error ? err.message : "Unknown error";
    logger.error(`[${method}] ${path} Error`, { error });
    logApiRequest(method, path, 500, duration, err);
    return NextResponse.json({ error: "Failed to fetch connections" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const start = Date.now();
  const method = "POST";
  const path = "/api/connections";

  try {
    logger.info(`[${method}] ${path} Start`);

    const body = await req.json();
    const { name, host, port, username, authType, password, privateKey, agentId } = body;

    if (!name || !host || !username) {
      const duration = Date.now() - start;
      logApiRequest(method, path, 400, duration);
      return NextResponse.json({ error: "Missing required fields: name, host, username" }, { status: 400 });
    }

    const trimmedName = String(name).trim().slice(0, 100);
    const rawHost = String(host).trim();
    const trimmedHost = (rawHost.includes("://") ? new URL(rawHost.startsWith("http") ? rawHost : `https://${rawHost}`).hostname : rawHost).slice(0, 255);
    const trimmedUsername = String(username).trim().slice(0, 64);
    const parsedPort = Math.min(65535, Math.max(1, parseInt(port) || 22));

    if (!/^[a-zA-Z0-9._\-]+$/.test(trimmedHost) && !/^\d{1,3}(\.\d{1,3}){3}$/.test(trimmedHost)) {
      const duration = Date.now() - start;
      logApiRequest(method, path, 400, duration);
      return NextResponse.json({ error: "Invalid hostname" }, { status: 400 });
    }

    if (!/^[a-zA-Z0-9._\-]+$/.test(trimmedUsername)) {
      const duration = Date.now() - start;
      logApiRequest(method, path, 400, duration);
      return NextResponse.json({ error: "Invalid username" }, { status: 400 });
    }

    const secret = process.env.ENCRYPTION_SECRET;
    if (!secret) {
      const duration = Date.now() - start;
      logger.error(`[${method}] ${path} Error: ENCRYPTION_SECRET not set`);
      logApiRequest(method, path, 500, duration, new Error("ENCRYPTION_SECRET not set"));
      return NextResponse.json({ error: "Server configuration error" }, { status: 500 });
    }

    const connection = await prisma.connection.create({
      data: {
        name: trimmedName,
        host: trimmedHost,
        port: parsedPort,
        username: trimmedUsername,
        authType: authType === "key" ? "key" : "password",
        passwordEncrypted: password ? encrypt(password, secret) : null,
        privateKeyEncrypted: privateKey ? encrypt(privateKey, secret) : null,
        agentId: agentId || null,
        userId: LOCAL_USER_ID,
      },
      select: {
        id: true,
        name: true,
        host: true,
        port: true,
        username: true,
        authType: true,
        agentId: true,
        createdAt: true,
      },
    });

    const duration = Date.now() - start;
    logger.info(`[${method}] ${path} Created connection ${connection.id}`);
    logApiRequest(method, path, 201, duration);
    return NextResponse.json(connection, { status: 201 });
  } catch (err) {
    const duration = Date.now() - start;
    const error = err instanceof Error ? err.message : "Unknown error";
    logger.error(`[${method}] ${path} Error`, { error });
    logApiRequest(method, path, 500, duration, err);
    return NextResponse.json({ error: "Failed to create connection" }, { status: 500 });
  }
}
