#!/usr/bin/env node
// Regenerate the FAQPage JSON-LD in faqs.html from the accordions themselves.
//
//   node tools/gen-faq-schema.mjs           # rewrite faqs.html in place
//   node tools/gen-faq-schema.mjs --dry     # print what would change
//
// Why this exists: the schema block was maintained by hand and drifted badly —
// 23 questions on the page, 8 declared, and 6 of those 8 reworded so they no
// longer matched any visible question. Google requires the structured data to
// match the visible content, and answer engines read the JSON-LD rather than
// the accordions. Generating it from the markup makes drift impossible.
//
// Bilingual answers live inside one <details> with [data-lang] spans. Only the
// English text is emitted: schema.org expects one Question entry per question,
// not one per translation.

import { readFile, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const FILE = join(ROOT, "faqs.html");
const DRY = process.argv.includes("--dry");

const html = await readFile(FILE, "utf8");

/** Collapse markup to readable plain text. */
function text(fragment) {
  return fragment
    .replace(/<svg[\s\S]*?<\/svg>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Prefer the English span when a fragment is bilingual, so Tagalog never
 * leaks into the schema.
 */
function englishOnly(fragment) {
  const en = [...fragment.matchAll(/<(\w+)[^>]*\bdata-lang=["']en["'][^>]*>([\s\S]*?)<\/\1>/gi)];
  if (en.length) return en.map((m) => m[2]).join(" ");
  // No bilingual wrapper: strip any Tagalog block that may exist alone.
  return fragment.replace(/<(\w+)[^>]*\bdata-lang=["']tl["'][^>]*>[\s\S]*?<\/\1>/gi, " ");
}

const items = [];
const detailsRe = /<details[^>]*class=["'][^"']*faq-item[^"']*["'][^>]*>([\s\S]*?)<\/details>/gi;
let m;
while ((m = detailsRe.exec(html)) !== null) {
  const block = m[1];

  const sum = block.match(/<summary[^>]*>([\s\S]*?)<\/summary>/i);
  if (!sum) continue;
  // Drop the +/- glyph span before extracting the question text.
  const question = text(englishOnly(sum[1].replace(/<span class=["']pm["'][\s\S]*?<\/span>/i, " ")));

  const ans = block.match(/<div[^>]*class=["'][^"']*faq-answer[^"']*["'][^>]*>([\s\S]*?)<\/div>\s*$/i)
    || block.match(/<div[^>]*class=["'][^"']*faq-answer[^"']*["'][^>]*>([\s\S]*)/i);
  if (!ans) continue;
  // The citation line is presentation, not the answer.
  const answerHtml = englishOnly(ans[1]).replace(/<p[^>]*class=["'][^"']*faq-src[^"']*["'][^>]*>[\s\S]*?<\/p>/gi, " ");
  const answer = text(answerHtml);

  if (question && answer) items.push({ question, answer });
}

if (!items.length) {
  console.error("No FAQ accordions found — refusing to write an empty schema.");
  process.exit(1);
}

const schema = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: items.map((it) => ({
    "@type": "Question",
    name: it.question,
    acceptedAnswer: { "@type": "Answer", text: it.answer },
  })),
};

// Replace only the FAQPage block; faqs.html also carries a BreadcrumbList.
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
  return open + "\n" + JSON.stringify(schema, null, 2) + "\n" + close;
});

if (replaced !== 1) {
  console.error(`Expected exactly 1 FAQPage JSON-LD block, replaced ${replaced}. Aborting.`);
  process.exit(1);
}

console.log(`FAQPage schema: ${items.length} questions`);
items.forEach((it, i) => console.log(`  ${String(i + 1).padStart(2)}. ${it.question}`));

if (DRY) {
  console.log("\n--dry: faqs.html not written.");
} else {
  await writeFile(FILE, updated, "utf8");
  console.log("\nfaqs.html updated.");
}
