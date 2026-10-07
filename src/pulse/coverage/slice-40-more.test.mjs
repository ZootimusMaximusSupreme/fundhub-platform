import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { coverageKey, PULSE_REGISTRY } from "../registry.mjs";
import { MACHINE_CHECKS } from "../machine.mjs";
import { INNGEST_JOBS, NETLIFY_JOBS } from "../heartbeats.mjs";
import { functions } from "../../workflows/index.mjs";
import { SLO_PULL_PATH } from "../../slo/offer.mjs";
import { CHECKS, SLICE_ID, gaps } from "./slice-40-more.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../../..");

const EXPECTED_IDS = [
  "at-01-first-touch-capture",
  "dpc-02-call-outcome-enforcement",
  "dpc-03-inbound-reply-router",
  "dpc-05-no-progress-escalation",
  "round-started-client-notify",
  "slo-genuine-checkout-sms",
  "slo-genuine-reply",
  "sys-01-client-value-calculator",
  "sys-01-ltv-calculator",
  "u-02-analyzer-complete-delivery",
  "consulting/index.html",
  "consulting/privacy/index.html",
  "consulting/refund/index.html",
  "consulting/terms/index.html",
  "optimize.html",
  "roadmap/pull.html"
];

const EVENT_FILES = {
  "at-01-first-touch-capture": "at-01-first-touch-capture.mjs",
  "dpc-02-call-outcome-enforcement": "dpc-02-call-outcome-enforcement.mjs",
  "dpc-03-inbound-reply-router": "dpc-03-inbound-reply-router.mjs",
  "dpc-05-no-progress-escalation": "dpc-05-no-progress-escalation.mjs",
  "round-started-client-notify": "round-started-client-notify.mjs",
  "slo-genuine-checkout-sms": "slo-genuine-followup.mjs",
  "slo-genuine-reply": "slo-genuine-followup.mjs",
  "sys-01-client-value-calculator": "sys-01-client-value-calculator.mjs",
  "sys-01-ltv-calculator": "sys-01-ltv-calculator.mjs",
  "u-02-analyzer-complete-delivery": "u-02-analyzer-complete-delivery.mjs"
};

const DOOR_FILES = {
  "consulting/index.html": "public/consulting/index.html",
  "consulting/privacy/index.html": "public/consulting/privacy/index.html",
  "consulting/refund/index.html": "public/consulting/refund/index.html",
  "consulting/terms/index.html": "public/consulting/terms/index.html",
  "optimize.html": "public/optimize.html",
  "roadmap/pull.html": "public/roadmap/pull.html"
};

test("slice 40-more: slice id and leftover ids", () => {
  assert.equal(SLICE_ID, "40-more");
  assert.deepEqual(CHECKS.map((row) => row.id), EXPECTED_IDS);
  assert.ok(CHECKS.length > 0);
});

test("slice 40-more: every check has id, schedule, redAfter, alreadyInRegistry false, proof", () => {
  for (const row of CHECKS) {
    assert.equal(typeof row.id, "string");
    assert.ok(row.id.length > 0);
    assert.equal(typeof row.schedule, "string");
    assert.ok(row.schedule.length > 0);
    assert.equal(row.redAfter, `3x ${row.schedule}`);
    assert.equal(row.alreadyInRegistry, false);
    assert.equal(typeof row.proof, "string");
    assert.match(row.proof, /morning pulse does not ping it/);
    assert.match(row.proof, /Never text/);
  }
  assert.deepEqual(gaps(), CHECKS);
});

test("slice 40-more: not in the registry, machine list, or heartbeat clocks", () => {
  const listed = new Set(PULSE_REGISTRY.map((row) => coverageKey(row)));
  const machineIds = new Set(MACHINE_CHECKS.map((row) => row.id));
  const clocks = new Set([
    ...INNGEST_JOBS.map(([job]) => job),
    ...NETLIFY_JOBS.map(([job]) => job)
  ]);
  for (const row of CHECKS) {
    assert.equal(listed.has(row.id), false, row.id);
    assert.equal(machineIds.has(row.id), false, row.id);
    assert.equal(clocks.has(row.id), false, row.id);
  }
});

test("slice 40-more: event jobs are registered and the schedule is a real trigger", () => {
  const byId = new Map(functions.map((fn) => [fn.id(), fn]));
  for (const id of Object.keys(EVENT_FILES)) {
    const row = CHECKS.find((item) => item.id === id);
    const fn = byId.get(id);
    assert.ok(fn, `${id} is not in src/workflows/index.mjs`);
    const events = (fn.opts?.triggers || []).map((trigger) => trigger.event).filter(Boolean);
    assert.ok(events.includes(row.schedule), `${id} schedule ${row.schedule}`);
    const src = fs.readFileSync(
      path.join(ROOT, "src/workflows", EVENT_FILES[id]),
      "utf8"
    );
    assert.match(src, new RegExp(`id:\\s*"${id}"`));
  }
  const showed = byId.get("dpc-02-call-outcome-enforcement");
  const dpcEvents = (showed.opts?.triggers || []).map((trigger) => trigger.event);
  assert.ok(dpcEvents.includes("booking.rescheduled"));
});

test("slice 40-more: doors are real pages named by a journey", () => {
  assert.equal(SLO_PULL_PATH, "/roadmap/pull.html");
  for (const [id, rel] of Object.entries(DOOR_FILES)) {
    assert.ok(fs.existsSync(path.join(ROOT, rel)), rel);
    assert.equal(CHECKS.find((row) => row.id === id).schedule, "daily");
  }
  const slo = fs.readFileSync(path.join(ROOT, "docs/journeys/slo-offer-intended.md"), "utf8");
  const consulting = fs.readFileSync(path.join(ROOT, "docs/journeys/fh-consulting-intended.md"), "utf8");
  const optimize = fs.readFileSync(path.join(ROOT, "docs/journeys/optimize-intended.md"), "utf8");
  assert.match(slo, /\/slo\/pull\.html/);
  assert.match(consulting, /\/consulting\//);
  assert.match(optimize, /fundhub\.ai\/optimize/);
});

test("slice 40-more: no other slice already lists these ids, and this file never sends", async () => {
  const sliceSrc = fs.readFileSync(path.join(HERE, "slice-40-more.mjs"), "utf8");
  assert.doesNotMatch(sliceSrc, /placeCall|sendTemplated|twilio|createFunction/);

  const files = fs.readdirSync(HERE).filter((name) =>
    /^slice-.*\.mjs$/.test(name) && !name.endsWith(".test.mjs") && name !== "slice-40-more.mjs"
  );
  const ours = new Set(CHECKS.map((row) => row.id));
  for (const name of files) {
    const mod = await import(pathToFileURL(path.join(HERE, name)).href);
    for (const row of mod.CHECKS || []) {
      assert.equal(ours.has(row.id), false, `${row.id} already in ${name}`);
    }
  }
});
