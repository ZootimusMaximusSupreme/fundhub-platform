/* Whop plans + provider logos for the Payments section (Finance OS unit W).
 *
 * The Payments section (money-payments.js) calls this file; it paints nothing on its own.
 *   FHWhopPlans.renderSection(d, { staff })  the "Whop plans" part of "What you owe Fundhub":
 *       one card per plan from d.whop (GET /api/money/payments), in the same card look as a
 *       Clarity plan, with its phone alert line. "" when the read sent no whop block (an older
 *       server) or there are no plans. A short note when the Whop read failed (d.whop null).
 *   FHWhopPlans.providerLogo(plan)  the official ClarityPay logo for a plan that records
 *       ClarityPay as its provider (its owed_to names ClarityPay); "" for every other plan,
 *       which keeps its name only. kind "clarity" is Fundhub's own word for a payment plan
 *       and does not say who the provider is (Codex CX21).
 *   FHWhopPlans.owedNote(d)  " · +$X on Whop" for the "You owe Fundhub" tile, when split-pay
 *       Whop plans have money left (an estimate: payments left x the next charge).
 *
 * LOGOS ARE THE COMPANIES' OWN FILES, never drawn:
 *   /assets/merchant-whop.svg          Whop's mark, from brand.whop.com (already in the repo).
 *   /assets/lenders/claritypay.svg     ClarityPay's header logo from https://www.claritypay.com/
 *                                      (img.navbar1_logo), downloaded 2026-11-07; the source
 *                                      line is at the top of the file.
 *
 * THE HONESTY RULES (same as money-payments.js): money arrives as integer cents; a null paints
 * "—", never $0.00. Late is said in words. The phone shows only "A payment on your plan is due
 * soon" (src/push/payload.mjs): no amount, no product, no Whop name.
 *
 * Every render function returns an HTML string and touches no DOM, so
 * src/ui/money-whop-plans.test.mjs runs them in Node.
 */
