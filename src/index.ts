const FPL_API_BASE = "https://fantasy.premierleague.com/api";

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function withCors(headers: Headers): Headers {
  Object.entries(CORS_HEADERS).forEach(([key, value]) => headers.set(key, value));
  headers.set("Cache-Control", "no-store");
  return headers;
}

function jsonError(status: number, message: string): Response {
  const headers = withCors(new Headers({ "Content-Type": "application/json; charset=utf-8" }));
  return new Response(JSON.stringify({ error: message }), { status, headers });
}

function normalizePath(pathname: string): string {
  if (pathname === "/") return "/";
  return pathname.replace(/\/+$/, "");
}

function isAllowedPath(pathname: string): boolean {
  const path = normalizePath(pathname);
  if (path === "/bootstrap-static") return true;
  if (/^\/entry\/\d+$/.test(path)) return true;
  if (/^\/entry\/\d+\/history$/.test(path)) return true;
  if (path === "/fixtures") return true;
  return false;
}

function ensureTrailingSlash(pathname: string): string {
  const path = normalizePath(pathname);
  if (path === "/") return "/";
  return `${path}/`;
}

export default {
  async fetch(request: Request): Promise<Response> {
    const method = request.method.toUpperCase();
    const url = new URL(request.url);

    if (method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: withCors(new Headers()),
      });
    }

    if (method !== "GET" && method !== "HEAD") {
      return jsonError(405, "Method not allowed");
    }

    if (!isAllowedPath(url.pathname)) {
      return jsonError(404, "Not found");
    }

    const upstreamPath = ensureTrailingSlash(url.pathname);
    const upstreamUrl = `${FPL_API_BASE}${upstreamPath}${url.search}`;

    const upstreamResponse = await fetch(upstreamUrl, { method });
    const headers = withCors(new Headers());
    const contentType = upstreamResponse.headers.get("Content-Type");
    if (contentType) {
      headers.set("Content-Type", contentType);
    }

    return new Response(method === "HEAD" ? null : upstreamResponse.body, {
      status: upstreamResponse.status,
      headers,
    });
  },
};
