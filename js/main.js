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
     Scoped to the .faq-group containing the switch. The other three groups
     carry no [data-lang] elements at all, so a document-wide query would be
     harmless today — the scoping exists so that adding a second bilingual
     group later needs its own switch rather than silently sharing this one.
     Both languages sit inside the same <details>, so switching language
     preserves which questions the reader already has open. */
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

  /* Viber launcher
     A second way to reach us that depends on nothing we run — when the solar
     assistant is asleep, this is still there. It renders immediately rather
     than waiting on any health check, and CSS raises it clear of the chat
     button only if that button actually appears (body.ap-chat-on).

     Fail-closed by design: an unset or malformed number renders NOTHING. A
     dead "Viber us" button is worse than no button, and this guarantees a
     placeholder can never reach production. */

  // TODO(human): supply the Viber destination and the button copy.
  var VIBER = {
    // E.164 format, digits only after the "+". Philippine mobiles look like
    // '+639171234567'. Leave empty and the button simply does not render.
    number: '',
    // Shown beside the icon on desktop; hidden on phones, where the button
    // collapses to the icon alone.
    label: ''
  };

  var viberNumber = String(VIBER.number || '').replace(/[\s()\-]/g, '');
  var viberLabel = String(VIBER.label || '').trim();

  if (/^\+[1-9]\d{7,14}$/.test(viberNumber) && viberLabel) {
    var viberIcon =
      '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">' +
      '<path fill="currentColor" d="M12 2.1c-5 0-9 3.4-9 7.9 0 2.5 1.2 4.8 3.2 6.3v3.9c0 .5.5.7.9.4l3.1-2.4c.6.1 1.2.1 1.8.1 5 0 9-3.4 9-7.9s-4-8.3-9-8.3Z"/>' +
      '<path fill="#5B4CDB" d="M9.5 7.2c.35-.12.73.02.93.34l.83 1.36c.2.33.14.75-.15.99l-.5.42a.28.28 0 0 0-.07.35c.47.89 1.2 1.6 2.13 2.02.12.06.27.02.35-.09l.4-.5c.23-.29.63-.38.95-.2l1.42.79c.33.18.48.57.36.92-.28.83-1.09 1.36-1.96 1.28-2.72-.26-4.87-2.34-5.2-5.02-.1-.85.44-1.63 1.26-1.87Z"/>' +
      '</svg>';

    var viberBtn = document.createElement('a');
    viberBtn.className = 'ap-viber-launcher';
    viberBtn.href = 'viber://chat?number=' + encodeURIComponent(viberNumber);
    viberBtn.rel = 'noopener';
    // The number goes in the accessible name and the tooltip on purpose: if
    // Viber is not installed the deep link does nothing at all, so the number
    // has to be readable by a human who can then save it by hand.
    viberBtn.setAttribute('aria-label', 'Message Apolaki on Viber at ' + viberNumber);
    viberBtn.title = 'Viber: ' + viberNumber;
    viberBtn.innerHTML = viberIcon + '<span class="ap-launch-label"></span>';
    viberBtn.querySelector('.ap-launch-label').textContent = viberLabel;
    document.body.appendChild(viberBtn);
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
