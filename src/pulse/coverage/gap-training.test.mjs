import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { MODULES, GATES } from "../../training/curriculum.mjs";
import {
  CHECK_IDS,
  PAGE_PATH,
  SCRIPT_PATH,
  READ_PATH,
  NO_PARTNER_ID,
  REQUIRED_STEP_SQL,
  REQUIRED_GATE_SQL,
  gapChecks,
  pageBodyAlive,
  scriptReadsTraining
} from "./gap-training.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../../..");
const SRC = fs.readFileSync(path.join(HERE, "gap-training.mjs"), "utf8");
const ORG = "11111111-1111-4111-8111-111111111111";

const PAGE_HTML =
  '<div id="trModules">Loading</div><script src="partner-training.js"></script>';
const PAGE_JS =
  'fetch("/api/read/partner-training"); rows.forEach(function (m) { out.push("<b>" + esc(m.title) + "</b>"); });';

function shape(row) {
  assert.equal(typeof row.id, "string");
  assert.ok(row.id.length > 0);
  assert.ok(["PASS", "FAIL", "skip"].includes(row.status));
  assert.equal(typeof row.detail, "string");
  assert.ok(row.detail.length > 0);
  assert.ok("suggestedFix" in row);
  if (row.status === "FAIL") {
    assert.equal(typeof row.suggestedFix, "string");
    assert.match(row.suggestedFix, /Recon \(AG-07\) is the one tripwire/);
    assert.match(row.suggestedFix, /Do not invent a second watchdog/);
    assert.match(row.suggestedFix, /Do not mark anyone certified/);
    assert.match(row.suggestedFix, /Do not edit the training page/);
  } else {
    assert.equal(row.suggestedFix, null);
  }
}

const byId = (rows, id) => rows.find((row) => row.id === id);

/* A db that answers each training query by its own text, from the real
   curriculum, so dropping a step or a gate from the lists below shows up. */
function curriculumDb({ modules = MODULES, gates = GATES, boom = null, calls = null } = {}) {
  return {
    async query(sql, params) {
      const text = String(sql);
      if (calls) calls.push({ sql: text, params });
      if (boom && boom.test(text)) throw new Error("relation does not exist postgres://user:pw@host/db");
      if (text === REQUIRED_STEP_SQL) {
        return { rows: modules.map((m) => ({ code: m.code, title: m.title })) };
      }
      if (text === REQUIRED_GATE_SQL) {
        return { rows: gates.map((g) => ({ code: g.code, title: g.title })) };
      }
      if (/FROM training_modules m/.test(text)) {
        return {
          rows: modules.map((m) => ({
            id: m.code, code: m.code, position: m.position, title: m.title, week_no: m.weekNo,
            gate_code: m.gateCode, certified: m.certified, status: null
          }))
        };
      }
      if (/FROM training_gates/.test(text)) {
        return {
          rows: gates.map((g) => ({
            code: g.code, position: g.position, title: g.title, week_due: g.weekDue, blocks: "blocks"
          }))
        };
      }
      if (/partner_training_gates/.test(text)) return { rows: [] };
      throw new Error(`unexpected sql: ${text.slice(0, 60)}`);
    }
  };
}

function fakeFetch(map) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url: String(url), method: (init && init.method) || "GET" });
    const hit = map(String(url));
    if (hit && hit.throw) throw new Error(hit.throw);
    return {
      status: hit.status,
      async text() { return hit.body == null ? "" : String(hit.body); }
    };
  };
  return { fetchImpl, calls };
}

const livePage = (over = {}) => (url) => {
  if (url.endsWith(PAGE_PATH)) return over.page || { status: 200, body: PAGE_HTML };
  if (url.endsWith(SCRIPT_PATH)) return over.script || { status: 200, body: PAGE_JS };
  return { status: 599, body: "" };
};

test("gap-training: three checks, select-only, one tripwire, no disk reads", () => {
  assert.deepEqual([...CHECK_IDS], [
    "training:page",
    "training:read-api",
    "training:required-step"
  ]);
  for (const sql of [REQUIRED_STEP_SQL, REQUIRED_GATE_SQL]) {
    assert.match(sql.trim(), /^SELECT/i);
    assert.doesNotMatch(sql, /\b(insert|update|delete|drop|alter)\b/i);
    assert.match(sql, /\$1/);
  }
  assert.match(REQUIRED_STEP_SQL, /FROM training_modules/);
  assert.match(REQUIRED_GATE_SQL, /FROM training_gates/);
  assert.doesNotMatch(SRC, /\b(INSERT|UPDATE|DELETE|DROP|POST)\b/);
  assert.doesNotMatch(SRC, /PULSE_REGISTRY|MACHINE_CHECKS|alreadyInRegistry/);
  assert.doesNotMatch(SRC, /recordModuleProgress|training-progress|partner_training_gates/);
  assert.doesNotMatch(SRC, /node:fs|readFileSync|readText|BEGIN|COMMIT|ROLLBACK/);
  assert.match(SRC, /Recon \(AG-07\) is the one tripwire/);
  assert.match(SRC, /Do not invent a second watchdog/);
  assert.match(SRC, /Do not mark anyone certified/);
  assert.match(SRC, /export async function gapChecks/);
  assert.equal(MODULES.length, 13);
  assert.equal(GATES.length, 4);
});

