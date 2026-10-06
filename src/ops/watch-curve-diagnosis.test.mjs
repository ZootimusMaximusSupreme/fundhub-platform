// The "what to fix in the next take" table — ad_watch_curve_diagnoses (395).
//
// Until 2026-10-05 nothing wrote it: 0 rows, and the board said "it does not
// fill itself every morning yet" (ops/workflows/roadmap-run-2026-09-27.md:144).
//
// RECORDED DATA. RECORDED below is every SLO ad-day the Meta pull saved, read
// read-only from production ad_metrics_daily on 2026-10-05 (no names, no money —
// just Meta's video counts, all clicks, and the curve). The expected verdict of
// every row was worked out BY HAND from the law, not by running the code:
//
//   fewer than 10 plays                                → too_few, no row
//   p25/plays under one half, clicks >= p25 (and > 0)  → hop, no row
//   p25/plays under one half, otherwise                → opening
//       curve at second 2 under 50                     →   fix both
//       otherwise                                      →   fix words
//
// NO DATABASE. The fill is driven with a fake db; the SQL it sends is checked
// by text. What this cannot prove: that the INSERT survives the partner row
// security on the live table and that the ON CONFLICT matches the unique index.
// Those are proved after ship by the read-only SQL on the board.

import { test, describe } from "node:test";
import assert from "node:assert";
import {
  diagnoseCurve,
  fillDiagnoses,
  secondTwoHold,
  UNDIAGNOSED_DAYS_SQL,
  INSERT_DIAGNOSIS_SQL
} from "./watch-curve.mjs";

