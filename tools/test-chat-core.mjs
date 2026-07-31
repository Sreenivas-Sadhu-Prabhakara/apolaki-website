#!/usr/bin/env node
// Unit tests for the chat proxy core. Dependency-free; run with:
//   node tools/test-chat-core.mjs
//
// The widget's parser only understands SSE, and the assistant sits behind a
// Cloudflare Access policy. The dangerous case is therefore not "upstream is
// down" — that is handled — but "upstream returns 200 with something that is
// not the assistant", which is exactly what an Access login page looks like
// when the proxy's service-token env vars are missing. These tests pin that.

import { handleChat, handleHealth } from "../netlify/functions/_shared/chat-core.mjs";

let failed = 0;
const check = (name, cond) => {
  if (cond) console.log(`  ✓ ${name}`);
  else { failed++; console.error(`  ✗ ${name}`); }
};
const eq = (name, a, b) => check(`${name} (got ${JSON.stringify(a)})`, a === b);

const ENV = { SOLAR_ASSISTANT_URL: "https://assistant.example.test" };
const post = (body) =>
  new Request("https://apolaki.ai/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

/** Swap global fetch for one call, returning what the handler was given. */
let lastRequest = null;
function stubFetch(responder) {
  globalThis.fetch = async (url, init) => {
    lastRequest = { url: String(url), init };
    return responder(url, init);
  };
}
const sseResponse = (text) =>
  new Response(`data: ${JSON.stringify({ token: text })}\n\nevent: done\ndata: {}\n\n`, {
    status: 200,
    headers: { "Content-Type": "text/event-stream; charset=utf-8" },
  });
const htmlResponse = () =>
  new Response("<html><body>Sign in with Cloudflare Access</body></html>", {
    status: 200,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });

const isFallback = async (res) => {
  const t = await res.text();
  return t.includes('"fallback":true');
};

console.log("chat-core: request validation");
{
  const res = await handleChat(new Request("https://apolaki.ai/api/chat", { method: "OPTIONS" }), ENV);
  eq("OPTIONS returns 204", res.status, 204);
}
{
  const res = await handleChat(new Request("https://apolaki.ai/api/chat"), ENV);
  check("GET falls back", await isFallback(res));
}
{
  const res = await handleChat(post({ message: "   " }), ENV);
  check("empty message falls back", await isFallback(res));
}
{
  const res = await handleChat(post({ message: "hi" }), {});
  const body = await res.text();
  check("missing SOLAR_ASSISTANT_URL falls back", body.includes('"fallback":true'));
  check("unconfigured message mentions the assessment", body.includes("assessment"));
}

console.log("\nchat-core: upstream handling");
{
  stubFetch(() => sseResponse("Solar is worth it."));
  const res = await handleChat(post({ message: "worth it?" }), ENV);
  eq("SSE upstream is piped through", res.headers.get("content-type"), "text/event-stream; charset=utf-8");
  const body = await res.text();
  check("assistant reply reaches the widget", body.includes("Solar is worth it."));
  check("streaming response is not marked fallback", !body.includes('"fallback":true'));
}
{
  // The finding this test exists for: Access login page, status 200.
  stubFetch(() => htmlResponse());
  const res = await handleChat(post({ message: "hi" }), ENV);
  const body = await res.text();
  check("HTML 200 is NOT piped through as SSE", !body.includes("Cloudflare Access"));
  check("HTML 200 falls back instead", body.includes('"fallback":true'));
}
{
  stubFetch(() => new Response("nope", { status: 502, headers: { "Content-Type": "text/plain" } }));
  const res = await handleChat(post({ message: "hi" }), ENV);
  check("5xx upstream falls back", await isFallback(res));
}
{
  stubFetch(() => { throw new Error("ECONNREFUSED"); });
  const res = await handleChat(post({ message: "hi" }), ENV);
  const body = await res.text();
  check("unreachable upstream falls back", body.includes('"fallback":true'));
  check("offline message is user-friendly", body.includes("offline"));
}
{
  stubFetch(() => sseResponse("ok"));
  await handleChat(post({ message: "hi", mode: "installer" }), ENV);
  const sent = JSON.parse(lastRequest.init.body);
  eq("valid mode is forwarded", sent.mode, "installer");
  eq("upstream path is /assistant/chat", lastRequest.url, "https://assistant.example.test/assistant/chat");
}
{
  stubFetch(() => sseResponse("ok"));
  await handleChat(post({ message: "hi", mode: "hacker" }), ENV);
  eq("invalid mode falls back to customer", JSON.parse(lastRequest.init.body).mode, "customer");
}
{
  stubFetch(() => sseResponse("ok"));
  await handleChat(post({ message: "x".repeat(5000) }), ENV);
  eq("over-long message is truncated to 1200", JSON.parse(lastRequest.init.body).message.length, 1200);
}
{
  stubFetch(() => sseResponse("ok"));
  await handleChat(post({ message: "hi" }), { ...ENV, CF_ACCESS_CLIENT_ID: "id", CF_ACCESS_CLIENT_SECRET: "secret" });
  eq("Access client id forwarded", lastRequest.init.headers["CF-Access-Client-Id"], "id");
  eq("Access secret forwarded", lastRequest.init.headers["CF-Access-Client-Secret"], "secret");
}
{
  stubFetch(() => sseResponse("ok"));
  await handleChat(post({ message: "hi" }), ENV);
  check("no Access headers when unconfigured", !("CF-Access-Client-Id" in lastRequest.init.headers));
}
{
  // A trailing slash in the env var must not produce a double slash upstream.
  stubFetch(() => sseResponse("ok"));
  await handleChat(post({ message: "hi" }), { SOLAR_ASSISTANT_URL: "https://assistant.example.test///" });
  eq("trailing slashes stripped", lastRequest.url, "https://assistant.example.test/assistant/chat");
}

console.log("\nchat-core: health gate");
const healthReq = new Request("https://apolaki.ai/api/chat-health");
{
  const res = await handleHealth(healthReq, {});
  eq("unconfigured reports not-ok", (await res.json()).ok, false);
}
{
  stubFetch(() => new Response(JSON.stringify({ status: "ok" }), { status: 200, headers: { "Content-Type": "application/json" } }));
  const body = await (await handleHealth(healthReq, ENV)).json();
  eq("healthy assistant reports ok", body.ok, true);
}
{
  stubFetch(() => new Response(JSON.stringify({ status: "db_unreachable" }), { status: 503, headers: { "Content-Type": "application/json" } }));
  const body = await (await handleHealth(healthReq, ENV)).json();
  eq("503 reports not-ok", body.ok, false);
  eq("503 detail is unhealthy", body.detail, "unhealthy");
}
{
  // Access login page on the health endpoint must not turn the launcher on.
  stubFetch(() => htmlResponse());
  const body = await (await handleHealth(healthReq, ENV)).json();
  eq("HTML 200 health reports not-ok", body.ok, false);
  eq("HTML 200 health detail is not-json", body.detail, "not-json");
}
{
  stubFetch(() => new Response("{ broken", { status: 200, headers: { "Content-Type": "application/json" } }));
  const body = await (await handleHealth(healthReq, ENV)).json();
  eq("unparseable JSON reports not-ok", body.ok, false);
}
{
  stubFetch(() => { throw new Error("ECONNREFUSED"); });
  const res = await handleHealth(healthReq, ENV);
  const body = await res.json();
  eq("unreachable reports not-ok", body.ok, false);
  eq("health always answers 200 so the widget can read it", res.status, 200);
}

console.log(failed ? `\n${failed} test(s) failed.` : "\nAll tests passed.");
process.exit(failed ? 1 : 0);
