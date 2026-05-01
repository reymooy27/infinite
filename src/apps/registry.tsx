import { useRef, useState, useEffect, useMemo, useCallback } from "react";
import { Terminal as XTerminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { WebLinksAddon } from "@xterm/addon-web-links";
import type { AppDefinition, AppId } from "@/types";

const CodeEditor = () => {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [content, setContent] = useState("# Start coding...\n");

  const lines = content.split("n").length;

  return (
    <div className="flex h-full bg-neutral-900 text-xs font-mono">
      <div className="flex flex-col items-end pr-2 pl-2 pt-2 text-neutral-600 select-none border-r border-neutral-800 bg-neutral-900">
        {Array.from({ length: lines }, (_, i) => (
          <div key={i} className="leading-5">
            {i + 1}
          </div>
        ))}
      </div>
      <textarea
        ref={textareaRef}
        className="flex-1 p-2 bg-neutral-900 text-neutral-200 resize-none outline-none leading-5"
        value={content}
        onChange={(e) => setContent(e.target.value)}
        spellCheck={false}
      />
    </div>
  );
};

const SimTerminal = () => {
  const [history, setHistory] = useState<string[]>([
    "$ neofetch",
    "   ┌──────────────────────────┐",
    "   │  Hello from Infinite OS  │",
    "   └──────────────────────────┘",
    "",
    "$ date",
  ]);
  const [input, setInput] = useState("");
  const [cmdHistory, setCmdHistory] = useState<string[]>([]);
  const [histIdx, setHistIdx] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView();
  }, [history]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      const cmd = input.trim();
      if (cmd) {
        setCmdHistory((prev) => [...prev, cmd]);
        setHistIdx(-1);
        let output = "";
        if (cmd === "clear") {
          setHistory([]);
        } else if (cmd === "date") {
          output = new Date().toString();
          setHistory((prev) => [...prev, `$ ${cmd}`, output]);
        } else if (cmd === "whoami") {
          output = "user@infinite";
          setHistory((prev) => [...prev, `$ ${cmd}`, output]);
        } else if (cmd === "ls") {
          output = ["apps/", "data/", "config/", "README.md"].join("n");
          setHistory((prev) => [...prev, `$ ${cmd}`, output]);
        } else if (cmd === "neofetch") {
          output = [
            "   ┌──────────────────────────┐",
            "   │  Hello from Infinite OS  │",
            "   └──────────────────────────┘",
          ].join("n");
          setHistory((prev) => [...prev, `$ ${cmd}`, output]);
        } else if (cmd === "help") {
          output = "Available: date, whoami, ls, neofetch, clear";
          setHistory((prev) => [...prev, `$ ${cmd}`, output]);
        } else {
          output = `${cmd}: command not found. Try 'help'`;
          setHistory((prev) => [...prev, `$ ${cmd}`, output]);
        }
      }
      setInput("");
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      const newIdx = histIdx < cmdHistory.length - 1 ? histIdx + 1 : histIdx;
      setHistIdx(newIdx);
      if (cmdHistory.length > 0 && newIdx >= 0) {
        setInput(cmdHistory[cmdHistory.length - 1 - newIdx]);
      }
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      const newIdx = histIdx > 0 ? histIdx - 1 : -1;
      setHistIdx(newIdx);
      setInput(
        newIdx === -1 ? "" : cmdHistory[cmdHistory.length - 1 - newIdx] || "",
      );
    }
  };

  return (
    <div
      className="flex flex-col h-full bg-black text-green-400 p-3 font-mono text-sm cursor-text"
      onClick={() => inputRef.current?.focus()}
    >
      <div className="flex-1 overflow-auto">
        {history.map((line, i) => (
          <div key={i} className="whitespace-pre-wrap">
            {line}
          </div>
        ))}
      </div>
      <div className="flex items-center">
        <span className="mr-1">$</span>
        <input
          ref={inputRef}
          className="flex-1 bg-transparent outline-none border-none text-green-400 caret-green-400"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          autoFocus
        />
      </div>
      <div ref={endRef} />
    </div>
  );
};

