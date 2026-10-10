// netlify/functions/pulse-hourly.mjs: the shell around the runner.
// The schedule agrees with netlify.toml, the file is default-export-only, it writes its heartbeat, it does NOTHING
// without a database and a site address, and a late rejection cannot end the process.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { JOBS, NETLIFY_JOBS, cronIntervalMs } from "./heartbeats.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const FILE = path.join(ROOT, "netlify/functions/pulse-hourly.mjs");
const src = readFileSync(FILE, "utf8");

describe("the schedule", () => {
  test("SWEEP_CRON equals netlify.toml, and the schedule sits on the very next line under [functions.\"pulse-hourly\"]", async () => {
    const mod = await import(pathToFileURL(FILE).href);
    assert.equal(mod.SWEEP_CRON, "7 * * * *");
    const toml = readFileSync(path.join(ROOT, "netlify.toml"), "utf8");
    const m = /\[functions\."pulse-hourly"\]\s*\n\s*schedule\s*=\s*"([^"]+)"/.exec(toml);
    assert.ok(m, 'netlify.toml has no schedule directly under [functions."pulse-hourly"]');
    assert.equal(m[1], mod.SWEEP_CRON);
  });

  test("it is hourly, and not at minute 0 (three Inngest jobs already fire there)", () => {
    const row = NETLIFY_JOBS.find(([name]) => name === "pulse-hourly");
    assert.ok(row, "pulse-hourly is in NETLIFY_JOBS");
    assert.equal(row[1], "7 * * * *");
    assert.equal(cronIntervalMs(row[1]), 3600 * 1000);
    assert.ok(JOBS.some((j) => j.job === "pulse-hourly" && j.runner === "netlify"));
    assert.doesNotMatch(row[1], /^0 /);
  });

  test("the morning pulse calls the job red after 3 hours of silence (STALE_MULTIPLE x the schedule)", () => {
    assert.equal(3 * cronIntervalMs("7 * * * *"), 3 * 3600 * 1000);
  });
});

describe("the file", () => {
  test("default export only: no named handler (the 4 KB env trap)", async () => {
    assert.doesNotMatch(src, /export\s+(const|let|var|async\s+function|function)\s+handler\b/);
    assert.doesNotMatch(src, /export\s*\{[^}]*\bhandler\b[^}]*\}/);
    assert.match(src, /export default async function/);
    const mod = await import(pathToFileURL(FILE).href);
    assert.equal(typeof mod.default, "function");
    assert.equal(mod.handler, undefined);
  });

  test("it writes its heartbeat under the exact name the heartbeat test looks for", () => {
    assert.ok(src.includes('noteScheduledRun(db, "pulse-hourly"'));
  });

  test("it registers the unhandledRejection guard, and names no credentials/ path", () => {
    assert.ok(src.includes('process.on("unhandledRejection"'));
    const code = src.split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");
    assert.doesNotMatch(code, /credentials\//);
  });

  test("it reaches no sender and no beat directly: the runner is the only door", () => {
    const code = src.split("\n").filter((l) => !/^\s*\/\//.test(l)).join("\n");
    const imports = [...code.matchAll(/^import .*? from "([^"]+)";?$/gm)].map((m) => m[1]);
    assert.deepEqual(imports.sort(), [
      "../../src/db.mjs",
      "../../src/lib/outbound-fetch.mjs",
      "../../src/pulse/heartbeats.mjs",
      "../../src/pulse/runner.mjs"
    ]);
  });
});