(function (root) {
  "use strict";

  var MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  var WHOP_LOGO = { src: "/assets/merchant-whop.svg", alt: "Whop", w: 39, h: 20 };
  var CLARITYPAY_LOGO = { src: "/assets/lenders/claritypay.svg", alt: "ClarityPay", w: 106, h: 20 };
  var ALERTS_HREF = "/app/financeos.html#alerts";
  var PHONE_SETUP_HREF = "/app/client-portal.html#push-card";

  function esc(v) {
    return String(v == null ? "" : v)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
  function isNum(v) { return typeof v === "number" && isFinite(v); }
  function list(v) { return Array.isArray(v) ? v : []; }
  function plural(n, one, many) { return n + " " + (n === 1 ? one : many); }

  function money(cents) {
    if (!isNum(cents)) return "—";
    var neg = cents < 0;
    var abs = Math.round(Math.abs(cents));
    var dollars = String(Math.floor(abs / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    var c = String(abs % 100);
    if (c.length < 2) c = "0" + c;
    return (neg ? "−$" : "$") + dollars + "." + c;
  }

  /* "2026-11-20" → "Nov 20", read as a calendar date. */
  function day(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ""));
    if (!m) return "—";
    return MONTHS[Number(m[2]) - 1] + " " + Number(m[3]);
  }

  function logo(l) {
    return '<img class="fh-provider-logo" src="' + esc(l.src) + '" alt="' + esc(l.alt) + '" width="' + l.w +
      '" height="' + l.h + '" decoding="async">';
  }

  /* ClarityPay's logo goes only on a plan that records ClarityPay as its provider. A plan
     records who it is paid to in owed_to (migration 443: "Fundhub LLC, or the named
     subsidiary the money is owed to"; the staff form's "Owed to"). kind "clarity" only means
     a Fundhub payment plan, so it never earns the logo by itself. "Clarity Payments" is not
     ClarityPay. Any other plan: its name only. */
  function isClarityPay(plan) {
    return !!plan && /\bclarity\s?pay\b/i.test(String(plan.owed_to == null ? "" : plan.owed_to));
  }
  function providerLogo(plan) {
    return isClarityPay(plan) ? '<div class="plan-brand">' + logo(CLARITYPAY_LOGO) + '</div>' : "";
  }

  function whopPlans(d) {
    return d && d.whop && Array.isArray(d.whop.plans) ? d.whop.plans : [];
  }

  /* " · +$1,500.00 on Whop" for the owed tile, or "". */
  function owedNote(d) {
    var left = whopPlans(d).reduce(function (s, p) {
      return p && p.split && isNum(p.left_cents) && p.left_cents > 0 ? s + p.left_cents : s;
    }, 0);
    return left > 0 ? " · +" + money(left) + " on Whop" : "";
  }

  function tag(p) {
    switch (p.state) {
      case "late": return '<span class="late">Late</span>';
      case "paid_off": return '<span class="paid-word">Paid off</span>';
      case "ending": return '<span class="tag">Ends ' + esc(day(p.ends_on)) + '</span>';
      case "trial": return '<span class="tag">Free trial</span>';
      case "due_soon": return '<span class="tag">Due soon</span>';
      case "checking": return '<span class="tag">Checking</span>';
      default: return '<span class="tag">Active</span>';
    }
  }

  function subline(p, staff) {
    var parts = [];
    if (p.cadence && p.cadence.words) parts.push(p.cadence.words);
    if (p.split) parts.push(plural(p.split.required, "payment", "payments"));
    if (p.invoice) parts.push("Invoice");
    if (staff) parts.push(p.matched_by === "fundhub_checkout" ? "Tied by Fundhub checkout" : p.matched_by === "email" ? "Tied by email" : "");
    return parts.filter(Boolean).join(" · ") || "Whop";
  }

  function fact(label, value, big) {
    return '<div><dt class="caption">' + esc(label) + '</dt><dd class="' + (big ? "big" : "num") + '">' + value + '</dd></div>';
  }

  function facts(p) {
    var out = [];
    // A date inside a sentence never breaks between its month and day (320px phones).
    var nextText = p.next ? esc(money(p.next.amount_cents)) + ' on <span class="nowrap">' + esc(day(p.next.due_on)) + '</span>' : "—";
    if (p.split) {
      out.push(fact(p.state === "paid_off" ? "Left to pay" : "Left to pay (estimate)", esc(money(p.left_cents)), true));
      out.push(fact("Paid", esc(p.split.paid + " of " + p.split.required), false));
      out.push(fact(p.state === "late" ? "Each payment" : "Next payment", p.state === "late" ? esc(money(p.amount_cents)) : nextText, false));
    } else if (p.state === "ending") {
      out.push(fact("Ends", esc(day(p.ends_on)), true));
      out.push(fact("Each payment", esc(money(p.amount_cents)), false));
      out.push(fact("Next payment", "None", false));
    } else if (p.state === "late") {
      out.push(fact("Each payment", esc(money(p.amount_cents)), true));
      out.push(fact("How often", esc((p.cadence && p.cadence.words) || "—"), false));
      out.push(fact("Next payment", "Late", false));
    } else if (p.state === "checking") {
      out.push(fact("Each payment", esc(money(p.amount_cents)), true));
      out.push(fact("How often", esc((p.cadence && p.cadence.words) || "—"), false));
      out.push(fact("Next payment", "Checking with Whop", false));
    } else {
      out.push(fact("Next payment", esc(p.next ? money(p.next.amount_cents) : "—"), true));
      out.push(fact("Charges on", esc(p.next ? day(p.next.due_on) : "—"), false));
      out.push(fact("How often", esc((p.cadence && p.cadence.words) || "—"), false));
    }
    return '<dl class="facts">' + out.join("") + '</dl>';
  }

  function bar(p) {
    if (!p.split || !(p.split.required > 0)) return "";
    var w = Math.max(0, Math.min(100, (p.split.paid / p.split.required) * 100));
    return '<svg class="bar" viewBox="0 0 100 8" preserveAspectRatio="none" role="img" aria-label="' +
      esc(p.split.paid + " of " + p.split.required + " payments made") + '"><rect class="bar-track" x="0" y="0" width="100" height="8" rx="4"></rect>' +
      '<rect class="bar-fill" x="0" y="0" width="' + w + '" height="8" rx="4"></rect></svg>';
  }

  /* The phone alert line under the facts. The same answers as the Clarity plan cards
     (money-payments.js phoneLine), in short words that do not repeat the "Phone alert" label.
     A date never breaks between its month and day. */
  function phoneLine(d, p, staff) {
    var ph = d && d.phone;
    var v = p.phone;
    if (!ph || !v) return "";
    var html;
    var link = "";
    var when = function (iso) { return '<span class="nowrap">' + esc(day(iso)) + '</span>'; };
    if (ph.opted_out) html = esc(staff ? "Off. This client replied STOP." : "Off. You replied STOP.");
    else if (ph.enabled === false) {
      html = "Off.";
      if (!staff) link = ' <a class="btn-text" href="' + esc(ALERTS_HREF) + '">Turn them on</a>';
    } else if (ph.has_phone === false) {
      html = "No phone set up yet.";
      if (!staff) link = ' <a class="btn-text" href="' + esc(PHONE_SETUP_HREF) + '">Set up my phone</a>';
    } else if (v.reason === "late") html = "None while it is late.";
    else if (v.sent === "sent") html = "Sent for " + when(v.due_on) + ".";
    else if (v.alert_on) {
      var days = isNum(ph.days_before) ? ph.days_before : 3;
      // Inside the window the alert goes today, whatever the days left: say only that.
      html = String(v.alert_on) <= String(d.as_of || "").slice(0, 10) ? "Goes today."
        : "Goes " + when(v.alert_on) + ", " + esc(plural(days, "day", "days")) + " before.";
    } else return "";
    // One span for the words: .phone-line is a flex row, so a bare date span would be its own
    // item with a gap before the comma.
    return '<p class="phone-line caption"><span class="eyebrow">Phone alert</span> <span class="phone-text">' + html + '</span>' + link + '</p>';
  }

  function renderPlan(d, p, staff) {
    return '<article class="card plan whop-plan" data-whop-plan="' + esc(p.id) + '">' +
      '<div class="plan-head"><div class="plan-title">' +
      '<p class="plan-name">' + esc(p.name || "Whop plan") + '</p>' +
      '<p class="caption">' + esc(subline(p, staff)) + '</p></div>' +
      '<div>' + tag(p) + '</div></div>' +
      facts(p) + phoneLine(d, p, staff) + bar(p) + '</article>';
  }

  function updated(d) {
    var at = d && d.whop && d.whop.synced_at;
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(at || ""));
    return m ? "Updated " + day(m[0]) : "From Whop";
  }

  /* The "Whop plans" part of "What you owe Fundhub". */
  function renderSection(d, opts) {
    var staff = !!(opts && opts.staff);
    if (!d || !("whop" in d)) return "";
    if (d.whop === null) {
      return '<section class="whop-plans" aria-labelledby="b-whop"><div class="whop-head">' + logo(WHOP_LOGO) +
        '<h3 id="b-whop">Whop plans</h3></div><p class="caption" role="status">Whop plans could not load. Try again later.</p></section>';
    }
    var plans = whopPlans(d);
    if (!plans.length) return "";
    return '<section class="whop-plans" aria-labelledby="b-whop"><div class="whop-head">' + logo(WHOP_LOGO) +
      '<h3 id="b-whop">Whop plans</h3><span class="caption">' + esc(updated(d)) + '</span></div>' +
      '<div class="plans">' + plans.map(function (p) { return renderPlan(d, p, staff); }).join("") + '</div></section>';
  }

  root.FHWhopPlans = {
    renderSection: renderSection,
    providerLogo: providerLogo,
    owedNote: owedNote,
    money: money,
    day: day,
    logos: { whop: WHOP_LOGO, claritypay: CLARITYPAY_LOGO }
  };
})(typeof window !== "undefined" ? window : globalThis);
