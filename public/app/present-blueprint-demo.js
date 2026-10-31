/* Capital Blueprint dashboard, inside the closer's slides (visual C).
   Board: ops/workflows/weekend-2026-10-24.md section 10.4 C, 10.5, 10.8.

   WHAT IT IS. A clickable copy of the client's own Blueprint screens (Home,
   Progress, Money) filled with this client's file from today's pull
   (ctx.visual), or the deck's labeled sample. The closer taps "Next step" and
   five visible builds group the checklist in Chris's paydown-first order;
   the screens change as steps complete. It shows a journey over time. It saves
   nothing, sends nothing and charges nothing.

   WHERE THE STEPS COME FROM. The same catalog the real checklist is seeded
   from: db/migrations/362 (paydown per card, the no-new-credit rule, the LLC,
   the EIN, business checking), 400 (mail the letters, upload the mailing
   proof, upload the bureaus' answers) and 498 (the words say "the Fundhub
   team"). Due windows are those rows' due_offset_days. The order of the walk
   is Chris's Blueprint order (.ai/rules/ad-know-the-offer.md), even though
   the tasks retain their original due-day reminder labels.

   AMOUNTS. Every amount is ctx.visual's (the engine's own) and is printed with
   ctx.money. A null prints nothing. Anything past today says "projects to".
   Nothing here promises an approval, an amount, a score or a removal.

   SLOT CONTRACT (10.8). window.FHDeckVisuals.blueprintDemo(ctx) returns the
   HTML for the slide body. One delegated click listener on document, scoped
   to [data-fhv="blueprint-demo"]. State is kept per ctx.clientId and restored
   on every call, because the deck re-renders often. A tap repaints in place
   and never calls the deck's render. */
