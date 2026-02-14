const FPL_API_BASE = "https://fantasy.premierleague.com/api";

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function withCors(headers: Headers): Headers {
  Object.entries(CORS_HEADERS).forEach(([key, value]) => headers.set(key, value));
  return headers;
}

function jsonResponse(body: unknown, status = 200, extraHeaders: Record<string, string> = {}): Response {
  const headers = new Headers({
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "public, max-age=300, s-maxage=300",
    ...extraHeaders,
  });
  return new Response(JSON.stringify(body), {
    status,
    headers: withCors(headers),
  });
}

function mapPathToUpstream(pathname: string): string | null {
  if (/^\/bootstrap-static\/?$/.test(pathname)) {
    return "/bootstrap-static/";
  }

  if (/^\/fixtures\/?$/.test(pathname)) {
    return "/fixtures/";
  }

  const entryHistory = pathname.match(/^\/entry\/(\d+)\/history\/?$/);
  if (entryHistory) {
    return `/entry/${entryHistory[1]}/history/`;
  }

  const entry = pathname.match(/^\/entry\/(\d+)\/?$/);
  if (entry) {
    return `/entry/${entry[1]}/`;
  }

  return null;
}

export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const method = request.method.toUpperCase();

    if (method === "OPTIONS") {
      const headers = new Headers({
        "Cache-Control": "public, max-age=300, s-maxage=300",
      });
      return new Response(null, {
        status: 204,
        headers: withCors(headers),
      });
    }

    if (method !== "GET" && method !== "HEAD") {
      return jsonResponse(
        { error: "Method not allowed" },
        405,
        { Allow: "GET, HEAD, OPTIONS" },
      );
    }

    const mappedPath = mapPathToUpstream(url.pathname);
    if (!mappedPath) {
      return jsonResponse({ error: "Not found" }, 404);
    }

    const upstreamUrl = `${FPL_API_BASE}${mappedPath}${url.search}`;
    const upstreamResponse = await fetch(upstreamUrl, {
      method,
      cf: {
        cacheEverything: true,
        cacheTtl: 300,
      },
    });

    const responseHeaders = new Headers();
    const upstreamContentType = upstreamResponse.headers.get("content-type");
    if (upstreamContentType) {
      responseHeaders.set("Content-Type", upstreamContentType);
    } else {
      responseHeaders.set("Content-Type", "application/json; charset=utf-8");
    }
    responseHeaders.set("Cache-Control", "public, max-age=300, s-maxage=300");
    withCors(responseHeaders);

    return new Response(method === "HEAD" ? null : upstreamResponse.body, {
      status: upstreamResponse.status,
      headers: responseHeaders,
    });
  },
};
