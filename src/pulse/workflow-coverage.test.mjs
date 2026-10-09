// Workflow coverage guard — zero "not checked", Ship 1 (2026-10-09).
//
// The heartbeat can only watch what it can see. This test fails the build when a
// bundled Inngest function would slip past it:
//
//   1. it was made on some other Inngest client (it would skip the shared
//      heartbeat add-on in src/workflows/client.mjs);
//   2. it listens for an event name that is not in src/events/canonical.mjs
//      (the bus would refuse to emit that name, so the workflow never wakes),
//      unless the name is on EVENT_NAME_ALLOW_LIST below with a written reason;
//   3. it has no trigger, or is switched off, and is not on NOT_LIVE_WORKFLOWS
//      (src/pulse/workflow-runs.mjs), so a workflow cannot go dark by accident;
//   4. it is a cron and is not on INNGEST_JOBS (src/pulse/heartbeats.mjs), so it
//      would have no job: row.
//
// It also fails when the allow-lists go stale (an entry nothing uses any more).
// The rules are plain functions over a list, so each one is shown to fail on a
// made-up bundle and to pass on today's real one.

import { test } from "node:test";
import assert from "node:assert/strict";
import { functions } from "../workflows/index.mjs";
import { inngest } from "../workflows/client.mjs";
import { CANONICAL_EVENTS } from "../events/canonical.mjs";
import { INNGEST_JOBS } from "./heartbeats.mjs";
import { NOT_LIVE_WORKFLOWS, workflowTriggers } from "./workflow-runs.mjs";

/* Event names a workflow may listen for although the bus does not know them.
   Empty today: all 22 trigger names in the bundle are canonical. A new entry
   needs a reason of 40+ characters. */
const EVENT_NAME_ALLOW_LIST = Object.freeze({});

function findGaps({
  fns,
  client = inngest,
  canonical = new Set(CANONICAL_EVENTS),
  allow = EVENT_NAME_ALLOW_LIST,
  notLive = NOT_LIVE_WORKFLOWS,
  jobs = new Set(INNGEST_JOBS.map(([job]) => job))
}) {
  const gaps = [];
  const seen = new Map();
  const usedAllow = new Set();
  for (const fn of fns) {
    const t = workflowTriggers(fn);
    const id = t.id || "(no id)";
    seen.set(id, t);
    if (fn.client !== client) {
      gaps.push(`${id}: not built on the shared Inngest client, so the heartbeat add-on never sees it`);
    }
    for (const name of t.events) {
      if (canonical.has(name)) continue;
      if (Object.prototype.hasOwnProperty.call(allow, name)) {
        usedAllow.add(name);
        continue;
      }
      gaps.push(`${id}: listens for "${name}", which is not in src/events/canonical.mjs and not on the allow-list`);
    }
    const dark = !t.enabled || !t.hasTrigger;
    if (dark && !Object.prototype.hasOwnProperty.call(notLive, id)) {
      gaps.push(`${id}: has no trigger or is switched off, but is not on NOT_LIVE_WORKFLOWS`);
    }
    if (t.crons.length > 0 && !jobs.has(id)) {
      gaps.push(`${id}: is a cron but is not on INNGEST_JOBS, so it has no job: row`);
    }
  }
  for (const id of Object.keys(notLive)) {
    const t = seen.get(id);
    if (!t) gaps.push(`${id}: is on NOT_LIVE_WORKFLOWS but is not in the bundle any more (remove it)`);
    else if (t.enabled && t.hasTrigger) gaps.push(`${id}: is on NOT_LIVE_WORKFLOWS but has a live trigger (remove it)`);
  }
  for (const name of Object.keys(allow)) {
    if (canonical.has(name)) gaps.push(`"${name}": is on the allow-list but is canonical now (remove it)`);
    else if (!usedAllow.has(name)) gaps.push(`"${name}": is on the allow-list but no workflow listens for it (remove it)`);
  }
  return gaps;
}

/* ---- today's real bundle ---- */

test("workflow coverage: today's bundle has no gap", () => {
  assert.ok(functions.length >= 100, "the bundle loaded");
  assert.deepEqual(findGaps({ fns: functions }), []);
});

test("workflow coverage: every function is on the shared Inngest client", () => {
  const strays = functions.filter((fn) => fn.client !== inngest).map((fn) => workflowTriggers(fn).id);
  assert.deepEqual(strays, []);
});

test("workflow coverage: every event trigger in the bundle is a canonical event", () => {
  const canonical = new Set(CANONICAL_EVENTS);
  const bad = [];
  for (const fn of functions) {
    for (const name of workflowTriggers(fn).events) if (!canonical.has(name)) bad.push(`${workflowTriggers(fn).id}: ${name}`);
  }
  assert.deepEqual(bad, []);
});

