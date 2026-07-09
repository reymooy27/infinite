import { NextRequest, NextResponse } from "next/server";
import { GitActionError, type GitAction, runGitAction } from "../../git/_lib";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type GitActionRequest = {
  action?: GitAction;
  connectionId?: number;
  directory?: string;
  paths?: string[];
  message?: string;
  branch?: string;
};

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = (await req.json()) as GitActionRequest;

    if (!body.action) {
      return NextResponse.json({ error: "Git action is required" }, { status: 400 });
    }

    const result = await runGitAction({
      projectId: id,
      requestedDirectory: body.directory?.trim() || null,
      connectionId:
        typeof body.connectionId === "number" && Number.isFinite(body.connectionId)
          ? body.connectionId
          : null,
      action: body.action,
      paths: body.paths,
      message: body.message,
      branch: body.branch,
    });

    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof GitActionError) {
      return NextResponse.json(
        {
          ok: false,
          error: error.message,
          stdout: error.stdout,
          stderr: error.stderr,
        },
        { status: error.statusCode },
      );
    }

    return NextResponse.json(
      {
        ok: false,
        error: "Failed to run git action",
        stdout: "",
        stderr: "",
      },
      { status: 500 },
    );
  }
}
