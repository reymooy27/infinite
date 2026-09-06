import { Router, type Request, type Response } from "express";
import { logger } from "../lib/logger.js";

const router = Router();

interface TranslateRequest {
  text: string;
  apiKey?: string;
  model?: string;
}

interface TranslateResponse {
  translated: string;
  original: string;
  source: "rule" | "ai";
}

const SYSTEM_PROMPT = `You are a voice-to-command translator for Linux/Unix terminals.
Convert natural language (Indonesian or English) into executable shell commands.

Rules:
- Output ONLY the command, no explanations, no markdown, no extra text
- If the input is already a valid command, return it as-is
- For Indonesian input, translate to appropriate Linux commands
- For ambiguous input, return the most likely safe command
- Prefer safe, non-destructive commands
- Common patterns:
  - "buat folder nama" → "mkdir nama"
  - "lihat isi folder" → "ls -la"
  - "jalankan server port 3000" → "npm run dev -- --port 3000"
  - "masuk ke folder" → "cd folder"
  - "hapus file" → "rm file"
  - "copy file ke" → "cp file destination"
  - "cari file" → "find . -name 'file'"
  - "grep text" → "grep -r 'text' ."
  - "git commit" → "git add -A && git commit -m 'update'"
  - "git push" → "git push"
  - "git pull" → "git pull"
  - "clear" → "clear"
  - "history" → "history"
  - "siapa saya" → "whoami"
  - "di mana saya" → "pwd"

Examples:
Input: "buat folder baru namanya project"
Output: mkdir project

Input: "lihat isi folder sekarang"
Output: ls -la

Input: "jalankan npm run dev di port 3000"
Output: npm run dev -- --port 3000

Input: "masuk ke folder documents"
Output: cd documents

Input: "hapus file lama.txt"
Output: rm lama.txt`;

// Rule-based fallback (no AI needed)
function ruleBasedTranslate(text: string): string {
  const lower = text.toLowerCase().trim();

  const patterns: [RegExp, string][] = [
    [/^(buat|bikin|buatkan)\s+(folder|direktori)\s+(baru\s+)?(namanya|bernama)\s+(\S+)/, "mkdir $5"],
    [/^(buat|bikin|buatkan)\s+(folder|direktori)\s+(\S+)/, "mkdir $3"],
    [/^(lihat|tampilkan|tunjukin)\s+(isi|konten)\s+(folder|direktori|directory)\s*(ini|sekarang|saat ini)?/, "ls -la"],
    [/^(lihat|tampilkan|tunjukin)\s+(file|files)\s*(di\s+(\S+))?/, "ls -la $4"],
    [/^(jalankan|running|run)\s+(\S+)/, "$2"],
    [/^(jalankan|running|run)\s+(server|aplikasi|app)\s+(di\s+port|port)\s+(\d+)/, "npm run dev -- --port $4"],
    [/^(masuk|cd|change directory)\s+(ke\s+)?(\S+)/, "cd $3"],
    [/^(balik|kembali|back)\s+(ke\s+)?(folder|direktori)\s+(sebelumnya|previous)/, "cd -"],
    [/^(hapus|delete|remove)\s+(file|folder|direktori)\s+(\S+)/, "rm -rf $3"],
    [/^(copy|salinin)\s+(\S+)\s+(ke|to)\s+(\S+)/, "cp -r $2 $4"],
    [/^(pindah|move)\s+(\S+)\s+(ke|to)\s+(\S+)/, "mv $2 $4"],
    [/^(cari|find)\s+(\S+)/, "find . -name '*$2*'"],
    [/^(grep|cari di dalam)\s+(\S+)/, "grep -r '$2' ."],
    [/^(install|pasang)\s+(\S+)/, "npm install $2"],
    [/^(update|upgrade)\s+(\S+)?/, "npm update $2"],
    [/^(git\s+)?(commit|simpan)\s+(perubahan|changes)/, "git add -A && git commit -m 'update'"],
    [/^(git\s+)?(push|dorong)/, "git push"],
    [/^(git\s+)?(pull|tarik)/, "git pull"],
    [/^(clear|bersihkan|bersih)/, "clear"],
    [/^(history|riwayat)/, "history"],
    [/^(siapa|whoami)/, "whoami"],
    [/^(di mana|pwd|where am i)/, "pwd"],
  ];

  for (const [pattern, replacement] of patterns) {
    const match = lower.match(pattern);
    if (match) {
      return lower.replace(pattern, replacement);
    }
  }

  return text;
}

const NINEROUTER_BASE_URL = process.env.ROUTER_USAGE_BASE_URL || "https://api.9router.com";
const NINEROUTER_API_KEY = process.env.ROUTER_USAGE_API_KEY || process.env.NINEROUTER_API_KEY || "";
const NINEROUTER_MODEL = process.env.NINEROUTER_MODEL || "gpt-4o-mini";

async function translateWith9Router(text: string, apiKey?: string, model?: string): Promise<string | null> {
  const key = apiKey || NINEROUTER_API_KEY;
  const modelName = model || NINEROUTER_MODEL;
  if (!key) return null;

  try {
    const res = await fetch(`${NINEROUTER_BASE_URL}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${NINEROUTER_API_KEY}`,
      },
      body: JSON.stringify({
        model: modelName,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: text },
        ],
        temperature: 0,
        max_tokens: 100,
      }),
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) {
      logger.warn("[VoiceTranslate] 9router request failed", { status: res.status });
      return null;
    }

    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    return data.choices?.[0]?.message?.content?.trim() || null;
  } catch (err) {
    logger.warn("[VoiceTranslate] 9router error", {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

// POST /api/voice/translate
router.post("/translate", async (req: Request, res: Response) => {
  try {
    const { text, apiKey, model } = req.body as TranslateRequest;

    if (!text || typeof text !== "string") {
      res.status(400).json({ error: "Text is required" });
      return;
    }

    const aiResult = await translateWith9Router(text, apiKey, model);
    if (aiResult) {
      res.json({ translated: aiResult, original: text, source: "ai" } as TranslateResponse);
      return;
    }

    const ruleResult = ruleBasedTranslate(text);

    if (ruleResult !== text) {
      res.json({ translated: ruleResult, original: text, source: "rule" } as TranslateResponse);
      return;
    }

    res.json({ translated: text, original: text, source: "rule" } as TranslateResponse);
  } catch (err) {
    logger.error("[VoiceTranslate] Error", { error: err instanceof Error ? err.message : String(err) });
    res.status(500).json({ error: "Translation failed" });
  }
});

export default router;