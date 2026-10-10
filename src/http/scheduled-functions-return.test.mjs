/* Every timed job must hand Netlify a return value Netlify accepts.
 *
 * MEASURED ON LIVE 2026-09-18 (hole N5). All five timed jobs in netlify.toml
 * ended EVERY run with
 *   "Function returned an unsupported value. Accepted types are 'Response' or 'undefined'"
 * and Netlify then ran each one twice more. In ten minutes (18:34–18:44 UTC)
 * the payment sweeper ran 30 times instead of 10, the creative runner 15
 * instead of 5, and the other three the same three-for-one.
 *
 * WHY. Netlify decides a function's style from its exports. A file with a
 * default export and no `export const handler = …` is the NEWER style, and the
 * newer style must return a web `Response` (or nothing). Its parser does not
 * count `export async function handler` as a handler export, so these files —
 * which also `export default handler` — are the newer style. They returned the
 * OLDER style's `{ statusCode, body }` object, which the runtime rejects as an
 * error, and a failed timed run is retried.
 *
 * This test calls each timed job's default export exactly as Netlify does and
 * checks what comes back. It runs them in a child process with no
 * DATABASE_URL, so every sweep fails at its first query, catches that, and
 * returns — nothing is claimed, sent or written anywhere.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

/* The timed jobs are whatever netlify.toml gives a schedule to. */
function scheduledFunctions() {
  const toml = readFileSync(path.join(ROOT, "netlify.toml"), "utf8");
  const names = [];
  const block = /\[functions\."([^"]+)"\]\s*\n\s*schedule\s*=\s*"[^"]+"/g;
  let m;
  while ((m = block.exec(toml))) names.push(m[1]);
  return names;
}

test("netlify.toml schedules the timed jobs this test covers", () => {
  const names = scheduledFunctions();
  assert.deepEqual(names.slice().sort(), [
    /* Added 2026-09-23. It was an Inngest cron, which runs inside the
       synchronous /api/inngest request and is killed at 26 seconds. A pass
       moves a whole video file — the first real take was 120 MB — and was
       killed mid-upload on production. A scheduled function gets 15 minutes. */
    "ad-video-sweeper",
    "commas-inbox-sweeper",
    "creative-job-runner",
    "hubstaff-poll-sweeper",
    /* Added 2026-10-06 (marketing machine, plan unit U22). The 15-minute clock: reads,
       writes its heartbeat and wakes marketing-worker-background; no real work. */
    "marketing-clock",
    /* Added 2026-10-09 (pulse v1). The hourly pulse: runs every beat read-only and texts Chris
       on a break. With no DATABASE_URL (this test's child run) it does nothing at all. */
    "pulse-hourly",
    /* Added 2026-10-09 (outside watch). Every 5 minutes on Netlify's clock: runs the engine-alive beat
       and texts Chris if the 5-minute alarms stopped. With no DATABASE_URL it does nothing at all. */
    "pulse-outside-watch",
    "social-publish-sweeper",
    "staff-message-sweeper"
  ]);
  for (const name of names) {
    assert.ok(existsSync(path.join(ROOT, "netlify/functions", `${name}.mjs`)),
      `netlify.toml schedules ${name} but netlify/functions/${name}.mjs does not exist`);
  }
});

test("every timed job's default export returns a Response or undefined — never { statusCode, body }", () => {
  const names = scheduledFunctions();
  assert.ok(names.length > 0, "no scheduled functions found in netlify.toml");

  const files = names.map((n) => pathToFileURL(path.join(ROOT, "netlify/functions", `${n}.mjs`)).href);
  const script = `
    const files = ${JSON.stringify(files)};
    const names = ${JSON.stringify(names)};
    const out = [];
    for (let i = 0; i < files.length; i++) {
      const mod = await import(files[i]);
      if (typeof mod.default !== "function") { out.push({ name: names[i], kind: "no-default-export" }); continue; }
      const req = new Request("https://fundhub.ai/.netlify/functions/" + names[i], {
        method: "POST", body: JSON.stringify({ next_run: new Date().toISOString() })
      });
      const r = await mod.default(req, {});
      const kind = r instanceof Response ? "Response" : r === undefined ? "undefined"
        : (r && typeof r === "object" && "statusCode" in r) ? "lambda-object" : typeof r;
      out.push({ name: names[i], kind, status: r instanceof Response ? r.status : null });
    }
    process.stdout.write("RESULT " + JSON.stringify(out) + "\\n");
    process.exit(0);
  `;
  /* No DATABASE_URL, no provider keys: only what node needs to start. */
  const env = { PATH: process.env.PATH, HOME: process.env.HOME, NODE_ENV: "test" };
  const run = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
    cwd: ROOT, env, encoding: "utf8", timeout: 60000
  });
  const line = (run.stdout || "").split("\n").find((l) => l.startsWith("RESULT "));
  assert.ok(line, `child process did not report. exit=${run.status}\n${(run.stderr || "").slice(-2000)}`);
  const results = JSON.parse(line.slice("RESULT ".length));

  assert.equal(results.length, names.length, "every scheduled function reported");
  const bad = results.filter((r) => r.kind !== "Response" && r.kind !== "undefined");
  assert.deepEqual(bad, [],
    `default export returned something Netlify rejects: ${bad.map((r) => `${r.name}=${r.kind}`).join(", ")}. ` +
    `Netlify only accepts a Response or undefined from a default-export function; anything else ` +
    `logs "Function returned an unsupported value" and the timed run is repeated.`);
  for (const r of results.filter((x) => x.kind === "Response")) {
    assert.equal(r.status, 200, `${r.name}: a failed pass still answers 200 — the next pass is the retry`);
  }
});