// [ad, date, plays, p25, p50, clicks, curve, expected verdict, expected fix]
const RECORDED = [
  ["SLO1", "2026-09-26", 281, 92, 30, 64, [100,71,67,64,50,46,39,38,37,37,36,34,34,33,33,33,19,12,8,3,2,0], "opening", "words"],
  ["SLO1", "2026-09-27", 33, 8, 2, 3, [100,76,48,42,36,36,33,33,30,30,30,27,24,24,18,18,12,6,6,3,3,0], "opening", "both"],
  ["SLO1", "2026-09-28", 20, 1, 1, 3, [100,70,35,25,15,15,15,5,5,5,5,5,5,5,5,5,5,10,5,5,0,0], "hop", null],
  ["SLO1", "2026-09-29", 29, 3, 3, 1, [100,59,48,38,31,28,24,24,21,21,14,14,10,10,10,10,10,10,10,3,3,0], "opening", "both"],
  ["SLO1", "2026-09-30", 6, 1, null, 0, [100,100,83,67,67,67,50,50,50,50,50,50,33,17,17,17,17,0,0,0,0,0], "too_few", null],
  ["SLO1", "2026-10-01", 19, 2, 1, 1, [100,63,37,37,32,26,21,21,21,21,16,16,11,11,11,5,5,5,5,0,0,0], "opening", "both"],
  ["SLO1", "2026-10-02", 66, 22, 12, 10, [100,69,58,53,44,42,40,39,39,37,34,32,32,32,32,32,27,21,13,6,6,0], "opening", "words"],
  ["SLO1", "2026-10-03", 11, 2, null, 2, [100,55,36,27,18,18,18,18,18,18,18,18,18,18,18,27,9,0,9,0,0,0], "hop", null],
  ["SLO1", "2026-10-04", 29, 9, 5, 2, [100,68,52,48,40,36,36,36,36,36,36,36,36,36,36,36,24,20,20,8,8,0], "opening", "words"],
  ["SLO2", "2026-09-26", 73, 6, 2, 4, [100,70,41,32,22,18,14,14,12,12,10,10,10,8,8,11,5,4,4,1,0,0], "opening", "both"],
  ["SLO2", "2026-09-27", 63, 5, 4, 0, [100,57,33,25,22,17,16,13,8,8,8,8,6,6,6,8,6,6,6,2,2,2], "opening", "both"],
  ["SLO2", "2026-09-28", 74, 9, 6, 5, [100,64,29,25,22,21,18,17,17,15,17,15,15,14,14,18,13,10,10,8,8,8], "opening", "both"],
  ["SLO2", "2026-09-29", 116, 9, 4, 6, [100,73,49,37,30,23,17,14,10,10,10,9,8,8,8,8,4,3,3,2,1,1], "opening", "both"],
  ["SLO2", "2026-09-30", 209, 34, 12, 17, [100,76,55,44,38,32,27,23,20,20,20,19,17,17,16,18,12,8,8,5,4,3], "opening", "words"],
  ["SLO2", "2026-10-01", 504, 42, 24, 26, [100,72,46,36,28,22,17,15,14,14,13,11,11,10,10,10,6,6,5,4,3,3], "opening", "both"],
  ["SLO2", "2026-10-02", 323, 31, 16, 16, [100,74,49,38,30,25,20,18,17,16,14,14,11,11,10,11,7,6,5,4,3,2], "opening", "both"],
  ["SLO2", "2026-10-03", 384, 38, 12, 18, [100,75,50,38,28,24,20,19,17,16,15,14,13,12,11,11,8,6,3,3,3,2], "opening", "words"],
  ["SLO2", "2026-10-04", 295, 35, 19, 26, [100,82,58,45,36,28,24,22,20,20,19,17,17,16,16,13,8,7,7,6,6,3], "opening", "words"],
  ["SLO3", "2026-09-26", 506, 48, 16, 27, [100,79,39,24,18,16,15,14,13,12,11,10,10,9,9,9,5,3,3,2,0,0], "opening", "both"],
  ["SLO3", "2026-09-27", 372, 122, 67, 43, [100,83,55,44,40,38,37,37,35,35,35,34,33,33,33,34,22,17,14,6,0,0], "opening", "words"],
  ["SLO3", "2026-09-28", 189, 15, 5, 7, [100,79,39,22,14,13,13,11,10,9,8,8,8,7,7,5,4,3,3,1,0,0], "opening", "both"],
  ["SLO3", "2026-09-29", 179, 42, 36, 26, [100,79,49,38,34,31,29,28,27,25,25,24,24,24,22,22,21,20,20,5,0,0], "opening", "both"],
  ["SLO3", "2026-09-30", 28, 2, 1, 3, [100,64,44,32,32,44,32,24,20,8,8,8,8,8,4,4,4,4,4,0,0,0], "hop", null],
  ["SLO3", "2026-10-01", 31, 5, 2, 4, [100,72,41,24,24,24,24,21,21,21,21,17,17,17,17,17,14,7,3,0,0,0], "opening", "both"],
  ["SLO3", "2026-10-02", 31, 3, 2, 1, [100,63,30,20,13,10,10,10,10,10,10,10,10,10,10,10,7,7,7,0,0,0], "opening", "both"],
  ["SLO3", "2026-10-03", 31, 1, 1, 2, [100,68,39,19,13,13,6,3,3,3,3,3,3,3,3,3,3,3,3,3,0,0], "hop", null],
  ["SLO3", "2026-10-04", 35, 2, 2, 1, [100,61,30,15,9,9,9,6,6,6,6,6,6,6,6,9,6,6,6,6,0,0], "opening", "both"],
  ["SLO4", "2026-09-26", 339, 22, 12, 32, [100,75,46,35,24,20,12,10,10,10,9,8,8,7,7,7,5,4,4,3,2,1], "hop", null],
  ["SLO4", "2026-09-27", 207, 17, 8, 10, [100,81,40,27,22,18,17,15,13,11,10,10,10,9,9,8,6,5,4,3,4,2], "opening", "both"],
  ["SLO4", "2026-09-28", 162, 11, 7, 4, [100,77,43,26,22,19,17,15,14,12,10,9,9,7,7,7,5,4,4,3,2,1], "opening", "both"],
  ["SLO4", "2026-09-29", 75, 8, 2, 7, [100,82,59,41,32,29,25,22,19,19,16,15,15,15,14,15,8,7,5,3,3,3], "opening", "words"],
  ["SLO4", "2026-09-30", 25, 1, null, 0, [100,68,44,24,24,20,16,12,8,8,4,4,4,4,4,4,4,4,0,0,0,0], "opening", "both"],
  ["SLO4", "2026-10-01", 11, 1, null, 1, [100,60,50,30,20,20,20,20,10,10,10,10,10,10,10,20,0,0,0,0,0,0], "hop", null],
  ["SLO4", "2026-10-02", 25, 1, null, 3, [100,60,24,20,16,12,8,4,4,4,4,4,4,4,4,4,0,0,0,0,0,0], "hop", null],
  ["SLO4", "2026-10-03", 19, 2, null, 1, [100,65,41,35,29,24,18,18,18,24,18,12,6,6,6,12,0,0,0,0,0,0], "opening", "both"],
  ["SLO4", "2026-10-04", 25, 1, null, 5, [100,54,21,17,8,8,8,8,8,8,8,8,4,4,4,4,4,8,0,0,0,0], "hop", null]
];

