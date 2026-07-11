import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { encrypt } from "@/lib/crypto";
import { logger, logApiRequest } from "@/lib/logger";
import { LOCAL_USER_ID } from "@/lib/auth";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const start = Date.now();
  const method = "PATCH";
  const path = "/api/connections/[id]";

  try {
    const { id } = await params;
    const connectionId = parseInt(id, 10);

    if (isNaN(connectionId)) {
      const duration = Date.now() - start;
      logApiRequest(method, path, 400, duration);
      return NextResponse.json({ error: "Invalid connection ID" }, { status: 400 });
    }

    const existing = await prisma.connection.findUnique({
      where: { id: connectionId },
      select: {
        id: true,
        userId: true,
        authType: true,
        passwordEncrypted: true,
        privateKeyEncrypted: true,
      },
    });

    if (!existing || existing.userId !== LOCAL_USER_ID) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const body = await req.json();
    const { name, host, port, username, authType, password, privateKey, agentId } = body;

    if (!name || !host || !username) {
      const duration = Date.now() - start;
      logApiRequest(method, path, 400, duration);
      return NextResponse.json({ error: "Missing required fields: name, host, username" }, { status: 400 });
    }

    const trimmedName = String(name).trim().slice(0, 100);
    const rawHost = String(host).trim();
    const trimmedHost = (
      rawHost.includes("://")
        ? new URL(rawHost.startsWith("http") ? rawHost : `https://${rawHost}`).hostname
        : rawHost
    ).slice(0, 255);
    const trimmedUsername = String(username).trim().slice(0, 64);
    const parsedPort = Math.min(65535, Math.max(1, parseInt(port) || 22));
    const normalizedAuthType = authType === "key" ? "key" : "password";

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

    let passwordEncrypted: string | null = null;
    let privateKeyEncrypted: string | null = null;

    if (normalizedAuthType === "password") {
      if (typeof password === "string" && password.trim()) {
        passwordEncrypted = encrypt(password, secret);
      } else if (existing.authType === "password" && existing.passwordEncrypted) {
        passwordEncrypted = existing.passwordEncrypted;
      } else {
        const duration = Date.now() - start;
        logApiRequest(method, path, 400, duration);
        return NextResponse.json({ error: "Password is required for password auth" }, { status: 400 });
      }
    } else {
      if (typeof privateKey === "string" && privateKey.trim()) {
        privateKeyEncrypted = encrypt(privateKey, secret);
      } else if (existing.authType === "key" && existing.privateKeyEncrypted) {
        privateKeyEncrypted = existing.privateKeyEncrypted;
      } else {
        const duration = Date.now() - start;
        logApiRequest(method, path, 400, duration);
        return NextResponse.json({ error: "Private key is required for key auth" }, { status: 400 });
      }
    }

    const connection = await prisma.connection.update({
      where: { id: connectionId },
      data: {
        name: trimmedName,
        host: trimmedHost,
        port: parsedPort,
        username: trimmedUsername,
        authType: normalizedAuthType,
        passwordEncrypted,
        privateKeyEncrypted,
        agentId: agentId || null,
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
    logger.info(`[${method}] ${path} Updated connection ${connectionId}`);
    logApiRequest(method, path, 200, duration);
    return NextResponse.json(connection);
  } catch (err) {
    const duration = Date.now() - start;
    const error = err instanceof Error ? err.message : "Unknown error";
    logger.error(`[${method}] ${path} Error`, { error });
    logApiRequest(method, path, 500, duration, err);
    return NextResponse.json({ error: "Failed to update connection" }, { status: 500 });
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const start = Date.now();
  const method = "DELETE";
  const path = "/api/connections/[id]";

  try {
    const { id } = await params;
    const connectionId = parseInt(id, 10);

    if (isNaN(connectionId)) {
      const duration = Date.now() - start;
      logApiRequest(method, path, 400, duration);
      return NextResponse.json({ error: "Invalid connection ID" }, { status: 400 });
    }

    const existing = await prisma.connection.findUnique({
      where: { id: connectionId },
      select: { userId: true },
    });

    if (!existing || existing.userId !== LOCAL_USER_ID) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    await prisma.connection.delete({ where: { id: connectionId } });

    const duration = Date.now() - start;
    logger.info(`[${method}] ${path} Deleted connection ${connectionId}`);
    logApiRequest(method, path, 200, duration);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const duration = Date.now() - start;
    const error = err instanceof Error ? err.message : "Unknown error";
    logger.error(`[${method}] ${path} Error`, { error });
    logApiRequest(method, path, 500, duration, err);
    return NextResponse.json({ error: "Failed to delete connection" }, { status: 500 });
  }
}
