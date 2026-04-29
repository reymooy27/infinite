import { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import "@xterm/xterm/css/xterm.css";

const WS_URL = `ws://${window.location.hostname}:3001/ws/ssh`;

export default function SSHTerminal({ connectionId }) {
  const termRef = useRef(null);
  const wsRef = useRef(null);
  const fitRef = useRef(null);
  const containerRef = useRef(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const term = new Terminal({
      theme: {
        background: "#0d1117",
        foreground: "#c9d1d9",
        cursor: "#58a6ff",
        cursorAccent: "#0d1117",
        selectionBackground: "rgba(56, 139, 253, 0.3)",
        selectionForeground: "#ffffff",
        black: "#484f58",
        red: "#ff7b72",
        green: "#3fb950",
        yellow: "#d29922",
        blue: "#58a6ff",
        magenta: "#bc8cff",
        cyan: "#39c5cf",
        white: "#b1bac4",
        brightBlack: "#6e7681",
        brightRed: "#ffa198",
        brightGreen: "#56d364",
        brightYellow: "#e3b341",
        brightBlue: "#79c0ff",
        brightMagenta: "#d2a8ff",
        brightCyan: "#56d4dd",
        brightWhite: "#f0f6fc",
      },
      fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', Menlo, Monaco, 'Courier New', monospace",
      fontSize: 14,
      lineHeight: 1,
      cursorBlink: true,
      cursorStyle: "block",
      scrollback: 10000,
      allowProposedApi: true,
      allowTransparency: true,
      drawBoldTextInBrightColors: true,
      convertEol: false,
    });

    const fitAddon = new FitAddon();
    const webLinksAddon = new WebLinksAddon();
    term.loadAddon(fitAddon);
    term.loadAddon(webLinksAddon);
    term.open(container);
    termRef.current = term;
    fitRef.current = fitAddon;

    requestAnimationFrame(() => {
      fitAddon.fit();
    });

    if (!connectionId) {
      term.writeln("\x1b[33mNo SSH connection selected.\x1b[0m");
      term.writeln("\x1b[90mOpen the SSH panel (left sidebar) and click\x1b[0m");
      term.writeln("\x1b[90m\"Connect\" on a connection to start.\x1b[0m");
      return () => {
        term.dispose();
      };
    }

    const ws = new WebSocket(`${WS_URL}?connectionId=${connectionId}`);
    wsRef.current = ws;

    ws.onopen = () => {
      term.writeln("\x1b[32mConnecting...\x1b[0m\r\n");
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === "data") {
          term.write(atob(msg.data));
        } else if (msg.type === "connected") {
          term.writeln("\x1b[32mConnected!\x1b[0m\r\n");
          term.focus();
          requestAnimationFrame(() => {
            fitAddon.fit();
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({
                type: "resize",
                cols: term.cols,
                rows: term.rows,
              }));
            }
          });
        } else if (msg.type === "error") {
          term.writeln(`\x1b[31mError: ${msg.message}\x1b[0m\r\n`);
        } else if (msg.type === "disconnected") {
          term.writeln("\r\n\x1b[33mDisconnected.\x1b[0m\r\n");
        }
      } catch { /* ignore parse errors */ }
    };

    ws.onclose = () => {
      term.writeln("\r\n\x1b[33mConnection closed.\x1b[0m");
    };

    ws.onerror = () => {
      term.writeln("\x1b[31mConnection failed.\x1b[0m\r\n");
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

    const resizeObserver = new ResizeObserver(() => {
      requestAnimationFrame(() => {
        if (fitRef.current && termRef.current) {
          fitRef.current.fit();
        }
      });
    });
    resizeObserver.observe(container);

    return () => {
      resizeObserver.disconnect();
      term.dispose();
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
        ws.close();
      }
    };
  }, [connectionId]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const stopPropagation = (e) => e.stopPropagation();
    container.addEventListener("click", stopPropagation);
    container.addEventListener("pointerdown", stopPropagation);
    container.addEventListener("dblclick", stopPropagation);

    return () => {
      container.removeEventListener("click", stopPropagation);
      container.removeEventListener("pointerdown", stopPropagation);
      container.removeEventListener("dblclick", stopPropagation);
    };
  }, []);

  return (
    <div
      ref={containerRef}
      className="w-full h-full bg-[#0d1117]"
    />
  );
}