const ORG = "00000000-0000-0000-0000-0000000000a1";
const PARTNER = "00000000-0000-0000-0000-0000000000b2";

const toRow = ([ad, date, plays, p25, p50, clicks, curve], i) => ({
  id: `m-${ad}-${date}`,
  org_id: ORG,
  partner_id: PARTNER,
  date,
  video_plays: plays,
  video_continuous_2s_watched: null, // NULL on every recorded row — Meta did not report it
  video_p25_watched: p25,
  video_p50_watched: p50,
  clicks,
  // pg hands jsonb back parsed; alternate with a string to prove both shapes work
  video_play_curve: i % 2 ? JSON.stringify(curve) : curve
});

describe("diagnoseCurve — every recorded SLO ad-day, checked by hand against the law", () => {
  RECORDED.forEach((r, i) => {
    const [ad, date, , , , , , verdict, fix] = r;
    test(`${ad} ${date} → ${verdict}${fix ? ` / ${fix}` : ""}`, () => {
      const out = diagnoseCurve(toRow(r, i));
      assert.equal(out.verdict, verdict);
      assert.equal(out.fix_type, fix);
      assert.equal(out.diagnosis, verdict === "opening" ? "opening" : null);
    });
  });

  test("SLO2 on its last day: the note says what happened and what to film, from that day's numbers", () => {
    const out = diagnoseCurve(toRow(RECORDED.find((r) => r[0] === "SLO2" && r[1] === "2026-10-04"), 0));
    assert.equal(out.film_note,
      "Only 12% of plays reached the quarter mark, and there were fewer clicks (26) than people who got that far (35). " +
      "Film a new first line. Keep the body.");
  });

  test("SLO3's first day: most were gone by second 2, so the fix is a new cold open", () => {
    const out = diagnoseCurve(toRow(RECORDED.find((r) => r[0] === "SLO3" && r[1] === "2026-09-26"), 0));
    assert.equal(out.fix_type, "both");
    assert.match(out.film_note, /^Only 39% were still watching at second 2, and 9% reached the quarter mark\./);
    assert.match(out.film_note, /new first frame and a new first line/);
  });

  test("a hop is never an opening problem: the law says do not recut it", () => {
    for (const [i, r] of RECORDED.entries()) {
      if (r[7] !== "hop") continue;
      assert.equal(diagnoseCurve(toRow(r, i)).diagnosis, null, `${r[0]} ${r[1]}`);
    }
  });

  test("the film note always fits the table's check (1 to 2000 characters)", () => {
    for (const [i, r] of RECORDED.entries()) {
      const note = diagnoseCurve(toRow(r, i)).film_note;
      if (note == null) continue;
      assert.ok(note.trim().length >= 1 && note.length <= 2000);
    }
  });
});

/* No recorded day got past the quarter mark with most plays, so the middle and
   the ask are proved on made-up rows. Each one is labelled as made up. */
