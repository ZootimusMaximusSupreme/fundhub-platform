import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PULSE_CRON, handle, runCoverageSteps } from "./daily-pulse.mjs";
import { GAP_LANES } from "../pulse/coverage/run-slices.mjs";

test("Inngest cron is 6:00 a.m. Arizona all year", () => {
  assert.equal(PULSE_CRON, "TZ=America/Phoenix 0 6 * * *");
});

test("handle is audit-only — dry-run writes findings and does not send", async () => {
  const sends = [];
  const step = {
    run: async (_name, fn) => fn()
  };
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pulse-wf-"));
  const out = await handle({
    db: null,
    step,
    env: {},
    dryRun: true,
    boardDir: tmp,
    fetchImpl: async (url) => {
      const pathOnly = String(url).replace(/^https?:\/\/[^/]+/, "");
      const pages = {
        "/api/health?strict=1": { status: 200, text: "{}" },
        "/login.html": { status: 200, text: "Sign in password" },
        "/app/client-control-panel.html": { status: 200, text: "Generate Apps Apply door" },
        "/api/read/underwrite": { status: 401, text: "{}" }
      };
      const hit = pages[pathOnly];
      if (hit) return { status: hit.status, text: async () => hit.text };
      if (pathOnly.startsWith("/api/")) return { status: 401, text: async () => "{}" };
      if (pathOnly.endsWith(".html")) return { status: 200, text: async () => "<html>" };
      return { status: 404, text: async () => "" };
    },
    sendSms: async (msg) => {
      sends.push(msg);
      return { status: "sent" };
    },
    sendWhatsApp: async (msg) => {
      sends.push(msg);
      return { status: "sent" };
    }
  });
  assert.equal(out.autoFix, false);
  assert.equal(out.dryRun, true);
  assert.equal(sends.length, 0);
  assert.ok(Array.isArray(out.findings));
  fs.rmSync(tmp, { recursive: true, force: true });
});

test("when the brief is live, the pulse does not text and the morning brief does", async () => {
  const sends = [];
  const briefs = [];
  const step = { run: async (_name, fn) => fn() };
  const db = { query: async () => ({ rows: [] }) };
  await handle({
    db,
    step,
    env: {},
    dryRun: true,
    boardDir: fs.mkdtempSync(path.join(os.tmpdir(), "pulse-brief-")),
    fetchImpl: async () => ({ status: 200, text: async () => "Sign in password Generate Apps Apply door" }),
    sendSms: async (msg) => {
      sends.push(msg);
      return { status: "sent" };
    },
    briefLive: true,
    morningBrief: async (args) => {
      briefs.push(args);
      return { ok: true };
    }
  });
  assert.equal(sends.length, 0);
  assert.equal(briefs.length, 1);
  assert.equal(briefs[0].kind, "morning");
  assert.equal(briefs[0].live, true);
  assert.ok(briefs[0].pulse);
  assert.equal(briefs[0].pulse.sms.reason, "replaced_by_morning_brief");
});

test("coverage runs before the pulse, one step per gap lane, so no step passes Netlify's 26-second cut", async () => {
  const names = [];
  const step = { run: async (name, fn) => { names.push(name); return fn(); } };
  const db = { query: async () => ({ rows: [] }) };
  const seen = [];
  await handle({
    db,
    step,
    env: {},
    dryRun: true,
    boardDir: fs.mkdtempSync(path.join(os.tmpdir(), "pulse-steps-")),
    fetchImpl: async () => ({ status: 200, text: async () => "Sign in password Generate Apps Apply door" }),
    briefLive: true,
    morningBrief: async (args) => { seen.push(args.pulse); return { ok: true }; },
    coverage: async (args) => {
      const rows = await runCoverageSteps({ ...args, lanes: ["gap-auth", "gap-repair"] });
      return rows;
    }
  });
  assert.deepEqual(names.slice(0, 4), ["coverage-org", "coverage-slices", "coverage-gap-auth", "coverage-gap-repair"]);
  assert.equal(names[4], "coverage-workflow-runs");
  assert.equal(names[5], "run-pulse");
  const gapRows = seen[0].checks.filter((c) => String(c.sliceId || "").startsWith("gap-"));
  assert.ok(gapRows.some((c) => c.sliceId === "gap-auth"));
  assert.ok(gapRows.some((c) => c.sliceId === "gap-repair"));
});

test("the real job gives every listed gap lane its own step", async () => {
  const names = [];
  const step = { run: async (name) => { names.push(name); return []; } };
  await runCoverageSteps({ step, db: { query: async () => ({ rows: [] }) }, env: {} });
  assert.equal(names.filter((n) => n.startsWith("coverage-gap-")).length, GAP_LANES.length);
  assert.ok(names.includes("coverage-slices"));
});

