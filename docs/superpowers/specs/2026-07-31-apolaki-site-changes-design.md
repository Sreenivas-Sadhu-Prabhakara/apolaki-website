# apolaki.ai — visitor counter, assistant reconnect, expanded solar FAQ

**Date:** 2026-07-31
**Repo:** `apolaki-website` (branch `feature/site-updates-2026-07`)
**Status:** design approved; implementation in progress

---

## Goal

Three changes to the public marketing site, staged on Cloudflare Pages for
approval before any of it reaches apolaki.ai:

1. A visitor counter on the landing page.
2. A working "ask a question" assistant in the bottom-right corner.
3. A substantially expanded solar-energy FAQ with Philippine references.

## What was already there

Exploration changed the shape of two of the three items, so it is recorded here:

- **The chat widget already exists.** `js/chat.js` is a complete, bilingual,
  SSE-streaming widget with a bottom-right launcher, and
  `netlify/functions/chat.mjs` already proxies to the `llm-slm` solar assistant.
  The live endpoint returns `{"fallback":true}` because `SOLAR_ASSISTANT_URL`
  points nowhere and the assistant is not running. **This item is ops, not a
  new feature.**
- **The count-up animation already exists.** `js/main.js` animates any
  `[data-count]` element on scroll, honouring `prefers-reduced-motion`.
- **`faqs.html` already exists** with 23 questions in three tab groups, and
  `main.js` already switches `.faq-tab` / `.faq-group`.
- **The FAQ schema is incomplete**: 23 questions on the page, 8 in the
  `FAQPage` JSON-LD.
- **The site cites almost nothing external** — one link to `privacy.gov.ph`.

## Decisions

| Question | Decision |
|---|---|
| Cloudflare Pages role | **Staging only.** Production stays on Netlify. |
| Counter value | Real visits **+ 10,000**, labelled "visitors". |
| Assistant exposure | Named **Cloudflare Tunnel** at `assistant.apolaki.ai`. |
| Assistant offline | **Hide the launcher** — fail closed. |
| FAQ shape | New **"Solar basics"** tab group inside `faqs.html`. |
| FAQ language | **English + Tagalog toggle** on the new answers. |
| Netfirms | Not happening. `deploy-netfirms.yml` deleted. |
| Tunnel DNS | Delegate **`assistant.apolaki.ai` only** to Cloudflare. |

The counter's label was raised as a concern — a figure presented as "visitors"
that is 10,000 higher than the real one is a checkable claim — and the decision
to proceed as specified was reaffirmed. Recorded here so the choice is
deliberate and visible rather than buried.

## Architecture

### Environments

| | Host | URL | Source |
|---|---|---|---|
| Production | Netlify | apolaki.ai | `main` via GitHub Actions |
| Staging | Cloudflare Pages | private preview | feature branch |
| Assistant | Mac Studio | `assistant.apolaki.ai` | named CF Tunnel |

### One core, two adapters

Both hosts implement the Web `Request`/`Response` API, so logic lives once:

```
netlify/functions/_shared/chat-core.mjs      handleChat, handleHealth
netlify/functions/_shared/visits-core.mjs    handleVisits, isBot

netlify/functions/chat.mjs                   → process.env
netlify/functions/chat-health.mjs            → process.env
netlify/functions/visits.mjs                 → Netlify Blobs
functions/api/chat.js                        → env binding
functions/api/chat-health.js                 → env binding
functions/api/visits.js                      → Workers KV
functions/_middleware.js                     → X-Robots-Tag: noindex (staging only)
```

Netlify reads only `netlify/functions/` per `netlify.toml`; Cloudflare Pages
reads only `functions/`. Neither sees the other's adapter, and staging cannot
drift from production because the behaviour is in the shared core.

`functions/_middleware.js` is how staging gets `noindex` without touching
production: a `_headers` file would be honoured by *both* hosts, which would
de-index the live site.

### Visitor counter

- `POST /api/visits` counts and returns; `GET` returns without counting.
- Response is `{"count": raw + 10000}`. The raw figure is never sent to the
  browser. Offset overridable via `VISITOR_OFFSET`.
- Storage: Netlify Blobs (production), Workers KV (staging). Both free, no
  provisioning.
