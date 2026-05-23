import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

// Asks the Fly WS server which agents are currently connected
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const wsUrl = process.env.NEXT_PUBLIC_WS_URL?.replace("wss://", "https://").replace("ws://", "http://");
  if (!wsUrl) return NextResponse.json({ online: [] });

  try {
    const agents = await prisma.agent.findMany({
      where: { userId: session.user.id },
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
