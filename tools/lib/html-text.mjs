// Shared HTML helpers for the FAQ tooling.
//
// gen-faq-schema.mjs writes the FAQPage JSON-LD; check-site.mjs verifies it.
// They previously each had their own normalizer, which meant a question
// containing "&amp;" was decoded by one and not the other — a correctly
// generated schema then failed its own check. One implementation, used by
// both, removes that class of disagreement entirely.
//
// The element slicing here is depth-aware. Regex with a lazy close tag stops
// at the FIRST matching close, so a nested <div> inside an answer silently
// truncates it — or, with an end-anchor, silently over-captures the sibling
// after it. Both were real defects found in review; neither threw, and both
// produced plausible-looking wrong output.

const NAMED = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
  mdash: "—", ndash: "–", hellip: "…", middot: "·",
  lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”",
  times: "×", deg: "°", eacute: "é", ntilde: "ñ",
  peso: "₱", laquo: "«", raquo: "»", trade: "™",
  copy: "©", reg: "®", euro: "€", pound: "£",
};

/** Decode the character references that actually appear in this site's copy. */
export function decodeEntities(s) {
  return String(s).replace(/&(#x?[0-9a-f]+|[a-z][a-z0-9]*);/gi, (whole, body) => {
    if (body[0] === "#") {
      const code = body[1] === "x" || body[1] === "X"
        ? parseInt(body.slice(2), 16)
        : parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    }
    const hit = NAMED[body.toLowerCase()];
    return hit === undefined ? whole : hit;
  });
}

/** Collapse a markup fragment to readable plain text. */
export function text(fragment) {
  return decodeEntities(
    String(fragment)
      .replace(/<svg[\s\S]*?<\/svg>/gi, " ")
      .replace(/<[^>]+>/g, " ")
  )
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Inner HTML of the element whose opening tag ends at `openTagEnd`, counting
 * nested tags of the same name. Returns null if the element is unbalanced,
 * which callers must treat as an error rather than guessing.
 */
export function innerFrom(html, tagName, openTagEnd) {
  const re = new RegExp(`<(/?)${tagName}\\b[^>]*?(/?)>`, "gi");
  re.lastIndex = openTagEnd;
  let depth = 1;
  let m;
  while ((m = re.exec(html)) !== null) {
    if (m[1] === "/") {
      depth -= 1;
      if (depth === 0) return html.slice(openTagEnd, m.index);
    } else if (m[2] !== "/") {
      depth += 1;
    }
  }
  return null;
}

/**
 * Find the first element matching `openPattern` and return its inner HTML,
 * depth-aware. `openPattern` must be a global-flagged regex matching the
 * opening tag.
 */
export function firstElement(html, tagName, openPattern) {
  openPattern.lastIndex = 0;
  const m = openPattern.exec(html);
  if (!m) return null;
  return innerFrom(html, tagName, m.index + m[0].length);
}

/** Every element in `html` carrying data-lang="<lang>", as inner-HTML strings. */
export function langBlocks(html, lang) {
  const re = new RegExp(`<(\\w+)[^>]*\\bdata-lang=["']${lang}["'][^>]*>`, "gi");
  const out = [];
  let m;
  while ((m = re.exec(html)) !== null) {
    const inner = innerFrom(html, m[1], m.index + m[0].length);
    if (inner === null) return null; // unbalanced — caller must fail loudly
    out.push(inner);
  }
  return out;
}

/**
 * The English half of a possibly-bilingual fragment.
 *
 * Returns { html, ok }. ok=false means the fragment could not be resolved
 * unambiguously — for example a Tagalog block with no English counterpart,
 * which is an authoring bug. Callers must abort rather than emit a guess:
 * silently shipping half-Tagalog structured data is worse than a failed build.
 */
export function englishOnly(fragment) {
  const en = langBlocks(fragment, "en");
  if (en === null) return { html: "", ok: false };
  if (en.length) return { html: en.join(" "), ok: true };

  const tl = langBlocks(fragment, "tl");
  if (tl === null) return { html: "", ok: false };
  // Tagalog present but no English wrapper: ambiguous. Refuse to guess.
  if (tl.length) return { html: "", ok: false };
  return { html: fragment, ok: true };
}
