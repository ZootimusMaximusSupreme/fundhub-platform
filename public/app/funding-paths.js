/* "Your funding paths" — three ways to get funded, from the client's own file
 * (Finance OS wave 4, unit FUND). money-fundability.js mounts it on the
 * Fundability tab; it paints GET /api/money/fundability's `paths` block
 * (src/finance/funding-paths.mjs):
 *
 *   1 Fund it yourself    the UnderwriteIQ estimate, the plan's look-ahead and
 *                         the next step on the client's own checklist
 *   2 Fund other people   the referral rate with the sales it pays on, and the
 *                         client's own link (the portal's "Refer a friend":
 *                         POST /api/affiliates/refer), and the white-label
 *                         partner program
 *   3 Fundhub funds you   done-for-you funding ($0 to start for a Capital
 *                         Blueprint owner: the deposit is waived), "I'm ready
 *                         to get funded" (POST /api/money/ready-to-fund), and
 *                         ClarityPay
 *
 * Every number on the card is a field from that read: prices from
 * src/config/offers.mjs, the estimate from UnderwriteIQ, the rate from the
 * commission rules. An unknown is left out, never shown as $0. Status is a word
 * in a pill, never colour alone (UI-STANDARDS §12.6).
 *
 * Every render function returns an HTML string and touches no DOM, so
 * src/http/funding-paths-screen.test.mjs runs them in Node.
 */
