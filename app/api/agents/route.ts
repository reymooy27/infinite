import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { randomUUID } from "crypto";

async function getUserId() {
  const session = await auth();
  return session?.user?.id;
}

export async function GET() {
  const userId = await getUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const agents = await prisma.agent.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    select: { id: true, name: true, token: true, createdAt: true },
  });

  // Enrich with online status — requires server-side check via /api/agents/status
  return NextResponse.json(agents);
}

export async function POST(req: NextRequest) {
  const userId = await getUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { name } = await req.json();
  if (!name?.trim()) return NextResponse.json({ error: "Name is required" }, { status: 400 });

  const agent = await prisma.agent.create({
    data: { name: String(name).trim().slice(0, 100), token: randomUUID(), userId },
    select: { id: true, name: true, token: true, createdAt: true },
  });

  return NextResponse.json(agent, { status: 201 });
}
