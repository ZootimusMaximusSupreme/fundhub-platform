/* Declines — the staff block inside the client control panel's Capital
 * Blueprint group (#bp-group → #bp-declines). Blueprint launch unit B1.
 *
 * One place for decline defense on a client's file: record a bank's decline
 * (with the letter), read the likely reasons with the words from the letter and
 * the source of each, work the reconsideration plan step by step, write the
 * blanks no source covers, set the call date, and record the outcome.
 *
 * Reads GET /api/blueprint/declines?client_id= (body.staff) and posts to
 * POST /api/blueprint/declines — field names are the handler's own
 * (api/blueprint/declines.mjs). A letter file goes up through the existing
 * POST /api/documents-upload (subtype decline_letter), then action link_letter.
 *
 * The server stays the authority: it answers 403 not_blueprint_buyer for a
 * client who did not buy the Blueprint, and lender-book lines only reach
 * ROLE_SETS.LENDERS (owner / admin / funding advisor). This block says both in
 * words.
 *
 * A separate file, not more lines in client-control-panel.html, so the block's
 * logic is testable in Node (src/http/ccp-declines-screen.test.mjs runs the
 * render functions) and the panel only carries one container and one tag.
 * Text sizes come from classes the panel already sizes (.fact-note, .fact-row,
 * .kv-label, .rep-label, .card-title, .chip) — no px font sizes (§12.7).
 */
