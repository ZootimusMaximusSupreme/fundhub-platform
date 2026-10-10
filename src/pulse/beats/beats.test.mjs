// Guard 2: every beat is complete, unique, on the list, can go red, and does no I/O.
// (ops/workflows/pulse-layer-2026-10-09-contract.md section 7.2, cut by pulse-layer-2026-10-09-v1.md.)
//
// This file is written to be true with an EMPTY list and to bite the moment a beat lands:
//   1. files named beat-*.mjs on disk equal BEAT_FILES, each a literal import, each with a sibling test
//   2. every beat validates (id = file name, unique, fix guide, covers are real surfaces, reads, deadline)
//   3. every beat passes checkBeatSelfTest: pass runs green, fail goes red at a declared step
//   4. every beat file and every lib/ helper passes the static pin (no db, no providers, no fetch, no env, no SQL writes)
//   5. FIXTURES: the pin, the harness and the validator each get inputs they MUST reject, so none can go blind
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { BEAT_FILES, loadBeats } from "./index.mjs";
import {
  validateBeat, runBeat, checkBeatSelfTest, pinBeatSource, codeView, missingFixGuidePaths, PURE_IMPORTS, MAX_DEADLINE_MS
} from "./contract.mjs";
import { makeFakeCtx } from "./ctx.mjs";
import { makeFixtureBeat } from "../fake-sinks.mjs";
import { JOBS } from "../heartbeats.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../../..");
const LIB = path.join(HERE, "lib");
const read = (file) => fs.readFileSync(file, "utf8");

const beatFilesOnDisk = () => fs.readdirSync(HERE)
  .filter((n) => /^beat-.+\.mjs$/.test(n) && !n.endsWith(".test.mjs")).sort();
const libFilesOnDisk = () => (fs.existsSync(LIB) ? fs.readdirSync(LIB).filter((n) => n.endsWith(".mjs") && !n.endsWith(".test.mjs")).sort() : []);

/* The surface keys a beat may name in `covers`: same rule as surfaces() in src/pulse/tripwires.test.mjs. */
let surfacesPromise;
function surfaces() {
  surfacesPromise ??= (async () => {
    const { ROUTES } = await import("../../../netlify/functions/api.mjs");
    const { functions } = await import("../../workflows/index.mjs");
    const { SEND_PATHS } = await import("../registry.mjs");
    const out = new Set();
    for (const key of Object.keys(ROUTES)) out.add(`route:${key}`);
    for (const f of fs.readdirSync(path.join(ROOT, "public/app")).filter((n) => n.endsWith(".html"))) out.add(`desk:${f}`);
    for (const name of fs.readdirSync(path.join(ROOT, "public"), { recursive: true })) {
      if (typeof name === "string" && name.endsWith(".html") && !name.replace(/\\/g, "/").startsWith("app/")) out.add(`page:${name.replace(/\\/g, "/")}`);
    }
    for (const fn of functions) out.add(`job:${fn.opts.id}`);
    for (const file of Object.keys(SEND_PATHS)) out.add(`send:${file}`);
    return out;
  })();
  return surfacesPromise;
}

/* ---------------- 1. the list ---------------- */

test("Guard 2.1: the beat files on disk equal BEAT_FILES, each a literal import, sorted, each with a test", () => {
  const onDisk = beatFilesOnDisk();
  const listed = BEAT_FILES.map(([name]) => name);
  assert.deepEqual(listed, onDisk, "BEAT_FILES (src/pulse/beats/index.mjs) and the beat-*.mjs files on disk must match");
  assert.deepEqual([...listed].sort(), listed, "BEAT_FILES is sorted by file name");
  assert.equal(new Set(listed).size, listed.length);
  for (const [name, load] of BEAT_FILES) {
    assert.match(String(load), new RegExp(`import\\(\\s*["']\\./${name.replace(/[.]/g, "\\.")}["']\\s*\\)`), `${name}: must be a literal () => import("./${name}")`);
    assert.ok(fs.existsSync(path.join(HERE, name.replace(/\.mjs$/, ".test.mjs"))), `${name}: needs a sibling ${name.replace(/\.mjs$/, ".test.mjs")}`);
  }
  assert.ok(Object.isFrozen(BEAT_FILES));
});