test("gap-training: no database and no fetch skips all three, and does not throw", async () => {
  const rows = await gapChecks({});
  assert.deepEqual(rows.map((row) => row.id), [...CHECK_IDS]);
  rows.forEach(shape);
  assert.deepEqual(rows.map((row) => row.status), ["skip", "skip", "skip"]);
  // A database with no company id cannot be scoped, so it skips too.
  const noOrg = await gapChecks({ db: curriculumDb() });
  assert.deepEqual(noOrg.map((row) => row.status), ["skip", "skip", "skip"]);
});

test("gap-training: a healthy site is three PASS rows, the page by GET, the data under staff scope", async () => {
  const { fetchImpl, calls: fetched } = fakeFetch(livePage());
  const queried = [];
  let scoped = 0;
  const rows = await gapChecks({
    db: curriculumDb({ calls: queried }),
    scope: (fn) => { scoped += 1; return fn(curriculumDb({ calls: queried })); },
    orgId: ORG,
    fetchImpl,
    baseUrl: "https://fundhub.ai/"
  });
  rows.forEach(shape);
  assert.deepEqual(rows.map((row) => row.status), ["PASS", "PASS", "PASS"]);
  assert.match(byId(rows, "training:read-api").detail, /13 steps and 4 gates/);
  assert.match(byId(rows, "training:required-step").detail, /13 required training steps and 4 gates/);
  assert.deepEqual(fetched.map((c) => c.url), [`https://fundhub.ai${PAGE_PATH}`, `https://fundhub.ai${SCRIPT_PATH}`]);
  assert.equal(fetched.every((c) => c.method === "GET"), true);
  assert.equal(scoped, 2);
  assert.equal(queried.every((q) => /^\s*SELECT/i.test(q.sql)), true);
});

test("gap-training: the page, the script, or a missing step list each fail the page row", async () => {
  const cases = [
    [{ page: { status: 404, body: "gone" } }, /training page answered 404/],
    [{ page: { status: 500, body: "boom" } }, /training page answered 500/],
    [{ page: { status: 200, body: "<html>no list</html>" } }, /no place to show a step/],
    [{ script: { status: 404, body: "" } }, /script answered 404/],
    [{ script: { status: 200, body: "console.log('hi')" } }, /no longer calls the training read/],
    [{ script: { status: 200, body: 'fetch("/api/read/partner-training")' } }, /no longer prints a step title/]
  ];
  for (const [over, pattern] of cases) {
    const { fetchImpl } = fakeFetch(livePage(over));
    const row = byId(await gapChecks({ fetchImpl }), "training:page");
    assert.equal(row.status, "FAIL", String(pattern));
    assert.match(row.detail, pattern);
    shape(row);
  }
  const down = fakeFetch(() => ({ throw: "socket hang up" }));
  const thrown = byId(await gapChecks({ fetchImpl: down.fetchImpl }), "training:page");
  assert.equal(thrown.status, "FAIL");
  assert.match(thrown.detail, /unreachable \(socket hang up\)/);
  assert.match(thrown.detail, /script unreachable/);
  assert.equal(pageBodyAlive(PAGE_HTML), true);
  assert.equal(pageBodyAlive('<div id="trModules"></div>'), false);
  assert.equal(scriptReadsTraining(PAGE_JS), true);
  assert.equal(scriptReadsTraining("x.title"), false);
});

