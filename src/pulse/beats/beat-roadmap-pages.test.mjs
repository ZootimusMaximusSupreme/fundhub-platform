import test from "node:test";
import assert from "node:assert/strict";
import * as beat from "./beat-roadmap-pages.mjs";
import * as truth from "./lib/funnel-pages-truth.mjs";
import * as lane from "../coverage/gap-funnels.mjs";
import * as leadPipe from "./beat-lead-pipe.mjs";
import * as payLinks from "./beat-pay-links.mjs";
import { checkBeatSelfTest, runBeat, validateBeat } from "./contract.mjs";
import { makeFakeCtx, ctxLog } from "./ctx.mjs";
import { laneSelfTest } from "./lib/money-hourly.mjs";
import { TRIPWIRES } from "../tripwires.mjs";

const OTHER_BEATS = { "lead-pipe": leadPipe, "pay-links": payLinks };
const ORDER = "GET https://apply.fundhub.ai/order";
const withHttp = (over) => laneSelfTest({ ...beat.LANE, selfTest: { ...beat.LANE.selfTest, failHttp: { ...beat.LANE.selfTest.passHttp, ...over } } }, true);

test("roadmap-pages is valid, green when the card box script loads and /order matches the till, red when the script is an error page", async () => {
  assert.deepEqual(validateBeat(beat, { file: "beat-roadmap-pages.mjs" }), []);
  assert.deepEqual(await checkBeatSelfTest(beat), []);
  const passed = await runBeat(beat, makeFakeCtx(beat, beat.selfTest.pass()));
  assert.equal(passed.ok, true, passed.detail);
  assert.equal(passed.detail, "2 roadmap page checks passed");
  const failed = await runBeat(beat, makeFakeCtx(beat, beat.selfTest.fail()));
  assert.equal(failed.ok, false);
  assert.equal(failed.step, "funnel-card-box-script-loads");
  assert.match(failed.detail, /came back as text\/html, not JavaScript/);
});

test("roadmap-pages: /order selling at another price is red at the order step", async () => {
  const page = beat.LANE.selfTest.passHttp[ORDER];
  const result = await runBeat(beat, makeFakeCtx(beat, withHttp({ [ORDER]: { ...page, body: page.body.replace("14700", "29700") } })));
  assert.equal(result.ok, false);
  assert.equal(result.step, "funnel-order-price-matches-till");
  assert.match(result.detail, /charges \$297 but the till says \$147/);
});

test("roadmap-pages: /order taken down, or sent elsewhere, is green; a page that no longer names a card box is red", async () => {
  for (const gone of [{ status: 404, body: "" }, { status: 200, body: "<html>other</html>", finalUrl: "https://apply.fundhub.ai/roadmap" }]) {
    const result = await runBeat(beat, makeFakeCtx(beat, withHttp({ [ORDER]: gone })));
    assert.equal(result.ok, true, result.detail);
  }
  const bare = await runBeat(beat, makeFakeCtx(beat, withHttp({ "GET https://apply.fundhub.ai/roadmap": { status: 200, body: "<html>no widget</html>" } })));
  assert.equal(bare.ok, false);
  assert.equal(bare.step, "funnel-card-box-script-loads");
  assert.match(bare.detail, /no longer names a card box script/);
});

test("roadmap-pages: /roadmap that cannot be read is skipped (the page door is reported elsewhere), never green on that step", async () => {
  const down = await runBeat(beat, makeFakeCtx(beat, withHttp({ "GET https://apply.fundhub.ai/roadmap": { status: 503, body: "" } })));
  assert.equal(down.ok, true);
  assert.ok(down.steps.find((s) => s.name === "funnel-card-box-script-loads").skipped);
});

test("roadmap-pages: reads apply.fundhub.ai, the till on our site and the script host, GET only, one read of each address", async () => {
  const ctx = makeFakeCtx(beat, beat.selfTest.pass());
  await runBeat(beat, ctx);
  const log = ctxLog(ctx);
  assert.equal(log.refused.length, 0);
  assert.ok(log.http.every((c) => c.method === "GET"));
  assert.deepEqual(log.http.map((c) => c.host).sort(), ["apply.fundhub.ai", "apply.fundhub.ai", "cdn.embedded.fanbasis.io", "fundhub.ai"]);
});

test("roadmap-pages: a FUNNEL_URL on another host is skipped with the reason, never read and never green", async () => {
  const ctx = makeFakeCtx(beat, { ...beat.selfTest.pass(), env: { FUNNEL_URL: "https://funnels.example.com" } });
  const result = await runBeat(beat, ctx);
  assert.equal(result.ok, true);
  assert.match(result.detail, /2 had nothing safe to judge/);
  assert.equal(ctxLog(ctx).http.length, 0);
});

test("roadmap-pages: the daily lane and the hourly beat share one reader and one judge", () => {
  assert.equal(lane.cardBoxScriptUrl, truth.cardBoxScriptUrl);
  assert.equal(lane.orderPriceCents, truth.orderPriceCents);
  assert.equal(lane.tillPriceCents, truth.tillPriceCents);
  assert.equal(lane.MIN_CARD_BOX_BYTES, truth.MIN_CARD_BOX_BYTES);
  const run = lane.GAP_WIDGET_CHECKS.find((c) => c.id === "funnel:card-box-script-loads").run;
  assert.equal(run, truth.checkCardBox);
  assert.equal(lane.GAP_WIDGET_CHECKS.find((c) => c.id === "funnel:order-price-matches-till").run, truth.checkOrderPrice);
});

test("roadmap-pages: every deep check a covered page names runs hourly, here or at a named step of another beat", () => {
  for (const surface of beat.covers) {
    const wire = TRIPWIRES[surface];
    assert.ok(wire, `${surface} is not a tripwire`);
    for (const checkId of wire.checks) {
      if (beat.HOURLY_CHECK_IDS.includes(checkId)) continue;
      const elsewhere = beat.RUNS_ELSEWHERE[checkId];
      assert.ok(elsewhere, `${surface} needs ${checkId} hourly`);
      const [otherId, step] = elsewhere;
      assert.equal(OTHER_BEATS[otherId].id, otherId);
      assert.ok(OTHER_BEATS[otherId].steps.includes(step), `${otherId} has no step ${step}`);
      assert.ok(OTHER_BEATS[otherId].HOURLY_CHECK_IDS.includes(checkId), `${otherId} does not run ${checkId}`);
    }
  }
});
