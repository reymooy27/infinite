import type { AppDefinition, AppId } from "@/types";
import { getSSHMetadata } from "@/types";
import { ClipboardAddon } from "@xterm/addon-clipboard";
import { FitAddon } from "@xterm/addon-fit";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { Terminal as XTerminal } from "@xterm/xterm";
import { Copy, Download, FileTerminal, Globe, Monitor, NotepadText, RefreshCw, Upload } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { QuickBar } from "@/components/QuickBar";
import { ShortcutDrawer } from "@/components/ShortcutDrawer";
import DevBrowser from "./DevBrowser";
import Notes from "./Notes";
import { useFileTransferStore } from "@/stores/useFileTransferStore";
import { useSettingsStore } from "@/stores/useSettingsStore";
import { useWindowStore } from "@/stores/useWindowStore";
import { useSSHStore } from "@/stores/useSSHStore";
import { useProjectStore } from "@/stores/useProjectStore";
import { buildWsUrl } from "@/lib/ws";
import { saveBuffer, getBuffer, deleteBuffer } from "@/lib/terminalBufferCache";

const BrowserCanvas = ({ windowId }: { windowId?: string }) => {
  const imgRef = useRef<HTMLImageElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const hiddenInputRef = useRef<HTMLInputElement>(null);
  const lastClickRef = useRef<{ x: number; y: number; time: number }>({ x: 0, y: 0, time: 0 });
  const lastNavigatedUrlRef = useRef("");
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
  const [showMobileKeyboard, setShowMobileKeyboard] = useState(false);
  const isMovingRef = useRef(false);
  const [width, setWidth] = useState(1024);
  const [height, setHeight] = useState(700);
  const [retryKey, setRetryKey] = useState(0);

  const wsUrl = useMemo(() => {
    return buildWsUrl("/ws/browser", { width, height, windowId: windowId || "", r: retryKey });
  }, [windowId, retryKey]);

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
    () => {
      if (!wsUrl) return;
      disconnect();
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        setIsConnected(true);
        setWsStatus("connected");
        setError(null);
        frameCountRef.current = 0;
        ws.send(JSON.stringify({ type: "resize", width, height }));
        if (url) {
          setIsLoading(true);
          lastNavigatedUrlRef.current = url;
          ws.send(JSON.stringify({ type: "navigate", url }));
        }
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

                if (isMovingRef.current) {
                  isMovingRef.current = false;
                } else {
                  setNavHistory((prev) => {
                    const next = prev.slice(0, histIdx + 1);
                    if (next[next.length - 1] !== msg.url) {
                      next.push(msg.url);
                      setHistIdx(next.length - 1);
                    }
                    return next;
                  });
                }
              }
              break;
            case "title":
              setPageTitle(msg.title);
              break;
            case "focus":
              if (msg.isInput) {
                setShowMobileKeyboard(true);
              }
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
    [disconnect, wsUrl, url, width, height],
  );

  useEffect(() => {
    if (!isConnected && !error && (url || retryKey > 0)) {
      connect();
    }
  }, [url, isConnected, error, retryKey, connect]);

  useEffect(() => {
    const ws = wsRef.current;
    if (
      !url ||
      !isConnected ||
      !ws ||
      ws.readyState !== WebSocket.OPEN ||
      lastNavigatedUrlRef.current === url
    ) {
      return;
    }

    setIsLoading(true);
    lastNavigatedUrlRef.current = url;
    ws.send(JSON.stringify({ type: "navigate", url }));
  }, [url, isConnected]);

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

      setUrl(formatted);
      setInputUrl(formatted);
      setError(null);
    },
    [],
  );

  const goBack = useCallback(() => {
    if (!wsRef.current || histIdx <= 0) return;
    isMovingRef.current = true;
    wsRef.current.send(JSON.stringify({ type: "goBack" }));
    setIsLoading(true);
    setHistIdx((prev) => prev - 1);
  }, [histIdx]);

  const goForward = useCallback(() => {
    if (!wsRef.current || histIdx >= navHistory.length - 1) return;
    isMovingRef.current = true;
    wsRef.current.send(JSON.stringify({ type: "goForward" }));
    setIsLoading(true);
    setHistIdx((prev) => prev + 1);
  }, [histIdx, navHistory]);

  const handleHiddenInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (!wsRef.current) return;
    const text = e.target.value;
    if (text) {
      wsRef.current.send(JSON.stringify({ type: "text", key: text }));
      e.target.value = ""; // Clear for next input
    }
  }, []);

  const handleMobileSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setShowMobileKeyboard(false);
  };

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

  useEffect(() => {
    const handleScrollEvent = (e: any) => {
      if (!wsRef.current) return;
      const { amount } = e.detail;

      // Use center of viewport for scrolling
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;

      const centerX = rect.width / 2;
      const centerY = rect.height / 2;
      const { x, y } = getViewportCoords(centerX, centerY);

      wsRef.current.send(
        JSON.stringify({
          type: "wheel",
          deltaX: 0,
          deltaY: amount,
          x,
          y,
        }),
      );
    };

    const handlePageEvent = (e: any) => {
      if (!wsRef.current) return;
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;

      const centerX = rect.width / 2;
      const centerY = rect.height / 2;
      const { x, y } = getViewportCoords(centerX, centerY);
      const deltaY = e.detail.action === "pageup" ? -400 : 400;

      wsRef.current.send(
        JSON.stringify({
          type: "wheel",
          deltaX: 0,
          deltaY,
          x,
          y,
        }),
      );
    };

    window.addEventListener(`app-scroll-${windowId}`, handleScrollEvent);
    window.addEventListener(`app-page-${windowId}`, handlePageEvent);
    return () => {
      window.removeEventListener(`app-scroll-${windowId}`, handleScrollEvent);
      window.removeEventListener(`app-page-${windowId}`, handlePageEvent);
    };
  }, [windowId, getViewportCoords]);

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

      hiddenInputRef.current?.focus();
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
        e.target === inputRef.current ||
        e.target === hiddenInputRef.current
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
        e.target === inputRef.current ||
        e.target === hiddenInputRef.current
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
        <button
          onClick={() => setShowMobileKeyboard(!showMobileKeyboard)}
          className={`w-7 h-7 flex items-center justify-center rounded transition-colors text-sm cursor-pointer ${
            showMobileKeyboard ? "bg-blue-600 text-white" : "text-neutral-300 hover:bg-neutral-700"
          }`}
          title="Toggle Mobile Keyboard"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="2" y="4" width="20" height="16" rx="2" ry="2" />
            <path d="M6 8h.01M10 8h.01M14 8h.01M18 8h.01M6 12h.01M10 12h.01M14 12h.01M18 12h.01M8 16h8" />
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
        <input
          ref={hiddenInputRef}
          type="text"
          className="absolute opacity-0 pointer-events-none p-0 m-0 border-none outline-none w-px h-px overflow-hidden"
          style={{ left: -10, top: -10, zIndex: -1 }}
          onChange={handleHiddenInput}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          autoComplete="off"
        />

        {showMobileKeyboard && (
          <div className="absolute bottom-0 left-0 right-0 p-2 bg-neutral-900/90 border-t border-neutral-700 z-50 animate-in slide-in-from-bottom-2 duration-200">
            <div className="flex items-center gap-2 max-w-md mx-auto">
              <form onSubmit={handleMobileSubmit} className="flex-1 flex">
                <input
                  type="text"
                  autoFocus
                  placeholder="Type here..."
                  className="w-full h-10 px-4 bg-neutral-800 text-white rounded-lg border border-neutral-600 focus:border-blue-500 outline-none text-sm"
                  onChange={handleHiddenInput}
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                />
              </form>
              <button
                onClick={() => setShowMobileKeyboard(false)}
                className="w-10 h-10 flex items-center justify-center bg-neutral-800 hover:bg-neutral-700 text-neutral-400 rounded-lg transition-colors cursor-pointer"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M18 6L6 18M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>
        )}

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
              <p className="text-neutral-500 text-xs mb-4">
                Enter a URL above to start browsing
              </p>
              {windowId && wsStatus === "disconnected" && (
                <button 
                  onClick={() => setRetryKey(k => k + 1)}
                  className="px-3 py-1.5 bg-neutral-700 hover:bg-neutral-600 text-white text-xs rounded transition-colors"
                >
                  Reconnect Session
                </button>
              )}
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
              <div className="flex items-center justify-center gap-2">
                <a
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-block px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white text-xs rounded-md cursor-pointer transition-colors"
                >
                  Open in new tab
                </a>
                <button 
                  onClick={() => setRetryKey(k => k + 1)}
                  className="px-3 py-1.5 bg-neutral-700 hover:bg-neutral-600 text-white text-xs rounded transition-colors"
                >
                  Reconnect
                </button>
              </div>
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

