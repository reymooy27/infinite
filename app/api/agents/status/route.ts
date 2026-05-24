import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { LOCAL_USER_ID } from "@/lib/auth";

export async function GET() {
  const wsUrl = process.env.NEXT_PUBLIC_WS_URL?.replace("wss://", "https://").replace("ws://", "http://");
  if (!wsUrl) return NextResponse.json({ online: [] });

  try {
    const agents = await prisma.agent.findMany({
      where: { userId: LOCAL_USER_ID },
      select: { id: true },
    });
    const ids = agents.map((a) => a.id);

    const res = await fetch(`${wsUrl}/api/agents/online`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids }),
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return NextResponse.json({ online: [] });
    return NextResponse.json(await res.json());
  } catch {
    return NextResponse.json({ online: [] });
  }
}