describe("the receipt is capped (checker finding: a hung database must not hold the function past 30 s)", () => {
  test("a receipt that never comes back is left behind after about 2 s, and the function goes on", async () => {
    const { saveReceipt, RECEIPT_MAX_MS } = await import(pathToFileURL(FILE).href);
    assert.equal(RECEIPT_MAX_MS, 2000);
    const t0 = Date.now();
    const r = await saveReceipt(() => new Promise(() => {}), Date.now());
    const took = Date.now() - t0;
    assert.equal(r.timedOut, true);
    assert.equal(r.saved, false);
    assert.ok(took >= 1800 && took < 2600, `took ${took} ms`);
  });

  test("late in the run it gets only what is left to the 27 s line, and never less than 300 ms", async () => {
    const { saveReceipt } = await import(pathToFileURL(FILE).href);
    const t0 = Date.now();
    const r = await saveReceipt(() => new Promise(() => {}), Date.now() - 26_500); // 26.5 s used: 500 ms left
    const took = Date.now() - t0;
    assert.equal(r.timedOut, true);
    assert.ok(took >= 400 && took < 900, `took ${took} ms`);
    const t1 = Date.now();
    await saveReceipt(() => new Promise(() => {}), Date.now() - 29_000); // already past: the floor is 300 ms
    const floor = Date.now() - t1;
    assert.ok(floor >= 250 && floor < 700, `took ${floor} ms`);
  });

  test("a receipt that comes back is saved at once; one that throws is not saved and does not throw", async () => {
    const { saveReceipt } = await import(pathToFileURL(FILE).href);
    const ok = await saveReceipt(async () => ({ ok: true }), Date.now());
    assert.equal(ok.saved, true);
    assert.equal(ok.timedOut, false);
    assert.ok(ok.ms < 200);
    const bad = await saveReceipt(async () => { throw new Error("db gone"); }, Date.now());
    assert.equal(bad.saved, false);
    assert.equal(bad.timedOut, false);
    const sync = await saveReceipt(() => { throw new Error("sync"); }, Date.now());
    assert.equal(sync.saved, false);
  });

  test("the function writes its receipt THROUGH the cap, not around it", () => {
    assert.match(src, /saveReceipt\(\(\) => noteScheduledRun\(db, "pulse-hourly", result\), startedAt\)/);
    const code = src.split("\n").filter((l) => !/^\s*\/\//.test(l)).join("\n");
    const calls = code.match(/noteScheduledRun\(/g) || [];
    assert.equal(calls.length, 1, "the only call sits inside saveReceipt's argument");
  });
});

/* ---- child processes: a clean environment, so nothing real is reachable ---- */

function child(script, env = {}) {
  const base = { PATH: process.env.PATH, HOME: process.env.HOME, NODE_ENV: "test" };
  return spawnSync(process.execPath, ["--input-type=module", "-e", script], {
    cwd: ROOT, env: { ...base, ...env }, encoding: "utf8", timeout: 60000
  });
}

const callIt = `
  const net = await import("node:net");
  const sockets = [];
  const connect = net.Socket.prototype.connect;
  net.Socket.prototype.connect = function (...a) { sockets.push(String(a[0] && a[0].port || a[0])); return connect.apply(this, a); };
  const fetches = [];
  globalThis.fetch = async (u) => { fetches.push(String(u)); throw new Error("no network in this test"); };
  const mod = await import(${JSON.stringify(pathToFileURL(FILE).href)});
  const res = await mod.default(new Request("https://fundhub.ai/.netlify/functions/pulse-hourly", { method: "POST", body: "{}" }));
  process.stdout.write("RESULT " + JSON.stringify({ status: res.status, body: await res.json(), fetches, sockets }) + "\\n");
  process.exit(0);
`;
const resultOf = (run) => {
  const line = (run.stdout || "").split("\n").find((l) => l.startsWith("RESULT "));
  assert.ok(line, `child did not report. exit=${run.status}\n${(run.stderr || "").slice(-1500)}`);
  return JSON.parse(line.slice(7));
};

describe("with nothing configured it does NOTHING", () => {
  test("no DATABASE_URL and no URL: a 200, ok:false, no beat, no network call, no socket, no database", () => {
    const run = child(callIt);
    const r = resultOf(run);
    assert.equal(r.status, 200);
    assert.equal(r.body.ok, false);
    assert.equal(r.body.ran, 0);
    assert.match(r.body.error, /missing env: DATABASE_URL, URL/);
    assert.deepEqual(r.fetches, []);
    assert.deepEqual(r.sockets, []);
    assert.doesNotMatch(run.stdout, /db: connecting/, "the pool was never built");
  });

  test("a database address but no site address: still nothing", () => {
    const run = child(callIt, { DATABASE_URL: "postgres://u:p@127.0.0.1:1/none" });
    const r = resultOf(run);
    assert.equal(r.status, 200);
    assert.match(r.body.error, /missing env: URL/);
    assert.deepEqual(r.fetches, []);
    assert.deepEqual(r.sockets, []);
    assert.doesNotMatch(run.stdout, /db: connecting/, "no connection was even attempted");
  });

  test("the answer is a small public summary: counts and an error, never a beat or a detail", () => {
    const r = resultOf(child(callIt));
    assert.deepEqual(Object.keys(r.body).sort(), ["error", "failed", "ms", "ok", "ran", "timedOut"]);
  });
});

describe("a late rejection cannot kill the run (critic issue 2)", () => {
  test("a promise nobody caught is logged (redacted) and the process carries on", () => {
    const script = `
      await import(${JSON.stringify(pathToFileURL(FILE).href)});
      Promise.reject(new Error("late from a cut beat token=abcdef0123456789secret"));
      await new Promise((r) => setTimeout(r, 150));
      process.stdout.write("STILL ALIVE\\n");
      process.exit(0);
    `;
    const run = child(script);
    assert.equal(run.status, 0, `the process died: ${(run.stderr || "").slice(-600)}`);
    assert.match(run.stdout, /STILL ALIVE/);
    assert.match(run.stderr, /\[pulse-hourly\] late rejection ignored: late from a cut beat/);
    assert.doesNotMatch(run.stderr, /abcdef0123456789secret/, "the secret-shaped value is redacted");
  });

  test("WITHOUT the guard the same script would die on Node 22 (so the test above proves something)", () => {
    const script = `
      Promise.reject(new Error("late"));
      await new Promise((r) => setTimeout(r, 150));
      process.stdout.write("STILL ALIVE\\n");
    `;
    const run = child(script);
    assert.notEqual(run.status, 0);
    assert.doesNotMatch(run.stdout, /STILL ALIVE/);
  });

  test("onLateRejection never throws, whatever it is handed", async () => {
    const { onLateRejection } = await import(pathToFileURL(FILE).href);
    const hostile = { toString() { throw new Error("no"); } };
    for (const v of [undefined, null, "text", 42, new Error("e"), hostile, Symbol("s")]) {
      assert.doesNotThrow(() => onLateRejection(v));
    }
  });
});
