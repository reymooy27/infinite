import { NextRequest, NextResponse } from "next/server";
import { GitActionError, createExecutionContext, execGitOrThrow } from "../_lib";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const file = req.nextUrl.searchParams.get("file")?.trim();
    const directory = req.nextUrl.searchParams.get("directory")?.trim() || null;
    const connectionIdParam = req.nextUrl.searchParams.get("connectionId");
    const connectionId = connectionIdParam ? Number.parseInt(connectionIdParam, 10) : null;
    const staged = req.nextUrl.searchParams.get("staged") === "true";

    if (!file) {
      return NextResponse.json({ error: "File path is required" }, { status: 400 });
    }

    const ctx = await createExecutionContext(id, directory, connectionId);

    // Check if file is untracked by looking at git status
    const statusOutput = await execGitOrThrow(ctx, ["status", "--short", "--", file]);
    const isUntracked = statusOutput.startsWith("??");

    let diff: string;

    if (isUntracked) {
      // For untracked files, show full content as diff
      diff = await execGitOrThrow(ctx, ["diff", "--no-color", "--no-index", "/dev/null", file]).catch(() => {
        // If diff fails, try to read the file content directly
        return execGitOrThrow(ctx, ["show", `:${file}`]).catch(() => "Unable to read file content");
      });
    } else {
      // For tracked files, show staged or unstaged diff
      const args = ["diff", "--no-color"];
      if (staged) {
        args.push("--cached");
      }
      args.push("--", file);
      diff = await execGitOrThrow(ctx, args);
    }

    return NextResponse.json({ diff });
  } catch (error) {
    if (error instanceof GitActionError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode });
    }
    return NextResponse.json({ error: "Failed to fetch diff" }, { status: 500 });
  }
}
