// The planner, on fixtures: spec docs/specs/marketing-machine-2026-10-04.md §7.5 step by
// step (plan unit U23). Pure: no database, no clock, no network. The real-Postgres half
// (spend mapping through the database, the route) is src/http/marketing-batches-next.pg.test.mjs.

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  planBatch, splitSlots, resolveAdRows, spendByFunnel, leadsByAngle, machineFormats,
  spreadFormats, checkOverrides, cleanOverrides, nextReleaseAt, weekKey, planWindows,
  dayWords, rankFollowMoney, SLOT_SOURCES, FOLLOW_MONEY_SHARE, SUGGESTION_COUNT
} from "./planner.mjs";
import { nextAnswer } from "../../api/marketing/batches/next.mjs";
import { assertMatchesContract } from "./api-contract.mjs";
import {
  room, quietRoom, NOW, TODAY, NEXT_RELEASE, NEXT_WEEK, FUNNELS, SETTINGS
} from "./fixtures/planner-room.mjs";

const bySource = (plan, source) => plan.slots.filter((s) => s.source === source);
const forFunnel = (plan, key) => plan.slots.filter((s) => s.funnel_key === key);
const funnelRow = (plan, key) => plan.funnels.find((f) => f.funnel_key === key);

/* Every plan must hold these, whatever the input. */
function assertWellFormed(plan) {
  assert.equal(plan.total, plan.slots.length, "total = number of slots");
  plan.slots.forEach((s, i) => {
    assert.equal(s.n, i + 1, "slots are numbered 1..total in order");
    assert.ok(SLOT_SOURCES.includes(s.source), `source ${s.source}`);
    assert.equal(typeof s.reason, "string");
    assert.ok(s.reason.trim().length > 10, `slot ${s.n} has a reason`);
    assert.ok(["bullets", "words"].includes(s.style));
    assert.ok(typeof s.script_format === "string" && s.script_format);
    assert.ok(s.angle_key === null || /^[a-z][a-z0-9_]{1,48}$/.test(s.angle_key), `angle key ${s.angle_key}`);
  });
  assert.equal(plan.funnels.reduce((t, f) => t + f.slots, 0), plan.total, "funnel slot counts add up to the total");
  for (const f of plan.funnels) {
    assert.equal(forFunnel(plan, f.funnel_key).length, f.slots, `${f.funnel_key} has as many slots as it says`);
    assert.ok(f.share === null || (f.share >= 0 && f.share <= 1));
  }
}

describe("step 1: the total", () => {
  test("size_rule 'total' is scripts_per_day x days_per_batch (21)", () => {
    const plan = planBatch(room());
    assertWellFormed(plan);
    assert.equal(plan.total, 21);
    assert.equal(plan.size_rule, "total");
  });

  test("size_rule 'per_funnel' multiplies by the funnels in play", () => {
    const two = planBatch(room({ settings: { ...SETTINGS, size_rule: "per_funnel" } }));
    assertWellFormed(two);
    assert.equal(two.total, 42, "2 funnels with spend x 21");
    assert.equal(two.size_rule, "per_funnel");

    const rows = room().ad_rows.filter((r) => r.ad_row_id === "a91"); // only roadmap spends
    const one = planBatch(room({ settings: { ...SETTINGS, size_rule: "per_funnel" }, ad_rows: rows }));
    assert.equal(one.total, 21, "1 funnel in play x 21");
  });

  test("other settings change it: 2 a day for 5 days is 10", () => {
    const plan = planBatch(room({ settings: { ...SETTINGS, scripts_per_day: 2, days_per_batch: 5 } }));
    assertWellFormed(plan);
    assert.equal(plan.total, 10);
  });

  test("no active funnel: nothing can be planned, total 0", () => {
    const plan = planBatch(room({ funnels: FUNNELS.map((f) => ({ ...f, active: false })) }));
    assert.equal(plan.total, 0);
    assert.deepEqual(plan.slots, []);
    assert.deepEqual(plan.funnels, []);
  });
});

