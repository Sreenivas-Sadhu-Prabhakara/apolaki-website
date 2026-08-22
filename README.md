# Apolaki Website

Marketing site for [apolaki.ai](https://apolaki.ai), built for VESS Energy Corp.
Static HTML/CSS/JS — no build step, no dependencies.

Hosted on **Netlify**: production deploys automatically from `main`, and every
pull request gets a Netlify **Deploy Preview** URL to review before promoting.

## Preview locally

    python3 -m http.server 8000

Then open <http://localhost:8000>. Serving the files (rather than opening them
directly) makes the relative links behave the same way they do in production.

## Pages

`index` · `homeowners` · `installers` · `financing-partners` · `about` ·
`blog` · `contact` · `faqs` · `privacy` · `terms` · `404`

## Hosting notes

- **`netlify.toml`** — publish dir, host canonicalization, security headers, the
  Content-Security-Policy, and cache rules.
- **`assets/js/site.js`** — injects the floating Viber launcher (reuses the
  site's own `.b b-blue` button styling). Fail-closed: a bad number renders
  nothing.
- **Section photography** is hotlinked from Pexels — see the CSP `img-src` in
  `netlify.toml`. A later pass could self-host these for resilience and speed.
