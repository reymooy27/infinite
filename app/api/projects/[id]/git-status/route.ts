import { NextRequest, NextResponse } from "next/server";
import { GitActionError, getGitStatus } from "../git/_lib";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const requestedDirectory = req.nextUrl.searchParams.get("directory")?.trim() || null;
    const connectionIdParam = req.nextUrl.searchParams.get("connectionId");
    const connectionId = connectionIdParam ? Number.parseInt(connectionIdParam, 10) : null;

    const payload = await getGitStatus({
      projectId: id,
      requestedDirectory,
      connectionId,
    });

    return NextResponse.json(payload);
  } catch (error) {
    if (error instanceof GitActionError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode });
    }
    return NextResponse.json({ error: "Failed to fetch git status" }, { status: 500 });
  }
}
