/* Apolaki — floating Viber launcher.
   A backend-free way to reach us: a viber:// deep link pinned to the corner,
   the same always-available affordance the previous site carried. Self-contained
   — it injects its own element so no page markup has to change.

   Styling is Josa's, not invented: the button reuses the site's own `.b b-blue`
   button class, and the only CSS this file adds is inert positioning plus the
   site's existing blue shadow value, so the launcher looks native to the design.

   Fail-closed by design: a missing or malformed number renders NOTHING. A dead
   "Viber us" button is worse than no button, so a placeholder can never ship. */
(function () {
  "use strict";

  var VIBER = {
    number: "+639178161707", // E.164, digits only after the "+"
    label: "Viber us"        // shown beside the icon
  };

  var number = String(VIBER.number || "").replace(/[\s()\-]/g, "");
  var label = String(VIBER.label || "").trim();
  if (!/^\+[1-9]\d{7,14}$/.test(number) || !label) return; // fail-closed

  // Positioning only — colours, radius, font and hover all come from `.b b-blue`
  // in assets/css/apolaki.css. The shadow reuses the site's own blue-button
  // shadow value so a resting launcher matches a hovered blue button.
  var css =
    ".ap-viber-launcher{position:fixed;right:clamp(16px,3vw,26px);bottom:clamp(16px,3vw,26px);" +
    "z-index:89;text-decoration:none;box-shadow:0 12px 30px -12px rgba(14,108,189,.55)}";
  var style = document.createElement("style");
  style.textContent = css;
  document.head.appendChild(style);

  // Josa's own outline Viber glyph (matches the footer social icon).
  var icon =
    '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
    'stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' +
    '<path d="M21 11.5a8.4 8.4 0 01-.9 3.8 8.5 8.5 0 01-7.6 4.7 8.4 8.4 0 01-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 01-.9-3.8 8.5 8.5 0 014.7-7.6 8.4 8.4 0 013.8-.9h.5a8.5 8.5 0 018 8z"/>' +
    '</svg>';

  var btn = document.createElement("a");
  btn.className = "b b-blue ap-viber-launcher";
  btn.href = "viber://chat?number=" + encodeURIComponent(number);
  btn.rel = "noopener";
  // The number lives in the accessible name and tooltip on purpose: if Viber
  // isn't installed the deep link does nothing, so a human needs to be able to
  // read the number and save it by hand.
  btn.setAttribute("aria-label", "Message Apolaki on Viber at " + number);
  btn.title = "Viber: " + number;
  btn.innerHTML = icon + "<span>" + label + "</span>";
  document.body.appendChild(btn);
})();

/* Apolaki — website form submission (Contact + homeowner/installer waitlists).
   Netlify Forms registers these forms from the static markup at deploy time
   and emails each verified submission to hello@apolaki.ai (configured in
   Netlify, never from the browser). This only upgrades the native POST to an
   in-page submit so the visitor stays on the page; with JavaScript off the
   native POST still reaches Netlify. Scoped to form[data-contact] and
   form[data-wait] — the home-page bill form is never intercepted.

   Honest by design: the thank-you shows only after Netlify accepts the POST,
   a failure keeps every field, and there is no automatic retry — a lost
   response could otherwise turn into a second message. */
(function () {
  "use strict";

  var TIMEOUT_MS = 15000;
  var FAIL = "We couldn't confirm your submission. Please try again, or email hello@apolaki.ai.";

  // Contact keeps its error line inside the form; waitlists put their status
  // lines right after it. Look inside first, then at the following siblings.
  function near(form, sel) {
    var el = form.querySelector(sel);
    for (var n = form.nextElementSibling; !el && n; n = n.nextElementSibling) {
      if (n.matches(sel)) el = n;
    }
    return el;
  }

  // Return a message to show the visitor, or "" when the form may be sent.
  // Runs after the browser's own required/type/maxlength checks have passed.
  function validate(form) {
    // `required` accepts whitespace-only text, which would email hello@ a
    // blank inquiry. Trim in place (hello@ gets clean text) and focus the
    // first empty field so keyboard users land on it. Waitlists have neither.
    var fields = [["name", "your name"], ["message", "a message"]];
    for (var i = 0; i < fields.length; i++) {
      var el = form.elements.namedItem(fields[i][0]);
      if (!el) continue;
      el.value = el.value.trim();
      if (!el.value) { el.focus(); return "Please enter " + fields[i][1] + "."; }
    }
    return "";
  }

  function bind(form, okSel) {
    if (form.dataset.apBound) return; // bind once, even if this runs again
    form.dataset.apBound = "1";
    var btn = form.querySelector('button[type="submit"]');
    var err = near(form, ".form-err");
    var ok = near(form, okSel);
    if (!btn || !err) return; // markup missing → leave the native POST alone
    var idle = btn.innerHTML;
    var busy = false;

    function showErr(msg) { err.textContent = msg; err.hidden = !msg; }

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      if (busy) return; // one in-flight submission per form
      var msg = validate(form);
      showErr(msg);
      if (msg) return;

      // Serialize BEFORE disabling anything: disabled controls drop out of FormData.
      var body = new URLSearchParams(new FormData(form)).toString();
      busy = true;
      btn.disabled = true;
      btn.setAttribute("aria-busy", "true");
      btn.textContent = btn.dataset.busy || "Sending…";
      if (ok) ok.classList.remove("on");

      var ctl = new AbortController();
      var timer = setTimeout(function () { ctl.abort(); }, TIMEOUT_MS);
      fetch("/", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: body,
        signal: ctl.signal
      }).then(function (res) {
        if (!res.ok) throw new Error("HTTP " + res.status); // a resolved fetch is not success
        form.reset(); // clear only on confirmed acceptance
        if (ok) { ok.classList.add("on"); ok.focus(); }
      }).catch(function () {
        showErr(FAIL); // fields stay as typed so the visitor can retry
      }).then(function () {
        clearTimeout(timer);
        busy = false;
        btn.disabled = false;
        btn.removeAttribute("aria-busy");
        btn.innerHTML = idle; // restores the static label + arrow icon, never user text
      });
    });
  }

  if (!("fetch" in window) || !("AbortController" in window) || !("URLSearchParams" in window)) return;
  document.querySelectorAll("form[data-contact]").forEach(function (f) { bind(f, ".cform-ok"); });
  document.querySelectorAll("form[data-wait]").forEach(function (f) { bind(f, ".wait-ok"); });
})();
