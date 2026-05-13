import { useState, useRef, useEffect, useCallback } from "react";

interface ConsoleEntry {
  level: "log" | "warn" | "error" | "info" | "debug";
  text: string;
  timestamp: number;
}

interface DevBrowserProps {
  windowId?: string;
  connectionId?: number;
}

export default function DevBrowser({
  windowId,
  connectionId,
}: DevBrowserProps) {
  const [url, setUrl] = useState("about:blank");
  const [inputUrl, setInputUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [consoleLogs, setConsoleLogs] = useState<ConsoleEntry[]>([]);
  const [showConsole, setShowConsole] = useState(true);
  const [consoleAvailable, setConsoleAvailable] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const consoleEndRef = useRef<HTMLDivElement>(null);

  const apiBaseUrl = useRef<string>("");

  if (!apiBaseUrl.current && typeof window !== "undefined") {
    const configured = process.env.NEXT_PUBLIC_WS_URL;
    if (configured) {
      if (
        configured.startsWith("http://") ||
        configured.startsWith("https://")
      ) {
        apiBaseUrl.current = configured;
      } else if (
        configured.startsWith("ws://") ||
        configured.startsWith("wss://")
      ) {
        apiBaseUrl.current = configured.replace(/^ws/, "http");
      } else {
        apiBaseUrl.current = `${window.location.protocol}//${configured.replace(/^https?:\/\//, "")}`;
      }
    } else {
      apiBaseUrl.current = `${window.location.protocol}//${window.location.hostname}:3001`;
    }
  }

  useEffect(() => {
    consoleEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [consoleLogs]);

  useEffect(() => {
    if (!containerRef.current) return;
    const observer = new ResizeObserver(() => {
      if (iframeRef.current && containerRef.current) {
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
          {
            level: e.data.level,
            text: e.data.text,
            timestamp: e.data.timestamp,
          },
        ]);
      }
    };
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, []);

  const injectConsole = useCallback(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;

    setTimeout(() => {
      try {
        const win = iframe.contentWindow;
        if (!win) {
          setConsoleAvailable(false);
          return;
        }

        const doc = win.document;
        if (!doc) {
          setConsoleAvailable(false);
          return;
        }

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

  const handleNavigate = async (e: React.FormEvent) => {
    e.preventDefault();
    let targetUrl = inputUrl.trim();
    if (!targetUrl) return;

    if (
      /^(localhost|127\.0\.0\.1|0\.0\.0\.0)(:\d+)?(\/.*)?$/i.test(targetUrl)
    ) {
      targetUrl = `http://${targetUrl}`;
    } else if (
      !targetUrl.startsWith("http://") &&
      !targetUrl.startsWith("https://")
    ) {
      targetUrl = "http://" + targetUrl;
    }

    try {
      const parsed = new URL(targetUrl);
      const isLocalHost =
        parsed.hostname === "localhost" ||
        parsed.hostname === "127.0.0.1" ||
        parsed.hostname === "0.0.0.0";

      if (isLocalHost) {
        if (!connectionId) {
          setError(
            "This Dev Browser window is not attached to an SSH connection. Open it from SSH Manager to access remote localhost.",
          );
          setIsLoading(false);
          return;
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
    } catch (err) {
      if (err instanceof Error) {
        setError(err.message);
        setIsLoading(false);
        return;
      }
    }

    setUrl(targetUrl);
    setError(null);
    setIsLoading(true);
    setConsoleLogs([]);
    setConsoleAvailable(false);
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

  const levelBadge = (level: string) => {
    switch (level) {
      case "error": return { bg: "bg-red-500/20", text: "text-red-400", label: "ERR" };
      case "warn": return { bg: "bg-yellow-500/20", text: "text-yellow-400", label: "WRN" };
      case "info": return { bg: "bg-blue-500/20", text: "text-blue-400", label: "INF" };
      case "debug": return { bg: "bg-neutral-500/20", text: "text-neutral-400", label: "DBG" };
      default: return { bg: "bg-neutral-500/20", text: "text-neutral-300", label: "LOG" };
    }
  };

  return (
    <div className="flex flex-col h-full bg-neutral-900">
      <form
        onSubmit={handleNavigate}
        className="flex items-center gap-2 px-3 py-2 bg-neutral-950 border-b border-neutral-800"
      >
        <input
          type="text"
          value={inputUrl}
          onChange={(e) => setInputUrl(e.target.value)}
          placeholder="Enter URL..."
          className="flex-1 px-3 py-1.5 bg-neutral-800 border border-neutral-700 rounded-md text-sm text-neutral-200 placeholder-neutral-500 outline-none focus:border-blue-500"
        />
        <button
          type="submit"
          className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white text-sm rounded-md transition-colors"
        >
          Go
        </button>
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
          onClick={() => window.open(url, "_blank")}
          className="px-3 py-1.5 bg-neutral-800 hover:bg-neutral-700 text-neutral-300 text-sm rounded-md border border-neutral-700 transition-colors"
        >
          ↗
        </button>
      </form>

      <div className="flex-1 flex overflow-hidden">
        <div ref={containerRef} className="flex-1 relative overflow-hidden">
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

          <iframe
            ref={iframeRef}
            src={url}
            className="w-full h-full border-0"
            onLoad={handleLoad}
            onError={handleError}
          />
        </div>

        {showConsole && (
          <div className="w-72 shrink-0 border-l border-neutral-700 bg-[#0a0a0a] flex flex-col">
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
            <div className="flex-1 overflow-auto p-2 font-mono text-[11px] leading-relaxed">
              {consoleLogs.length === 0 && (
                <p className="text-neutral-600 text-center mt-4">
                  {consoleAvailable ? "No output" : isLoading ? "Loading..." : "Console not available"}
                </p>
              )}
              {consoleLogs.map((entry, i) => {
                const badge = levelBadge(entry.level);
                return (
                  <div key={i} className="flex items-start gap-1.5 py-[2px]">
                    <span className={`${badge.bg} ${badge.text} text-[9px] px-1 rounded font-medium shrink-0 mt-[1px]`}>
                      {badge.label}
                    </span>
                    <span className={badge.text + " break-all"}>{entry.text}</span>
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
        <span className="truncate max-w-[200px]">{url}</span>
      </div>
    </div>
  );
}
