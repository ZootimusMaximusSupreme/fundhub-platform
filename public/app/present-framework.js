/* Framework v2 client diagrams. Values come from the deck's saved visual,
   survey, handoff and offer catalog. Taps only change the picture. */
(function (root) {
  "use strict";
  var V = root.FHDeckVisuals = root.FHDeckVisuals || {};
  var memory = Object.create(null);
  var contexts = Object.create(null);
  var E = function (v) { return String(v == null ? "" : v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); };
  var N = function (v) { return typeof v === "number" && Number.isFinite(v); };
  var A = function (v) { return Array.isArray(v) ? v : []; };
  function amount(c, v) { return N(v) ? E(c && c.money ? c.money(v) : "$" + v.toLocaleString("en-US")) : ""; }
  function label(v) { return E(v == null || /^\d{5,}$/.test(String(v).trim()) ? "" : v); }
  function basis(c) {
    var v = c && c.visual || {};
    return '<p class="fhw-basis">' + (v.pulledOn ? "From your soft pull on " + E(v.pulledOn) + ". " : "") + (c && c.sample ? "Sample file." : "") + "</p>";
  }
  function empty(c) { return '<div class="fhw-empty" role="status">Your file has not been read here yet. We will show the picture after the soft pull.</div>' + basis(c); }
  function panel(c, name, steps, picture, selected) {
    var key = (c && c.clientId || "anon") + ":" + name;
    contexts[key] = c;
    var i = Math.max(0, Math.min(steps.length - 1, selected == null ? (memory[key] || 0) : selected));
    memory[key] = i;
    return '<section class="fhw" data-fhv="' + E(name) + '" data-fhw-key="' + E(key) + '" aria-label="Slide diagram">'
      + '<div class="fhw-picture">' + picture(i) + '</div>'
      + '<div class="fhw-taps" aria-label="Build the picture">' + steps.map(function (s, j) {
        return '<button type="button" data-fhw-step="' + j + '" aria-pressed="' + (j === i) + '"><span class="fhw-tap-num">' + (j + 1) + '</span>' + E(s) + '</button>';
      }).join("") + '</div>' + basis(c) + '</section>';
  }
  var builders = Object.create(null);
  function register(name, fn) {
    builders[name] = fn;
    V[name] = function (ctx) { return fn(ctx || {}); };
  }
  if (root.document && root.document.addEventListener) root.document.addEventListener("click", function (event) {
    var btn = event.target && event.target.closest && event.target.closest("[data-fhw-step]");
    var host = btn && btn.closest("[data-fhw-key]");
    if (!host) return;
    var key = host.getAttribute("data-fhw-key");
    var name = host.getAttribute("data-fhv");
    memory[key] = Number(btn.getAttribute("data-fhw-step")) || 0;
    if (builders[name]) host.outerHTML = builders[name](contexts[key]);
  });
  function node(title, detail, active) {
    return '<div class="fhw-node' + (active ? " is-active" : "") + '"><strong>' + E(title) + '</strong>' + (detail ? '<span>' + detail + '</span>' : "") + '</div>';
  }
  function track(nodes) { return '<div class="fhw-track">' + nodes.join('<span class="fhw-arrow" aria-hidden="true">→</span>') + '</div>'; }
  function card(title, line, active) { return '<div class="fhw-card' + (active ? " is-active" : "") + '"><strong>' + E(title) + '</strong><span>' + line + '</span></div>'; }

  register("callMap", function (c) {
    var labels = ["Your goal", "Soft pull", "Your file", "Your path", "The plan", "Your call"];
    return panel(c, "callMap", ["Set your goal", "Read your file", "See your path", "Make your call"], function (i) {
      return '<div class="fhw-stamp">Pull before price · A no is fine</div>'
        + track(labels.map(function (s, j) { return node(s, j === 5 ? "You decide" : "", j <= i + 1); }))
        + '<div class="fhw-note">Anyone else who decides can join the call.</div>';
    });
  });

  register("alignment", function (c) {
    return panel(c, "alignment", ["Your goal", "Your file", "Our work", "Your decision"], function (i) {
      return track([node("Your goal", label(c.survey && c.survey.target) || "What you want to do", i === 0),
        node("Your file", "What the pull supports", i === 1),
        node("Fundhub team", "Runs the agreed steps", i === 2),
        node("Your decision", "Move forward if it fits", i === 3)]);
    });
  });

  register("goalLine", function (c) {
    var survey = c.survey || {}, handoff = c.handoff || {};
    return panel(c, "goalLine", ["Where you are", "What you need", "What waiting costs", "The path forward"], function (i) {
      var goal = label(survey.target), use = label(survey.use), cost = N(c.costOfWaiting) && c.costOfWaiting > 0 ? amount(c, c.costOfWaiting) + " each month" : "";
      return track([node("Stuck today", label(handoff.problem) || "Your current file", i === 0), node("Your goal", goal || "Your goal", i >= 1)])
        + (use ? '<div class="fhw-note">For ' + use + '</div>' : "")
        + (cost ? '<div class="fhw-callout">' + (i >= 2 ? cost : "Waiting has a cost you named") + '</div>' : "")
        + '<div class="fhw-grid">' + card("Personal file", "What it shows", i === 1) + card("Business", "How established it looks", i === 2) + card("Lender order", "Which comes first", i === 3) + '</div>';
    });
  });

  register("pullSplit", function (c) {
    return panel(c, "pullSplit", ["Soft pull today", "Three reports", "One read-out", "Applications later"], function (i) {
      return '<div class="fhw-grid fhw-two">' + card("Soft pull today", "Your score does not move. No lender sees this inquiry.", i < 3)
        + card("Hard pulls later", "Each application follows the plan.", i === 3) + '</div>'
        + track([node("Experian", "", i >= 1), node("TransUnion", "", i >= 1), node("Equifax", "", i >= 1), node("Your file", "One read-out", i >= 2)])
        + '<div class="fhw-note">The reports are yours. ' + E(c.price ? c.price("SOFT_PULL") : "") + ' for the assessment.</div>';
    });
  });

  register("iceberg", function (c) {
    var v = c.visual;
    if (!v) return '<section data-fhv="iceberg" class="fhw">' + empty(c) + '</section>';
    var over = A(v.cards).filter(function (x) { return N(x.usePct) && x.usePct > 10; }).length;
    var firstCompany = A(v.companies)[0];
    var businessAge = firstCompany && N(firstCompany.ageMonths) ? firstCompany.ageMonths + " months" : A(v.companies).length ? "Age not on file" : "No business on file";
    var counts = [["Cards over 10 percent", over], ["Negative items", A(v.items).length], ["Info that does not match", A(v.mismatches).length], ["Business age", businessAge]];
    return panel(c, "iceberg", ["Look beyond the score", "Card use", "File marks", "Business file"], function (i) {
      return '<div class="fhw-ice-top">Score is one part of the file</div><div class="fhw-waterline"></div><div class="fhw-grid">'
        + counts.map(function (p, j) { return card(p[0], String(p[1]), j === i); }).join("") + '</div>';
    });
  });

  register("blindMatched", function (c) {
    return panel(c, "blindMatched", ["Apply blind", "Inquiries stack", "Match the file", "Apply in order"], function (i) {
      return '<div class="fhw-grid fhw-two">' + card("Applying blind", "Applications without a file match → hard inquiries", i < 2)
        + card("Matched sequence", "File read → fitting lenders → ordered applications", i >= 2) + '</div>';
    });
  });

  register("revenueSplit", function (c) {
    return panel(c, "revenueSplit", ["Upload documents", "Team sends file", "Lender reviews", "Optimize for later"], function (i) {
      return '<div class="fhw-grid fhw-two">' + card("Revenue track", "Your bank statements or tax returns → Fundhub team → lender review", i < 3)
        + card("File track", "Credit optimization → next funding sequence", i === 3) + '</div>'
        + '<div class="fhw-note">The lender decides the amount, rate and terms.</div>';
    });
  });

  register("sequence", function (c) {
    var v = c.visual;
    return panel(c, "sequence", ["Read the file", "First round", "Inquiry sweep", "Next round", "Each business"], function (i) {
      return track([node("Personal file", v && N(v.todayTotal) ? amount(c, v.todayTotal) : "First", i === 0), node("Round", "Matched applications", i === 1), node("Sweep", "Dispute new inquiries", i === 2), node("Next round", "About six per sequence", i === 3), node("Businesses", "Each on its own", i === 4)]);
    });
  });

  register("clock", function (c) {
    return panel(c, "clock", ["Sign today", "Advisor starts", "Applications go out", "Next rounds"], function (i) {
      return track([node("0", "Signed", i === 0), node("24 business hours", "Advisor starts", i === 1), node("72 business hours", "First applications", i === 2), node("After that", "Each round", i === 3)]);
    });
  });

  register("partnerStaircase", function (c) {
    var v = c.visual;
    return panel(c, "partnerStaircase", ["This sequence", "Next sequence", "The one after", "Partner for life"], function (i) {
      return '<div class="fhw-stairs">' + ["This sequence", "Next sequence", "The one after"].map(function (s, j) {
        return card(s, j === 0 && v && N(v.todayTotal) ? amount(c, v.todayTotal) : "Funding partner", j <= i);
      }).join("") + '</div><div class="fhw-note">Funding partners make the final call on each application.</div>';
    });
  });

  register("blueprintRoute", function (c) {
    var v = c.visual || {}, firstCard = A(v.cards)[0], firstItem = A(v.items)[0];
    return panel(c, "blueprintRoute", ["Pay a card down", "Dispute an item", "Follow the payoff", "Prepare each business", "Build fundability"], function (i) {
      return track([
        node("Pay down", firstCard ? label(firstCard.creditor) : "A card from your file", i === 0),
        node("Dispute", firstItem ? label(firstItem.creditor) : "An item from your file", i === 1),
        node("Track", "Payoff and bureau answers", i === 2),
        node("Businesses", "Each ready in order", i === 3),
        node("Next sequence", "After the file is ready", i === 4)
      ]) + '<div class="fhw-note">If an item comes off, the plan updates from the new pull.</div>';
    });
  });

  register("doorMatrix", function (c) {
    var v = c.visual, door = c.door || "";
    var doors = [
      ["Funding", "Matched applications", "Funding agreement", "Funding sequence", "Fundhub team", "FUNDING_DFY", door === "fund" || door === "fund_plus_optimize"],
      ["Revenue", "Revenue file", "Lender terms", "Lender terms", "Fundhub team", null, false],
      ["Capital Blueprint", "12-month plan", "Blueprint agreement", "12 months", "You, with the team", "UWIQ_DELIVERABLES", door === "blueprint"],
      ["Credit optimization", "Up to six rounds", "Repair agreement", "Round by round", "Fundhub team", "REPAIR_DFY", door === "optimize"]
    ];
    return panel(c, "doorMatrix", ["What you get", "What backs it", "How long", "Who does the work", "The price"], function (i) {
      return (v && N(v.todayTotal) && N(v.optimizedTotal) && v.optimizedTotal > v.todayTotal ? '<div class="fhw-callout">' + amount(c, v.optimizedTotal - v.todayTotal) + ' left on the table</div>' : "")
        + '<div class="fhw-door-grid">' + doors.map(function (d) {
          return '<div class="fhw-door' + (d[6] ? ' is-active' : '') + '"><strong>' + E(d[0]) + '</strong>' + (d[6] ? '<em>Built for your file</em>' : '')
            + '<span>' + E(d[Math.min(i + 1, 4)]) + '</span>' + (i === 4 && d[5] ? '<b>' + E(c.price ? c.price(d[5]) : "") + '</b>' : '') + '</div>';
        }).join("") + '</div>';
    });
  });

  register("moneyStrip", function (c) {
    var v = c.visual, funding = c.door === "fund" || c.door === "fund_plus_optimize";
    var deposit = c.offerAmount ? c.offerAmount("FUNDING_DFY") : null;
    var feePct = c.feePercent;
    var fee = funding && v && N(v.todayTotal) && N(feePct) ? Math.round(v.todayTotal * feePct / 100) : null;
    return panel(c, "moneyStrip", ["Pay today", "Credited once", "Funding estimate", "Example balance"], function (i) {
      if (!funding) return track([node("Capital Blueprint", E(c.price ? c.price("UWIQ_DELIVERABLES") : ""), i === 0), node("12 months", "Your own plan", i >= 1), node("Your steps", "In the dashboard", i >= 2)]);
      return track([node("Today", N(deposit) ? amount(c, deposit) : "Deposit", i === 0), node("Credited", "Dollar for dollar", i === 1), node("Estimated funding", v && N(v.todayTotal) ? amount(c, v.todayTotal) : "Lender decides", i === 2), node("Illustrative balance", N(fee) && N(deposit) ? amount(c, Math.max(0, fee - deposit)) : "Balance, if funded", i === 3)])
        + '<div class="fhw-note">Example only. The lender decides the amount; the actual success fee follows the signed agreement. The deposit is credited once.</div>';
    });
  });

  register("guarantees", function (c) {
    return panel(c, "guarantees", ["Agreement signed", "Advisor starts", "Applications go out", "Written protection"], function (i) {
      return '<div class="fhw-grid fhw-two">' + card("G-01 · 24 business hours", "A funding advisor starts on your file.", i === 1)
        + card("G-02 · 72 business hours", "Your first applications go out.", i === 2) + '</div>'
        + '<div class="fhw-note">' + (i === 3 ? "If Fundhub misses either written deadline, the agreement lets you ask for the deposit back." : "The bank decides approvals, rates and terms.") + '</div>';
    });
  });

  register("nextSteps", function (c) {
    var key = c.offerKey || "", funding = key === "FUNDING_DFY", blueprint = key === "UWIQ_DELIVERABLES";
    return panel(c, "nextSteps", ["Agreement", "Payment", "Day one", "Team action", "Portal"], function (i) {
      var next = funding ? ["Your file starts", "Advisor within 24 business hours", "First applications within 72 business hours"]
        : blueprint ? ["Your plan opens", "Your checklist in the portal", "You work each step with the team"]
          : ["Your file starts", "First round is prepared", "Track disputes in the portal"];
      return track([node("You", "Review agreement", i === 0), node("You", "Complete payment", i === 1), node("Day one", next[0], i === 2), node("Fundhub team", next[1], i === 3), node("Portal app", next[2], i === 4)]);
    });
  });

  if (root.document && root.document.createElement && root.document.head) {
    var style = root.document.createElement("style");
    style.textContent = '.fhw{display:flex;flex-direction:column;gap:14px;min-width:0;width:100%;color:var(--ink);font-family:var(--sans)}.fhw-picture{min-height:240px;display:flex;flex-direction:column;justify-content:center;gap:16px;padding:20px;background:#fff;border:1px solid var(--line);border-radius:10px;box-shadow:var(--panel-shadow)}.fhw-track{display:flex;align-items:stretch;gap:6px;min-width:0}.fhw-node,.fhw-card,.fhw-door{min-width:0;flex:1;padding:14px;background:var(--soft);border:1px solid var(--line);border-radius:10px;overflow-wrap:anywhere}.fhw-node strong,.fhw-card strong,.fhw-door strong{display:block;font-size:16px;line-height:1.2}.fhw-node span,.fhw-card span,.fhw-door span{display:block;margin-top:8px;font-size:13px;line-height:1.4;color:var(--gray)}.fhw-node.is-active,.fhw-card.is-active,.fhw-door.is-active{background:color-mix(in srgb,var(--info) 10%,white);border-color:var(--ink)}.fhw-arrow{align-self:center;color:var(--gray);font-size:16px}.fhw-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px}.fhw-two{grid-template-columns:repeat(2,minmax(0,1fr))}.fhw-taps{display:flex;flex-wrap:wrap;gap:6px}.fhw-taps button{min-height:44px;min-width:44px;flex:1 1 120px;text-align:left;padding:8px 10px;border:1px solid var(--line);border-radius:8px;background:#fff;color:var(--ink);font:650 13px var(--sans);cursor:pointer}.fhw-taps button[aria-pressed=true]{background:var(--ink);color:#fff}.fhw-tap-num{display:inline-grid;place-items:center;width:22px;height:22px;margin-right:7px;border:1px solid currentColor;border-radius:50%;font-size:11px}.fhw-basis,.fhw-note{font-size:13px;line-height:1.4;color:var(--gray);margin:0}.fhw-callout{font-size:clamp(20px,2.4vw,32px);font-weight:750;font-variant-numeric:tabular-nums}.fhw-stamp{align-self:flex-start;padding:6px 9px;border:1px solid var(--ink);border-radius:5px;font-size:13px;font-weight:650}.fhw-waterline{height:1px;background:var(--ink)}.fhw-ice-top{text-align:center;font-size:18px;font-weight:750}.fhw-stairs{display:flex;align-items:flex-end;gap:8px}.fhw-stairs .fhw-card:nth-child(2){min-height:130px}.fhw-stairs .fhw-card:nth-child(3){min-height:170px}.fhw-door-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px}.fhw-door em{display:block;margin-top:8px;font-size:13px;font-style:normal;font-weight:650}.fhw-door b{display:block;margin-top:10px;font-size:20px;font-variant-numeric:tabular-nums}.fhw-empty{padding:18px;border:1px solid var(--line);border-radius:10px;background:var(--soft);font-size:16px}@media(max-width:700px){.fhw-picture{padding:14px;min-height:0}.fhw-track,.fhw-stairs{flex-direction:column}.fhw-arrow{transform:rotate(90deg)}.fhw-grid,.fhw-door-grid{grid-template-columns:1fr}.fhw-taps button{flex-basis:calc(50% - 6px)}}';
    root.document.head.appendChild(style);
  }
})(typeof window !== "undefined" ? window : globalThis);