test("Guard 2.1: helpers do not start with beat-, and the list file only imports the contract", () => {
  const helpers = fs.readdirSync(HERE).filter((n) => n.endsWith(".mjs") && !n.endsWith(".test.mjs") && !n.startsWith("beat-")).sort();
  for (const name of ["contract.mjs", "ctx.mjs", "index.mjs", "readbox.mjs"]) assert.ok(helpers.includes(name), `${name} is missing`);
  assert.ok(helpers.every((n) => !/^beat-/.test(n)), "a helper must not look like a beat");
  const idx = read(path.join(HERE, "index.mjs")).replace(/^\s*\/\/.*$/gm, "");
  const imports = [...idx.matchAll(/^\s*import\s[^;]*?from\s+["']([^"']+)["']/gm)].map((m) => m[1]);
  assert.deepEqual(imports, ["./contract.mjs"], "a folder scan or an extra import in index.mjs ships empty or wrong");
});

/* ---------------- 2. validation ---------------- */

test("Guard 2.2: every beat validates; ids are unique, equal the file name, and are not job ids", async () => {
  const surf = await surfaces();
  assert.ok(surf.has("job:message-dispatch-sweeper") && surf.has("route:lenders") && surf.size > 300, "the surface list is real, not empty");
  const jobIds = new Set(JOBS.map((j) => j.job));
  const seen = new Set();
  for (const [file, load] of BEAT_FILES) {
    const mod = await load();
    const problems = validateBeat(mod, { file, surfaces: surf });
    assert.deepEqual(problems, [], `${file}:\n  ${problems.join("\n  ")}`);
    assert.ok(!seen.has(mod.id), `duplicate beat id ${mod.id}`);
    seen.add(mod.id);
    assert.ok(!jobIds.has(mod.id), `${mod.id} is also a job id`);
    const { paths, missing, anyExists } = missingFixGuidePaths(mod.fixGuide, (p) => fs.existsSync(path.join(ROOT, p)));
    assert.ok(anyExists, `${file}: fixGuide names no repo path that exists (${paths.join(", ")})`);
    assert.ok(mod.deadlineMs <= MAX_DEADLINE_MS);
    assert.equal(mod.box, false);
    void missing;
  }
  // the real loader agrees
  const loaded = await loadBeats();
  assert.deepEqual(loaded.map((b) => b.id).sort(), [...seen].sort());
});

test("Guard 2.2: loadBeats stops loudly on a bad beat, a duplicate id, or a loader that fails", async () => {
  const good = makeFixtureBeat();
  const ok = await loadBeats([["beat-fixture.mjs", async () => good]]);
  assert.equal(ok.length, 1);

  await assert.rejects(() => loadBeats([["beat-fixture.mjs", async () => makeFixtureBeat({ box: true })]]), /beat-fixture\.mjs: box must be exactly false/);
  await assert.rejects(() => loadBeats([["beat-wrong.mjs", async () => good]]), /id "fixture" must equal the file name part "wrong"/);
  await assert.rejects(() => loadBeats([
    ["beat-fixture.mjs", async () => good],
    ["beat-fixture.mjs", async () => good]
  ]), /duplicate beat id "fixture"/);
  await assert.rejects(() => loadBeats([["beat-fixture.mjs", async () => { throw new Error("syntax error in beat"); }]]), /could not be imported: syntax error in beat/);
  assert.deepEqual(await loadBeats([]), []);
});

test("Guard 2.2: covers must be a real surface key (a typo is caught)", async () => {
  const surf = await surfaces();
  assert.ok(validateBeat(makeFixtureBeat({ covers: ["route:lenders"] }), { surfaces: surf }).length === 0);
  assert.ok(validateBeat(makeFixtureBeat({ covers: ["route:lendrs"] }), { surfaces: surf }).some((p) => p.includes("route:lendrs")));
  assert.ok(validateBeat(makeFixtureBeat({ covers: ["job:no-such-job"] }), { surfaces: surf }).some((p) => p.includes("job:no-such-job")));
});

/* ---------------- 3. every beat can go red ---------------- */