describe("diagnoseCurve — past the quarter mark (made-up rows, the recorded ads never got there)", () => {
  const base = { video_play_curve: [100, 90, 80], video_continuous_2s_watched: null };

  test("most reach 25%, under half of those reach 50%, few clicks → middle", () => {
    const out = diagnoseCurve({ ...base, video_plays: 100, video_p25_watched: 60, video_p50_watched: 20, clicks: 5 });
    assert.equal(out.diagnosis, "middle");
    assert.equal(out.fix_type, "words");
    assert.match(out.film_note, /^60% of plays reached the quarter mark, but only 33% of them reached halfway\./);
  });

  test("they pass halfway and still do not tap → ask (the offer or the last line)", () => {
    const out = diagnoseCurve({ ...base, video_plays: 100, video_p25_watched: 60, video_p50_watched: 45, clicks: 5 });
    assert.equal(out.diagnosis, "ask");
    assert.equal(out.fix_type, "words");
    assert.match(out.film_note, /offer or the last line/);
  });

  test("they watch AND tap → no row; the ad is doing its job", () => {
    const out = diagnoseCurve({ ...base, video_plays: 100, video_p25_watched: 60, video_p50_watched: 45, clicks: 60 });
    assert.equal(out.diagnosis, null);
    assert.equal(out.verdict, "tapping");
  });

  test("Meta did not report 50% → no guess; NULL is not zero", () => {
    const out = diagnoseCurve({ ...base, video_plays: 100, video_p25_watched: 60, video_p50_watched: null, clicks: 5 });
    assert.equal(out.diagnosis, null);
  });

  test("a photo ad (no video numbers at all) → no row", () => {
    assert.equal(diagnoseCurve({ video_plays: null, video_p25_watched: null, clicks: 9 }).diagnosis, null);
  });
});

describe("secondTwoHold — Meta's 2-second count first, then the curve", () => {
  test("uses the 2-second continuous count when Meta gave it", () => {
    assert.equal(secondTwoHold({ video_plays: 200, video_continuous_2s_watched: 50, video_play_curve: [100, 90, 80] }), 0.25);
  });
  test("falls back to the curve's second-2 entry", () => {
    assert.equal(secondTwoHold({ video_plays: 200, video_continuous_2s_watched: null, video_play_curve: [100, 90, 41] }), 0.41);
  });
  test("unknown when neither is there", () => {
    assert.equal(secondTwoHold({ video_plays: 200 }), null);
  });
});

