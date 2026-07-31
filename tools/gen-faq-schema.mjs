#!/usr/bin/env node
// Regenerate the FAQPage JSON-LD in faqs.html from the accordions themselves.
//
//   node tools/gen-faq-schema.mjs           # rewrite faqs.html in place
//   node tools/gen-faq-schema.mjs --dry     # print what would change
//
// Why this exists: the schema block was maintained by hand and drifted badly —
// 23 questions on the page, 8 declared, and 6 of those 8 reworded so they no
// longer matched any visible question. Google requires structured data to match
// the visible content, and answer engines read the JSON-LD rather than the
// accordions. Generating it from the markup makes drift impossible.
//
// Bilingual answers live inside one <details> with [data-lang] blocks. Only the
// English text is emitted: schema.org expects one Question per question, not
// one per translation.
//
// Design rule for this file: ABORT rather than guess. Every ambiguity below
// used to be a silent fallback, and each one produced plausible-looking but
// wrong structured data that no check caught. A failed build is cheap; a page
// shipping half-Tagalog or promo-contaminated schema is not.

import { readFile, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { text, innerFrom, firstElement, englishOnly } from "./lib/html-text.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const FILE = join(ROOT, "faqs.html");
const DRY = process.argv.includes("--dry");

const die = (msg) => { console.error(`gen-faq-schema: ${msg}`); process.exit(1); };

const html = await readFile(FILE, "utf8");

/* ------------------------------------------------- collect the accordions */

const items = [];
const openDetails = /<details\b[^>]*class=["'][^"']*faq-item[^"']*["'][^>]*>/gi;
let d;
while ((d = openDetails.exec(html)) !== null) {
  const at = `offset ${d.index}`;
  const block = innerFrom(html, "details", d.index + d[0].length);
  if (block === null) die(`unbalanced <details> at ${at}`);

  const summary = firstElement(block, "summary", /<summary\b[^>]*>/gi);
  if (summary === null) die(`<details> at ${at} has no usable <summary>`);

  const answer = firstElement(block, "div", /<div\b[^>]*class=["'][^"']*faq-answer[^"']*["'][^>]*>/gi);
  if (answer === null) die(`<details> at ${at} has no usable .faq-answer`);

  const q = englishOnly(summary);
  if (!q.ok) die(`<details> at ${at}: cannot resolve the English question — is the data-lang="en" wrapper missing?`);
  const a = englishOnly(answer);
  if (!a.ok) die(`<details> at ${at}: cannot resolve the English answer — is the data-lang="en" wrapper missing?`);

  // The citation line is presentation, not part of the answer.
  const answerHtml = a.html.replace(/<p\b[^>]*class=["'][^"']*faq-src[^"']*["'][^>]*>[\s\S]*?<\/p>/gi, " ");

  const question = text(q.html);
  const answerText = text(answerHtml);
  if (!question) die(`<details> at ${at}: empty question text`);
  if (!answerText) die(`<details> at ${at}: empty answer text`);

  // Post-condition: no translation markup may survive into the schema.
  for (const [label, value] of [["question", q.html], ["answer", answerHtml]]) {
    if (/\bdata-lang\s*=/i.test(value)) die(`<details> at ${at}: ${label} still contains data-lang markup after extraction`);
  }

  items.push({ question, answer: answerText });
}

if (!items.length) die("no FAQ accordions found — refusing to write an empty schema");

/* ------------------------------------------------------- build and splice */

const schema = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: items.map((it) => ({
    "@type": "Question",
    name: it.question,
    acceptedAnswer: { "@type": "Answer", text: it.answer },
  })),
};

// Escaping "<" keeps the JSON valid while making a literal </script> in any
// answer inert — otherwise a single quoted tag in FAQ copy would terminate the
// <script> element early and corrupt the page on disk.
const serialized = JSON.stringify(schema, null, 2).replace(/</g, "\\u003c");

const blockRe = /(<script[^>]*type=["']application\/ld\+json["'][^>]*>)([\s\S]*?)(<\/script>)/gi;
let replaced = 0;
const updated = html.replace(blockRe, (full, open, body, close) => {
  try {
    const parsed = JSON.parse(body);
    if (!parsed || parsed["@type"] !== "FAQPage") return full;
  } catch {
    return full;
  }
  replaced++;
  return open + "\n" + serialized + "\n" + close;
});

if (replaced !== 1) die(`expected exactly 1 FAQPage JSON-LD block, replaced ${replaced}`);

// Re-parse what we are about to write, so a malformed document never lands.
const verify = [...updated.matchAll(blockRe)]
  .map((m) => { try { return JSON.parse(m[2]); } catch { return null; } })
  .filter((x) => x && x["@type"] === "FAQPage");
if (verify.length !== 1) die("post-write verification failed: the emitted FAQPage block does not parse");
if (verify[0].mainEntity.length !== items.length) die("post-write verification failed: question count mismatch");

console.log(`FAQPage schema: ${items.length} questions`);
items.forEach((it, i) => console.log(`  ${String(i + 1).padStart(2)}. ${it.question}`));

if (DRY) {
  console.log("\n--dry: faqs.html not written.");
} else {
  await writeFile(FILE, updated, "utf8");
  console.log("\nfaqs.html updated.");
}
