/* Apolaki — "Dawn over the grid" scroll signature.
   As you scroll the landing, the fixed sky brightens from pre-dawn night
   through sunrise to daylight, and the sun rises over the Manila skyline.
   Reduced-motion + no-JS both fall back to the static dawn set in CSS. */
(function () {
  "use strict";
  var dawn = document.querySelector(".dawn");
  if (!dawn) return;
  if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

  var night = dawn.querySelector(".dawn-night");
  var rise  = dawn.querySelector(".dawn-rise");
  var day   = dawn.querySelector(".dawn-day");

  // clamp + smootherstep for buttery transitions
  function cl(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }
  function smooth(t) { t = cl(t); return t * t * t * (t * (t * 6 - 15) + 10); }
  // skyline silhouette: night indigo -> dusk blue as day breaks
  var C0 = [10, 14, 28], C1 = [43, 72, 118];
  function skylineFill(e) {
    var r = Math.round(C0[0] + (C1[0] - C0[0]) * e);
    var g = Math.round(C0[1] + (C1[1] - C0[1]) * e);
    var b = Math.round(C0[2] + (C1[2] - C0[2]) * e);
    return "rgb(" + r + "," + g + "," + b + ")";
  }

  var ticking = false;
  function update() {
    ticking = false;
    var max = document.documentElement.scrollHeight - window.innerHeight;
    var p = max > 0 ? cl(window.scrollY / max) : 0;
    var e = smooth(p);

    // Sky cross-fade: night -> sunrise -> day
    var a = cl(1 - p * 2.2);            // night gone by ~p 0.45
    var c = cl((p - 0.55) * 2.5);       // day full by ~p 0.95
    var b = cl(1 - a - c);              // sunrise fills the middle
    night.style.opacity = a;
    rise.style.opacity = b;
    day.style.opacity = c;

    // Sun: rises from behind the skyline into the sky, brightening
    var sunY = 34 - 58 * e;             // vh: +34 (hidden) -> -24 (high)
    dawn.style.setProperty("--sun-y", sunY + "vh");
    dawn.style.setProperty("--sun-op", (0.4 + 0.6 * e).toFixed(3));
    dawn.style.setProperty("--sun-s", (0.94 + 0.16 * e).toFixed(3));

    // Skyline lightens; lit windows fade out as the sun comes up
    dawn.style.setProperty("--skyline", skylineFill(e));
    dawn.style.setProperty("--win-op", (0.85 * (1 - e)).toFixed(3));
  }
  function onScroll() {
    if (!ticking) { ticking = true; requestAnimationFrame(update); }
  }

  update();
  window.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("resize", onScroll, { passive: true });
})();