const SSHPane = ({
  connectionId,
  windowId,
  tabId,
  isActive,
  hasNavigated,
}: {
  connectionId?: number;
  windowId?: string;
  tabId: string;
  isActive: boolean;
  hasNavigated?: boolean;
}) => {
  const terminalRef = useRef<HTMLDivElement>(null);
  const termInstanceRef = useRef<XTerminal | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const [status, setStatus] = useState<string>("connecting");
  const [retryKey, setRetryKey] = useState(0);
  const [copyFeedback, setCopyFeedback] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const showTerminalShortcuts = useSettingsStore(
    (s) => s.showTerminalShortcuts,
  );
  const showTmuxShortcuts = useSettingsStore((s) => s.showTmuxShortcuts);
  const quickBarSlots = useSettingsStore((s) => s.quickBarSlots);
  const terminalFontSize = useSettingsStore((s) => s.terminalFontSize);
  const bufferKeyRef = useRef(`${windowId}-${tabId}`);
  const statusRef = useRef(status);
  statusRef.current = status;
  const isActiveRef = useRef(isActive);
  isActiveRef.current = isActive;
  const hasAutoNavigatedRef = useRef(hasNavigated ?? false);

  useEffect(() => {
    bufferKeyRef.current = `${windowId}-${tabId}`;
  }, [windowId, tabId]);

  const snapshotTerminalBuffer = useCallback(() => {
    const term = termInstanceRef.current;
    if (!term) return;

    const lines: string[] = [];
    const buffer = term.buffer.active;
    for (let y = 0; y < buffer.length; y++) {
      lines.push(buffer.getLine(y)?.translateToString() ?? "");
    }

    while (lines.length > 0 && lines[lines.length - 1].trim() === "") {
      lines.pop();
    }

    saveBuffer(bufferKeyRef.current, lines);
  }, []);

  const forceTerminalRepaint = useCallback(() => {
    const term = termInstanceRef.current;
    const fit = fitRef.current;
    if (!term || !fit) return;

    fit.fit();
    if (term.rows > 0) {
      term.refresh(0, term.rows - 1);
    }
    if (term.cols > 0 && term.rows > 0) {
      term.resize(term.cols + 1, term.rows);
      term.resize(term.cols - 1, term.rows);
      term.refresh(0, term.rows - 1);
    }
  }, []);

  const refreshTerminal = useCallback(() => {
    snapshotTerminalBuffer();
    forceTerminalRepaint();
    setRetryKey((k) => k + 1);
  }, [forceTerminalRepaint, snapshotTerminalBuffer]);

  const focusTerminal = useCallback(() => {
    if (!isActiveRef.current) return;
    termInstanceRef.current?.focus();
  }, []);

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 767px)");
    setIsMobile(mq.matches);
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  const wsUrl = useMemo(() => {
    if (!connectionId) return null;
    const sessionId = tabId ? `${windowId || ""}-${tabId}` : (windowId || "");
    return buildWsUrl("/ws/ssh", { connectionId, windowId: sessionId, r: retryKey });
  }, [connectionId, windowId, tabId, retryKey]);

  useEffect(() => {
    const handleScrollEvent = (e: any) => {
      if (!isActiveRef.current) return;
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        const { action } = e.detail;
        const key = action === "pageup" ? "\x1b[5~" : "\x1b[6~";
        wsRef.current.send(JSON.stringify({ type: "data", data: key }));
      }
    };

    window.addEventListener(`app-page-${windowId}`, handleScrollEvent);
    return () =>
      window.removeEventListener(`app-page-${windowId}`, handleScrollEvent);
  }, [windowId]);

  useEffect(() => {
    const handleVisibility = () => {
      if (document.hidden) {
        snapshotTerminalBuffer();
        return;
      }
      if (!document.hidden) {
        const ws = wsRef.current;
        const isStale = !ws || ws.readyState === WebSocket.CLOSED || ws.readyState === WebSocket.CLOSING;
        if (isStale || statusRef.current === "disconnected" || statusRef.current === "error") {
          setRetryKey((k) => k + 1);
        }
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () =>
      document.removeEventListener("visibilitychange", handleVisibility);
  }, [snapshotTerminalBuffer]);

  useEffect(() => {
    const handleBeforeUnload = () => {
      snapshotTerminalBuffer();
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [snapshotTerminalBuffer]);

  useEffect(() => {
    if (!terminalRef.current) return;

    const term = new XTerminal({
      theme: {
        foreground: "#e0e0e0",
        background: "#0a0a0a",
        cursor: "#e0e0e0",
      },
      fontSize: terminalFontSize,
      fontFamily: '"JetBrains Mono", "JetBrainsMono Nerd Font", monospace',
      allowProposedApi: true,
      cursorBlink: true,
      scrollback: 3000,
    });
    termInstanceRef.current = term;

    const fit = new FitAddon();
    fitRef.current = fit;
    term.loadAddon(fit);
    const links = new WebLinksAddon((_event, uri) => {
      const { openApp } = useWindowStore.getState();
      openApp("devBrowser", undefined, undefined, {
        initialUrl: uri,
        title: `Dev Browser`,
      });
    });
    term.loadAddon(links);
    const unicode11Addon = new Unicode11Addon();
    term.loadAddon(unicode11Addon);
    term.unicode.activeVersion = "11";
    const clipboardAddon = new ClipboardAddon();
    term.loadAddon(clipboardAddon);
    term.open(terminalRef.current);

    requestAnimationFrame(focusTerminal);

    // Restore cached terminal content from previous project switch
    const cached = getBuffer(bufferKeyRef.current);
    if (cached && cached.length > 0) {
      term.write(cached.join('\r\n'));
    }
    deleteBuffer(bufferKeyRef.current);

    term.onData((data) => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: "data", data }));
      }
    });

    term.onResize(({ cols, rows }) => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: "resize", cols, rows }));
      }
    });

    term.onTitleChange((newTitle) => {
      if (!windowId || !newTitle || !tabId) return;
      useWindowStore.getState().setActiveTabTitle(windowId, tabId, newTitle);
    });

    const observer = new ResizeObserver(() => {
      requestAnimationFrame(forceTerminalRepaint);
    });
    observer.observe(terminalRef.current);

    // Periodically save terminal buffer to cache (for project switch persistence)
    const saveTimer = setInterval(() => {
      snapshotTerminalBuffer();
    }, 3000);

    // Force a canvas re-creation after the initial layout completes.
    // This works around a GPU compositing issue where the canvas
    // renderer doesn't paint under CSS transforms until the canvas
    // is recreated (e.g. on manual resize).
    let kickRaf = 0;
    const kickCanvas = () => forceTerminalRepaint();
    kickRaf = requestAnimationFrame(kickCanvas);

    return () => {
      cancelAnimationFrame(kickRaf);
      clearInterval(saveTimer);
      // Save buffer before unmount so content persists across project switches
      snapshotTerminalBuffer();
      observer.disconnect();
      term.dispose();
      termInstanceRef.current = null;
      fitRef.current = null;
    };
  }, [focusTerminal, forceTerminalRepaint, snapshotTerminalBuffer]);

  useEffect(() => {
    if (isActive) {
      requestAnimationFrame(() => {
        forceTerminalRepaint();
        focusTerminal();
      });
    }
  }, [focusTerminal, forceTerminalRepaint, isActive]);

  useEffect(() => {
    if (termInstanceRef.current) {
      termInstanceRef.current.options.fontSize = terminalFontSize;
      forceTerminalRepaint();
    }
  }, [forceTerminalRepaint, terminalFontSize]);

  useEffect(() => {
    const container = terminalRef.current;
    if (!container) return;

    let startPos = { x: 0, y: 0 };
    let isDragSelection = false;

    const getXterm = (): HTMLElement | null =>
      container.querySelector(".xterm");

    const getScreen = (): HTMLElement | null =>
      container.querySelector(".xterm-screen");

    const dispatchDoc = (type: string, props: Record<string, number>) => {
      document.dispatchEvent(
        new MouseEvent(type, { bubbles: true, cancelable: true, ...props }),
      );
    };

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) return;
      const screen = getScreen();
      if (!screen || !screen.contains(e.target as Node)) return;

      startPos = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      isDragSelection = false;
    };

    const onTouchMove = (e: TouchEvent) => {
      if (e.touches.length !== 1) return;

      const dx = e.touches[0].clientX - startPos.x;
      const dy = e.touches[0].clientY - startPos.y;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist < 2) return;

      const xtermEl = getXterm();
      if (!xtermEl) return;

      e.preventDefault();

      if (!isDragSelection && dist > 8) {
        isDragSelection = true;
        xtermEl.dispatchEvent(
          new MouseEvent("mousedown", {
            bubbles: true,
            cancelable: true,
            clientX: startPos.x,
            clientY: startPos.y,
            button: 0,
            buttons: 1,
            detail: 1,
          }),
        );
      }

      if (isDragSelection) {
        const t = e.touches[0];
        dispatchDoc("mousemove", {
          clientX: t.clientX,
          clientY: t.clientY,
          button: 0,
          buttons: 1,
        });
      }
    };

    const onTouchEnd = (e: TouchEvent) => {
      if (isDragSelection && e.changedTouches.length === 1) {
        const t = e.changedTouches[0];
        dispatchDoc("mouseup", {
          clientX: t.clientX,
          clientY: t.clientY,
          button: 0,
          buttons: 1,
        });
        e.preventDefault();
      }
      isDragSelection = false;
    };

    const onAuxClick = (e: MouseEvent) => {
      if (e.button === 1) {
        e.preventDefault();
        e.stopPropagation();
      }
    };

    container.addEventListener("touchstart", onTouchStart, { passive: false });
    container.addEventListener("touchmove", onTouchMove, { passive: false });
    container.addEventListener("touchend", onTouchEnd, { passive: false });
    container.addEventListener("auxclick", onAuxClick, true);

    return () => {
      container.removeEventListener("touchstart", onTouchStart);
      container.removeEventListener("touchmove", onTouchMove);
      container.removeEventListener("touchend", onTouchEnd);
      container.removeEventListener("auxclick", onAuxClick, true);
    };
  }, []);

  useEffect(() => {
    if (!wsUrl) return;

    const term = termInstanceRef.current;
    const fit = fitRef.current;

    const ws = new WebSocket(wsUrl);
    ws.binaryType = "arraybuffer";
    wsRef.current = ws;
    setStatus("connecting");

    ws.onopen = () => {
      if (fit && term) {
        ws.send(
          JSON.stringify({
            type: "resize",
            cols: term.cols,
            rows: term.rows,
          }),
        );
        requestAnimationFrame(() => {
          forceTerminalRepaint();
          focusTerminal();
        });
      }
      setStatus("connected");
    };

    // Send ping every 20s to keep connection alive through proxies/firewalls
    const pingInterval = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "ping" }));
      }
    }, 20000);

    ws.onclose = () => {
      clearInterval(pingInterval);
      snapshotTerminalBuffer();
      setStatus("disconnected");
    };
    ws.onerror = () => {
      clearInterval(pingInterval);
      snapshotTerminalBuffer();
      setStatus("error");
    };

    ws.onmessage = (e) => {
      try {
        if (e.data instanceof ArrayBuffer) {
          if (term) {
            if (!hasAutoNavigatedRef.current) {
              hasAutoNavigatedRef.current = true;
              if (windowId && tabId) {
                useWindowStore.getState().markTabNavigated(windowId, tabId);
              }
              const { projects, activeProjectId } = useProjectStore.getState();
              const dir = projects.find((p) => p.id === activeProjectId)?.directory;
              if (dir && ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ type: "data", data: `cd ${dir}\r` }));
              }
            }
            term.write(new Uint8Array(e.data));
          }
          return;
        }

        const msg = JSON.parse(e.data);

        if (msg.type === "data" && term) {
          // First data from server means the shell is ready — send auto-cd now
          if (!hasAutoNavigatedRef.current) {
            hasAutoNavigatedRef.current = true;
            if (windowId && tabId) {
              useWindowStore.getState().markTabNavigated(windowId, tabId);
            }
            const { projects, activeProjectId } = useProjectStore.getState();
            const dir = projects.find((p) => p.id === activeProjectId)?.directory;
            if (dir && ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({ type: "data", data: `cd ${dir}\r` }));
            }
          }
          const binaryStr = atob(msg.data);
          const bytes = new Uint8Array(binaryStr.length);
          for (let i = 0; i < binaryStr.length; i++) {
            bytes[i] = binaryStr.charCodeAt(i);
          }
          term.write(bytes);
        } else if (msg.type === "error" && term) {
          term.write(`\r\n${msg.message}\r\n`);
        }
      } catch (err) {
        console.warn("[SSHTerminal] Failed to process message:", err);
      }
    };

    return () => {
      clearInterval(pingInterval);
      snapshotTerminalBuffer();
      ws.close();
    };
  }, [focusTerminal, forceTerminalRepaint, snapshotTerminalBuffer, tabId, windowId, wsUrl]);

  const sendShortcut = useCallback((data: string) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: "data", data }));
    }
  }, []);

  const sendTmux = useCallback((key: string) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: "data", data: "\x02" }));
      setTimeout(() => {
        if (wsRef.current?.readyState === WebSocket.OPEN) {
          wsRef.current.send(JSON.stringify({ type: "data", data: key }));
        }
      }, 80);
    }
  }, []);

  const handleCopy = useCallback(async () => {
    const term = termInstanceRef.current;
    if (!term) return;
    const selection = term.getSelection();
    if (!selection) return;

    const showFeedback = () => {
      setCopyFeedback(true);
      setTimeout(() => setCopyFeedback(false), 1200);
    };

    // 1. Try modern clipboard API (secure context / localhost)
    try {
      await navigator.clipboard.writeText(selection);
      showFeedback();
      return;
    } catch {}

    // 2. Try legacy execCommand fallback (works on more mobile browsers)
    try {
      const ta = document.createElement("textarea");
      ta.value = selection;
      ta.style.position = "fixed";
      ta.style.top = "0";
      ta.style.left = "0";
      ta.style.opacity = "0";
      ta.style.pointerEvents = "none";
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      showFeedback();
      return;
    } catch {}

    // 3. Try OSC 52 self-feed through terminal parser (triggers ClipboardAddon)
    try {
      const b64 = btoa(unescape(encodeURIComponent(selection)));
      term.write(`\x1b]52;c;${b64}\x07`);
      showFeedback();
    } catch {}
  }, []);

  const handleUploadClick = useCallback(() => {
    if (!connectionId) return;
    const conns = useSSHStore.getState().connections;
    const conn = conns.find((c) => c.id === connectionId);
    if (conn) useFileTransferStore.getState().openUpload(conn);
  }, [connectionId]);

  const handleDownloadClick = useCallback(() => {
    if (!connectionId) return;
    const conns = useSSHStore.getState().connections;
    const conn = conns.find((c) => c.id === connectionId);
    if (conn) useFileTransferStore.getState().openDownload(conn);
  }, [connectionId]);

  return (
    <div
      style={{ visibility: isActive ? "visible" : "hidden", position: "absolute", inset: 0 }}
      className={`px-2 bg-[#0a0a0a] ${
        isMobile
          ? "pt-2 pb-14"
          : showTerminalShortcuts
            ? showTmuxShortcuts
              ? "pt-2 pb-28"
              : "pt-2 pb-16"
            : "py-2"
      }`}
    >
      <div ref={terminalRef} className="w-full h-full" />

      {/* Mobile UI */}
      {status === "connected" && isMobile && (
        <div className="absolute bottom-1 left-1 right-1 z-30">
          <QuickBar
            onSend={sendShortcut}
            onTmux={sendTmux}
            onCopy={handleCopy}
            onToggleDrawer={() => setDrawerOpen((o) => !o)}
            copyFeedback={copyFeedback}
            drawerOpen={drawerOpen}
          />
        </div>
      )}
      {status === "connected" && isMobile && drawerOpen && (
        <ShortcutDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} onSend={sendShortcut} onTmux={sendTmux} anchorRef={terminalRef} />
      )}

      {/* Desktop UI */}
      {status === "connected" && !isMobile && showTerminalShortcuts && (
        <div className="absolute bottom-2 left-2 right-2 z-40 flex flex-col gap-1.5">
          <div className="flex items-center gap-1 px-2 py-1.5 bg-neutral-900/80 backdrop-blur-sm border border-neutral-700 rounded-lg">
            <button
              onClick={() => sendShortcut("\x03")}
              className="flex-1 h-7 px-1 flex items-center justify-center rounded-md text-[10px] text-neutral-400 hover:text-white hover:bg-neutral-700 transition-colors cursor-pointer font-mono"
              title="Ctrl+C (interrupt)"
            >
              C-c
            </button>
            <button
              onClick={() => sendShortcut("\x04")}
              className="flex-1 h-7 px-1 flex items-center justify-center rounded-md text-[10px] text-neutral-400 hover:text-white hover:bg-neutral-700 transition-colors cursor-pointer font-mono"
              title="Ctrl+D (EOF)"
            >
              C-d
            </button>
            <button
              onClick={() => sendShortcut("\x15")}
              className="flex-1 h-7 px-1 flex items-center justify-center rounded-md text-[10px] text-neutral-400 hover:text-white hover:bg-neutral-700 transition-colors cursor-pointer font-mono"
              title="Ctrl+U (clear line)"
            >
              C-u
            </button>
            <button
              onClick={() => sendShortcut("\x17")}
              className="flex-1 h-7 px-1 flex items-center justify-center rounded-md text-[10px] text-neutral-400 hover:text-white hover:bg-neutral-700 transition-colors cursor-pointer font-mono"
              title="Ctrl+W (delete word)"
            >
              C-w
            </button>
            <button
              onClick={() => sendShortcut("\x0c")}
              className="flex-1 h-7 px-1 flex items-center justify-center rounded-md text-[10px] text-neutral-400 hover:text-white hover:bg-neutral-700 transition-colors cursor-pointer font-mono"
              title="Ctrl+L (clear screen)"
            >
              C-l
            </button>
            <div className="w-px h-4 bg-neutral-700" />
            <button
              onClick={() => sendShortcut("\x1b[A")}
              className="flex-1 h-7 px-1 flex items-center justify-center rounded-md text-sm text-neutral-400 hover:text-white hover:bg-neutral-700 transition-colors cursor-pointer"
              title="Arrow Up"
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <polyline points="18 15 12 9 6 15" />
              </svg>
            </button>
            <button
              onClick={() => sendShortcut("\x1b[B")}
              className="flex-1 h-7 px-1 flex items-center justify-center rounded-md text-sm text-neutral-400 hover:text-white hover:bg-neutral-700 transition-colors cursor-pointer"
              title="Arrow Down"
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </button>
            <div className="w-px h-4 bg-neutral-700" />
            <button
              onClick={() => sendShortcut("\x09")}
              className="flex-1 h-7 px-1 flex items-center justify-center rounded-md text-[10px] text-neutral-400 hover:text-white hover:bg-neutral-700 transition-colors cursor-pointer font-mono"
              title="Tab"
            >
              Tab
            </button>
            <button
              onClick={() => sendShortcut("\r")}
              className="flex-1 h-7 px-1 flex items-center justify-center rounded-md text-[10px] text-neutral-400 hover:text-white hover:bg-neutral-700 transition-colors cursor-pointer font-mono"
              title="Enter"
            >
              Enter
            </button>
            <div className="w-px h-4 bg-neutral-700" />
            <button
              onClick={handleCopy}
              className="flex-1 h-7 px-1 flex items-center justify-center rounded-md text-[10px] text-neutral-400 hover:text-white hover:bg-neutral-700 transition-colors cursor-pointer font-mono"
              title="Copy selected text"
            >
              {copyFeedback ? (
                <span className="text-green-400">Copied!</span>
              ) : (
                <Copy size={12} />
              )}
            </button>
            <div className="w-px h-4 bg-neutral-700" />
            <button
              onClick={handleUploadClick}
              className="flex-1 h-7 px-1 flex items-center justify-center rounded-md text-[10px] text-neutral-400 hover:text-white hover:bg-neutral-700 transition-colors cursor-pointer"
              title="Upload file to remote"
            >
              <Upload size={12} />
            </button>
            <button
              onClick={handleDownloadClick}
              className="flex-1 h-7 px-1 flex items-center justify-center rounded-md text-[10px] text-neutral-400 hover:text-white hover:bg-neutral-700 transition-colors cursor-pointer"
              title="Download file from remote"
            >
              <Download size={12} />
            </button>
          </div>
          {showTmuxShortcuts && (() => {
            const tmux = quickBarSlots.filter((s) => s.isTmux);
            return tmux.length > 0 ? (
            <div className="flex items-center gap-1 px-2 py-1.5 bg-neutral-900/80 backdrop-blur-sm border border-neutral-600 rounded-lg">
              <span className="text-[9px] text-neutral-600 font-mono shrink-0 mr-0.5">
                tmux
              </span>
              {tmux.map((s) => (
                <button
                  key={s.data}
                  onClick={() => sendTmux(s.data)}
                  className="flex-1 h-7 px-1 flex items-center justify-center rounded-md text-[10px] text-neutral-500 hover:text-white hover:bg-neutral-700 transition-colors cursor-pointer font-mono"
                >
                  {s.label}
                </button>
              ))}
            </div>
          ) : null})()}
        </div>
      )}
      {status !== "connected" && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/80 text-white text-sm z-50">
          {status === "connecting" && (
            <span className="text-neutral-400">Connecting...</span>
          )}
          {status === "error" && (
            <div className="text-center">
              <p className="text-red-400 mb-4">Connection error</p>
              <button
                onClick={refreshTerminal}
                className="px-4 py-2 bg-neutral-800 hover:bg-neutral-700 border border-neutral-700 rounded-md transition-colors text-xs"
              >
                Refresh
              </button>
            </div>
          )}
          {status === "disconnected" && (
            <div className="text-center">
              <p className="text-neutral-400 mb-4">Disconnected</p>
              <button
                onClick={refreshTerminal}
                className="px-4 py-2 bg-neutral-800 hover:bg-neutral-700 border border-neutral-700 rounded-md transition-colors text-xs"
              >
                Refresh
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

const SSHTerminal = ({
  connectionId,
  windowId,
}: {
  connectionId?: number;
  windowId?: string;
}) => {
  const win = useWindowStore((s) => s.windows.find((w) => w.id === windowId));
  const addTerminalTab = useWindowStore((s) => s.addTerminalTab);
  const closeTerminalTab = useWindowStore((s) => s.closeTerminalTab);
  const setActiveTerminalTab = useWindowStore((s) => s.setActiveTerminalTab);

  const sshMeta = win ? getSSHMetadata(win) : null;
  const tabs = sshMeta?.tabs ?? [{ id: "default", label: "Tab 1", connectionId }];
  const activeTabId = sshMeta?.activeTabId ?? tabs[0]?.id ?? "default";
  const [paneRefreshKey, setPaneRefreshKey] = useState(0);

  const handleAddTab = () => {
    if (!windowId) return;
    const newTabId = `tab-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    addTerminalTab(windowId, {
      id: newTabId,
      label: `Tab ${tabs.length + 1}`,
      connectionId,
    });
  };

  const handleCloseTab = (e: React.MouseEvent, tabId: string) => {
    e.stopPropagation();
    if (windowId && tabs.length > 1) closeTerminalTab(windowId, tabId);
  };

  const handleRefresh = () => {
    setPaneRefreshKey((k) => k + 1);
  };

  return (
    <div className="w-full h-full flex flex-col bg-[#0a0a0a]">
      <div className="flex items-center h-9 bg-neutral-950 border-b border-neutral-800 shrink-0 overflow-x-auto scrollbar-none">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => windowId && setActiveTerminalTab(windowId, tab.id)}
            className={`flex items-center gap-1 px-3 h-full text-xs shrink-0 border-r border-neutral-800 transition-colors cursor-pointer ${
              tab.id === activeTabId
                ? "text-white bg-[#0a0a0a]"
                : "text-neutral-500 hover:text-neutral-300 hover:bg-neutral-900"
            }`}
          >
            <span className="max-w-[6rem] truncate">{tab.title ?? tab.label}</span>
            {tabs.length > 1 && (
              <span
                onClick={(e) => handleCloseTab(e, tab.id)}
                className="ml-0.5 leading-none text-neutral-600 hover:text-white transition-colors"
              >
                ×
              </span>
            )}
          </button>
        ))}
        <button
          onClick={handleRefresh}
          title="Refresh terminal"
          className="px-2.5 h-full text-neutral-600 hover:text-white transition-colors cursor-pointer shrink-0"
        >
          <RefreshCw size={14} />
        </button>
        <button
          onClick={handleAddTab}
          title="New tab"
          className="px-2.5 h-full text-neutral-600 hover:text-white transition-colors cursor-pointer text-base leading-none shrink-0"
        >
          +
        </button>
      </div>

      <div className="relative flex-1 min-h-0">
        {tabs.map((tab) => (
          <SSHPane
            key={`${tab.id}-${paneRefreshKey}`}
            tabId={tab.id}
            windowId={windowId}
            connectionId={tab.connectionId ?? connectionId}
            isActive={tab.id === activeTabId}
            hasNavigated={tab.hasNavigated}
          />
        ))}
      </div>
    </div>
  );
};

export const registry: Record<AppId, AppDefinition> = {
  notes: {
    id: "notes",
    title: "Notes",
    icon: <NotepadText />,
    component: Notes as React.ComponentType<{
      connectionId?: number;
      windowId?: string;
    }>,
    defaultWidth: 600,
    defaultHeight: 450,
  },
  ssh: {
    id: "ssh",
    title: "SSH",
    icon: <FileTerminal />,
    component: SSHTerminal as React.ComponentType<{
      connectionId?: number;
      windowId?: string;
    }>,
    defaultWidth: 800,
    defaultHeight: 600,
  },
  devBrowser: {
    id: "devBrowser",
    title: "Dev Browser",
    icon: <Globe />,
    component: DevBrowser as React.ComponentType<{
      connectionId?: number;
      windowId?: string;
    }>,
    defaultWidth: 1024,
    defaultHeight: 768,
  },
  browserCanvas: {
    id: "browserCanvas",
    title: "Browser",
    icon: <Monitor />,
    component: BrowserCanvas as React.ComponentType<{
      connectionId?: number;
      windowId?: string;
    }>,
    defaultWidth: 1280,
    defaultHeight: 800,
  },
};

export default registry;
