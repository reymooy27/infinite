import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { LOCAL_USER_ID } from "@/lib/auth";

type ProjectCanvasData = {
  windows?: unknown[];
};

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const project = await prisma.project.findFirst({
      where: { id, userId: LOCAL_USER_ID },
      select: { canvasData: true, canvasTransform: true },
    });
    if (!project) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const canvasData = project.canvasData as ProjectCanvasData | null;
    return NextResponse.json({
      windows: Array.isArray(canvasData?.windows) ? canvasData.windows : [],
      canvasTransform: project.canvasTransform ?? null,
    });
  } catch {
    return NextResponse.json({ error: "Failed to fetch canvas" }, { status: 500 });
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { windows, canvasTransform } = await req.json();
    const updated = await prisma.project.updateMany({
      where: { id, userId: LOCAL_USER_ID },
      data: {
        canvasData: { windows: windows ?? [] },
        ...(canvasTransform !== undefined && { canvasTransform }),
      },
    });
    if (updated.count === 0) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Failed to save canvas" }, { status: 500 });
  }
}
