import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { buildHttpBaseUrl } from "@/lib/ws";

interface ConsoleEntry {
  level: "log" | "warn" | "error" | "info" | "debug";
  text: string;
  timestamp: number;
}

interface DevBrowserProps {
  windowId?: string;
  connectionId?: number;
  initialUrl?: string;
}

interface HistoryEntry {
  displayUrl: string;
  targetUrl: string;
}

interface Bookmark {
  id: number;
  url: string;
  createdAt: string;
}

type ConsoleFilter = "all" | "error" | "warn" | "log";
type ViewportPreset = "desktop" | "tablet" | "mobile";

const LAST_URL_STORAGE_KEY = "dev-browser-last-url";
const HISTORY_STORAGE_KEY = "dev-browser-history";

const VIEWPORT_MAX_WIDTHS: Record<ViewportPreset, number | null> = {
  desktop: null,
  tablet: 768,
  mobile: 390,
};

export default function DevBrowser({
  windowId,
  connectionId,
  initialUrl,
}: DevBrowserProps) {
  const storageKey = windowId
    ? `${LAST_URL_STORAGE_KEY}:${windowId}`
    : LAST_URL_STORAGE_KEY;
  const historyStorageKey = windowId
    ? `${HISTORY_STORAGE_KEY}:${windowId}`
    : HISTORY_STORAGE_KEY;

  const [url, setUrl] = useState("");
  const [inputUrl, setInputUrl] = useState(() => {
    if (typeof window === "undefined") return "";
    return window.localStorage.getItem(storageKey) ?? "";
  });
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [consoleLogs, setConsoleLogs] = useState<ConsoleEntry[]>([]);
  const [showConsole, setShowConsole] = useState(false);
  const [consoleAvailable, setConsoleAvailable] = useState(false);
  const [consoleFilter, setConsoleFilter] = useState<ConsoleFilter>("all");
  const [consoleWidth, setConsoleWidth] = useState(288);
  const [history, setHistory] = useState<HistoryEntry[]>(() => {
    if (typeof window === "undefined") return [];
    try {
      const saved = window.localStorage.getItem(historyStorageKey);
      return saved ? (JSON.parse(saved) as HistoryEntry[]) : [];
    } catch {
      return [];
    }
  });
  const [historyIndex, setHistoryIndex] = useState<number>(() => {
    if (typeof window === "undefined") return -1;
    try {
      const saved = window.localStorage.getItem(`${HISTORY_STORAGE_KEY}-index:${windowId ?? ""}`);
      return saved !== null ? parseInt(saved, 10) : -1;
    } catch {
      return -1;
    }
  });
  const [iframeKey, setIframeKey] = useState(0);
  const [quickLinks, setQuickLinks] = useState<Bookmark[]>([]);
  const [viewportPreset, setViewportPreset] = useState<ViewportPreset>("desktop");
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [suggestionIndex, setSuggestionIndex] = useState(-1);

  const containerRef = useRef<HTMLDivElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const consoleEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const isDraggingConsole = useRef(false);
  const dragStartX = useRef(0);
  const dragStartWidth = useRef(0);
  const apiBaseUrl = useRef<string>("");

  if (!apiBaseUrl.current && typeof window !== "undefined") {
    apiBaseUrl.current = buildHttpBaseUrl();
  }

  // ── Derived values ────────────────────────────────────────────────────────

  const suggestions = useMemo(() => {
    const trimmed = inputUrl.trim();
    if (!trimmed) return [];
    const lower = trimmed.toLowerCase();
    const seen = new Set<string>();
    const out: string[] = [];
    for (const bm of quickLinks) {
      if (bm.url.toLowerCase().includes(lower) && !seen.has(bm.url)) {
        seen.add(bm.url);
        out.push(bm.url);
      }
    }
    for (let i = history.length - 1; i >= 0; i--) {
      const du = history[i].displayUrl;
      if (du.toLowerCase().includes(lower) && !seen.has(du)) {
        seen.add(du);
        out.push(du);
      }
    }
    return out.slice(0, 8);
  }, [inputUrl, quickLinks, history]);

  const filteredLogs = useMemo(() => {
    if (consoleFilter === "all") return consoleLogs;
    if (consoleFilter === "error") return consoleLogs.filter((l) => l.level === "error");
    if (consoleFilter === "warn") return consoleLogs.filter((l) => l.level === "warn");
    return consoleLogs.filter((l) => l.level === "log" || l.level === "info" || l.level === "debug");
  }, [consoleLogs, consoleFilter]);

  const logCounts = useMemo(
    () => ({
      error: consoleLogs.filter((l) => l.level === "error").length,
      warn: consoleLogs.filter((l) => l.level === "warn").length,
      log: consoleLogs.filter(
        (l) => l.level === "log" || l.level === "info" || l.level === "debug",
      ).length,
    }),
    [consoleLogs],
  );

  // ── Effects ───────────────────────────────────────────────────────────────

  useEffect(() => {
    consoleEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [consoleLogs]);

  // Persist history (capped at 50 entries)
  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(
      historyStorageKey,
      JSON.stringify(history.slice(-50)),
    );
  }, [history, historyStorageKey]);

  // Persist history index
  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(
      `${HISTORY_STORAGE_KEY}-index:${windowId ?? ""}`,
      String(historyIndex),
    );
  }, [historyIndex, windowId]);

  // Persist last URL (existing behavior)
  useEffect(() => {
    if (typeof window === "undefined") return;
    const currentEntry = history[historyIndex];
    if (!currentEntry?.displayUrl) return;
    window.localStorage.setItem(storageKey, currentEntry.displayUrl);
  }, [history, historyIndex, storageKey]);

  useEffect(() => {
    fetch("/api/bookmarks")
      .then((res) => res.json())
      .then((data) => {
        if (Array.isArray(data)) setQuickLinks(data);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!containerRef.current) return;
    const observer = new ResizeObserver(() => {
      if (iframeRef.current) {
        iframeRef.current.style.height = "100%";
      }
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const handleMessage = (e: MessageEvent) => {
      if (e.data?.source === "dev-browser-console") {
        setConsoleLogs((prev) => [
          ...prev,
          { level: e.data.level, text: e.data.text, timestamp: e.data.timestamp },
        ]);
      }
    };
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, []);

  // Console drag-resize
  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (!isDraggingConsole.current) return;
      const delta = dragStartX.current - e.clientX;
      setConsoleWidth(Math.min(600, Math.max(180, dragStartWidth.current + delta)));
    };
    const onMouseUp = () => {
      if (isDraggingConsole.current) {
        isDraggingConsole.current = false;
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      }
    };
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, []);

  // ── Core functions ─────────────────────────────────────────────────────────

  const injectConsole = useCallback(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;

    setTimeout(() => {
      try {
        const win = iframe.contentWindow;
        if (!win) { setConsoleAvailable(false); return; }
        const doc = win.document;
        if (!doc) { setConsoleAvailable(false); return; }

        const scriptText = `
          (function() {
            if (window.__devBrowserConsole) return;
            window.__devBrowserConsole = true;
            var methods = ['log', 'warn', 'error', 'info', 'debug'];
            methods.forEach(function(method) {
              var original = console[method];
              console[method] = function() {
                original.apply(console, arguments);
                try {
                  var parts = [];
                  for (var i = 0; i < arguments.length; i++) {
                    var a = arguments[i];
                    if (a === null) { parts.push('null'); }
                    else if (a === undefined) { parts.push('undefined'); }
                    else if (typeof a === 'object') {
                      try { parts.push(JSON.stringify(a, null, 2)); }
                      catch(e2) { parts.push(String(a)); }
                    } else {
                      parts.push(String(a));
                    }
                  }
                  parent.postMessage({
                    source: 'dev-browser-console',
                    level: method,
                    text: parts.join(' '),
                    timestamp: Date.now()
                  }, '*');
                } catch(e1) {}
              };
            });
            window.addEventListener('error', function(e) {
              parent.postMessage({
                source: 'dev-browser-console',
                level: 'error',
                text: e.message + (e.filename ? ' (' + e.filename + ':' + e.lineno + ':' + e.colno + ')' : ''),
                timestamp: Date.now()
              }, '*');
            });
            window.addEventListener('unhandledrejection', function(e) {
              parent.postMessage({
                source: 'dev-browser-console',
                level: 'error',
                text: 'Unhandled Promise: ' + (e.reason && e.reason.message ? e.reason.message : String(e.reason)),
                timestamp: Date.now()
              }, '*');
            });
          })();
        `;

        const scriptEl = doc.createElement("script");
        scriptEl.textContent = scriptText;
        (doc.head || doc.documentElement).appendChild(scriptEl);
        setConsoleAvailable(true);
      } catch {
        setConsoleAvailable(false);
      }
    }, 500);
  }, []);

  const resolveTargetUrl = useCallback(
    async (rawUrl: string) => {
      let targetUrl = rawUrl.trim();
      if (!targetUrl) return null;

      // Smart search: bare text with spaces or no dots → DuckDuckGo
      const isLocalhost = /^(localhost|127\.0\.0\.1|0\.0\.0\.0)(:\d+)?(\/.*)?$/i.test(targetUrl);
      const hasProtocol =
        targetUrl.startsWith("http://") || targetUrl.startsWith("https://");
      if (
        !isLocalhost &&
        !hasProtocol &&
        (targetUrl.includes(" ") || !targetUrl.includes("."))
      ) {
        return {
          displayUrl: targetUrl,
          targetUrl: `https://duckduckgo.com/?q=${encodeURIComponent(targetUrl)}`,
        };
      }

      if (isLocalhost) {
        targetUrl = `http://${targetUrl}`;
      } else if (!hasProtocol) {
        targetUrl = "http://" + targetUrl;
      }

      const displayUrl = targetUrl;
      const parsed = new URL(targetUrl);
      const isLocalhostParsed =
        parsed.hostname === "localhost" ||
        parsed.hostname === "127.0.0.1" ||
        parsed.hostname === "0.0.0.0";

      if (isLocalhostParsed) {
        if (!connectionId) {
          return { displayUrl, targetUrl };
        }

        const targetPort = parsed.port
          ? parseInt(parsed.port, 10)
          : parsed.protocol === "https:"
            ? 443
            : 80;

        const res = await fetch(`${apiBaseUrl.current}/api/tunnels`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            connectionId,
            targetHost: "127.0.0.1",
            targetPort,
          }),
        });

        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || "Failed to create localhost tunnel");
        }

        const data = await res.json();
        targetUrl = `${data.url}${parsed.pathname}${parsed.search}${parsed.hash}`;
      }

      return { displayUrl, targetUrl };
    },
    [connectionId],
  );

  const loadEntry = useCallback(
    (entry: HistoryEntry, forceReload = false) => {
      setError(null);
      setIsLoading(true);
      setConsoleLogs([]);
      setConsoleAvailable(false);
      setInputUrl(entry.displayUrl);
      if (forceReload || entry.targetUrl === url) {
        setIframeKey((prev) => prev + 1);
      }
      setUrl(entry.targetUrl);
    },
    [url],
  );

  const navigateToUrl = useCallback(
    async (rawUrl: string) => {
      const trimmed = rawUrl.trim();
      if (!trimmed) return;

      setError(null);
      setIsLoading(true);
      setInputUrl(trimmed);
      setShowSuggestions(false);

      try {
        const entry = await resolveTargetUrl(trimmed);
        if (!entry) { setIsLoading(false); return; }

        const isRefresh =
          historyIndex >= 0 &&
          history[historyIndex]?.displayUrl === entry.displayUrl &&
          history[historyIndex]?.targetUrl === entry.targetUrl;

        if (isRefresh) {
          loadEntry(entry, true);
          return;
        }

        const nextHistory = history.slice(0, historyIndex + 1).concat(entry);
        setHistory(nextHistory);
        setHistoryIndex(nextHistory.length - 1);
        loadEntry(entry);
      } catch (err) {
        if (err instanceof Error) {
          setError(err.message);
          setIsLoading(false);
        }
      }
    },
    [resolveTargetUrl, historyIndex, history, loadEntry],
  );

  // ── Navigation handlers ────────────────────────────────────────────────────

  const handleRefresh = useCallback(() => {
    if (historyIndex < 0 || !history[historyIndex]) return;
    loadEntry(history[historyIndex], true);
  }, [historyIndex, history, loadEntry]);

  const handleBack = useCallback(() => {
    if (historyIndex <= 0) return;
    const nextIndex = historyIndex - 1;
    setHistoryIndex(nextIndex);
    loadEntry(history[nextIndex]);
  }, [historyIndex, history, loadEntry]);

  const handleForward = useCallback(() => {
    if (historyIndex < 0 || historyIndex >= history.length - 1) return;
    const nextIndex = historyIndex + 1;
    setHistoryIndex(nextIndex);
    loadEntry(history[nextIndex]);
  }, [historyIndex, history, loadEntry]);

  // ── Keyboard shortcuts ─────────────────────────────────────────────────────

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;
      if (e.key === "l" || e.key === "L") {
        e.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
      } else if (e.key === "r" || e.key === "R") {
        e.preventDefault();
        handleRefresh();
      } else if (e.key === "[") {
        e.preventDefault();
        handleBack();
      } else if (e.key === "]") {
        e.preventDefault();
        handleForward();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [handleRefresh, handleBack, handleForward]);

  // ── Other handlers ─────────────────────────────────────────────────────────

  const handleNavigate = (e: React.FormEvent) => {
    e.preventDefault();
    const chosen =
      suggestionIndex >= 0 && suggestions[suggestionIndex]
        ? suggestions[suggestionIndex]
        : inputUrl;
    navigateToUrl(chosen);
  };

  useEffect(() => {
    if (initialUrl) navigateToUrl(initialUrl);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const pinUrl =
    historyIndex >= 0 ? history[historyIndex]?.displayUrl : inputUrl.trim() || null;
  const pinnedBookmark = pinUrl ? quickLinks.find((q) => q.url === pinUrl) : null;
  const isPinned = !!pinnedBookmark;

  const togglePin = async () => {
    if (!pinUrl) return;
    if (pinnedBookmark) {
      await fetch(`/api/bookmarks/${pinnedBookmark.id}`, { method: "DELETE" });
      setQuickLinks((prev) => prev.filter((q) => q.id !== pinnedBookmark.id));
    } else {
      const res = await fetch("/api/bookmarks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: pinUrl }),
      });
      if (res.ok) {
        const bookmark = await res.json();
        setQuickLinks((prev) => [bookmark, ...prev]);
      }
    }
  };

  const removeQuickLink = async (id: number) => {
    await fetch(`/api/bookmarks/${id}`, { method: "DELETE" });
    setQuickLinks((prev) => prev.filter((q) => q.id !== id));
  };

  const handleLoad = () => {
    setIsLoading(false);
    setError(null);
    injectConsole();
  };

  const handleError = () => {
    setIsLoading(false);
    setError("This site blocks iframe embedding. Try opening it in a new tab.");
  };

  const clearConsole = () => setConsoleLogs([]);

  const handleInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!showSuggestions || suggestions.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSuggestionIndex((i) => Math.min(i + 1, suggestions.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSuggestionIndex((i) => Math.max(i - 1, -1));
    } else if (e.key === "Escape") {
      setShowSuggestions(false);
      setSuggestionIndex(-1);
    }
  };

  const startConsoleDrag = (e: React.MouseEvent) => {
    isDraggingConsole.current = true;
    dragStartX.current = e.clientX;
    dragStartWidth.current = consoleWidth;
    document.body.style.cursor = "ew-resize";
    document.body.style.userSelect = "none";
    e.preventDefault();
  };

  const levelBadge = (level: string) => {
    switch (level) {
      case "error": return { bg: "bg-red-500/20", text: "text-red-400", label: "ERR" };
      case "warn": return { bg: "bg-yellow-500/20", text: "text-yellow-400", label: "WRN" };
      case "info": return { bg: "bg-blue-500/20", text: "text-blue-400", label: "INF" };
      case "debug": return { bg: "bg-neutral-500/20", text: "text-neutral-400", label: "DBG" };
      default: return { bg: "bg-neutral-500/20", text: "text-neutral-300", label: "LOG" };
    }
  };

  const formatTimestamp = (ts: number) => {
    const d = new Date(ts);
    const hh = d.getHours().toString().padStart(2, "0");
    const mm = d.getMinutes().toString().padStart(2, "0");
    const ss = d.getSeconds().toString().padStart(2, "0");
    const ms = d.getMilliseconds().toString().padStart(3, "0");
    return `${hh}:${mm}:${ss}.${ms}`;
  };

  return (
    <div className="flex flex-col h-full bg-neutral-900">
      {/* URL bar */}
      <form
        onSubmit={handleNavigate}
        className="flex items-center gap-2 px-3 py-2 bg-neutral-950 border-b border-neutral-800"
      >
        <button
          type="button"
          onClick={handleBack}
          disabled={historyIndex <= 0}
          className="px-2.5 py-1.5 bg-neutral-800 hover:bg-neutral-700 disabled:bg-neutral-900 disabled:text-neutral-600 disabled:border-neutral-800 text-neutral-300 text-sm rounded-md border border-neutral-700 transition-colors"
          title="Back (⌘[)"
        >
          ←
        </button>
        <button
          type="button"
          onClick={handleForward}
          disabled={historyIndex < 0 || historyIndex >= history.length - 1}
          className="px-2.5 py-1.5 bg-neutral-800 hover:bg-neutral-700 disabled:bg-neutral-900 disabled:text-neutral-600 disabled:border-neutral-800 text-neutral-300 text-sm rounded-md border border-neutral-700 transition-colors"
          title="Forward (⌘])"
        >
          →
        </button>
        <button
          type="button"
          onClick={handleRefresh}
          disabled={historyIndex < 0}
          className="px-2.5 py-1.5 bg-neutral-800 hover:bg-neutral-700 disabled:bg-neutral-900 disabled:text-neutral-600 disabled:border-neutral-800 text-neutral-300 text-sm rounded-md border border-neutral-700 transition-colors"
          title="Refresh (⌘R)"
        >
          ↻
        </button>

        {/* URL input with autocomplete */}
        <div className="flex-1 relative">
          <input
            ref={inputRef}
            type="text"
            value={inputUrl}
            onChange={(e) => {
              setInputUrl(e.target.value);
              setSuggestionIndex(-1);
              setShowSuggestions(true);
            }}
            onFocus={() => setShowSuggestions(true)}
            onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
            onKeyDown={handleInputKeyDown}
            placeholder="Enter URL or search..."
            className="w-full px-3 py-1.5 bg-neutral-800 border border-neutral-700 rounded-md text-sm text-neutral-200 placeholder-neutral-500 outline-none focus:border-blue-500"
            onMouseDown={(e) => { if (e.button === 1) e.preventDefault(); }}
          />
          {showSuggestions && suggestions.length > 0 && (
            <ul className="absolute left-0 right-0 top-full mt-1 bg-neutral-900 border border-neutral-700 rounded-md overflow-hidden z-50 shadow-xl">
              {suggestions.map((s, i) => (
                <li key={s}>
                  <button
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => {
                      setInputUrl(s);
                      setShowSuggestions(false);
                      setSuggestionIndex(-1);
                      navigateToUrl(s);
                    }}
                    className={`w-full text-left px-3 py-1.5 text-sm font-mono truncate transition-colors ${
                      i === suggestionIndex
                        ? "bg-blue-600/20 text-blue-300"
                        : "text-neutral-300 hover:bg-neutral-800"
                    }`}
                  >
                    {s}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <button
          type="submit"
          className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white text-sm rounded-md transition-colors"
        >
          Go
        </button>

        {/* Viewport presets */}
        <div className="flex gap-0.5">
          {(["desktop", "tablet", "mobile"] as ViewportPreset[]).map((preset) => (
            <button
              key={preset}
              type="button"
              onClick={() => setViewportPreset(preset)}
              className={`px-1.5 py-1.5 text-[10px] rounded border transition-colors ${
                viewportPreset === preset
                  ? "bg-blue-600/20 border-blue-500 text-blue-400"
                  : "border-neutral-700 text-neutral-500 hover:text-neutral-300 hover:bg-neutral-800"
              }`}
              title={
                preset === "desktop"
                  ? "Desktop"
                  : preset === "tablet"
                    ? "Tablet (768px)"
                    : "Mobile (390px)"
              }
            >
              {preset === "desktop" ? "D" : preset === "tablet" ? "T" : "M"}
            </button>
          ))}
        </div>

        <button
          type="button"
          onClick={() => setShowConsole(!showConsole)}
          className={`whitespace-nowrap px-2 py-1.5 text-xs rounded-md border transition-colors ${
            showConsole
              ? "bg-blue-600 border-blue-500 text-white"
              : "border-neutral-700 text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800"
          }`}
          title="Toggle console"
        >
          Console {consoleLogs.length > 0 && `(${consoleLogs.length})`}
        </button>
        <button
          type="button"
          onClick={togglePin}
          disabled={!pinUrl}
          className={`px-2 py-1.5 text-xs rounded-md border transition-colors ${
            isPinned
              ? "bg-yellow-600/20 border-yellow-500 text-yellow-400"
              : "border-neutral-700 text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800 disabled:opacity-30"
          }`}
          title={isPinned ? "Unpin" : "Pin"}
        >
          {isPinned ? "★" : "☆"}
        </button>
        <button
          type="button"
          onClick={() => url && window.open(url, "_blank")}
          disabled={!url}
          className="px-3 py-1.5 bg-neutral-800 hover:bg-neutral-700 disabled:opacity-30 text-neutral-300 text-sm rounded-md border border-neutral-700 transition-colors"
          title="Open in new tab"
        >
          ↗
        </button>
      </form>

      <div className="flex-1 flex overflow-hidden">
        {/* Viewport outer container — shows sidebar when constrained */}
        <div ref={containerRef} className="flex-1 relative overflow-hidden bg-neutral-950">
          <div
            className="relative h-full mx-auto overflow-hidden bg-neutral-900"
            style={
              VIEWPORT_MAX_WIDTHS[viewportPreset] !== null
                ? { maxWidth: VIEWPORT_MAX_WIDTHS[viewportPreset]! }
                : {}
            }
          >
            {isLoading && (
              <div className="absolute inset-0 flex items-center justify-center bg-neutral-900 z-10">
                <span className="text-neutral-400 text-sm">Loading...</span>
              </div>
            )}

            {error ? (
              <div className="absolute inset-0 flex flex-col items-center justify-center bg-neutral-900 z-10">
                <div className="text-center max-w-md">
                  <div className="text-4xl mb-4">⛔</div>
                  <p className="text-neutral-300 mb-2 text-sm">{error}</p>
                  <a
                    href={url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-400 hover:text-blue-300 text-sm underline"
                  >
                    Open in new tab →
                  </a>
                </div>
              </div>
            ) : null}

            {historyIndex < 0 && quickLinks.length > 0 && (
              <div className="absolute inset-0 flex flex-col items-center justify-center bg-neutral-950/90 z-5">
                <p className="text-neutral-600 text-xs mb-3 font-medium tracking-wide uppercase">Quick Access</p>
                <div className="flex flex-wrap gap-2 justify-center max-w-lg px-4">
                  {quickLinks.map((bookmark) => (
                    <div key={bookmark.id} className="group relative">
                      <button
                        onClick={() => navigateToUrl(bookmark.url)}
                        className="px-3 py-2 bg-neutral-800 hover:bg-neutral-700 border border-neutral-700 hover:border-blue-500/50 rounded-lg text-neutral-300 text-sm transition-colors font-mono"
                      >
                        {bookmark.url}
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          removeQuickLink(bookmark.id);
                        }}
                        className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-neutral-800 border border-neutral-700 hover:bg-red-600 hover:border-red-500 text-neutral-500 hover:text-white text-[10px] flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all"
                        title="Remove"
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {url && (
              <iframe
                key={iframeKey}
                ref={iframeRef}
                src={url}
                className="w-full h-full border-0"
                onLoad={handleLoad}
                onError={handleError}
              />
            )}
          </div>
        </div>

        {/* Console panel */}
        {showConsole && (
          <div
            className="shrink-0 border-l border-neutral-700 bg-[#0a0a0a] flex flex-col relative"
            style={{ width: consoleWidth }}
          >
            {/* Drag handle */}
            <div
              className="absolute left-0 top-0 bottom-0 w-1 cursor-ew-resize hover:bg-blue-500/40 transition-colors z-10"
              onMouseDown={startConsoleDrag}
            />

            <div className="flex items-center justify-between px-3 py-1.5 border-b border-neutral-800 shrink-0">
              <span className="text-[11px] text-neutral-400 font-medium">
                Console
                {!consoleAvailable && !isLoading && (
                  <span className="text-neutral-600 ml-1">(unavailable)</span>
                )}
              </span>
              <button
                onClick={clearConsole}
                className="text-[10px] text-neutral-500 hover:text-neutral-300 transition-colors"
              >
                Clear
              </button>
            </div>

            {/* Level filter pills */}
            <div className="flex gap-1 px-2 py-1.5 border-b border-neutral-800 shrink-0">
              {(["all", "error", "warn", "log"] as ConsoleFilter[]).map((f) => {
                const count =
                  f === "all"
                    ? consoleLogs.length
                    : f === "error"
                      ? logCounts.error
                      : f === "warn"
                        ? logCounts.warn
                        : logCounts.log;
                const activeClass =
                  f === "error"
                    ? "bg-red-500/30 text-red-400"
                    : f === "warn"
                      ? "bg-yellow-500/30 text-yellow-400"
                      : f === "log"
                        ? "bg-neutral-500/30 text-neutral-300"
                        : "bg-blue-600/20 text-blue-400";
                return (
                  <button
                    key={f}
                    onClick={() => setConsoleFilter(f)}
                    className={`px-1.5 py-0.5 text-[9px] rounded font-medium transition-colors ${
                      consoleFilter === f
                        ? activeClass
                        : "text-neutral-600 hover:text-neutral-400"
                    }`}
                  >
                    {f.toUpperCase()}
                    {count > 0 && ` ${count}`}
                  </button>
                );
              })}
            </div>

            <div className="flex-1 overflow-auto p-2 font-mono text-[11px] leading-relaxed">
              {filteredLogs.length === 0 && (
                <p className="text-neutral-600 text-center mt-4">
                  {consoleAvailable
                    ? "No output"
                    : isLoading
                      ? "Loading..."
                      : "Console not available"}
                </p>
              )}
              {filteredLogs.map((entry, i) => {
                const badge = levelBadge(entry.level);
                return (
                  <div key={i} className="flex items-start gap-1.5 py-[2px]">
                    <span
                      className={`${badge.bg} ${badge.text} text-[9px] px-1 rounded font-medium shrink-0 mt-[1px]`}
                    >
                      {badge.label}
                    </span>
                    <span className={badge.text + " break-all flex-1"}>{entry.text}</span>
                    <span className="text-neutral-700 text-[9px] shrink-0 ml-1 tabular-nums">
                      {formatTimestamp(entry.timestamp)}
                    </span>
                  </div>
                );
              })}
              <div ref={consoleEndRef} />
            </div>
          </div>
        )}
      </div>

      <div className="flex items-center gap-3 px-3 py-1.5 bg-neutral-950 border-t border-neutral-800 text-xs text-neutral-500">
        <span className="flex items-center gap-1.5">
          <span className={`w-2 h-2 rounded-full ${error ? "bg-red-500" : "bg-green-500"}`} />
          {error ? "Blocked" : "Ready"}
        </span>
        <span className="truncate max-w-[200px]">
          {historyIndex >= 0
            ? history[historyIndex]?.displayUrl
            : inputUrl.trim() || "Start browsing"}
        </span>
        {viewportPreset !== "desktop" && (
          <span className="ml-auto">
            {viewportPreset === "tablet" ? "768px" : "390px"}
          </span>
        )}
      </div>
    </div>
  );
}
