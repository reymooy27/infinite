import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import hljs from "highlight.js/lib/common";
import "highlight.js/styles/github-dark.css";
import {
  AlertCircle,
  Check,
  CheckCircle2,
  ChevronRight,
  Circle,
  Copy,
  Cpu,
  FileText,
  Hammer,
  ListChecks,
  Loader2,
  Mic,
  Paperclip,
  Plus,
  Power,
  Send,
  Square,
  SquareTerminal,
  Trash2,
  X,
} from "lucide-react";
import { api, API_BASE } from "@/lib/api";
import { useProjectStore } from "@/stores/useProjectStore";
import { useSettingsStore } from "@/stores/useSettingsStore";
import ModelPicker from "@/components/ModelPicker";
import SessionPicker, { type PickableSession } from "@/components/SessionPicker";
import VoiceInputOverlay from "@/components/VoiceInputOverlay";
import {
  appendDeltaIn,
  buildMentionParts,
  extractLastTodos,
  upsertInfoIn,
  upsertPartIn,
  type OcMessageEntry,
  type OcPart,
} from "./opencode-parts";
import type { Project } from "@/types";

// Backend contract: /api/opencode/:projectId/{start,stop,status} + proxy to the
// opencode HTTP server. ponytail: proxy may 404/409 while the backend agent
// wires it up — every call treats those as "not running", never a hard error.

interface OcSession {
  id: string;
  title?: string;
  cost?: number;
  time?: { created?: number; updated?: number };
  model?: { id?: string; providerID?: string };
}

interface OcCommand {
  name: string;
  description?: string;
  source?: string;
  hints?: string[];
}

interface OcModel {
  providerID: string;
  providerName: string;
  modelID: string;
  label: string;
  name?: string;
  isDefault?: boolean;
  context?: number;
  toolcall?: boolean;
}

const MODEL_HINT: OcCommand = {
  name: "model",
  description: "Switch model: /model <provider/model>",
};

const MODES = [
  { id: "plan" as const, icon: ListChecks, label: "Plan" },
  { id: "build" as const, icon: Hammer, label: "Build" },
];

interface OcPermission {
  requestID: string;
  sessionID: string;
  label: string;
  detail: string;
}

type PermissionReply = "once" | "always" | "reject";

interface OcQuestionOption {
  label: string;
  description?: string;
}

interface OcQuestionInfo {
  question: string;
  header?: string;
  options: OcQuestionOption[];
  multiple?: boolean;
  custom?: boolean;
}

interface OcQuestion {
  requestID: string;
  sessionID: string;
  questions: OcQuestionInfo[];
}

async function ocReq<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { "Content-Type": "application/json", ...init?.headers },
    ...init,
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    const err = new Error(body.error || `Request failed: ${res.status}`) as Error & {
      status?: number;
    };
    err.status = res.status;
    throw err;
  }
  return res.json() as Promise<T>;
}

function relTime(ts?: number): string {
  if (!ts) return "";
  const diff = Date.now() - ts;
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

interface OcTodo {
  content: string;
  status?: string;
  priority?: string;
}

interface DraftFile {
  id: string;
  name: string;
  mime: string;
  dataUrl: string;
}

const MAX_FILES = 4;
const MAX_FILE_BYTES = 4 * 1024 * 1024;

function readFileAsDataUrl(f: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result));
    fr.onerror = () => reject(fr.error ?? new Error("read failed"));
    fr.readAsDataURL(f);
  });
}

function nodeText(node: unknown): string {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(nodeText).join("");
  return nodeText((node as { props?: { children?: unknown } })?.props?.children);
}

