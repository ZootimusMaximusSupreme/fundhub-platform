// The Mac runner (src/finance/money-helper-runner.mjs): beats, claims, answers
// with the AI routed to Claude Code, hands back what it held on stop.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { makeHelperRunner, POLL_MS, BEAT_MS } from "./money-helper-runner.mjs";

const TURN = { id: "aaaaaaaa-0000-4000-8000-000000000001", org_id: "org", client_id: "c", kind: "message" };

function deps(over = {}) {
  const d = {
    log: [], beats: 0, offs: 0, routed: [], processed: [], requeued: [], swept: [], intervals: [],
    claimQueue: [TURN],
    claimNextTurn: async () => d.claimQueue.shift() || null,
    requeueTurn: async (_db, id) => { d.requeued.push(id); return { id }; },
    reclaimStale: async () => ({ requeued: 0, giveUp: [] }),
    processTurn: async (_db, turn, opts) => { d.processed.push({ turn, opts }); return { ...turn, status: "answered", brain: "ai" }; },
    beat: async () => { d.beats += 1; },
    bridgeOff: async () => { d.offs += 1; },
    loadAgent: async () => ({ code: "FOS-01", status: "shadow" }),
    sweepAgentTasks: async (_db, opts) => { d.swept.push(opts); return { ran: 0 }; },
    sleep: async () => {},
    route: (on) => { d.routed.push(on); },
    stopCalls: () => 0,
    setInterval: (fn, ms) => { d.intervals.push(ms); return { unref() {} }; },
    clearInterval: () => {},
    ...over
  };
  return d;
}

describe("the Mac runner", () => {
  test("routes every model call to Claude Code, beats, answers the queued turn with the AI, works one task, drains and marks the bridge off", async () => {
    const d = deps();
    const runner = makeHelperRunner({ db: {}, env: {}, log: (l) => d.log.push(l), deps: d });
    const r = await runner.run({ once: true });
    assert.deepEqual(d.routed, [true]);
    assert.ok(d.beats >= 1);
    assert.deepEqual(d.intervals, [BEAT_MS]);
    assert.equal(d.processed.length, 1);
    assert.equal(d.processed[0].opts.useAi, true);
    assert.equal(d.swept[0].max, 1, "one Do-task row per look, so chat is never stuck behind tasks");
    assert.equal(d.swept[0].useAi, true);
    assert.equal(r.ran, 1);
    assert.equal(d.offs, 1, "a drained --once run says the bridge is off at once");
    assert.ok(d.log.some((l) => /answered by ai/.test(l)));
  });

  test("a turn that already had its model tries is answered by rules, not tried again", async () => {
    // reclaimStale stamps claimed_at on what it gives up, so it hands each back once.
    let once = [{ ...TURN, attempts: 2 }];
    const d = deps({ claimQueue: [], reclaimStale: async () => { const giveUp = once; once = []; return { requeued: 0, giveUp }; } });
    await makeHelperRunner({ db: {}, env: {}, log: () => {}, deps: d }).run({ once: true });
    assert.deepEqual([d.processed[0].opts.useAi, d.processed[0].opts.fallbackReason], [false, "ai_gave_up"]);
  });

  test("an error while answering puts the turn back in the queue", async () => {
    const d = deps({ processTurn: async () => { throw new Error("socket closed"); } });
    await makeHelperRunner({ db: {}, env: {}, log: () => {}, deps: d }).run({ once: true });
    assert.deepEqual(d.requeued, [TURN.id]);
  });

  test("stop() hands back what it holds, ends the claude children, marks the bridge off", async () => {
    let release;
    const d = deps({ processTurn: () => new Promise((r) => { release = r; }) });
    let stoppedCalls = 0;
    d.stopCalls = () => { stoppedCalls += 1; return 1; };
    const runner = makeHelperRunner({ db: {}, env: {}, log: () => {}, deps: d });
    const running = runner.run({ once: false });
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));
    const out = await runner.stop();
    assert.deepEqual(out.requeued, [TURN.id]);
    assert.equal(stoppedCalls, 1);
    assert.ok(d.offs >= 1);
    release({ ...TURN, status: "answered" });
    await running;
  });

  test("it looks every 3 seconds when nothing waits", () => {
    assert.equal(POLL_MS, 3000);
  });
});
