/* Your funding papers — the application document vault screen
 * (/app/money-vault.html, Capital Blueprint launch unit B3).
 *
 * Offer line (docs/finance/capital-blueprint-next-2026-09-29.md): "The agent
 * collects bank statements, tax returns and ID ahead of time, so the file is
 * complete when the closer calls." This is where the client sends those papers
 * and sees what is still missing, and where staff check each file.
 *
 * ONE READ, TWO WRITES. GET /api/money/vault (the shape is
 * docs/finance/document-vault.md — this file builds to it exactly).
 *   - A client uploads through the EXISTING endpoint, POST /api/documents-upload
 *     (multipart), with the exact fields each line carries in
 *     item.upload.fields: kind, subtype, and entity_id for a paper that belongs
 *     to one business. Staff uploading for a client add client_id.
 *   - Staff (owner, admin, sales manager — the FINANCE gate on the endpoint) also
 *     POST /api/money/vault { action: accept | reject | add_item }. Every answer
 *     carries the fresh vault, and the screen repaints from it.
 *
 * THE HONESTY RULES
 *   - Every line, status, count and date is a field from the server. Nothing
 *     here invents a paper, a deadline or a size limit.
 *   - "Ready" means accepted or waived — the same test the closer reads. A file
 *     that was sent but not checked is "we're checking", never "ready".
 *   - Status is a word and a shape, never colour alone (UI-STANDARDS §12.6).
 *   - Staff controls render only when a client id was passed AND the server says
 *     the viewer is staff. The server is still the gate: a client POST is a 403.
 *   - A client never sees which staff member decided, or where a rule came from
 *     (the server leaves both out of a client read).
 *
 * Every render function returns an HTML string and touches no DOM, so
 * src/http/money-vault-screen.test.mjs runs them in Node. mount() and initPage()
 * are the only parts that need a browser. This file is the section
 * window.FinanceOS.sections.vault; money-vault.html is a thin shell.
 * Styles: money-vault.css, every rule under .fh-vault.
 */