const Notes = () => {
  const [content, setContent] = useState("");

  return (
    <textarea
      className="w-full h-full p-4 bg-neutral-800 text-neutral-100 resize-none outline-none text-sm leading-relaxed"
      placeholder="Start typing..."
      value={content}
      onChange={(e) => setContent(e.target.value)}
      autoFocus
    />
  );
};

const BrowserCanvas = ({ windowId }: { windowId?: string }) => {
  const imgRef = useRef<HTMLImageElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const lastClickRef = useRef<{ x: number; y: number; time: number }>({ x: 0, y: 0, time: 0 });
  const frameCountRef = useRef(0);
  const clickRippleRef = useRef<{ x: number; y: number; id: number } | null>(null);
  const rippleIdRef = useRef(0);

  const [url, setUrl] = useState("");
  const [inputUrl, setInputUrl] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [wsStatus, setWsStatus] = useState<string>("idle");
  const [pageUrl, setPageUrl] = useState("");
  const [pageTitle, setPageTitle] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [navHistory, setNavHistory] = useState<string[]>([]);
  const [histIdx, setHistIdx] = useState(-1);
  const [width, setWidth] = useState(1024);
  const [height, setHeight] = useState(700);

  const wsUrl = useMemo(() => {
    const wsBase = process.env.NEXT_PUBLIC_WS_URL || `${window.location.protocol}//${window.location.hostname}:3001`;
    const proto = wsBase.startsWith("wss") || wsBase.startsWith("https") ? "wss:" : "ws:";
    const base = wsBase.replace(/^wss?:\/\//, "");
    return `${proto}//${base}/ws/browser?width=${width}&height=${height}`;
  }, [width, height]);

  useEffect(() => {
    if (containerRef.current) {
      const obs = new ResizeObserver((entries) => {
        const rect = entries[0]?.contentRect;
        if (rect && rect.width > 0 && rect.height > 0) {
          setWidth(Math.round(rect.width));
          setHeight(Math.round(rect.height));
        }
      });
      obs.observe(containerRef.current);
      return () => obs.disconnect();
    }
  }, [isConnected]);

  useEffect(() => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: "resize", width, height }));
    }
  }, [width, height]);

  const disconnect = useCallback(() => {
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    setIsConnected(false);
    setError(null);
  }, []);

  useEffect(() => {
    return () => disconnect();
  }, [disconnect]);

  const connect = useCallback(
    (targetUrl: string) => {
      disconnect();
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        setIsConnected(true);
        setWsStatus("connected");
        setIsLoading(true);
        setError(null);
        frameCountRef.current = 0;
        ws.send(JSON.stringify({ type: "navigate", url: targetUrl }));
      };

      ws.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data);
          switch (msg.type) {
            case "frame":
              frameCountRef.current++;
              if (imgRef.current) {
                imgRef.current.src = `data:image/jpeg;base64,${msg.data}`;
              }
              setIsLoading(false);
              break;
            case "loading":
              setIsLoading(msg.loading);
              break;
            case "url":
              if (
                msg.url &&
                msg.url !== "about:blank" &&
                !msg.url.startsWith("chrome://") &&
                !msg.url.startsWith("chrome-error://")
              ) {
                setPageUrl(msg.url);
                setInputUrl(msg.url);
              }
              break;
            case "title":
              setPageTitle(msg.title);
              break;
            case "error":
              setError(msg.message);
              setIsLoading(false);
              break;
          }
        } catch {
          // ignore malformed
        }
      };

      ws.onclose = () => {
        setIsConnected(false);
        setWsStatus("disconnected");
      };

      ws.onerror = () => {
        setError("WebSocket connection failed");
        setIsConnected(false);
        setWsStatus("error");
        setIsLoading(false);
      };
    },
    [disconnect, wsUrl, width, height],
  );

  const navigate = useCallback(
    (target: string) => {
      const trimmed = target.trim();
      if (!trimmed) return;

      let formatted: string;
      if (/^https?:\/\//i.test(trimmed)) {
        formatted = trimmed;
      } else if (/^[\w-]+\.[\w-]+/.test(trimmed) && !/\s/.test(trimmed)) {
        formatted = `https://${trimmed}`;
      } else {
        formatted = `https://www.google.com/search?q=${encodeURIComponent(trimmed)}`;
      }

      setNavHistory((prev) => {
        const truncated = prev.slice(0, histIdx + 1);
        const next = [...truncated, formatted];
        setHistIdx(next.length - 1);
        return next;
      });
      setUrl(formatted);
      setInputUrl(formatted);
      setError(null);
      connect(formatted);
    },
    [connect, histIdx],
  );

  const goBack = useCallback(() => {
    if (!wsRef.current) return;
    wsRef.current.send(JSON.stringify({ type: "goBack" }));
    setIsLoading(true);
    if (histIdx > 0) {
      const newIdx = histIdx - 1;
      setHistIdx(newIdx);
    }
  }, [histIdx]);

  const goForward = useCallback(() => {
    if (!wsRef.current) return;
    wsRef.current.send(JSON.stringify({ type: "goForward" }));
    setIsLoading(true);
    if (histIdx < navHistory.length - 1) {
      const newIdx = histIdx + 1;
      setHistIdx(newIdx);
    }
  }, [histIdx, navHistory]);

  const handleRefresh = useCallback(() => {
    if (!wsRef.current) return;
    wsRef.current.send(JSON.stringify({ type: "refresh" }));
    setIsLoading(true);
    setError(null);
  }, []);

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      if (inputUrl.trim()) {
        navigate(inputUrl.trim());
      }
    },
    [inputUrl, navigate],
  );

  const getCoords = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return { x: 0, y: 0 };
      return {
        x: Math.round(e.clientX - rect.left),
        y: Math.round(e.clientY - rect.top),
      };
    },
    [],
  );

  const getViewportCoords = useCallback(
    (containerX: number, containerY: number) => {
      const img = imgRef.current;
      const container = containerRef.current;
      if (!img || !container) return { x: containerX, y: containerY };

      const containerRect = container.getBoundingClientRect();
      const natW = img.naturalWidth || width;
      const natH = img.naturalHeight || height;
      if (natW <= 0 || natH <= 0) return { x: containerX, y: containerY };

      const scaleX = containerRect.width / natW;
      const scaleY = containerRect.height / natH;
      const scale = Math.min(scaleX, scaleY);

      const renderedW = natW * scale;
      const renderedH = natH * scale;
      const offsetX = (containerRect.width - renderedW) / 2;
      const offsetY = (containerRect.height - renderedH) / 2;

      return {
        x: Math.round((containerX - offsetX) / scale),
        y: Math.round((containerY - offsetY) / scale),
      };
    },
    [width, height],
  );

  const handleMouseDown = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!wsRef.current) return;
      const containerCoords = getCoords(e);
      const { x, y } = getViewportCoords(containerCoords.x, containerCoords.y);
      const now = Date.now();
      const prev = lastClickRef.current;
      const isDbl =
        Math.abs(x - prev.x) < 5 &&
        Math.abs(y - prev.y) < 5 &&
        now - prev.time < 300;
      lastClickRef.current = { x, y, time: now };

      wsRef.current.send(
        JSON.stringify({
          type: "click",
          x,
          y,
          clickCount: isDbl ? 2 : 1,
        }),
      );

      showRipple(containerCoords.x, containerCoords.y);

      containerRef.current?.focus();
    },
    [getCoords, getViewportCoords],
  );

  const handleWheel = useCallback(
    (e: React.WheelEvent<HTMLDivElement>) => {
      if (!wsRef.current) return;
      e.preventDefault();
      const containerCoords = getCoords(e as unknown as React.MouseEvent<HTMLDivElement>);
      const { x, y } = getViewportCoords(containerCoords.x, containerCoords.y);
      wsRef.current.send(
        JSON.stringify({
          type: "wheel",
          deltaX: e.deltaX,
          deltaY: e.deltaY,
          x,
          y,
        }),
      );
    },
    [getCoords, getViewportCoords],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (!wsRef.current) return;
      // Don't intercept modifier-only keydowns or the input field's events
      if (
        e.key === "Control" ||
        e.key === "Shift" ||
        e.key === "Alt" ||
        e.key === "Meta" ||
        e.target === inputRef.current
      )
        return;

      e.preventDefault();
      wsRef.current.send(
        JSON.stringify({
          type: "keydown",
          key: e.key,
          code: e.code,
          ctrlKey: e.ctrlKey,
          shiftKey: e.shiftKey,
          altKey: e.altKey,
          metaKey: e.metaKey,
        }),
      );
    },
    [],
  );

  const handleKeyUp = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (!wsRef.current) return;
      if (
        e.key === "Control" ||
        e.key === "Shift" ||
        e.key === "Alt" ||
        e.key === "Meta" ||
        e.target === inputRef.current
      )
        return;

      e.preventDefault();
      wsRef.current.send(
        JSON.stringify({
          type: "keyup",
          key: e.key,
          code: e.code,
          ctrlKey: e.ctrlKey,
          shiftKey: e.shiftKey,
          altKey: e.altKey,
          metaKey: e.metaKey,
        }),
      );
    },
    [],
  );

  const showRipple = useCallback((cx: number, cy: number) => {
    const id = ++rippleIdRef.current;
    clickRippleRef.current = { x: cx, y: cy, id };
    setTimeout(() => {
      if (clickRippleRef.current?.id === id) {
        clickRippleRef.current = null;
      }
    }, 400);
  }, []);

  const handlePaste = useCallback(
    (e: React.ClipboardEvent<HTMLDivElement>) => {
      if (!wsRef.current) return;
      const text = e.clipboardData.getData("text");
      if (text) {
        e.preventDefault();
        wsRef.current.send(
          JSON.stringify({ type: "text", key: text }),
        );
      }
    },
    [],
  );

  return (
    <div className="flex flex-col h-full bg-neutral-900">
      <div className="flex items-center gap-1 px-2 py-1.5 border-b border-neutral-800 bg-neutral-900">
        <button
          onClick={goBack}
          disabled={histIdx <= 0}
          className={`w-7 h-7 flex items-center justify-center rounded text-sm transition-colors ${
            histIdx > 0
              ? "text-neutral-300 hover:bg-neutral-700 cursor-pointer"
              : "text-neutral-600 cursor-default"
          }`}
          title="Back"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15,18 9,12 15,6" />
          </svg>
        </button>
        <button
          onClick={goForward}
          disabled={histIdx >= navHistory.length - 1}
          className={`w-7 h-7 flex items-center justify-center rounded text-sm transition-colors ${
            histIdx < navHistory.length - 1
              ? "text-neutral-300 hover:bg-neutral-700 cursor-pointer"
              : "text-neutral-600 cursor-default"
          }`}
          title="Forward"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="9,18 15,12 9,6" />
          </svg>
        </button>
        <button
          onClick={handleRefresh}
          className="w-7 h-7 flex items-center justify-center rounded text-neutral-300 hover:bg-neutral-700 cursor-pointer transition-colors text-sm"
          title="Refresh"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="1,4 1,10 7,10" />
            <polyline points="23,20 23,14 17,14" />
            <path d="M20.49,9A9,9,0,0,0,5.64,5.64L1,10" />
            <path d="M3.51,15A9,9,0,0,0,18.36,18.36L23,14" />
          </svg>
        </button>
        <form onSubmit={handleSubmit} className="flex-1 flex min-w-0">
          <input
            ref={inputRef}
            type="text"
            value={inputUrl}
            onChange={(e) => setInputUrl(e.target.value)}
            onFocus={(e) => e.target.select()}
            placeholder="Search or enter URL..."
            className="w-full px-2.5 py-1 bg-neutral-800 text-neutral-200 text-xs rounded-md outline-none border border-neutral-700 focus:border-blue-500 focus:bg-neutral-800 transition-colors font-mono"
            spellCheck={false}
          />
        </form>
        {pageUrl && (
          <a
            href={pageUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="w-7 h-7 flex items-center justify-center rounded text-neutral-300 hover:bg-neutral-700 cursor-pointer transition-colors"
            title="Open in new tab"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18,13v6a2,2,0,0,1-2,2H5a2,2,0,0,1-2-2V8A2,2,0,0,1,5,6h6" />
              <polyline points="15,3 21,3 21,9" />
              <line x1="10" y1="14" x2="21" y2="3" />
            </svg>
          </a>
        )}
      </div>
      <div
        ref={containerRef}
        className="flex-1 relative bg-white overflow-hidden"
        tabIndex={0}
        onMouseDown={handleMouseDown}
        onWheel={handleWheel}
        onKeyDown={handleKeyDown}
        onKeyUp={handleKeyUp}
        onPaste={handlePaste}
        style={{ outline: "none" }}
      >
        {!isConnected && !error ? (
          <div className="flex items-center justify-center h-full bg-neutral-800">
            <div className="text-center">
              <svg
                width="32"
                height="32"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="mx-auto mb-3 text-neutral-600"
              >
                <circle cx="12" cy="12" r="10" />
                <line x1="2" y1="12" x2="22" y2="12" />
                <path d="M12,2a15.3,15.3,0,0,1,4,10,15.3,15.3,0,0,1-4,10" />
                <path d="M12,2a15.3,15.3,0,0,0-4,10,15.3,15.3,0,0,0,4,10" />
              </svg>
              <p className="text-neutral-500 text-xs">
                Enter a URL above to start browsing
              </p>
            </div>
          </div>
        ) : error ? (
          <div className="flex items-center justify-center h-full bg-neutral-800">
            <div className="text-center px-6">
              <svg
                width="28"
                height="28"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="mx-auto mb-3 text-red-400"
              >
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
              <p className="text-neutral-300 text-sm mb-1">Failed to load page</p>
              <p className="text-neutral-500 text-xs mb-3">{error}</p>
              <a
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-block px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white text-xs rounded-md cursor-pointer transition-colors"
              >
                Open in new tab
              </a>
            </div>
          </div>
        ) : (
          <>
            {isLoading && (
              <div className="absolute inset-0 flex items-center justify-center bg-neutral-100/80 z-10">
                <svg
                  className="animate-spin h-5 w-5 text-blue-500"
                  viewBox="0 0 24 24"
                  fill="none"
                >
                  <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" opacity="0.2" />
                  <path d="M12,2a10,10,0,1,0,10,10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
                </svg>
              </div>
            )}
            <img
              ref={imgRef}
              alt={pageTitle || "Browser viewport"}
              className="w-full h-full object-contain select-none"
              draggable={false}
            />
            {clickRippleRef.current && (
              <div
                key={clickRippleRef.current.id}
                className="absolute pointer-events-none"
                style={{
                  left: clickRippleRef.current.x,
                  top: clickRippleRef.current.y,
                  transform: "translate(-50%, -50%)",
                }}
              >
                <svg
                  width="20"
                  height="20"
                  viewBox="0 0 20 20"
                  className="animate-ping text-blue-400"
                  style={{ animationDuration: "400ms" }}
                >
                  <circle cx="10" cy="10" r="5" fill="none" stroke="currentColor" strokeWidth="2" opacity="0.8" />
                </svg>
              </div>
            )}
          </>
        )}
      </div>
      {isConnected && (
        <div className="flex items-center gap-3 px-3 py-1 border-t border-neutral-800 bg-neutral-900 text-[10px] font-mono">
          <span className="flex items-center gap-1">
            <span className={`w-1.5 h-1.5 rounded-full ${
              wsStatus === "connected" ? "bg-green-500" : wsStatus === "error" ? "bg-red-500" : "bg-yellow-500"
            }`} />
            <span className="text-neutral-400">{wsStatus}</span>
          </span>
          <span className="text-neutral-600">|</span>
          <span className="text-neutral-500">
            frames: <span className="text-neutral-300">{frameCountRef.current}</span>
          </span>
          <span className="text-neutral-600">|</span>
          <span className="text-neutral-500 truncate">
            {pageUrl || url || "-"}
          </span>
        </div>
      )}
    </div>
  );
};

