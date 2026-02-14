const TEAM_ID = 403618;
const FPL_BASE = "https://fantasy.premierleague.com/api";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function withCors(headers = {}) {
  return {
    ...headers,
    ...CORS_HEADERS,
  };
}

function jsonResponse(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: withCors({
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "public, max-age=300",
      ...extraHeaders,
    }),
  });
}

function getUpstreamUrl(pathname) {
  if (pathname === "/bootstrap-static") {
    return `${FPL_BASE}/bootstrap-static/`;
  }

  if (pathname === `/entry/${TEAM_ID}/history`) {
    return `${FPL_BASE}/entry/${TEAM_ID}/history/`;
  }

  return null;
}

export default {
  async fetch(request) {
    const { method } = request;
    const url = new URL(request.url);

    if (method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: withCors({
          "Cache-Control": "public, max-age=300",
        }),
      });
    }

    if (method !== "GET") {
      return jsonResponse({ error: "Method not allowed" }, 405, {
        Allow: "GET,OPTIONS",
      });
    }

    const upstreamUrl = getUpstreamUrl(url.pathname);
    if (!upstreamUrl) {
      return jsonResponse({ error: "Not found" }, 404);
    }

    const upstreamResponse = await fetch(upstreamUrl, {
      method: "GET",
      cf: {
        cacheTtl: 300,
        cacheEverything: true,
      },
    });

    if (!upstreamResponse.ok) {
      return jsonResponse(
        {
          error: "Upstream fetch failed",
          status: upstreamResponse.status,
        },
        502,
      );
    }

    const contentType = upstreamResponse.headers.get("content-type") || "application/json; charset=utf-8";
    const body = await upstreamResponse.text();

    return new Response(body, {
      status: 200,
      headers: withCors({
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=300",
      }),
    });
  },
};
