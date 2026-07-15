import { NextRequest, NextResponse } from "next/server";
import { GitActionError, getCommitDiff } from "../_lib";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const hash = req.nextUrl.searchParams.get("hash")?.trim();
    const directory = req.nextUrl.searchParams.get("directory")?.trim() || null;
    const connectionIdParam = req.nextUrl.searchParams.get("connectionId");
    const connectionId = connectionIdParam ? Number.parseInt(connectionIdParam, 10) : null;

    if (!hash) {
      return NextResponse.json({ error: "Commit hash is required" }, { status: 400 });
    }

    const result = await getCommitDiff({
      projectId: id,
      hash,
      requestedDirectory: directory,
      connectionId,
    });

    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof GitActionError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode });
    }
    return NextResponse.json({ error: "Failed to fetch commit diff" }, { status: 500 });
  }
}