test("a lane step that keeps failing is one skip row and the pulse still runs", async () => {
  const names = [];
  const step = {
    run: async (name, fn) => {
      names.push(name);
      if (name === "coverage-gap-auth") throw new Error("Netlify cut the request at 26 s");
      return fn();
    }
  };
  const rows = await runCoverageSteps({
    step,
    db: { query: async () => ({ rows: [] }) },
    env: {},
    lanes: ["gap-auth", "gap-repair"]
  });
  const skip = rows.find((r) => r.id === "gap-auth:step");
  assert.ok(skip, "expected a skip row for the failed lane");
  assert.equal(skip.status, "skip");
  assert.match(skip.detail, /26 s/);
  assert.ok(rows.some((r) => r.sliceId === "gap-repair"), "the next lane still ran");
});

/* Texting hours (src/pulse/quiet-hours.mjs): the fallback texts go to Chris's number, so they are held outside
   6 a.m. to 10 p.m. Arizona time. The 6 a.m. job is inside it; these tests hand in that clock so they pass at
   any hour. */
const SIX_AM_AZ = new Date("2026-10-09T13:00:00Z");

test("when the morning brief cannot be built, the plain pulse text still goes out, once", async () => {
  const sends = [];
  const step = { run: async (_name, fn) => fn() };
  const db = { query: async () => ({ rows: [] }) };
  await handle({
    db,
    step,
    env: { PULSE_SMS_TO: "+16025551234" },
    dryRun: false,
    boardDir: fs.mkdtempSync(path.join(os.tmpdir(), "pulse-brieffail-")),
    fetchImpl: async () => ({ status: 200, text: async () => "Sign in password Generate Apps Apply door" }),
    sendSms: async (msg) => { sends.push(msg); return { status: "sent", providerMessageId: "SM1" }; },
    briefLive: true,
    coverage: async () => [],
    morningBrief: async () => { throw new Error("database went away"); },
    now: SIX_AM_AZ
  });
  assert.equal(sends.length, 1, "exactly one fallback text");
  assert.match(sends[0].body, /Fundhub morning check/);
  assert.match(sends[0].body, /could not be built: database went away/);
});

test("a brief that builds and texts gets no second text", async () => {
  const sends = [];
  const step = { run: async (_name, fn) => fn() };
  await handle({
    db: { query: async () => ({ rows: [] }) },
    step,
    env: { PULSE_SMS_TO: "+16025551234" },
    dryRun: false,
    boardDir: fs.mkdtempSync(path.join(os.tmpdir(), "pulse-briefok-")),
    fetchImpl: async () => ({ status: 200, text: async () => "Sign in password Generate Apps Apply door" }),
    sendSms: async (msg) => { sends.push(msg); return { status: "sent" }; },
    briefLive: true,
    coverage: async () => [],
    morningBrief: async () => ({ ok: true, delivery: { delivery_status: "sent" } })
  });
  assert.equal(sends.length, 0);
});

test("when the pulse step itself dies, one text says so and the run still fails", async () => {
  const sends = [];
  const step = {
    run: async (name, fn) => {
      if (name === "run-pulse") throw new Error("Netlify cut the request at 26 s");
      return fn();
    }
  };
  await assert.rejects(handle({
    db: { query: async () => ({ rows: [] }) },
    step,
    env: { PULSE_SMS_TO: "+16025551234" },
    dryRun: false,
    sendSms: async (msg) => { sends.push(msg); return { status: "sent" }; },
    briefLive: true,
    coverage: async () => [],
    now: SIX_AM_AZ
  }), /26 s/);
  assert.equal(sends.length, 1);
  assert.match(sends[0].body, /did not finish: Netlify cut the request at 26 s/);
});

test("texting hours: a fallback text that would land at 2:07 a.m. Arizona is held, not sent", async () => {
  const sends = [];
  const step = {
    run: async (name, fn) => {
      if (name === "run-pulse") throw new Error("Netlify cut the request at 26 s");
      return fn();
    }
  };
  await assert.rejects(handle({
    db: { query: async () => ({ rows: [] }) },
    step,
    env: { PULSE_SMS_TO: "+16025551234" },
    dryRun: false,
    sendSms: async (msg) => { sends.push(msg); return { status: "sent" }; },
    briefLive: true,
    coverage: async () => [],
    now: new Date("2026-10-10T09:07:00Z")
  }), /26 s/, "the run still fails, so its heartbeat still goes red");
  assert.equal(sends.length, 0, "no text at night");
});
