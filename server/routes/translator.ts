import { Router, type Request, type Response } from "express";
import { logger } from "../lib/logger.js";

const router = Router();

/** Reads an SSE body until the first complete `data:` line, then closes it. */
export async function readFirstDataEvent(
  body: ReadableStream<Uint8Array>,
): Promise<string | undefined> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let dataLines: string[] = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split("\n");
      // Keep all lines until we have a complete event (empty line or EOF)
      // but we only care about the first event.
      for (const line of lines) {
        if (line.startsWith("data:")) {
          dataLines.push(line.slice(5).trim());
        } else if (line === "" && dataLines.length > 0) {
          // Found an empty line after data lines => event complete
          // If we have a complete JSON, we can return early.
          const combined = dataLines.join("\n");
          try {
            JSON.parse(combined);
            return combined;
          } catch {
            // Not valid JSON yet, continue collecting more data lines.
          }
        }
      }
      // If we have dataLines but no empty line yet, we might still have a complete JSON (if the data is a single line).
      // But we already checked if we can parse, and if we can't, we need more data.
      // However, we might have the entire JSON on one line without a trailing empty line.
      // So we should also try to parse when we have dataLines and we've read all available data.
      // But we can't know if we've read all data until the stream ends.
      // Simpler: we can check after each chunk if we can parse the accumulated dataLines as JSON.
      const combined = dataLines.join("\n");
      if (combined) {
        try {
          JSON.parse(combined);
          // If it parses, return it (even if no empty line)
          return combined;
        } catch {
          // continue
        }
      }
    }
  } finally {
    await reader.cancel();
  }
  // If we reach here, no valid JSON was found.
  return undefined;
}

// Proxy console logs from translator service
router.get("/console-logs", async (req: Request, res: Response) => {
  const target = process.env.TRANSLATOR_CONSOLE_LOGS_URL ||
    "http://localhost:20128/api/translator/console-logs/stream";

  try {
    const response = await fetch(target, {
      signal: AbortSignal.timeout(8000),
      headers: {
        "Accept": "text/event-stream",
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.error(`[Translator] Console logs fetch failed: ${response.status}`, { errorText });
      res.status(response.status).json({ error: `Translator service error: ${response.status}` });
      return;
    }

    // Upstream is SSE: read until the first complete `data:` line, then close.
    const line = await readFirstDataEvent(response.body!);

    if (!line) {
      res.status(502).json({ error: "Translator stream sent no data event" });
      return;
    }

    // Expect { type: "init", logs: string[] }
    try {
      res.json(JSON.parse(line));
    } catch {
      res.status(502).json({ error: "Translator sent malformed SSE payload" });
    }
  } catch (err) {
    const error = err instanceof Error ? err.message : "Failed to fetch console logs";
    logger.error("[Translator] Console logs proxy error", { error });
    res.status(502).json({ error: "Failed to reach translator service", details: error });
  }
});

export default router;