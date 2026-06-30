// Apolaki chat proxy — forwards a message to the team's solar assistant
// (Gemma via the llm-slm service, reached over SOLAR_ASSISTANT_URL) and streams
// its Server-Sent-Events response straight back to the floating chat widget.
//
// The widget calls POST /api/chat (see `config.path`). No auth/cookies needed:
// this is the public, homeowner-facing entry point. The assistant URL lives in
// an env var so it can be swapped when the ngrok/tunnel URL changes — with a
// sensible default so it works out of the box.

// The assistant's base URL is provided via the SOLAR_ASSISTANT_URL env var
// (set in Netlify) so the tunnel/host can be swapped without a code change and
// is never committed to the public repo.
const MODES = new Set(["customer", "buyer", "installer"]);
const MAX_LEN = 1200;

export default async (req) => {
  if (req.method === "OPTIONS") return new Response("", { status: 204 });
  if (req.method !== "POST") return sse("The chat endpoint accepts POST only.");

  let body = {};
  try { body = await req.json(); } catch { /* fall through */ }

  let message = (body && body.message ? String(body.message) : "").trim();
  if (!message) return sse("Please type a question about going solar.");
  if (message.length > MAX_LEN) message = message.slice(0, MAX_LEN);

  const mode = MODES.has(body.mode) ? body.mode : "customer";
  const conversationId = body.conversation_id || body.conversationId || null;
  const base = (process.env.SOLAR_ASSISTANT_URL || "").replace(/\/+$/, "");
  if (!base) {
    return sse("The solar assistant isn’t connected yet. In the meantime, you can start your free assessment or reach us on the contact page — we’d love to help. ☀️");
  }

  let upstream;
  try {
    upstream = await fetch(`${base}/assistant/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "text/event-stream",
        "ngrok-skip-browser-warning": "true",
      },
      body: JSON.stringify({ message, mode, conversation_id: conversationId }),
    });
  } catch {
    return sse("Our solar assistant is offline at the moment. You can still start your free assessment or reach us at the contact page — we’ll gladly help. ☀️");
  }

  if (!upstream.ok || !upstream.body) {
    return sse("Our solar assistant is briefly unavailable. Please try again shortly, or start your free assessment in the meantime.");
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
};

// Minimal SSE payload the widget's parser understands (fallback / errors).
function sse(text) {
  const payload =
    `data: ${JSON.stringify({ token: text })}\n\n` +
    `event: done\ndata: ${JSON.stringify({ fallback: true })}\n\n`;
  return new Response(payload, {
    status: 200,
    headers: { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache" },
  });
}

export const config = { path: "/api/chat" };
