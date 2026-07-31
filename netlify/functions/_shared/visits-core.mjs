// Apolaki visitor counter — platform-agnostic core.
//
// Counts real visits and reports them with a fixed presentation offset added,
// so the site can show a headline "visitors" figure from day one.
//
// This file holds ALL the logic. The per-platform entry points supply a tiny
// storage adapter and are otherwise thin:
//   netlify/functions/visits.mjs → Netlify Blobs   (production)
//   functions/api/visits.js      → Workers KV      (Cloudflare Pages staging)
//
// Contract:
//   POST /api/visits → count this visit, return the new figure
//   GET  /api/visits → return the current figure without counting
// Both answer {"count": <number>}.

// Added to the real count before the number is returned. The browser never
// sees the raw figure. Overridable per environment so staging can be set to 0
// while testing that the counter itself moves.
const DEFAULT_OFFSET = 10000;

const STORE_KEY = "total";

// Conservative substring match against the User-Agent. The goal is to stop
// crawlers and uptime pingers inflating the count, not to defeat a determined
// script — a vanity counter does not warrant fingerprinting real visitors.
const BOT_RE =
  /bot|crawl|spider|slurp|bingpreview|facebookexternalhit|embedly|quora link preview|pinterest|vkshare|whatsapp|telegram|discord|slackbot|twitterbot|linkedinbot|applebot|petalbot|semrush|ahrefs|mj12|dotbot|headless|lighthouse|pagespeed|gtmetrix|uptime|pingdom|monitor|curl|wget|python-requests|axios|go-http-client|okhttp|java\/|libwww/i;

export function isBot(userAgent) {
  const ua = String(userAgent || "");
  // A missing User-Agent is nearly always automation, never a real browser.
  if (!ua.trim()) return true;
  return BOT_RE.test(ua);
}

function offsetFrom(env) {
  const raw = env && env.VISITOR_OFFSET;
  if (raw === undefined || raw === null || raw === "") return DEFAULT_OFFSET;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : DEFAULT_OFFSET;
}

function parseStored(value) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
}

/**
 * @param {Request} request
 * @param {{read: () => Promise<string|number|null>, write: (n: number) => Promise<void>}} store
 * @param {object} env
 */
export async function handleVisits(request, store, env) {
  // 204 is a null-body status: passing even "" to the Response constructor
  // throws a TypeError under undici/workerd rather than returning a response.
  if (request.method === "OPTIONS") return new Response(null, { status: 204 });

  const offset = offsetFrom(env);
  const counting = request.method === "POST";

  let stored = 0;
  try {
    stored = parseStored(await store.read());
  } catch {
    // Storage unavailable. Report the floor rather than a zero or an error —
    // the tile is decorative and must never become a visible failure.
    return json({ count: offset }, { degraded: true });
  }

  if (counting && !isBot(request.headers.get("user-agent"))) {
    stored += 1;
    try {
      await store.write(stored);
    } catch {
      // The increment is lost but the response is still correct-ish. Neither
      // Netlify Blobs nor Workers KV offers an atomic increment, so this
      // counter is already "very close" rather than exact; a failed write is
      // the same class of drift, and it only ever drifts down.
    }
  }

  return json({ count: stored + offset });
}

function json(body, extra) {
  return new Response(JSON.stringify(Object.assign({}, body, extra || {})), {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      // Never cache: a cached counter is a frozen counter, and the POST must
      // reach the origin to register the visit at all.
      "Cache-Control": "no-store",
    },
  });
}
