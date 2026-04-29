import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { encrypt } from "@/lib/crypto";

export async function GET() {
  try {
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
    return NextResponse.json(connections);
  } catch (err) {
    return NextResponse.json({ error: "Failed to fetch connections" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { name, host, port, username, authType, password, privateKey } = body;
    const secret = process.env.ENCRYPTION_SECRET;
    if (!secret) throw new Error("ENCRYPTION_SECRET not set");

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
    return NextResponse.json(connection, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: "Failed to create connection" }, { status: 500 });
  }
}