describe("step 2: funnels in play", () => {
  test("only active funnels with spend in the last 7 days get slots", () => {
    const rows = room().ad_rows.filter((r) => r.ad_row_id === "a91");
    const plan = planBatch(room({ ad_rows: rows }));
    assertWellFormed(plan);
    assert.equal(funnelRow(plan, "roadmap_147").slots, 21);
    assert.equal(funnelRow(plan, "book_call").slots, 0, "book_call had no spend: shown, 0 slots");
  });

  test("no spend in 7 days: every active funnel is in play, split evenly by weight", () => {
    const plan = planBatch(quietRoom());
    assertWellFormed(plan);
    assert.equal(funnelRow(plan, "roadmap_147").slots + funnelRow(plan, "book_call").slots, 21);
    assert.ok(funnelRow(plan, "roadmap_147").slots >= 10 && funnelRow(plan, "book_call").slots >= 10);
    assert.equal(funnelRow(plan, "roadmap_147").share, null, "no spend: share unknown, not 0");
    assert.equal(plan.unmapped_spend_cents, null, "no saved ad-day at all: unmapped is unknown");
  });

  test("an inactive funnel is never in play, even with spend", () => {
    const funnels = FUNNELS.map((f) => (f.key === "book_call" ? { ...f, active: false } : { ...f }));
    const plan = planBatch(room({ funnels }));
    assertWellFormed(plan);
    assert.equal(funnelRow(plan, "book_call"), undefined);
    assert.equal(funnelRow(plan, "roadmap_147").slots, 21);
  });
});

describe("step 3: spend -> funnel", () => {
  test("the ad number's script funnel first, then the campaign's funnel, the rest Unmapped", () => {
    const keys = new Set(FUNNELS.map((f) => f.key));
    const ads = resolveAdRows(room().ad_rows, keys);
    const byId = new Map(ads.map((a) => [a.ad_row_id, a]));
    assert.equal(byId.get("a91").funnel_key, "roadmap_147", "script");
    assert.equal(byId.get("a92").funnel_key, "book_call", "campaign");
    assert.equal(byId.get("a93").funnel_key, "book_call", "script beats campaign");
    assert.equal(byId.get("axx").funnel_key, null, "unmapped");
    assert.equal(byId.get("a92").angle_key, "inquiries_off", "spine angle when the number has no script");

    const money = spendByFunnel(ads);
    assert.equal(money.spendOf("roadmap_147"), 41200);
    assert.equal(money.spendOf("book_call"), 16150);
    assert.equal(money.unmapped_spend_cents, 9150);

    const plan = planBatch(room());
    assert.equal(funnelRow(plan, "roadmap_147").spend_7d_cents, 41200);
    assert.equal(funnelRow(plan, "book_call").spend_7d_cents, 16150);
    assert.equal(plan.unmapped_spend_cents, 9150);
  });

  test("a script naming a funnel that does not exist falls back to the campaign's funnel", () => {
    const ads = resolveAdRows([{ ad_row_id: "z", ad_number: "99", script_funnel_key: "gone_funnel", campaign_funnel_key: "book_call", spend_7d_cents: 100, ad_days_7d: 1 }],
      new Set(["book_call"]));
    assert.equal(ads[0].funnel_key, "book_call");
  });

  test("a funnel with no placed ad-day is unknown, or a known 0 when every ad-day was placed elsewhere", () => {
    const keys = new Set(["roadmap_147", "book_call"]);
    const placed = spendByFunnel(resolveAdRows([{ ad_row_id: "1", script_funnel_key: "roadmap_147", spend_7d_cents: 500, ad_days_7d: 1 }], keys));
    assert.equal(placed.spendOf("book_call"), 0);
    assert.equal(placed.unmapped_spend_cents, 0);
    const some = spendByFunnel(resolveAdRows([{ ad_row_id: "1", spend_7d_cents: 500, ad_days_7d: 1 }], keys));
    assert.equal(some.spendOf("book_call"), null);
    assert.equal(some.unmapped_spend_cents, 500);
  });

  test("leads go to an angle through the number's script, else the angle its ads agree on", () => {
    const ads = resolveAdRows(room().ad_rows, new Set(["roadmap_147", "book_call"]));
    const leads = leadsByAngle([{ ad_number: "91", leads: 9 }, { ad_number: "92", leads: 3 }, { ad_number: "77", leads: 5 }],
      [{ ad_number: "91", angle_key: "two_files" }], ads);
    assert.equal(leads.get("two_files"), 9);
    assert.equal(leads.get("inquiries_off"), 3, "ad 92 has no script: its spine angle");
    assert.equal([...leads.values()].reduce((a, b) => a + b, 0), 12, "ad 77 has no angle: not guessed");
  });
});

