import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  companyEight,
  diagnoseGaps,
  hireProfileFromGaps,
  loadAdSpend,
  loadBars,
  actOnBrain
} from "./pulse.mjs";
import { marketingSnapshot } from "./meta-marketing.mjs";

describe("funded this month bar", () => {
  it("counts funding_rounds status=funded, not clients.funded", () => {
    const src = readFileSync(new URL("./pulse.mjs", import.meta.url), "utf8");
    const start = src.indexOf("fundedActual");
    const end = src.indexOf("const closerTarget");
    const bar = src.slice(start, end);
    assert.match(bar, /FROM funding_rounds/);
    assert.match(bar, /status = 'funded'/);
    assert.doesNotMatch(bar, /FROM clients/);
    assert.doesNotMatch(bar, /funded IS TRUE/);
  });

  // N17 (2026-09-18): live had 3 funded rounds in 2 files this month — two
  // $25k rounds on #8 and one on Walk1 — and the CEO brief said "3 funded
  // files". A file counts once however many of its rounds funded.
  it("counts distinct funded files, and keeps the round count beside it", async () => {
    const seen = [];
    const db = {
      async query(sql) {
        seen.push(sql);
        if (/FROM staff_targets/.test(sql)) {
          return { rows: [{ role: "funding_advisor", metric: "files", target_value: 27 }] };
        }
        if (/FROM call_outcomes/.test(sql)) return { rows: [{ n: 0 }] };
        if (/FROM funding_rounds/.test(sql)) {
          // What Postgres returns for those three rounds: 3 rows, 2 files.
          // `n` is what the old count(*) query read.
          return { rows: [{ n: 3, files: 2, rounds: 3 }] };
        }
        throw new Error(`unexpected query: ${sql}`);
      }
    };
    const bars = await loadBars(db, { orgId: "org-1", now: new Date("2026-09-18T19:00:00Z") });
    assert.equal(bars.funding_advisor.actual, 2, "files, not rounds");
    assert.equal(bars.funding_advisor.rounds, 3);
    const fundSql = seen.find((s) => /FROM funding_rounds/.test(s));
    assert.match(fundSql, /count\(DISTINCT client_id\)/);

    const gaps = diagnoseGaps({
      bars: { closer: { target: 27, actual: 27 }, funding_advisor: bars.funding_advisor },
      calendar: { packed: false },
      company_8: { booked_calls: { value: 1, missing: false } }
    });
    assert.match(gaps.notes.join(" "), /funded files this month 2 are under/);
    assert.doesNotMatch(gaps.notes.join(" "), /funded files this month 3/);
  });

  it("says missing, not zero, when the funded read fails", async () => {
    const db = {
      async query(sql) {
        if (/FROM staff_targets/.test(sql)) {
          return { rows: [{ role: "funding_advisor", metric: "files", target_value: 27 }] };
        }
        if (/FROM call_outcomes/.test(sql)) return { rows: [{ n: 0 }] };
        throw new Error("boom");
      }
    };
    const bars = await loadBars(db, { orgId: "org-1", now: new Date("2026-09-18T19:00:00Z") });
    assert.equal(bars.funding_advisor.actual, null);
    assert.equal(bars.funding_advisor.rounds, null);
    assert.equal(bars.funding_advisor.missing, "funded_files_not_available");
  });
});

describe("pulse company 8", () => {
  it("maps computeKpis fields and marks missing cost per funded", () => {
    const eight = companyEight({
      new_clients: 3,
      booked_count: 10,
      show_rate: 0.5,
      close_rate: 0.2,
      cash_collected_cents: 300000,
      funded_count: 1,
      funded_amount_cents: 5000000,
      cost_per_funded_cents: null,
      cost_per_funded_reason: "ad_spend_unavailable"
    });
    assert.equal(eight.new_clients.value, 3);
    assert.equal(eight.booked_calls.value, 10);
    assert.equal(eight.cost_per_funded_cents.missing, true);
    assert.equal(eight.cost_per_funded_cents.reason, "ad_spend_unavailable");
    assert.equal(eight.show_rate.missing, false);
  });

  it("says the eight numbers are missing when kpis are absent", () => {
    const eight = companyEight(null);
    assert.equal(eight.new_clients.missing, true);
    assert.equal(eight.cash_cents.missing, true);
  });
});

