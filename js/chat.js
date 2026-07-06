/* Apolaki — floating solar assistant widget.
   Talks to /api/chat (Netlify function → the team's Gemma solar assistant),
   streaming the SSE reply token-by-token. Bilingual (EN / Tagalog / Taglish).
   Self-contained: injects its own DOM; styles live in css/styles.css (.ap-chat-*). */
(function () {
  "use strict";
  if (window.__apChatLoaded) return;
  window.__apChatLoaded = true;

  var ENDPOINT = "/api/chat";
  var GREETING =
    "Kumusta! ☀️ I’m the Apolaki solar assistant. Ask me anything about going solar in the Philippines — savings vs. your Meralco bill, net metering, system size, or payback. Tagalog, Taglish, or English — okay lang!";
  var SUGGESTIONS = [
    "Is solar worth it for my home?",
    "Paano gumagana ang net metering?",
    "Magkano ang 5kW solar system?",
    "How long is the payback period?",
  ];

  var ICON = {
    chat: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8z"/></svg>',
    // two overlapping speech bubbles, solar-gold — the launcher glyph
    bubbles: '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M10 3.5h7A3.5 3.5 0 0 1 20.5 7v2.5a3.5 3.5 0 0 1-3.5 3.5h-.5v2.6L13.6 13" stroke="#FFD874" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><path d="M4 12a3 3 0 0 1 3-3h5a3 3 0 0 1 3 3v2a3 3 0 0 1-3 3H9l-5 4z" fill="#F4C94C"/></svg>',
    sun: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4.5"/><path d="M12 1.5v2.5M12 20v2.5M4.2 4.2l1.8 1.8M18 18l1.8 1.8M1.5 12H4M20 12h2.5M4.2 19.8 6 18M18 6l1.8-1.8"/></svg>',
    close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>',
    send: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 2 11 13M22 2l-7 20-4-9-9-4z"/></svg>',
  };

  var conversationId = null;
  var busy = false;
  var greeted = false;
  var els = {};

  function el(tag, cls, html) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (html != null) n.innerHTML = html;
    return n;
  }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  // tiny, safe markdown: escape first, then **bold**, *italic*, line breaks, simple bullets
  function fmt(s) {
    var t = esc(s.trim());
    t = t.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    t = t.replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>");
    t = t.replace(/^[\-•]\s+(.*)$/gm, "<span class=\"ap-li\">• $1</span>");
    t = t.replace(/\n/g, "<br>");
    return t;
  }

  function build() {
    var launcher = el("button", "ap-chat-launcher", ICON.bubbles + '<span class="ap-launch-label">Ask Apolaki</span>');
    launcher.setAttribute("aria-label", "Ask Apolaki — open the solar assistant");
    launcher.addEventListener("click", toggle);

    var panel = el("section", "ap-chat-panel", "");
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-label", "Apolaki solar assistant");
    panel.setAttribute("aria-modal", "false");
    panel.innerHTML =
      '<header class="ap-chat-head">' +
        '<span class="ap-chat-id"><span class="ap-chat-av">' + ICON.sun + '</span>' +
          '<span><span class="ap-chat-name">Apolaki Assistant</span><span class="ap-chat-sub"><span class="ap-dot-live"></span> Solar help — EN / Tagalog</span></span>' +
        '</span>' +
        '<button class="ap-chat-x" aria-label="Close chat">' + ICON.close + '</button>' +
      '</header>' +
      '<div class="ap-chat-msgs" id="apMsgs" aria-live="polite"></div>' +
      '<div class="ap-chat-foot">' +
        '<form class="ap-chat-form" id="apForm" autocomplete="off">' +
          '<textarea id="apInput" class="ap-chat-input" rows="1" placeholder="Ask about going solar…" maxlength="1200"></textarea>' +
          '<button type="submit" class="ap-chat-send" aria-label="Send">' + ICON.send + '</button>' +
        '</form>' +
        '<p class="ap-chat-note">AI assistant · general guidance, not financial advice</p>' +
      '</div>';

    document.body.appendChild(launcher);
    document.body.appendChild(panel);

    els.launcher = launcher;
    els.panel = panel;
    els.msgs = panel.querySelector("#apMsgs");
    els.input = panel.querySelector("#apInput");
    els.form = panel.querySelector("#apForm");
    panel.querySelector(".ap-chat-x").addEventListener("click", toggle);
    els.form.addEventListener("submit", onSubmit);
    els.input.addEventListener("input", autosize);
    els.input.addEventListener("keydown", function (e) {
      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); onSubmit(e); }
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && document.body.classList.contains("ap-chat-open")) toggle();
    });
  }

  function autosize() {
    els.input.style.height = "auto";
    els.input.style.height = Math.min(els.input.scrollHeight, 120) + "px";
  }

  function toggle() {
    var open = document.body.classList.toggle("ap-chat-open");
    els.launcher.setAttribute("aria-expanded", open ? "true" : "false");
    if (open) {
      if (!greeted) { greeted = true; greet(); }
      setTimeout(function () { els.input.focus(); }, 220);
    }
  }

  function greet() {
    addBot(GREETING);
    var chips = el("div", "ap-chips", "");
    SUGGESTIONS.forEach(function (q) {
      var c = el("button", "ap-chip", esc(q));
      c.addEventListener("click", function () { if (!busy) { send(q); chips.remove(); } });
      chips.appendChild(c);
    });
    els.msgs.appendChild(chips);
    scroll();
  }

  function addUser(text) {
    var m = el("div", "ap-msg ap-user", '<div class="ap-bubble">' + esc(text) + "</div>");
    els.msgs.appendChild(m); scroll(); return m;
  }
  function addBot(html) {
    var m = el("div", "ap-msg ap-bot", '<span class="ap-bot-av">' + ICON.sun + '</span><div class="ap-bubble">' + html + "</div>");
    els.msgs.appendChild(m); scroll(); return m;
  }
  function typing() {
    return addBot('<span class="ap-typing"><i></i><i></i><i></i></span>');
  }
  function scroll() { els.msgs.scrollTop = els.msgs.scrollHeight; }

  function onSubmit(e) {
    if (e && e.preventDefault) e.preventDefault();
    var text = (els.input.value || "").trim();
    if (text) send(text);
  }

  function send(text) {
    if (busy) return;
    busy = true;
    els.input.value = ""; autosize();
    addUser(text);
    var botMsg = typing();
    var bubble = botMsg.querySelector(".ap-bubble");
    var answer = "";
    var gotToken = false;
    var gotError = false;

    streamChat(text, function (evt) {
      if (evt.token) {
        if (!gotToken) { gotToken = true; gotError = false; bubble.innerHTML = ""; }
        answer += evt.token;
        bubble.innerHTML = fmt(answer);
        scroll();
      } else if (evt.error && !gotToken) {
        gotError = true;
        bubble.innerHTML = fmt("Medyo nahihirapan akong kunin ’yan ngayon — subukan mong i-rephrase ang tanong, o simulan ang iyong libreng assessment at gagabayan ka namin. ☀️");
        scroll();
      }
    }, function (done, err) {
      busy = false;
      if (!gotToken && !gotError) {
        bubble.innerHTML = fmt(err
          ? "Pasensya, the assistant didn’t respond just now. Please try again shortly, or reach us on the contact page."
          : "Pasensya, I didn’t catch a reply. Please try rephrasing your question. ☀️");
      }
      if (done && done.conversation_id) conversationId = done.conversation_id;
      scroll();
      setTimeout(function () { els.input.focus(); }, 50);
    });
  }

  // POST to /api/chat, parse the SSE stream incrementally.
  function streamChat(message, onEvent, onDone) {
    var ctrl = new AbortController();
    var timer = setTimeout(function () { ctrl.abort(); }, 65000);
    fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: message, mode: "customer", conversation_id: conversationId }),
      signal: ctrl.signal,
    })
      .then(function (res) {
        if (!res.ok || !res.body) throw new Error("http " + res.status);
        var reader = res.body.getReader();
        var dec = new TextDecoder();
        var buf = "";
        var done = {};
        function pump() {
          return reader.read().then(function (r) {
            if (r.done) { clearTimeout(timer); onDone(done, null); return; }
            buf += dec.decode(r.value, { stream: true });
            var blocks = buf.split("\n\n");
            buf = blocks.pop();
            blocks.forEach(function (block) {
              block.split("\n").forEach(function (line) {
                line = line.trim();
                if (line.indexOf("data:") !== 0) return;
                var raw = line.slice(5).trim();
                if (!raw) return;
                var p; try { p = JSON.parse(raw); } catch (e) { return; }
                if (typeof p.token === "string") onEvent({ token: p.token });
                else if (p.error) onEvent({ error: p.error });
                if ("conversation_id" in p || "message_id" in p || "sources" in p) done = p;
              });
            });
            return pump();
          });
        }
        return pump();
      })
      .catch(function () { clearTimeout(timer); onDone(null, true); });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", build);
  } else { build(); }
})();
