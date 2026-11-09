#!/usr/bin/env node
// Apolaki site checks. Dependency-free; Node 20+ (uses global fetch).
//
//   npm run check              all checks
//   npm run check -- --no-net  skip the outbound link check (offline / CI-lite)
//
// Two things are worth automating on this site:
//
// 1. FAQ schema coverage. faqs.html renders its questions as <details>
//    accordions and separately declares them in FAQPage JSON-LD. Search
//    engines and answer engines read the JSON-LD, not the accordions, so the
//    two drifting apart silently hides questions. Before this check existed
//    the page showed 23 questions and declared 8.
//
// 2. Citation rot. The solar-basics answers cite Philippine government
//    documents. A dead citation on a public site is worse than no citation,
//    and .gov.ph hosts move things without notice.

import { readFile, readdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
// Same normalizer the generator uses. Two implementations meant an "&amp;" in
// a question was decoded by one and not the other, so a correctly generated
// schema failed its own check.
import { text as plain } from "./lib/html-text.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const NO_NET = process.argv.includes("--no-net");

let failures = 0;
let warnings = 0;
const fail = (msg) => { failures++; console.error(`  ✗ ${msg}`); };
const warn = (msg) => { warnings++; console.log(`  ! ${msg}`); };
const pass = (msg) => console.log(`  ✓ ${msg}`);

// Hosts that refuse automated fetchers but serve humans perfectly well. A 403
// or 400 from these is a bot policy, not a dead link, so they are reported as
// warnings rather than failures.
//
// Keep this list SHORT and justified. It is the one mechanism in this file
// capable of hiding a genuinely broken citation, so every entry must have been
// opened in a real browser first.
//
// Only the status codes below are ever downgraded. An earlier version excused
// every outcome except 404, which meant a listed host could 500, time out, or
// fail DNS and still report "all checks passed" — the allowlist would have
// hidden exactly the outage it was never meant to cover.
const DOWNGRADABLE = new Set([400, 401, 403, 429]);
const BOT_BLOCKED = new Map([
  ["privacy.gov.ph", "National Privacy Commission — 403s non-browser user agents"],
  ["www.erc.gov.ph", "Energy Regulatory Commission — 403s non-browser user agents"],
  ["www.facebook.com", "Facebook returns 400 to unauthenticated fetches"],
]);

/* ---------------------------------------------------------------- helpers */

async function htmlFiles() {
  const out = [];
  async function walk(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (entry.name.endsWith(".html")) out.push(full);
    }
  }
  await walk(ROOT);
  return out;
}

/** Every JSON-LD block in a document, parsed. Unparseable blocks are a failure. */
function jsonLdBlocks(html, label) {
  const blocks = [];
  const re = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    try {
      blocks.push(JSON.parse(m[1]));
    } catch (e) {
      fail(`${label}: JSON-LD block does not parse — ${e.message}`);
    }
  }
  return blocks;
}

/* -------------------------------------------------- 1. FAQ schema coverage */

