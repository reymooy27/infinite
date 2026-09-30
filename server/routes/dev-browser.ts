import { Router, type Request, type Response } from "express";
import http from "http";
import https from "https";

const HOP_BY_HOP_HEADERS = new Set([
  "connection",
  "content-length",
  "content-encoding",
  "host",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

function decodeOrigin(token: string): URL {
  const raw = Buffer.from(token, "base64url").toString("utf8");
  const url = new URL(raw);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Unsupported protocol");
  }
  url.search = "";
  url.hash = "";
  return url;
}

function buildTargetUrl(origin: URL, pathParts: string[], search: string): URL {
  const target = new URL(origin.toString());
  const basePath = target.pathname.replace(/\/+$/, "");
  const suffix = pathParts.join("/");
  target.pathname = suffix ? `${basePath}/${suffix}` : `${basePath || "/"}`;
  target.search = search;
  target.hash = "";
  return target;
}

function copyRequestHeaders(req: Request): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(req.headers)) {
    if (HOP_BY_HOP_HEADERS.has(key.toLowerCase())) continue;
    if (typeof value === "string") headers[key] = value;
    else if (Array.isArray(value)) headers[key] = value[0];
  }
  return headers;
}

function copyResponseHeaders(source: http.IncomingHttpHeaders): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(source)) {
    const lower = key.toLowerCase();
    if (HOP_BY_HOP_HEADERS.has(lower)) continue;
    if (lower === "content-security-policy") continue;
    if (lower === "x-frame-options") continue;
    if (typeof value === "string") headers[key] = value;
    else if (Array.isArray(value)) headers[key] = value[0];
  }
  return headers;
}