(function (root) {
  "use strict";

  var NAME = "blueprint-demo";
  var P = "fhv-" + NAME + "-";
  var STYLE_ID = P + "style";
  var doc = root.document;
  var FHV = root.FHDeckVisuals || (root.FHDeckVisuals = {});
  var states = {};

  /* ── small helpers ────────────────────────────────────────────────────── */

  function escLocal(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (ch) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch];
    });
  }
  function moneyLocal(n) {
    if (n == null || !isFinite(Number(n))) return "";
    return "$" + Math.round(Number(n)).toLocaleString("en-US");
  }
  function isNum(v) { return typeof v === "number" && isFinite(v); }
  /* A css width or offset. Zero is written as 0, never as a percent. */
  function pctCss(n) { return isNum(n) && n > 0 ? n + "%" : "0"; }
  function list(v) { return Array.isArray(v) ? v : []; }
  function c(name) { return P + name; }
  /* An option id saved where an answer should be is not an answer (present.js
     isOptionId). Print only words a person wrote. */
  function answer(v) {
    if (v == null) return "";
    if (typeof v === "number") return v >= 10000 ? "" : String(v);
    var s = String(v).trim();
    if (!s || /^\d{5,}$/.test(s)) return "";
    return s;
  }
  function reducedMotion() {
    try { return !!(root.matchMedia && root.matchMedia("(prefers-reduced-motion: reduce)").matches); }
    catch (e) { return false; }
  }

  var KIND_WORDS = {
    charge_off: "Charge-off", collection: "Collection", late: "Late payment",
    medical: "Medical", public_record: "Public record", other: "Negative item"
  };
  var BUREAU_WORDS = { EX: "Experian", EQ: "Equifax", TU: "TransUnion" };

  /* ── the catalog tasks in the owner's call walkthrough order ─────────── */

  function buildSteps(ctx) {
    var v = ctx.visual || null;
    var money = ctx.money;
    var cards = v ? list(v.cards) : [];
    var steps = [];

    if (cards.length) {
      cards.forEach(function (card, i) {
        var target = isNum(card.target) ? money(card.target) : "";
        steps.push({ key: "card" + i, kind: "task", file: true, owner: "you", day: 30, card: i,
          chip: "Card " + (i + 1),
          title: "Pay " + (card.creditor || "this card") + " down" + (target ? " to " + target : ""),
          detail: "You do not have to do it in one payment. Anything you put against this card moves the balance toward the target." });
      });
    } else {
      steps.push({ key: "cards", kind: "task", file: true, owner: "you", day: 30, chip: "Cards",
        title: "Pay each card down to 10% of its limit",
        detail: "One task per card, from your own pull. Anything you put against a card moves it toward the target." });
    }

    steps.push({ key: "mail", kind: "task", file: true, owner: "you", day: 14, chip: "Mail",
      title: "Print and mail your dispute letters",
      detail: "Print the letters from your pack, sign where marked, and mail a copy to each bureau. Keep your post office receipt." });
    steps.push({ key: "proof", kind: "task", file: true, owner: "you", day: 21, chip: "Proof",
      title: "Upload your mailing proof",
      detail: "Take a clear photo of your post office receipt or the stamped envelopes and upload it." });
    steps.push({ key: "bureaus", kind: "task", file: true, owner: "you", day: 45, chip: "Bureaus",
      title: "Upload bureau responses when they arrive",
      detail: "When a bureau writes back, photograph or scan the letter and upload it." });

    steps.push({ key: "business", kind: "task", file: false, owner: "you", day: 30, chip: "Business",
      title: "Set up your business",
      subs: ["File your LLC", "Get your EIN from the IRS", "Open a business checking account"],
      detail: "File with the Secretary of State. Get your EIN on IRS.gov at no cost. Open the checking account in the LLC name with the EIN." });

    /* Business 1 and 2: the client's own companies first, then "if you add a
       company" from the engine's new-company rule. */
    var companies = v ? list(v.companies) : [];
    if (!companies.length) {
      companies = list(ctx.businesses).map(function (b) {
        return { name: b && b.name, amount: null, fromDeck: true };
      });
    }
    var added = v && v.newCompany ? v.newCompany : null;
    for (var n = 0; n < 2; n++) {
      var own = companies[n];
      if (own) {
        steps.push({ key: "biz" + (n + 1), kind: "milestone", chip: "Business " + (n + 1),
          title: "Business " + (n + 1) + " ready", name: own.name || "", amount: isNum(own.amount) ? own.amount : null,
          detail: "Primed and bank-ready: the LLC, the EIN and business checking, in the file's walk order." });
      } else {
        steps.push({ key: "biz" + (n + 1), kind: "milestone", chip: "Business " + (n + 1), added: true,
          title: "Business " + (n + 1) + " ready", name: "If you add a company",
          amount: added && isNum(added.year1) ? added.year1 : null,
          detail: "A picture of what is possible. It never changes what you qualify for today." });
      }
    }

    steps.push({ key: "sequence", kind: "milestone", chip: "Sequence",
      title: "Next funding sequence", name: "Step by step",
      detail: "Round after round. A round is personal only or personal plus business. Every company brings its own business credit." });
    return steps;
  }

  /* ── state ────────────────────────────────────────────────────────────── */

  function stateFor(ctx) {
    var id = ctx && ctx.clientId != null ? String(ctx.clientId) : "_";
    var st = states[id];
    if (!st) {
      st = states[id] = { id: id, step: 0, panel: "home", tab: "credit", open: null, shown: {} };
    }
    st.ctx = ctx;
    st.steps = buildSteps(ctx);
    if (st.step > st.steps.length) st.step = st.steps.length;
    return st;
  }
  function isDone(st, i) { return i < st.step; }
  function doneByKey(st, key) {
    for (var i = 0; i < st.steps.length; i++) if (st.steps[i].key === key) return isDone(st, i);
    return false;
  }
  function atEnd(st) { return st.step >= st.steps.length; }

  /* What the file looks like at this step. */
  function fileView(st) {
    var ctx = st.ctx, v = ctx.visual || null;
    var cards = v ? list(v.cards) : [];
    var fileTasks = st.steps.filter(function (s) { return s.kind === "task" && s.file; });
    var fileDone = 0;
    st.steps.forEach(function (s, i) { if (s.kind === "task" && s.file && isDone(st, i)) fileDone++; });
    var frac = fileTasks.length ? fileDone / fileTasks.length : 0;
    var allCardsDone = cards.length ? cards.every(function (_, i) { return doneByKey(st, "card" + i); }) : doneByKey(st, "cards");

    var mailed = doneByKey(st, "mail");
    var answered = doneByKey(st, "bureaus");

    var cardRows = cards.map(function (card, i) {
      var done = doneByKey(st, "card" + i);
      var balance = isNum(card.balance) ? card.balance : null;
      var target = isNum(card.target) ? card.target : null;
      var limit = isNum(card.limit) ? card.limit : null;
      var shownBalance = (done && target != null && balance != null) ? Math.min(balance, target) : balance;
      var pct = null;
      if (limit != null && limit > 0 && shownBalance != null) pct = Math.round((shownBalance / limit) * 100);
      else if (!done && isNum(card.usePct)) pct = Math.round(card.usePct);
      else if (done && target != null && limit && limit > 0) pct = Math.round((target / limit) * 100);
      return { creditor: card.creditor || "Card", limit: limit, balance: shownBalance, startBalance: balance, target: target, pct: pct, done: done };
    });

    /* How much you qualify for: today, then each applied lever's totalAfter. */
    var qualify = v && isNum(v.todayTotal) ? v.todayTotal : null;
    var projected = false, stage = null;
    if (v) {
      var levers = list(v.levers);
      var lever = function (key) {
        for (var i = 0; i < levers.length; i++) if (levers[i] && levers[i].key === key) return levers[i];
        return null;
      };
      var pay = lever("paydown"), clean = lever("clean"), acct = lever("accounts");
      if (allCardsDone && pay && pay.applies && isNum(pay.totalAfter)) { qualify = pay.totalAfter; projected = true; stage = "paydown"; }
      if (answered && clean && clean.applies && isNum(clean.totalAfter)) { qualify = clean.totalAfter; projected = true; stage = "clean"; }
      if (doneByKey(st, "biz1") && acct && acct.applies && isNum(acct.totalAfter)) { qualify = acct.totalAfter; projected = true; stage = "accounts"; }
    }

    var fund = null;
    if (v && v.fundability && v.fundability.now && isNum(v.fundability.now.passed) && isNum(v.fundability.now.total)) {
      var now = v.fundability.now, after = v.fundability.after || now;
      var toPassed = isNum(after.passed) ? after.passed : now.passed;
      var passed = Math.round(now.passed + (toPassed - now.passed) * frac);
      fund = { passed: passed, total: now.total, now: now.passed, after: toPassed };
    }

    var items = (v ? list(v.items) : []).map(function (it) {
      var status = !mailed ? { word: "On your file", cls: "soft" }
        : !answered ? { word: "Disputed", cls: "info" }
        : { word: "Bureau answered", cls: "ok", sub: "If it comes off" };
      return { creditor: it.creditor || "Item", kind: KIND_WORDS[it.kind] || KIND_WORDS.other,
        bureaus: list(it.bureaus).map(function (b) { return BUREAU_WORDS[b] || b; }), status: status };
    });

    return { cards: cardRows, qualify: qualify, projected: projected, stage: stage, fund: fund, items: items, frac: frac,
      optimized: v && isNum(v.optimizedTotal) ? v.optimizedTotal : null, allCardsDone: allCardsDone, mailed: mailed, answered: answered };
  }

  /* ── pieces ───────────────────────────────────────────────────────────── */

  function tag(ctx) {
    return ctx.sample ? '<span class="' + c("tag") + '">Sample</span>' : "";
  }
  function eyebrow(t) { return '<div class="' + c("eyebrow") + '">' + t + "</div>"; }
  function badge(word, cls) {
    return '<span class="' + c("badge") + " " + c("badge-" + cls) + '">' + word + "</span>";
  }
  function countEl(st, key, value, fmt, cls) {
    var ctx = st.ctx;
    var text = fmt === "money" ? ctx.money(value) : (fmt === "pct" ? value + "%" : String(value));
    var from = isNum(st.shown[key]) ? st.shown[key] : null;
    st.shown[key] = value;
    return '<span class="' + (cls || c("big")) + '" data-bd-count data-key="' + ctx.esc(key) + '" data-to="' + value +
      '" data-from="' + (from == null ? "" : from) + '" data-fmt="' + fmt + '">' + ctx.esc(text) + "</span>";
  }

  function heroCard(st, fv) {
    var ctx = st.ctx;
    if (fv.qualify == null) {
      /* No pull yet, or the engine is holding the amount (review or hold):
         no figure at all. The steps and the cards still move. */
      return '<section class="' + c("card") + '">' + eyebrow("How much you qualify for") +
        '<p class="' + c("body") + '">' + (ctx.visual ? "UnderwriteIQ has not printed an amount for this pull. The steps still move." : "Fills in from today’s pull.") + "</p></section>";
    }
    return '<section class="' + c("card") + " " + c("hero") + '">' + eyebrow("How much you qualify for" + (ctx.sample ? " · sample" : "")) +
      heroLines(st, fv) + "</section>";
  }

  /* What moved the amount, in plain words. */
  var STAGE_WORDS = {
    paydown: "After the cards are paid down.",
    clean: "If the disputed items come off.",
    accounts: "After accounts are added."
  };

  /* The amount, what changed it, and the fully optimized line. "Today" shows
     only on today's amount, and "projects to" is said once, on the line under. */
  function heroLines(st, fv) {
    var ctx = st.ctx;
    var html = '<div class="' + c("heroline") + '">' + countEl(st, "qualify", fv.qualify, "money") +
      (fv.projected ? "" : badge("Today", "ink")) + "</div>" +
      '<p class="' + c("stage") + '">' + (fv.projected ? (STAGE_WORDS[fv.stage] || "After the plan is walked.") : "From today’s pull.") + "</p>";
    if (fv.optimized != null && fv.optimized !== fv.qualify) {
      html += '<p class="' + c("caption") + '">Fully optimized: projects to ' + ctx.esc(ctx.money(fv.optimized)) + ".</p>";
    } else if (fv.projected) {
      html += '<p class="' + c("caption") + '">The fully optimized file.</p>';
    }
    return html;
  }

  function pinCard() {
    return '<section class="' + c("card") + " " + c("pin") + '">' + eyebrow("Pinned · a rule to keep") +
      '<div class="' + c("title") + '">Do not open new credit while we work on your file.</div>' +
      '<p class="' + c("caption") + '">A new card adds a hard inquiry and lowers the average age of your accounts. Talk to the Fundhub team before you apply for anything.</p></section>';
  }

  function nextCard(st) {
    var ctx = st.ctx;
    if (atEnd(st)) return "";
    var s = st.steps[st.step];
    var mine = s.kind === "task";
    var html = '<section class="' + c("card") + " " + c("next") + '">' +
      '<div class="' + c("meta") + '">' + badge(mine ? "Your move" : "Our move", mine ? "warn" : "info") +
      (s.day ? badge("Day " + s.day, "soft") : "") + "</div>" +
      '<div class="' + c("title") + '">' + ctx.esc(s.title) + "</div>" +
      '<p class="' + c("caption") + '">' + ctx.esc(mine ? "This one is yours. Nothing moves until it is done." : s.detail) + "</p>";
    if (mine) {
      html += '<button type="button" class="' + c("ghost") + '" data-bd-act="task:' + ctx.esc(s.key) + '">See the reminder you get</button>';
    }
    return html + "</section>";
  }

  function stageCard(st) {
    var ctx = st.ctx;
    var total = st.steps.length;
    var done = Math.min(st.step, total);
    var line = atEnd(st) ? "Every step on the plan is walked." : "Step " + (st.step + 1) + " of " + total + ": " + st.steps[st.step].title + ".";
    var pct = total ? Math.round((done / total) * 100) : 0;
    return '<section class="' + c("card") + '">' + eyebrow("Where you are") +
      '<div class="' + c("title") + '">' + ctx.esc(line) + "</div>" +
      orderDiagram(st) +
      '<div class="' + c("meter") + '" role="img" aria-label="' + done + " of " + total + ' steps done"><i style="width:' + pctCss(pct) + '"></i></div>' +
      '<p class="' + c("caption") + '">' + done + " of " + total + " steps done. Step by step.</p></section>";
  }

  function orderDiagram(st) {
    var cardKeys = st.steps.filter(function (s) { return s.card != null || s.key === "cards"; }).map(function (s) { return s.key; });
    var phases = [
      { key: "paydown", label: "Pay cards down", keys: cardKeys },
      { key: "disputes", label: "Dispute items", keys: ["mail", "proof", "bureaus"] },
      { key: "business1", label: "Business 1", keys: ["business", "biz1"] },
      { key: "business2", label: "Business 2", keys: ["biz2"] },
      { key: "fundability", label: "More fundability", keys: ["sequence"] }
    ];
    var firstOpen = phases.findIndex(function (phase) { return !phase.keys.every(function (key) { return doneByKey(st, key); }); });
    return '<ol class="' + c("order") + '" aria-label="Your plan in order">' + phases.map(function (phase, i) {
      var done = phase.keys.every(function (key) { return doneByKey(st, key); });
      var active = i === firstOpen;
      return '<li class="' + c("orderstep") + (done ? " " + c("orderdone") : "") + (active ? " " + c("orderactive") : "") +
        '" data-bd-phase="' + phase.key + '"' + (active ? ' aria-current="step"' : "") + '><span class="' + c("ordernum") + '">' +
        (done ? "✓" : i + 1) + '</span><span class="' + c("orderlabel") + '">' + phase.label + "</span></li>";
    }).join("") + "</ol>";
  }

  function phaseEnds(st) {
    var indexOf = function (key) {
      for (var i = 0; i < st.steps.length; i++) if (st.steps[i].key === key) return i + 1;
      return 0;
    };
    var cards = st.steps.filter(function (s) { return s.card != null || s.key === "cards"; });
    return [indexOf(cards[cards.length - 1].key), indexOf("bureaus"), indexOf("biz1"), indexOf("biz2"), indexOf("sequence")];
  }

  function homePanel(st, fv) {
    if (atEnd(st)) return monthsPanel(st, fv);
    return stageCard(st) + heroCard(st, fv) + nextCard(st) + pinCard();
  }

  function monthsPanel(st, fv) {
    var ctx = st.ctx, v = ctx.visual || null;
    var html = '<section class="' + c("card") + '">' + eyebrow("Your next 12 months") +
      '<div class="' + c("h2") + '">Your plan, walked.</div>';
    if (fv.qualify != null) {
      html += heroLines(st, fv);
    }
    var motivation = answer(ctx.survey && ctx.survey.motivation);
    if (motivation) {
      html += '<blockquote class="' + c("quote") + '">You said this changes: “' + ctx.esc(motivation) + '”</blockquote>';
    }
    html += "</section>";

    var rows = [];
    if (fv.cards.length) {
      rows.push(["Cards at their 10% targets", fv.cards.map(function (r) {
        return r.target != null ? ctx.esc(r.creditor) + " → " + ctx.esc(ctx.money(r.target)) : ctx.esc(r.creditor);
      }).join(" · ")]);
    }
    if (fv.items.length) rows.push(["Items disputed and answered", fv.items.length + (fv.items.length === 1 ? " item" : " items") + ". If they come off."]);
    if (fv.fund) rows.push(["Fundability checks", fv.fund.now + " of " + fv.fund.total + " → projects to " + fv.fund.after + " of " + fv.fund.total]);
    st.steps.forEach(function (s) {
      if (s.kind !== "milestone" || s.key === "sequence") return;
      rows.push([s.title, ctx.esc(s.name) + (s.amount != null ? " · projects to " + ctx.esc(ctx.money(s.amount)) + (s.added ? " in year 1" : "") : "")]);
    });
    rows.push(["Next funding sequence", "Step by step. Round after round."]);
    if (!v) rows.unshift(["Today’s pull", "Fills every amount in."]);

    html += '<section class="' + c("card") + '">' + rows.map(function (r) {
      return '<div class="' + c("row") + '"><div class="' + c("rowl") + '">' + r[0] + '</div><div class="' + c("rowr") + '">' + r[1] + "</div></div>";
    }).join("") + '<p class="' + c("caption") + '">A preview from today’s pull. Not a promise of an approval, an amount, a score or a removal.</p></section>';
    return html + pinCard();
  }

  /* Progress: the checklist in the call walkthrough order, each row a button. */
  function progressPanel(st) {
    var ctx = st.ctx;
    var html = stageCard(st) + '<section class="' + c("card") + '">' + eyebrow("Your checklist") +
      '<ul class="' + c("list") + '">';
    st.steps.forEach(function (s, i) {
      var done = isDone(st, i), current = i === st.step;
      var isTask = s.kind === "task";
      var who = isTask ? badge("You", "warn") : badge("Us", "info");
      var when = s.day ? badge("Day " + s.day, "soft") : badge("Step by step", "soft");
      var subs = s.subs ? '<div class="' + c("subs") + '">' + s.subs.map(function (x) { return "<span>" + (done ? "✓ " : "") + ctx.esc(x) + "</span>"; }).join("") + "</div>" : "";
      var name = s.name ? '<div class="' + c("caption") + '">' + ctx.esc(s.name) + (s.amount != null ? " · projects to " + ctx.esc(ctx.money(s.amount)) + (s.added ? " in year 1" : "") : "") + "</div>" : "";
      html += '<li><button type="button" class="' + c("wp") + (done ? " " + c("done") : "") + (current ? " " + c("current") : "") +
        '" data-bd-act="task:' + ctx.esc(s.key) + '" aria-label="' + ctx.esc(s.title) + (isTask ? ". See the reminder." : ". See what it means.") + '">' +
        '<span class="' + c("tick") + '" aria-hidden="true">' + (done ? "✓" : "") + "</span>" +
        '<span class="' + c("wpbody") + '"><span class="' + c("wptitle") + '">' + ctx.esc(s.title) + "</span>" + subs + name +
        '<span class="' + c("meta") + '">' + who + when + (done ? badge("Done", "ok") : (current ? badge("Now", "ink") : "")) + "</span></span></button></li>";
    });
    html += "</ul></section>";
    html += '<section class="' + c("card") + " " + c("pin") + '">' + eyebrow("A rule to keep · nothing to tick") +
      '<div class="' + c("title") + '">Do not open new credit while we work on your file.</div>' +
      '<p class="' + c("caption") + '">Talk to the Fundhub team before you apply for anything.</p></section>';
    return html;
  }

  /* Money: Credit, Fundability, Strategy, Banks. */
  function moneyPanel(st, fv) {
    var ctx = st.ctx;
    var tabs = [["credit", "Credit"], ["fundability", "Fundability"], ["strategy", "Strategy"], ["banks", "Banks"]];
    var html = '<div class="' + c("tabs") + '" role="tablist" aria-label="Money">' + tabs.map(function (t) {
      var on = st.tab === t[0];
      return '<button type="button" role="tab" class="' + c("tab") + (on ? " " + c("on") : "") + '" aria-selected="' + on + '" data-bd-act="tab:' + t[0] + '">' + t[1] + "</button>";
    }).join("") + "</div>";
    if (st.tab === "fundability") html += fundabilityTab(st, fv);
    else if (st.tab === "strategy") html += strategyTab(st, fv);
    else if (st.tab === "banks") html += banksTab(st, fv);
    else html += creditTab(st, fv);
    return html;
  }

  function cardBar(st, r, i) {
    var ctx = st.ctx;
    var fillPct = r.pct != null ? Math.max(0, Math.min(100, r.pct)) : 0;
    var targetPct = (r.target != null && r.limit) ? Math.max(0, Math.min(100, Math.round((r.target / r.limit) * 100))) : null;
    var usePlain = r.pct == null ? "balance" : (r.pct <= 0 ? "paid down" : r.pct + "% used");
    var useWord = r.pct == null ? "" : (r.pct <= 0 ? "paid down" : countEl(st, "pct" + i, r.pct, "pct", c("num")) + " used");
    var amounts = [];
    if (r.balance != null) amounts.push(countEl(st, "bal" + i, r.balance, "money", c("num")));
    if (r.limit != null) amounts.push("of " + ctx.esc(ctx.money(r.limit)));
    return '<div class="' + c("cardrow") + '">' +
      '<div class="' + c("rowtop") + '"><span class="' + c("creditor") + '">' + ctx.esc(r.creditor) + "</span>" +
      (r.done ? badge("At target", "ok") : (r.target != null ? badge("Pay down", "warn") : "")) + "</div>" +
      '<div class="' + c("bar") + '" role="img" aria-label="' + ctx.esc(usePlain) + '">' +
      '<i class="' + c("fill") + '" style="width:' + pctCss(fillPct) + '"></i>' +
      (targetPct != null ? '<b class="' + c("mark") + '" style="left:' + pctCss(targetPct) + '" title="10% target"></b>' : "") + "</div>" +
      '<div class="' + c("barline") + '"><span>' + amounts.join(" ") + "</span><span>" + useWord +
      (r.target != null && !r.done ? " · target " + ctx.esc(ctx.money(r.target)) : "") + "</span></div></div>";
  }

  function creditTab(st, fv) {
    var ctx = st.ctx;
    var html = '<section class="' + c("card") + '">' + eyebrow("Your cards" + (ctx.sample ? " · sample" : ""));
    if (fv.cards.length) {
      html += fv.cards.map(function (r, i) { return cardBar(st, r, i); }).join("");
      html += '<p class="' + c("caption") + '">The line on each bar is the 10% target. A paydown task closes when a new pull shows the lower balance.</p>';
    } else {
      html += '<p class="' + c("body") + '">' + (ctx.visual ? "No revolving cards on this pull." : "Your cards fill in from today’s pull.") + "</p>";
    }
    html += "</section>";

    html += '<section class="' + c("card") + '">' + eyebrow("Negative items");
    if (fv.items.length) {
      html += '<ul class="' + c("items") + '">' + fv.items.map(function (it) {
        return "<li><div><span class=\"" + c("creditor") + '">' + ctx.esc(it.creditor) + '</span><div class="' + c("caption") + '">' + ctx.esc(it.kind) +
          (it.bureaus.length ? " · " + ctx.esc(it.bureaus.join(", ")) : "") + "</div></div>" +
          '<div class="' + c("status") + '">' + badge(it.status.word, it.status.cls) + (it.status.sub ? '<span class="' + c("caption") + '">' + it.status.sub + "</span>" : "") + "</div></li>";
      }).join("") + "</ul>";
      html += '<p class="' + c("caption") + '">Disputed means the letters went out. Bureau answered means the written reply is in. An item comes off only when the bureau takes it off.</p>';
    } else {
      html += '<p class="' + c("body") + '">' + (ctx.visual ? "No negative items on this pull." : "Fills in from today’s pull.") + "</p>";
    }
    return html + "</section>";
  }

  /* Fundability. The count is UnderwriteIQ's own (src/finance/fundability.mjs)
     and the engine gives none on a real file yet, so the meter shows only when
     fundability is there. The six checks, each with what this plan does for
     it, carry the tab either way. */
  function fundabilityTab(st, fv) {
    var ctx = st.ctx;
    var head;
    if (fv.fund) {
      var f = fv.fund, segs = "";
      for (var i = 0; i < f.total; i++) segs += '<i class="' + (i < f.passed ? c("seg-on") : c("seg")) + '"></i>';
      head = '<section class="' + c("card") + " " + c("hero") + '">' + eyebrow("Fundability · UnderwriteIQ checks passed") +
        '<div class="' + c("heroline") + '">' + countEl(st, "fund", f.passed, "int") + '<span class="' + c("of") + '">of ' + f.total + "</span></div>" +
        '<div class="' + c("segs") + '" role="img" aria-label="' + f.passed + " of " + f.total + ' checks passed">' + segs + "</div>" +
        '<p class="' + c("caption") + '">Today ' + f.now + " of " + f.total + ". Projects to " + f.after + " of " + f.total + " once the plan is walked. Each check counts the same.</p></section>";
    } else {
      head = '<section class="' + c("card") + " " + c("hero") + '">' + eyebrow("Fundability") +
        '<div class="' + c("h2") + '">Six checks. Every step works on one.</div>' +
        '<p class="' + c("caption") + '">' + (ctx.visual ? "UnderwriteIQ counts them on your next pull." : "Fills in from today’s pull.") + "</p></section>";
    }
    return head + checksCard(st, fv);
  }

  function checksCard(st, fv) {
    var ctx = st.ctx;
    var cards = fv.cards, items = fv.items;
    var atTarget = cards.filter(function (r) { return r.done; }).length;
    var cardLine = !cards.length ? (ctx.visual ? "No revolving cards on this pull." : "The paydown steps, from your pull.")
      : atTarget === cards.length ? "Every card at its 10% target."
      : atTarget + " of " + cards.length + (cards.length === 1 ? " card" : " cards") + " at target.";
    var cardBadge = !cards.length ? null : (atTarget === cards.length ? ["Done", "ok"] : ["In progress", "warn"]);
    var itemLine = !items.length ? (ctx.visual ? "None on this pull." : "From your pull.")
      : fv.answered ? "Bureau answered. If they come off."
      : fv.mailed ? "Letters out. Disputed."
      : items.length + (items.length === 1 ? " item on your file." : " items on your file.");
    var itemBadge = !items.length ? null : (fv.answered ? ["Answered", "info"] : ["In progress", "warn"]);
    var rows = [
      ["Cards used 30% or less", cardLine, cardBadge],
      ["No negative items", itemLine, itemBadge],
      ["No hard inquiries", "No new credit while we work.", null],
      ["A card 2+ years old, $5,000+ limit", "Keep your oldest cards open.", null],
      ["3 or more accounts in good standing", "Pay on time, every month.", null],
      ["Credit score 700 or higher", "Read on your next pull.", null]
    ];
    return '<section class="' + c("card") + '">' + eyebrow("The six checks · what this plan does for each") +
      '<ul class="' + c("checks") + '">' + rows.map(function (r) {
        return "<li><div><div class=\"" + c("creditor") + '">' + ctx.esc(r[0]) + '</div><div class="' + c("caption") + '">' + ctx.esc(r[1]) + "</div></div>" +
          (r[2] ? badge(r[2][0], r[2][1]) : "") + "</li>";
      }).join("") + "</ul>" +
      '<p class="' + c("caption") + '">UnderwriteIQ counts these on your newest pull. Each check counts the same.</p></section>';
  }

  function strategyTab(st, fv) {
    var ctx = st.ctx;
    var capital = answer(ctx.survey && ctx.survey.capital);
    var html = '<section class="' + c("card") + '">' + eyebrow("Pay the cards down · in this order");
    if (capital) html += '<p class="' + c("body") + '">You said you have ' + ctx.esc(capital) + " on hand. Start here.</p>";
    if (fv.cards.length) {
      var order = fv.cards.map(function (r, i) { return { r: r, i: i }; }).sort(function (a, b) {
        return (b.r.pct == null ? -1 : b.r.pct) - (a.r.pct == null ? -1 : a.r.pct);
      });
      html += '<ol class="' + c("plan") + '">' + order.map(function (o, k) {
        var r = o.r;
        var need = (r.startBalance != null && r.target != null) ? Math.max(0, r.startBalance - r.target) : null;
        return '<li><span class="' + c("stepn") + '">' + (k + 1) + '</span><div><div class="' + c("creditor") + '">' + ctx.esc(r.creditor) +
          (r.target != null ? " → " + ctx.esc(ctx.money(r.target)) : "") + "</div>" +
          '<div class="' + c("caption") + '">' + (r.done ? "At target." : (need != null ? ctx.esc(ctx.money(need)) + " to pay down." : "Target set from your limit.")) + "</div></div>" +
          (r.done ? badge("Done", "ok") : (k === 0 ? badge("Start here", "ink") : "")) + "</li>";
      }).join("") + "</ol>";
    } else {
      html += '<p class="' + c("body") + '">' + (ctx.visual ? "No cards to pay down on this pull." : "Fills in from today’s pull.") + "</p>";
    }
    html += "</section>" + pinCard();
    return html;
  }

  function banksTab(st, fv) {
    var ctx = st.ctx;
    var rows = [["Personal file", fv.answered && fv.allCardsDone ? badge("Ready", "ok") : badge("In progress", "warn"), "Prime first. Nothing else is worth doing until it is."]];
    st.steps.forEach(function (s) {
      if (s.kind !== "milestone" || s.key === "sequence") return;
      rows.push([s.title.replace(" ready", ""), doneByKey(st, s.key) ? badge("Ready", "ok") : badge("Waiting", "soft"), s.name + (s.amount != null ? " · projects to " + ctx.money(s.amount) + (s.added ? " in year 1" : "") : "")]);
    });
    rows.push(["The lender list", fv.answered && fv.allCardsDone ? badge("Opens", "info") : badge("Waiting", "soft"), "Banks that fit this file, in the right order."]);
    return '<section class="' + c("card") + '">' + eyebrow("Banks · the walk order") +
      '<ul class="' + c("walk") + '">' + rows.map(function (r) {
        return "<li><div><div class=\"" + c("creditor") + '">' + ctx.esc(r[0]) + '</div><div class="' + c("caption") + '">' + ctx.esc(r[2]) + "</div></div>" + r[1] + "</li>";
      }).join("") + "</ul>" +
      '<p class="' + c("caption") + '">This funding sequence, then the next. Every company brings its own business credit.</p></section>';
  }

  /* The phone: the reminders a client gets for one task. */
  function phone(st) {
    var ctx = st.ctx;
    var s = null;
    for (var i = 0; i < st.steps.length; i++) if (st.steps[i].key === st.open) s = st.steps[i];
    if (!s) return "";
    var title = ctx.esc(s.title);
    var body;
    if (s.kind === "task") {
      var d = s.day || 0;
      body = '<div class="' + c("bubbles") + '">' +
        '<div class="' + c("when") + '">Day ' + d + " · text</div><div class=\"" + c("bubble") + '">Today’s step: ' + title + ". Open your portal to finish it.</div>" +
        '<div class="' + c("when") + '">Day ' + (d + 2) + " · email</div><div class=\"" + c("bubble") + " " + c("mail") + '"><b>Still open: ' + title + "</b>Here is the step again, with the how-to.</div>" +
        '<div class="' + c("when") + '">Day ' + (d + 5) + " · text</div><div class=\"" + c("bubble") + '">5 days past due: ' + title + ". Need a hand? Reply here.</div>" +
        '<div class="' + c("when") + '">Day ' + (d + 9) + " · the Fundhub team</div><div class=\"" + c("bubble") + " " + c("team") + '">The Fundhub team steps in and walks it with you.</div></div>';
    } else {
      body = '<div class="' + c("bubbles") + '"><div class="' + c("when") + '">Step by step</div><div class="' + c("bubble") + '">' + title + ". " + ctx.esc(s.detail) + "</div>" +
        (s.added ? '<div class="' + c("when") + '">If you add a company</div><div class="' + c("bubble") + '">A picture of what is possible. It never changes what you qualify for today.</div>' : "") + "</div>";
    }
    return '<div class="' + c("sheet") + '" role="dialog" aria-label="' + title + '">' +
      '<div class="' + c("sheethd") + '"><div>' + eyebrow(s.kind === "task" ? "The reminders you get" : "What this step means") + '<div class="' + c("title") + '">' + title + "</div></div>" +
      '<button type="button" class="' + c("ghost") + '" data-bd-act="close">Close</button></div>' +
      '<div class="' + c("phone") + '"><div class="' + c("notch") + '"></div>' + body + "</div>" +
      (s.kind === "task" ? '<p class="' + c("caption") + '">A text on the due day, an email 2 days later, a text at 5 days late, and the Fundhub team at 9 days.</p>' : "") + "</div>";
  }

  /* The strip and the Next step button. */
  function footer(st) {
    var ends = phaseEnds(st);
    var labels = ["Cards", "Items", "Business 1", "Business 2", "Fundability"];
    var chips = labels.map(function (label, i) {
      var start = i ? ends[i - 1] : 0;
      var done = st.step >= ends[i], current = st.step >= start && st.step < ends[i];
      return '<button type="button" class="' + c("chip") + (done ? " " + c("done") : "") + (current ? " " + c("current") : "") +
        '" data-bd-act="goto:' + start + '" aria-label="Build ' + (i + 1) + ": " + label + (done ? ", walked" : "") + '"' + (current ? ' aria-current="step"' : "") + ">" +
        '<span class="' + c("chipn") + '">' + (done ? "✓" : (i + 1)) + "</span>" + label + "</button>";
    }).join("");
    return '<div class="' + c("foot") + '"><div class="' + c("strip") + '">' + chips + "</div>" +
      '<div class="' + c("acts") + '">' +
      '<button type="button" class="' + c("ghost") + '" data-bd-act="back"' + (st.step === 0 ? " disabled" : "") + ">Back</button>" +
      '<button type="button" class="' + c("nextbtn") + '" data-bd-act="' + (atEnd(st) ? "restart" : "build") + '">' + (atEnd(st) ? "Start over" : "Next step") + "</button></div></div>";
  }

  function inner(st) {
    var ctx = st.ctx;
    var fv = fileView(st);
    var panel = st.open ? phone(st)
      : st.panel === "progress" ? progressPanel(st)
      : st.panel === "money" ? moneyPanel(st, fv)
      : homePanel(st, fv);
    var rail = [["home", "Home"], ["progress", "Progress"], ["money", "Money"]].map(function (r) {
      var on = st.panel === r[0] && !st.open;
      return '<button type="button" class="' + c("railbtn") + (on ? " " + c("on") : "") + '" aria-pressed="' + on + '" data-bd-act="panel:' + r[0] + '">' + r[1] + "</button>";
    }).join("");
    var banner = "Your plan, step by step. A preview built from today’s pull." + (ctx.visual ? "" : " No pull yet.");
    return '<div class="' + c("banner") + '"><span class="' + c("bannertext") + '">' + banner + "</span>" + tag(ctx) + "</div>" +
      '<div class="' + c("frame") + '"><nav class="' + c("rail") + '" aria-label="Blueprint dashboard">' + rail + "</nav>" +
      '<div class="' + c("panel") + '">' + panel + "</div></div>" + footer(st);
  }

  /* ── taps ─────────────────────────────────────────────────────────────── */

  function apply(st, act) {
    var parts = String(act || "").split(":");
    var kind = parts[0], arg = parts.slice(1).join(":");
    if (kind === "next") { if (!atEnd(st)) st.step += 1; st.open = null; }
    else if (kind === "build") {
      var forward = phaseEnds(st).filter(function (end) { return end > st.step; });
      if (forward.length) st.step = forward[0];
      st.open = null;
    }
    else if (kind === "back") {
      var prior = [0].concat(phaseEnds(st)).filter(function (end) { return end < st.step; });
      if (prior.length) st.step = prior[prior.length - 1];
      st.open = null;
    }
    else if (kind === "restart") { st.step = 0; st.open = null; st.panel = "home"; }
    else if (kind === "goto") { var i = Number(arg); if (isNum(i) && i >= 0 && i <= st.steps.length) st.step = i; st.open = null; }
    else if (kind === "panel") { st.panel = arg || "home"; st.open = null; }
    else if (kind === "tab") { st.tab = arg || "credit"; st.panel = "money"; st.open = null; }
    else if (kind === "task") { st.open = arg || null; }
    else if (kind === "close") { st.open = null; }
  }

  function paint(rootEl, st) {
    rootEl.innerHTML = inner(st);
    animateCounts(rootEl, st);
    settleStrip(rootEl);
  }

  /* The step strip scrolls inside its own box. Keep the current chip in view,
     and drop the edge fade when every chip already fits. */
  function settleStrip(rootEl) {
    if (!rootEl.querySelector) return;
    var strip = rootEl.querySelector("." + c("strip"));
    if (!strip) return;
    if (strip.scrollWidth <= strip.clientWidth + 1) strip.classList.add(c("fits"));
    var cur = strip.querySelector('[aria-current="step"]');
    if (cur && cur.scrollIntoView) {
      try { cur.scrollIntoView({ block: "nearest", inline: "center", behavior: reducedMotion() ? "auto" : "smooth" }); } catch (e) { /* older engines */ }
    }
  }

  function animateCounts(rootEl, st) {
    if (!rootEl.querySelectorAll || reducedMotion() || !root.requestAnimationFrame) return;
    var els = rootEl.querySelectorAll("[data-bd-count]");
    var money = st.ctx.money;
    Array.prototype.forEach.call(els, function (el) {
      var to = Number(el.getAttribute("data-to"));
      var fromRaw = el.getAttribute("data-from");
      var from = fromRaw === "" || fromRaw == null ? null : Number(fromRaw);
      if (from == null || !isFinite(from) || !isFinite(to) || from === to) return;
      var fmt = el.getAttribute("data-fmt");
      var final = el.textContent;
      var show = function (val) { el.textContent = fmt === "money" ? money(val) : (fmt === "pct" ? val + "%" : String(val)); };
      /* Start on the old value now, so the final one never flashes first. The
         busy mark comes off on the last frame; the checks wait for that. */
      el.setAttribute("data-bd-busy", "1");
      show(from);
      var t0 = null, dur = 700;
      function frame(ts) {
        if (t0 == null) t0 = ts;
        var p = Math.min(1, (ts - t0) / dur);
        var e = 1 - Math.pow(1 - p, 3);
        show(Math.round(from + (to - from) * e));
        if (p < 1) { root.requestAnimationFrame(frame); return; }
        el.textContent = final;
        el.removeAttribute("data-bd-busy");
      }
      root.requestAnimationFrame(frame);
    });
  }

  /* The deck inserts the returned string itself, so on a first render the strip
     is settled one frame later, once the element exists. */
  function settleSoon(id) {
    var later = root.requestAnimationFrame || root.setTimeout;
    if (!doc || !doc.querySelector || typeof later !== "function") return;
    later(function () {
      var el = doc.querySelector('[data-fhv="' + NAME + '"][data-client="' + String(id).replace(/"/g, "") + '"]');
      if (el) settleStrip(el);
    });
  }

  function onTap(e) {
    var t = e && e.target && e.target.closest ? e.target.closest("[data-bd-act]") : null;
    if (!t || t.disabled) return;
    var rootEl = t.closest('[data-fhv="' + NAME + '"]');
    if (!rootEl) return;
    if (e.preventDefault) e.preventDefault();
    var st = states[rootEl.getAttribute("data-client") || "_"];
    if (!st || !st.ctx) return;
    try {
      apply(st, t.getAttribute("data-bd-act"));
      paint(rootEl, st);
    } catch (err) {
      rootEl.innerHTML = fallback();
    }
  }

  /* ── css, once ────────────────────────────────────────────────────────── */

  /* SHARED LOOK (design pass, 2026-10-29): the same values as
     present-visuals.js and present-journey.js, so the five visuals read as one
     system. Eyebrow mono 13px .14em uppercase gray; tags and badges a mono 13px
     pill (radius 999, 4px 10px; the Sample tag with a 6px warn dot); the hero
     amount var(--sans) 700 -.03em tabular clamp(28px,4.4cqi,46px); item titles
     17px 650; cards radius 10 and 16px padding; controls radius 8 and 44px
     (the primary 48px); today = solid ink; 700ms motion; focus 2px ink, 3px
     offset. Change one, change all three. */
  var CSS = [
    ".@@root{flex:1;min-height:0;display:flex;flex-direction:column;gap:16px;container-type:inline-size;font-family:var(--sans);color:var(--ink);font-size:16px;line-height:1.45;min-width:0}",
    ".@@root *{box-sizing:border-box;min-width:0}",
    ".@@root button{font-family:inherit;cursor:pointer}",
    ".@@root button:focus-visible{outline:2px solid var(--ink);outline-offset:3px}",
    ".@@banner{display:flex;align-items:center;justify-content:space-between;gap:12px;min-height:28px;font-size:16px;color:var(--ink2)}",
    ".@@bannertext{display:inline-flex;align-items:center;gap:9px}",
    ".@@bannertext::before{content:\"\";display:inline-block;width:16px;height:2px;border-radius:1px;background:var(--spectrum);flex:0 0 auto}",
    ".@@tag{display:inline-flex;align-items:center;gap:7px;font-family:var(--mono);font-size:13px;letter-spacing:.1em;text-transform:uppercase;padding:4px 10px;border:1px solid var(--line);border-radius:999px;background:transparent;color:var(--gray);white-space:nowrap;line-height:1.2;flex:0 0 auto}",
    ".@@tag::before{content:\"\";width:6px;height:6px;border-radius:50%;background:var(--warn)}",
    ".@@frame{flex:1;min-height:0;display:flex;background:#fff;border:1px solid var(--line);border-radius:10px;overflow:hidden}",
    ".@@rail{flex:0 0 144px;display:flex;flex-direction:column;gap:4px;padding:12px;background:var(--soft);border-right:1px solid var(--line)}",
    ".@@railbtn{min-height:44px;padding:0 12px;text-align:left;font-size:16px;font-weight:600;color:var(--ink2);background:transparent;border:1px solid transparent;border-radius:8px}",
    ".@@railbtn.@@on{background:var(--ink);color:var(--paper);border-color:var(--ink)}",
    ".@@panel{flex:1;min-height:0;overflow:auto;padding:16px;display:flex;flex-direction:column;gap:16px;background:var(--paper)}",
    ".@@card{background:#fff;border:1px solid var(--line);border-radius:10px;padding:16px}",
    ".@@pin{border-left:3px solid var(--accent)}",
    ".@@next{border-left:3px solid var(--ink)}",
    ".@@eyebrow{font-family:var(--mono);font-size:13px;letter-spacing:.14em;text-transform:uppercase;color:var(--gray);line-height:1.4;margin-bottom:8px}",
    ".@@title{font-size:clamp(17px,1.4cqi,20px);font-weight:650;letter-spacing:-.015em;line-height:1.3;overflow-wrap:anywhere}",
    ".@@h2{font-size:clamp(22px,2.2cqi,30px);font-weight:700;letter-spacing:-.025em;line-height:1.15;margin:0 0 8px}",
    ".@@body{font-size:16px;color:var(--ink2);margin:0}",
    ".@@caption{font-size:13px;color:var(--gray);margin:8px 0 0;line-height:1.45}",
    ".@@meter{height:8px;border-radius:4px;background:var(--soft);margin:12px 0 0;overflow:hidden}",
    ".@@meter i{display:block;height:100%;background:var(--ink);transition:width .7s cubic-bezier(.2,.7,.3,1)}",
    ".@@order{list-style:none;display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:6px;margin:12px 0 0;padding:0}",
    ".@@orderstep{display:flex;flex-direction:column;align-items:flex-start;gap:5px;min-height:64px;padding:8px;border:1px solid var(--line);border-radius:8px;background:var(--soft);color:var(--gray)}",
    ".@@orderstep.@@orderactive{border-color:var(--ink);background:#fff;color:var(--ink)}",
    ".@@orderstep.@@orderdone{background:var(--ok);border-color:var(--ok);color:var(--ink)}",
    ".@@ordernum{font-family:var(--mono);font-size:13px;font-weight:700;line-height:1}",
    ".@@orderlabel{font-size:13px;font-weight:650;line-height:1.2;overflow-wrap:anywhere}",
    ".@@heroline{display:flex;align-items:baseline;gap:12px;flex-wrap:wrap;margin:0 0 6px}",
    ".@@big{font-family:var(--sans);font-size:clamp(28px,4.4cqi,46px);font-weight:700;letter-spacing:-.03em;line-height:1.05;font-variant-numeric:tabular-nums;color:var(--ink)}",
    ".@@of{font-size:16px;color:var(--gray)}",
    ".@@num{font-variant-numeric:tabular-nums;font-weight:600;color:var(--ink)}",
    ".@@stage{font-size:16px;color:var(--ink2);margin:0}",
    ".@@badge{display:inline-flex;align-items:center;padding:4px 10px;border-radius:999px;font-family:var(--mono);font-size:13px;letter-spacing:.1em;text-transform:uppercase;border:1px solid var(--line);background:var(--soft);color:var(--gray);white-space:nowrap;line-height:1.2}",
    ".@@badge-ok{background:var(--ok);border-color:var(--ok);color:var(--ink)}",
    ".@@badge-warn{background:var(--warn);border-color:var(--warn);color:var(--ink)}",
    ".@@badge-info{background:var(--info);border-color:var(--info);color:var(--ink)}",
    ".@@badge-ink{background:var(--ink);border-color:var(--ink);color:var(--paper)}",
    ".@@meta{display:flex;gap:6px;flex-wrap:wrap;margin:0 0 8px}",
    ".@@wpbody .@@meta{margin:8px 0 0}",
    ".@@ghost{display:inline-flex;align-items:center;justify-content:center;min-height:44px;min-width:44px;padding:0 16px;font-size:16px;font-weight:600;line-height:1.2;color:var(--ink);background:#fff;border:1px solid var(--line);border-radius:8px;margin-top:12px}",
    ".@@ghost:hover{border-color:var(--gray2)}",
    ".@@ghost[disabled]{color:var(--gray2);cursor:default;border-color:var(--line)}",
    ".@@quote{margin:12px 0 0;padding:12px 14px;border-left:3px solid var(--accent);background:var(--soft);border-radius:0 8px 8px 0;font-size:16px;color:var(--ink2)}",
    ".@@row{display:flex;gap:16px;justify-content:space-between;align-items:baseline;padding:10px 0;border-bottom:1px solid var(--line);font-size:16px}",
    ".@@row:last-of-type{border-bottom:0}",
    ".@@rowl{font-weight:600;color:var(--ink)}.@@rowr{color:var(--gray);text-align:right;font-variant-numeric:tabular-nums}",
    ".@@list,.@@items,.@@checks,.@@walk,.@@plan{list-style:none;margin:0;padding:0}",
    ".@@list li+li{margin-top:8px}",
    ".@@wp{display:flex;gap:12px;width:100%;text-align:left;padding:12px 14px;min-height:44px;background:#fff;border:1px solid var(--line);border-radius:10px;color:var(--ink);align-items:flex-start}",
    ".@@wp.@@current{border-color:var(--ink)}",
    ".@@wp.@@done{background:var(--soft)}",
    ".@@tick{flex:0 0 24px;height:24px;border:1px solid var(--gray2);border-radius:6px;display:inline-flex;align-items:center;justify-content:center;font-size:16px;margin-top:2px;background:#fff}",
    ".@@done .@@tick{background:var(--ok);border-color:var(--ok)}",
    ".@@wpbody{flex:1;display:flex;flex-direction:column}",
    ".@@wptitle{font-size:17px;font-weight:650;letter-spacing:-.015em;line-height:1.3;overflow-wrap:anywhere}",
    ".@@subs{display:flex;flex-wrap:wrap;gap:4px 14px;font-size:13px;color:var(--gray);margin-top:4px}",
    ".@@tabs{display:flex;gap:4px;border-bottom:1px solid var(--line);padding-bottom:6px;flex-wrap:wrap}",
    ".@@tab{min-height:44px;padding:0 14px;font-size:16px;font-weight:600;color:var(--gray);background:transparent;border:0;border-bottom:2px solid transparent;border-radius:8px 8px 0 0}",
    ".@@tab.@@on{color:var(--ink);border-bottom-color:var(--ink)}",
    ".@@cardrow{padding:12px 0;border-bottom:1px solid var(--line)}.@@cardrow:last-of-type{border-bottom:0}",
    ".@@rowtop{display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:8px}",
    ".@@creditor{font-size:16px;font-weight:600;overflow-wrap:anywhere}",
    ".@@bar{position:relative;height:12px;border-radius:6px;background:var(--soft);overflow:visible}",
    ".@@fill{position:absolute;left:0;top:0;bottom:0;border-radius:6px;background:var(--ink);transition:width .7s cubic-bezier(.2,.7,.3,1)}",
    ".@@mark{position:absolute;top:-4px;bottom:-4px;width:2px;background:var(--gray2);border-radius:1px}",
    ".@@barline{display:flex;justify-content:space-between;gap:10px;margin-top:8px;font-size:13px;color:var(--gray);flex-wrap:wrap}",
    ".@@items li,.@@walk li{display:flex;justify-content:space-between;gap:12px;align-items:center;padding:10px 0;border-bottom:1px solid var(--line)}",
    ".@@items li:last-of-type,.@@walk li:last-of-type{border-bottom:0}",
    ".@@status{display:flex;flex-direction:column;align-items:flex-end;gap:2px;text-align:right}",
    ".@@segs{display:flex;gap:6px;margin:12px 0 4px}",
    ".@@segs i{flex:1;height:14px;border-radius:4px;background:var(--soft);border:1px solid var(--line)}",
    ".@@segs i.@@seg-on{background:var(--ink);border-color:var(--ink)}",
    ".@@checks li{display:flex;justify-content:space-between;gap:12px;align-items:center;padding:10px 0;border-bottom:1px solid var(--line)}.@@checks li:last-of-type{border-bottom:0}",
    ".@@plan li{display:flex;gap:12px;align-items:center;padding:10px 0;border-bottom:1px solid var(--line)}.@@plan li:last-of-type{border-bottom:0}",
    ".@@plan li>div{flex:1}",
    ".@@stepn{flex:0 0 28px;height:28px;border-radius:50%;background:var(--soft);border:1px solid var(--line);display:inline-flex;align-items:center;justify-content:center;font-family:var(--mono);font-size:13px}",
    ".@@sheet{background:#fff;border:1px solid var(--line);border-radius:10px;padding:16px}",
    ".@@sheethd{display:flex;justify-content:space-between;gap:12px;align-items:flex-start}",
    ".@@sheethd .@@ghost{margin-top:0}",
    ".@@phone{width:min(300px,100%);margin:16px auto 0;border:2px solid var(--ink);border-radius:28px;padding:36px 14px 22px;background:var(--paper);position:relative}",
    ".@@notch{position:absolute;top:10px;left:50%;transform:translateX(-50%);width:84px;height:10px;border-radius:5px;background:var(--ink)}",
    ".@@bubbles{display:flex;flex-direction:column;gap:6px}",
    ".@@when{font-family:var(--mono);font-size:13px;letter-spacing:.1em;text-transform:uppercase;color:var(--gray);margin-top:6px}",
    ".@@bubble{background:#fff;border:1px solid var(--line);border-radius:14px 14px 14px 4px;padding:9px 12px;font-size:16px;line-height:1.4;max-width:92%;overflow-wrap:anywhere}",
    ".@@bubble.@@mail{border-radius:8px;background:var(--soft)}.@@bubble.@@mail b{display:block;margin-bottom:3px}",
    ".@@bubble.@@team{background:var(--ink);color:var(--paper);border-color:var(--ink)}",
    ".@@foot{display:flex;gap:12px;align-items:center;flex-wrap:wrap}",
    ".@@strip{flex:1;min-width:0;display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:6px;padding:2px}",
    ".@@chip{min-width:0;display:inline-flex;align-items:center;justify-content:flex-start;gap:6px;min-height:44px;padding:4px 8px 4px 5px;font-size:13px;font-weight:650;line-height:1.15;color:var(--gray);background:#fff;border:1px solid var(--line);border-radius:8px;overflow-wrap:anywhere;text-align:left}",
    ".@@chipn{width:30px;height:30px;border-radius:50%;background:var(--soft);display:inline-flex;align-items:center;justify-content:center;font-family:var(--mono);font-size:13px;color:var(--ink)}",
    ".@@chip.@@done{color:var(--ink);background:var(--soft)}.@@chip.@@done .@@chipn{background:var(--ok)}",
    ".@@chip.@@current{color:var(--paper);background:var(--ink);border-color:var(--ink)}.@@chip.@@current .@@chipn{background:var(--paper);color:var(--ink)}",
    ".@@acts{display:flex;gap:8px;flex:0 0 auto}",
    ".@@acts .@@ghost{margin-top:0}",
    ".@@nextbtn{min-height:48px;padding:0 24px;font-size:16px;font-weight:700;color:var(--paper);background:var(--ink);border:1px solid var(--ink);border-radius:8px}",
    ".@@fallback{padding:16px;border:1px solid var(--line);border-radius:10px;background:var(--soft);font-size:16px;color:var(--ink2)}",
    "@media (prefers-reduced-motion: reduce){.@@fill,.@@meter i{transition:none}}",
    "@container (max-width: 640px){.@@frame{flex-direction:column}.@@rail{flex:0 0 auto;flex-direction:row;border-right:0;border-bottom:1px solid var(--line);padding:8px}.@@railbtn{flex:1;text-align:center;padding:0 6px}.@@banner{flex-direction:column;align-items:flex-start;gap:8px}.@@panel{padding:12px;gap:12px}.@@strip{flex:1 1 100%;grid-template-columns:repeat(3,minmax(0,1fr))}.@@acts{width:100%}.@@acts .@@nextbtn{flex:1}.@@row{flex-direction:column;align-items:flex-start;gap:2px}.@@rowr{text-align:left}.@@items li,.@@walk li{flex-direction:column;align-items:flex-start;gap:6px}.@@status{align-items:flex-start;text-align:left}}"
  ].join("\n").replace(/@@/g, P);

  function ensureStyle() {
    if (!doc || !doc.head || !doc.createElement) return;
    if (doc.getElementById && doc.getElementById(STYLE_ID)) return;
    var el = doc.createElement("style");
    el.id = STYLE_ID;
    el.textContent = CSS;
    doc.head.appendChild(el);
  }

  function fallback() {
    return '<div class="' + c("fallback") + '" data-fhv="' + NAME + '">The Blueprint dashboard preview is not available right now. Walk the plan in words: pay each card down to 10% of its limit, mail the letters, upload the proof and bureau answers, set up the business, then Business 1, Business 2 and the next funding sequence.</div>';
  }

  var listening = false;
  function listen() {
    if (listening || !doc || !doc.addEventListener) return;
    doc.addEventListener("click", onTap);
    listening = true;
  }

  /* ── the slot function ────────────────────────────────────────────────── */

  FHV.blueprintDemo = function (ctxIn) {
    try {
      var ctx = ctxIn && typeof ctxIn === "object" ? ctxIn : {};
      ctx = {
        engine: ctx.engine || null, visual: ctx.visual && typeof ctx.visual === "object" ? ctx.visual : null,
        survey: ctx.survey && typeof ctx.survey === "object" ? ctx.survey : {},
        handoff: ctx.handoff && typeof ctx.handoff === "object" ? ctx.handoff : {},
        businesses: list(ctx.businesses), tier: ctx.tier || null, door: ctx.door || null,
        sample: ctx.sample === true, clientId: ctx.clientId,
        money: typeof ctx.money === "function" ? ctx.money : moneyLocal,
        esc: typeof ctx.esc === "function" ? ctx.esc : escLocal
      };
      ensureStyle();
      listen();
      var st = stateFor(ctx);
      settleSoon(st.id);
      return '<div class="' + c("root") + '" data-fhv="' + NAME + '" data-client="' + ctx.esc(st.id) + '">' + inner(st) + "</div>";
    } catch (e) {
      return fallback();
    }
  };

  /* Read-only hooks for tests. Nothing in the deck calls these. */
  FHV._blueprintDemo = { buildSteps: buildSteps, states: states, apply: apply, NAME: NAME };
})(typeof window !== "undefined" ? window : globalThis);