describe("fillDiagnoses — fills the table from the saved days", () => {
  function fakeDb(rows) {
    const calls = [];
    return {
      calls,
      query: async (sql, params) => {
        calls.push({ sql, params });
        if (/FROM ad_metrics_daily m/i.test(sql)) return { rows };
        if (/INSERT INTO ad_watch_curve_diagnoses/i.test(sql)) return { rows: [], rowCount: 1 };
        return { rows: [], rowCount: 0 };
      }
    };
  }

  test("all 36 recorded days: 27 opening rows written, 8 hops and 1 too-few left alone", async () => {
    const db = fakeDb(RECORDED.map(toRow));
    const out = await fillDiagnoses(db, { partnerId: PARTNER, days: 28 });
    assert.equal(out.checked, 36);
    assert.equal(out.written, 27);
    assert.equal(out.opening, 27);
    assert.equal(out.hop, 8);
    assert.equal(out.too_few, 1);
    assert.equal(out.middle, 0);
    assert.equal(out.ask, 0);

    const inserts = db.calls.filter((c) => /INSERT INTO ad_watch_curve_diagnoses/i.test(c.sql));
    assert.equal(inserts.length, 27);
    assert.equal(inserts.filter((c) => c.params[4] === "both").length, 19);
    assert.equal(inserts.filter((c) => c.params[4] === "words").length, 8);
    const slo2Last = inserts.find((c) => c.params[2] === "m-SLO2-2026-10-04");
    assert.deepEqual(slo2Last.params.slice(0, 5), [ORG, PARTNER, "m-SLO2-2026-10-04", "opening", "words"]);
  });

  test("it only reads the window, this partner, days with video numbers, and days with no diagnosis yet", async () => {
    const db = fakeDb([]);
    await fillDiagnoses(db, { partnerId: PARTNER, days: 28 });
    assert.equal(db.calls[0].sql, UNDIAGNOSED_DAYS_SQL);
    assert.deepEqual(db.calls[0].params, [PARTNER, 28]);
    assert.match(UNDIAGNOSED_DAYS_SQL, /m\.partner_id = \$1/);
    assert.match(UNDIAGNOSED_DAYS_SQL, /m\.date >= CURRENT_DATE - \$2::int/);
    assert.match(UNDIAGNOSED_DAYS_SQL, /m\.video_plays IS NOT NULL/);
    assert.match(UNDIAGNOSED_DAYS_SQL, /d\.id IS NULL/);
  });

  test("a row Chris changed is never overwritten — insert or nothing", () => {
    assert.match(INSERT_DIAGNOSIS_SQL, /ON CONFLICT \(ad_metrics_daily_id\) DO NOTHING/);
    assert.doesNotMatch(INSERT_DIAGNOSIS_SQL, /DO UPDATE/i);
  });

  test("it writes only the diagnosis table — never an ad, a campaign or a budget", async () => {
    const db = fakeDb(RECORDED.map(toRow));
    await fillDiagnoses(db, { partnerId: PARTNER });
    const writes = db.calls.filter((c) => /\b(INSERT|UPDATE|DELETE)\b/i.test(c.sql));
    assert.ok(writes.length > 0);
    for (const w of writes) assert.match(w.sql, /INSERT INTO ad_watch_curve_diagnoses/);
  });

  test("no partner → does nothing", async () => {
    const db = fakeDb(RECORDED.map(toRow));
    const out = await fillDiagnoses(db, {});
    assert.equal(out.checked, 0);
    assert.equal(db.calls.length, 0);
  });
});

/* Taps to the page (M1's 408 link_clicks / landing_page_views) replace every
   click once the columns exist. Recorded: SLO4 on 2026-09-26 had 17 landing page
   views (Meta, marketing/ads/curve-optimization.md "Measured example"). */
describe("diagnoseCurve — taps to the page, once 408 saves them", () => {
  const slo4 = (i) => toRow(RECORDED.find((r) => r[0] === "SLO4" && r[1] === "2026-09-26"), i);

  test("SLO4 2026-09-26: a hop on every click (32 >= 22), an opening on taps to the page (17 < 22)", () => {
    assert.equal(diagnoseCurve(slo4(0)).verdict, "hop");
    const out = diagnoseCurve({ ...slo4(0), link_clicks: null, landing_page_views: 17, link_clicks_saved: true });
    assert.equal(out.diagnosis, "opening");
    assert.equal(out.fix_type, "both");
  });

  test("the note names taps to the page when that is what was counted", () => {
    const out = diagnoseCurve({ ...toRow(RECORDED.find((r) => r[0] === "SLO2" && r[1] === "2026-10-04"), 0),
      link_clicks: 9, landing_page_views: 7, link_clicks_saved: true });
    assert.equal(out.film_note,
      "Only 12% of plays reached the quarter mark, and there were fewer taps to the page (9) than people who got that far (35). " +
      "Film a new first line. Keep the body.");
  });

  test("the fill reads link clicks and page views without naming the columns (works before 408 ships)", () => {
    assert.match(UNDIAGNOSED_DAYS_SQL, /to_jsonb\(m\) ->> 'link_clicks'/);
    assert.match(UNDIAGNOSED_DAYS_SQL, /to_jsonb\(m\) ->> 'landing_page_views'/);
    assert.match(UNDIAGNOSED_DAYS_SQL, /to_jsonb\(m\) \? 'link_clicks'/);
  });
});
