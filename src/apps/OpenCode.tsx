import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  AlertCircle,
  CheckCircle2,
  ChevronRight,
  Loader2,
  Plus,
  Power,
  Send,
  Square,
  X,
} from "lucide-react";
import { api, API_BASE } from "@/lib/api";
import { useProjectStore } from "@/stores/useProjectStore";
import type { Project } from "@/types";

// Backend contract: /api/opencode/:projectId/{start,stop,status} + proxy to the
// opencode HTTP server. ponytail: proxy may 404/409 while the backend agent
// wires it up — every call treats those as "not running", never a hard error.

interface OcSession {
  id: string;
  title?: string;
  cost?: number;
  time?: { created?: number; updated?: number };
}

interface OcCommand {
  name: string;
  description?: string;
  source?: string;
  hints?: string[];
}

interface OcModel {
  providerID: string;
  modelID: string;
  label: string;
  name?: string;
}

const MODEL_HINT: OcCommand = {
  name: "model",
  description: "Switch model: /model <provider/model>",
};

interface OcToolState {
  status: "pending" | "running" | "completed" | "error";
  input?: unknown;
  output?: string;
  error?: string;
  title?: string;
}

interface OcPart {
  id: string;
  type: string;
  text?: string;
  tool?: string;
  state?: OcToolState;
}

interface OcMessageEntry {
  info: { id: string; role?: string; time?: { created?: number } };
  parts: OcPart[];
}

interface OcPermission {
  requestID: string;
  sessionID: string;
  label: string;
  detail: string;
}

type PermissionReply = "once" | "always" | "reject";

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

function PartView({ part }: { part: OcPart }) {
  if (part.type === "text") {
    return (
      <div className="markdown-body text-sm leading-relaxed text-neutral-200">
        <Markdown remarkPlugins={[remarkGfm]}>{part.text ?? ""}</Markdown>
      </div>
    );
  }
  if (part.type === "reasoning") {
    return (
      <details className="my-1">
        <summary className="text-xs text-neutral-500 italic cursor-pointer select-none">
          Reasoning
        </summary>
        <div className="text-xs text-neutral-500 italic mt-1 pl-2 border-l border-neutral-700 whitespace-pre-wrap">
          {part.text}
        </div>
      </details>
    );
  }
  if (part.type === "tool") {
    return <ToolPartView part={part} />;
  }
  return null;
}

