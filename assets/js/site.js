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