describe("gap diagnosis", () => {
  it("names the short seat from the starting bars and does not invent a booking bar", () => {
    const gaps = diagnoseGaps({
      bars: {
        closer: { target: 20, actual: 4 },
        funding_advisor: { target: 20, actual: 20 }
      },
      calendar: { packed: false },
      company_8: { booked_calls: { value: 8, missing: false } }
    });
    assert.equal(gaps.has_short, true);
    assert.equal(gaps.short[0].seat, "closer");
    assert.equal(gaps.short[0].metric, "deposits");
    assert.match(gaps.notes.join(" "), /starting bar of 20/);
    assert.match(gaps.notes.join(" "), /Setting is handled by a person today\. The AI setter is off/);
    assert.match(gaps.notes.join(" "), /Do not hire a setter/);
    assert.equal(gaps.short.some((s) => s.seat === "setter_ai"), false);
  });

  it("says missing instead of inventing an actual", () => {
    const gaps = diagnoseGaps({
      bars: {
        closer: { target: 20, actual: null, missing: "deposits_not_available" },
        funding_advisor: { target: 20, actual: 3 }
      },
      calendar: { packed: false },
      company_8: { booked_calls: { value: null, missing: true } }
    });
    assert.equal(gaps.missing.some((m) => m.seat === "closer"), true);
    assert.equal(gaps.short.some((s) => s.seat === "funding_advisor"), true);
    assert.match(gaps.notes.join(" "), /missing/);
    assert.match(gaps.notes.join(" "), /Setting is handled by a person today\. The AI setter is off/);
    assert.match(gaps.notes.join(" "), /Do not hire a setter/);
  });

  it("flags an unpaired closer as a funding-advisor pod gap", () => {
    const gaps = diagnoseGaps({
      bars: {
        closer: { target: 27, actual: 27 },
        funding_advisor: { target: 27, actual: 27 }
      },
      calendar: { packed: false },
      company_8: { booked_calls: { value: 8, missing: false } },
      pods: {
        complete: 2,
        closer_count: 3,
        fa_count: 2,
        unpaired_closers: 1,
        unpaired_fas: 0,
        complete_with: "funding_advisor"
      }
    });
    assert.equal(gaps.has_short, true);
    assert.equal(gaps.short.some((s) => s.seat === "funding_advisor" && s.metric === "pod"), true);
    assert.match(gaps.notes.join(" "), /finish the pod/);
  });

  it("treats a packed calendar as a closer need", () => {
    const gaps = diagnoseGaps({
      bars: {
        closer: { target: 20, actual: 20 },
        funding_advisor: { target: 20, actual: 20 }
      },
      calendar: { packed: true, due_at_count: 45, threshold: 45 },
      company_8: { booked_calls: { value: 8, missing: false } }
    });
    assert.equal(gaps.has_short, true);
    assert.equal(gaps.short.some((s) => s.seat === "closer" && s.reason === "packed"), true);
  });
});

describe("hire profile from gaps", () => {
  it("writes a closer profile and keeps LinkedIn on the closer path", () => {
    const profile = hireProfileFromGaps({
      gaps: { short: [{ seat: "closer", metric: "deposits" }] },
      calendar: { packed: false }
    });
    assert.equal(profile.seat, "closer");
    assert.equal(profile.linkedin, true);
    assert.match(profile.lines.join(" "), /Setting is handled by a person today\. The AI setter is off/);
    assert.match(profile.lines.join(" "), /Do not hire a setter/);
    assert.match(profile.lines.join(" "), /tandem/);
  });

  it("writes a pod profile when the calendar is packed", () => {
    const profile = hireProfileFromGaps({
      gaps: { short: [] },
      calendar: { packed: true }
    });
    assert.equal(profile.seat, "pod");
    assert.equal(profile.linkedin, true);
    assert.match(profile.lines.join(" "), /closer and one funding advisor/);
  });

  it("writes a funding advisor profile without a second job-post path", () => {
    const profile = hireProfileFromGaps({
      gaps: { short: [{ seat: "funding_advisor", metric: "files" }] },
      calendar: { packed: false }
    });
    assert.equal(profile.seat, "funding_advisor");
    assert.equal(profile.linkedin, false);
    assert.match(profile.linkedin_reason, /no second job-post/);
  });
});

