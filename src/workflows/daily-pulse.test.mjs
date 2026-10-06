import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PULSE_CRON, handle } from "./daily-pulse.mjs";

test("Inngest cron is 7:00 a.m. on Denver's own clock, so the fall-back needs no flip", () => {
  assert.equal(PULSE_CRON, "TZ=America/Denver 0 7 * * *");
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
