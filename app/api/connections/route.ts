import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { encrypt } from "@/lib/crypto";
import { logger, logApiRequest } from "@/lib/logger";

export async function GET(req: NextRequest) {
  const start = Date.now();
  const method = "GET";
  const path = "/api/connections";

  try {
    logger.info(`[${method}] ${path} Start`);

    const connections = await prisma.connection.findMany({
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        name: true,
        host: true,
        port: true,
        username: true,
        authType: true,
        createdAt: true,
      },
    });

    const duration = Date.now() - start;
    logApiRequest(method, path, 200, duration);
    return NextResponse.json(connections);
  } catch (err) {
    const duration = Date.now() - start;
    const error = err instanceof Error ? err.message : "Unknown error";
    logger.error(`[${method}] ${path} Error`, { error, stack: err instanceof Error ? err.stack : undefined });
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
    const { name, host, port, username, authType, password, privateKey } = body;

    if (!name || !host || !username) {
      const duration = Date.now() - start;
      logger.warn(`[${method}] ${path} Validation failed: missing required fields`);
      logApiRequest(method, path, 400, duration);
      return NextResponse.json({ error: "Missing required fields: name, host, username" }, { status: 400 });
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
        name,
        host,
        port: port || 22,
        username,
        authType: authType || "password",
        passwordEncrypted: password ? encrypt(password, secret) : null,
        privateKeyEncrypted: privateKey ? encrypt(privateKey, secret) : null,
      },
      select: {
        id: true,
        name: true,
        host: true,
        port: true,
        username: true,
        authType: true,
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
    logger.error(`[${method}] ${path} Error`, { error, stack: err instanceof Error ? err.stack : undefined });
    logApiRequest(method, path, 500, duration, err);
    return NextResponse.json({ error: "Failed to create connection" }, { status: 500 });
  }
}