test("Guard 2.3: every beat's selfTest.pass is green and selfTest.fail is red at a declared step", async () => {
  for (const [file, load] of BEAT_FILES) {
    const mod = await load();
    assert.deepEqual(await checkBeatSelfTest(mod), [], file);
  }
});

test("Guard 2.3: the harness is not blind. A beat that swallows a refused read is red at no-refusals; a beat that cannot go red is rejected", async () => {
  const swallow = makeFixtureBeat({
    async run(ctx) {
      await ctx.step("one", async () => { try { await ctx.read("UPDATE clients SET a = 1"); } catch { /* swallowed */ } });
      await ctx.step("two", async () => 1);
      ctx.skipStep("three", "n/a");
      return ctx.done("looks fine");
    }
  });
  const r = await runBeat(swallow, makeFakeCtx(swallow, swallow.selfTest.pass()));
  assert.deepEqual([r.ok, r.step], [false, "no-refusals"]);

  const alwaysGreen = makeFixtureBeat({
    async run(ctx) { await ctx.step("one", async () => 1); await ctx.step("two", async () => 1); ctx.skipStep("three", "n/a"); return ctx.done(); }
  });
  assert.ok((await checkBeatSelfTest(alwaysGreen)).some((p) => p.includes("stayed GREEN")));
});

/* ---------------- 4. the static pin over real files ---------------- */

test("Guard 2.4: every beat file passes the static pin", () => {
  for (const name of beatFilesOnDisk()) {
    const problems = pinBeatSource(read(path.join(HERE, name)), { role: "beat" });
    assert.deepEqual(problems, [], `${name}:\n  ${problems.join("\n  ")}`);
  }
});

test("Guard 2.4: every helper under lib/ passes the same pin (a beat cannot hide I/O in a helper)", () => {
  for (const name of libFilesOnDisk()) {
    const problems = pinBeatSource(read(path.join(LIB, name)), { role: "lib" });
    assert.deepEqual(problems, [], `lib/${name}:\n  ${problems.join("\n  ")}`);
  }
});

test("Guard 2.4: PURE_IMPORTS entries each carry a written reason", () => {
  for (const [spec, why] of Object.entries(PURE_IMPORTS)) {
    assert.ok(typeof why === "string" && why.trim().length >= 20, `${spec}: say why it is pure`);
  }
});

/* ---------------- 5. the pin cannot go blind ---------------- */

const CLEAN_BEAT = `
// A comment that mentions fetch( and process.env and import pg from "pg" is only a comment.
/* Update the key set in Netlify, then insert into the notes. */
import { isMasked } from "./contract.mjs";
import { classify } from "./lib/classify.mjs";
import { createHash } from "node:crypto";

export const id = "clean";
export const note = "Update the key, then delete from the list in Netlify.";
export async function run(ctx) {
  const rows = await ctx.read("SELECT id, updated_at, created_at FROM job_heartbeats WHERE job = $1", ["x"]);
  const r = await ctx.http.get(ctx.siteUrl + "/api/health");
  if (isMasked(ctx.env.KEY)) ctx.skipStep("key", "mask");
  return ctx.done(String(rows.rows.length + r.status + classify(1) + createHash("sha256").digest("hex")));
}
`;

test("Guard 2.5: a clean beat passes the pin, so a green pin means something", () => {
  assert.deepEqual(pinBeatSource(CLEAN_BEAT), []);
});

