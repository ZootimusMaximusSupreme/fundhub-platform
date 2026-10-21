// src/pulse/beats/shifts.mjs: every beat runs in exactly one hourly shift.
//
// A beat in no shift would ship and never run; a beat in two would run (and could text) twice an hour; a shift that
// names a beat that is not on the list would run nothing at all (runPulse refuses an unknown id). Each of these
// fails here, and again in `npm run pulse:prove -- --beats` from the built bundle.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { SHIFTS, SHIFT_JOBS, PENDING_SHIFT_BEATS, shiftBeats, shiftProblems } from "./shifts.mjs";
import { BEAT_FILES, loadBeats } from "./index.mjs";
import { NETLIFY_JOBS, cronIntervalMs } from "../heartbeats.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../../..");

test("every beat on BEAT_FILES is in exactly one shift, and every shift names only listed beats", async () => {
  const beats = await loadBeats();
  assert.equal(beats.length, BEAT_FILES.length);
  const ids = beats.map((b) => b.id);
  assert.deepEqual(shiftProblems(ids), [], "fix src/pulse/beats/shifts.mjs: every beat in exactly one shift");
  const assigned = SHIFT_JOBS.flatMap((job) => [...SHIFTS[job].beats]);
  assert.deepEqual([...assigned].sort(), [...ids].sort(), "the shifts together hold exactly the beat list");
});

test("a beat with no shift fails (a new beat must be given a shift before it can ship)", () => {
  const ids = [...SHIFT_JOBS.flatMap((job) => [...SHIFTS[job].beats]), "brand-new-beat"];
  const problems = shiftProblems(ids);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /beat "brand-new-beat" is in no shift, so it would never run/);
});

test("a beat in two shifts fails, and so does a beat listed twice in one shift", () => {
  const shifts = {
    one: { beats: ["a", "b"] },
    two: { beats: ["b", "c", "c"] }
  };
  const problems = shiftProblems(["a", "b", "c"], shifts);
  assert.ok(problems.some((p) => /beat "b" is in 2 shifts \(one, two\), so it would run twice an hour/.test(p)), problems.join("\n"));
  assert.ok(problems.some((p) => /beat "c" is listed twice in shift two/.test(p)), problems.join("\n"));
});

test("a shift that names a beat not on the list fails, and so does an empty shift", () => {
  const problems = shiftProblems(["a"], { one: { beats: ["a", "gone"] }, two: { beats: [] } });
  assert.ok(problems.some((p) => /shift one names beat "gone", which is not on BEAT_FILES/.test(p)), problems.join("\n"));
  assert.ok(problems.some((p) => /shift two runs no beat/.test(p)), problems.join("\n"));
});

test("the shift list is frozen, and shiftBeats refuses a job with no shift", () => {
  assert.ok(Object.isFrozen(SHIFTS));
  for (const job of SHIFT_JOBS) {
    assert.ok(Object.isFrozen(SHIFTS[job]));
    assert.ok(Object.isFrozen(SHIFTS[job].beats));
    assert.equal(shiftBeats(job), SHIFTS[job].beats);
  }
  assert.throws(() => shiftBeats("pulse-hourly-d"), /no hourly shift is named "pulse-hourly-d"/);
  assert.throws(() => shiftBeats("toString"), /no hourly shift/);
});

test("three shifts: pulse-hourly at minute 7, pulse-hourly-b at 37, pulse-hourly-c at 52, each hourly, on its own minute", () => {
  assert.deepEqual([...SHIFT_JOBS], ["pulse-hourly", "pulse-hourly-b", "pulse-hourly-c"]);
  assert.equal(SHIFTS["pulse-hourly"].cron, "7 * * * *");
  assert.equal(SHIFTS["pulse-hourly-b"].cron, "37 * * * *");
  assert.equal(SHIFTS["pulse-hourly-c"].cron, "52 * * * *");
  const minutes = SHIFT_JOBS.map((job) => Number(SHIFTS[job].cron.split(" ")[0]));
  assert.equal(new Set(minutes).size, minutes.length, "no two shifts start on the same minute");
  assert.deepEqual([...minutes].sort((a, b) => a - b), minutes, "SHIFT_JOBS is in schedule order");
  for (const job of SHIFT_JOBS) {
    const { cron } = SHIFTS[job];
    assert.equal(cronIntervalMs(cron), 3600 * 1000, `${job} runs once an hour, so every beat still runs once an hour`);
    const minute = Number(cron.split(" ")[0]);
    assert.notEqual(minute, 0, `${job}: three Inngest jobs already fire at minute 0`);
    assert.notEqual(minute % 5, 0, `${job}: never on the same minute as the 5-minute jobs`);
  }
});

