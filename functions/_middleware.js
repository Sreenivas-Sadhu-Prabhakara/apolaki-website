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

export const onRequest = async ({ next }) => {
  const res = await next();
  const headers = new Headers(res.headers);
  headers.set("X-Robots-Tag", "noindex, nofollow, noarchive, nosnippet");
  return new Response(res.body, {
    status: res.status,
    statusText: res.statusText,
    headers,
  });
};