const MUST_FAIL = [
  ["the database module", `import { db } from "../../db.mjs";`, "imports the database module"],
  ["the database module, deeper", `import { pool } from "../../../src/db.mjs";`, "imports the database module"],
  ["a messaging provider", `import * as t from "../../messaging/providers/twilio.mjs";`, "imports a messaging provider"],
  ["the pulse probe provider", `import { probeGet } from "../../messaging/providers/pulse-probe.mjs";`, "imports a messaging provider"],
  ["notify.mjs", `import { notify } from "../notify.mjs";`, "imports a sender or recorder"],
  ["alerts.mjs", `import { act } from "../alerts.mjs";`, "imports a sender or recorder"],
  ["records.mjs", `import { x } from "../records.mjs";`, "imports a sender or recorder"],
  ["the chokepoint", `import { transmit } from "../../lib/outbound-fetch.mjs";`, "imports the outbound chokepoint"],
  ["an adapter", `import { x } from "../../adapters/commas.mjs";`, "imports an adapter"],
  ["pg", `import pg from "pg";`, "does I/O"],
  ["node:net", `import net from "node:net";`, "does I/O"],
  ["node:http", `import http from "node:http";`, "does I/O"],
  ["node:https", `import https from "node:https";`, "does I/O"],
  ["child_process", `import { exec } from "node:child_process";`, "does I/O"],
  ["bare child_process", `import { exec } from "child_process";`, "does I/O"],
  ["node:fs", `import fs from "node:fs";`, "does I/O"],
  ["node:fs/promises", `import fs from "node:fs/promises";`, "does I/O"],
  ["an unknown package", `import pad from "left-pad";`, "not on the allow-list"],
  ["an unlisted sibling", `import { x } from "./other-helper.mjs";`, "not on the allow-list"],
  ["a bare side-effect import", `import "../../db.mjs";`, "imports the database module"],
  ["an export-from", `export { pool } from "../../db.mjs";`, "imports the database module"],
  ["a dynamic import of a module", `const m = await import("pg");`, "does I/O"],
  ["a dynamic import with a computed name", `const m = await import(name);`, "computed name"],
  ["a multi-line import", `import {\n  a,\n  b\n} from "../../db.mjs";`, "imports the database module"],
  ["fetch(", `const r = await fetch("https://example.com");`, "calls fetch("],
  ["fetch( with a space", `const r = await fetch ("https://example.com");`, "calls fetch("],
  ["fetchImpl", `const f = opts.fetchImpl;`, "fetchImpl"],
  ["globalThis", `const f = globalThis.fetch;`, "globalThis"],
  ["XMLHttpRequest", `new XMLHttpRequest();`, "XMLHttpRequest"],
  ["WebSocket", `new WebSocket("wss://x");`, "WebSocket"],
  ["process.env read", `const k = process.env.TWILIO_AUTH_TOKEN;`, "process.env"],
  ["process.env write", `process.env.URL = "https://evil.example";`, "process.env"],
  ["process.env bracket write", `process.env["ADAPTERS_DRY_RUN"] = "0";`, "process.env"],
  ["process.exit", `process.exit(0);`, "touches the process"],
  ["require(", `const fs = require("fs");`, "require("],
  ["eval(", `eval("1+1");`, "eval("],
  ["new Function", `const f = new Function("return 1");`, "Function"],
  ["setInterval", `setInterval(() => {}, 1000);`, "setInterval"],
  ["ctx.db", `await ctx.db.query("SELECT 1");`, "does not exist in pulse v1"],
  ["ctx.door", `await ctx.door({ method: "POST", path: "x" });`, "does not exist in pulse v1"],
  ["SQL INSERT in a string", `await ctx.read("INSERT INTO clients (a) VALUES (1)");`, "INSERT INTO"],
  ["SQL INSERT in lower case", `const q = 'insert into clients values (1)';`, "INSERT INTO"],
  ["SQL INSERT with a template name", "const q = `INSERT INTO ${table} (a) VALUES (1)`;", "INSERT INTO"],
  ["SQL UPDATE", `const q = "UPDATE clients SET a = 1 WHERE id = 2";`, "UPDATE ... SET"],
  ["SQL UPDATE with a template name", "const q = `UPDATE ${t} SET a = 1`;", "UPDATE ... SET"],
  ["SQL DELETE", `const q = "DELETE FROM clients WHERE id = 2";`, "DELETE FROM"],
  ["SQL DELETE with no where", `const q = "DELETE FROM clients";`, "DELETE FROM"],
  ["SQL TRUNCATE", `const q = "TRUNCATE TABLE clients";`, "TRUNCATE"],
  ["SQL DROP", `const q = "DROP TABLE clients";`, "DROP"],
  ["SQL ALTER", `const q = "ALTER TABLE clients ADD COLUMN a int";`, "ALTER"],
  ["SQL CREATE", `const q = "CREATE TEMP TABLE x (a int)";`, "CREATE"],
  ["SQL GRANT", `const q = "GRANT ALL ON clients TO public";`, "GRANT"],
  ["SQL REVOKE", `const q = "REVOKE ALL ON clients FROM public";`, "REVOKE"],
  ["a row lock", `const q = "SELECT * FROM clients FOR UPDATE";`, "row lock"],
  ["nextval", `const q = "SELECT nextval('client_code_seq')";`, "side effects"],
  ["pg_advisory_lock", `const q = "SELECT pg_advisory_lock(1)";`, "side effects"],
  ["pg_sleep", `const q = "SELECT pg_sleep(30)";`, "side effects"],
  ["set_config", `const q = "SELECT set_config('fundhub.actor','staff',true)";`, "side effects"],
  ["COPY", `const q = "COPY clients TO PROGRAM 'curl x'";`, "COPY"],
  // The checker's shapes (2026-10-09): ways to reach fetch / process / code without writing `fetch(` or `process.env`.
  ["fetch aliased, then POSTed", `const f = fetch; f("https://x", { method: "POST" });`, "names fetch"],
  ["fetch with ?.", `await fetch?.("https://x");`, "names fetch"],
  ["fetch.call", `await fetch.call(null, "https://x");`, "names fetch"],
  ["fetch handed to a helper", `await retry(fetch);`, "names fetch"],
  ["process by bracket", `const k = process["env"].TWILIO_AUTH_TOKEN;`, "names process"],
  ["process aliased", `const p = process; const k = p.env.KEY;`, "names process"],
  ["process through Function", `(() => {}).constructor("return process")();`, "names constructor"],
  ["indirect eval", `(0, eval)("1");`, "names eval"],
  ["Function without new", `Function("return 1")();`, "names Function"],
  ["new Request", `const r = new Request("https://x", { method: "POST" });`, "names Request"],
  ["navigator.sendBeacon", `navigator.sendBeacon("https://x", "y");`, "navigator or sendBeacon"],
  ["unicode-escaped fetch", `await \\u0066etch("https://x");`, "backslash"],
  ["import.meta", `const u = import.meta.resolve("node:fs");`, "import.meta"],
  ["Reflect", `Reflect.get(globalish, "fetch");`, "Reflect or Proxy"],
  ["Proxy", `const p = new Proxy({}, {});`, "Reflect or Proxy"],
  ["Symbol.for", `const h = Symbol.for("fundhub.pulse.beat-harness");`, "Symbol.for"],
  ["a worker", `new Worker("x.js");`, "worker"],
  ["the global object by name", `const g = global; g.fetch("https://x");`, "global object"],
  ["fetch inside a template expression", "const s = `a ${fetch(\"https://x\")} b`;", "fetch"],
  ["process after a template with a regex before it", "const a = /x/.test(`${1}`); const p = process;", "names process"]
];