// Rewrite root-absolute URLs so they stay under the proxy/tunnel prefix.
// Anchoring <base> on the proxy path fixes relative URLs; these patterns catch
// the root-absolute ones (/assets/…, import "/src/…", url(/font.woff)).
function rewriteRootPaths(body: string, proxyBasePath: string): string {
  return body
    .replace(/(\b(?:src|href|poster|data-src)\s*=\s*["'])\/(?!\/)/g, `$1${proxyBasePath}/`)
    .replace(/(\bfrom\s+["'])\/(?!\/)/g, `$1${proxyBasePath}/`)
    .replace(/(\bimport\(\s*["'])\/(?!\/)/g, `$1${proxyBasePath}/`)
    .replace(/(\bimport\s+["'])\/(?!\/)/g, `$1${proxyBasePath}/`)
    .replace(/(url\(\s*["'])\/(?!\/)/g, `$1${proxyBasePath}/`)
    .replace(/(url\()\/(?!\/)/g, `$1${proxyBasePath}/`);
}

function injectProxyScript(html: string, targetOrigin: string, proxyBasePath: string): string {
  const baseTag = `<base href="${proxyBasePath}/">`;
  const script = `<script>
(function() {
  if (window.__devBrowserProxy) return;
  window.__devBrowserProxy = true;
  var TARGET_ORIGIN = ${JSON.stringify(targetOrigin)};
  var PROXY_BASE = ${JSON.stringify(proxyBasePath)};

  function normalizePath(pathname) {
    if (!pathname.startsWith(PROXY_BASE)) return pathname || "/";
    var next = pathname.slice(PROXY_BASE.length) || "/";
    return next.startsWith("/") ? next : "/" + next;
  }

  function displayUrlFromLocation(loc) {
    return TARGET_ORIGIN + normalizePath(loc.pathname) + loc.search + loc.hash;
  }

  function toProxyUrl(input) {
    if (input == null || input === "") return input;
    var raw = String(input);
    var resolved = new URL(raw, TARGET_ORIGIN + "/");
    if (resolved.origin === window.location.origin) {
      if (resolved.pathname.startsWith(PROXY_BASE)) {
        return resolved.pathname + resolved.search + resolved.hash;
      }
      return PROXY_BASE + resolved.pathname + resolved.search + resolved.hash;
    }
    if (resolved.origin !== TARGET_ORIGIN) return resolved.href;
    return PROXY_BASE + resolved.pathname + resolved.search + resolved.hash;
  }

  function notifyParent() {
    parent.postMessage({
      source: "dev-browser-route",
      displayUrl: displayUrlFromLocation(window.location),
      // Parent feeds this straight into the iframe src, so it must stay a
      // proxy-prefixed path even while the visible location is stripped.
      targetUrl: PROXY_BASE + normalizePath(window.location.pathname) + window.location.search + window.location.hash
    }, "*");
  }

  var originalPushState = history.pushState;
  history.pushState = function(state, title, url) {
    // Pass clean paths through: SPA routers match on location.pathname and
    // would never see a route under the proxy prefix.
    originalPushState.call(this, state, title, url);
    notifyParent();
  };

  var originalReplaceState = history.replaceState;
  history.replaceState = function(state, title, url) {
    originalReplaceState.call(this, state, title, url);
    notifyParent();
  };

  // Hide the proxy prefix from the app's router before its scripts run.
  // ponytail: reloading a rewritten path leaves the proxy (server serves this
  // app instead); upgrade path = path-rewrite middleware keyed on a cookie.
  var initPath = normalizePath(window.location.pathname);
  if (initPath !== window.location.pathname) {
    originalReplaceState.call(history, history.state, "", initPath + window.location.search + window.location.hash);
  }

  var originalFetch = window.fetch;
  window.fetch = function(input, init) {
    if (typeof input === "string") return originalFetch.call(this, toProxyUrl(input), init);
    if (input instanceof Request) {
      return originalFetch.call(this, new Request(toProxyUrl(input.url), input), init);
    }
    return originalFetch.call(this, input, init);
  };

  var originalOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function(method, url) {
    var rest = Array.prototype.slice.call(arguments, 2);
    return originalOpen.call(this, method, toProxyUrl(url), ...rest);
  };

  document.addEventListener("click", function(event) {
    var target = event.target;
    if (!(target instanceof Element)) return;
    var link = target.closest("a[href]");
    if (!link) return;
    var href = link.getAttribute("href");
    if (!href || href.startsWith("#") || href.startsWith("mailto:") || href.startsWith("tel:")) return;
    var nextUrl = toProxyUrl(href);
    if (nextUrl === href) return;
    event.preventDefault();
    window.location.assign(nextUrl);
  }, true);

  document.addEventListener("submit", function(event) {
    var form = event.target;
    if (!(form instanceof HTMLFormElement)) return;
    var action = form.getAttribute("action") || displayUrlFromLocation(window.location);
    var nextUrl = toProxyUrl(action);
    if (nextUrl === action) return;
    form.setAttribute("action", nextUrl);
  }, true);

  window.addEventListener("popstate", notifyParent);
  window.addEventListener("hashchange", notifyParent);
  notifyParent();
})();
</script>`;

  if (/<head[^>]*>/i.test(html)) {
    return html.replace(/<head([^>]*)>/i, `<head$1>${baseTag}${script}`);
  }

  return `${baseTag}${script}${html}`;
}

const router = Router();

// Match: /api/dev-browser/proxy/:token/* or /api/dev-browser/proxy/:token
router.all("/proxy/:token/*splat", handleProxy);
router.all("/proxy/:token", handleProxy);

function handleProxy(req: Request, res: Response) {
  const token = req.params.token as string;
  const pathParam = req.params.splat;
  const pathParts = typeof pathParam === "string" ? pathParam.split("/").filter(Boolean) : Array.isArray(pathParam) ? pathParam.filter(Boolean) : [];

  let origin: URL;
  try {
    origin = decodeOrigin(token);
  } catch {
    res.status(400).send("Invalid proxy target");
    return;
  }

  const upstreamUrl = buildTargetUrl(origin, pathParts, req.url.includes("?") ? req.url.split("?")[1] ? "?" + req.url.split("?")[1] : "" : "");

  const requestHeaders = copyRequestHeaders(req);
  requestHeaders.host = upstreamUrl.host;
  delete requestHeaders["accept-encoding"];

  const isHttps = upstreamUrl.protocol === "https:";
  const transport = isHttps ? https : http;

  const upstreamReq = transport.request(
    {
      protocol: upstreamUrl.protocol,
      hostname: upstreamUrl.hostname,
      port: upstreamUrl.port || (isHttps ? 443 : 80),
      method: req.method,
      path: upstreamUrl.pathname + upstreamUrl.search,
      headers: requestHeaders,
    },
    (upstreamRes) => {
      const headers = copyResponseHeaders(upstreamRes.headers);
      const location = upstreamRes.headers.location;

      if (location && upstreamRes.statusCode && upstreamRes.statusCode >= 300 && upstreamRes.statusCode < 400) {
        const redirectTarget = new URL(location, upstreamUrl);
        if (redirectTarget.origin === origin.origin) {
          headers["location"] = `/api/dev-browser/proxy/${token}${redirectTarget.pathname}${redirectTarget.search}${redirectTarget.hash}`;
        } else {
          headers["location"] = redirectTarget.toString();
        }
        res.writeHead(upstreamRes.statusCode, headers);
        res.end();
        return;
      }

      const contentType = upstreamRes.headers["content-type"] || "";

      if (contentType.includes("text/html")) {
        let html = "";
        upstreamRes.on("data", (chunk: Buffer) => {
          html += chunk.toString("utf8");
        });
        upstreamRes.on("end", () => {
          const proxyBasePath = `/api/dev-browser/proxy/${token}`;
          const injected = injectProxyScript(
            rewriteRootPaths(html, proxyBasePath),
            origin.origin,
            proxyBasePath,
          );
          headers["content-type"] = "text/html; charset=utf-8";
          delete headers["content-length"];
          res.writeHead(upstreamRes.statusCode || 200, headers);
          res.end(injected);
        });
        return;
      }

      // JS/CSS bodies carry root-absolute specifiers too (module imports,
      // @font-face). Buffer small files and rewrite; stream large ones.
      const isRewritableBody =
        /javascript|ecmascript/.test(contentType) || contentType.includes("text/css");
      const proxyBasePath = `/api/dev-browser/proxy/${token}`;
      if (isRewritableBody) {
        let body = "";
        let tooLarge = false;
        upstreamRes.on("data", (chunk: Buffer) => {
          if (tooLarge) return;
          body += chunk.toString("utf8");
          if (body.length > 2 * 1024 * 1024) {
            tooLarge = true;
            res.writeHead(upstreamRes.statusCode || 200, headers);
            res.write(body);
            upstreamRes.pipe(res);
          }
        });
        upstreamRes.on("end", () => {
          if (tooLarge) return;
          delete headers["content-length"];
          res.writeHead(upstreamRes.statusCode || 200, headers);
          res.end(rewriteRootPaths(body, proxyBasePath));
        });
        return;
      }

      res.writeHead(upstreamRes.statusCode || 200, headers);
      upstreamRes.pipe(res);
    },
  );

  upstreamReq.on("error", (err) => {
    if (!res.headersSent) {
      res.status(502).json({ error: `Proxy error: ${err.message}` });
    }
  });

  if (req.method !== "GET" && req.method !== "HEAD") {
    req.pipe(upstreamReq);
  } else {
    upstreamReq.end();
  }
}

export default router;