test("each shift is a scheduled function on the same cron, with its heartbeat, and runs exactly its own shift", async () => {
  const toml = readFileSync(path.join(ROOT, "netlify.toml"), "utf8");
  const netlify = new Map(NETLIFY_JOBS);
  for (const job of SHIFT_JOBS) {
    const { cron, beats } = SHIFTS[job];
    const m = new RegExp(`\\[functions\\."${job}"\\]\\s*\\n\\s*schedule\\s*=\\s*"([^"]+)"`).exec(toml);
    assert.ok(m, `netlify.toml has no schedule directly under [functions."${job}"]`);
    assert.equal(m[1], cron, `${job}: netlify.toml and shifts.mjs agree`);
    assert.equal(netlify.get(job), cron, `${job} is in NETLIFY_JOBS on its shift's cron (its heartbeat goes red after 3 hours)`);
    const file = path.join(ROOT, "netlify/functions", `${job}.mjs`);
    const src = readFileSync(file, "utf8");
    assert.match(src, /runPulse\(\{ env: process\.env, only: \[\.\.\.BEATS\] \}\)/, `${job} runs only its own shift`);
    assert.ok(src.includes(`shiftBeats("${job}")`), `${job} takes its BEATS from its own shift`);
    const mod = await import(pathToFileURL(file).href);
    assert.equal(mod.SWEEP_CRON, cron);
    assert.deepEqual([...mod.BEATS], [...beats]);
  }
});

test("beats that break from one cause, or guard the same door, share a shift (one cause, one text)", () => {
  // A beat whose file has not landed counts by the shift it waits for on PENDING_SHIFT_BEATS.
  const shiftOf = (id) => SHIFT_JOBS.find((job) => SHIFTS[job].beats.includes(id)) ?? PENDING_SHIFT_BEATS[id];
  for (const group of [
    ["text-path", "email-path", "vendor-keys", "message-health"],
    ["apply-links", "bank-links", "bank-outreach"],
    ["lead-pipe", "lead-handoff", "call-bookings"],
    ["money-checkout", "checkout-doors", "pay-links", "pay-webhook"],
    ["money-funding", "funding-trip", "partner-trip", "partner-pages", "apply-links"],
    ["soft-pull", "roadmap-delivery", "roadmap-pages"],
    ["auth-links", "client-portal"],
    ["pipeline-boards", "pipeline-facts"],
    ["repair-trip", "inquiry-trip"]
  ]) {
    const homes = new Set(group.map(shiftOf));
    assert.ok(!homes.has(undefined), `${group.join(", ")}: every one is in a shift or on the pending list`);
    assert.equal(homes.size, 1, `${group.join(", ")} are split across shifts: ${[...homes].join(", ")}`);
  }
});

test("the pending list names only beats that have not landed, each waiting for a real shift", async () => {
  const ids = new Set((await loadBeats()).map((b) => b.id));
  assert.ok(Object.isFrozen(PENDING_SHIFT_BEATS));
  for (const [id, job] of Object.entries(PENDING_SHIFT_BEATS)) {
    assert.ok(SHIFT_JOBS.includes(job), `${id} waits for ${job}, which is not a shift`);
    assert.ok(!ids.has(id), `${id} has landed on BEAT_FILES: move it from PENDING_SHIFT_BEATS into shift ${job}`);
    assert.ok(!SHIFT_JOBS.some((shift) => SHIFTS[shift].beats.includes(id)), `${id} is in a shift and still pending`);
  }
});

test("a pending beat that lands with no shift fails, and the message names the shift it waits for", () => {
  const ids = [...SHIFT_JOBS.flatMap((job) => [...SHIFTS[job].beats]), "landed-beat"];
  const problems = shiftProblems(ids, SHIFTS, { "landed-beat": "pulse-hourly-c" });
  assert.equal(problems.length, 1, problems.join("\n"));
  assert.match(problems[0], /beat "landed-beat" has landed but is still pending, so it would never run: move it from PENDING_SHIFT_BEATS into shift pulse-hourly-c/);
});

test("a beat in a shift that is also still pending fails, and so does a pending beat waiting for a shift that is not there", () => {
  const shifts = { one: { beats: ["a", "b"] } };
  const both = shiftProblems(["a", "b"], shifts, { b: "one" });
  assert.ok(both.some((p) => /beat "b" is in shift one and still on PENDING_SHIFT_BEATS/.test(p)), both.join("\n"));
  const nowhere = shiftProblems(["a", "b"], shifts, { c: "two" });
  assert.ok(nowhere.some((p) => /pending beat "c" waits for shift two, which does not exist/.test(p)), nowhere.join("\n"));
});