test("Guard 2.5: the pin MUST fail each of these (so it cannot go blind)", () => {
  assert.ok(MUST_FAIL.length >= 55);
  for (const [name, src, expected] of MUST_FAIL) {
    const problems = pinBeatSource(src);
    assert.ok(problems.length > 0, `the pin let through: ${name}`);
    assert.ok(problems.some((p) => p.includes(expected)), `${name}: expected a problem containing "${expected}", got: ${problems.join(" | ")}`);
  }
});

test("Guard 2.5: allowed things stay allowed (no false alarms on the common cases)", () => {
  const ok = [
    `import { BeatFail } from "./contract.mjs";`,
    `import { x } from "../beats/contract.mjs";`,
    `import { a } from "./lib/send-path.mjs";`,
    `import crypto from "node:crypto";`,
    `const q = "SELECT updated_at, created_at, granted_by FROM messages WHERE status = 'queued'";`,
    `const t = "Update the secret set in Netlify";`,
    `const note = "Truncate the text to 40 characters";`,
    `const prefetch = prefetchedRows.length;`,
    `await ctx.step("fetch", async () => 1);`,
    `const date = date_trunc_label;`,
    `// import pg from "pg"; (commented out)`,
    // The new name bans must not trip on words in messages, regexes, comments or other objects' properties.
    `const a = "the fetch of the process failed (eval, Function, constructor, Proxy)";`,
    `const b = 'it said \\'process\\' and fetch';`,
    "const c = `fetch ${rows.length} rows from the process queue`;",
    `const d = /fetch\\/process/.test(ctx.siteUrl) ? 1 : 2;`,
    `const e = row.process + row.fetch_count + obj.global;`,
    `const f = x / y / z; const g = (a + b) / 2;`,
    "const h = `${a /* process */}`;",
    `await ctx.step("process", async () => 1); // process is only a word here`,
    `const i = [1, 2].map((n) => n / 2).join("/");`
  ];
  for (const src of ok) assert.deepEqual(pinBeatSource(src), [], src);
});

