// src/finance/fundhub-score.mjs — the Fundhub Fundability Score (fh-score-v0).
// The rules under test, each both ways:
//   - no pull → null, never 0, with the reason "needs a credit report"
//   - monotone: fixing any check never lowers the score
//   - an unknown lowers nothing and raises nothing: it lands between the known
//     fail and the known pass
//   - the Fundable band needs UnderwriteIQ's own fundable tier
//   - at most 3 reasons, each tied to a check or finding
//   - the result carries five keys and no weight; no browser file names the weights
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { fundhubScore, fundingReachFrom, FUNDHUB_SCORE_MODEL, FUNDHUB_BANDS } from "./fundhub-score.mjs";

const PASS = {
  score_700: { passed: true, value: 760 },
  utilization_30: { passed: true, value: 6 },
  no_negatives: { passed: true, value: 0 },
  anchor_card: { passed: true, value: 2000000 },
  no_inquiries: { passed: true, value: 0 },
  file_depth: { passed: true, value: 4 }
};
const FAIL = {
  score_700: { passed: false, value: 640 },
  utilization_30: { passed: false, value: 62 },
  no_negatives: { passed: false, value: 1 },
  anchor_card: { passed: false, value: 0 },
  no_inquiries: { passed: false, value: 4 },
  file_depth: { passed: false, value: 2 }
};
const UNKNOWN = { passed: null, value: null };
const KEYS = Object.keys(PASS);

function checks(over = {}) {
  return KEYS.map((key) => ({ key, ...(over[key] || PASS[key]) }));
}
const score = (over, o = {}) => fundhubScore({ checks: checks(over), tier: o.tier ?? null, scored: o.scored ?? true, funding: o.funding ?? null });

