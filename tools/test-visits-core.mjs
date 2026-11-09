#!/usr/bin/env node
// Unit tests for the visitor-counter core. Dependency-free; run with:
//   node tools/test-visits-core.mjs
//
// The bot filter is the risky part. A false positive here does not throw or
// log — it silently stops counting a whole class of real visitors, and the
// only symptom is a number that grows more slowly than it should. So the
// mainstream browser User-Agents are asserted explicitly.

import { handleVisits, isBot } from "../netlify/functions/_shared/visits-core.mjs";

let failed = 0;
function check(name, cond) {
  if (cond) console.log(`  ✓ ${name}`);
  else { failed++; console.error(`  ✗ ${name}`); }
}
async function eq(name, actual, expected) {
  check(`${name} (got ${JSON.stringify(actual)})`, actual === expected);
}

function memStore(initial) {
  let v = initial;
  return {
    value: () => v,
    read: async () => v,
    write: async (n) => { v = n; },
  };
}
const req = (method, ua) =>
  new Request("https://apolaki.ai/api/visits", {
    method,
    headers: ua === null ? {} : { "user-agent": ua },
  });

const CHROME_MAC =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";
const SAFARI_IOS =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
const FIREFOX =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:127.0) Gecko/20100101 Firefox/127.0";
const CHROME_ANDROID =
  "Mozilla/5.0 (Linux; Android 13; SM-S901B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Mobile Safari/537.36";
const EDGE =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36 Edg/125.0.0.0";
const SAMSUNG =
  "Mozilla/5.0 (Linux; Android 13; SAMSUNG SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/23.0 Chrome/115.0.0.0 Mobile Safari/537.36";
const OPERA_MINI =
  "Opera/9.80 (Android; Opera Mini/78.0.2254/191.303; U; en) Presto/2.12.423 Version/12.16";

console.log("visits-core: real browsers must NOT be filtered");
for (const [name, ua] of Object.entries({
  "Chrome (macOS)": CHROME_MAC,
  "Safari (iOS)": SAFARI_IOS,
  Firefox: FIREFOX,
  "Chrome (Android)": CHROME_ANDROID,
  Edge: EDGE,
  "Samsung Internet": SAMSUNG,
  "Opera Mini": OPERA_MINI,
})) {
  check(`${name} counts`, isBot(ua) === false);
}

console.log("\nvisits-core: automation MUST be filtered");
for (const [name, ua] of Object.entries({
  Googlebot: "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
  Bingbot: "Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)",
  "curl": "curl/8.4.0",
  "HeadlessChrome": "Mozilla/5.0 (X11; Linux x86_64) HeadlessChrome/125.0.0.0",
  "Lighthouse": "Mozilla/5.0 Chrome-Lighthouse",
  "facebook preview": "facebookexternalhit/1.1",
  "python-requests": "python-requests/2.31.0",
  "empty UA": "",
})) {
  check(`${name} filtered`, isBot(ua) === true);
}
check("missing UA header filtered", isBot(null) === true);
check("whitespace-only UA filtered", isBot("   ") === true);

console.log("\nvisits-core: counting behaviour");
{
  const s = memStore(null); // first-ever visit: store is empty
  const res = await handleVisits(req("POST", CHROME_MAC), s, {});
  const body = await res.json();
  await eq("empty store + first POST returns offset+1", body.count, 10001);
  await eq("store now holds 1", s.value(), 1);
}
{
  const s = memStore("41");
  const res = await handleVisits(req("POST", CHROME_MAC), s, {});
  await eq("POST increments", (await res.json()).count, 10042);
}
{
  const s = memStore("41");
  const res = await handleVisits(req("GET", CHROME_MAC), s, {});
  await eq("GET does not increment", (await res.json()).count, 10041);
  await eq("store untouched by GET", s.value(), "41");
}
{
  const s = memStore("41");
  await handleVisits(req("POST", "curl/8.4.0"), s, {});
  await eq("bot POST does not increment", s.value(), "41");
}
{
  const s = memStore("41");
  const res = await handleVisits(req("POST", CHROME_MAC), s, { VISITOR_OFFSET: "0" });
  await eq("VISITOR_OFFSET honoured", (await res.json()).count, 42);
}
{
  const s = memStore("41");
  const res = await handleVisits(req("POST", CHROME_MAC), s, { VISITOR_OFFSET: "not-a-number" });
  await eq("garbage offset falls back to default", (await res.json()).count, 10042);
}
{
  // Corrupt stored value must not produce NaN on a public page.
  const s = memStore("banana");
  const res = await handleVisits(req("GET", CHROME_MAC), s, {});
  await eq("corrupt stored value reads as 0", (await res.json()).count, 10000);
}
{
  // Storage outage must degrade to the floor, never to an error or a zero.
  const broken = {
    read: async () => { throw new Error("blobs down"); },
    write: async () => {},
  };
  const res = await handleVisits(req("GET", CHROME_MAC), broken, {});
  const body = await res.json();
  await eq("store read failure returns floor", body.count, 10000);
  check("store read failure flagged degraded", body.degraded === true);
  await eq("store read failure still HTTP 200", res.status, 200);
}
{
  // A failed write must not fail the response.
  const halfBroken = {
    read: async () => "7",
    write: async () => { throw new Error("write rejected"); },
  };
  const res = await handleVisits(req("POST", CHROME_MAC), halfBroken, {});
  await eq("write failure still returns a count", (await res.json()).count, 10008);
}
{
  const res = await handleVisits(req("OPTIONS", CHROME_MAC), memStore("1"), {});
  await eq("OPTIONS returns 204", res.status, 204);
}
{
  const res = await handleVisits(req("GET", CHROME_MAC), memStore("1"), {});
  await eq("response is uncacheable", res.headers.get("cache-control"), "no-store");
}

console.log(failed ? `\n${failed} test(s) failed.` : "\nAll tests passed.");
process.exit(failed ? 1 : 0);