function ToolPartView({ part }: { part: OcPart }) {
  const [open, setOpen] = useState(false);
  const state = part.state;
  const status = state?.status;
  return (
    <div className="border border-neutral-700 rounded my-1 overflow-hidden">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-2 px-2.5 py-1.5 text-xs text-neutral-300 hover:bg-neutral-800 cursor-pointer"
      >
        <ChevronRight
          size={12}
          className={`shrink-0 text-neutral-500 transition-transform ${open ? "rotate-90" : ""}`}
        />
        <span className="font-mono text-neutral-200">{part.tool}</span>
        {status === "pending" && (
          <span className="w-2 h-2 rounded-full bg-neutral-500 shrink-0" />
        )}
        {status === "running" && (
          <Loader2 size={12} className="animate-spin text-blue-400 shrink-0" />
        )}
        {status === "completed" && (
          <CheckCircle2 size={12} className="text-green-500 shrink-0" />
        )}
        {status === "error" && <AlertCircle size={12} className="text-red-500 shrink-0" />}
        {state?.title && (
          <span className="text-neutral-500 truncate">{state.title}</span>
        )}
      </button>
      {open && (
        <div className="border-t border-neutral-700 px-2.5 py-2 space-y-1.5 bg-neutral-900/50">
          <pre className="text-[11px] font-mono text-neutral-400 whitespace-pre-wrap break-all">
            {JSON.stringify(state?.input ?? {}, null, 2)}
          </pre>
          {status === "completed" && state?.output && (
            <pre className="text-[11px] font-mono text-neutral-400 whitespace-pre-wrap break-all">
              {state.output}
            </pre>
          )}
          {status === "error" && state?.error && (
            <pre className="text-[11px] font-mono text-red-400 whitespace-pre-wrap break-all">
              {state.error}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}

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
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<OcMessageEntry[]>([]);
  const [sending, setSending] = useState(false);
  const [permission, setPermission] = useState<OcPermission | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [commands, setCommands] = useState<OcCommand[]>([]);
  const [models, setModels] = useState<OcModel[]>([]);
  const [selectedModel, setSelectedModel] = useState<OcModel | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [cmdIdx, setCmdIdx] = useState(0);

  const controllersRef = useRef<Set<AbortController>>(new Set());
  const projectIdRef = useRef<string | null>(null);
  projectIdRef.current = projectId;
  const activeSessionIdRef = useRef<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);

  activeSessionIdRef.current = activeSessionId;

  const track = useCallback((ctrl: AbortController) => {
    controllersRef.current.add(ctrl);
    return ctrl;
  }, []);

  const startServer = useCallback(async () => {
    setStarting(true);
    setError(null);
    try {
      await ocReq(`/api/opencode/${encodeURIComponent(projectIdRef.current ?? "")}/start`, {
        method: "POST",
      });
      setRunning(true);
      return true;
    } catch (err) {
      const e = err as Error & { status?: number };
      if (e.status === 409) {
        setRunning(true);
        return true;
      }
      setError(e.message || "Failed to start");
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
        setSessions(data);
        return data;
      } catch {
        return [];
      } finally {
        controllersRef.current.delete(ctrl);
      }
    },
    [track],
  );

  const fetchMessages = useCallback(
    async (pid: string, sid: string): Promise<OcMessageEntry[]> => {
      const ctrl = track(new AbortController());
      try {
        const data = await ocReq<OcMessageEntry[]>(
          `/api/opencode/${encodeURIComponent(pid)}/proxy/session/${encodeURIComponent(sid)}/message`,
          { signal: ctrl.signal },
        );
        setMessages(data);
        return data;
      } catch {
        return [];
      } finally {
        controllersRef.current.delete(ctrl);
      }
    },
    [track],
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

  // Status poll every 4s while a project is selected. 409/404 = not running.
  useEffect(() => {
    if (!projectId) return;
    let stopped = false;
    const poll = async () => {
      const ctrl = track(new AbortController());
      try {
        const st = await ocReq<{ running: boolean; port?: number }>(
          `/api/opencode/${encodeURIComponent(projectId)}/status`,
          { signal: ctrl.signal },
        );
        if (!stopped) setRunning(st.running);
      } catch {
        if (!stopped) setRunning(false);
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
  }, [projectId, running, fetchSessions]);

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
    ocReq<{ all?: { id: string; models?: Record<string, { name?: string }> }[] }>(
      `/api/opencode/${encodeURIComponent(projectId)}/proxy/provider`,
      { signal: ctrl2.signal },
    )
      .then((j) => {
        const list: OcModel[] = [];
        for (const p of j.all ?? []) {
          for (const [mid, mm] of Object.entries(p.models ?? {})) {
            list.push({ providerID: p.id, modelID: mid, label: `${p.id}/${mid}`, name: mm?.name });
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
    setPermission(null);
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
    selectSession(sessions[0].id);
  }, [autoStart, running, projectId, sessions]);

  // SSE: refetch on part updates (debounced), idle, and permission prompts.
  // Reconnects with a fixed 3s backoff; closed on unmount / project change.
  useEffect(() => {
    if (!projectId || !running) return;
    let es: EventSource | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let closed = false;

    const refetchHistory = () => {
      const sid = activeSessionIdRef.current;
      if (sid && projectId) void fetchMessages(projectId, sid);
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
        if (type === "message.part.updated") {
          if (debounceRef.current) clearTimeout(debounceRef.current);
          debounceRef.current = setTimeout(refetchHistory, 250);
        } else if (type === "session.idle") {
          refetchHistory();
          if (projectId) void fetchSessions(projectId);
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
  }, [projectId, running, fetchMessages, fetchSessions]);

  // Cleanup on unmount: abort in-flight fetches, drop pending debounce.
  useEffect(() => {
    return () => {
      controllersRef.current.forEach((c) => c.abort());
      controllersRef.current.clear();
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  // Auto-scroll unless the user scrolled up.
  useEffect(() => {
    const el = scrollRef.current;
    if (el && stickRef.current) el.scrollTop = el.scrollHeight;
  }, [messages, sending]);

  // Auto-grow composer.
  useEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    if (ta.scrollHeight === 0) return;
    ta.style.height = `${Math.min(ta.scrollHeight, 128)}px`;
  }, [input]);

  const selectSession = (id: string) => {
    setActiveSessionId(id);
    activeSessionIdRef.current = id;
    if (projectId) void fetchMessages(projectId, id);
  };

  const slashQuery = /^\/(\S*)$/.exec(input)?.[1];
  const modelQuery = /^\/model\s+(\S*)$/.exec(input)?.[1];
  const cmdList = useMemo<OcCommand[]>(() => {
    if (dismissed) return [];
    if (modelQuery !== undefined) {
      const q = modelQuery.toLowerCase();
      return models
        .filter((m) => m.label.toLowerCase().includes(q))
        .slice(0, 30)
        .map((m) => ({ name: `model ${m.label}`, description: m.name }));
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
      setActiveSessionId(null);
      activeSessionIdRef.current = null;
      setMessages([]);
      setPermission(null);
      return;
    }
    if (await startServer()) {
      const data = await fetchSessions(projectId);
      if (data.length > 0) selectSession(data[0].id);
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
      selectSession(s.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create session");
    } finally {
      controllersRef.current.delete(ctrl);
    }
  };

  const send = async () => {
    const text = input.trim();
    if (!text || !projectId || !activeSessionId || sending) return;
    const mc = /^\/model(?:\s+(\S*))?$/.exec(text);
    if (mc) {
      setInput("");
      const arg = (mc[1] ?? "").toLowerCase();
      if (!arg) {
        setNotice(
          selectedModel
            ? `Model: ${selectedModel.label} — change with /model <provider/model>`
            : models.length > 0
              ? `Using default model. Type /model <provider/model> — ${models.length} models available.`
              : "No models loaded.",
        );
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
    const optimisticId = `optimistic-${Date.now()}`;
    const optimistic: OcMessageEntry = {
      info: { id: optimisticId, role: "user", time: { created: Date.now() } },
      parts: [{ id: `${optimisticId}-p`, type: "text", text }],
    };
    setMessages((prev) => [...prev, optimistic]);
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
      } else {
        const res = await ocReq<OcMessageEntry>(
          `/api/opencode/${encodeURIComponent(projectId)}/proxy/session/${encodeURIComponent(activeSessionId)}/message`,
          {
            method: "POST",
            body: JSON.stringify({
              parts: [{ type: "text", text }],
              ...(selectedModel
                ? { model: { providerID: selectedModel.providerID, modelID: selectedModel.modelID } }
                : {}),
            }),
            signal: ctrl.signal,
          },
        );
        setMessages((prev) => [...prev.filter((m) => m.info.id !== optimisticId), res]);
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

  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
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

  return (
    <div className="w-full h-full flex flex-col bg-neutral-950 text-neutral-100">
      {/* Top bar: project name (fixed) or picker + power */}
      <div className="flex items-center gap-2 p-2 border-b border-neutral-700 shrink-0">
        {fixedProjectId ? (
          <span className="flex-1 text-sm px-2 py-1 truncate text-neutral-200">
            {projects.find((p) => p.id === fixedProjectId)?.name ?? "OpenCode"}
          </span>
        ) : (
          <select
            className="flex-1 bg-neutral-800 text-sm px-2 py-1 rounded border border-neutral-600 outline-none cursor-pointer"
            value={projectId ?? ""}
            onChange={(e) => {
              setProjectId(e.target.value || null);
              setActiveSessionId(null);
              activeSessionIdRef.current = null;
              setMessages([]);
              setSessions([]);
              setPermission(null);
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
          className={`w-2 h-2 rounded-full shrink-0 ${running ? "bg-green-500" : "bg-neutral-600"}`}
          title={running ? "Running" : "Stopped"}
        />
        {selectedModel && (
          <button
            onClick={() => setSelectedModel(null)}
            className="max-w-40 truncate text-[10px] font-mono px-1.5 py-0.5 rounded bg-neutral-800 border border-neutral-600 text-neutral-300 hover:text-white cursor-pointer"
            title="Clear model override"
          >
            {selectedModel.label} ✕
          </button>
        )}
        <button
          onClick={() => void togglePower()}
          disabled={starting || !projectId}
          className={`w-10 h-10 flex items-center justify-center rounded cursor-pointer disabled:opacity-30 ${
            running
              ? "text-red-400 hover:bg-neutral-600 hover:text-red-300"
              : "text-neutral-400 hover:bg-neutral-600 hover:text-neutral-200"
          }`}
          title={running ? "Stop server" : "Start server"}
        >
          {starting ? (
            <Loader2 size={16} className="animate-spin" />
          ) : (
            <Power size={16} />
          )}
        </button>
        {onClose && (
          <button
            onClick={onClose}
            className="w-10 h-10 flex items-center justify-center rounded text-neutral-400 hover:bg-neutral-600 hover:text-white cursor-pointer shrink-0"
            title="Close"
          >
            <X size={16} />
          </button>
        )}
      </div>

      {running && (
        <div className="sm:hidden flex items-center gap-1.5 px-2 py-1.5 border-b border-neutral-700 shrink-0">
          <select
            value={activeSessionId ?? ""}
            onChange={(e) => e.target.value && selectSession(e.target.value)}
            className="flex-1 min-w-0 bg-neutral-800 text-xs px-2 py-1.5 rounded border border-neutral-600 outline-none cursor-pointer"
          >
            {sessions.length === 0 && <option value="">No sessions</option>}
            {sessions.map((s) => (
              <option key={s.id} value={s.id}>
                {s.title || "Untitled"}
              </option>
            ))}
          </select>
          <button
            onClick={() => void newSession()}
            className="w-8 h-8 flex items-center justify-center rounded bg-neutral-800 border border-neutral-600 text-neutral-200 hover:bg-neutral-700 cursor-pointer shrink-0"
            title="New session"
          >
            <Plus size={14} />
          </button>
        </div>
      )}

      <div className="flex-1 min-h-0 flex">
        {/* Session list */}
        <div className="w-52 border-r border-neutral-700 flex-col shrink-0 hidden sm:flex">
          <div className="p-2 border-b border-neutral-700">
            <button
              onClick={() => void newSession()}
              disabled={!running}
              className="w-full h-10 flex items-center justify-center gap-1.5 rounded bg-neutral-800 border border-neutral-600 text-sm text-neutral-200 hover:bg-neutral-700 disabled:opacity-40 cursor-pointer"
            >
              <Plus size={14} /> New session
            </button>
          </div>
          <div className="flex-1 overflow-y-auto">
            {!running ? (
              <div className="p-3 text-xs text-neutral-500">
                Start the server to see sessions.
              </div>
            ) : sessions.length === 0 ? (
              <div className="p-3 text-xs text-neutral-500">No sessions yet.</div>
            ) : (
              sessions.map((s) => (
                <button
                  key={s.id}
                  onClick={() => selectSession(s.id)}
                  className={`w-full text-left px-3 py-2 border-b border-neutral-800 cursor-pointer ${
                    s.id === activeSessionId
                      ? "bg-neutral-800"
                      : "hover:bg-neutral-800/50"
                  }`}
                >
                  <div className="text-xs text-neutral-200 truncate">
                    {s.title || "Untitled"}
                  </div>
                  <div className="text-[10px] text-neutral-500">
                    {relTime(s.time?.updated ?? s.time?.created)}
                  </div>
                </button>
              ))
            )}
          </div>
        </div>

        {/* Thread + composer */}
        <div className="flex-1 min-w-0 flex flex-col">
          <div
            ref={scrollRef}
            onScroll={handleScroll}
            className="flex-1 overflow-y-auto overflow-x-hidden px-3 py-2"
          >
            {!activeSessionId ? (
              <div className="flex items-center justify-center h-full text-neutral-500 text-sm">
                {running
                  ? "Select or create a session to start chatting."
                  : "Start the server, then pick a session."}
              </div>
            ) : (
              <>
                {messages.map((m) => (
                  <div
                    key={m.info.id}
                    className="py-2 border-b border-neutral-800/60"
                  >
                    <div className="text-[10px] uppercase tracking-wide text-neutral-500 mb-1">
                      {m.info.role === "user" ? "You" : "OpenCode"}
                      {m.info.time?.created
                        ? ` · ${relTime(m.info.time.created)}`
                        : ""}
                    </div>
                    <div className="space-y-1">
                      {m.parts.map((p) => (
                        <PartView key={p.id} part={p} />
                      ))}
                    </div>
                  </div>
                ))}
                {sending && (
                  <div className="py-2 text-xs text-neutral-500 flex items-center gap-2">
                    <Loader2 size={12} className="animate-spin" /> thinking…
                  </div>
                )}
              </>
            )}
          </div>

          {permission && (
            <div className="border-t border-neutral-700 bg-neutral-800/60 px-3 py-2 flex items-center gap-3 flex-wrap">
              <span className="text-xs text-neutral-300 min-w-0">
                <span className="text-amber-400 font-medium">Permission:</span>{" "}
                {permission.label}
                {permission.detail && (
                  <span className="text-neutral-500 font-mono ml-1">
                    {permission.detail}
                  </span>
                )}
              </span>
              <div className="ml-auto flex gap-1.5">
                <button
                  onClick={() => void replyPermission("once")}
                  className="h-10 px-3 text-xs rounded bg-blue-600 hover:bg-blue-500 text-white cursor-pointer"
                >
                  Once
                </button>
                <button
                  onClick={() => void replyPermission("always")}
                  className="h-10 px-3 text-xs rounded bg-neutral-700 hover:bg-neutral-600 text-neutral-200 cursor-pointer"
                >
                  Always
                </button>
                <button
                  onClick={() => void replyPermission("reject")}
                  className="h-10 px-3 text-xs rounded bg-red-600/20 text-red-400 hover:bg-red-600 hover:text-white cursor-pointer"
                >
                  Reject
                </button>
              </div>
            </div>
          )}

          <div className="border-t border-neutral-700 p-2 shrink-0">
            {notice && !error && (
              <div className="text-xs text-neutral-400 px-1 pb-1.5">{notice}</div>
            )}
            {error && (
              <div className="text-xs text-red-400 px-1 pb-1.5">{error}</div>
            )}
            <div className="relative flex items-end gap-2">
              {cmdList.length > 0 && (
                <div className="absolute bottom-full left-0 mb-2 w-96 max-w-full max-h-60 overflow-y-auto rounded border border-neutral-600 bg-neutral-900 shadow-xl z-10">
                  {cmdList.map((c, i) => (
                    <button
                      key={c.name}
                      onMouseDown={(e) => {
                        e.preventDefault();
                        applyCommand(c);
                      }}
                      className={`flex w-full items-baseline gap-2 px-2.5 py-1.5 text-left cursor-pointer ${
                        i === Math.min(cmdIdx, cmdList.length - 1)
                          ? "bg-neutral-700"
                          : "hover:bg-neutral-800"
                      }`}
                    >
                      <span className="font-mono text-sm text-neutral-100 shrink-0">
                        /{c.name}
                      </span>
                      {c.description && (
                        <span className="text-xs text-neutral-500 truncate">
                          {c.description}
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              )}
              <textarea
                ref={taRef}
                rows={1}
                value={input}
                onChange={(e) => {
                  setInput(e.target.value);
                  setDismissed(false);
                  setCmdIdx(0);
                }}
                onKeyDown={handleKeyDown}
                placeholder={
                  running ? "Message…  (/ for commands, Enter to send)" : "Start the server to chat…"
                }
                disabled={!running || sending}
                className="flex-1 resize-none bg-neutral-800 border border-neutral-600 rounded px-2.5 py-2 text-sm text-neutral-100 outline-none placeholder-neutral-500 disabled:opacity-50"
              />
              {sending ? (
                <button
                  onClick={() => void stop()}
                  className="w-10 h-10 flex items-center justify-center rounded bg-red-600/20 text-red-400 hover:bg-red-600 hover:text-white cursor-pointer"
                  title="Stop generating"
                >
                  <Square size={14} />
                </button>
              ) : (
                <button
                  onClick={() => void send()}
                  disabled={!running || !input.trim()}
                  className="w-10 h-10 flex items-center justify-center rounded hover:bg-neutral-600 text-neutral-400 hover:text-neutral-200 disabled:opacity-30 cursor-pointer"
                  title="Send"
                >
                  <Send size={16} />
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