describe("marketing snapshot on the pulse", () => {
  it("attaches spend, cost per booked, and the fail-closed category rule", () => {
    const marketing = marketingSnapshot({
      ads: { status: "ok", spend_cents: 20000 },
      bookedN: 10
    });
    assert.equal(marketing.spend_cents, 20000);
    assert.equal(marketing.cost_per_booked.status, "MEASURED");
    assert.equal(marketing.special_ad_category.required, true);
    assert.equal(marketing.special_ad_category.fail_closed, true);
    assert.match(marketing.note, /does not buy/);
  });
});

describe("ad spend read", () => {
  it("returns not_configured when the spend table cannot be read", async () => {
    const out = await loadAdSpend(
      { query: async () => { throw new Error("no table"); } },
      { orgId: "org-1", days: 7 }
    );
    assert.equal(out.status, "not_configured");
    assert.equal(out.spend_cents, null);
  });

  it("returns a real spend number when the table answers", async () => {
    const out = await loadAdSpend(
      { query: async () => ({ rows: [{ cents: 12345 }] }) },
      { orgId: "org-1", days: 7 }
    );
    assert.equal(out.status, "ok");
    assert.equal(out.spend_cents, 12345);
  });
});

describe("actOnBrain", () => {
  function pulseBase(over = {}) {
    return {
      calendar: { packed: false },
      gaps: { has_short: false, notes: [] },
      ads: { status: "missing", spend_cents: null },
      hire: { linkedin: { status: "not_configured" } },
      fire: { auto_enqueue: false, rule_locked: false, note: "no fire rule yet" },
      raise: { auto_enqueue: false, rule_locked: false, note: "no raise rule yet" },
      bonus: { auto_enqueue: false, rule_locked: false, note: "no bonus rule yet" },
      ...over
    };
  }

  it("writes diagnose and ads review, never fire raise or bonus", async () => {
    const kinds = [];
    const out = await actOnBrain({}, {
      orgId: "org-1",
      computePulseFn: async () => pulseBase({
        gaps: { has_short: true, notes: ["Closer deposits this month 4 are under the starting bar of 20."] },
        ads: { status: "ok", spend_cents: 5000 }
      }),
      actOnPackedFn: async () => ({ acted: false, reason: "not_packed", calendar: { packed: false }, task: null, linkedin: { status: "not_configured" } }),
      createCsuiteTaskFn: async (_db, spec) => {
        kinds.push(spec.kind);
        return { created: true, id: spec.kind, kind: spec.kind };
      }
    });
    assert.deepEqual(kinds.sort(), ["ads_review", "diagnose"]);
    assert.equal(out.acted, true);
    assert.equal(out.fire.auto_enqueue, false);
    assert.equal(out.raise.auto_enqueue, false);
    assert.equal(out.bonus.auto_enqueue, false);
  });

  it("does not write an ads review when spend is zero or missing", async () => {
    const kinds = [];
    await actOnBrain({}, {
      orgId: "org-1",
      computePulseFn: async () => pulseBase({
        ads: { status: "ok", spend_cents: 0 }
      }),
      actOnPackedFn: async () => ({ acted: false, reason: "not_packed", calendar: { packed: false }, task: null, linkedin: {} }),
      createCsuiteTaskFn: async (_db, spec) => {
        kinds.push(spec.kind);
        return { created: true, kind: spec.kind };
      }
    });
    assert.deepEqual(kinds, []);
  });
});