describe("step 4: the split", () => {
  test("spend share x weight, largest remainder: $412.00 vs $161.50 → 15 and 6", () => {
    const plan = planBatch(room());
    assertWellFormed(plan);
    assert.equal(funnelRow(plan, "roadmap_147").slots, 15);
    assert.equal(funnelRow(plan, "book_call").slots, 6);
    assert.equal(funnelRow(plan, "roadmap_147").share, 0.7184);
    assert.equal(funnelRow(plan, "book_call").share, 0.2816);
    assert.deepEqual(plan.funnels.map((f) => f.funnel_key), ["roadmap_147", "book_call"], "most slots first");
  });

  test("the contract's example numbers: $412.00 vs $111.50 → 17 and 4", () => {
    const m = splitSlots(21, [{ key: "roadmap_147", spend: 41200, weight: 1 }, { key: "book_call", spend: 11150, weight: 1 }], 3);
    assert.equal(m.get("roadmap_147"), 17);
    assert.equal(m.get("book_call"), 4);
  });

  test("every funnel gets at least one day's worth (3) when that fits", () => {
    const m = splitSlots(21, [{ key: "a", spend: 9500, weight: 1 }, { key: "b", spend: 500, weight: 1 }], 3);
    assert.equal(m.get("b"), 3, "5% of 21 is 1, raised to a day");
    assert.equal(m.get("a"), 18);
  });

  test("no floor when a day each does not fit in the total", () => {
    const m = splitSlots(5, [{ key: "a", spend: 9500, weight: 1 }, { key: "b", spend: 500, weight: 1 }], 3);
    assert.equal(m.get("a"), 5);
    assert.equal(m.get("b"), 0);
  });

  test("weight multiplies the share", () => {
    const even = splitSlots(21, [{ key: "a", spend: 100, weight: 1 }, { key: "b", spend: 100, weight: 1 }], 3);
    assert.equal(even.get("a") + even.get("b"), 21);
    const heavy = splitSlots(21, [{ key: "a", spend: 100, weight: 2 }, { key: "b", spend: 100, weight: 1 }], 3);
    assert.equal(heavy.get("a"), 14);
    assert.equal(heavy.get("b"), 7);

    const funnels = FUNNELS.map((f) => (f.key === "book_call" ? { ...f, weight: 3 } : { ...f }));
    const plan = planBatch(room({ funnels }));
    assertWellFormed(plan);
    assert.ok(funnelRow(plan, "book_call").slots > 6, "weight 3 moves slots to book_call");
  });
});