describe("the Fundhub score", () => {
  test("no credit pull gives a null score and says it needs a credit report — never 0", () => {
    const r = fundhubScore({ checks: checks(), tier: null, scored: false });
    assert.equal(r.score, null);
    assert.equal(r.band, null);
    assert.equal(r.model, FUNDHUB_SCORE_MODEL);
    assert.match(r.reasons[0].text, /needs a credit report/);
    // Every check unknown, even with a pull: still no number to show.
    const blank = fundhubScore({ checks: KEYS.map((key) => ({ key, ...UNKNOWN })), scored: true });
    assert.equal(blank.score, null);
  });

  test("a clean file scores 100 and reads Fundable only when UnderwriteIQ says fundable", () => {
    assert.equal(score({}, { tier: "fundable" }).score, 100);
    assert.equal(score({}, { tier: "fundable" }).band, "fundable");
    assert.equal(score({}, { tier: "fundable" }).band_label, FUNDHUB_BANDS.fundable);
    // The same points without the engine's own gate are not Fundable.
    assert.equal(score({}, { tier: "not_fundable" }).band, "close");
    assert.equal(score({}, { tier: null }).band, "close");
  });

  test("a messed-up file reads Building, and its reasons name the biggest gaps", () => {
    const r = score(FAIL, { tier: "not_fundable" });
    assert.ok(r.score < 70, `got ${r.score}`);
    assert.equal(r.band, "building");
    assert.equal(r.reasons.length, 3);
    for (const reason of r.reasons) assert.ok(KEYS.includes(reason.check), reason.check);
    assert.ok(r.reasons.some((x) => /negative item/.test(x.text)));
  });

  test("monotone: fixing any one check never lowers the score, from any starting file", () => {
    // Every mix of pass / fail / unknown over the six checks, 3^6 files.
    const states = [PASS, FAIL, null];
    let files = 0;
    for (let i = 0; i < 3 ** KEYS.length; i++) {
      const over = {};
      let n = i;
      KEYS.forEach((k) => { const s = states[n % 3]; n = Math.floor(n / 3); over[k] = s ? s[k] : UNKNOWN; });
      const before = score(over).score;
      for (const k of KEYS) {
        if (over[k].passed === true) continue;
        const after = score({ ...over, [k]: PASS[k] }).score;
        if (before === null) continue;
        assert.ok(after >= before, `${JSON.stringify(over)}: fixing ${k} went ${before} → ${after}`);
        files++;
      }
    }
    assert.ok(files > 1000);
  });

  test("monotone inside a check: less card use, fewer negatives, fewer inquiries never lower it", () => {
    const util = [79, 60, 45, 31].map((v) => score({ utilization_30: { passed: false, value: v } }).score);
    assert.deepEqual([...util].sort((a, b) => a - b), util, `card use ${util}`);
    const neg = [5, 2, 1].map((v) => score({ no_negatives: { passed: false, value: v } }).score);
    assert.deepEqual([...neg].sort((a, b) => a - b), neg);
    const inq = [9, 5, 1].map((v) => score({ no_inquiries: { passed: false, value: v } }).score);
    assert.deepEqual([...inq].sort((a, b) => a - b), inq);
    const sc = [500, 620, 690].map((v) => score({ score_700: { passed: false, value: v } }).score);
    assert.deepEqual([...sc].sort((a, b) => a - b), sc);
  });

  test("an unknown lowers nothing and raises nothing: it counts as if the part were not there", () => {
    const WORST = {
      score_700: { passed: false, value: 500 }, utilization_30: { passed: false, value: 95 },
      no_negatives: { passed: false, value: 5 }, anchor_card: { passed: false, value: 0 },
      no_inquiries: { passed: false, value: 9 }, file_depth: { passed: false, value: 0 }
    };
    for (const k of KEYS) {
      for (const rest of [{}, FAIL, WORST]) {
        const pass = score({ ...rest, [k]: PASS[k] }).score;
        const worst = score({ ...rest, [k]: WORST[k] }).score;
        const unknown = score({ ...rest, [k]: UNKNOWN }).score;
        const absent = fundhubScore({ checks: checks({ ...rest }).filter((c) => c.key !== k), scored: true }).score;
        assert.equal(unknown, absent, `${k}: an unknown is the same as leaving the part out`);
        assert.ok(unknown <= pass, `${k}: unknown ${unknown} above pass ${pass}`);
        assert.ok(unknown >= worst, `${k}: unknown ${unknown} below the worst fail ${worst}`);
      }
    }
    // The unknown is named in the reasons when there is room.
    const r = score({ no_inquiries: UNKNOWN });
    assert.ok(r.reasons.some((x) => x.check === "no_inquiries" && /not on file/.test(x.text)));
  });

  test("funding reach: today against the engine's once-fixed figure, and unknown when either is missing", () => {
    const half = score({}, { funding: { today_cents: 10000000, when_fixed_cents: 20000000 } }).score;
    const full = score({}, { funding: { today_cents: 20000000, when_fixed_cents: 20000000 } }).score;
    const none = score({}, { funding: { today_cents: null, when_fixed_cents: 20000000 } }).score;
    assert.ok(half < full);
    assert.equal(none, 100, "an unknown figure takes nothing away");
    assert.equal(full, 100);
    assert.deepEqual(fundingReachFrom({ personal: { currentCents: 5, projectedCents: 9 } }), { today_cents: 5, when_fixed_cents: 9 });
    assert.equal(fundingReachFrom(null), null);
  });

  test("the result is five keys — no weights, no parts, no points ship", () => {
    const r = score(FAIL, { tier: "not_fundable" });
    assert.deepEqual(Object.keys(r).sort(), ["band", "band_label", "model", "reasons", "score"]);
    for (const reason of r.reasons) assert.deepEqual(Object.keys(reason).sort(), ["check", "text"]);
    assert.doesNotMatch(JSON.stringify(r), /weight|zero_at|full_at|close_at/);
  });
});

describe("the formula stays private", () => {
  const ROOT = path.resolve(new URL("../..", import.meta.url).pathname);
  function browserFiles(dir) {
    const out = [];
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) out.push(...browserFiles(p));
      else if (/\.(js|mjs|html|css|json)$/.test(e.name)) out.push(p);
    }
    return out;
  }

  test("no file under public/ names the weights object or the private-formula note", () => {
    const files = browserFiles(path.join(ROOT, "public"));
    assert.ok(files.length > 50);
    for (const f of files) {
      const body = fs.readFileSync(f, "utf8");
      assert.ok(!body.includes("FUNDHUB_SCORE_WEIGHTS"), f);
      assert.ok(!body.includes("formula is private"), f);
      assert.ok(!/fundhub-score\.mjs/.test(body), `${f} imports the server model`);
    }
  });

  test("the weights live in one frozen object in the server file, with the owner note", () => {
    const src = fs.readFileSync(path.join(ROOT, "src/finance/fundhub-score.mjs"), "utf8");
    assert.match(src, /owner-set 2026-11-07: draft v0, Chris tunes as UnderwriteIQ changes; formula is private/);
    assert.equal((src.match(/const FUNDHUB_SCORE_WEIGHTS = Object\.freeze/g) || []).length, 1);
    assert.doesNotMatch(src, /export const FUNDHUB_SCORE_WEIGHTS|export \{[^}]*FUNDHUB_SCORE_WEIGHTS/);
  });
});