const SSHTerminal = ({ connectionId }: { connectionId?: number }) => {
  const terminalRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const [status, setStatus] = useState<string>("connecting");
  const wsUrl = useMemo(() => {
    if (!connectionId) return null;
    const wsBase = process.env.NEXT_PUBLIC_WS_URL || `${window.location.protocol}//${window.location.hostname}:3001`;
    const proto = wsBase.startsWith("wss") ? "wss:" : wsBase.startsWith("https") ? "wss:" : "ws:";
    const base = wsBase.replace(/^wss?:\/\//, "");
    return `${proto}//${base}/ws/ssh?connectionId=${connectionId}`;
  }, [connectionId]);

  useEffect(() => {
    if (!terminalRef.current || !wsUrl) return;

    const term = new XTerminal({
      theme: {
        foreground: "#e0e0e0",
        background: "#0a0a0a",
        cursor: "#e0e0e0",
      },
      fontSize: 13,
      fontFamily: '"JetBrainsMono Nerd Font", "Courier New", monospace',
      allowProposedApi: true,
      cursorBlink: true,
    });

    const fit = new FitAddon();
    term.loadAddon(fit);
    const links = new WebLinksAddon();
    term.loadAddon(links);
    const unicode11Addon = new Unicode11Addon();
    term.loadAddon(unicode11Addon);
    term.unicode.activeVersion = "11";
    term.open(terminalRef.current);
    fit.fit();

    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;
    setStatus("connecting");

    ws.onopen = () => {
      fit.fit();

      const initialSize = {
        type: "resize",
        cols: term.cols,
        rows: term.rows,
      };
      ws.send(JSON.stringify(initialSize));

      setStatus("connected");
    };

    ws.onclose = () => setStatus("disconnected");
    ws.onerror = () => setStatus("error");

    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.type === "data") {
          const binaryStr = atob(msg.data);
          const bytes = new Uint8Array(binaryStr.length);
          for (let i = 0; i < binaryStr.length; i++) {
            bytes[i] = binaryStr.charCodeAt(i);
          }
          term.write(bytes);
        } else if (msg.type === "error") {
          term.write(`rn${msg.message}rn`);
        }
      } catch {
        term.write(e.data);
      }
    };

    term.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "data", data }));
      }
    });

    term.onResize(({ cols, rows }) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "resize", cols, rows }));
      }
    });

    fit.fit();

    const observer = new ResizeObserver(() => fit.fit());
    observer.observe(terminalRef.current);

    return () => {
      observer.disconnect();
      ws.close();
      term.dispose();
    };
  }, [wsUrl]);

  return (
    <div className="relative w-full h-full">
      <div ref={terminalRef} className="w-full h-full" />
      {status !== "connected" && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/80 text-white text-sm">
          {status === "connecting" && (
            <span className="text-neutral-400">Connecting...</span>
          )}
          {status === "error" && (
            <span className="text-red-400">Connection error</span>
          )}
          {status === "disconnected" && (
            <span className="text-neutral-400">Disconnected</span>
          )}
        </div>
      )}
    </div>
  );
};

