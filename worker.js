export default {
  async fetch(request) {
    const url = new URL(request.url);
    const { pathname, search } = url;

    // Allow only read-only methods + preflight
    if (!["GET", "HEAD", "OPTIONS"].includes(request.method)) {
      return new Response("Method Not Allowed", { status: 405 });
    }

    // Handle CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }

    // Allow public FPL API routes (generic, no hardcoded IDs)
    const allowed =
      pathname === "/bootstrap-static" ||
      /^\/entry\/\d+$/.test(pathname) ||
      /^\/entry\/\d+\/history$/.test(pathname) ||
      pathname.startsWith("/fixtures");

    if (!allowed) {
      return new Response(JSON.stringify({ error: "Not found" }), {
        status: 404,
        headers: { ...corsHeaders(), "Content-Type": "application/json" },
      });
    }

    // Forward to FPL API (requires trailing slash)
    const upstreamBase = "https://fantasy.premierleague.com/api";
    const upstreamUrl = `${upstreamBase}${pathname}/` + (search ?? "");

    const upstreamRes = await fetch(upstreamUrl, {
      method: "GET",
      headers: { "User-Agent": "fpl-snapshot-proxy" },
    });

    return new Response(upstreamRes.body, {
      status: upstreamRes.status,
      headers: {
        ...corsHeaders(),
        "Content-Type":
          upstreamRes.headers.get("Content-Type") ?? "application/json",
      },
    });
  },
};

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Cache-Control": "no-store",
  };
}
