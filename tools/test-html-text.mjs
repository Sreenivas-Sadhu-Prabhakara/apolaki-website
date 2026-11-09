#!/usr/bin/env node
// Unit tests for the shared FAQ HTML helpers.
//
// Every fixture below is a case that the previous regex-based implementation
// got WRONG WITHOUT ERRORING — it produced plausible output that `npm run
// check` then passed. That is the failure mode worth pinning: silent wrongness,
// not crashes.

import { text, decodeEntities, innerFrom, firstElement, englishOnly } from "./lib/html-text.mjs";

let failed = 0;
const check = (name, cond) => {
  if (cond) console.log(`  ✓ ${name}`);
  else { failed++; console.error(`  ✗ ${name}`); }
};
const eq = (name, a, b) => check(`${name}${a === b ? "" : ` — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`}`, a === b);

console.log("entities");
eq("named", decodeEntities("Meralco &amp; ERC"), "Meralco & ERC");
eq("numeric decimal", decodeEntities("&#8212;"), "—");
eq("numeric hex", decodeEntities("&#x20B1;"), "₱");
eq("peso named", decodeEntities("&peso;5,000"), "₱5,000");
eq("unknown entity left alone", decodeEntities("&notreal;"), "&notreal;");
eq("nbsp becomes a space", text("Metro&nbsp;Manila"), "Metro Manila");

console.log("\ndepth-aware slicing");
{
  // Regression: a sibling element AFTER .faq-answer used to be swallowed into
  // the answer, which would have put promotional copy into FAQPage schema.
  const block =
    '<div class="faq-answer"><p>Only with a battery.</p></div>' +
    '<div class="faq-cta"><p>Book an installer now and lock in this promo price.</p></div>';
  const inner = firstElement(block, "div", /<div\b[^>]*class=["'][^"']*faq-answer[^"']*["'][^>]*>/gi);
  eq("stops at its own close tag", text(inner), "Only with a battery.");
  check("does not swallow the sibling", !/promo price/i.test(text(inner)));
}
{
  // Regression: a NESTED div used to truncate the answer at the first </div>.
  const block =
    '<div class="faq-answer"><p>First.</p><div class="callout"><p>Note.</p></div><p>Last.</p></div>';
  const inner = firstElement(block, "div", /<div\b[^>]*class=["'][^"']*faq-answer[^"']*["'][^>]*>/gi);
  eq("captures past a nested element", text(inner), "First. Note. Last.");
}
{
  const unbalanced = '<div class="faq-answer"><p>Oops.';
  const inner = firstElement(unbalanced, "div", /<div\b[^>]*class=["'][^"']*faq-answer[^"']*["'][^>]*>/gi);
  check("unbalanced markup returns null rather than guessing", inner === null);
}
{
  eq("self-closing tags do not affect depth", innerFrom('<div>a<br/>b</div>', "div", 5), "a<br/>b");
}

console.log("\nEnglish extraction");
{
  const frag =
    '<div data-lang="en"><p>No, not for savings.</p></div>' +
    '<div data-lang="tl" hidden><p>Hindi para sa ipon.</p></div>';
  const r = englishOnly(frag);
  check("resolves", r.ok);
  eq("English only", text(r.html), "No, not for savings.");
  check("no Tagalog leaks", !/Hindi/.test(r.html));
}
{
  // The exact fixture from review: bare <p> English, nested element inside the
  // Tagalog block. The old code emitted a half-Tagalog answer and passed checks.
  const frag =
    '<p>No, not for savings. Batteries are a backup decision.</p>' +
    '<div data-lang="tl" hidden><p>Hindi para sa ipon.</p><div class="callout"><p>Paalala.</p></div>' +
    '<p>Desisyon sa backup ang baterya.</p></div>';
  const r = englishOnly(frag);
  check("ambiguous bilingual fragment is REFUSED, not guessed", r.ok === false);
}
{
  const frag = "<p>Plain English answer, no translation.</p>";
  const r = englishOnly(frag);
  check("monolingual fragment resolves", r.ok);
  eq("monolingual passes through", text(r.html), "Plain English answer, no translation.");
}
{
  const frag =
    '<span data-lang="en">How much sun?</span><span data-lang="tl" hidden>Gaano karaming araw?</span>' +
    '<span class="pm"><svg viewBox="0 0 24 24"><path d="M12 5v14"/></svg></span>';
  const r = englishOnly(frag);
  eq("summary strips the +/- glyph and Tagalog", text(r.html), "How much sun?");
}
{
  const frag =
    '<div data-lang="en"><p>A.</p><div class="note"><p>B.</p></div><p>C.</p></div>' +
    '<div data-lang="tl" hidden><p>Tagalog.</p></div>';
  const r = englishOnly(frag);
  eq("English block with nesting is captured whole", text(r.html), "A. B. C.");
  check("still no Tagalog", !/Tagalog/.test(r.html));
}

console.log(failed ? `\n${failed} test(s) failed.` : "\nAll tests passed.");
process.exit(failed ? 1 : 0);