export const registry: Record<AppId, AppDefinition> = {
  "code-editor": {
    id: "code-editor",
    title: "Code Editor",
    icon: "{ }",
    component: CodeEditor as React.ComponentType<{
      connectionId?: number;
      windowId?: string;
    }>,
    defaultWidth: 550,
    defaultHeight: 400,
  },
  terminal: {
    id: "terminal",
    title: "Terminal",
    icon: "> $",
    component: SimTerminal as React.ComponentType<{
      connectionId?: number;
      windowId?: string;
    }>,
    defaultWidth: 500,
    defaultHeight: 320,
  },
  notes: {
    id: "notes",
    title: "Notes",
    icon: "📝",
    component: Notes as React.ComponentType<{
      connectionId?: number;
      windowId?: string;
    }>,
    defaultWidth: 380,
    defaultHeight: 350,
  },
  browser: {
    id: "browser",
    title: "Browser",
    icon: "🌐",
    component: BrowserCanvas as React.ComponentType<{
      connectionId?: number;
      windowId?: string;
    }>,
    defaultWidth: 1024,
    defaultHeight: 768,
  },
  ssh: {
    id: "ssh",
    title: "SSH",
    icon: "🖥",
    component: SSHTerminal as React.ComponentType<{
      connectionId?: number;
      windowId?: string;
    }>,
    defaultWidth: 800,
    defaultHeight: 600,
  },
};

export default registry;
