// Apolaki chat proxy — platform-agnostic core.
//
// Forwards a homeowner's question to the team's solar assistant (SEA-LION via
// the llm-slm service on the Mac Studio, reached over a named Cloudflare
// Tunnel) and streams its Server-Sent-Events reply straight back to the
// floating chat widget.
//
// This file holds ALL the logic. The per-platform entry points are thin:
//   netlify/functions/chat.mjs   → Netlify Functions  (process.env)
//   functions/api/chat.js        → Cloudflare Pages   (env binding)
// Both runtimes speak the same Web Request/Response, so the core takes a
// standard Request plus a plain env object and returns a standard Response.

const MODES = new Set(["customer", "buyer", "installer"]);
const MAX_LEN = 1200;

// How long to wait for the assistant's FIRST byte. The Mac Studio may be
// asleep or mid-model-load; we would rather show the fallback than leave the
// visitor watching a dead typing indicator.
const CONNECT_TIMEOUT_MS = 12000;

/** Read the assistant base URL and strip any trailing slashes. */
function baseUrl(env) {
  return String((env && env.SOLAR_ASSISTANT_URL) || "").replace(/\/+$/, "");
}

/**
 * Headers for the hop to the Mac Studio.
 *
 * The tunnel hostname is public, and llm-slm runs with an empty JWT secret
 * (permissive dev auth), so without this the assistant would be an open LLM
 * for anyone who discovered the URL. Cloudflare Access sits in front of the
 * tunnel and only lets through requests carrying a valid service token, which
 * is what these two headers are. They are optional so the chain can be proven
 * end-to-end before Access is configured.
 */
function upstreamHeaders(env) {
  const headers = {
    "Content-Type": "application/json",
    Accept: "text/event-stream",
  };
  if (env && env.CF_ACCESS_CLIENT_ID && env.CF_ACCESS_CLIENT_SECRET) {
    headers["CF-Access-Client-Id"] = env.CF_ACCESS_CLIENT_ID;
    headers["CF-Access-Client-Secret"] = env.CF_ACCESS_CLIENT_SECRET;
  }
  return headers;
}

/** Handle POST /api/chat. */
export async function handleChat(request, env) {
  // 204 is a null-body status: passing even "" to the Response constructor
  // throws a TypeError under undici/workerd rather than returning a response.
  // The pre-refactor chat.mjs had `new Response("", {status:204})` here, which
  // meant a CORS preflight against /api/chat crashed the function.
  if (request.method === "OPTIONS") return new Response(null, { status: 204 });
  if (request.method !== "POST") return sse("The chat endpoint accepts POST only.");

  let body = {};
  try {
    body = await request.json();
  } catch {
    /* malformed JSON falls through to the empty-message branch */
  }

  let message = (body && body.message ? String(body.message) : "").trim();
  if (!message) return sse("Please type a question about going solar.");
  if (message.length > MAX_LEN) message = message.slice(0, MAX_LEN);

  const mode = MODES.has(body && body.mode) ? body.mode : "customer";
  const conversationId = (body && (body.conversation_id || body.conversationId)) || null;

  const base = baseUrl(env);
  if (!base) {
    return sse(
      "The solar assistant isn't connected yet. In the meantime, you can start your free assessment or reach us on the contact page — we'd love to help. ☀️"
    );
  }

  // AbortController bounds the wait for response headers. Once streaming
  // begins the body flows without a deadline, which is what we want: a long,
  // thoughtful answer is not a failure.
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), CONNECT_TIMEOUT_MS);

  let upstream;
  try {
    upstream = await fetch(`${base}/assistant/chat`, {
      method: "POST",
      headers: upstreamHeaders(env),
      body: JSON.stringify({ message, mode, conversation_id: conversationId }),
      signal: abort.signal,
    });
  } catch {
    clearTimeout(timer);
    return sse(
      "Our solar assistant is offline at the moment. You can still start your free assessment or reach us at the contact page — we'll gladly help. ☀️"
    );
  }
  clearTimeout(timer);

  if (!upstream.ok || !upstream.body) {
    return sse(
      "Our solar assistant is briefly unavailable. Please try again shortly, or start your free assessment in the meantime."
    );
  }

  // Stream the assistant's SSE straight through to the browser.
  return new Response(upstream.body, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}

/**
 * Handle GET /api/chat-health.
 *
 * The widget calls this before it draws anything. A visitor who clicks a
 * prominent "Ask Apolaki" button and gets an apology is worse served than one
 * who never saw the button, so the launcher only appears when this says ok.
 *
 * Deliberately cheap: llm-slm's /assistant/health is unauthenticated and only
 * pings Postgres, and the answer is cached at the edge for a minute so a busy
 * page does not hammer the tunnel.
 */
export async function handleHealth(request, env) {
  const base = baseUrl(env);
  if (!base) return healthJson(false, "unconfigured");

  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), 4000);
  try {
    const res = await fetch(`${base}/assistant/health`, {
      method: "GET",
      headers: upstreamHeaders(env),
      signal: abort.signal,
    });
    if (!res.ok) {
      clearTimeout(timer);
      return healthJson(false, "unhealthy");
    }
    // llm-slm answers {"status":"ok"} — or {"status":"db_unreachable"} with a
    // 503, which res.ok already caught. Parse defensively regardless.
    //
    // The timer is deliberately still armed here: fetch() resolves on response
    // HEADERS, so a machine that answers and then stalls mid-body would hang
    // this function indefinitely if the abort were cleared above. Keep the
    // whole probe — headers and body — inside the 4s budget.
    let payload = {};
    try {
      payload = await res.json();
    } catch {
      clearTimeout(timer);
      return healthJson(false, "unparseable");
    }
    clearTimeout(timer);
    return healthJson(payload && payload.status === "ok", (payload && payload.status) || "unknown");
  } catch {
    clearTimeout(timer);
    return healthJson(false, "unreachable");
  }
}

function healthJson(ok, detail) {
  return new Response(JSON.stringify({ ok: !!ok, detail }), {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      // Short cache: recovers within a minute of the Mac waking up, without
      // making every page view a tunnel round-trip.
      "Cache-Control": "public, max-age=60",
    },
  });
}

/** Minimal SSE payload the widget's parser understands (fallback / errors). */
export function sse(text) {
  const payload =
    `data: ${JSON.stringify({ token: text })}\n\n` +
    `event: done\ndata: ${JSON.stringify({ fallback: true })}\n\n`;
  return new Response(payload, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache",
    },
  });
}
