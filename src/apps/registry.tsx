import { useRef, useState, useEffect, useMemo } from "react";
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

const SSHTerminal = ({ connectionId }: { connectionId?: number }) => {
  const terminalRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const [status, setStatus] = useState<string>("connecting");
  const wsUrl = useMemo(() => {
    if (!connectionId) return null;
    const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsPort = process.env.NEXT_PUBLIC_WS_PORT || "3001";
    return `${proto}//${window.location.hostname}:${wsPort}/ws/ssh?connectionId=${connectionId}`;
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