test("workflow coverage: every dark function in the bundle is on NOT_LIVE_WORKFLOWS, and nothing else is", () => {
  const dark = functions.map(workflowTriggers).filter((t) => !t.enabled || !t.hasTrigger).map((t) => t.id).sort();
  assert.deepEqual(dark, Object.keys(NOT_LIVE_WORKFLOWS).sort());
});

test("workflow coverage: every cron function is on INNGEST_JOBS, and nothing on it is missing from the bundle", () => {
  const crons = functions.map(workflowTriggers).filter((t) => t.crons.length > 0).map((t) => t.id).sort();
  assert.deepEqual(crons, INNGEST_JOBS.map(([job]) => job).sort());
});

test("workflow coverage: the allow-list reasons are 40+ characters", () => {
  for (const [name, why] of Object.entries(EVENT_NAME_ALLOW_LIST)) assert.ok(String(why).length >= 40, name);
});

/* ---- each rule fails for the right reason on a made-up bundle ---- */

const wf = (id, extra = {}) => ({ client: inngest, opts: { id, triggers: [{ event: "round.started" }], ...extra } });

/* A made-up bundle is judged with empty allow-lists unless the test says otherwise. */
const madeUp = (args) => findGaps({ notLive: {}, ...args });

test("rule 1 fails: a function on another client", () => {
  const stray = { ...wf("rogue"), client: { id: "other" } };
  const gaps = madeUp({ fns: [wf("fine"), stray] });
  assert.equal(gaps.length, 1);
  assert.match(gaps[0], /^rogue: not built on the shared Inngest client/);
});

test("rule 2 fails: an event name the bus does not know; passes when it is on the allow-list with a reason", () => {
  const odd = wf("odd", { triggers: [{ event: "made.up" }] });
  const gaps = madeUp({ fns: [odd] });
  assert.equal(gaps.length, 1);
  assert.match(gaps[0], /^odd: listens for "made\.up", which is not in src\/events\/canonical\.mjs/);
  const allowed = madeUp({ fns: [odd], allow: { "made.up": "Emitted by a Netlify function that passes allowNonCanonical on purpose." } });
  assert.deepEqual(allowed, []);
});

test("rule 3 fails: a dark function that is not on NOT_LIVE_WORKFLOWS; passes when it is", () => {
  const noTrigger = wf("quiet", { triggers: [] });
  const disabled = wf("sleeping", { enabled: false });
  const gaps = madeUp({ fns: [noTrigger, disabled] });
  assert.equal(gaps.length, 2);
  assert.match(gaps[0], /^quiet: has no trigger or is switched off, but is not on NOT_LIVE_WORKFLOWS/);
  assert.match(gaps[1], /^sleeping: has no trigger or is switched off/);
  const listed = madeUp({ fns: [noTrigger, disabled], notLive: { quiet: "x".repeat(40), sleeping: "y".repeat(40) } });
  assert.deepEqual(listed, []);
});

test("rule 4 fails: a cron that is not on INNGEST_JOBS; passes when it is", () => {
  const clock = { client: inngest, opts: { id: "new-sweeper", triggers: [{ cron: "*/5 * * * *" }] } };
  const gaps = madeUp({ fns: [clock] });
  assert.equal(gaps.length, 1);
  assert.match(gaps[0], /^new-sweeper: is a cron but is not on INNGEST_JOBS/);
  assert.deepEqual(madeUp({ fns: [clock], jobs: new Set(["new-sweeper"]) }), []);
});

test("stale allow-lists fail: a NOT_LIVE entry that is live or gone, an event allow entry nothing uses or that is canonical now", () => {
  const live = wf("back-on");
  const g1 = madeUp({ fns: [live], notLive: { "back-on": "z".repeat(40) } });
  assert.deepEqual(g1.map((g) => g.replace(/:.*/, "")), ["back-on"]);
  assert.match(g1[0], /has a live trigger \(remove it\)/);
  const g2 = madeUp({ fns: [wf("here")], notLive: { gone: "z".repeat(40) } });
  assert.match(g2[0], /^gone: is on NOT_LIVE_WORKFLOWS but is not in the bundle any more/);
  const g3 = madeUp({ fns: [wf("here")], allow: { "unused.name": "z".repeat(40) } });
  assert.match(g3[0], /no workflow listens for it/);
  const g4 = madeUp({ fns: [wf("here")], allow: { "round.started": "z".repeat(40) } });
  assert.match(g4[0], /is canonical now/);
});
