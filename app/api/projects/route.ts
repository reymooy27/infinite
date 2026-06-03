import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { LOCAL_USER_ID } from "@/lib/auth";

export async function GET() {
  try {
    const projects = await prisma.project.findMany({
      where: { userId: LOCAL_USER_ID },
      orderBy: { createdAt: "asc" },
      select: { id: true, name: true, directory: true, isDefault: true, createdAt: true, updatedAt: true },
    });
    return NextResponse.json(projects);
  } catch {
    return NextResponse.json({ error: "Failed to fetch projects" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const { name, directory } = await req.json();
    if (!name || typeof name !== "string") {
      return NextResponse.json({ error: "name is required" }, { status: 400 });
    }

    const existing = await prisma.project.count({ where: { userId: LOCAL_USER_ID } });

    // On first project, seed canvasData from existing Layout
    let canvasData: object = { windows: [] };
    if (existing === 0) {
      const layout = await prisma.layout.findFirst({
        where: { userId: LOCAL_USER_ID },
        orderBy: { updatedAt: "desc" },
      });
      if (layout?.data) canvasData = layout.data as object;
    }

    const project = await prisma.project.create({
      data: {
        name,
        userId: LOCAL_USER_ID,
        isDefault: existing === 0,
        canvasData,
        ...(directory && typeof directory === "string" && { directory }),
      },
    });

    return NextResponse.json(project);
  } catch {
    return NextResponse.json({ error: "Failed to create project" }, { status: 500 });
  }
}
