/* Apolaki — site interactions: nav, scroll-reveal, count-up, FAQ tabs, form */
(function () {
  'use strict';
  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* sticky nav shadow */
  var nav = document.getElementById('nav');
  if (nav) {
    var onScroll = function () { nav.classList.toggle('scrolled', window.scrollY > 8); };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
  }

  /* mobile menu */
  var toggle = document.getElementById('navToggle');
  if (toggle) {
    toggle.addEventListener('click', function () {
      var open = document.body.classList.toggle('menu-open');
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
    document.querySelectorAll('#navLinks a').forEach(function (a) {
      a.addEventListener('click', function () {
        document.body.classList.remove('menu-open');
        toggle.setAttribute('aria-expanded', 'false');
      });
    });
  }

  /* scroll reveal */
  var reveals = document.querySelectorAll('.reveal');
  if (reveals.length) {
    if (reduce || !('IntersectionObserver' in window)) {
      reveals.forEach(function (el) { el.classList.add('in'); });
    } else {
      var io = new IntersectionObserver(function (entries) {
        entries.forEach(function (e) {
          if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
        });
      }, { threshold: 0.12, rootMargin: '0px 0px -8% 0px' });
      reveals.forEach(function (el) { io.observe(el); });
    }
  }

  /* count-up numbers */
  function animateCount(el) {
    el.__apCounted = true;
    var target = parseFloat(el.getAttribute('data-count'));
    var dec = (el.getAttribute('data-dec') || '0') | 0;
    var prefix = el.getAttribute('data-prefix') || '';
    var suffix = el.getAttribute('data-suffix') || '';
    if (reduce) { el.textContent = prefix + target.toLocaleString() + suffix; return; }
    var dur = 1500, start = null;
    function step(ts) {
      if (!start) start = ts;
      var p = Math.min((ts - start) / dur, 1);
      var eased = 1 - Math.pow(1 - p, 3);
      var val = target * eased;
      el.textContent = prefix + (dec ? val.toFixed(dec) : Math.round(val).toLocaleString()) + suffix;
      if (p < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }
  var counters = document.querySelectorAll('[data-count]');
  if (counters.length && 'IntersectionObserver' in window) {
    var co = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) { animateCount(e.target); co.unobserve(e.target); }
      });
    }, { threshold: 0.5 });
    counters.forEach(function (el) { co.observe(el); });
  } else {
    counters.forEach(function (el) { el.textContent = (el.getAttribute('data-prefix') || '') + el.getAttribute('data-count') + (el.getAttribute('data-suffix') || ''); });
  }

  /* visitor counter
     The tile ships with a floor value in the HTML so it reads correctly with
     no JS and when the API is unreachable. Here we replace data-count with the
     live figure; because animateCount() reads the attribute at animation time,
     a fetch that lands before the tile scrolls into view needs no extra work.
     POST registers the visit once per browser session; later page views read. */
  var visitEls = document.querySelectorAll('[data-visitors]');
  if (visitEls.length && window.fetch) {
    var SEEN_KEY = 'ap_visit_counted';
    var alreadyCounted = false;
    try { alreadyCounted = sessionStorage.getItem(SEEN_KEY) === '1'; } catch (e) { /* private mode */ }

    fetch('/api/visits', { method: alreadyCounted ? 'GET' : 'POST', cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (data) {
        if (!data || typeof data.count !== 'number' || !isFinite(data.count)) return;
        try { sessionStorage.setItem(SEEN_KEY, '1'); } catch (e) { /* private mode */ }
        visitEls.forEach(function (el) {
          el.setAttribute('data-count', String(data.count));
          /* Already scrolled past and animated? Re-running the count-up would
             restart from zero and read as a glitch, so correct it in place. */
          if (el.__apCounted) {
            el.textContent = (el.getAttribute('data-prefix') || '') +
              data.count.toLocaleString() +
              (el.getAttribute('data-suffix') || '');
          }
        });
      })
      .catch(function () { /* leave the floor value in place */ });
  }

  /* FAQ tab groups */
  var tabs = document.querySelectorAll('.faq-tab');
  if (tabs.length) {
    tabs.forEach(function (tab) {
      tab.addEventListener('click', function () {
        var id = tab.getAttribute('data-group');
        tabs.forEach(function (t) { t.classList.toggle('active', t === tab); });
        document.querySelectorAll('.faq-group').forEach(function (g) {
          g.classList.toggle('active', g.getAttribute('data-group') === id);
        });
      });
    });
  }

  /* FAQ language toggle
     Scoped to the group that contains the switch (Solar basics) — the other
     tab groups are English-only, so a global toggle would blank them. Both
     languages sit inside the same <details>, so switching preserves which
     questions the reader has open. */
  var langSwitch = document.querySelector('.faq-lang-switch');
  if (langSwitch) {
    var LANG_KEY = 'ap_faq_lang';
    var scope = langSwitch.closest('.faq-group') || document;
    var applyLang = function (lang) {
      scope.querySelectorAll('[data-lang]').forEach(function (el) {
        el.hidden = el.getAttribute('data-lang') !== lang;
      });
      langSwitch.querySelectorAll('button[data-set-lang]').forEach(function (b) {
        b.setAttribute('aria-pressed', b.getAttribute('data-set-lang') === lang ? 'true' : 'false');
      });
      try { localStorage.setItem(LANG_KEY, lang); } catch (e) { /* private mode */ }
    };
    langSwitch.addEventListener('click', function (e) {
      var btn = e.target.closest ? e.target.closest('button[data-set-lang]') : null;
      if (btn) applyLang(btn.getAttribute('data-set-lang'));
    });
    var savedLang = null;
    try { savedLang = localStorage.getItem(LANG_KEY); } catch (e) { /* private mode */ }
    applyLang(savedLang === 'tl' ? 'tl' : 'en');
  }

  /* current year */
  document.querySelectorAll('[data-year]').forEach(function (el) {
    el.textContent = new Date().getFullYear();
  });

  /* contact form: graceful inline success when handled by Netlify (AJAX) */
  var form = document.getElementById('contactForm');
  if (form) {
    form.addEventListener('submit', function (e) {
      if (form.getAttribute('data-ajax') !== 'true') return; // let Netlify handle normally
      e.preventDefault();
      var data = new FormData(form);
      fetch('/', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(data).toString() })
        .then(function () {
          form.style.display = 'none';
          var ok = document.getElementById('formSuccess');
          if (ok) ok.style.display = 'block';
        })
        .catch(function () { form.submit(); });
    });
  }
})();
