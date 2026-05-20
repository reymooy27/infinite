import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { logger, logApiRequest } from "@/lib/logger";
import { auth } from "@/lib/auth";

export async function GET(req: NextRequest) {
  const start = Date.now();
  const method = "GET";
  const path = "/api/layout";

  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    logger.info(`[${method}] ${path} Start`);

    const layout = await prisma.layout.findFirst({
      where: { userId: session.user.id },
      orderBy: { updatedAt: "desc" },
    });

    const duration = Date.now() - start;
    logApiRequest(method, path, 200, duration);
    return NextResponse.json(layout?.data || { windows: [] });
  } catch (err) {
    const duration = Date.now() - start;
    const error = err instanceof Error ? err.message : "Unknown error";
    logger.error(`[${method}] ${path} Error`, { error });
    logApiRequest(method, path, 500, duration, err);
    return NextResponse.json({ error: "Failed to fetch layout" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const start = Date.now();
  const method = "POST";
  const path = "/api/layout";

  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    logger.info(`[${method}] ${path} Start`);

    const body = await req.json();

    const existing = await prisma.layout.findFirst({
      where: { userId: session.user.id },
      orderBy: { updatedAt: "desc" },
    });

    const layout = existing
      ? await prisma.layout.update({
          where: { id: existing.id },
          data: { data: body },
        })
      : await prisma.layout.create({
          data: {
            userId: session.user.id,
            data: body,
          },
        });

    const duration = Date.now() - start;
    logApiRequest(method, path, 200, duration);
    return NextResponse.json(layout.data);
  } catch (err) {
    const duration = Date.now() - start;
    const error = err instanceof Error ? err.message : "Unknown error";
    logger.error(`[${method}] ${path} Error`, { error });
    logApiRequest(method, path, 500, duration, err);
    return NextResponse.json({ error: "Failed to save layout" }, { status: 500 });
  }
}