describe("step 5: fill order", () => {
  test("Chris's ideas first, oldest first, on the funnel they name", () => {
    const ideas = [
      { id: "i-new", source: "chris", raw_points: "newer", funnel_key: null, created_at: "2026-10-13T17:00:00Z" },
      { id: "i-old", source: "chris", raw_points: "older", funnel_key: "book_call", created_at: "2026-10-12T17:00:00Z" },
      { id: "i-sug", source: "suggestion", raw_points: "Has not run in 30 days.", angle_key: "the_guarantee", created_at: "2026-10-12T18:00:00Z" }
    ];
    const plan = planBatch(room({ ideas }));
    assertWellFormed(plan);
    const chris = bySource(plan, "chris_idea");
    assert.equal(chris.length, 3);
    const old = chris.find((s) => s.idea_id === "i-old");
    assert.equal(old.funnel_key, "book_call");
    assert.equal(old.reason, "Chris's idea from Oct 12.");
    assert.equal(forFunnel(plan, "book_call")[0].source, "chris_idea", "ideas lead their funnel's slots");
    assert.equal(forFunnel(plan, "roadmap_147")[0].source, "chris_idea");
    const sug = chris.find((s) => s.idea_id === "i-sug");
    assert.equal(sug.angle_key, "the_guarantee");
    assert.match(sug.reason, /planner's suggestions on Oct 12/);
    assert.ok(!bySource(plan, "fresh_angle").some((s) => s.angle_key === "the_guarantee"), "an idea's angle is not also a fresh slot");
  });

  test("follow the money: the angles with the most spend there, at most 40% of the funnel, new hook and new body", () => {
    const plan = planBatch(room());
    const road = forFunnel(plan, "roadmap_147").filter((s) => s.source === "follow_money");
    assert.equal(road.length, Math.floor(15 * FOLLOW_MONEY_SHARE), "6 of 15");
    assert.ok(road.every((s) => s.angle_key === "two_files"));
    assert.match(road[0].reason, /^Lenders read two files spent the most on Roadmap \$147 last week \(\$412\.00\)\. New hook and new body\./);
    assert.match(road[1].reason, /Version 2 of 6\./);

    const book = forFunnel(plan, "book_call").filter((s) => s.source === "follow_money");
    assert.equal(book.length, 2, "floor(6 x 0.4)");
    assert.deepEqual(book.map((s) => s.angle_key), ["inquiries_off", "speed"], "split across that funnel's spending angles, most first");
    assert.match(book[1].reason, /spent the 2nd most on Book a call/);
    for (const s of [...road, ...book]) assert.match(s.reason, /New hook and new body\./, "rule 34");
  });

  test("follow the money never takes more than 40% of a funnel's slots", () => {
    for (const total of [3, 4, 7, 21, 50]) {
      const plan = planBatch(room({ overrides: { total } }));
      for (const f of plan.funnels) {
        const n = forFunnel(plan, f.funnel_key).filter((s) => s.source === "follow_money").length;
        assert.ok(n <= Math.floor(f.slots * 0.4), `${f.funnel_key}: ${n} of ${f.slots}`);
      }
    }
  });

  test("winner rule: until it has a shape, spend decides (rankFollowMoney)", () => {
    const ads = resolveAdRows(room().ad_rows, new Set(["roadmap_147", "book_call"]));
    const blank = rankFollowMoney(ads, "book_call", new Set(), null);
    const set = rankFollowMoney(ads, "book_call", new Set(), { some: "rule" });
    assert.deepEqual(blank, set);
    assert.deepEqual(blank.map((r) => r.angle_key), ["inquiries_off", "speed"]);
  });

  test("fresh angles: from angles.json, none used in the last 30 days, taken in turn by each funnel", () => {
    const plan = planBatch(room());
    const fresh = bySource(plan, "fresh_angle").filter((s) => s.angle_key);
    assert.deepEqual(fresh.map((s) => s.angle_key).sort(),
      ["bank_said_no", "conveyor_belt", "rates_rising", "the_guarantee", "the_sorting_hat"]);
    assert.ok(!fresh.some((s) => ["two_files", "inquiries_off", "speed"].includes(s.angle_key)), "angles that spent lately are not fresh");
    const rates = fresh.find((s) => s.angle_key === "rates_rising");
    assert.equal(rates.reason, "Rates rising last ran Sep 2, not in the last 30 days.");
    const never = fresh.find((s) => s.angle_key === "bank_said_no");
    assert.equal(never.reason, "Bank turned you down has not run in 30 days.");
    assert.equal(forFunnel(plan, "book_call").filter((s) => s.source === "fresh_angle" && s.angle_key).length, 2, "book_call gets its turns");
    assert.equal(new Set(fresh.map((s) => s.angle_key)).size, fresh.length, "each fresh angle once");
  });

  test("an angle written or planned in the last 30 days is not fresh", () => {
    const recent = [
      { angle_key: "bank_said_no", last_used_on: "2026-10-05" },      // a script written Oct 5
      { angle_key: "the_guarantee", last_used_on: "2026-09-14" }      // 31 days ago: fresh again
    ];
    const plan = planBatch(room({ recent_angles: recent }));
    const fresh = bySource(plan, "fresh_angle").map((s) => s.angle_key);
    assert.ok(!fresh.includes("bank_said_no"));
    assert.ok(fresh.includes("the_guarantee"));
  });

  test("competitor entrants come after the fresh angles, and only when the board has rows", () => {
    const none = planBatch(room());
    assert.equal(bySource(none, "competitor").length, 0, "no board rows, no competitor slots");

    const competitors = [
      { advertiser_id: "1001", name: "Acme Capital", platform: "meta", creatives: 4, angle: "speed_of_money" },
      { advertiser_id: "1002", name: null, platform: "meta", creatives: 1, angle: null }
    ];
    const plan = planBatch(room({ competitors }));
    assertWellFormed(plan);
    const comp = bySource(plan, "competitor");
    assert.equal(comp.length, 2);
    assert.equal(comp[0].reason,
      "New on the competitor board this week: Acme Capital (4 new ads). They lead with speed of money. Write our own take on it, and never name them in the ad.");
    assert.match(comp[1].reason, /^New on the competitor board this week: A new advertiser \(1 new ad\)\./);
    assert.ok(comp.every((s) => s.angle_key === null && s.idea_id === null));
    assert.equal(bySource(plan, "fresh_angle").filter((s) => s.angle_key).length, 5, "the 5 fresh list angles still come first");
    assert.equal(bySource(plan, "fresh_angle").filter((s) => !s.angle_key).length, 21 - 6 - 2 - 5 - 2, "then the board, then the writer's picks");
    for (const f of plan.funnels) {
      const src = forFunnel(plan, f.funnel_key).map((s) => (s.source === "fresh_angle" && !s.angle_key ? "pick" : s.source));
      const firstComp = src.indexOf("competitor");
      if (firstComp < 0) continue;
      assert.ok(!src.slice(firstComp).includes("fresh_angle"), `${f.funnel_key}: no fresh list angle after a competitor slot`);
      assert.ok(!src.slice(0, firstComp).includes("pick"), `${f.funnel_key}: no writer's pick before a competitor slot`);
    }
  });

  test("when the list and the board are used up, the writer picks a new angle", () => {
    const plan = planBatch(room());
    const open = bySource(plan, "fresh_angle").filter((s) => s.angle_key === null);
    assert.equal(open.length, 21 - 6 - 2 - 5, "21 minus follow-the-money minus 5 fresh");
    assert.ok(open.every((s) => s.reason === "Every angle on the list was used in the last 30 days, so the writer picks a new angle."));
    const noList = planBatch(quietRoom({ angles: [] }));
    assert.ok(bySource(noList, "fresh_angle").every((s) => s.reason === "The angle list could not be read, so the writer picks the angle."));
  });

  test("the fill order inside each funnel: ideas, follow the money, fresh, competitor, writer's pick", () => {
    const plan = planBatch(room({
      ideas: [{ id: "i1", source: "chris", raw_points: "x", funnel_key: "roadmap_147", created_at: "2026-10-10T17:00:00Z" }],
      competitors: [{ advertiser_id: "1001", name: "Acme Capital", creatives: 4 }]
    }));
    const rank = (s) => (s.source === "chris_idea" ? 0 : s.source === "follow_money" ? 1
      : s.source === "fresh_angle" && s.angle_key ? 2 : s.source === "competitor" ? 3 : 4);
    for (const f of plan.funnels) {
      const ranks = forFunnel(plan, f.funnel_key).map(rank);
      assert.deepEqual(ranks, [...ranks].sort((a, b) => a - b), `${f.funnel_key} slots follow the fill order`);
    }
  });

  test("an idea naming an active funnel with no spend still gets written there", () => {
    const rows = room().ad_rows.filter((r) => r.ad_row_id === "a91"); // only roadmap spends
    const plan = planBatch(room({
      ad_rows: rows,
      ideas: [{ id: "i1", source: "chris", raw_points: "x", funnel_key: "book_call", created_at: "2026-10-12T17:00:00Z" }]
    }));
    assertWellFormed(plan);
    assert.equal(plan.total, 21);
    assert.equal(funnelRow(plan, "book_call").slots, 1);
    assert.equal(funnelRow(plan, "roadmap_147").slots, 20);
    assert.match(forFunnel(plan, "book_call")[0].reason, /Book a call had no spend last week; it gets this slot because the idea names it\./);
  });

  test("an idea naming a turned-off or unknown funnel waits; ideas past the batch size wait", () => {
    const funnels = FUNNELS.map((f) => (f.key === "book_call" ? { ...f, active: false } : { ...f }));
    const ideas = [
      { id: "off", source: "chris", raw_points: "x", funnel_key: "book_call", created_at: "2026-10-10T17:00:00Z" },
      { id: "gone", source: "chris", raw_points: "x", funnel_key: "no_such", created_at: "2026-10-10T18:00:00Z" },
      ...Array.from({ length: 25 }, (_, i) => ({ id: `m${String(i).padStart(2, "0")}`, source: "chris", raw_points: "x", created_at: `2026-10-11T${String(10 + (i % 10)).padStart(2, "0")}:0${i % 6}:00Z` }))
    ];
    const plan = planBatch(room({ funnels, ideas }));
    assertWellFormed(plan);
    const used = bySource(plan, "chris_idea").map((s) => s.idea_id);
    assert.ok(!used.includes("off") && !used.includes("gone"));
    assert.equal(used.length, 21, "21 slots, 25 ideas: 4 wait for the next batch");
  });

  test("skip_angles leaves those angles out of follow the money, fresh and suggestions", () => {
    const plan = planBatch(room({ overrides: { skip_angles: ["two_files", "rates_rising"] } }));
    assertWellFormed(plan);
    assert.ok(!plan.slots.some((s) => s.angle_key === "two_files" || s.angle_key === "rates_rising"));
    assert.ok(!plan.suggestions.some((s) => s.angle_key === "two_files" || s.angle_key === "rates_rising"));
    assert.equal(forFunnel(plan, "roadmap_147").filter((s) => s.source === "follow_money").length, 0, "no other roadmap angle spent");
  });
});

describe("step 6: formats", () => {
  test("machine slots follow each funnel's format_mix, spread out", () => {
    assert.deepEqual(spreadFormats([["standard", 2], ["sorting", 1]], 6),
      ["standard", "sorting", "standard", "standard", "sorting", "standard"]);
    const plan = planBatch(room());
    const book = forFunnel(plan, "book_call").map((s) => s.script_format);
    assert.equal(book.filter((f) => f === "standard").length, 4);
    assert.equal(book.filter((f) => f === "sorting").length, 2);
    assert.ok(forFunnel(plan, "roadmap_147").every((s) => s.script_format === "standard"));
  });

  test("styles come from format_style", () => {
    const plan = planBatch(room());
    for (const s of plan.slots) assert.equal(s.style, SETTINGS.format_style[s.script_format]);
    const words = planBatch(room({ settings: { ...SETTINGS, format_style: { standard: "words" } } }));
    assert.ok(forFunnel(words, "roadmap_147").every((s) => s.style === "words"));
    assert.ok(forFunnel(words, "book_call").filter((s) => s.script_format === "sorting").every((s) => s.style === "words"),
      "a format the setting leaves out uses the default style");
  });

  test("long only from Chris's ideas with points; never from format_mix", () => {
    assert.deepEqual(machineFormats({ long: 5, standard: 1 }, false), [["standard", 1]]);
    assert.deepEqual(machineFormats({ long: 5 }, false), [["standard", 1]], "nothing usable: standard");
    const funnels = FUNNELS.map((f) => ({ ...f, format_mix: { long: 3, standard: 1 } }));
    const plan = planBatch(room({
      funnels,
      ideas: [{ id: "L", source: "chris", raw_points: "point one. point two. point three.", script_format: "long", funnel_key: "roadmap_147", created_at: "2026-10-12T17:00:00Z" }]
    }));
    assertWellFormed(plan);
    const long = plan.slots.filter((s) => s.script_format === "long");
    assert.equal(long.length, 1);
    assert.equal(long[0].idea_id, "L");
    assert.equal(long[0].style, "words");
  });

  test("VSL only on command", () => {
    assert.deepEqual(machineFormats({ vsl: 1, standard: 1 }, false), [["standard", 1]]);
    assert.deepEqual(machineFormats({ vsl: 1, standard: 1 }, true), [["standard", 1], ["vsl", 1]]);
    const idea = { id: "V", source: "chris", raw_points: "a vsl", script_format: "vsl", created_at: "2026-10-12T17:00:00Z" };
    const weekly = planBatch(room({ ideas: [idea] }));
    assert.ok(!weekly.slots.some((s) => s.script_format === "vsl" || s.idea_id === "V"), "a weekly batch writes no VSL; the idea waits");
    const now = planBatch(room({ ideas: [idea], on_command: { count: 3, funnel_key: null, idea_ids: ["V"] } }));
    assert.equal(now.slots[0].idea_id, "V");
    assert.equal(now.slots[0].script_format, "vsl");
  });
});

describe("step 7: reasons and suggestions", () => {
  test("every slot has a reason, in every room", () => {
    for (const r of [room(), quietRoom(), room({ settings: { ...SETTINGS, size_rule: "per_funnel" } })]) {
      assertWellFormed(planBatch(r));
    }
  });

  test("exactly 3 suggestions, each with a name, a why and its numbers", () => {
    const plan = planBatch(room());
    assert.equal(plan.suggestions.length, SUGGESTION_COUNT);
    for (const s of plan.suggestions) {
      assert.ok(s.angle_key && s.name && s.why);
      assert.deepEqual(Object.keys(s.numbers).sort(), ["cpl_cents", "leads", "spend_7d_cents"]);
      assert.ok("last_ran_on" in s);
    }
    // Every angle is already in this plan, so the best numbers come back in.
    assert.deepEqual(plan.suggestions.map((s) => s.angle_key), ["two_files", "speed", "inquiries_off"]);
    assert.deepEqual(plan.suggestions[0].numbers, { spend_7d_cents: 41200, leads: 9, cpl_cents: 4578 });
    assert.equal(plan.suggestions[0].why, "9 leads last week at $45.78 each.");
    assert.deepEqual(plan.suggestions[2].numbers, { spend_7d_cents: 11150, leads: 0, cpl_cents: null });
    assert.equal(plan.suggestions[2].why, "Spent $111.50 last week. No leads yet.");
  });

  test("suggestions prefer angles that are not in the plan yet", () => {
    const angles = [...room().angles, { key: "fresh_one", name: "Fresh one" }, { key: "fresh_two", name: "Fresh two" }, { key: "fresh_three", name: "Fresh three" }, { key: "fresh_four", name: "Fresh four" }];
    const plan = planBatch(room({ angles, overrides: { total: 9 } }));
    const inPlan = new Set(plan.slots.map((s) => s.angle_key).filter(Boolean));
    assert.equal(plan.suggestions.length, 3);
    assert.ok(plan.suggestions.every((s) => !inPlan.has(s.angle_key)), JSON.stringify(plan.suggestions.map((s) => s.angle_key)));
    for (const s of plan.suggestions.filter((x) => x.numbers.spend_7d_cents === null)) {
      assert.equal(s.numbers.leads, null, "an angle with no ads last week: leads unknown, not 0");
      assert.equal(s.numbers.cpl_cents, null);
    }
  });

  test("a waiting idea's angle is not suggested again", () => {
    const plan = planBatch(room({
      overrides: { total: 3 },
      ideas: [{ id: "w", source: "chris", raw_points: "x", funnel_key: "book_call", angle_key: "bank_said_no", created_at: "2026-10-12T17:00:00Z" }]
    }));
    assert.ok(!plan.suggestions.some((s) => s.angle_key === "bank_said_no"));
  });
});

describe("next_overrides", () => {
  test("total replaces the computed size for the next weekly batch", () => {
    const plan = planBatch(room({ overrides: { total: 12 } }));
    assertWellFormed(plan);
    assert.equal(plan.total, 12);
    assert.deepEqual(plan.overrides, { total: 12 });
  });

  test("funnel_slots pins a funnel's count; 0 leaves it out; the rest splits by spend", () => {
    const pinned = planBatch(room({ overrides: { funnel_slots: { book_call: 10 } } }));
    assertWellFormed(pinned);
    assert.equal(funnelRow(pinned, "book_call").slots, 10);
    assert.equal(funnelRow(pinned, "roadmap_147").slots, 11);
    const zero = planBatch(room({ overrides: { funnel_slots: { book_call: 0 } } }));
    assertWellFormed(zero);
    assert.equal(funnelRow(zero, "book_call").slots, 0);
    assert.equal(funnelRow(zero, "roadmap_147").slots, 21);
    const quiet = planBatch(room({ ad_rows: room().ad_rows.filter((r) => r.ad_row_id === "a91"), overrides: { funnel_slots: { book_call: 5 } } }));
    assert.equal(funnelRow(quiet, "book_call").slots, 5, "a pin brings in a funnel with no spend");
  });

  test("overrides are for the weekly batch: Write now ignores them", () => {
    const plan = planBatch(room({ overrides: { total: 12 }, on_command: { count: 3 } }));
    assertWellFormed(plan);
    assert.equal(plan.total, 3);
    assert.equal(plan.overrides, null);
  });

  test("checkOverrides: {} clears; bad shapes name the field", () => {
    assert.deepEqual(checkOverrides({}), { ok: true, value: null });
    assert.deepEqual(checkOverrides({ total: 14, funnel_slots: { book_call: 4 }, skip_angles: ["Two Files", "two_files"] }),
      { ok: true, value: { total: 14, funnel_slots: { book_call: 4 }, skip_angles: ["two_files"] } });
    const bad = (o) => { const c = checkOverrides(o); assert.equal(c.ok, false); return c.field; };
    assert.equal(bad(null), "overrides");
    assert.equal(bad([]), "overrides");
    assert.equal(bad({ nope: 1 }), "overrides.nope");
    assert.equal(bad({ total: 0 }), "overrides.total");
    assert.equal(bad({ total: 101 }), "overrides.total");
    assert.equal(bad({ total: 2.5 }), "overrides.total");
    assert.equal(bad({ funnel_slots: { "Bad Key": 1 } }), "overrides.funnel_slots.Bad Key");
    assert.equal(bad({ funnel_slots: { book_call: -1 } }), "overrides.funnel_slots.book_call");
    assert.equal(bad({ total: 5, funnel_slots: { book_call: 4, roadmap_147: 4 } }), "overrides.funnel_slots");
    assert.equal(bad({ skip_angles: "two_files" }), "overrides.skip_angles");
    assert.equal(bad({ skip_angles: ["3"] }), "overrides.skip_angles");
  });

  test("cleanOverrides keeps the good parts of a saved value and drops the rest", () => {
    assert.deepEqual(cleanOverrides({ total: 12, nope: true, skip_angles: [42] }), { total: 12 });
    assert.equal(cleanOverrides(null), null);
    assert.equal(cleanOverrides("x"), null);
  });
});

describe("on command (Write now)", () => {
  test("its own count; its funnel only; the ideas it names first", () => {
    const ideas = [
      { id: "older", source: "chris", raw_points: "x", created_at: "2026-10-01T17:00:00Z" },
      { id: "named", source: "chris", raw_points: "y", created_at: "2026-10-12T17:00:00Z" }
    ];
    const plan = planBatch(room({ ideas, on_command: { count: 3, funnel_key: "book_call", idea_ids: ["named"] } }));
    assertWellFormed(plan);
    assert.equal(plan.total, 3);
    assert.ok(plan.slots.every((s) => s.funnel_key === "book_call"));
    assert.equal(plan.slots[0].idea_id, "named");
    assert.equal(plan.slots[1].idea_id, "older");
  });

  test("no count: one day's worth", () => {
    assert.equal(planBatch(room({ on_command: {} })).total, 3);
  });
});

describe("time: the next drop and its week", () => {
  test("Monday 7:00 am Arizona is 14:00 UTC every week (no daylight time)", () => {
    const s = { batch_weekday: 1, batch_time: "07:00", timezone: "America/Phoenix" };
    assert.equal(nextReleaseAt(s, NOW).toISOString(), NEXT_RELEASE);
    assert.equal(nextReleaseAt(s, "2026-12-21T13:59:00Z").toISOString(), "2026-12-21T14:00:00.000Z", "a minute before: today");
    assert.equal(nextReleaseAt(s, "2026-12-21T14:00:00Z").toISOString(), "2026-12-28T14:00:00.000Z", "at the time: next week");
    assert.equal(nextReleaseAt(s, "2026-06-15T13:00:00Z").toISOString(), "2026-06-15T14:00:00.000Z", "summer: still 14:00 UTC");
    assert.equal(nextReleaseAt({ ...s, batch_time: "07:00:00" }, NOW).toISOString(), NEXT_RELEASE, "a pg time string");
    assert.equal(nextReleaseAt({ ...s, batch_weekday: 0, batch_time: "18:30" }, NOW).toISOString(), "2026-10-19T01:30:00.000Z", "Sunday 6:30 pm Arizona");
  });

  test("another time zone keeps its wall clock across daylight time", () => {
    const ny = { batch_weekday: 1, batch_time: "07:00", timezone: "America/New_York" };
    assert.equal(nextReleaseAt(ny, "2026-10-28T12:00:00Z").toISOString(), "2026-11-02T12:00:00.000Z", "EST after Nov 1");
    assert.equal(nextReleaseAt(ny, "2026-10-21T12:00:00Z").toISOString(), "2026-10-26T11:00:00.000Z", "EDT before");
  });

  test("week_key is the ISO week of the release in the settings zone", () => {
    assert.equal(weekKey(NEXT_RELEASE, "America/Phoenix"), NEXT_WEEK);
    assert.equal(weekKey("2027-01-04T06:00:00Z", "America/Phoenix"), "2026-W53", "Sunday Jan 3 in Arizona");
    assert.equal(weekKey("2027-01-04T14:00:00Z", "America/Phoenix"), "2027-W01");
  });

  test("the windows are Arizona days", () => {
    assert.deepEqual(planWindows(NOW), { today: TODAY, spendFrom: "2026-10-08", freshFrom: "2026-09-15" });
    assert.equal(planWindows("2026-10-15T05:00:00Z").today, "2026-10-14", "10 pm Arizona is still the 14th");
    assert.equal(dayWords("2026-09-02"), "Sep 2");
  });
});

describe("the route's answer", () => {
  test("GET/POST marketing/batches/next bodies pass the API contract", () => {
    const answer = nextAnswer({
      inputs: { ...room(), settings: { ...SETTINGS, enabled: false } },
      releaseAt: new Date(NEXT_RELEASE),
      week: NEXT_WEEK,
      saved: null,
      sync: { meta_synced_at: new Date("2026-10-14T14:01:50Z"), metrics_synced_at: null }
    });
    assertMatchesContract("GET marketing/batches/next", answer);
    assertMatchesContract("POST marketing/batches/next", answer);
    assert.equal(answer.next.release_at, NEXT_RELEASE);
    assert.equal(answer.next.week_key, NEXT_WEEK);
    assert.equal(answer.next.enabled, false);
    assert.equal(answer.as_of, "2026-10-14T14:01:50.000Z");
    assert.equal(answer.saved, null);
  });

  test("the same input always gives the same plan", () => {
    assert.deepEqual(planBatch(room()), planBatch(room()));
  });
});
