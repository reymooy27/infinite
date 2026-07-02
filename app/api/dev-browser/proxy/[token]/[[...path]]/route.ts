import { Buffer } from "node:buffer";

import type { NextRequest } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
  url.pathname = "/";
  url.search = "";
  url.hash = "";
  return url;
}

function buildTargetUrl(origin: URL, pathParts: string[] | undefined, search: string): URL {
  const target = new URL(origin.toString());
  target.pathname = `/${(pathParts ?? []).join("/")}`;
  target.search = search;
  target.hash = "";
  return target;
}

function copyRequestHeaders(req: NextRequest): Headers {
  const headers = new Headers();
  req.headers.forEach((value, key) => {
    if (HOP_BY_HOP_HEADERS.has(key.toLowerCase())) return;
    headers.set(key, value);
  });
  return headers;
}

function copyResponseHeaders(source: Headers): Headers {
  const headers = new Headers();
  source.forEach((value, key) => {
    const lower = key.toLowerCase();
    if (HOP_BY_HOP_HEADERS.has(lower)) return;
    if (lower === "content-security-policy") return;
    if (lower === "x-frame-options") return;
    headers.set(key, value);
  });
  return headers;
}

function injectProxyScript(html: string, targetOrigin: string, proxyBasePath: string): string {
  const baseTag = `<base href="${targetOrigin}/">`;
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
      targetUrl: window.location.pathname + window.location.search + window.location.hash
    }, "*");
  }

  var originalPushState = history.pushState;
  history.pushState = function(state, title, url) {
    var nextUrl = url == null ? url : toProxyUrl(url);
    originalPushState.call(this, state, title, nextUrl);
    notifyParent();
  };

  var originalReplaceState = history.replaceState;
  history.replaceState = function(state, title, url) {
    var nextUrl = url == null ? url : toProxyUrl(url);
    originalReplaceState.call(this, state, title, nextUrl);
    notifyParent();
  };

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

async function handle(req: NextRequest, context: { params: Promise<{ token: string; path?: string[] }> }) {
  const { token, path } = await context.params;
  let origin: URL;
  try {
    origin = decodeOrigin(token);
  } catch {
    return new Response("Invalid proxy target", { status: 400 });
  }

  const upstreamUrl = buildTargetUrl(origin, path, req.nextUrl.search);
  const init: RequestInit & { duplex?: "half" } = {
    method: req.method,
    headers: copyRequestHeaders(req),
    redirect: "manual",
  };

  if (req.method !== "GET" && req.method !== "HEAD") {
    init.body = await req.arrayBuffer();
    init.duplex = "half";
  }

  const upstream = await fetch(upstreamUrl, init);
  const headers = copyResponseHeaders(upstream.headers);
  const contentType = upstream.headers.get("content-type") || "";
  const location = upstream.headers.get("location");

  if (location && upstream.status >= 300 && upstream.status < 400) {
    const redirectTarget = new URL(location, upstreamUrl);
    if (redirectTarget.origin === origin.origin) {
      headers.set(
        "location",
        `/api/dev-browser/proxy/${token}${redirectTarget.pathname}${redirectTarget.search}${redirectTarget.hash}`,
      );
    } else {
      headers.set("location", redirectTarget.toString());
    }
    return new Response(null, {
      status: upstream.status,
      headers,
    });
  }

  if (contentType.includes("text/html")) {
    const html = await upstream.text();
    const proxyBasePath = `/api/dev-browser/proxy/${token}`;
    const injected = injectProxyScript(html, origin.origin, proxyBasePath);
    headers.set("content-type", "text/html; charset=utf-8");
    return new Response(injected, {
      status: upstream.status,
      headers,
    });
  }

  const body = await upstream.arrayBuffer();
  return new Response(body, {
    status: upstream.status,
    headers,
  });
}

export { handle as GET, handle as POST, handle as PUT, handle as PATCH, handle as DELETE, handle as HEAD, handle as OPTIONS };
