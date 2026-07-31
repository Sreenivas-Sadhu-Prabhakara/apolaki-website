// Cloudflare Pages middleware — staging only.
//
// This file exists ONLY on the Cloudflare Pages build. Netlify reads its
// functions from netlify/functions/ (see netlify.toml) and never sees this
// directory, so production is unaffected.
//
// Why it matters: staging serves a byte-identical copy of a live, indexed
// marketing site, including its canonical tags and sitemap. Left open, it
// would compete with apolaki.ai in search results for its own content. The
// header below is belt-and-braces alongside Cloudflare Access — Access keeps
// humans out, this keeps crawlers out even if Access is ever misconfigured.
//
// Rebuilding the Response rather than mutating res.headers is deliberate:
// a Response returned by next() has immutable headers, and passing res.body
// through keeps /api/chat's SSE stream streaming instead of buffering it.

// Cloudflare Pages serves every file in the deployed tree, exactly as Netlify
// does with publish = "." — so the same non-public paths must be blocked here.
// netlify.toml has the production equivalent; keep the two lists in step.
const BLOCKED = [/^\/netlify\//, /^\/functions\//, /^\/docs\//, /^\/tools\//, /^\/package(-lock)?\.json$/];

export const onRequest = async ({ request, next }) => {
  const { pathname } = new URL(request.url);
  if (BLOCKED.some((re) => re.test(pathname))) {
    return new Response("Not found", {
      status: 404,
      headers: { "Content-Type": "text/plain; charset=utf-8", "X-Robots-Tag": "noindex, nofollow" },
    });
  }

  const res = await next();
  const headers = new Headers(res.headers);
  headers.set("X-Robots-Tag", "noindex, nofollow, noarchive, nosnippet");
  return new Response(res.body, {
    status: res.status,
    statusText: res.statusText,
    headers,
  });
};