test("gap-training: the training read runs for a partner that does not exist, and a crash is a fail", async () => {
  const calls = [];
  const ok = byId(await gapChecks({ db: curriculumDb({ calls }), orgId: ORG }), "training:read-api");
  assert.equal(ok.status, "PASS");
  assert.equal(calls.some((c) => Array.isArray(c.params) && c.params.includes(NO_PARTNER_ID)), true);
  assert.equal(calls.every((c) => /^\s*SELECT/i.test(c.sql)), true);

  const crashRows = await gapChecks({
    db: curriculumDb({ boom: /FROM training_modules m/ }),
    orgId: ORG
  });
  const crash = byId(crashRows, "training:read-api");
  // One crash fails its own row and leaves the step list row alone.
  assert.equal(byId(crashRows, "training:required-step").status, "PASS");
  assert.equal(crash.status, "FAIL");
  assert.match(crash.detail, /Partner training read crashed: relation does not exist/);
  assert.doesNotMatch(crash.detail, /user:pw@host/);
  shape(crash);

  const empty = byId(await gapChecks({ db: curriculumDb({ modules: [] }), orgId: ORG }), "training:read-api");
  assert.equal(empty.status, "FAIL");
  assert.match(empty.detail, /0 steps/);
  shape(empty);

  const noGate = byId(await gapChecks({ db: curriculumDb({ gates: GATES.slice(0, 3) }), orgId: ORG }), "training:read-api");
  // The read falls back to the four named gates when a catalogue row is gone,
  // so a short list still comes back as four. That gap is the next row's job.
  assert.equal(noGate.status, "PASS");
});

test("gap-training: a missing or blank required step, or a missing gate, fails and certifies no one", async () => {
  const noM7 = byId(await gapChecks({
    db: curriculumDb({ modules: MODULES.filter((m) => m.code !== "m7") }),
    orgId: ORG
  }), "training:required-step");
  assert.equal(noM7.status, "FAIL");
  assert.match(noM7.detail, /m7 is not in the training step list/);
  shape(noM7);

  const blank = byId(await gapChecks({
    db: curriculumDb({ modules: MODULES.map((m) => (m.code === "m3" ? { ...m, title: "" } : m)) }),
    orgId: ORG
  }), "training:required-step");
  assert.equal(blank.status, "FAIL");
  assert.match(blank.detail, /m3 has no title/);

  const none = byId(await gapChecks({ db: curriculumDb({ modules: [] }), orgId: ORG }), "training:required-step");
  assert.equal(none.status, "FAIL");
  assert.match(none.detail, /none of the 13 required training steps are in the list/);

  const noG3 = byId(await gapChecks({
    db: curriculumDb({ gates: GATES.filter((g) => g.code !== "G3") }),
    orgId: ORG
  }), "training:required-step");
  assert.equal(noG3.status, "FAIL");
  assert.match(noG3.detail, /G3 is not in the training gate list/);
  assert.doesNotMatch(noG3.detail, /m\d/);

  const blankGate = byId(await gapChecks({
    db: curriculumDb({ gates: GATES.map((g) => (g.code === "G2" ? { ...g, title: "   " } : g)) }),
    orgId: ORG
  }), "training:required-step");
  assert.equal(blankGate.status, "FAIL");
  assert.match(blankGate.detail, /G2 has no title/);

  const queryFails = byId(await gapChecks({
    db: curriculumDb({ boom: /FROM training_gates\s+WHERE org_id = \$1::uuid\s+ORDER BY position/ }),
    orgId: ORG
  }), "training:required-step");
  assert.equal(queryFails.status, "FAIL");
  assert.match(queryFails.detail, /could not read training steps/);
});

test("gap-training: the required-step read binds the company id", async () => {
  const calls = [];
  await gapChecks({ db: curriculumDb({ calls }), orgId: ORG });
  const required = calls.filter((c) => c.sql === REQUIRED_STEP_SQL || c.sql === REQUIRED_GATE_SQL);
  assert.equal(required.length, 2);
  for (const c of required) assert.deepEqual(c.params, [ORG]);
});

test("gap-training: the repo still wires the training page, route, and title (CI only; the pulse reads the live site)", () => {
  const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");
  const html = read("public/app/partner-training.html");
  const js = read("public/app/partner-training.js");
  assert.equal(pageBodyAlive(html), true);
  assert.equal(scriptReadsTraining(js), true);
  assert.equal(js.includes("m.title"), true);
  const api = read("netlify/functions/api.mjs");
  assert.match(api, /import readPartnerTraining from ["'][^"']*partner-training\.mjs["']/);
  assert.match(api, /["']read\/partner-training["']\s*:\s*readPartnerTraining/);
  const handler = read("api/read/partner-training.mjs");
  assert.match(handler, /req\.method !== ["']GET["']/);
  assert.match(handler, /export default async function handler/);
  assert.match(handler, /fetchTraining\(/);
  const progress = read("src/training/progress.mjs");
  assert.match(progress, /m\.title/);
  assert.match(progress, /FROM training_modules/);
  assert.equal(READ_PATH, "/api/read/partner-training");
});
