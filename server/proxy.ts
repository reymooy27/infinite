import http from "http";
import net from "net";
import httpProxy from "http-proxy";

const PORT = 8080;

const proxy = httpProxy.createProxyServer({
  ws: true,
});

const server = http.createServer((req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host}`);
  const pathname = url.pathname;

  const isWsPath = pathname === "/ws/ssh" || pathname === "/ws/browser" || pathname.startsWith("/ws/");
  const targetPort = pathname === "/health" ? 3001 : (isWsPath ? 3001 : 3000);

  proxy.web(req, res, {
    target: { host: "127.0.0.1", port: targetPort, protocol: "http" },
    changeOrigin: true,
  });
});

server.on("upgrade", (req, socket, head) => {
  const url = new URL(req.url || "/", `http://${req.headers.host}`);
  const pathname = url.pathname;
  const isWsPath = pathname.startsWith("/ws/");
  const targetPort = isWsPath ? 3001 : 3000;

  proxy.ws(req, socket, head, {
    target: { host: "127.0.0.1", port: targetPort, protocol: "http" },
    changeOrigin: true,
  });
});

proxy.on("error", (err, req, res) => {
  if (res && res.writableEnded !== undefined && !res.writableEnded) {
    if (typeof (res as any).writeHead === "function") {
      (res as http.ServerResponse).writeHead(502);
      (res as http.ServerResponse).end("Proxy error");
    } else {
      (res as net.Socket).destroy();
    }
  }
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`[proxy] HTTP+WS proxy running on :${PORT}`);
});