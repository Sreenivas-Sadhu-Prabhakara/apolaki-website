# Apolaki — marketing website

**Solar Energy Made Simple.** The public marketing site for [Apolaki](https://apolaki-ph.netlify.app) — a digital solar **readiness** and partner‑matching platform that helps Filipino homeowners and small businesses make confident solar decisions, and gives installers leads worth acting on.

🌐 **Live:** https://apolaki-ph.netlify.app

Built by **VESS Corp.** — a venture from the Asian Institute of Management (AIM).

---

## Stack

Plain **static HTML + CSS + vanilla JS** — no build step, no framework. Hosted on **Netlify**.

- Design system: `css/styles.css` ("Daybreak" — sky‑blue `#0F6CBD` + solar‑gold `#F4C94C`, dawn‑glow motif). Fonts: **TT Fors** (official brand font, self‑hosted once licensed) with **Onest** (Google Fonts) as the loaded fallback — see *Brand font* below.
- Interactions: `js/main.js` (sticky nav, mobile menu, scroll‑reveal, count‑up, FAQ tabs, contact form).
- SEO: per‑page meta/Open Graph/Twitter + JSON‑LD, `sitemap.xml`, `robots.txt`, `site.webmanifest`.

## Structure

```
index.html              Landing page
about.html              Story, mission/vision, M&V statement, team
blog.html               Blog index
blog/*.html             15 articles on PH solar adoption (4 in Tagalog)
faqs.html               Homeowner / installer / general FAQs
contact.html            Netlify contact form
privacy.html            Privacy & Data Protection policy (RA 10173 / DPO)
404.html
css/  js/  assets/       Styles, scripts, images (logo, icons, app screenshots)
netlify.toml            Headers + redirects
```

## Brand font (TT Fors)

The official brand font is **TT Fors** (commercial, by TypeType — not bundled in this repo).
The whole site already asks for `"TT Fors"` first and falls back to **Onest** (free, loaded
from Google Fonts) until the licensed files are present.

**To activate TT Fors:** buy the webfont license from TypeType, then drop the `.woff2`
files into `assets/fonts/` with exactly these names — nothing else to change:

```
assets/fonts/TTFors-Regular.woff2    (weight 400)
assets/fonts/TTFors-Medium.woff2     (weight 500)
assets/fonts/TTFors-DemiBold.woff2   (weight 600)
assets/fonts/TTFors-Bold.woff2       (weight 700)
assets/fonts/TTFors-ExtraBold.woff2  (weight 800)
```

The matching `@font-face` rules are already at the top of `css/styles.css`; the browser
switches to TT Fors automatically as soon as the files exist. Do **not** commit the font
files to a public repo unless your license allows it.

## Develop locally

```bash
python3 -m http.server 8799      # then open http://localhost:8799
```

## Deploy

Every push to `main` auto‑deploys to Netlify via GitHub Actions (`.github/workflows/deploy.yml`).
Manual deploy:

```bash
netlify deploy --prod --dir .
```

---

## Notes for maintainers

- **Founder emails:** `jelegado.MIB2026B@aim.edu` is confirmed; the two other founders' addresses in `about.html` follow the same AIM pattern and should be verified.
- **Credibility logos** (`assets/logos/`) are the official marks: AIM (`aim.svg`, public-domain SVG via Wikimedia Commons), Royal Academy of Engineering (`rae.svg`, Wikipedia logo SVG), and UNLEASH (`unleash.png`, monochrome ink rendering of the official mark from unleash.org). The strip caption is deliberately factual ("Our journey: built through programs at") — per the student handbook, do not use "backed"/"backed by" wording.
- App screenshots in `assets/screens/` are from the Apolaki product.

© Apolaki · VESS Corp.
