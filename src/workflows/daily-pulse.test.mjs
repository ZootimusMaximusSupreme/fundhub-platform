import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PULSE_CRON, handle } from "./daily-pulse.mjs";

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