(function (root) {
  "use strict";

  var MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  var REFER_PATH = "/api/affiliates/refer";
  var READY_PATH = "/api/money/ready-to-fund";
  var ACTS = { "fp-join": true, "fp-copy": true, "fp-ready": true };
  var READY_WORD = { requested: "Sent to our team", csm_assigned: "A person has it", done: "Prep call done" };
  var FAIL = {
    signin: "Sign in again, then try.",
    offline: "We could not reach the server. Try again.",
    forbidden: "Only the client can do this from their own login."
  };

  function esc(v) {
    return String(v == null ? "" : v)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
  function isNum(v) { return typeof v === "number" && isFinite(v); }

  /* cents → "$93,600" (whole dollars) or "$93,600.50". Null → null, left out. */
  function money(cents) {
    if (!isNum(cents)) return null;
    var abs = Math.round(Math.abs(cents));
    var dollars = "$" + String(Math.floor(abs / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    return abs % 100 === 0 ? dollars : dollars + "." + ("0" + (abs % 100)).slice(-2);
  }
  function shortDay(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ""));
    return m ? MONTHS[Number(m[2]) - 1] + " " + Number(m[3]) : "";
  }
  /* Staff carry ?client_id= in front of any #tab. */
  function withClient(href, cid) {
    if (!cid) return href;
    var parts = String(href).split("#");
    var base = parts[0] + (parts[0].indexOf("?") < 0 ? "?" : "&") + "client_id=" + encodeURIComponent(cid);
    return parts.length > 1 ? base + "#" + parts.slice(1).join("#") : base;
  }
  function failed() { return '<p class="caption">We could not load this right now.</p>'; }
  function msgSlot() { return '<p class="caption fp-msg" data-slot="fp-msg" aria-live="polite" hidden></p>'; }
  function head(n, name) {
    return '<h3 class="fp-name"><span class="fp-num" aria-hidden="true">' + n + '</span>' + esc(name) + '</h3>';
  }

  /* ── 1 · fund it yourself ──────────────────────────────────────────────── */
  function renderSelf(s, opts) {
    var open = '<div class="fp-path" data-fp-path="self">' + head(1, "Fund it yourself");
    if (!s || s.ok !== true) return open + failed() + '</div>';
    var body = "";
    var today = money(s.today_cents);
    if (today) {
      body += '<span class="big">' + esc(today) + '</span><p class="caption">UnderwriteIQ estimate' + (s.sample ? " · sample" : "") + '</p>';
    } else if (s.has_pull && isNum(s.checks_passed) && isNum(s.checks_of)) {
      body += '<span class="big">' + esc(s.checks_passed + " of " + s.checks_of) + '</span><p class="caption">Fundability checks' + (s.sample ? " · sample" : "") + '</p>';
    } else {
      body += '<p class="fp-lead">Starts with your soft pull.</p>';
    }
    var plan = money(s.plan_cents);
    if (plan && s.plan_cents !== s.today_cents) {
      body += '<p class="fp-line">On your plan' + (isNum(s.plan_months) ? " in " + esc(s.plan_months) + " months" : "") + ': <b class="num">' + esc(plan) + '</b></p>';
    }
    if (s.next_step && s.next_step.title) body += '<p class="fp-line">Next: ' + esc(s.next_step.title) + '</p>';
    return open + body + '<a class="fp-btn-line" href="' + esc(withClient(s.steps_url || "/app/financeos.html#next", opts.clientId)) + '">See your steps</a></div>';
  }

  /* ── 2 · fund other people ─────────────────────────────────────────────── */
  function renderOthers(o, opts) {
    var open = '<div class="fp-path" data-fp-path="others">' + head(2, "Fund other people");
    if (!o || o.ok !== true) return open + failed() + '</div>';
    var a = o.affiliate || {};
    var body = "";
    /* Codex CX20: the percent shows only with the sale it pays on and what it
       is a percent of, from the live commission rules. Unknown → no percent. */
    var pays = Array.isArray(a.pays_on) ? a.pays_on.filter(function (p) { return p && p.sale && p.of; }) : [];
    if (isNum(a.direct_pct) && pays.length && (a.pays_once === true || a.pays_once === false)) {
      body += '<span class="big">' + esc(a.direct_pct) + '%</span><p class="caption">' +
        (a.pays_once ? "of the first of these that someone you send buys" : "of each of these that someone you send buys") + '</p>' +
        pays.map(function (p) { return '<p class="fp-line">' + esc(p.sale) + ': ' + esc(p.of + (p.when ? ", " + p.when : "")) + '</p>'; }).join("");
    } else {
      body += '<p class="fp-lead">Earn when someone you send buys.</p>';
    }
    var counts = isNum(a.sent) ? '<p class="caption">' + esc(a.sent + " sent · " + (isNum(a.signed_up) ? a.signed_up : "—") + " signed up") + '</p>' : "";
    if (opts.viewer === "staff") {
      body += '<p class="fp-line">' + (a.enrolled ? "Joined referrals" : "Not joined yet") + '</p>' + (a.enrolled ? counts : "");
    } else if (a.enrolled && a.share_url) {
      body += '<p class="fp-url" data-fp-url>' + esc(a.share_url) + '</p>' +
        '<div class="fp-acts"><button class="fp-btn-line" type="button" data-act="fp-copy" data-url="' + esc(a.share_url) + '">Copy link</button>' +
        '<a class="fp-link" href="' + esc(a.dashboard_url || "/app/affiliate.html") + '">Open referrals</a></div>' + counts;
    } else if (a.enrolled) {
      body += '<p class="caption">Your link is not ready yet.</p>';
    } else {
      body += '<div class="fp-acts"><button class="fp-btn-line" type="button" data-act="fp-join">Get my link</button></div>';
    }
    var w = o.white_label || {};
    var entry = money(w.entry_cents), trial = money(w.trial_cents);
    if (entry) body += '<p class="fp-line">Your own brand: <b class="num">' + esc(entry) + '</b> once</p>';
    if (trial) body += '<p class="fp-line">7-day trial: <b class="num">' + esc(trial) + '</b></p>';
    if (w.url) body += '<a class="fp-link" href="' + esc(w.url) + '" target="_blank" rel="noopener">See the partner program</a>';
    return open + body + msgSlot() + '</div>';
  }

  /* ── 3 · Fundhub funds you ─────────────────────────────────────────────── */
  function renderFundhub(f, opts) {
    var open = '<div class="fp-path" data-fp-path="fundhub">' + head(3, "Fundhub funds you");
    if (!f || f.ok !== true) return open + failed() + '</div>';
    var d = f.done_for_you || {};
    var price = [money(d.deposit_cents) ? money(d.deposit_cents) + " to start" : "", isNum(d.success_fee_pct) ? d.success_fee_pct + "% of approved funding" : ""].filter(Boolean).join(" · ");
    var body = '<p class="fp-lead">Done-for-you funding</p>' + (price ? '<p class="caption">' + esc(price) + '</p>' : "");
    /* A Capital Blueprint owner's deposit is waived (owner-set 2026-11-07). */
    if (d.deposit_waived === true && d.deposit_cents === 0) {
      var full = money(d.standard_deposit_cents);
      body += '<p class="fp-line">' + (full ? 'Your Blueprint waives the <b class="num">' + esc(full) + '</b> deposit.' : "Your Blueprint waives the deposit.") + '</p>';
    }
    var r = f.ready || {};
    var word = READY_WORD[r.status];
    var when = r.status === "done" ? shortDay(r.done_at) : shortDay(r.requested_at);
    var pill = word ? '<p class="fp-state"><span class="fp-pill">' + esc(word) + '</span>' + (when ? '<span class="caption">' + esc(when) + '</span>' : "") + '</p>' : "";
    var canPress = !r.status || r.status === "none" || r.status === "done";
    body += pill + (canPress
      ? '<div class="fp-acts"><button class="' + (opts.quiet ? "fp-btn-line" : "fp-btn-primary") + '" type="button" data-act="fp-ready">I\'m ready to get funded</button></div>'
      : "");
    var c = f.financing || {};
    if (c.plans_open > 0) {
      body += '<p class="fp-line">Your payment plan' + (money(c.left_cents) ? ': <b class="num">' + esc(money(c.left_cents)) + ' left</b>' : " is open") + '</p>' +
        '<a class="fp-link" href="' + esc(withClient(c.payments_url || "/app/financeos.html#payments", opts.clientId)) + '">See payments</a>';
    } else if (c.blueprint_owned === false && c.offer) {
      body += '<p class="fp-line">' + esc(c.offer) + ': pay over time with ' + esc(c.provider || "ClarityPay") + '</p>' +
        (c.book_url ? '<a class="fp-link" href="' + esc(c.book_url) + '" target="_blank" rel="noopener">Book a call</a>' : "");
    }
    return open + body + msgSlot() + '</div>';
  }

  /** The card. p = the read's `paths`; opts = { clientId, quiet }. "" when the read carried none. */
  function renderCard(p, opts) {
    opts = opts || {};
    if (!p) return "";
    var open = '<section class="card fp-card" aria-labelledby="fp-title"><h2 class="fp-title" id="fp-title">Your funding paths</h2>';
    if (p.ok !== true) {
      return open + '<p class="caption">We could not load your funding paths.</p>' +
        '<button class="fp-btn-line" type="button" data-act="retry">Try again</button></section>';
    }
    var o = { clientId: opts.clientId || "", quiet: opts.quiet === true, viewer: p.viewer === "staff" ? "staff" : "client" };
    return open + '<div class="fp-paths">' + renderSelf(p.self, o) + renderOthers(p.others, o) + renderFundhub(p.fundhub, o) + '</div></section>';
  }

  /* ── browser only ──────────────────────────────────────────────────────── */

  function token() {
    try { return root.localStorage.getItem("fh_token") || ""; } catch (e) { return ""; }
  }
  /* POST with this page's own sign-in, the way the money pages call. */
  function post(path, body) {
    var demo = root.__fhBlueprintFullDemoRoute === true;
    var headers = { accept: "application/json", "content-type": "application/json" };
    var t = demo ? "" : token();
    if (t) headers.authorization = "Bearer " + t;
    var init = { method: "POST", headers: headers, body: JSON.stringify(body || {}) };
    if (!demo) init.credentials = "same-origin";
    var started;
    try {
      if (demo && typeof root.FHClientFetch !== "function") return Promise.resolve({ status: 503, body: { ok: false, error: "demo_unavailable" } });
      started = demo ? root.FHClientFetch(path, init) : root.fetch(path, init);
    } catch (e) { return Promise.resolve({ status: 0, body: null }); }
    return Promise.resolve(started).then(function (r) {
      return r.json().then(function (b) { return { status: r.status, body: b }; }, function () { return { status: r.status, body: null }; });
    }, function () { return { status: 0, body: null }; });
  }

  function pathOf(t) { return t && t.closest ? t.closest("[data-fp-path]") : null; }
  function say(t, words) {
    var box = pathOf(t);
    var slot = box ? box.querySelector('[data-slot="fp-msg"]') : null;
    if (!slot) return;
    slot.textContent = words || "";
    slot.hidden = !words;
  }
  function kindOf(res) {
    if (!res || res.status === 0) return "offline";
    if (res.status === 401) return "signin";
    if (res.status === 403) return "forbidden";
    return "";
  }

  /**
   * act(button, name, ctx) — one press. ctx = { data, send(path, body)?,
   * clientId, repaint() }. data is the Fundability read; its `paths` is
   * updated from the answer and the section repaints.
   */
  function act(t, name, ctx) {
    var data = ctx && ctx.data;
    if (!data || !data.paths) return;
    if (name === "fp-copy") {
      var url = t.getAttribute("data-url") || "";
      var clip = root.navigator && root.navigator.clipboard;
      if (!clip || typeof clip.writeText !== "function") { say(t, "Press and hold the link to copy it."); return; }
      clip.writeText(url).then(function () {
        t.textContent = "Copied";
        say(t, "");
        if (root.setTimeout) root.setTimeout(function () { t.textContent = "Copy link"; }, 2000);
      }, function () { say(t, "Press and hold the link to copy it."); });
      return;
    }
    var send = typeof ctx.send === "function" ? ctx.send : post;
    var label = t.textContent;
    t.disabled = true;
    t.textContent = name === "fp-join" ? "Getting your link…" : "Sending…";
    say(t, "");
    var body = {};
    if (name === "fp-ready" && ctx.clientId) body.client_id = ctx.clientId;
    send(name === "fp-join" ? REFER_PATH : READY_PATH, body).then(function (res) {
      var b = res && res.body;
      if (res && res.status === 200 && b && b.ok === true) {
        if (name === "fp-join" && data.paths.others && data.paths.others.affiliate) {
          data.paths.others.affiliate.enrolled = true;
          data.paths.others.affiliate.share_url = b.shareUrl || null;
        }
        if (name === "fp-ready" && data.paths.fundhub) {
          data.paths.fundhub.ready = { status: b.status, requested_at: b.requested_at || null, done_at: b.done_at || null };
        }
        ctx.repaint();
        return;
      }
      t.disabled = false;
      t.textContent = label;
      say(t, FAIL[kindOf(res)] || (b && b.message) || "That did not go through. Try again.");
    });
  }

  root.FHFundingPaths = {
    renderCard: renderCard, renderSelf: renderSelf, renderOthers: renderOthers, renderFundhub: renderFundhub,
    money: money, withClient: withClient,
    handles: function (name) { return ACTS[name] === true; }, act: act
  };
})(typeof window !== "undefined" ? window : globalThis);