- One count per browser session, guarded by `sessionStorage`; obvious-bot User
  Agents and missing User-Agents are excluded.
- The tile renders `10,000` from static HTML, so it is correct with JavaScript
  disabled and when the API is unreachable. `main.js` rewrites `data-count`
  before the scroll observer fires; if the tile already animated, the text is
  corrected in place rather than re-animated from zero.

**Known limitation:** neither store offers atomic increments, so simultaneous
visits can occasionally lose a tick. Drift is downward only and invisible at
this scale. Exactness would need a Durable Object or a database, which this
does not warrant.

### Assistant

Six-link chain — SEA-LION `:8001` → BGE-M3 `:8100` → LiteLLM `:4000` →
pgvector `:5433` → `llm-slm` `:8090` → Cloudflare Tunnel. Documented with
bring-up order, verification commands and failure modes in
[`docs/assistant-runbook.md`](../../assistant-runbook.md).

- `js/chat.js` calls `/api/chat-health` before injecting any DOM and **fails
  closed**: no launcher on error, timeout, or unhealthy. Health is edge-cached
  for 60s.
- `chat-core.mjs` adds a 12s connect timeout — previously a sleeping Mac left
  the widget on a dead typing indicator indefinitely. Once bytes flow there is
  no deadline, because a slow thoughtful answer is not a failure.
- **Security:** the tunnel hostname is public and `llm-slm` runs permissive dev
  auth (empty `JWT_SECRET`), so the assistant would be an open LLM to anyone who
  found the URL. Cloudflare Access service tokens go in front;
  `chat-core.mjs` forwards `CF-Access-Client-Id` / `CF-Access-Client-Secret`
  when configured.

### FAQ

- A 4th tab group, "Solar basics", inside `faqs.html`.
- Both languages live inside **one** `<details>` per question, toggled by
  `[data-lang]` spans. This keeps one accordion per question, preserves the
  open/closed state across a language switch, and keeps the JSON-LD 1:1 with
  the accordions.
- Only the English text enters the `FAQPage` schema — one entry per question,
  not one per translation.
- The JSON-LD is regenerated to cover **all** questions, closing the existing
  8-of-23 gap.
- Every citation must be verified reachable before shipping. Sources were
  gathered and then adversarially re-checked by independent agents that had to
  quote supporting text from the document; anything unreachable or unevidenced
  was rejected rather than published.

**Honest note on FAQ rich results:** Google restricted FAQ rich snippets to
government and health sites, so this schema will not produce rich results for
apolaki.ai. It remains correct structured data and is read by answer engines
and LLM crawlers; it is not being added for a snippet that will not appear.

## Security and SEO side-effects

- `netlify/functions/*` was **publicly readable** (`/netlify/functions/chat.mjs`
  returned 200). A `netlify.toml` redirect now 404s `/netlify/*`. No secrets
  were exposed — credentials are env vars — but server source should not be
  published, and `_shared/` would have been exposed the same way.
- Staging serves a byte-identical copy of an indexed site. It gets
  `X-Robots-Tag: noindex, nofollow, noarchive, nosnippet` plus Cloudflare
  Access.

## Verification

`tools/check-site.mjs` (`npm run check`) asserts:

1. FAQ accordion count equals `FAQPage` question count.
2. No JSON-LD question has an empty answer.
3. Every JSON-LD question actually appears on the page.
4. Every outbound citation resolves (HEAD, falling back to a ranged GET with a
   browser User-Agent, since several `.gov.ph` hosts reject HEAD).
5. No `console.log` in shipped JS.

## Rollout

1. Work on `feature/site-updates-2026-07`. **Never push to `main` before
   approval** — `main` auto-deploys to apolaki.ai.
2. Deploy the branch to Cloudflare Pages; set env vars; confirm noindex.
3. Bring the assistant up per the runbook; confirm the launcher appears.
4. Review and approve.
5. Merge to `main`; set `SOLAR_ASSISTANT_URL` and Access tokens in Netlify.

## Out of scope

- Translating the existing 23 questions to Tagalog. The decision was that
  *new* answers are bilingual; the other three tab groups stay English.
- Migrating production off Netlify.
- Retiring the `.htaccess` Apache config, which is now unused but harmless.