(function (root) {
  "use strict";

  var API = "/api/money/vault";
  var UPLOAD = "/api/documents-upload";
  /* What the upload endpoint keeps: src/documents/upload-validate.mjs sniffs the
     bytes and takes only PDF, JPG and PNG. */
  var FILE_ACCEPT = "application/pdf,image/jpeg,image/png,.pdf,.jpg,.jpeg,.png";
  var FILE_HINT = "PDF, JPG or PNG";
  var MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  /* File types staff may give a paper they add. Only types no standard line
     already counts, so an added line never counts the same file twice. The
     doc names these two as staff-addable (business license, pay stubs / W-2);
     anything else is "other" and staff file each upload. */
  var ADD_SUBTYPES = [["", "Other — you file each upload"], ["business_license", "Business license"], ["proof_of_income", "Pay stubs or W-2"]];

  /* ── small helpers ─────────────────────────────────────────────────────── */

  function esc(v) {
    return String(v == null ? "" : v)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
  function list(v) { return Array.isArray(v) ? v : []; }
  function whole(v) { var n = Number(v); return isFinite(n) && n > 0 ? Math.floor(n) : 0; }
  function plural(n, one, many) { return n + " " + (n === 1 ? one : many); }

  /* "2026-10-31" → "Oct 31, 2026", read off the calendar date as written. */
  function day(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ""));
    if (!m) return "";
    return MONTHS[Number(m[2]) - 1] + " " + Number(m[3]) + ", " + m[1];
  }

  /* An upload time. Under a day it is relative ("3 hours ago"), after that the
     date (UI-STANDARDS §7). `now` is the server's as_of, so the words match
     the read they came with. */
  function when(iso, nowIso) {
    var t = Date.parse(iso || "");
    if (!isFinite(t)) return "";
    var n = Date.parse(nowIso || "");
    if (!isFinite(n)) n = Date.now();
    var mins = Math.floor((n - t) / 60000);
    if (mins >= 0 && mins < 1) return "just now";
    if (mins >= 0 && mins < 60) return mins + " min ago";
    if (mins >= 0 && mins < 1440) return plural(Math.floor(mins / 60), "hour", "hours") + " ago";
    var d = new Date(t);
    var same = d.getFullYear() === new Date(n).getFullYear();
    return MONTHS[d.getMonth()] + " " + d.getDate() + (same ? "" : ", " + d.getFullYear());
  }

  /* The exact time, for the tooltip. */
  function exact(iso) {
    var t = Date.parse(iso || "");
    if (!isFinite(t)) return "";
    var d = new Date(t);
    var h = d.getHours();
    var mm = String(d.getMinutes());
    if (mm.length < 2) mm = "0" + mm;
    return MONTHS[d.getMonth()] + " " + d.getDate() + ", " + d.getFullYear() + ", " +
      ((h % 12) || 12) + ":" + mm + " " + (h < 12 ? "AM" : "PM");
  }

  function units(unit, n) {
    if (unit === "month") return plural(n, "month", "months");
    if (unit === "year") return plural(n, "year", "years");
    return plural(n, "file", "files");
  }

  /* ── what a line means ─────────────────────────────────────────────────── */

  var MARKS = {
    missing: { mark: "○", cls: "is-missing" },
    uploaded: { mark: "…", cls: "is-checking" },
    accepted: { mark: "✓", cls: "is-done" },
    expired: { mark: "↻", cls: "is-old" },
    rejected: { mark: "✗", cls: "is-redo" },
    waived: { mark: "–", cls: "is-waived" }
  };
  var CLIENT_WORDS = {
    missing: "Missing", uploaded: "Sent — we're checking", accepted: "Accepted",
    expired: "Too old — send a newer one", rejected: "Not accepted — send a new one", waived: "Not needed"
  };
  var STAFF_WORDS = {
    missing: "Missing", uploaded: "Needs your review", accepted: "Accepted",
    expired: "Too old — needs a newer one", rejected: "Not accepted — needs a new one", waived: "Not needed"
  };

  function statusKey(item) { return MARKS[item && item.status] ? item.status : "missing"; }

  /* A line's status: a mark (shape) and words. */
  function statusOf(item, staff) {
    var k = statusKey(item);
    return { key: k, mark: MARKS[k].mark, cls: MARKS[k].cls, word: (staff ? STAFF_WORDS : CLIENT_WORDS)[k] };
  }

  function isDone(item) { var k = statusKey(item); return k === "accepted" || k === "waived"; }
  /* The client has to send something for this line. */
  function needsClient(item) { var k = statusKey(item); return k === "missing" || k === "rejected" || k === "expired"; }
  function multi(item) { return (whole(item && item.need) || 1) > 1; }
  /* The upload button shows when the client owes a file, or on a line that
     takes several files (statements, returns) while one is being checked. */
  function canUpload(item) { return needsClient(item) || (statusKey(item) === "uploaded" && multi(item)); }

  function uploadLabel(item) {
    var k = statusKey(item);
    if (k === "rejected") return "Upload a new copy";
    if (k === "expired") return "Upload a newer one";
    if (k === "uploaded" || whole(item.have) > 0) return "Upload more";
    return "Upload";
  }

  /* Display order inside a group: what the viewer must act on first. A client
     sees what is still missing first; staff see what waits for their review
     first. The server's order (priority) holds inside each rank. */
  function rank(item, staff) {
    if (isDone(item)) return 2;
    if (statusKey(item) === "uploaded") return staff ? 0 : 1;
    return staff ? 1 : 0;
  }

  function sortItems(items, staff) {
    return items.map(function (it, i) { return { it: it, i: i }; })
      .sort(function (a, b) { return (rank(a.it, staff) - rank(b.it, staff)) || (a.i - b.i); })
      .map(function (x) { return x.it; });
  }

  /* Personal first, then one group per business (in the server's order); then
     a group with something for the viewer moves ahead of one that is all done. */
  function groupsOf(v, staff) {
    var groups = [];
    var byKey = {};
    function add(scope) {
      var biz = !!scope && scope.kind === "business";
      var key = biz ? "b:" + (scope.id || "") : "personal";
      if (!byKey[key]) {
        byKey[key] = { key: key, business: biz, id: biz ? (scope.id || null) : null,
          name: biz ? (scope.name || "Your business") : "Personal", items: [] };
        groups.push(byKey[key]);
      }
      return byKey[key];
    }
    add(null);
    list(v && v.scopes).forEach(function (s) { if (s && s.kind === "business") add(s); });
    list(v && v.items).forEach(function (it) { add(it && it.scope && it.scope.kind === "business" ? it.scope : null).items.push(it); });
    var live = groups.filter(function (g) { return g.items.length; });
    live.forEach(function (g) { g.items = sortItems(g.items, staff); });
    return live.map(function (g, i) {
      var best = 2;
      g.items.forEach(function (it) { best = Math.min(best, rank(it, staff)); });
      return { g: g, best: best, i: i };
    }).sort(function (a, b) { return (a.best - b.best) || (a.i - b.i); }).map(function (x) { return x.g; });
  }

  /* The headline numbers, counted from the lines on screen. */
  function tally(v) {
    var t = { total: 0, done: 0, checking: 0, todo: 0 };
    list(v && v.items).forEach(function (it) {
      t.total += 1;
      if (isDone(it)) t.done += 1;
      else if (statusKey(it) === "uploaded") t.checking += 1;
      else t.todo += 1;
    });
    return t;
  }

  /* The sentence the closer reads on a complete file — the same words
     src/finance/document-vault.mjs vaultLine() writes on the closer's task
     (src/http/money-vault-screen.test.mjs holds the two together). */
  function closerLine(v) {
    var s = (v && v.summary) || {};
    var required = Number(s.required || 0);
    var waived = Number(s.waived || 0);
    return "Document vault: file complete — " + required + " of " + required + " items accepted" +
      (waived ? " (" + waived + " waived by staff)" : "") + ".";
  }

  /* Staff controls need both: a client id from the staff desk AND the server
     saying this viewer is staff. */
  function isStaffView(v, clientId) { return !!clientId && !!v && v.audience === "staff"; }

  /* The one filled button on the screen (UI-STANDARDS §1): for a client, the
     upload on the first paper they owe; for staff, Accept on the first file
     waiting for review. Nothing to do → no filled button. */
  function primaryTarget(groups, staff) {
    for (var g = 0; g < groups.length; g++) {
      var items = groups[g].items;
      for (var i = 0; i < items.length; i++) {
        var it = items[i];
        if (!staff && needsClient(it)) return "pick:" + it.slot;
        if (staff) {
          var docs = list(it.documents);
          for (var d = 0; d < docs.length; d++) if (docs[d].status === "uploaded") return "accept:" + docs[d].id;
        }
      }
    }
    return "";
  }

  /* The exact multipart fields for one line (docs/finance/document-vault.md:
     "upload.fields is exact"). Staff add the client they are working on. */
  function uploadFields(item, clientId) {
    var src = item && item.upload && item.upload.fields;
    var out = {};
    if (src && typeof src === "object") {
      Object.keys(src).forEach(function (k) { if (typeof src[k] === "string" && src[k]) out[k] = src[k]; });
    } else if (item) {
      out.kind = "client_upload";
      out.subtype = list(item.subtypes)[0] || "other";
      if (item.scope && item.scope.kind === "business" && item.scope.id) out.entity_id = item.scope.id;
    }
    if (!out.kind) out.kind = "client_upload";
    if (!out.subtype) out.subtype = "other";
    if (clientId) out.client_id = clientId;
    return out;
  }

  /* Only ever our own api: a path the server sent that is not under /api/ is
     ignored. */
  function uploadPath(item) {
    var p = item && item.upload && item.upload.endpoint;
    return typeof p === "string" && /^\/api\/[a-z0-9/_-]+$/i.test(p) ? p : UPLOAD;
  }

  function okFile(f) {
    var type = String((f && f.type) || "").toLowerCase();
    if (type === "application/pdf" || type === "image/jpeg" || type === "image/png") return true;
    return /\.(pdf|jpe?g|png)$/i.test(String((f && f.name) || ""));
  }

  function needsDetails(item) { return !!item && ((multi(item) && item.unit !== "file") || !!item.expires); }

  function coversLabel(item) {
    return item.unit === "year" ? "How many years does this file cover?" : "How many months does this file cover?";
  }
  function dateLabel(item) {
    if (item.key === "bank_statements_business") return "Last day on the statement";
    if (item.key === "certificate_good_standing") return "Date it was issued";
    return "Date on the paper";
  }
  function dateHint(item) {
    var e = item.expires || {};
    var span = e.kind === "months" ? units("month", whole(e.value)) : e.kind === "days" ? plural(whole(e.value), "day", "days") : "";
    return (span ? "It counts for " + span + " after this date. " : "") + "Leave it empty to count from the day it was sent.";
  }

  /* ── pieces ────────────────────────────────────────────────────────────── */

  function flashHtml(ctx, at) {
    var f = ctx.flash;
    if (!f || f.at !== at || !f.text) return "";
    return '<p class="vt-flash' + (f.bad ? " is-bad" : "") + '" role="' + (f.bad ? "alert" : "status") + '">' + esc(f.text) + "</p>";
  }

  function renderHead(staff) {
    return '<div class="vt-head"><div><h1>' + (staff ? "Funding papers" : "Your funding papers") + "</h1>" +
      '<p class="caption">' + esc(staff
        ? "The papers lenders ask this client for. Check each file the client sends."
        : "Lenders ask for these papers. Send them early, so your file is ready when it is time to apply.") +
      "</p></div></div>";
  }

  function firstOwed(groups) {
    for (var g = 0; g < groups.length; g++) {
      for (var i = 0; i < groups[g].items.length; i++) if (needsClient(groups[g].items[i])) return groups[g].items[i];
    }
    return null;
  }

  function renderProgress(v, groups, ctx) {
    var t = tally(v);
    var staff = ctx.staff;
    var pct = function (n) { return t.total ? Math.round((n / t.total) * 1000) / 10 : 0; };
    var sorting = list(v.unfiled).length;
    /* The same numbers in words, each with its key from the bar. A zero is
       left out: "0 we're checking" says nothing. */
    var words = [
      [t.done, t.done + " ready", "is-done"],
      [t.checking, staff ? t.checking + " need your review" : t.checking + " we're checking", "is-check"],
      [t.todo, staff ? t.todo + " the client still has to send" : t.todo + " left to send", "is-todo"],
      [staff ? sorting : 0, plural(sorting, "file", "files") + " to sort", "is-sort"]
    ].filter(function (w) { return w[0] > 0; });
    var owed = firstOwed(groups);
    var next;
    if (staff) {
      next = t.checking ? "Next: check " + plural(t.checking, "paper", "papers") + " waiting for your review."
        : (sorting ? "Next: sort " + plural(sorting, "file", "files") + " that came in without a paper type."
          : "Nothing waits for your review. The client still has to send " + plural(t.todo, "paper", "papers") + ".");
    } else {
      next = owed ? "Next: send " + (owed.ask_text || owed.title) + "."
        : "Nothing to send right now. We are checking " + plural(t.checking, "paper", "papers") + ".";
    }
    return '<section class="card vt-progress" aria-labelledby="vt-prog-h">' +
      '<h2 class="eyebrow" id="vt-prog-h">Ready for lenders</h2>' +
      '<p class="vt-count"><span class="fh-num">' + t.done + " of " + t.total + "</span><span>papers ready</span></p>" +
      '<div class="vt-bar" aria-hidden="true"><span class="vt-bar-done" style="width:' + pct(t.done) + '%"></span>' +
      '<span class="vt-bar-check" style="width:' + pct(t.checking) + '%"></span></div>' +
      '<ul class="vt-tally">' + words.map(function (w) {
        return '<li><span class="vt-key ' + w[2] + '" aria-hidden="true"></span>' + esc(w[1]) + "</li>";
      }).join("") + "</ul>" +
      '<p class="vt-next">' + esc(next) + "</p></section>";
  }

  function renderComplete(v, staff) {
    var t = tally(v);
    return '<section class="card vt-complete" aria-labelledby="vt-done-h">' +
      '<span class="vt-complete-mark" aria-hidden="true">✓</span><div class="vt-complete-body">' +
      '<h2 id="vt-done-h">File complete</h2>' +
      "<p>" + esc(staff ? "All " + t.total + " papers are accepted or waived." : "All " + t.total + " papers are ready. You do not need to send anything else.") + "</p>" +
      '<div class="vt-closer"><span class="caption vt-closer-label">' + (staff ? "What the closer sees" : "What your closer sees") + "</span>" +
      "<q>" + esc(closerLine(v)) + "</q></div></div></section>";
  }

  /* The button is the control people use; it opens the file input. The input is
     visually hidden, not display:none (older iPhone Safari will not open a file
     picker for a display:none input), and kept out of the tab order. */
  function renderUpload(item, ctx) {
    var id = "vt-" + (++ctx.n);
    var primary = ctx.primary === "pick:" + item.slot;
    return '<button type="button" class="' + (primary ? "vt-btn-primary" : "vt-btn") + '" data-act="pick" data-slot="' + esc(item.slot) + '">' +
      esc(uploadLabel(item)) + '<span class="vt-sr"> — ' + esc(item.title) + "</span></button>" +
      '<input type="file" class="vt-file" id="' + id + '" data-slot="' + esc(item.slot) + '" accept="' + FILE_ACCEPT + '"' +
      (multi(item) ? " multiple" : "") + ' tabindex="-1" aria-hidden="true" aria-label="' + esc("Choose a file for " + item.title) + '">';
  }

  function docMark(d) {
    if (d.status === "accepted") return d.expired ? { mark: "↻", cls: "is-old" } : { mark: "✓", cls: "is-done" };
    if (d.status === "rejected") return { mark: "✗", cls: "is-redo" };
    return { mark: "…", cls: "is-checking" };
  }

  function docWords(d, item, staff) {
    if (d.status === "accepted") {
      if (d.expired) return "Too old" + (d.valid_through ? " — it was good through " + day(d.valid_through) : "");
      var w = "Accepted";
      if (whole(d.covers) > 1 && item.unit !== "file") w += " · covers " + units(item.unit, whole(d.covers));
      if (d.valid_through) w += " · good through " + day(d.valid_through);
      return w;
    }
    if (d.status === "rejected") return "Not accepted";
    return staff ? "Needs your review" : "We're checking it";
  }

  /* Staff only: who decided, and when. */
  function reviewedWords(d, now) {
    if (d.status === "accepted" && d.accepted_by === "doc-check") return "Accepted by the document reader";
    if (d.status === "uploaded" || (!d.reviewed_by && !d.reviewed_at)) return "";
    return (d.status === "rejected" ? "Rejected" : "Accepted") + (d.reviewed_by ? " by " + d.reviewed_by : "") +
      (d.reviewed_at ? " · " + when(d.reviewed_at, now) : "");
  }

  function fileName(d) { return d.filename || d.title || "Your file"; }

  function viewLink(d, at) {
    var u = d && d.download && d.download.url;
    if (typeof u !== "string" || !/^(https?:\/\/|\/)/i.test(u)) return "";
    return '<a class="vt-link vt-view" href="' + esc(u) + '" target="_blank" rel="noopener" data-expires="' + esc((d.download && d.download.expires_at) || "") + '" data-at="' + esc(at) + '">' +
      'View<span class="vt-sr"> ' + esc(fileName(d)) + "</span></a>";
  }

  function acceptForm(d, item, ctx) {
    var parts = "";
    if (multi(item) && item.unit !== "file") {
      var c = "vt-" + (++ctx.n);
      parts += '<div class="vt-f"><label for="' + c + '">' + esc(coversLabel(item)) + "</label>" +
        '<input id="' + c + '" class="vt-field" type="number" inputmode="numeric" min="1" max="24" step="1" value="1" data-field="covers"></div>';
    }
    if (item.expires) {
      var e = "vt-" + (++ctx.n);
      parts += '<div class="vt-f"><label for="' + e + '">' + esc(dateLabel(item)) + "</label>" +
        '<input id="' + e + '" class="vt-field" type="date"' + (ctx.today ? ' max="' + esc(ctx.today) + '"' : "") + ' data-field="period_end">' +
        '<p class="caption">' + esc(dateHint(item)) + "</p></div>";
    }
    return '<div class="vt-form" data-form="accept" hidden>' + parts +
      '<div class="vt-form-act"><button type="button" class="vt-btn" data-act="accept-send" data-doc="' + esc(d.id) + '" data-slot="' + esc(item.slot) + '">Accept file</button>' +
      '<button type="button" class="vt-link" data-act="cancel">Cancel</button></div>' +
      '<p class="vt-form-msg" aria-live="polite"></p></div>';
  }

  function rejectForm(d, item, ctx) {
    var r = "vt-" + (++ctx.n);
    return '<div class="vt-form" data-form="reject" hidden>' +
      '<div class="vt-f vt-f-wide"><label for="' + r + '">What should the client fix?</label>' +
      '<input id="' + r + '" class="vt-field" type="text" maxlength="300" autocomplete="off" data-field="reason" placeholder="Example: page 2 is missing">' +
      '<p class="caption">The client sees these words.</p></div>' +
      '<div class="vt-form-act"><button type="button" class="vt-btn vt-btn-no" data-act="reject-send" data-doc="' + esc(d.id) + '" data-slot="' + esc(item.slot) + '">Reject file</button>' +
      '<button type="button" class="vt-link" data-act="cancel">Cancel</button></div>' +
      '<p class="vt-form-msg" aria-live="polite"></p></div>';
  }

  function renderDoc(d, item, ctx) {
    var dm = docMark(d);
    var name = fileName(d);
    var sent = d.uploaded_at ? "Sent " + when(d.uploaded_at, ctx.now) : "";
    var lines = '<span class="vt-doc-name" title="' + esc(name) + '">' + esc(name) + "</span>" +
      '<span class="caption"' + (d.uploaded_at ? ' title="' + esc(exact(d.uploaded_at)) + '"' : "") + ">" +
      esc([sent, docWords(d, item, ctx.staff)].filter(Boolean).join(" · ")) + "</span>";
    if (d.status === "rejected" && d.reason) lines += '<span class="vt-reason">What to fix: ' + esc(d.reason) + "</span>";
    if (ctx.staff) {
      var who = reviewedWords(d, ctx.now);
      if (who) lines += '<span class="caption">' + esc(who) + "</span>";
    }
    var acts = viewLink(d, item.slot);
    var forms = "";
    if (ctx.staff && d.status === "uploaded") {
      /* Waiting for review: the two decisions, apart (UI-STANDARDS §5). */
      acts += '<button type="button" class="' + (ctx.primary === "accept:" + d.id ? "vt-btn-primary" : "vt-btn") + ' vt-btn-s" data-act="accept" data-doc="' + esc(d.id) + '" data-slot="' + esc(item.slot) + '">' +
        'Accept<span class="vt-sr"> ' + esc(name) + "</span></button>" +
        '<button type="button" class="vt-btn vt-btn-s vt-btn-no" data-act="reject" data-doc="' + esc(d.id) + '" data-slot="' + esc(item.slot) + '">' +
        'Reject<span class="vt-sr"> ' + esc(name) + "</span></button>";
      if (needsDetails(item)) forms += acceptForm(d, item, ctx);
      forms += rejectForm(d, item, ctx);
    } else if (ctx.staff) {
      /* Already decided: one quiet "Change" opens the other decision (the
         server takes a second decision on the same file). */
      var other = d.status === "rejected" ? "accept" : "reject";
      acts += '<button type="button" class="vt-link" data-act="change" data-to="' + other + '">' +
        'Change<span class="vt-sr"> the decision on ' + esc(name) + "</span></button>";
      forms += other === "accept" ? acceptForm(d, item, ctx) : rejectForm(d, item, ctx);
    }
    return '<li class="vt-doc ' + dm.cls + '" data-doc="' + esc(d.id) + '" data-slot="' + esc(item.slot) + '">' +
      '<span class="vt-doc-mark" aria-hidden="true">' + dm.mark + "</span>" +
      '<div class="vt-doc-main">' + lines + "</div>" +
      (acts ? '<div class="vt-doc-act">' + acts + "</div>" : "") + forms + "</li>";
  }

  function renderItem(item, ctx) {
    var st = statusOf(item, ctx.staff);
    var slot = String(item.slot || "");
    var need = whole(item.need) || 1;
    var meta = [];
    if (need > 1 || (whole(item.have) > 0 && item.unit !== "file")) meta.push(whole(item.have) + " of " + units(item.unit, need) + " ready");
    var up = canUpload(item);
    if (up) {
      meta.push(FILE_HINT);
      if (need > 1) meta.push("you can pick more than one file");
      /* A staff-added paper with no file type uploads as "other": it waits in
         the files to sort until a person files it here (the server's rule). */
      if (item.custom && !list(item.subtypes).length) {
        meta.push(ctx.staff ? "uploads come in unsorted — file each one here" : "a Fundhub person files it here after you send it");
      }
    }
    var tag = item.custom ? '<span class="tag vt-tag">' + (ctx.staff ? "Added by staff" : "Added by Fundhub") + "</span>" : "";
    var waived = st.key === "waived" && item.waived && item.waived.reason ? '<p class="caption">Why: ' + esc(item.waived.reason) + "</p>" : "";
    /* A client whose one file is being checked is told there is nothing to do.
       Staff already read "Needs your review" on the line. */
    var action = up ? renderUpload(item, ctx)
      : (st.key === "uploaded" && !ctx.staff ? '<p class="caption vt-wait">Nothing to do now.</p>' : "");
    var docs = list(item.documents);
    return '<li class="vt-item ' + st.cls + '" data-item="' + esc(slot) + '">' +
      '<span class="vt-mark" aria-hidden="true">' + st.mark + "</span>" +
      '<div class="vt-main"><div class="vt-title-row"><h3 class="vt-title">' + esc(item.title) + "</h3>" + tag + "</div>" +
      (item.why ? '<p class="vt-why">' + esc(item.why) + "</p>" : "") +
      (meta.length ? '<p class="caption vt-meta">' + esc(meta.join(" · ")) + "</p>" : "") + waived + "</div>" +
      '<div class="vt-side"><span class="tag vt-status">' + esc(st.word) + "</span>" + action + "</div>" +
      '<div class="vt-msg" data-msg="' + esc(slot) + '" aria-live="polite">' + flashHtml(ctx, slot) + "</div>" +
      (docs.length ? '<ul class="vt-docs" aria-label="' + esc("Files sent for " + item.title) + '">' +
        docs.map(function (d) { return renderDoc(d, item, ctx); }).join("") + "</ul>" : "") +
      "</li>";
  }

  function renderGroup(g, ctx) {
    var done = g.items.filter(isDone).length;
    var hid = "vt-g-" + (++ctx.n);
    return '<section class="card vt-group" aria-labelledby="' + hid + '">' +
      '<div class="vt-group-head"><h2 class="vt-group-name" id="' + hid + '">' + esc(g.name) + "</h2>" +
      (g.business ? '<span class="tag vt-tag">Business</span>' : "") +
      '<span class="caption vt-group-count">' + done + " of " + g.items.length + " ready" + (done === g.items.length ? " ✓" : "") + "</span></div>" +
      '<ul class="vt-items">' + g.items.map(function (it) { return renderItem(it, ctx); }).join("") + "</ul></section>";
  }

  /* ── files nobody could place ──────────────────────────────────────────── */

  var SORT_WORDS = {
    no_label: "No paper type was picked when it was sent.",
    choose_business: "It does not say which business it is for.",
    unknown_business: "It names a business that is archived or not on this file.",
    no_business: "It is a business paper, but this client has no business yet.",
    no_line: "It does not match a paper on the list."
  };

  function lineSelect(ctx, id) {
    return '<select id="' + id + '" class="vt-field" data-field="slot"><option value="">Pick a paper</option>' +
      list(ctx.items).map(function (it) {
        return '<option value="' + esc(it.slot) + '">' + esc(it.label || it.title) + "</option>";
      }).join("") + "</select>";
  }

  function sortForms(u, ctx) {
    var a = "vt-" + (++ctx.n), c = "vt-" + (++ctx.n), e = "vt-" + (++ctx.n), b = "vt-" + (++ctx.n), r = "vt-" + (++ctx.n);
    return '<div class="vt-form" data-form="accept" hidden>' +
      '<div class="vt-f vt-f-wide"><label for="' + a + '">Which paper is this?</label>' + lineSelect(ctx, a) + "</div>" +
      '<div class="vt-f" data-when="covers" hidden><label for="' + c + '">How many months does this file cover?</label>' +
      '<input id="' + c + '" class="vt-field" type="number" inputmode="numeric" min="1" max="24" step="1" value="1" data-field="covers"></div>' +
      '<div class="vt-f" data-when="date" hidden><label for="' + e + '">Date on the paper</label>' +
      '<input id="' + e + '" class="vt-field" type="date"' + (ctx.today ? ' max="' + esc(ctx.today) + '"' : "") + ' data-field="period_end">' +
      '<p class="caption">Leave it empty to count from the day it was sent.</p></div>' +
      '<div class="vt-form-act"><button type="button" class="vt-btn" data-act="sort-accept-send" data-doc="' + esc(u.id) + '">Accept file</button>' +
      '<button type="button" class="vt-link" data-act="cancel">Cancel</button></div><p class="vt-form-msg" aria-live="polite"></p></div>' +
      '<div class="vt-form" data-form="reject" hidden>' +
      '<div class="vt-f vt-f-wide"><label for="' + b + '">Which paper was it meant to be?</label>' + lineSelect(ctx, b) + "</div>" +
      '<div class="vt-f vt-f-wide"><label for="' + r + '">What should the client fix?</label>' +
      '<input id="' + r + '" class="vt-field" type="text" maxlength="300" autocomplete="off" data-field="reason" placeholder="Example: this is not a bank statement">' +
      '<p class="caption">The client sees these words.</p></div>' +
      '<div class="vt-form-act"><button type="button" class="vt-btn vt-btn-no" data-act="sort-reject-send" data-doc="' + esc(u.id) + '">Reject file</button>' +
      '<button type="button" class="vt-link" data-act="cancel">Cancel</button></div><p class="vt-form-msg" aria-live="polite"></p></div>';
  }

  function sortRow(u, ctx, staff) {
    var name = fileName(u);
    var sent = u.uploaded_at ? "Sent " + when(u.uploaded_at, ctx.now) : "";
    var words = staff ? (SORT_WORDS[u.reason] || SORT_WORDS.no_line) : "We're checking it";
    var acts = viewLink(u, "unfiled");
    if (staff) {
      acts += '<button type="button" class="vt-btn vt-btn-s" data-act="sort-accept">File and accept<span class="vt-sr"> ' + esc(name) + "</span></button>" +
        '<button type="button" class="vt-btn vt-btn-s vt-btn-no" data-act="sort-reject">Reject<span class="vt-sr"> ' + esc(name) + "</span></button>";
    }
    return '<li class="vt-doc is-checking" data-doc="' + esc(u.id) + '">' +
      '<span class="vt-doc-mark" aria-hidden="true">…</span>' +
      '<div class="vt-doc-main"><span class="vt-doc-name" title="' + esc(name) + '">' + esc(name) + "</span>" +
      '<span class="caption"' + (u.uploaded_at ? ' title="' + esc(exact(u.uploaded_at)) + '"' : "") + ">" + esc([sent, words].filter(Boolean).join(" · ")) + "</span></div>" +
      (acts ? '<div class="vt-doc-act">' + acts + "</div>" : "") + (staff ? sortForms(u, ctx) : "") + "</li>";
  }

  /* Staff: files to sort, near the top — they are review work. */
  function renderSort(v, ctx) {
    var files = list(v.unfiled);
    if (!files.length) return "";
    return '<section class="card vt-sort" aria-labelledby="vt-sort-h"><span class="eyebrow">Staff only</span>' +
      '<h2 id="vt-sort-h">Files to sort</h2>' +
      '<p class="caption">These came in without a clear paper type. Pick the paper each one is for, then accept it or reject it.</p>' +
      '<div class="vt-msg" data-msg="unfiled" aria-live="polite">' + flashHtml(ctx, "unfiled") + "</div>" +
      '<ul class="vt-docs">' + files.map(function (u) { return sortRow(u, ctx, true); }).join("") + "</ul></section>";
  }

  /* Client: the same files, said plainly, at the bottom. */
  function renderOther(v, ctx) {
    var files = list(v.unfiled);
    if (!files.length) return "";
    return '<section class="card vt-other" aria-labelledby="vt-other-h"><h2 id="vt-other-h">Other files you sent</h2>' +
      '<p class="caption">We got these. A Fundhub person will check which paper each one is.</p>' +
      '<div class="vt-msg" data-msg="unfiled" aria-live="polite">' + flashHtml(ctx, "unfiled") + "</div>" +
      '<ul class="vt-docs">' + files.map(function (u) { return sortRow(u, ctx, false); }).join("") + "</ul></section>";
  }

  /* ── staff only: add a paper the standard list does not have ──────────── */

  function renderAdd(v, ctx, open) {
    var biz = list(v && v.scopes).filter(function (s) { return s && s.kind === "business" && s.id; });
    var who = '<option value="">Personal</option>' + biz.map(function (s) {
      return '<option value="' + esc(s.id) + '">' + esc(s.name || "Business") + "</option>";
    }).join("");
    var types = ADD_SUBTYPES.map(function (p) { return '<option value="' + esc(p[0]) + '">' + esc(p[1]) + "</option>"; }).join("");
    return '<details class="card vt-add" id="vt-add"' + (open ? " open" : "") + '>' +
      '<summary>Add a paper <span class="caption">Staff only</span></summary>' +
      '<p class="caption vt-add-note">For a paper a lender asked for that is not on the list. The client sees it and can send it.</p>' +
      '<form class="vt-add-form" data-form="add" novalidate>' +
      '<div class="vt-f"><label for="vt-add-title">Paper name</label><input id="vt-add-title" class="vt-field" name="title" type="text" maxlength="120" autocomplete="off" required placeholder="Business license"></div>' +
      '<div class="vt-f"><label for="vt-add-for">Whose paper</label><select id="vt-add-for" class="vt-field" name="entity_id">' + who + "</select></div>" +
      '<div class="vt-f vt-f-wide"><label for="vt-add-why">Why the lender wants it (the client reads this)</label><input id="vt-add-why" class="vt-field" name="note" type="text" maxlength="300" autocomplete="off"></div>' +
      '<div class="vt-f"><label for="vt-add-type">File type</label><select id="vt-add-type" class="vt-field" name="subtype">' + types + "</select></div>" +
      '<div class="vt-f"><label for="vt-add-need">How many files</label><input id="vt-add-need" class="vt-field" name="need" type="number" inputmode="numeric" min="1" max="24" step="1" value="1"></div>' +
      '<div class="vt-form-act"><button type="submit" class="vt-btn">Add paper</button></div>' +
      '<div class="vt-msg vt-f-wide" data-msg="add" aria-live="polite">' + flashHtml(ctx, "add") + "</div>" +
      "</form></details>";
  }

  /* ── the four states ───────────────────────────────────────────────────── */

  function renderNoList(v, staff, ctx) {
    return renderHead(staff) +
      '<section class="card vt-none"><h2>No papers on ' + (staff ? "this client's" : "your") + " list yet</h2>" +
      "<p>" + esc(staff ? "Add the papers a lender asked for below. The client sees each one and can send it."
        : "When your file is set up, the papers lenders ask for show up here.") + "</p></section>" +
      (staff ? renderAdd(v, ctx, true) : "");
  }

  function today(v) { var m = /^(\d{4}-\d{2}-\d{2})/.exec(String((v && v.as_of) || "")); return m ? m[1] : ""; }

  /* The whole screen. opts = { staff, flash: { at, text, bad } }. A vault with
     nothing sent yet is the empty state: every line missing, and the first
     paper to send is the one filled button. */
  function render(v, opts) {
    var o = opts || {};
    var staff = !!o.staff;
    var items = list(v && v.items);
    var ctx = { staff: staff, now: v && v.as_of, today: today(v), flash: o.flash || null, n: 0, items: items, primary: "" };
    if (!items.length) return renderNoList(v, staff, ctx);
    var groups = groupsOf(v, staff);
    ctx.primary = primaryTarget(groups, staff);
    return renderHead(staff) +
      (v.complete === true ? renderComplete(v, staff) : renderProgress(v, groups, ctx)) +
      (staff ? renderSort(v, ctx) : "") +
      '<div class="vt-groups">' + groups.map(function (g) { return renderGroup(g, ctx); }).join("") + "</div>" +
      (staff ? "" : renderOther(v, ctx)) +
      (staff ? renderAdd(v, ctx, false) : "");
  }

  function renderLoading(staff) {
    var row = '<li class="vt-item vt-skel-row"><span class="vt-sk vt-sk-dot"></span>' +
      '<span class="vt-skel"><span class="vt-sk vt-sk-m"></span><span class="vt-sk vt-sk-s"></span></span></li>';
    var group = '<div class="card vt-group vt-skel"><span class="vt-sk vt-sk-s"></span><ul class="vt-items">' + row + row + row + "</ul></div>";
    return '<div class="vt-head"><div><h1>' + (staff ? "Funding papers" : "Your funding papers") + "</h1>" +
      '<p class="caption">Loading ' + (staff ? "this client's" : "your") + " papers…</p></div></div>" +
      '<div class="card vt-progress vt-skel" aria-busy="true"><span class="vt-sk vt-sk-s"></span><span class="vt-sk vt-sk-l"></span><span class="vt-sk vt-sk-bar"></span></div>' +
      '<div class="vt-groups" aria-busy="true">' + group + group + "</div>";
  }

  var ERROR_WORDS = {
    offline: "We could not reach the server. Check your connection and try again.",
    nodb: "Our database is not answering right now. Try again in a few minutes.",
    server: "Something went wrong on our side while loading the papers. Try again in a few minutes.",
    forbidden: "This account is not allowed to see this page. If that seems wrong, ask your advisor.",
    forbiddenStaff: "Only owner, admin and sales manager logins can open a client's funding papers.",
    notfound: "We could not find that client file. Check the link you followed.",
    needclient: "This page needs to know whose papers to show. Open it from a client's file.",
    badrequest: "That request was not accepted. Check the link you followed."
  };

  function renderError(kind, staff) {
    var words = kind === "forbidden" && staff ? ERROR_WORDS.forbiddenStaff : (ERROR_WORDS[kind] || ERROR_WORDS.server);
    return '<div class="vt-head"><div><h1>' + (staff ? "Funding papers" : "Your funding papers") + "</h1></div></div>" +
      '<section class="card vt-error" role="alert"><h2>We could not load ' + (staff ? "this client's" : "your") + " papers</h2>" +
      "<p>" + esc(words) + "</p>" +
      '<button class="vt-btn-primary" type="button" data-act="retry">Try again</button></section>';
  }

  function classify(res) {
    var s = res.status, b = res.body;
    if (s === 401) return "signin";
    if (s === 403) return "forbidden";
    if (s === 0) return "offline";
    if (s === 404) return (b && b.error === "not_found" && typeof b.path === "string") ? "offline" : "notfound";
    if (s === 400) return (b && /client_id/.test(String(b.error || ""))) ? "needclient" : "badrequest";
    if (s === 503 || (b && b.db === "down")) return "nodb";
    if (!b || b.ok !== true || !Array.isArray(b.items)) return "server";
    return "ok";
  }

  /* What a refused upload says, in the person's words. */
  var UPLOAD_WORDS = {
    invalid_file_type: "That file type does not work. Send a PDF, JPG or PNG.",
    file_too_large: "That file is too big. Try a smaller file, or a photo of each page.",
    empty_file: "That file is empty. Pick the file again."
  };
  function uploadProblem(res) {
    var b = res.body || {};
    var e = String(b.error || "");
    if (res.status === 0) return ERROR_WORDS.offline;
    if (res.status === 413) return UPLOAD_WORDS.file_too_large;
    if (res.status === 503 || b.db === "down") return ERROR_WORDS.nodb;
    if (res.status === 403) return "This login is not allowed to send files here.";
    if (UPLOAD_WORDS[e]) return (b.filename ? b.filename + ": " : "") + UPLOAD_WORDS[e];
    if (e === "no file in the request") return "Pick a file first.";
    if (e === "no such business") return "We could not find that business on the file. Reload the page and try again.";
    if (res.status === 404) return "We could not find this client file. Reload the page.";
    return "The file did not send. Try again in a few minutes.";
  }

  /* What a refused staff change says. Codes are api/money/vault.mjs's own. */
  var ACT_WORDS = {
    unfiled: "Pick the paper this file is for first.",
    document_not_found: "That file is not on this client's list anymore. Reload the page.",
    unknown_business: "That business is not on this client's file. Reload the page.",
    invalid_covers: "Use a whole number from 1 to 24.",
    invalid_period_end: "Use a real date that is not in the future.",
    invalid_item_key: "Pick a paper from the list.",
    invalid_entity_id: "Pick a business from the list.",
    invalid_reason: "Write what the client should fix, in 300 letters or fewer.",
    invalid_title: "Give the paper a name, in 120 letters or fewer.",
    invalid_note: "Keep the note to 300 letters or fewer.",
    invalid_subtype: "Pick a file type from the list.",
    invalid_need: "Use a whole number from 1 to 24.",
    not_found: "We could not find that client file. Reload the page."
  };
  function actProblem(res) {
    var b = res.body || {};
    if (res.status === 0) return ERROR_WORDS.offline;
    if (res.status === 503 || b.db === "down") return ERROR_WORDS.nodb;
    if (res.status === 403) return "Only owner, admin and sales manager logins can change a client's papers.";
    return ACT_WORDS[b.error] || "That did not save. Try again in a few minutes.";
  }

  /* ── browser only ──────────────────────────────────────────────────────── */

  function param(name) {
    try { return new URLSearchParams(root.location.search).get(name) || ""; } catch (e) { return ""; }
  }
  function token() {
    try { return root.localStorage.getItem("fh_token") || ""; } catch (e) { return ""; }
  }
  function authHeaders() {
    var headers = { accept: "application/json" };
    var t = token();
    if (t) headers.authorization = "Bearer " + t;
    return headers;
  }

  function answer(started) {
    return Promise.resolve(started).then(function (r) {
      return r.json().then(function (b) { return { status: r.status, body: b }; },
        function () { return { status: r.status, body: null }; });
    }, function () { return { status: 0, body: null }; });
  }

  function call(method, path, body) {
    var headers = authHeaders();
    var init = { method: method, headers: headers, credentials: "same-origin" };
    if (body !== undefined) {
      headers["content-type"] = "application/json";
      init.body = JSON.stringify(body);
    }
    try { return answer(root.fetch(path, init)); } catch (e) { return Promise.resolve({ status: 0, body: null }); }
  }

  /* POST the files as multipart/form-data. The browser writes the boundary, so
     no content-type header is set here. One document per file on the server. */
  function sendUpload(path, fields, files) {
    var Form = root.FormData;
    if (typeof Form !== "function" || typeof root.fetch !== "function") return Promise.resolve({ status: 0, body: null });
    var form = new Form();
    Object.keys(fields || {}).forEach(function (k) { form.append(k, fields[k]); });
    list(files).forEach(function (f) { form.append("file", f, f.name); });
    try {
      return answer(root.fetch(path, { method: "POST", headers: authHeaders(), body: form, credentials: "same-origin" }));
    } catch (e) { return Promise.resolve({ status: 0, body: null }); }
  }

  function signInUrl() {
    var role = "";
    try { role = root.localStorage.getItem("fh_role") || ""; } catch (e) {}
    var staffish = (role && role !== "client") || !!param("client_id");
    return staffish
      ? "/login.html?next=" + encodeURIComponent(root.location.pathname + root.location.search)
      : "/portal-login.html";
  }

  function withClient(href, cid) {
    if (!cid) return href;
    var parts = String(href).split("#");
    var base = parts[0] + (parts[0].indexOf("?") < 0 ? "?" : "&") + "client_id=" + encodeURIComponent(cid);
    return parts.length > 1 ? base + "#" + parts.slice(1).join("#") : base;
  }

  function normal(p) {
    return Promise.resolve(p).then(function (r) {
      if (r && typeof r.status === "number" && "body" in r) return r;
      return { status: r ? 200 : 0, body: r || null };
    }, function () { return { status: 0, body: null }; });
  }

  /* ── the section: window.FinanceOS.sections.vault ───────────────────────
     mount(el, ctx) paints this section into `el`. No page chrome.
     ctx = { clientId, apiGet, apiPost } — apiGet/apiPost resolve to
     { status, body }; missing ones fall back to this file's own fetch. A client
     session leaves clientId empty (the server pins a client to their own
     file); staff pass the client's id. Files go up through this file's own
     multipart POST (the shared apiPost sends JSON only). Returns
     { reload, unmount }. */
  function mount(el, ctx) {
    ctx = ctx || {};
    var cid = ctx.clientId || "";
    var get = typeof ctx.apiGet === "function" ? function (p) { return normal(ctx.apiGet(p)); } : function (p) { return call("GET", p); };
    var send = typeof ctx.apiPost === "function" ? function (p, b) { return normal(ctx.apiPost(p, b)); } : function (p, b) { return call("POST", p, b); };
    var view = null;
    var flash = null;
    var gone = false;

    function staff() { return isStaffView(view, cid); }
    function paint(html) { el.innerHTML = '<div class="fh-vault">' + html + "</div>"; }
    function draw() { paint(render(view, { staff: staff(), flash: flash })); flash = null; }
    function all(sel) { return el.querySelectorAll ? el.querySelectorAll(sel) : []; }
    function byAttr(sel, name, value) {
      var found = all(sel);
      for (var i = 0; i < found.length; i++) if (found[i].getAttribute(name) === value) return found[i];
      return null;
    }
    function itemBySlot(slot) {
      var items = list(view && view.items);
      for (var i = 0; i < items.length; i++) if (items[i].slot === slot) return items[i];
      return null;
    }
    function signIn() {
      if (typeof ctx.onSignIn === "function") ctx.onSignIn();
      else if (root.location) root.location.href = signInUrl();
    }
    /* Bring the line that just changed into view, so the answer sits where the
       person is looking (UI-STANDARDS §5). */
    function reveal(at) {
      var target = at === "unfiled" ? el.querySelector(".vt-sort, .vt-other") : at === "add" ? el.querySelector("#vt-add") : byAttr("[data-item]", "data-item", at);
      if (target && target.scrollIntoView) target.scrollIntoView({ behavior: "smooth", block: "center" });
    }
    function say(at, text, bad) {
      var box = byAttr("[data-msg]", "data-msg", at);
      if (box) box.innerHTML = text ? '<p class="vt-flash' + (bad ? " is-bad" : "") + '" role="' + (bad ? "alert" : "status") + '">' + esc(text) + "</p>" : "";
    }
    function formSay(form, text) {
      var box = form && form.querySelector(".vt-form-msg");
      if (box) box.textContent = text || "";
    }
    function busy(btn, on, text) {
      if (!btn) return;
      if (on) {
        if (!btn.getAttribute("data-label")) btn.setAttribute("data-label", btn.innerHTML);
        btn.disabled = true;
        btn.textContent = text;
      } else {
        btn.disabled = false;
        if (btn.getAttribute("data-label")) btn.innerHTML = btn.getAttribute("data-label");
      }
    }

    function load() {
      if (!view) paint(renderLoading(!!cid));
      return get(API + (cid ? "?client_id=" + encodeURIComponent(cid) : "")).then(function (res) {
        if (gone) return;
        var kind = classify(res);
        if (kind === "signin") { signIn(); return; }
        if (kind !== "ok") { view = null; paint(renderError(kind, !!cid)); return; }
        view = res.body;
        draw();
      });
    }

    /* ── upload ── */
    function onFiles(input) {
      var slot = input.getAttribute("data-slot");
      var item = itemBySlot(slot);
      var files = [].slice.call(input.files || []);
      if (!item || !files.length) return;
      var btn = byAttr('[data-act="pick"]', "data-slot", slot);
      if (files.some(function (f) { return !okFile(f); })) {
        say(slot, UPLOAD_WORDS.invalid_file_type, true);
        input.value = "";
        return;
      }
      say(slot, "");
      busy(btn, true, files.length > 1 ? "Sending " + files.length + " files…" : "Sending…");
      sendUpload(uploadPath(item), uploadFields(item, cid), files).then(function (res) {
        if (gone) return;
        if (res.status === 401) { signIn(); return; }
        if (res.body && res.body.ok === true) {
          var n = list(res.body.documents).length || files.length;
          flash = { at: slot, text: n > 1 ? "Got your " + n + " files. We're checking them." : "Got it. We're checking your file." };
          return load().then(function () { reveal(slot); });
        }
        flash = { at: slot, text: uploadProblem(res), bad: true };
        /* With several files, the ones before a refused file are already
           saved. Read again so the list shows exactly what landed. */
        if (files.length > 1 && res.status === 400) return load().then(function () { reveal(slot); });
        busy(btn, false);
        input.value = "";
        say(slot, flash.text, true);
        flash = null;
      });
    }

    /* ── staff changes ──
       o = { at: where the answer shows, spot(body) → where it shows after a
       success that moved it (a new line), ok: the words, btn, form }. A refusal
       is said inside the open form, or at `at`. */
    function act(body, o) {
      if (cid) body.client_id = cid;
      busy(o.btn, true, "Saving…");
      return send(API, body).then(function (res) {
        if (gone) return;
        if (res.status === 401) { signIn(); return; }
        var b = res.body || {};
        if (b.ok === true) {
          var spot = typeof o.spot === "function" ? o.spot(b) : o.at;
          flash = { at: spot, text: o.ok };
          if (b.vault && Array.isArray(b.vault.items)) { view = b.vault; draw(); reveal(spot); return; }
          return load().then(function () { reveal(spot); });
        }
        busy(o.btn, false);
        if (o.form) formSay(o.form, actProblem(res)); else say(o.at, actProblem(res), true);
      });
    }

    function rowOf(t) { return t.closest ? t.closest(".vt-doc") : null; }
    function formIn(row, kind) {
      var forms = row ? row.querySelectorAll(".vt-form") : [];
      for (var i = 0; i < forms.length; i++) if (forms[i].getAttribute("data-form") === kind) return forms[i];
      return null;
    }
    function openForm(row, kind) {
      var forms = row ? row.querySelectorAll(".vt-form") : [];
      var target = null;
      for (var i = 0; i < forms.length; i++) {
        var match = forms[i].getAttribute("data-form") === kind;
        forms[i].hidden = !match;
        if (match) target = forms[i];
      }
      var first = target && target.querySelector("select, input");
      if (first && first.focus) first.focus();
    }
    function fieldIn(form, name) { return form ? form.querySelector('[data-field="' + name + '"]') : null; }

    function readDetails(form, body) {
      var covers = fieldIn(form, "covers");
      if (covers && !(covers.closest && covers.closest("[hidden]")) && String(covers.value || "").trim() !== "") {
        var n = Number(covers.value);
        if (!(n >= 1 && n <= 24 && Math.floor(n) === n)) { formSay(form, ACT_WORDS.invalid_covers); covers.focus(); return false; }
        body.covers = n;
      }
      var end = fieldIn(form, "period_end");
      if (end && !(end.closest && end.closest("[hidden]")) && end.value) body.period_end = end.value;
      return true;
    }

    function onAccept(t) {
      var slot = t.getAttribute("data-slot");
      if (needsDetails(itemBySlot(slot))) { openForm(rowOf(t), "accept"); return; }
      act({ action: "accept", document_id: t.getAttribute("data-doc") }, { at: slot, ok: "Accepted.", btn: t });
    }
    function onAcceptSend(t) {
      var form = t.closest(".vt-form");
      var body = { action: "accept", document_id: t.getAttribute("data-doc") };
      if (!readDetails(form, body)) return;
      act(body, { at: t.getAttribute("data-slot"), ok: "Accepted.", btn: t, form: form });
    }
    function reasonOf(form) {
      var box = fieldIn(form, "reason");
      var reason = box ? String(box.value || "").replace(/\s+/g, " ").trim() : "";
      if (!reason) { formSay(form, "Write what the client should fix."); if (box) box.focus(); }
      return reason;
    }
    function onRejectSend(t) {
      var form = t.closest(".vt-form");
      var reason = reasonOf(form);
      if (!reason) return;
      act({ action: "reject", document_id: t.getAttribute("data-doc"), reason: reason },
        { at: t.getAttribute("data-slot"), ok: "Rejected. The client sees: " + reason, btn: t, form: form });
    }
    function chosenLine(form) {
      var sel = fieldIn(form, "slot");
      return sel ? itemBySlot(sel.value) : null;
    }
    function filed(body, item) {
      body.item_key = item.key;
      if (item.scope && item.scope.kind === "business" && item.scope.id) body.entity_id = item.scope.id;
      return body;
    }
    function onSortSend(t, kind) {
      var form = t.closest(".vt-form");
      var item = chosenLine(form);
      if (!item) { formSay(form, ACT_WORDS.unfiled); var s = fieldIn(form, "slot"); if (s) s.focus(); return; }
      var body = filed({ action: kind, document_id: t.getAttribute("data-doc") }, item);
      if (kind === "accept") {
        if (!readDetails(form, body)) return;
        act(body, { at: item.slot, ok: "Filed under " + (item.label || item.title) + " and accepted.", btn: t, form: form });
        return;
      }
      body.reason = reasonOf(form);
      if (!body.reason) return;
      act(body, { at: item.slot, ok: "Rejected. The client sees: " + body.reason, btn: t, form: form });
    }
    /* The sort form only asks for months/years or a date when the paper picked
       uses them. */
    function syncLine(sel) {
      var form = sel.closest ? sel.closest(".vt-form") : null;
      if (!form || form.getAttribute("data-form") !== "accept") return;
      var item = itemBySlot(sel.value);
      var c = form.querySelector('[data-when="covers"]');
      var d = form.querySelector('[data-when="date"]');
      if (c) {
        c.hidden = !(item && multi(item) && item.unit !== "file");
        if (item) c.querySelector("label").textContent = coversLabel(item);
      }
      if (d) {
        d.hidden = !(item && item.expires);
        if (item) {
          d.querySelector("label").textContent = dateLabel(item);
          d.querySelector(".caption").textContent = dateHint(item);
        }
      }
    }

    function onAdd(form) {
      var btn = form.querySelector('button[type="submit"]');
      var v = function (name) { var f = form.elements[name]; return f ? String(f.value || "").trim() : ""; };
      var title = v("title");
      if (!title) { say("add", "Give the paper a name.", true); form.elements.title.focus(); return; }
      var body = { action: "add_item", title: title };
      if (v("note")) body.note = v("note");
      if (v("entity_id")) body.entity_id = v("entity_id");
      if (v("subtype")) body.subtype = v("subtype");
      var need = v("need");
      if (need) {
        var n = Number(need);
        if (!(n >= 1 && n <= 24 && Math.floor(n) === n)) { say("add", ACT_WORDS.invalid_need, true); form.elements.need.focus(); return; }
        body.need = n;
      }
      /* The new line's slot is "<item_key>:<business id | client>", the
         server's own shape — the answer shows on the new line. */
      act(body, {
        at: "add", btn: btn, ok: "Added " + title + ". The client can send it now.",
        spot: function (b) {
          var key = b.result && b.result.item_key;
          return key ? key + ":" + (body.entity_id || "client") : "add";
        }
      });
    }

    /* A "View" link lives 15 minutes. An old one gets a fresh read instead of
       a dead page. */
    function onView(a, e) {
      var exp = Date.parse(a.getAttribute("data-expires") || "");
      if (isFinite(exp) && Date.now() >= exp) {
        e.preventDefault();
        flash = { at: a.getAttribute("data-at"), text: "That link timed out, so we made a fresh one. Tap View again." };
        load();
      }
    }

    function onClick(e) {
      var a = e.target && e.target.closest ? e.target.closest("a.vt-view") : null;
      if (a && el.contains(a)) { onView(a, e); return; }
      var t = e.target && e.target.closest ? e.target.closest("[data-act]") : null;
      if (!t || (el.contains && !el.contains(t)) || t.disabled) return;
      var what = t.getAttribute("data-act");
      if (what === "retry") load();
      else if (what === "pick") {
        var input = byAttr('input[type="file"]', "data-slot", t.getAttribute("data-slot"));
        if (input && input.click) input.click();
      } else if (what === "accept") onAccept(t);
      else if (what === "accept-send") onAcceptSend(t);
      else if (what === "reject") openForm(rowOf(t), "reject");
      else if (what === "change") openForm(rowOf(t), t.getAttribute("data-to"));
      else if (what === "reject-send") onRejectSend(t);
      else if (what === "sort-accept") openForm(rowOf(t), "accept");
      else if (what === "sort-reject") openForm(rowOf(t), "reject");
      else if (what === "sort-accept-send") onSortSend(t, "accept");
      else if (what === "sort-reject-send") onSortSend(t, "reject");
      else if (what === "cancel") { var f = t.closest(".vt-form"); if (f) { f.hidden = true; formSay(f, ""); } }
    }
    function onChange(e) {
      var t = e.target;
      if (!t || !t.getAttribute) return;
      if (t.type === "file" && t.getAttribute("data-slot")) onFiles(t);
      else if (t.getAttribute("data-field") === "slot") syncLine(t);
    }
    function onSubmit(e) {
      var f = e.target;
      if (!f || !f.getAttribute || f.getAttribute("data-form") !== "add") return;
      e.preventDefault();
      onAdd(f);
    }

    el.addEventListener("click", onClick);
    el.addEventListener("change", onChange);
    el.addEventListener("submit", onSubmit);
    load();
    return {
      reload: load,
      unmount: function () {
        gone = true;
        el.removeEventListener("click", onClick);
        el.removeEventListener("change", onChange);
        el.removeEventListener("submit", onSubmit);
        el.innerHTML = "";
      }
    };
  }

  /* ── the standalone page (/app/money-vault.html) — a thin shell ──────── */
  function initPage() {
    var el = root.document.getElementById("vault-root");
    if (!el) return;
    var cid = param("client_id");
    var links = root.document.querySelectorAll(".mnav a");
    for (var i = 0; i < links.length; i++) links[i].setAttribute("href", withClient(links[i].getAttribute("href"), cid));
    var nav = root.document.querySelector(".mnav");
    var cur = nav && nav.querySelector('[aria-current="page"]');
    if (cur && nav.scrollWidth > nav.clientWidth) nav.scrollLeft = Math.max(0, cur.offsetLeft - nav.offsetLeft - 16);
    var back = root.document.getElementById("money-back");
    if (back && cid) {
      back.setAttribute("href", "finance-os.html?client_id=" + encodeURIComponent(cid));
      back.textContent = "Back to Finance OS";
    }
    mount(el, { clientId: cid });
  }

  root.FinanceOS = root.FinanceOS || {};
  root.FinanceOS.sections = root.FinanceOS.sections || {};
  root.FinanceOS.sections.vault = { title: "Funding papers", mount: mount };

  root.FHMoneyVault = {
    day: day, when: when, statusOf: statusOf, groupsOf: groupsOf, tally: tally, closerLine: closerLine,
    isStaffView: isStaffView, primaryTarget: primaryTarget, uploadFields: uploadFields, uploadPath: uploadPath,
    sendUpload: sendUpload, okFile: okFile, canUpload: canUpload, render: render, renderLoading: renderLoading,
    renderError: renderError, classify: classify, uploadProblem: uploadProblem, actProblem: actProblem,
    withClient: withClient, mount: mount, FILE_ACCEPT: FILE_ACCEPT
  };

  /* Auto-start only finds #vault-root on the standalone page. The combined
     FinanceOS page calls FinanceOS.sections.vault.mount(). */
  if (root.document && root.document.getElementById) {
    if (root.document.readyState === "loading") {
      root.document.addEventListener("DOMContentLoaded", initPage);
    } else {
      initPage();
    }
  }
})(typeof window !== "undefined" ? window : globalThis);