function CodePre({ children }: { children?: React.ReactNode }) {
  const [copied, setCopied] = useState(false);
  const codeEl = (Array.isArray(children) ? children[0] : children) as {
    props?: { className?: string; children?: unknown };
  } | undefined;
  const lang = /^language-([\w+#.-]+)/.exec(String(codeEl?.props?.className ?? ""))?.[1];
  const raw = nodeText(codeEl?.props?.children ?? children).replace(/\n$/, "");
  let html = "";
  try {
    if (raw.length < 100_000) {
      html =
        lang && hljs.getLanguage(lang)
          ? hljs.highlight(raw, { language: lang }).value
          : hljs.highlightAuto(raw).value;
    }
  } catch {
    html = "";
  }
  const flash = () => {
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };
  const copy = () => {
    navigator.clipboard
      ?.writeText(raw)
      .then(flash)
      .catch(() => {
        const ta = document.createElement("textarea");
        ta.value = raw;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        ta.remove();
        flash();
      });
  };
  const cls = `hljs${lang ? ` language-${lang}` : ""}`;
  return (
    <pre className="group relative">
      <button
        onClick={copy}
        title="Copy code"
        className="absolute right-1.5 top-1.5 z-10 flex items-center gap-1 rounded-md border border-neutral-700 bg-neutral-800/90 px-1.5 py-0.5 text-[10px] text-neutral-300 opacity-0 transition-opacity group-hover:opacity-100 cursor-pointer"
      >
        {copied ? <Check size={10} /> : <Copy size={10} />}
        {copied ? "Copied" : "Copy"}
      </button>
      {html ? (
        <code className={cls} style={{ background: "transparent" }} dangerouslySetInnerHTML={{ __html: html }} />
      ) : (
        <code className={cls} style={{ background: "transparent" }}>
          {raw}
        </code>
      )}
    </pre>
  );
}

const PartView = memo(function PartView({ part, isUser = false }: { part: OcPart; isUser?: boolean }) {
  const chatFontSize = useSettingsStore((s) => s.chatFontSize);
  if (part.type === "text") {
    return (
      <div
        className={`markdown-body leading-relaxed ${isUser ? "text-[#FFC799]" : "text-neutral-200"}`}
        style={{ fontSize: `${chatFontSize}px` }}
      >
        <Markdown remarkPlugins={[remarkGfm]} components={{ pre: CodePre }}>
          {part.text ?? ""}
        </Markdown>
      </div>
    );
  }
  if (part.type === "file") {
    if (part.mime?.startsWith("image/") && part.url) {
      return (
        <img
          src={part.url}
          alt={part.filename ?? "image"}
          className="my-1 max-h-48 max-w-[70%] rounded-lg border border-neutral-800 object-contain"
        />
      );
    }
    return (
      <div
        className={`my-1 inline-flex max-w-full items-center gap-1.5 rounded-lg border px-2 py-1 text-xs ${
          isUser
            ? "border-[#EC5B2B]/30 bg-[#EC5B2B]/10 text-[#FFC799]"
            : "border-neutral-800 bg-neutral-900 text-neutral-300"
        }`}
      >
        <FileText size={12} className="shrink-0" />
        <span className="truncate">{part.filename ?? "file"}</span>
        {part.mime && <span className="shrink-0 text-neutral-500">{part.mime}</span>}
      </div>
    );
  }
  if (part.type === "reasoning") {
    return (
      <details className="my-1">
        <summary className="text-xs text-neutral-500 italic cursor-pointer select-none">
          Reasoning
        </summary>
        <div className="text-xs text-neutral-500 italic mt-1 pl-2 border-l border-neutral-800 whitespace-pre-wrap">
          {part.text}
        </div>
      </details>
    );
  }
  if (part.type === "tool") {
    return <ToolPartView part={part} />;
  }
  return null;
});

function ToolPartView({ part }: { part: OcPart }) {
  const [open, setOpen] = useState(false);
  const state = part.state;
  const status = state?.status;
  return (
    <div className="overflow-hidden rounded-xl border border-neutral-800 bg-neutral-900/80 my-1.5">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-neutral-300 transition-colors hover:bg-neutral-800/60 cursor-pointer"
      >
        <ChevronRight
          size={12}
          className={`shrink-0 text-neutral-500 transition-transform ${open ? "rotate-90" : ""}`}
        />
        <span className="font-mono text-neutral-100">{part.tool}</span>
        {status === "pending" && (
          <span className="w-2 h-2 rounded-full bg-neutral-500 shrink-0" />
        )}
        {status === "running" && (
          <Loader2 size={12} className="animate-spin text-sky-300 shrink-0" />
        )}
        {status === "completed" && (
          <CheckCircle2 size={12} className="text-emerald-300 shrink-0" />
        )}
        {status === "error" && (
          <AlertCircle size={12} className="text-rose-300 shrink-0" />
        )}
        {state?.title && (
          <span className="truncate text-neutral-500">{state.title}</span>
        )}
      </button>
      {open && (
        <div className="space-y-1.5 border-t border-neutral-800 bg-neutral-950/50 px-3 py-2">
          <pre className="whitespace-pre-wrap break-all font-mono text-[11px] text-neutral-400">
            {JSON.stringify(state?.input ?? {}, null, 2)}
          </pre>
          {status === "completed" && state?.output && (
            <pre className="whitespace-pre-wrap break-all font-mono text-[11px] text-neutral-400">
              {state.output}
            </pre>
          )}
          {status === "error" && state?.error && (
            <pre className="whitespace-pre-wrap break-all font-mono text-[11px] text-rose-400">
              {state.error}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}

function QuestionPanel({
  question,
  onAnswer,
}: {
  question: OcQuestion;
  onAnswer: (answers: string[][]) => void;
}) {
  const [selected, setSelected] = useState<string[][]>(() =>
    question.questions.map(() => []),
  );
  const [custom, setCustom] = useState<string[]>(() =>
    question.questions.map(() => ""),
  );

  const toggle = (qi: number, label: string) => {
    setSelected((prev) =>
      prev.map((cur, i) => {
        if (i !== qi) return cur;
        if (cur.includes(label)) return cur.filter((l) => l !== label);
        return question.questions[i]?.multiple ? [...cur, label] : [label];
      }),
    );
  };

  const submit = () => {
    const answers = question.questions.map((q, i) => {
      const picked = [...selected[i]];
      const typed = custom[i].trim();
      if (typed && q.custom !== false && !picked.includes(typed)) picked.push(typed);
      return picked;
    });
    if (answers.some((a) => a.length === 0)) return;
    onAnswer(answers);
  };

  const ready = question.questions.every(
    (q, i) => selected[i].length > 0 || custom[i].trim().length > 0,
  );

  return (
    <div className="border-t border-neutral-800 bg-neutral-900/95">
      <div className="flex items-center gap-2 border-b border-neutral-800 px-3 py-1.5">
        <ListChecks size={13} className="shrink-0 text-amber-300" />
        <span className="text-[11px] font-medium uppercase tracking-wider text-amber-300">
          {question.questions.length > 1 ? "Questions" : "Question"}
        </span>
      </div>
      <div className="max-h-80 space-y-3 overflow-y-auto px-3 py-2.5">
        {question.questions.map((q, qi) => (
          <div key={qi} className="space-y-1.5">
            <div className="text-xs font-medium text-neutral-100">
              {q.header && (
                <span className="mr-1.5 rounded bg-neutral-800 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-neutral-400">
                  {q.header}
                </span>
              )}
              {q.question}
            </div>
            <div className="flex flex-col gap-1.5">
              {q.options.map((o) => {
                const active = selected[qi]?.includes(o.label);
                return (
                  <button
                    key={o.label}
                    onClick={() => toggle(qi, o.label)}
                    className={`flex items-start gap-2 rounded-lg border px-2.5 py-1.5 text-left transition-colors cursor-pointer ${
                      active
                        ? "border-amber-400/60 bg-amber-400/10"
                        : "border-neutral-800 bg-neutral-950/60 hover:border-neutral-700 hover:bg-neutral-800/60"
                    }`}
                  >
                    <span
                      className={`mt-0.5 flex h-3.5 w-3.5 shrink-0 items-center justify-center border ${
                        q.multiple ? "rounded" : "rounded-full"
                      } ${active ? "border-amber-400 bg-amber-400" : "border-neutral-600"}`}
                    >
                      {active && <Check size={9} className="text-neutral-950" />}
                    </span>
                    <span className="min-w-0">
                      <span className="block text-xs text-neutral-100">{o.label}</span>
                      {o.description && (
                        <span className="block text-[10px] text-neutral-500">
                          {o.description}
                        </span>
                      )}
                    </span>
                  </button>
                );
              })}
            </div>
            {q.custom !== false && (
              <input
                value={custom[qi]}
                onChange={(e) =>
                  setCustom((prev) => prev.map((v, i) => (i === qi ? e.target.value : v)))
                }
                onKeyDown={(e) => {
                  if (e.key === "Enter" && ready) {
                    e.preventDefault();
                    submit();
                  }
                }}
                placeholder="Type your own answer…"
                className="w-full rounded-lg border border-neutral-800 bg-neutral-950 px-2.5 py-1.5 text-xs text-neutral-100 outline-none placeholder:text-neutral-600 focus:border-neutral-700"
              />
            )}
          </div>
        ))}
      </div>
      <div className="flex justify-end gap-1.5 border-t border-neutral-800 px-3 py-2">
        <button
          onClick={submit}
          disabled={!ready}
          className="inline-flex items-center justify-center rounded-lg bg-neutral-100 px-2.5 py-1.5 text-[11px] font-medium text-neutral-950 hover:bg-white disabled:opacity-40 cursor-pointer"
        >
          Submit
        </button>
      </div>
    </div>
  );
}
const MessageRow = memo(function MessageRow({ entry }: { entry: OcMessageEntry }) {
  const isUser = entry.info.role === "user";
  return (
    <div
      className={`overflow-hidden rounded-xl border ${
        isUser ? "border-[#EC5B2B]/25 bg-[#EC5B2B]/[0.07]" : "border-neutral-800 bg-neutral-900/80"
      }`}
    >
      <div className="flex items-center gap-2 border-b border-neutral-800 px-3 py-1.5 text-[10px] uppercase tracking-[0.16em] text-neutral-500">
        <span className={isUser ? "text-[#FFC799]" : "text-neutral-300"}>
          {isUser ? "You" : "OpenCode"}
        </span>
        {entry.info.time?.created && <span>· {relTime(entry.info.time.created)}</span>}
      </div>
      <div className="space-y-1 px-3 py-2">
        {entry.parts.map((p) => (
          <PartView key={p.id} part={p} isUser={isUser} />
        ))}
      </div>
    </div>
  );
});

export default function OpenCode({
  fixedProjectId,
  autoStart,
  onClose,
}: {
  windowId?: string;
  fixedProjectId?: string;
  autoStart?: boolean;
  onClose?: () => void;
}) {
  const activeProjectId = useProjectStore((s) => s.activeProjectId);

  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [starting, setStarting] = useState(false);
  const [sessions, setSessions] = useState<OcSession[]>([]);
  const [sessionBusy, setSessionBusy] = useState<Record<string, boolean>>({});
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<OcMessageEntry[]>([]);
  const [sending, setSending] = useState(false);
  const [mode, setMode] = useState<"plan" | "build">("build");
  const [permission, setPermission] = useState<OcPermission | null>(null);
  const [question, setQuestion] = useState<OcQuestion | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [commands, setCommands] = useState<OcCommand[]>([]);
  const [models, setModels] = useState<OcModel[]>([]);
  const [selectedModel, setSelectedModel] = useState<OcModel | null>(null);
  const [showPicker, setShowPicker] = useState(false);
  const [showSessionPicker, setShowSessionPicker] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [cmdIdx, setCmdIdx] = useState(0);
  const [voiceOpen, setVoiceOpen] = useState(false);
  const [files, setFiles] = useState<DraftFile[]>([]);
  const [todos, setTodos] = useState<OcTodo[]>([]);
  const [fileHits, setFileHits] = useState<string[]>([]);
  const [mentions, setMentions] = useState<string[]>([]);
  const [fileIdx, setFileIdx] = useState(0);
  const [mentionDismissed, setMentionDismissed] = useState(false);

  const controllersRef = useRef<Set<AbortController>>(new Set());
  const falseStreakRef = useRef(0);
  const projectIdRef = useRef<string | null>(null);
  projectIdRef.current = projectId;
  const activeSessionIdRef = useRef<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const repairRef = useRef(false);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  activeSessionIdRef.current = activeSessionId;

  const busy = useMemo(() => {
    const last = messages[messages.length - 1];
    return !!last && last.info.role === "assistant" && !last.info.time?.completed;
  }, [messages]);

  const track = useCallback((ctrl: AbortController) => {
    controllersRef.current.add(ctrl);
    return ctrl;
  }, []);

  // Surface a backend/down-proxy failure once instead of silently rendering an
  // empty session list. AbortError is expected (cancelled on project switch).
  const reportFetchError = useCallback((err: unknown) => {
    if ((err as { name?: string })?.name === "AbortError") return;
    setError(err instanceof Error ? err.message : "Failed to load from opencode");
  }, []);

  const startServer = useCallback(async () => {
    const pid = projectIdRef.current;
    setStarting(true);
    setError(null);
    try {
      await ocReq(`/api/opencode/${encodeURIComponent(pid ?? "")}/start`, {
        method: "POST",
      });
      if (projectIdRef.current === pid) setRunning(true);
      return true;
    } catch (err) {
      const e = err as Error & { status?: number };
      if (e.status === 409) {
        if (projectIdRef.current === pid) setRunning(true);
        return true;
      }
      if (projectIdRef.current === pid) setError(e.message || "Failed to start");
      return false;
    } finally {
      setStarting(false);
    }
  }, []);

  const fetchSessions = useCallback(
    async (pid: string): Promise<OcSession[]> => {
      const ctrl = track(new AbortController());
      try {
        const data = await ocReq<OcSession[]>(
          `/api/opencode/${encodeURIComponent(pid)}/proxy/session`,
          { signal: ctrl.signal },
        );
        if (projectIdRef.current !== pid) return data;
        setSessions(data);
        return data;
      } catch (err) {
        reportFetchError(err);
        return [];
      } finally {
        controllersRef.current.delete(ctrl);
      }
    },
    [track, reportFetchError],
  );

  // /session/status returns { [sessionID]: { type: "busy" | "retry" | ... } };
  // absent or "idle" means the session is not running.
  const fetchStatus = useCallback(
    async (pid: string) => {
      const ctrl = track(new AbortController());
      try {
        const data = await ocReq<Record<string, { type?: string }>>(
          `/api/opencode/${encodeURIComponent(pid)}/proxy/session/status`,
          { signal: ctrl.signal },
        );
        if (projectIdRef.current !== pid) return;
        const busy: Record<string, boolean> = {};
        for (const [sid, st] of Object.entries(data ?? {})) {
          if (st?.type && st.type !== "idle") busy[sid] = true;
        }
        setSessionBusy(busy);
      } catch {
        // ignore — SSE reconciles
      } finally {
        controllersRef.current.delete(ctrl);
      }
    },
    [track],
  );

  const markBusy = useCallback((sid: string, busy: boolean) => {
    setSessionBusy((prev) => {
      if (!!prev[sid] === busy) return prev;
      const next = { ...prev };
      if (busy) next[sid] = true;
      else delete next[sid];
      return next;
    });
  }, []);

  const fetchMessages = useCallback(
    async (pid: string, sid: string): Promise<OcMessageEntry[]> => {
      const ctrl = track(new AbortController());
      try {
        const data = await ocReq<OcMessageEntry[]>(
          `/api/opencode/${encodeURIComponent(pid)}/proxy/session/${encodeURIComponent(sid)}/message`,
          { signal: ctrl.signal },
        );
        if (projectIdRef.current !== pid || activeSessionIdRef.current !== sid) return data;
        setMessages(data);
        return data;
      } catch (err) {
        reportFetchError(err);
        return [];
      } finally {
        controllersRef.current.delete(ctrl);
      }
    },
    [track, reportFetchError],
  );

  // Project list + default selection (active project from the store).
  useEffect(() => {
    let cancelled = false;
    api
      .get<Project[]>("/api/projects")
      .then((data) => {
        if (cancelled) return;
        setProjects(data);
        const active = useProjectStore.getState().activeProjectId;
        const initial =
          active && data.some((p) => p.id === active) ? active : data[0]?.id ?? null;
        setProjectId((prev) => prev ?? initial);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  // A transient /status failure must not flip a live server to "stopped".
  useEffect(() => {
    if (!projectId) return;
    falseStreakRef.current = 0;
    setRunning(false);
    setStarting(false);
    setSending(false);
    setSessionBusy({});
    setError(null);
    setNotice(null);
    setSelectedModel(null);
    setTodos([]);
    setFiles([]);
    setMentions([]);
    let stopped = false;
    const poll = async () => {
      const ctrl = track(new AbortController());
      try {
        const st = await ocReq<{ running: boolean; port?: number }>(
          `/api/opencode/${encodeURIComponent(projectId)}/status`,
          { signal: ctrl.signal },
        );
        if (!stopped && typeof st?.running === "boolean") {
          if (st.running) {
            falseStreakRef.current = 0;
            setRunning(true);
          } else if (++falseStreakRef.current >= 3) {
            setRunning(false);
          }
        }
      } catch {
        // keep last known state
      } finally {
        controllersRef.current.delete(ctrl);
      }
    };
    void poll();
    const t = setInterval(() => void poll(), 4000);
    return () => {
      stopped = true;
      clearInterval(t);
    };
  }, [projectId, track]);

  // Load sessions whenever the server is up.
  useEffect(() => {
    if (!projectId || !running) return;
    void fetchSessions(projectId);
    void fetchStatus(projectId);
  }, [projectId, running, fetchSessions, fetchStatus]);

  // Load slash commands + model catalog whenever the server is up.
  useEffect(() => {
    if (!projectId || !running) {
      setCommands([]);
      setModels([]);
      return;
    }
    const ctrl = track(new AbortController());
    ocReq<OcCommand[]>(`/api/opencode/${encodeURIComponent(projectId)}/proxy/command`, {
      signal: ctrl.signal,
    })
      .then((d) => setCommands(Array.isArray(d) ? d : []))
      .catch(() => setCommands([]))
      .finally(() => controllersRef.current.delete(ctrl));
    const ctrl2 = track(new AbortController());
    ocReq<{
      all?: {
        id: string;
        name?: string;
        models?: Record<
          string,
          { name?: string; status?: string; limit?: { context?: number }; capabilities?: { toolcall?: boolean } }
        >;
      }[];
      connected?: string[];
      default?: Record<string, string>;
    }>(`/api/opencode/${encodeURIComponent(projectId)}/proxy/provider`, { signal: ctrl2.signal })
      .then((j) => {
        // Only providers opencode actually has credentials for — "all" is the
        // full models.dev catalog, not what this opencode install can use.
        const connected = new Set(j.connected ?? []);
        const defaults = j.default ?? {};
        const list: OcModel[] = [];
        for (const p of j.all ?? []) {
          if (!connected.has(p.id)) continue;
          const providerName = p.name || p.id;
          for (const [mid, mm] of Object.entries(p.models ?? {})) {
            if (mm?.status === "deprecated") continue;
            list.push({
              providerID: p.id,
              providerName,
              modelID: mid,
              label: `${p.id}/${mid}`,
              name: mm?.name,
              isDefault: defaults[p.id] === mid,
              context: mm?.limit?.context,
              toolcall: mm?.capabilities?.toolcall,
            });
          }
        }
        setModels(list);
      })
      .catch(() => setModels([]))
      .finally(() => controllersRef.current.delete(ctrl2));
  }, [projectId, running, track]);

  // Load history whenever the active session changes.
  useEffect(() => {
    if (!projectId || !running || !activeSessionId) return;
    void fetchMessages(projectId, activeSessionId);
  }, [projectId, running, activeSessionId, fetchMessages]);

  // Rebuild the plan checklist from history (last todowrite tool part) so the
  // view survives reloads/session switches, where no todo.updated SSE fired.
  useEffect(() => {
    const t = extractLastTodos(messages);
    if (t) setTodos(t as OcTodo[]);
  }, [messages]);

  // @-mention picker: fuzzy file search against the opencode workspace,
  // debounced so each keystroke isn't a round-trip.
  const atQuery = /(?:^|\s)@([\w./@+-]*)$/.exec(input)?.[1];
  useEffect(() => {
    if (!projectId || !running || atQuery === undefined) {
      setFileHits([]);
      return;
    }
    const ctrl = track(new AbortController());
    const t = setTimeout(() => {
      ocReq<string[]>(
        `/api/opencode/${encodeURIComponent(projectId)}/proxy/find/file?query=${encodeURIComponent(atQuery)}&type=file&limit=80`,
        { signal: ctrl.signal },
      )
        .then((d) => setFileHits(Array.isArray(d) ? d.slice(0, 30) : []))
        .catch(() => setFileHits([]))
        .finally(() => controllersRef.current.delete(ctrl));
    }, 150);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [atQuery, projectId, running, track]);

  // Fixed-project mode (focus mode): the panel follows the active project,
  // no selector, and starts opencode serve by itself.
  const lastFixedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!fixedProjectId || lastFixedRef.current === fixedProjectId) return;
    lastFixedRef.current = fixedProjectId;
    setProjectId(fixedProjectId);
    setActiveSessionId(null);
    activeSessionIdRef.current = null;
    autoSelectedRef.current = false;
    setMessages([]);
    setSessions([]);
    setSessionBusy({});
    setPermission(null);
    setQuestion(null);
  }, [fixedProjectId]);

  const autoStartedRef = useRef<string | null>(null);
  const autoSelectedRef = useRef(false);
  useEffect(() => {
    if (!autoStart || !projectId || autoStartedRef.current === projectId) return;
    autoStartedRef.current = projectId;
    if (running) return;
    void (async () => {
      if (await startServer()) {
        const data = await fetchSessions(projectId);
        if (data.length === 0) void newSession();
      }
    })();
  }, [autoStart, projectId, running, startServer, fetchSessions]);

  useEffect(() => {
    if (!autoStart || autoSelectedRef.current) return;
    if (!running || !projectId || sessions.length === 0) return;
    autoSelectedRef.current = true;
    selectSession(sessions[0]);
  }, [autoStart, running, projectId, sessions]);

  // SSE: apply part events locally (incremental, CLI-like); debounced full
  // refetch only as fallback when an event can't be applied, plus a full
  // reconcile on session.idle. Reconnects with a fixed 3s backoff; closed on
  // unmount / project change.
  useEffect(() => {
    if (!projectId || !running) return;
    let es: EventSource | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let closed = false;

    const refetchHistory = () => {
      const sid = activeSessionIdRef.current;
      if (sid && projectId) void fetchMessages(projectId, sid);
    };

    const scheduleRefetch = (delay: number) => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(refetchHistory, delay);
    };

    const connect = () => {
      if (closed) return;
      es = new EventSource(
        `${API_BASE}/api/opencode/${encodeURIComponent(projectId)}/proxy/event`,
      );
      es.onmessage = (ev) => {
        let data: { type?: string; properties?: Record<string, unknown> };
        try {
          data = JSON.parse(ev.data) as typeof data;
        } catch {
          return;
        }
        const type = data.type ?? "";
        const sid = String(data.properties?.sessionID ?? "");
        const isActive = !!sid && sid === activeSessionIdRef.current;
        if (type === "message.part.updated" && isActive) {
          const part = data.properties?.part as (OcPart & { messageID?: string }) | undefined;
          const mid = String(data.properties?.messageID ?? part?.messageID ?? "");
          if (part?.id && mid) {
            setMessages((prev) => upsertPartIn(prev, mid, part as OcPart));
          } else {
            scheduleRefetch(1000);
          }
        } else if (type === "message.part.delta" && isActive) {
          const props = data.properties as {
            messageID?: string;
            partID?: string;
            field?: string;
            delta?: string;
          };
          if (repairRef.current) {
            scheduleRefetch(1000);
          } else if (props.messageID && props.partID && typeof props.delta === "string") {
            const { messageID, partID } = props;
            const field = String(props.field ?? "text");
            const delta = props.delta;
            // ref side-effects must stay idempotent: StrictMode double-invokes updaters
            setMessages((prev) => {
              const next = appendDeltaIn(prev, messageID, partID, field, delta);
              if (next === null) {
                repairRef.current = true;
                scheduleRefetch(500);
                return prev;
              }
              return next;
            });
          } else {
            repairRef.current = true;
            scheduleRefetch(500);
          }
        } else if (type === "message.updated" && isActive) {
          const info = data.properties?.info as OcMessageEntry["info"] | undefined;
          if (info?.id) setMessages((prev) => upsertInfoIn(prev, info));
        } else if (type === "session.status") {
          if (sid) {
            const st = data.properties?.status as { type?: string } | undefined;
            markBusy(sid, Boolean(st?.type && st.type !== "idle"));
          }
        } else if (type === "session.idle") {
          if (sid) markBusy(sid, false);
          if (isActive) {
            repairRef.current = false;
            refetchHistory();
            if (projectId) void fetchSessions(projectId);
          }
        } else if (type === "todo.updated" && isActive) {
          const t = data.properties?.todos;
          if (Array.isArray(t)) setTodos(t as OcTodo[]);
        } else if (
          type === "permission.asked" ||
          type === "permission.v2.asked" ||
          type === "permission.updated"
        ) {
          const p = data.properties;
          if (p && p.id) {
            const patterns = [p.patterns, p.resources].flatMap((x) =>
              Array.isArray(x) ? x.map(String) : [],
            );
            setPermission({
              requestID: String(p.id),
              sessionID: String(p.sessionID ?? ""),
              label: String(p.permission ?? p.action ?? "permission"),
              detail: patterns.join(" "),
            });
          }
        } else if (type === "permission.replied" || type === "permission.v2.replied") {
          setPermission(null);
        } else if (type === "question.asked" || type === "question.v2.asked") {
          const p = data.properties as
            | {
                id?: string;
                sessionID?: string;
                questions?: OcQuestionInfo[];
              }
            | undefined;
          if (p && p.id) {
            const raw = Array.isArray(p.questions) ? p.questions : [];
            setQuestion({
              requestID: String(p.id),
              sessionID: String(p.sessionID ?? ""),
              questions: raw.map((q) => ({
                question: String(q?.question ?? ""),
                header: q?.header ? String(q.header) : undefined,
                options: Array.isArray(q?.options)
                  ? q.options.map((o: OcQuestionOption) => ({
                      label: String(o?.label ?? ""),
                      description: o?.description ? String(o.description) : undefined,
                    }))
                  : [],
                multiple: Boolean(q?.multiple),
                custom: q?.custom === undefined ? true : Boolean(q.custom),
              })),
            });
          }
        } else if (
          type === "question.replied" ||
          type === "question.rejected" ||
          type === "question.v2.replied" ||
          type === "question.v2.rejected"
        ) {
          setQuestion(null);
        }
      };
      es.onerror = () => {
        es?.close();
        if (closed) return;
        retryTimer = setTimeout(connect, 3000);
      };
    };

    connect();
    return () => {
      closed = true;
      if (retryTimer) clearTimeout(retryTimer);
      es?.close();
    };
  }, [projectId, running, fetchMessages, fetchSessions, markBusy]);

  // Cleanup on unmount: abort in-flight fetches, drop pending debounce.
  useEffect(() => {
    return () => {
      controllersRef.current.forEach((c) => c.abort());
      controllersRef.current.clear();
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  // Auto-scroll unless the user scrolled up. The ResizeObserver covers the
  // case where messages resolve while the container has no size yet (window
  // opening/animating) — scroll lands at 0 then, so re-apply once it resizes.
  useEffect(() => {
    const el = scrollRef.current;
    if (el && stickRef.current) el.scrollTop = el.scrollHeight;
  }, [messages, sending]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => {
      if (stickRef.current) el.scrollTop = el.scrollHeight;
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Auto-grow composer.
  useEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    if (ta.scrollHeight === 0) return;
    ta.style.height = `${Math.min(ta.scrollHeight, 128)}px`;
  }, [input]);

  const selectSession = (s: OcSession | string) => {
    const id = typeof s === "string" ? s : s.id;
    const sess = typeof s === "string" ? sessions.find((x) => x.id === id) : s;
    repairRef.current = false;
    setActiveSessionId(id);
    activeSessionIdRef.current = id;
    stickRef.current = true;
    setTodos([]);
    setSelectedModel(
      sess?.model?.providerID && sess?.model?.id
        ? models.find((m) => m.providerID === sess.model!.providerID && m.modelID === sess.model!.id) ?? {
            providerID: sess.model.providerID,
            providerName: sess.model.providerID,
            modelID: sess.model.id,
            label: `${sess.model.providerID}/${sess.model.id}`,
          }
        : null,
    );
    if (projectId) void fetchMessages(projectId, id);
  };

  const slashQuery = /^\/(\S*)$/.exec(input)?.[1];
  const modelQuery = /^\/model\s+(\S*)$/.exec(input)?.[1];
  const cmdList = useMemo<OcCommand[]>(() => {
    if (dismissed) return [];
    if (modelQuery !== undefined) {
      const q = modelQuery.toLowerCase();
      return models
        .filter((m) => m.label.toLowerCase().includes(q) || (m.name ?? "").toLowerCase().includes(q))
        .slice(0, 40)
        .map((m) => ({
          name: `model ${m.label}`,
          description: [m.isDefault ? "★ default" : null, m.name, m.providerName]
            .filter(Boolean)
            .join(" · "),
        }));
    }
    if (slashQuery === undefined) return [];
    const q = slashQuery.toLowerCase();
    const pool = commands.some((c) => c.name === "model") ? commands : [...commands, MODEL_HINT];
    return pool
      .filter((c) => c.name.toLowerCase().includes(q))
      .sort((a, b) =>
        a.name.toLowerCase().startsWith(q) === b.name.toLowerCase().startsWith(q)
          ? a.name.localeCompare(b.name)
          : a.name.toLowerCase().startsWith(q)
            ? -1
            : 1,
      );
  }, [slashQuery, modelQuery, dismissed, commands, models]);

  const applyCommand = (c: OcCommand) => {
    setInput(`/${c.name} `);
    setCmdIdx(0);
    taRef.current?.focus();
  };

  const mentionList = mentionDismissed || atQuery === undefined ? [] : fileHits;

  const applyMention = (path: string) => {
    setInput((i) => i.replace(/@[\w./@+-]*$/, `@${path} `));
    setMentions((prev) => (prev.includes(path) ? prev : [...prev, path]));
    setFileIdx(0);
    taRef.current?.focus();
  };

  const togglePower = async () => {
    if (!projectId) return;
    if (running) {
      const ctrl = track(new AbortController());
      try {
        await ocReq(`/api/opencode/${encodeURIComponent(projectId)}/stop`, {
          method: "POST",
          signal: ctrl.signal,
        });
      } catch {
        // ignore — status poll will reconcile
      } finally {
        controllersRef.current.delete(ctrl);
      }
      setRunning(false);
      setSessions([]);
      setSessionBusy({});
      setActiveSessionId(null);
      activeSessionIdRef.current = null;
      setMessages([]);
      setPermission(null);
      setQuestion(null);
      return;
    }
    if (await startServer()) {
      const data = await fetchSessions(projectId);
      if (data.length > 0) selectSession(data[0]);
    }
  };

  const deleteSession = async (s: OcSession) => {
    if (!projectId) return;
    const ctrl = track(new AbortController());
    try {
      await ocReq(
        `/api/opencode/${encodeURIComponent(projectId)}/proxy/session/${encodeURIComponent(s.id)}`,
        { method: "DELETE", signal: ctrl.signal },
      );
      setSessions((prev) => prev.filter((x) => x.id !== s.id));
      if (activeSessionIdRef.current === s.id) {
        const rest = sessions.filter((x) => x.id !== s.id);
        if (rest[0]) selectSession(rest[0]);
        else {
          setActiveSessionId(null);
          activeSessionIdRef.current = null;
          setMessages([]);
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete session");
    } finally {
      controllersRef.current.delete(ctrl);
    }
  };

  const newSession = async () => {
    if (!projectId || !running) return;
    const ctrl = track(new AbortController());
    try {
      const s = await ocReq<OcSession>(
        `/api/opencode/${encodeURIComponent(projectId)}/proxy/session`,
        { method: "POST", body: "{}", signal: ctrl.signal },
      );
      setSessions((prev) => [s, ...prev]);
      selectSession(s);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create session");
    } finally {
      controllersRef.current.delete(ctrl);
    }
  };

  const addFiles = async (list: FileList | File[]) => {
    const incoming = Array.from(list);
    const room = MAX_FILES - files.length;
    if (room <= 0) {
      setNotice(`Max ${MAX_FILES} attachments.`);
      return;
    }
    const accepted: DraftFile[] = [];
    for (const f of incoming.slice(0, room)) {
      if (f.size > MAX_FILE_BYTES) {
        setNotice(`${f.name}: skipped, larger than ${MAX_FILE_BYTES >> 20}MB`);
        continue;
      }
      try {
        accepted.push({
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          name: f.name,
          mime: f.type || "application/octet-stream",
          dataUrl: await readFileAsDataUrl(f),
        });
      } catch {
        setNotice(`${f.name}: could not read file`);
      }
    }
    if (accepted.length > 0) {
      setNotice(null);
      setFiles((prev) => [...prev, ...accepted]);
    }
  };

  const send = async () => {
    const text = input.trim();
    if ((!text && files.length === 0) || !projectId || !activeSessionId || sending) return;
    const mc = /^\/model(?:\s+(\S*))?$/.exec(text);
    if (mc) {
      setInput("");
      const arg = (mc[1] ?? "").toLowerCase();
      if (!arg) {
        if (models.length > 0) setShowPicker(true);
        else setNotice("No models loaded.");
        return;
      }
      const exact = models.find((m) => m.label.toLowerCase() === arg);
      const hits = exact ? [exact] : models.filter((m) => m.label.toLowerCase().includes(arg));
      if (hits.length === 0) setNotice(`No model matches "${mc[1]}"`);
      else if (exact || hits.length === 1) {
        setSelectedModel(hits[0]);
        setNotice(`Model → ${hits[0].label}`);
      } else {
        setNotice(`${hits.length} matches: ${hits.slice(0, 8).map((m) => m.label).join(", ")}`);
      }
      return;
    }
    const slash = /^\/([A-Za-z0-9][\w.:-]*)(?:\s+([\s\S]*))?$/.exec(text);
    const cmd = slash ? commands.find((c) => c.name === slash[1]) : undefined;
    setInput("");
    setError(null);
    setNotice(null);
    setSending(true);
    stickRef.current = true;
    const root = projects.find((p) => p.id === projectId)?.directory?.replace(/\/+$/, "") ?? "";
    const mentionParts = buildMentionParts(text, mentions, root);
    const optimisticId = `optimistic-${Date.now()}`;
    const optimistic: OcMessageEntry = {
      info: { id: optimisticId, role: "user", time: { created: Date.now() } },
      parts: [
        ...files.map((f, i) => ({
          id: `${optimisticId}-f${i}`,
          type: "file",
          mime: f.mime,
          filename: f.name,
          url: f.dataUrl,
        })),
        ...mentionParts.map((m, i) => ({ ...m, id: `${optimisticId}-m${i}` })),
        ...(text ? [{ id: `${optimisticId}-p`, type: "text", text }] : []),
      ],
    };
    setMessages((prev) => [...prev, optimistic]);
    markBusy(activeSessionId, true);
    const ctrl = track(new AbortController());
    try {
      if (cmd) {
        await ocReq(
          `/api/opencode/${encodeURIComponent(projectId)}/proxy/session/${encodeURIComponent(activeSessionId)}/command`,
          {
            method: "POST",
            body: JSON.stringify({ command: cmd.name, arguments: slash?.[2]?.trim() ?? "" }),
            signal: ctrl.signal,
          },
        );
        setFiles([]);
      } else {
        const res = await ocReq<OcMessageEntry>(
          `/api/opencode/${encodeURIComponent(projectId)}/proxy/session/${encodeURIComponent(activeSessionId)}/message`,
          {
            method: "POST",
            body: JSON.stringify({
              parts: [
                ...files.map((f) => ({ type: "file", mime: f.mime, filename: f.name, url: f.dataUrl })),
                ...mentionParts,
                ...(text ? [{ type: "text", text }] : []),
              ],
              agent: mode,
              ...(selectedModel
                ? { model: { providerID: selectedModel.providerID, modelID: selectedModel.modelID } }
                : {}),
            }),
            signal: ctrl.signal,
          },
        );
        setMessages((prev) => [...prev.filter((m) => m.info.id !== optimisticId), res]);
        setFiles([]);
        setMentions([]);
      }
    } catch (err) {
      setMessages((prev) => prev.filter((m) => m.info.id !== optimisticId));
      setError(err instanceof Error ? err.message : "Failed to send");
    } finally {
      controllersRef.current.delete(ctrl);
      setSending(false);
      if (projectId && activeSessionId) void fetchMessages(projectId, activeSessionId);
    }
  };

  const stop = async () => {
    if (!projectId || !activeSessionId) return;
    const ctrl = track(new AbortController());
    try {
      await ocReq(
        `/api/opencode/${encodeURIComponent(projectId)}/proxy/session/${encodeURIComponent(activeSessionId)}/abort`,
        { method: "POST", signal: ctrl.signal },
      );
    } catch {
      // ignore — session.idle will reconcile
    } finally {
      controllersRef.current.delete(ctrl);
    }
  };

  const replyPermission = async (reply: PermissionReply) => {
    if (!projectId || !permission) return;
    const req = permission;
    setPermission(null);
    const ctrl = track(new AbortController());
    try {
      await ocReq(
        `/api/opencode/${encodeURIComponent(projectId)}/proxy/permission/${encodeURIComponent(req.requestID)}/reply`,
        { method: "POST", body: JSON.stringify({ reply }), signal: ctrl.signal },
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to reply");
    } finally {
      controllersRef.current.delete(ctrl);
    }
    if (activeSessionId) void fetchMessages(projectId, activeSessionId);
  };

  const replyQuestion = async (answers: string[][]) => {
    if (!projectId || !question) return;
    const req = question;
    setQuestion(null);
    const ctrl = track(new AbortController());
    try {
      await ocReq(
        `/api/opencode/${encodeURIComponent(projectId)}/proxy/question/${encodeURIComponent(req.requestID)}/reply`,
        { method: "POST", body: JSON.stringify({ answers }), signal: ctrl.signal },
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to answer");
    } finally {
      controllersRef.current.delete(ctrl);
    }
    if (activeSessionId) void fetchMessages(projectId, activeSessionId);
  };

  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (mentionList.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setFileIdx((i) => (i + 1) % mentionList.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setFileIdx((i) => (i - 1 + mentionList.length) % mentionList.length);
        return;
      }
      if (e.key === "Tab" || (e.key === "Enter" && !e.shiftKey)) {
        e.preventDefault();
        applyMention(mentionList[Math.min(fileIdx, mentionList.length - 1)]);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setMentionDismissed(true);
        return;
      }
    }
    if (cmdList.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setCmdIdx((i) => (i + 1) % cmdList.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setCmdIdx((i) => (i - 1 + cmdList.length) % cmdList.length);
        return;
      }
      if (e.key === "Tab" || (e.key === "Enter" && !e.shiftKey)) {
        e.preventDefault();
        applyCommand(cmdList[Math.min(cmdIdx, cmdList.length - 1)]);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setDismissed(true);
        return;
      }
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
  };

  const handleVoiceSend = useCallback((text: string) => {
    setInput((prev) => (prev ? `${prev.trimEnd()} ${text}` : text));
    setDismissed(false);
    taRef.current?.focus();
  }, []);

  const translateVoice = useCallback(async (text: string) => {
    try {
      const { ninerouterApiKey, ninerouterModel } = useSettingsStore.getState();
      const res = await fetch("/api/voice/translate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text,
          apiKey: ninerouterApiKey || undefined,
          model: ninerouterModel || undefined,
        }),
      });
      if (!res.ok) throw new Error("Translation failed");
      const data = await res.json();
      return data.translated || text;
    } catch {
      return text;
    }
  }, []);

  return (
    <div className="flex h-full w-full flex-col bg-neutral-950 text-neutral-100">
      <div className="flex shrink-0 items-center gap-1.5 border-b border-neutral-800 px-2 py-1">
        <SquareTerminal size={13} className="shrink-0 text-neutral-300" />
        <span className="shrink-0 text-xs font-medium text-neutral-100">OpenCode</span>
        {fixedProjectId ? (
          <p className="min-w-0 flex-1 truncate text-[10px] text-neutral-500">
            {projects.find((p) => p.id === fixedProjectId)?.name ??
              "Active project"}
          </p>
        ) : (
          <select
            className="min-w-0 max-w-full flex-1 cursor-pointer truncate bg-transparent text-[10px] text-neutral-500 outline-none"
            value={projectId ?? ""}
            onChange={(e) => {
              setProjectId(e.target.value || null);
              setActiveSessionId(null);
              activeSessionIdRef.current = null;
              setMessages([]);
              setSessions([]);
              setPermission(null);
              setQuestion(null);
            }}
          >
            {projects.length === 0 && <option value="">No projects</option>}
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        )}
        <span
          className={`h-2 w-2 shrink-0 rounded-full ${running ? "bg-emerald-400" : "bg-neutral-600"}`}
          title={running ? "Running" : "Stopped"}
        />
        {selectedModel ? (
          <button
            onClick={() => setShowPicker(true)}
            disabled={!running}
            className="flex max-w-40 shrink-0 items-center gap-1 truncate rounded-md border border-neutral-800 bg-neutral-900 px-1.5 py-0.5 font-mono text-[10px] text-neutral-300 hover:text-neutral-100 disabled:opacity-40 cursor-pointer"
            title={`Model: ${selectedModel.label} — click to change`}
          >
            <Cpu size={11} className="shrink-0" />
            <span className="truncate">{selectedModel.name || selectedModel.label}</span>
          </button>
        ) : (
          <button
            onClick={() => setShowPicker(true)}
            disabled={!running || models.length === 0}
            className="flex max-w-40 shrink-0 items-center gap-1 rounded-md border border-neutral-800 bg-neutral-900 px-1.5 py-0.5 font-mono text-[10px] text-neutral-500 hover:text-neutral-200 disabled:opacity-40 cursor-pointer"
            title={models.length === 0 ? "No models loaded" : "Select model"}
          >
            <Cpu size={11} className="shrink-0" />
            <span className="truncate">
              {models.length === 0 ? "no models" : "select model"}
            </span>
          </button>
        )}
        <button
          onClick={() => void togglePower()}
          disabled={starting || !projectId}
          className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md transition-colors cursor-pointer disabled:opacity-30 ${
            running
              ? "text-rose-300 hover:bg-neutral-800"
              : "text-neutral-500 hover:bg-neutral-800 hover:text-white"
          }`}
          title={running ? "Stop server" : "Start server"}
        >
          {starting ? (
            <Loader2 size={14} className="animate-spin" />
          ) : (
            <Power size={14} />
          )}
        </button>
        {onClose && (
          <button
            onClick={onClose}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-neutral-500 transition-colors hover:bg-neutral-800 hover:text-white cursor-pointer"
            title="Close"
          >
            <X size={14} />
          </button>
        )}
      </div>

      {running && (
        <div className="flex shrink-0 items-center gap-1.5 border-b border-neutral-800 px-2 py-1 sm:hidden">
          <button
            onClick={() => setShowSessionPicker(true)}
            className="flex min-w-0 flex-1 items-center gap-1.5 truncate rounded-md border border-neutral-800 bg-neutral-900 px-2 py-1 text-left text-xs text-neutral-100 cursor-pointer"
          >
            {activeSessionId && sessionBusy[activeSessionId] && (
              <Loader2 size={11} className="shrink-0 animate-spin text-indigo-300" />
            )}
            <span className="truncate">
              {sessions.find((s) => s.id === activeSessionId)?.title || "Select session"}
            </span>
          </button>
          <button
            onClick={() => void newSession()}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-neutral-800 bg-neutral-900 text-neutral-200 hover:bg-neutral-800 cursor-pointer"
            title="New session"
          >
            <Plus size={14} />
          </button>
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        {/* Session list */}
        <div className="hidden w-56 shrink-0 flex-col border-r border-neutral-800 sm:flex">
          <div className="flex items-center gap-2 border-b border-neutral-800 px-2 py-1">
            <span className="flex-1 text-[11px] font-medium uppercase tracking-wider text-neutral-500">
              Sessions
            </span>
            <button
              onClick={() => void newSession()}
              disabled={!running}
              className="rounded p-1 text-neutral-500 transition-colors hover:bg-neutral-800 hover:text-white disabled:opacity-40 cursor-pointer"
              title="New session"
            >
              <Plus size={14} />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto py-1">
            {!running ? (
              <div className="px-3 py-2.5 text-xs text-neutral-500">
                Start the server to see sessions.
              </div>
            ) : sessions.length === 0 ? (
              <div className="px-3 py-2.5 text-xs text-neutral-500">
                No sessions yet.
              </div>
            ) : (
              sessions.map((s) => (
                <div
                  key={s.id}
                  className={`group flex items-center transition-colors ${
                    s.id === activeSessionId ? "bg-neutral-800/80" : "hover:bg-neutral-800/60"
                  }`}
                >
                  <button
                    onClick={() => selectSession(s)}
                    className="block min-w-0 flex-1 px-3 py-1.5 text-left cursor-pointer"
                  >
                    <div className="flex items-center gap-1.5">
                      {sessionBusy[s.id] && (
                        <Loader2
                          size={11}
                          aria-label="Running"
                          className="shrink-0 animate-spin text-indigo-300"
                        />
                      )}
                      <span className="truncate text-xs text-neutral-100">
                        {s.title || "Untitled"}
                      </span>
                    </div>
                    <div className="mt-1 text-[10px] text-neutral-500">
                      {relTime(s.time?.updated ?? s.time?.created)}
                    </div>
                  </button>
                  <button
                    onClick={() => void deleteSession(s)}
                    className="mr-2 flex h-6 w-6 shrink-0 items-center justify-center rounded text-neutral-500 opacity-0 transition-opacity hover:bg-neutral-700 hover:text-rose-300 group-hover:opacity-100 cursor-pointer"
                    title="Delete session"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Thread + composer */}
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex shrink-0 items-center gap-2 border-b border-neutral-800 px-3 py-2">
            <span className="flex-1 truncate text-[11px] font-medium uppercase tracking-wider text-neutral-500">
              Conversation
            </span>
          </div>
          <div
            ref={scrollRef}
            onScroll={handleScroll}
            className="flex-1 space-y-3 overflow-y-auto overflow-x-hidden px-3 py-2.5"
          >
            {!activeSessionId ? (
              <div className="flex h-full items-center justify-center text-sm text-neutral-500">
                {running
                  ? "Select or create a session to start chatting."
                  : "Start the server, then pick a session."}
              </div>
            ) : (
              <>
                {messages.map((m) => (
                  <MessageRow key={m.info.id} entry={m} />
                ))}
                {(sending || busy) && (
                  <div className="flex items-center gap-2 text-xs text-neutral-500">
                    <Loader2 size={12} className="animate-spin" />{" "}
                    {sending ? "thinking…" : "working…"}
                  </div>
                )}
              </>
            )}
          </div>

          {activeSessionId && todos.length > 0 && (
            <details open className="shrink-0 border-t border-neutral-800 bg-neutral-900/95">
              <summary className="flex cursor-pointer select-none items-center gap-2 px-3 py-1.5 text-[11px] font-medium uppercase tracking-wider text-neutral-400">
                <ListChecks size={13} className="shrink-0 text-sky-300" />
                Plan
                <span className="ml-auto font-mono text-[10px] normal-case tracking-normal text-neutral-500">
                  {todos.filter((t) => t.status === "completed").length}/{todos.length}
                </span>
              </summary>
              <ul className="max-h-44 space-y-1 overflow-y-auto px-3 pb-2">
                {todos.map((t, i) => (
                  <li key={i} className="flex items-start gap-2 text-xs">
                    {t.status === "completed" ? (
                      <CheckCircle2 size={12} className="mt-0.5 shrink-0 text-emerald-300" />
                    ) : t.status === "in_progress" ? (
                      <Loader2 size={12} className="mt-0.5 shrink-0 animate-spin text-sky-300" />
                    ) : (
                      <Circle size={12} className="mt-0.5 shrink-0 text-neutral-600" />
                    )}
                    <span
                      className={
                        t.status === "completed" ? "text-neutral-500 line-through" : "text-neutral-200"
                      }
                    >
                      {t.content}
                    </span>
                  </li>
                ))}
              </ul>
            </details>
          )}

          {permission && (
            <div className="flex flex-wrap items-center gap-3 border-t border-neutral-800 bg-neutral-900/80 px-3 py-2">
              <span className="min-w-0 text-xs text-neutral-400">
                <span className="font-medium text-amber-300">Permission:</span>{" "}
                {permission.label}
                {permission.detail && (
                  <span className="ml-1 font-mono text-neutral-500">
                    {permission.detail}
                  </span>
                )}
              </span>
              <div className="ml-auto flex gap-1.5">
                <button
                  onClick={() => void replyPermission("once")}
                  className="inline-flex items-center justify-center rounded-lg bg-neutral-100 px-2.5 py-1.5 text-[11px] font-medium text-neutral-950 hover:bg-white cursor-pointer"
                >
                  Once
                </button>
                <button
                  onClick={() => void replyPermission("always")}
                  className="inline-flex items-center justify-center rounded-lg border border-neutral-800 bg-neutral-950/70 px-2.5 py-1.5 text-[11px] text-neutral-200 hover:bg-neutral-800 cursor-pointer"
                >
                  Always
                </button>
                <button
                  onClick={() => void replyPermission("reject")}
                  className="inline-flex items-center justify-center rounded-lg border border-neutral-800 bg-neutral-950/70 px-2.5 py-1.5 text-[11px] text-rose-300 hover:bg-neutral-800 cursor-pointer"
                >
                  Reject
                </button>
              </div>
            </div>
          )}

          {question && !permission && (
            <QuestionPanel
              key={question.requestID}
              question={question}
              onAnswer={(answers) => void replyQuestion(answers)}
            />
          )}

          <div className="shrink-0 border-t border-neutral-800 bg-neutral-950/95 p-3">
            {notice && !error && (
              <div className="px-1 pb-1.5 text-xs text-neutral-500">{notice}</div>
            )}
            {error && (
              <div className="px-1 pb-1.5 text-xs text-rose-300">{error}</div>
            )}
            {files.length > 0 && (
              <div className="mb-2 flex flex-wrap gap-1.5">
                {files.map((f) => (
                  <span
                    key={f.id}
                    className="flex items-center gap-1.5 rounded-lg border border-neutral-800 bg-neutral-900 py-1 pl-1 pr-1.5 text-[10px] text-neutral-300"
                  >
                    {f.mime.startsWith("image/") ? (
                      <img src={f.dataUrl} alt={f.name} className="h-6 w-6 rounded object-cover" />
                    ) : (
                      <FileText size={14} className="h-6 w-6 p-1 text-neutral-500" />
                    )}
                    <span className="max-w-32 truncate">{f.name}</span>
                    <button
                      onClick={() => setFiles((prev) => prev.filter((x) => x.id !== f.id))}
                      className="text-neutral-500 hover:text-rose-300 cursor-pointer"
                      title="Remove"
                    >
                      <X size={11} />
                    </button>
                  </span>
                ))}
              </div>
            )}
            <div className="relative flex items-end gap-2">
              {cmdList.length > 0 && (
                <div className="absolute bottom-full left-0 z-10 mb-2 max-h-60 w-96 max-w-full overflow-y-auto rounded-xl border border-neutral-800 bg-neutral-950 shadow-2xl">
                  {cmdList.map((c, i) => (
                    <button
                      key={c.name}
                      onMouseDown={(e) => {
                        e.preventDefault();
                        applyCommand(c);
                      }}
                      className={`flex w-full items-baseline gap-2 px-2.5 py-1.5 text-left cursor-pointer ${
                        i === Math.min(cmdIdx, cmdList.length - 1)
                          ? "bg-neutral-800"
                          : "hover:bg-neutral-800/60"
                      }`}
                    >
                      <span className="shrink-0 font-mono text-sm text-neutral-100">
                        /{c.name}
                      </span>
                      {c.description && (
                        <span className="truncate text-xs text-neutral-500">
                          {c.description}
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              )}
              {mentionList.length > 0 && (
                <div className="absolute bottom-full left-0 z-10 mb-2 max-h-60 w-96 max-w-full overflow-y-auto rounded-xl border border-neutral-800 bg-neutral-950 shadow-2xl">
                  {mentionList.map((path, i) => (
                    <button
                      key={path}
                      onMouseDown={(e) => {
                        e.preventDefault();
                        applyMention(path);
                      }}
                      className={`flex w-full items-center gap-2 px-2.5 py-1.5 text-left cursor-pointer ${
                        i === Math.min(fileIdx, mentionList.length - 1)
                          ? "bg-neutral-800"
                          : "hover:bg-neutral-800/60"
                      }`}
                    >
                      <FileText size={12} className="shrink-0 text-neutral-500" />
                      <span className="truncate font-mono text-xs text-neutral-100">{path}</span>
                    </button>
                  ))}
                </div>
              )}
              <div className="flex shrink-0 items-center gap-0.5">
                {MODES.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => setMode(m.id)}
                    aria-label={`${m.label} mode`}
                    title={
                      m.id === "plan" ? "Plan mode — read-only" : "Build mode"
                    }
                    className={`flex h-9 w-9 items-center justify-center rounded-lg transition-colors cursor-pointer ${
                      mode === m.id
                        ? "bg-neutral-800 text-white"
                        : "text-neutral-500 hover:bg-neutral-800 hover:text-neutral-300"
                    }`}
                  >
                    <m.icon size={15} />
                  </button>
                ))}
                <button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={!running || files.length >= MAX_FILES}
                  className="flex h-9 w-9 items-center justify-center rounded-lg text-neutral-500 transition-colors hover:bg-neutral-800 hover:text-neutral-300 disabled:opacity-40 cursor-pointer"
                  title="Attach files"
                >
                  <Paperclip size={15} />
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  className="hidden"
                  onChange={(e) => {
                    if (e.target.files) void addFiles(e.target.files);
                    e.target.value = "";
                  }}
                />
              </div>
              <textarea
                ref={taRef}
                rows={1}
                value={input}
                onChange={(e) => {
                  setInput(e.target.value);
                  setDismissed(false);
                  setMentionDismissed(false);
                  setCmdIdx(0);
                }}
                onKeyDown={handleKeyDown}
                onPaste={(e) => {
                  if (e.clipboardData.files.length > 0) {
                    e.preventDefault();
                    void addFiles(e.clipboardData.files);
                  }
                }}
                placeholder={
                  running ? "Message…  (/ commands, @ files, Enter to send)" : "Start the server to chat…"
                }
                disabled={!running || sending}
                className="flex-1 resize-none rounded-xl border border-neutral-800 bg-neutral-900 px-2.5 py-2 text-sm text-neutral-100 outline-none placeholder:text-neutral-600 focus:border-neutral-700 disabled:opacity-50"
              />
              <button
                onClick={() => setVoiceOpen(true)}
                disabled={!running}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-neutral-800 bg-neutral-950/70 text-neutral-400 hover:text-sky-300 hover:bg-neutral-800 disabled:opacity-40 cursor-pointer"
                title="Voice input"
              >
                <Mic size={15} />
              </button>
              {sending || busy ? (
                <button
                  onClick={() => void stop()}
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-neutral-800 bg-neutral-950/70 text-rose-300 hover:bg-neutral-800 cursor-pointer"
                  title="Stop generating"
                >
                  <Square size={14} />
                </button>
              ) : (
                <button
                  onClick={() => void send()}
                  disabled={!running || (!input.trim() && files.length === 0)}
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-neutral-100 text-neutral-950 hover:bg-white disabled:opacity-40 cursor-pointer"
                  title="Send"
                >
                  <Send size={15} />
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {showSessionPicker && (
        <SessionPicker
          sessions={sessions.map(
            (s): PickableSession => ({
              id: s.id,
              title: s.title,
              busy: !!sessionBusy[s.id],
              updated: s.time?.updated ?? s.time?.created,
            }),
          )}
          selectedId={activeSessionId}
          onSelect={(id) => {
            setShowSessionPicker(false);
            selectSession(id);
          }}
          onNew={() => {
            setShowSessionPicker(false);
            void newSession();
          }}
          onDelete={(id) => {
            const s = sessions.find((x) => x.id === id);
            if (s) void deleteSession(s);
          }}
          onClose={() => setShowSessionPicker(false)}
        />
      )}

      {showPicker && (
        <ModelPicker
          models={models}
          selected={selectedModel}
          onSelect={(m) => {
            setSelectedModel(m);
            setShowPicker(false);
            setNotice(`Model → ${m.label}`);
          }}
          onClose={() => setShowPicker(false)}
        />
      )}

      <VoiceInputOverlay
        isOpen={voiceOpen}
        onClose={() => setVoiceOpen(false)}
        onSend={handleVoiceSend}
        onTranslate={translateVoice}
      />
    </div>
  );
}
