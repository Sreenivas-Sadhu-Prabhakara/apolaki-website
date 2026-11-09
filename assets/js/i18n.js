/* Apolaki — bilingual soft-swap (English ↔ Tagalog).
 *
 * Progressive enhancement over the real <a data-lang-toggle> in the nav:
 *   - No JS: the anchor is a normal link, so the flip is an ordinary navigation.
 *   - With JS: we fetch the counterpart page, swap the <body> in place, update the
 *     <head> SEO tags a body-swap can't reach, and push the new URL — no reload.
 *
 * Why a delegated listener on `document`: the body gets replaced on every flip, so
 * a listener bound to a nav element would die with it. `document` never gets swapped,
 * so one listener survives every swap and never needs re-binding.
 *
 * The trap this neutralizes: browsers DON'T execute <script> inserted via innerHTML.
 * A naive body-swap would leave the mobile menu / FAQ accordion / parallax dead, so
 * runScripts() re-creates each script as a live node (see below).
 */
(function () {
  "use strict";

  var STORE = "apolaki:lang";
  var swapping = false;

  function persist(lang) { try { localStorage.setItem(STORE, lang); } catch (e) {} }
  function stored()      { try { return localStorage.getItem(STORE); } catch (e) { return null; } }

  /* 'tl' if this page is the Tagalog one, else 'en' — read from <html lang>. */
  function currentLang() {
    return (document.documentElement.lang || "en").slice(0, 2).toLowerCase() === "tl" ? "tl" : "en";
  }

  /* Copy the <head> fields a body-swap leaves stale, from the fetched document. */
  function syncHead(doc) {
    if (doc.documentElement.lang) document.documentElement.lang = doc.documentElement.lang;
    if (doc.title) document.title = doc.title;
    var pairs = [
      ['meta[name="description"]', "content"],
      ['link[rel="canonical"]', "href"],
      ['meta[property="og:url"]', "content"],
      ['meta[property="og:locale"]', "content"],
      ['meta[property="og:title"]', "content"],
      ['meta[property="og:description"]', "content"],
      ['meta[name="twitter:title"]', "content"],
      ['meta[name="twitter:description"]', "content"]
    ];
    pairs.forEach(function (p) {
      var src = doc.querySelector(p[0]), dst = document.querySelector(p[0]);
      if (src && dst) dst.setAttribute(p[1], src.getAttribute(p[1]));
    });
  }

  /* Re-execute the swapped-in page's scripts. innerHTML-inserted <script> never runs,
   * so we clone each executable script into a fresh node the browser will run. We skip
   * non-JS blocks (e.g. application/ld+json) — that's data, already in the DOM. */
  function runScripts(root) {
    var scripts = root.querySelectorAll("script");
    for (var i = 0; i < scripts.length; i++) {
      var old = scripts[i];
      var type = (old.getAttribute("type") || "").toLowerCase();
      if (type && type !== "text/javascript" && type !== "application/javascript" && type !== "module") continue;
      var s = document.createElement("script");
      for (var j = 0; j < old.attributes.length; j++) s.setAttribute(old.attributes[j].name, old.attributes[j].value);
      s.text = old.textContent;
      old.parentNode.replaceChild(s, old);
    }
  }

  /* The core flip. `push` is false when we're responding to back/forward. */
  function swap(url, push) {
    if (swapping) return;
    swapping = true;
    fetch(url, { credentials: "same-origin" })
      .then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.text(); })
      .then(function (html) {
        var doc = new DOMParser().parseFromString(html, "text/html");
        syncHead(doc);
        /* pushState BEFORE inserting the body so relative asset URLs in the new
         * markup resolve against the new path, not the old one. */
        if (push) history.pushState({ soft: true }, "", url);
        document.body.innerHTML = doc.body.innerHTML;
        runScripts(document.body);
        window.scrollTo(0, 0);
        persist(currentLang());
        swapping = false;
      })
      .catch(function () { swapping = false; window.location.href = url; }); /* fail-safe: hard nav */
  }

  /* Delegated toggle click — survives body swaps. */
  document.addEventListener("click", function (e) {
    var a = e.target.closest && e.target.closest("[data-lang-toggle]");
    if (!a) return;
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return; /* let new-tab etc. through */
    e.preventDefault();
    swap(a.getAttribute("href"), true);
  });

  /* Back/forward between languages. */
  window.addEventListener("popstate", function (e) {
    if (e.state && e.state.soft) swap(location.pathname + location.search, false);
  });

  /* Same-site page links we should steer — not app links, social, mailto, viber,
   * javascript:, or in-page anchors. */
  function isInternalPage(href) {
    if (!href) return false;
    if (/^(https?:|mailto:|tel:|viber:|javascript:)/i.test(href)) return false;
    if (href.charAt(0) === "#") return false;
    var path = href.split(/[?#]/)[0];
    return path === "/" || path === "/tl/" || /\.html$/.test(path);
  }

  /* Map any internal page link to the same page in the target language, as a
   * root-relative URL (depth-independent). "/" and "index.html" both mean home;
   * a query string like "?type=installer" is preserved. */
  function toLang(href, toTl) {
    var q = "", cut = href.search(/[?#]/);
    if (cut >= 0) { q = href.slice(cut); href = href.slice(0, cut); }
    var file = href.replace(/\/+$/, "").split("/").pop() || "index.html";
    return (toTl ? "/tl/" : "/") + file + q;
  }

  /* ── Onward-language persistence (approach b) ─────────────────────────────
   * A visitor who picked Tagalog once should keep browsing in Tagalog even when
   * they later land on an English URL (a Google result, a typed address, a shared
   * link). We DON'T redirect or swap this page — that would fight the URL they
   * deliberately opened and risk a flash. Instead we leave the page as-is and
   * rewrite its internal links so the NEXT click stays in their language.
   * Googlebot has no localStorage → stored() is null → no-op, so this can never
   * affect crawling or create duplicate-content signals. Runs once on load. */
  function applyStoredPreference() {
    var pref = stored();
    if (!pref || pref === currentLang()) return; /* no choice, or already correct */
    var toTl = pref === "tl";
    var links = document.querySelectorAll("a[href]");
    for (var i = 0; i < links.length; i++) {
      var a = links[i];
      if (a.hasAttribute("data-lang-toggle")) continue; /* the toggle manages its own direction */
      var href = a.getAttribute("href");
      if (isInternalPage(href)) a.setAttribute("href", toLang(href, toTl));
    }
  }
  applyStoredPreference();
})();