async function checkFaqSchema() {
  console.log("\nFAQ schema coverage");
  const path = join(ROOT, "faqs.html");
  const html = await readFile(path, "utf8");

  // One <details class="faq-item"> per question. Bilingual answers live inside
  // a single <details> (spans toggled by data-lang), so this stays 1:1 with
  // the questions a reader sees regardless of the selected language.
  const accordions = (html.match(/<details[^>]*class=["'][^"']*faq-item/gi) || []).length;

  const faqPages = jsonLdBlocks(html, "faqs.html").filter((b) => b && b["@type"] === "FAQPage");
  if (faqPages.length !== 1) {
    fail(`faqs.html: expected exactly 1 FAQPage JSON-LD block, found ${faqPages.length}`);
    return;
  }
  const entities = faqPages[0].mainEntity;
  if (!Array.isArray(entities)) {
    fail("faqs.html: FAQPage.mainEntity is not an array");
    return;
  }

  const questions = entities.filter((q) => q && q["@type"] === "Question").length;
  if (questions !== accordions) {
    fail(`faqs.html: ${accordions} accordions but ${questions} JSON-LD questions — they must match`);
  } else {
    pass(`faqs.html: ${accordions} accordions, ${questions} JSON-LD questions`);
  }

  // Every declared question needs a non-empty answer body.
  const empty = entities.filter((q) => {
    const t = q && q.acceptedAnswer && q.acceptedAnswer.text;
    return !t || !String(t).trim();
  }).length;
  if (empty) fail(`faqs.html: ${empty} JSON-LD question(s) have an empty acceptedAnswer`);
  else pass("faqs.html: every JSON-LD question has an answer");

  // The schema text should be the English question, matching a real summary.
  const summaries = new Set(
    (html.match(/<summary[^>]*>([\s\S]*?)<\/summary>/gi) || []).map((s) => plain(s).toLowerCase())
  );
  const orphans = entities
    .map((q) => (q && q.name ? String(q.name).replace(/\s+/g, " ").trim() : ""))
    .filter((name) => name && ![...summaries].some((s) => s.includes(name.toLowerCase())));
  if (orphans.length) {
    fail(`faqs.html: ${orphans.length} JSON-LD question(s) do not appear on the page: ${orphans.slice(0, 3).join(" | ")}`);
  } else {
    pass("faqs.html: every JSON-LD question appears on the page");
  }
}

/* ---------------------------------------------------- 2. outbound citations */

function externalLinks(html) {
  const urls = new Set();
  const re = /href=["'](https?:\/\/[^"'#\s]+)["']/gi;
  let m;
  while ((m = re.exec(html)) !== null) urls.add(m[1]);
  return urls;
}

async function checkLinks() {
  console.log("\nOutbound links");
  if (NO_NET) {
    console.log("  – skipped (--no-net)");
    return;
  }

  const all = new Map(); // url -> Set(file)
  for (const file of await htmlFiles()) {
    const html = await readFile(file, "utf8");
    for (const url of externalLinks(html)) {
      // Font/schema infrastructure, not citations.
      if (/(^https?:\/\/)(fonts\.(googleapis|gstatic)\.com|schema\.org)/.test(url)) continue;
      if (!all.has(url)) all.set(url, new Set());
      all.get(url).add(file.replace(ROOT + "/", ""));
    }
  }

  const urls = [...all.keys()].sort();
  console.log(`  checking ${urls.length} distinct URLs…`);

  const results = await Promise.all(urls.map((url) => probe(url)));
  let blocked = 0;
  for (const r of results) {
    if (r.ok) continue;
    const where = [...all.get(r.url)];
    const inFiles = where.length > 3 ? `${where.slice(0, 3).join(", ")} +${where.length - 3} more` : where.join(", ");
    let host = "";
    try { host = new URL(r.url).host; } catch { /* unparseable URL is a real failure */ }
    const note = BOT_BLOCKED.get(host);
    // Only a deliberate refusal is a bot policy. Anything else — 404, 5xx,
    // timeout, DNS failure — is the link being broken, allowlist or not.
    if (note && DOWNGRADABLE.has(r.status)) {
      blocked++;
      warn(`${r.url} → ${r.status} — ${note} (in ${inFiles})`);
    } else {
      fail(`${r.url} → ${r.status} (in ${inFiles})`);
    }
  }
  const okCount = results.filter((r) => r.ok).length;
  if (okCount + blocked === results.length) {
    pass(`all ${results.length} URLs reachable${blocked ? ` (${blocked} bot-blocked but live)` : ""}`);
  } else {
    console.log(`  ${okCount}/${results.length} reachable, ${blocked} bot-blocked`);
  }
}

const TIMEOUT_MS = 20000;

async function probe(url) {
  // Some government hosts reject HEAD, and several reject unknown agents, so
  // fall back to a ranged GET with a browser-ish UA before calling it dead.
  const ua =
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125 Safari/537.36";
  for (const init of [
    { method: "HEAD", redirect: "follow" },
    { method: "GET", redirect: "follow", headers: { Range: "bytes=0-2048" } },
  ]) {
    const last = init.method === "GET";
    // The controller must reach fetch(), or the timeout rejects this function
    // while the request keeps running — which held the process open past the
    // deadline and never actually cancelled anything.
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        ...init,
        signal: ctl.signal,
        headers: { "User-Agent": ua, ...(init.headers || {}) },
      });
      if (res.body) await res.body.cancel().catch(() => {});
      if (res.status < 400) return { url, ok: true, status: res.status };
      if (last) return { url, ok: false, status: res.status };
    } catch (e) {
      if (last) return { url, ok: false, status: e.name === "AbortError" ? "timeout" : e.message };
    } finally {
      clearTimeout(timer);
    }
  }
  return { url, ok: false, status: "unknown" };
}

/* --------------------------------------------------------- 3. sanity checks */

async function checkMisc() {
  console.log("\nGeneral");

  // The chat widget and the proxy must agree on the endpoint paths.
  const chat = await readFile(join(ROOT, "js/chat.js"), "utf8");
  if (!chat.includes("/api/chat-health")) fail("js/chat.js: health gate endpoint missing");
  else pass("js/chat.js: health gate present");

  // A stray debugging aid on a production marketing site.
  for (const file of ["js/main.js", "js/chat.js"]) {
    const src = await readFile(join(ROOT, file), "utf8");
    const hits = (src.match(/console\.(log|debug)\s*\(/g) || []).length;
    if (hits) fail(`${file}: ${hits} console.log/debug call(s)`);
    else pass(`${file}: no console.log`);
  }
}

/* ----------------------------------------------------------------- runner */

console.log("Apolaki site checks");
await checkFaqSchema();
await checkMisc();
await checkLinks();

const suffix = warnings ? ` (${warnings} warning${warnings > 1 ? "s" : ""})` : "";
console.log(failures ? `\n${failures} check(s) failed${suffix}.` : `\nAll checks passed${suffix}.`);
process.exit(failures ? 1 : 0);