(function (root) {
  "use strict";

  var API = "/api/blueprint/declines";
  var UPLOAD = "/api/documents-upload";
  var MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  var WHO = { agent: "Agent", ops: "Ops", client: "Client" };
  var KIND = { notion: "Notion playbook page", repo: "Fundhub repo", book: "Lender book", letter: "The bank's letter", owner: "Owner call" };
  var BUREAU = { experian: "Experian", equifax: "Equifax", transunion: "TransUnion" };
  var OUTCOME_CHOICES = [
    ["open", "Still working it"],
    ["approved_on_recon", "Approved on reconsideration"],
    ["still_declined", "Still declined"],
    ["reapply_later", "Re-apply later"]
  ];

  function esc(v) {
    return String(v == null ? "" : v)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
  function list(v) { return Array.isArray(v) ? v : []; }
  function day(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ""));
    return m ? MONTHS[Number(m[2]) - 1] + " " + Number(m[3]) + ", " + m[1] : "";
  }
  function what(bank, product) {
    return [bank, product].filter(function (x) { return x; }).join(" · ") || "A bank";
  }
  /* A line citing sources of different kinds already names each kind
     (src/blueprint/decline-analyze.mjs sourceRefText); one kind is named once. */
  var MIXED = /^(?:Notion page|Repo|Lender book|Letter|Owner call): /;
  function sourceLine(kind, ref) {
    if (!ref) return "";
    var label = !MIXED.test(ref) && KIND[kind] ? " (" + esc(KIND[kind]) + ")" : "";
    return '<p class="fact-note dec-src">Source: ' + esc(ref) + label + "</p>";
  }
  function sourcesLine(sources) {
    var s = list(sources);
    if (!s.length) return "";
    return '<p class="fact-note dec-src">Source: ' + s.map(function (x) {
      return esc(x.ref) + (KIND[x.kind] ? " (" + esc(KIND[x.kind]) + ")" : "");
    }).join(" + ") + "</p>";
  }
  function stepState(status) {
    if (status === "done") return { mark: "✓", word: "Done", cls: "is-done" };
    if (status === "skipped") return { mark: "–", word: "Skipped", cls: "is-skip" };
    return { mark: "○", word: "Not done", cls: "is-open" };
  }

  /* ── one step ─────────────────────────────────────────────────────────── */
  function renderStep(d, s) {
    var st = stepState(s.status);
    var id = "dec-fill-" + esc(d.id) + "-" + esc(String(s.key).replace(/[^a-z0-9_-]/gi, "-"));
    var head = '<div class="dec-step-head"><span class="dec-mark" aria-hidden="true">' + st.mark + '</span>' +
      '<span class="chip">' + esc(WHO[s.who] || s.who) + '</span><span class="dec-step-word">' + st.word + '</span></div>';
    var body = s.blank
      ? '<p class="dec-step-text dec-blank-label"><b>Blank — no source covers this.</b> ' + esc(s.blank_label) + '</p>'
      : '<p class="dec-step-text">' + esc(s.text) + '</p>' + sourceLine(s.source_kind, s.source_ref);
    var filled = s.filled_text ? '<p class="fact-note dec-filled">' + (s.blank ? "Written: " : "Note: ") + esc(s.filled_text) + '</p>' : "";
    var acts;
    if (s.status === "open") {
      acts = s.blank
        ? '<label class="rep-label" for="' + id + '">Write it here</label><textarea id="' + id + '" class="rep-field dec-fill" rows="3" data-fill="' + esc(s.key) + '"></textarea>' +
          '<div class="dec-acts"><button type="button" class="link-btn" data-act="step" data-step="' + esc(s.key) + '" data-status="done">Save and mark done</button>' +
          '<button type="button" class="link-btn" data-act="step" data-step="' + esc(s.key) + '" data-status="skipped">Skip</button></div>'
        : '<div class="dec-acts"><button type="button" class="link-btn" data-act="step" data-step="' + esc(s.key) + '" data-status="done">Done</button>' +
          '<button type="button" class="link-btn" data-act="step" data-step="' + esc(s.key) + '" data-status="skipped">Skip</button></div>';
    } else {
      acts = '<div class="dec-acts"><button type="button" class="link-btn" data-act="step" data-step="' + esc(s.key) + '" data-status="open">Open again</button></div>';
    }
    return '<li class="dec-step ' + st.cls + (s.blank ? " is-blank" : "") + '">' + head + body + filled + acts + '</li>';
  }

  /* ── one decline ──────────────────────────────────────────────────────── */
  function renderDecline(d, opts) {
    opts = opts || {};
    var steps = list(d.steps);
    var done = steps.filter(function (s) { return s.status !== "open"; }).length;
    var facts = [
      ["Declined", d.declined_on ? day(d.declined_on) : "Date not given"],
      ["Bureau", list(d.bureaus_pulled).map(function (b) { return BUREAU[b] || b; }).join(", ") || "Not given"],
      ["Recorded", d.source === "client_paste" ? "Client pasted the letter" : "Staff recorded it" + (d.recorded_by ? " (" + d.recorded_by + ")" : "")],
      ["Reads as", d.looks_like_words || "—"]
    ];
    var reasons = list(d.reasons).length
      ? '<ul class="dec-list">' + list(d.reasons).map(function (r) {
        return '<li><b>' + esc(r.label) + '</b><p class="fact-note">Letter: “' + esc(r.evidence_quote) + '”</p>' + sourcesLine(r.sources) + '</li>';
      }).join("") + '</ul>'
      : '<p class="fact-note">No reason found in the letter yet.</p>';
    var person = d.needs_person
      ? '<div class="dec-person"><p class="fact-note is-stop">Needs a person to read.</p><p class="fact-note">' + esc(d.needs_person_why) + '</p>' +
        (list(d.unknown_parts).length ? '<ul class="dec-list">' + list(d.unknown_parts).map(function (p) { return '<li class="fact-note">“' + esc(p) + '”</li>'; }).join("") + '</ul>' : "") + '</div>'
      : "";
    var lines = [];
    list(d.letter_phones).forEach(function (p) { lines.push('<p class="fact-note">Letter: <b>' + esc(p.number) + '</b> — “' + esc(p.said) + '”</p>'); });
    if (d.book) {
      list(d.book.phones).forEach(function (p) { lines.push('<p class="fact-note">Lender book: <b>' + esc(p.number) + '</b> — “' + esc(p.said) + '”</p>'); });
      if (!list(d.book.phones).length) lines.push('<p class="fact-note">No phone number for this bank in the lender book' + (d.book.rows_found ? "" : " (no book row matched this bank's name)") + '.</p>');
    } else {
      lines.push('<p class="fact-note">Lender-book lines are for the funding advisor.</p>');
    }
    if (!list(d.letter_phones).length && !(d.book && list(d.book.phones).length)) {
      lines.push('<p class="fact-note">No number on file. Look it up: Calling DENIED, Step 2 (Notion playbook page).</p>');
    }
    if (d.rm_on_file) lines.push('<p class="fact-note">A relationship manager is on file for this bank (docs/legacy-strong/bankers-rms.md).</p>');
    var book = d.book && list(d.book.notes).length
      ? '<div class="kv-label">From the lender book</div><ul class="dec-list">' + list(d.book.notes).map(function (n) {
        return '<li class="fact-note">' + esc(n.text) + '</li>';
      }).join("") + '</ul>' +
        (d.book.relationship_required || d.book.requires_account_opening ? '<p class="fact-note">The book says this bank wants an existing account or relationship.</p>' : "")
      : "";
    var t = d.timing || {};
    var timing = [t.call, t.retries, t.second_no].filter(Boolean).concat(list(t.letter)).concat(list(t.reapply)).map(function (x) {
      return '<li><span>' + esc(x.text) + '</span>' + sourcesLine(x.sources) + '</li>';
    }).join("");
    var idp = "dec-" + esc(d.id);
    var outcomeOpts = OUTCOME_CHOICES.map(function (o) {
      return '<option value="' + o[0] + '"' + (d.outcome === o[0] ? " selected" : "") + '>' + o[1] + '</option>';
    }).join("");
    return '<details class="more dec-item" data-decline="' + esc(d.id) + '"' + (opts.open ? " open" : "") + '>' +
      '<summary><span class="dec-sum-name">' + esc(what(d.bank, d.product)) + '</span>' +
      '<span class="dec-sum-state">' + esc(d.outcome_words) + ' · ' + done + ' of ' + steps.length + ' steps done <span class="arrow">⌄</span></span></summary>' +
      '<div class="more-body">' +
      '<div class="facts-list">' + facts.map(function (f) { return '<div class="fact-row"><span class="k">' + esc(f[0]) + '</span><span class="v">' + esc(f[1]) + '</span></div>'; }).join("") + '</div>' +
      '<div class="kv-label">Likely reasons</div>' + reasons + person +
      '<div class="kv-label">Bank line</div><div class="dec-bankline">' + lines.join("") + '</div>' + book +
      '<div class="kv-label">Plan</div><p class="fact-note">Agent steps sit on the ops task until the money agent takes them.</p>' +
      '<ol class="dec-steps">' + steps.map(function (s) { return renderStep(d, s); }).join("") + '</ol>' +
      (timing ? '<div class="kv-label">Timing</div><ul class="dec-list">' + timing + '</ul>' : "") +
      '<div class="kv-label">Call date</div>' +
      '<p class="fact-note">' + (d.recon_on ? "Call on " + esc(day(d.recon_on)) + "." : "No call date set. Staff pick it — nothing here picks a day.") + '</p>' +
      '<label class="rep-label" for="' + idp + '-recon">Call date</label>' +
      '<input type="date" id="' + idp + '-recon" class="rep-field" data-field="recon" value="' + esc(d.recon_on || "") + '">' +
      '<button type="button" class="link-btn" data-act="schedule">Save call date</button>' +
      '<div class="kv-label">Outcome</div>' +
      '<p class="consent-state">' + esc(d.outcome_words) + (d.outcome_approved_amount ? " — $" + esc(Number(d.outcome_approved_amount).toLocaleString("en-US")) : "") +
      (d.reapply_on ? " — re-apply on " + esc(day(d.reapply_on)) : "") + '</p>' +
      '<label class="rep-label" for="' + idp + '-out">What the bank said</label>' +
      '<select id="' + idp + '-out" class="rep-field" data-field="outcome">' + outcomeOpts + '</select>' +
      '<label class="rep-label" for="' + idp + '-amt">Approved amount (optional — blank means not told yet)</label>' +
      '<input type="text" inputmode="decimal" id="' + idp + '-amt" class="rep-field" data-field="amount" autocomplete="off">' +
      '<label class="rep-label" for="' + idp + '-re">Re-apply date (for re-apply later)</label>' +
      '<input type="date" id="' + idp + '-re" class="rep-field" data-field="reapply" value="' + esc(d.reapply_on || "") + '">' +
      '<label class="rep-label" for="' + idp + '-notes">Notes (optional)</label>' +
      '<textarea id="' + idp + '-notes" class="rep-field" rows="2" data-field="notes"></textarea>' +
      '<button type="button" class="action-btn" data-act="outcome"><span>Save outcome</span></button>' +
      (d.next_sequence_note ? '<p class="fact-note">Note for the next funding sequence: ' + esc(d.next_sequence_note) + ' It does not set that date.</p>' : "") +
      '<div class="kv-label">Letter</div>' +
      (d.letter_text ? '<details class="more"><summary>Show the letter text <span class="arrow">⌄</span></summary><div class="more-body"><p class="fact-note dec-letter">' + esc(d.letter_text) + '</p></div></details>' : '<p class="fact-note">No letter text yet.</p>') +
      '<p class="fact-note">' + (d.letter_document_id ? "A letter file is on record." : "No letter file yet.") + '</p>' +
      '<label class="rep-label" for="' + idp + '-file">Add the letter file (photo or PDF)</label>' +
      '<input type="file" id="' + idp + '-file" class="rep-field" data-field="file" accept="image/*,application/pdf">' +
      '<button type="button" class="link-btn" data-act="upload">Upload letter</button>' +
      '<p class="portal-link-sent" role="status" aria-live="polite" data-slot="status"></p>' +
      '</div></details>';
  }

  /* ── the record form ──────────────────────────────────────────────────── */
  function renderForm(s) {
    var apps = list(s.applications).filter(function (a) { return !a.decline_id && a.status !== "Approved"; });
    var opts = apps.map(function (a) {
      return '<option value="' + esc(a.id) + '" data-bank="' + esc(a.bank || "") + '" data-product="' + esc(a.product || "") + '">' +
        esc(what(a.bank, a.product)) + (a.status ? " — " + esc(a.status) : "") + '</option>';
    }).join("");
    var emails = list(s.bank_emails).length
      ? '<div class="kv-label">Bank emails that read like a decline</div><ul class="dec-list">' + list(s.bank_emails).map(function (e, i) {
        return '<li><p class="fact-note"><b>' + esc(e.subject || "No subject") + '</b> — ' + esc(e.preview || "") + '</p>' +
          '<button type="button" class="link-btn" data-act="use-email" data-email="' + i + '">Use this email</button></li>';
      }).join("") + '</ul>'
      : "";
    return '<details class="more dec-new" id="bp-dec-new"' + (list(s.declines).length ? "" : " open") + '><summary>Record a decline <span class="arrow">⌄</span></summary><div class="more-body">' +
      '<label class="rep-label" for="bp-dec-app">Application</label>' +
      '<select id="bp-dec-app" class="rep-field" data-field="app"><option value="">Not in the list</option>' + opts + '</select>' +
      '<label class="rep-label" for="bp-dec-bank">Bank</label>' +
      '<input type="text" id="bp-dec-bank" class="rep-field" data-field="bank" maxlength="120" autocomplete="off">' +
      '<label class="rep-label" for="bp-dec-product">Product (optional)</label>' +
      '<input type="text" id="bp-dec-product" class="rep-field" data-field="product" maxlength="160" autocomplete="off">' +
      '<label class="rep-label" for="bp-dec-date">Date declined (optional)</label>' +
      '<input type="date" id="bp-dec-date" class="rep-field" data-field="date">' +
      '<fieldset class="dec-bureaus"><legend class="rep-label">Bureau pulled (optional — the letter often names it)</legend>' +
      ['experian', 'equifax', 'transunion'].map(function (b) {
        return '<label class="dec-check"><input type="checkbox" data-bureau="' + b + '"> ' + BUREAU[b] + '</label>';
      }).join("") + '</fieldset>' +
      '<label class="rep-label" for="bp-dec-text">The bank\'s letter or email (paste it)</label>' +
      '<textarea id="bp-dec-text" class="rep-field" rows="6" maxlength="20000" data-field="text"></textarea>' +
      '<p class="fact-note">Long numbers like a Social Security number are hidden before it is saved.</p>' +
      '<button type="button" class="action-btn" data-act="record"><span>Record decline and build the plan</span></button>' +
      '<p class="portal-link-sent" role="status" aria-live="polite" data-slot="form-status"></p>' +
      emails + '</div></details>';
  }

  /* ── the four states ──────────────────────────────────────────────────── */
  function renderLoading() { return '<p class="fact-note" aria-busy="true">Loading declines…</p>'; }

  function renderError(message) {
    return '<p class="fact-note is-stop" role="alert">Declines did not load. ' + esc(message) + '</p>' +
      '<button type="button" class="link-btn" data-act="retry">Try again</button>';
  }

  function renderNoClient() { return '<p class="fact-note">Open a client file first.</p>'; }

  function render(s, opts) {
    opts = opts || {};
    var declines = list(s.declines);
    var open = declines.filter(function (d) { return d.outcome === "open"; }).length;
    var head = declines.length
      ? '<p class="consent-state">' + declines.length + (declines.length === 1 ? " decline" : " declines") + " on this file · " + open + " open.</p>"
      : '<p class="consent-state">No declines on this file. When a bank says no, record it here or the client pastes the letter in FinanceOS.</p>';
    var lock = s.eligible === false
      ? '<p class="fact-note is-stop">This client has not paid for the Capital Blueprint, so recording a decline is not available for them.</p>'
      : "";
    var notes = list(s.next_sequence_notes).length
      ? '<p class="fact-note">Notes for the next funding sequence: ' + list(s.next_sequence_notes).map(esc).join(" ") + '</p>'
      : "";
    return (opts.flash ? '<p class="portal-link-sent" role="status">' + esc(opts.flash) + '</p>' : "") +
      head + lock + notes +
      declines.map(function (d, i) { return renderDecline(d, { open: opts.openId ? opts.openId === d.id : i === 0 && d.outcome === "open" }); }).join("") +
      (s.eligible === false ? "" : renderForm(s));
  }

  /* What went wrong, in the words of the person at the desk. Never a code. */
  function problem(res) {
    var b = res.body || {};
    if (res.transport || res.status === 0) return "Could not reach the server. Check your connection and try again.";
    if (res.status === 401) return "You are signed out. Sign in and open this page again.";
    if (b.error === "not_blueprint_buyer") return "This client has not paid for the Capital Blueprint, so this is not available for them.";
    if (b.message) return b.message;
    if (res.status === 404) return "That was not found on this client's file. Reload the page.";
    if (res.status === 403) return "Your account is not allowed to do that.";
    if (res.status === 503) return "The database is not reachable right now. Try again in a moment.";
    return "That did not work. Try again in a moment.";
  }

  /* ── browser only ─────────────────────────────────────────────────────── */
  function clientIdFromUrl() {
    try {
      var p = new URLSearchParams(root.location.search);
      return p.get("id") || p.get("client_id") || p.get("client") || p.get("contact") || "";
    } catch (e) { return ""; }
  }
  function authHeaders() {
    var headers = { accept: "application/json" };
    try {
      var t = root.localStorage.getItem("fh_token") || "";
      if (t && t !== "demo" && t !== "demo-token") headers.authorization = "Bearer " + t;
    } catch (e) {}
    return headers;
  }
  function api(method, path, body) {
    var headers = authHeaders();
    var init = { method: method, headers: headers, credentials: "same-origin" };
    if (body !== undefined) {
      headers["content-type"] = "application/json";
      init.body = JSON.stringify(body);
    }
    return root.fetch(path, init).then(
      function (r) {
        return r.json().then(function (b) { return { status: r.status, body: b }; },
          function () { return { status: r.status, body: null }; });
      },
      function () { return { status: 0, body: null, transport: true }; }
    );
  }
  function ok(res) { return res.status >= 200 && res.status < 300 && res.body && res.body.ok === true; }

  function init() {
    var el = root.document.getElementById("bp-declines-root");
    if (!el) return;
    var cid = clientIdFromUrl();
    if (!cid) { el.innerHTML = renderNoClient(); return; }
    var data = null;

    function paint(html) { el.innerHTML = html; }
    function load(opts) {
      if (!data) paint(renderLoading());
      return api("GET", API + "?client_id=" + encodeURIComponent(cid)).then(function (res) {
        if (!ok(res) || !res.body.staff) { data = null; paint(renderError(problem(res))); return; }
        data = res.body.staff;
        paint(render(data, opts));
      });
    }
    function itemOf(node) { return node && node.closest ? node.closest("[data-decline]") : null; }
    function field(scope, name) { return scope ? scope.querySelector('[data-field="' + name + '"]') : null; }
    function busy(btn, on, label) {
      if (!btn) return;
      btn.disabled = on;
      if (label) { var span = btn.querySelector("span"); (span || btn).textContent = label; }
    }

    function act(action, fields) {
      var body = { action: action, client_id: cid };
      for (var k in fields) if (Object.prototype.hasOwnProperty.call(fields, k)) body[k] = fields[k];
      return api("POST", API, body);
    }

    function onRecord(btn) {
      var form = root.document.getElementById("bp-dec-new");
      var status = form && form.querySelector('[data-slot="form-status"]');
      var app = field(form, "app"), bank = field(form, "bank");
      var text = field(form, "text");
      var bureaus = [].slice.call(form.querySelectorAll("[data-bureau]")).filter(function (c) { return c.checked; })
        .map(function (c) { return c.getAttribute("data-bureau"); });
      if (!app.value && !bank.value.trim()) { status.textContent = "Pick the application, or type the bank's name."; bank.focus(); return; }
      busy(btn, true, "Recording…");
      status.textContent = "";
      act("record", {
        application_id: app.value || null,
        bank: bank.value.trim() || null,
        product: field(form, "product").value.trim() || null,
        declined_on: field(form, "date").value || null,
        bureaus_pulled: bureaus,
        text: text.value
      }).then(function (res) {
        busy(btn, false, "Record decline and build the plan");
        if (!ok(res)) { status.textContent = problem(res); return; }
        var d = res.body.decline;
        var flash = res.body.duplicate
          ? "This decline is already on the file. Nothing new was added."
          : "Recorded. The plan is built" + (res.body.task_created ? " and the ops task is on the funding advisor's queue." : ".");
        load({ flash: flash, openId: d && d.id });
      });
    }

    function onStep(btn) {
      var item = itemOf(btn);
      var key = btn.getAttribute("data-step");
      var next = btn.getAttribute("data-status");
      var box = item.querySelector('[data-fill="' + key + '"]');
      var status = item.querySelector('[data-slot="status"]');
      if (box && next === "done" && !box.value.trim()) { status.textContent = "Write what goes in this blank first."; box.focus(); return; }
      busy(btn, true);
      act("step", { decline_id: item.getAttribute("data-decline"), step_key: key, status: next, filled_text: box ? box.value.trim() || null : null })
        .then(function (res) {
          if (!ok(res)) { busy(btn, false); status.textContent = problem(res); return; }
          load({ openId: item.getAttribute("data-decline") });
        });
    }

    function onSchedule(btn) {
      var item = itemOf(btn);
      var status = item.querySelector('[data-slot="status"]');
      busy(btn, true);
      act("schedule", { decline_id: item.getAttribute("data-decline"), recon_on: field(item, "recon").value || null }).then(function (res) {
        busy(btn, false);
        if (!ok(res)) { status.textContent = problem(res); return; }
        load({ flash: res.body.recon_on ? "Call date saved. The ops task's due date moved with it." : "Call date cleared.", openId: item.getAttribute("data-decline") });
      });
    }

    function onOutcome(btn) {
      var item = itemOf(btn);
      var status = item.querySelector('[data-slot="status"]');
      var outcome = field(item, "outcome").value;
      var reapply = field(item, "reapply").value;
      if (outcome === "reapply_later" && !reapply) { status.textContent = "Pick the day to apply again."; field(item, "reapply").focus(); return; }
      busy(btn, true, "Saving…");
      act("outcome", {
        decline_id: item.getAttribute("data-decline"),
        outcome: outcome,
        approved_amount: field(item, "amount").value.trim() || null,
        reapply_on: reapply || null,
        notes: field(item, "notes").value.trim() || null
      }).then(function (res) {
        busy(btn, false, "Save outcome");
        if (!ok(res)) { status.textContent = problem(res); return; }
        load({ flash: "Outcome saved: " + res.body.outcome_words + "." + (res.body.application_status ? " The application now says " + res.body.application_status + "." : ""), openId: item.getAttribute("data-decline") });
      });
    }

    function onUpload(btn) {
      var item = itemOf(btn);
      var status = item.querySelector('[data-slot="status"]');
      var input = field(item, "file");
      var file = input && input.files && input.files[0];
      if (!file) { status.textContent = "Pick the letter file first."; return; }
      busy(btn, true);
      status.textContent = "Sending…";
      var form = new root.FormData();
      form.append("client_id", cid);
      form.append("kind", "client_upload");
      form.append("subtype", "decline_letter");
      form.append("file", file, file.name);
      root.fetch(UPLOAD, { method: "POST", headers: authHeaders(), body: form, credentials: "same-origin" })
        .then(function (r) { return r.json().then(function (b) { return { status: r.status, body: b }; }, function () { return { status: r.status, body: null }; }); },
          function () { return { status: 0, body: null, transport: true }; })
        .then(function (res) {
          var doc = res.body && res.body.documents && res.body.documents[0];
          if (!ok(res) || !doc || !doc.id) { busy(btn, false); status.textContent = problem(res); return null; }
          return act("link_letter", { decline_id: item.getAttribute("data-decline"), document_id: doc.id }).then(function (linked) {
            busy(btn, false);
            if (!ok(linked)) { status.textContent = problem(linked); return; }
            load({ flash: "Letter file saved on the decline.", openId: item.getAttribute("data-decline") });
          });
        });
    }

    function onUseEmail(btn) {
      var e = data && list(data.bank_emails)[Number(btn.getAttribute("data-email"))];
      var form = root.document.getElementById("bp-dec-new");
      if (!e || !form) return;
      var text = field(form, "text");
      text.value = [e.subject, e.preview].filter(Boolean).join("\n\n");
      form.open = true;
      text.focus();
    }

    el.addEventListener("click", function (ev) {
      var t = ev.target && ev.target.closest ? ev.target.closest("[data-act]") : null;
      if (!t || !el.contains(t) || t.disabled) return;
      var a = t.getAttribute("data-act");
      if (a === "retry") load();
      else if (a === "record") onRecord(t);
      else if (a === "step") onStep(t);
      else if (a === "schedule") onSchedule(t);
      else if (a === "outcome") onOutcome(t);
      else if (a === "upload") onUpload(t);
      else if (a === "use-email") onUseEmail(t);
    });
    el.addEventListener("change", function (ev) {
      var t = ev.target;
      if (!t || !t.getAttribute || t.getAttribute("data-field") !== "app") return;
      var opt = t.options[t.selectedIndex];
      var form = root.document.getElementById("bp-dec-new");
      if (opt && opt.value) {
        field(form, "bank").value = opt.getAttribute("data-bank") || "";
        field(form, "product").value = opt.getAttribute("data-product") || "";
      }
    });
    load();
  }

  root.FHCcpDeclines = {
    render: render, renderDecline: renderDecline, renderStep: renderStep, renderForm: renderForm,
    renderLoading: renderLoading, renderError: renderError, renderNoClient: renderNoClient,
    problem: problem, stepState: stepState, day: day
  };

  if (root.document && root.document.getElementById) {
    if (root.document.readyState === "loading") root.document.addEventListener("DOMContentLoaded", init);
    else init();
  }
})(typeof window !== "undefined" ? window : globalThis);
