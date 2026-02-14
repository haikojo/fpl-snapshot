export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    const upstreamMap: Record<string, string> = {
      "/bootstrap-static": "https://fantasy.premierleague.com/api/bootstrap-static/",
      "/entry/403618/history": "https://fantasy.premierleague.com/api/entry/403618/history/",
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }

    const upstream = upstreamMap[url.pathname];
    if (!upstream) {
      return json({ error: "Not found", allowed: Object.keys(upstreamMap) }, 404);
    }

    const upstreamUrl = new URL(upstream);
    upstreamUrl.search = url.search;

    const resp = await fetch(upstreamUrl.toString(), {
      method: "GET",
      headers: {
        "Accept": "application/json",
        "User-Agent": request.headers.get("User-Agent") || "fpl-snapshot-proxy",
      },
      cf: { cacheTtl: 60, cacheEverything: true },
    });

    const headers = new Headers(resp.headers);
    for (const [k, v] of Object.entries(corsHeaders())) headers.set(k, v);

    if (!headers.get("content-type")) {
      headers.set("content-type", "application/json; charset=utf-8");
    }

    return new Response(resp.body, { status: resp.status, headers });
  },
};

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
  };
}

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj, null, 2), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...corsHeaders(),
    },
  });
}
