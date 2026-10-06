// The match step's take number, against a real Postgres.
//
// The database half of the "match (spec §9.1 step 5)" block in
// src/ad-videos/pipeline.test.mjs. That file proves the step ASKS for the next
// free number; only Postgres can prove the number it gets back, and that the
// second take of an ad does not hit ad_videos_take_uq. So this runs the real
// step and writes its verdict through the real store.patch(), the same two
// calls the sweeper makes (src/workflows/ad-video-sweeper.mjs walk()).
//
// ad_videos and ad_scripts carry FORCEd row-level security, so every fixture
// goes through asStaff(). Ad numbers start 99993 and Drive ids start
// "u18-take-number-", so nothing real can collide and the purge touches only
// what this file made.

import { test, before, after, describe } from "node:test";
import assert from "node:assert";
import { db, close } from "../db.mjs";
import { resolveDefaultOrg } from "../auth/org.mjs";
import { asStaff } from "../partners/rls.mjs";
import { matchAndRename, NEXT_FREE_TAKE_NO } from "./pipeline.mjs";
import * as store from "./store.mjs";

const HAVE_DB = !!process.env.DATABASE_URL;

const AD = "999930001";
const DRIVE_MARK = "u18-take-number-";

const HOOK = "Most people apply for funding in the wrong order and the bank says no.";
const BODY = [
  HOOK,
  "It is not your score. It is the order you asked in.",
  "Fix the order first and the same bank says yes.",
  "Book the call and we will show you the order."
].join("\n\n");

/** A straight read, with the fillers Whisper is told to keep. */
const READ = "most people apply for funding in the the wrong order uh and the bank says no " +
  "it is not your score it is the order you asked in umm fix the order first and the same bank says yes " +
  "book the call and we will show you the order";

describe("the take number, against a real Postgres", { skip: !HAVE_DB ? "no DATABASE_URL" : false }, () => {
  let org = null;
  let partner = null;
  let script = null;
  let seq = 0;

  async function purge() {
    await asStaff(async (tx) => {
      await tx.query(`DELETE FROM ad_videos WHERE drive_raw_file_id LIKE $1`, [`${DRIVE_MARK}%`]);
      await tx.query(`DELETE FROM ad_scripts WHERE ad_id = $1`, [AD]);
    });
  }

  before(async () => {
    org = await resolveDefaultOrg(db);
    partner = (await db.query(
      `SELECT id FROM partners WHERE org_id = $1 AND slug = 'fundhub-house'`, [org]
    )).rows[0]?.id;
    assert.ok(partner, "no house partner row — 377 has not been applied to this database");
    await purge();
    script = await asStaff(async (tx) => (await tx.query(
      `INSERT INTO ad_scripts (org_id, partner_id, title, body, hook_text, ad_id)
       VALUES ($1, $2, 'U18 take-number fixture', $3, $4, $5)
       RETURNING id, ad_id AS "adId", title, hook_text, body`,
      [org, partner, BODY, HOOK, AD]
    )).rows[0]);
  });

  after(async () => { await purge(); await close(); });

  /** A take at `transcribed`, the way readTranscript leaves it: no ad, no take. */
  const landed = ({ name = null, scriptId = null, adId = null, takeNo = null } = {}) =>
    asStaff(async (tx) => {
      seq += 1;
      return (await tx.query(
        `INSERT INTO ad_videos
           (org_id, partner_id, status, video_kind, drive_raw_file_id, drive_raw_name,
            transcript, script_id, ad_id, take_no)
         VALUES ($1, $2, 'transcribed', 'ad', $3, $4, $5, $6, $7, $8)
         RETURNING id, org_id, status, ad_id, take_no, script_id, drive_raw_name,
                   transcript, match_confidence`,
        [org, partner, `${DRIVE_MARK}${seq}`, name || `IMG_${4470 + seq}.MOV`, READ, scriptId, adId, takeNo]
      )).rows[0];
    });

  const lastTake = () => asStaff((tx) => store.lastTakeNo(tx, { orgId: org, adId: AD }));

  /** The sweeper's two calls for one row: the step, then store.patch(). */
  async function step(row, ports = {}) {
    const out = await matchAndRename(row, { candidateScripts: [script], env: {}, ...ports });
    assert.equal(out.ok, true, out.error || "the step did not match");
    return { out, written: await store.patch(db, row.id, out.patch) };
  }

  test("A SECOND TAKE FOR AN AD GETS TAKE 2 — no collision on ad_videos_take_uq", async () => {
    const last = await lastTake();
    const a = await step(await landed());
    const b = await step(await landed());
    assert.equal(a.out.patch.take_no, NEXT_FREE_TAKE_NO, "a phone name carries no take number");
    assert.equal(a.written.status, "matched");
    assert.equal(a.written.ad_id, AD);
    assert.equal(a.written.script_id, script.id);
    assert.equal(a.written.take_no, last + 1);
    assert.equal(b.written.status, "matched");
    assert.equal(b.written.take_no, last + 2, "the second take is the next number, not take 1 again");
  });

  test("a row matched before this change (script set, no take number) gets the next free one and no new match", async () => {
    const last = await lastTake();
    const old = await landed({ scriptId: script.id, adId: AD });
    let modelCalls = 0;
    const model = async () => { modelCalls += 1; throw new Error("the model was called"); };
    const { written } = await step(old, {
      candidateScripts: [], env: { ANTHROPIC_API_KEY: "sk-ant-test" }, fetchImpl: model
    });
    assert.equal(modelCalls, 0);
    assert.equal(written.status, "matched");
    assert.equal(written.script_id, script.id);
    assert.equal(written.take_no, last + 1);
  });

  test('"Take N" in the file name is take N', async () => {
    const { written } = await step(await landed({ name: `SLO Ad ${AD} Take 40.mp4` }));
    assert.equal(written.take_no, 40);
  });

  test("a number already on the row is never re-numbered, even if the next free one is asked for", async () => {
    const row = await landed({ adId: AD, takeNo: 77 });
    const written = await store.patch(db, row.id, { ad_id: AD, take_no: NEXT_FREE_TAKE_NO });
    assert.equal(written.take_no, 77);
  });
});