test("Guard 2.5: codeView blanks strings, comments and regexes, and keeps template expressions", () => {
  assert.equal(codeView(`const a = "fetch"; // process\nx`), `const a = "     "; ` + " ".repeat(10) + `\nx`);
  assert.equal(codeView("const a = `x ${fetch} y`;"), "const a = `  ${fetch}  `;");
  assert.equal(codeView("const a = /fe\"tch/.test(b) ? 1 : 2;"), `const a = /${" ".repeat(6)}/.test(b) ? 1 : 2;`);
  assert.equal(codeView("a / b / c"), "a / b / c", "division is not a regex");
  assert.equal(codeView("return /x'y/.test(z)"), `return /${" ".repeat(3)}/.test(z)`, "a regex after return, with a quote in it, does not eat the rest");
});

test("Guard 2.5: SQL put together at run time is NOT seen by the pin; the read box refuses it when it reaches ctx.read", async () => {
  const src = `const q = "DEL" + "ETE FROM clients"; await ctx.read(q);`;
  assert.deepEqual(pinBeatSource(src), [], "the pin is a tripwire for accidents; it says so in its header");
  const beat = makeFixtureBeat({
    async run(ctx) {
      await ctx.step("one", async () => { await ctx.read("DEL" + "ETE FROM clients"); });
      return ctx.done("not reached");
    }
  });
  const r = await runBeat(beat, makeFakeCtx(beat, { read: [{ match: /./, rows: [] }] }));
  assert.equal(r.ok, false);
  assert.match(r.detail, /refused sql/);
});

test("Guard 2.5: the same pin runs on lib helpers, with its own import rules", () => {
  assert.ok(pinBeatSource(`import { db } from "../../../db.mjs";`, { role: "lib" }).length > 0);
  assert.ok(pinBeatSource(`const r = await fetch("https://x");`, { role: "lib" }).length > 0);
  assert.deepEqual(pinBeatSource(`import { a } from "./sibling.mjs";`, { role: "lib" }), []);
});

/* ---------------- 5b. other fixtures the validator must reject ---------------- */

test("Guard 2.5: the validator rejects the things the board says are not allowed tonight", () => {
  const must = [
    [{ box: true }, "box must be exactly false"],
    [{ kind: "door" }, 'kind "door" does not exist'],
    [{ deadlineMs: 20000 }, "deadlineMs must be"],
    [{ reads: [{ host: "*", methods: ["GET"] }], kind: "send" }, '"*" is allowed only for kind "probe"'],
    [{ fixGuide: "too short" }, "fixGuide"],
    [{ reads: [{ host: "SITE", methods: ["POST"] }] }, "methods"]
  ];
  for (const [over, part] of must) {
    assert.ok(validateBeat(makeFixtureBeat(over)).some((p) => p.includes(part)), JSON.stringify(over));
  }
});

/* ---------------- 7. the runner reaches the list (once the runner exists) ---------------- */

test("Guard 2.7: when the runner and the function exist, the runner imports the beat list and the function imports the runner", () => {
  const runner = path.join(HERE, "..", "runner.mjs");
  const fn = path.join(ROOT, "netlify/functions/pulse-hourly.mjs");
  if (fs.existsSync(runner)) {
    assert.match(read(runner), /beats\/index\.mjs/, "src/pulse/runner.mjs must import src/pulse/beats/index.mjs (a bundle without the list runs zero beats)");
  }
  if (fs.existsSync(fn)) {
    assert.match(read(fn), /pulse\/runner\.mjs/, "netlify/functions/pulse-hourly.mjs must import src/pulse/runner.mjs");
  }
});
