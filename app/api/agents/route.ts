import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { LOCAL_USER_ID } from "@/lib/auth";
import { randomUUID } from "crypto";

export async function GET() {
  const agents = await prisma.agent.findMany({
    where: { userId: LOCAL_USER_ID },
    orderBy: { createdAt: "desc" },
    select: { id: true, name: true, token: true, createdAt: true },
  });

  return NextResponse.json(agents);
}

export async function POST(req: NextRequest) {
  const { name } = await req.json();
  if (!name?.trim()) return NextResponse.json({ error: "Name is required" }, { status: 400 });

  const agent = await prisma.agent.create({
    data: { name: String(name).trim().slice(0, 100), token: randomUUID(), userId: LOCAL_USER_ID },
    select: { id: true, name: true, token: true, createdAt: true },
  });

  return NextResponse.json(agent, { status: 201 });
}
