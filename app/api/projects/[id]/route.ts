import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { LOCAL_USER_ID } from "@/lib/auth";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const project = await prisma.project.findFirst({
      where: { id, userId: LOCAL_USER_ID },
    });
    if (!project) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json(project);
  } catch {
    return NextResponse.json({ error: "Failed to fetch project" }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { name, directory } = await req.json();
    if (!name || typeof name !== "string") {
      return NextResponse.json({ error: "name is required" }, { status: 400 });
    }
    const project = await prisma.project.updateMany({
      where: { id, userId: LOCAL_USER_ID },
      data: {
        name,
        // null clears the field; undefined means "not provided, leave unchanged"
        ...(directory !== undefined && { directory: directory || null }),
      },
    });
    if (project.count === 0) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Failed to update project" }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const count = await prisma.project.count({ where: { userId: LOCAL_USER_ID } });
    if (count <= 1) {
      return NextResponse.json({ error: "Cannot delete the last project" }, { status: 409 });
    }
    await prisma.project.deleteMany({ where: { id, userId: LOCAL_USER_ID } });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Failed to delete project" }, { status: 500 });
  }
}
