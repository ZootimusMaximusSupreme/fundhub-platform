import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { MODULES } from "../../training/curriculum.mjs";
import {
  CHECK_IDS,
  PAGE_PATH,
  READ_PATH,
  REQUIRED_STEP_SQL,
  gapChecks,
  requiredStepReadable,
  trainingPageWired,
  trainingReadWired
} from "./gap-training.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = fs.readFileSync(path.join(HERE, "gap-training.mjs"), "utf8");
const ORG = "00000000-0000-4000-8000-0000000000aa";

const GOOD_HTML =
  '<div id="trModules"></div><script src="partner-training.js"></script>';

const ALIVE_FILES = {
  "public/app/partner-training.html": GOOD_HTML,
  "public/app/partner-training.js":
    'var url = "/api/read/partner-training"; esc(m.title);',
  "netlify/functions/api.mjs":
    'import readPartnerTraining from "../../api/read/partner-training.mjs";\n"read/partner-training": readPartnerTraining,',
  "api/read/partner-training.mjs":
    'if (req.method && req.method !== "GET") {}\nexport default async function handler() {}\nfetchTraining(tx, { partnerId, orgId });',
  "src/training/progress.mjs":
    "SELECT m.id, m.code, m.title FROM training_modules m"
};

function aliveRead(rel) {
  if (!Object.prototype.hasOwnProperty.call(ALIVE_FILES, rel)) {
    throw new Error(`unexpected read: ${rel}`);
  }
  return ALIVE_FILES[rel];
}

function readMap(map) {
  return (rel) => {
    if (Object.prototype.hasOwnProperty.call(map, rel)) return map[rel];
    return aliveRead(rel);
  };
}

function fullRows() {
  return MODULES.map((mod) => ({ code: mod.code, title: mod.title }));
}

function fakeDb(rows, { throwSql = false } = {}) {
  const queries = [];
  return {
    queries,
    async query(sql, params) {
      queries.push({ sql, params });
      if (sql !== REQUIRED_STEP_SQL) throw new Error("unexpected sql");
      if (throwSql) throw new Error("modules down");
      return { rows };
    }
  };
}

function fetchByUrl({
  pageStatus = 200,
  pageBody = GOOD_HTML,
  apiStatus = 401,
  throwPage = false,
  throwApi = false
} = {}) {
  const calls = [];
  const impl = async (url, opts) => {
    calls.push({
      url: String(url),
      method: opts && opts.method,
      body: opts && opts.body
    });
    const u = String(url);
    if (u.includes(PAGE_PATH)) {
      if (throwPage) throw new Error("page down");
      return { status: pageStatus, async text() { return pageBody; } };
    }
    if (u.includes(READ_PATH)) {
      if (throwApi) throw new Error("api down");
      return { status: apiStatus, async text() { return ""; } };
    }
    throw new Error(`unexpected url ${u}`);
  };
  return { impl, calls };
}

function shape(row) {
  assert.equal(typeof row.id, "string");
  assert.ok(CHECK_IDS.includes(row.id));
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

function byId(rows, id) {
  return rows.find((row) => row.id === id);
}

test("gap-training: three checks, select-only, one tripwire", () => {
  assert.deepEqual(CHECK_IDS, [
    "training:page",
    "training:read-api",
    "training:required-step"
  ]);
  assert.match(REQUIRED_STEP_SQL.trim(), /^SELECT/i);
  assert.doesNotMatch(REQUIRED_STEP_SQL, /\b(insert|update|delete|drop|alter)\b/i);
  assert.match(REQUIRED_STEP_SQL, /FROM training_modules/);
  assert.match(REQUIRED_STEP_SQL, /\$1/);
  assert.doesNotMatch(SRC, /\b(INSERT|UPDATE|DELETE|DROP|POST)\b/);
  assert.doesNotMatch(SRC, /PULSE_REGISTRY|MACHINE_CHECKS|alreadyInRegistry/);
  assert.doesNotMatch(SRC, /recordModuleProgress|training-progress|partner_training_gates/);
  assert.match(SRC, /Recon \(AG-07\) is the one tripwire/);
  assert.match(SRC, /Do not invent a second watchdog/);
  assert.match(SRC, /Do not mark anyone certified/);
  assert.match(SRC, /export async function gapChecks/);
});

test("gap-training: no database and no fetch skips the three reads", async () => {
  const rows = await gapChecks({ readText: aliveRead });
  assert.deepEqual(rows.map((row) => row.id), [...CHECK_IDS]);
  rows.forEach(shape);
  assert.deepEqual(rows.map((row) => row.status), ["skip", "skip", "skip"]);
});

test("gap-training: a quiet training door is three PASS rows", async () => {
  const { impl, calls } = fetchByUrl();
  const db = fakeDb(fullRows());
  const rows = await gapChecks({
    db,
    orgId: ORG,
    fetchImpl: impl,
    baseUrl: "https://fundhub.ai/",
    readText: aliveRead
  });
  rows.forEach(shape);
  assert.ok(rows.every((row) => row.status === "PASS"));
  assert.match(byId(rows, "training:required-step").detail, /all 13 required training steps/);
  assert.equal(calls.length, 2);
  assert.ok(calls.every((call) => call.method === "GET" && call.body == null));
  assert.equal(calls[0].url, `https://fundhub.ai${PAGE_PATH}`);
  assert.equal(calls[1].url, `https://fundhub.ai${READ_PATH}`);
  assert.equal(db.queries.length, 1);
  assert.equal(db.queries[0].params[0], ORG);
});

test("gap-training: a 200 training read is not dead", async () => {
  const { impl } = fetchByUrl({ apiStatus: 200 });
  const rows = await gapChecks({
    db: fakeDb(fullRows()),
    orgId: ORG,
    fetchImpl: impl,
    readText: aliveRead
  });
  assert.equal(byId(rows, "training:read-api").status, "PASS");
});

test("gap-training: page 404 fails only the page", async () => {
  const { impl, calls } = fetchByUrl({ pageStatus: 404, pageBody: "" });
  const rows = await gapChecks({
    db: fakeDb(fullRows()),
    orgId: ORG,
    fetchImpl: impl,
    readText: aliveRead
  });
  rows.forEach(shape);
  const page = byId(rows, "training:page");
  assert.equal(page.status, "FAIL");
  assert.match(page.detail, /answered 404/);
  assert.equal(byId(rows, "training:read-api").status, "PASS");
  assert.equal(byId(rows, "training:required-step").status, "PASS");
  assert.ok(calls.every((call) => call.method === "GET"));
});

test("gap-training: a page that cannot show a step fails without a fetch", async () => {
  const rows = await gapChecks({
    readText: readMap({
      "public/app/partner-training.html": "<p>Training</p>"
    })
  });
  rows.forEach(shape);
  const page = byId(rows, "training:page");
  assert.equal(page.status, "FAIL");
  assert.match(page.detail, /no longer shows a step/);
  assert.equal(trainingPageWired(readMap({
    "public/app/partner-training.html": "<p>Training</p>"
  })), false);
  assert.equal(byId(rows, "training:read-api").status, "skip");
  assert.equal(byId(rows, "training:required-step").status, "skip");
});

test("gap-training: a live page with no step list is dead", async () => {
  const { impl } = fetchByUrl({ pageBody: "<p>Login</p>" });
  const rows = await gapChecks({
    db: fakeDb(fullRows()),
    orgId: ORG,
    fetchImpl: impl,
    readText: aliveRead
  });
  const page = byId(rows, "training:page");
  assert.equal(page.status, "FAIL");
  assert.match(page.detail, /a step cannot be shown/);
  assert.equal(byId(rows, "training:read-api").status, "PASS");
});

test("gap-training: training read 500 fails only the read", async () => {
  const { impl } = fetchByUrl({ apiStatus: 500 });
  const rows = await gapChecks({
    db: fakeDb(fullRows()),
    orgId: ORG,
    fetchImpl: impl,
    readText: aliveRead
  });
  rows.forEach(shape);
  const api = byId(rows, "training:read-api");
  assert.equal(api.status, "FAIL");
  assert.match(api.detail, /answered 500/);
  assert.match(api.suggestedFix, /Restore GET \/api\/read\/partner-training/);
  assert.equal(byId(rows, "training:page").status, "PASS");
  assert.equal(byId(rows, "training:required-step").status, "PASS");
});

test("gap-training: a missing training route fails without a database", async () => {
  const dead = readMap({ "netlify/functions/api.mjs": "no training route" });
  const rows = await gapChecks({ readText: dead });
  rows.forEach(shape);
  const api = byId(rows, "training:read-api");
  assert.equal(api.status, "FAIL");
  assert.match(api.detail, /route is not wired/);
  assert.equal(trainingReadWired(dead), false);
  assert.equal(trainingReadWired(aliveRead), true);
  assert.equal(byId(rows, "training:page").status, "skip");
  assert.equal(byId(rows, "training:required-step").status, "skip");
});

test("gap-training: a missing required step fails and does not certify anyone", async () => {
  const rows = await gapChecks({
    db: fakeDb(fullRows().filter((row) => row.code !== "m7" && row.code !== "m8")),
    orgId: ORG,
    fetchImpl: fetchByUrl().impl,
    readText: aliveRead
  });
  rows.forEach(shape);
  const step = byId(rows, "training:required-step");
  assert.equal(step.status, "FAIL");
  assert.match(step.detail, /m7, m8 are not in the curriculum/);
  assert.match(step.suggestedFix, /Do not mark anyone certified/);
  assert.equal(byId(rows, "training:page").status, "PASS");
  assert.equal(byId(rows, "training:read-api").status, "PASS");
});

test("gap-training: a blank step title cannot be read", async () => {
  const rows = fullRows().map((row) => (row.code === "m6" ? { code: "m6", title: "  " } : row));
  const out = await gapChecks({
    db: fakeDb(rows),
    orgId: ORG,
    fetchImpl: fetchByUrl().impl,
    readText: aliveRead
  });
  const step = byId(out, "training:required-step");
  assert.equal(step.status, "FAIL");
  assert.match(step.detail, /m6 has no title/);
});

test("gap-training: an empty curriculum means no required step can be read", async () => {
  const rows = await gapChecks({
    db: fakeDb([]),
    orgId: ORG,
    fetchImpl: fetchByUrl().impl,
    readText: aliveRead
  });
  assert.match(
    byId(rows, "training:required-step").detail,
    /none of the 13 required training steps are in the list/
  );
});

test("gap-training: a training read that drops the title fails without a database", async () => {
  const dead = readMap({
    "src/training/progress.mjs": "SELECT m.code FROM training_modules"
  });
  const rows = await gapChecks({
    fetchImpl: fetchByUrl().impl,
    readText: dead
  });
  rows.forEach(shape);
  const step = byId(rows, "training:required-step");
  assert.equal(step.status, "FAIL");
  assert.match(step.detail, /no longer returns the step title/);
  assert.equal(requiredStepReadable(dead), false);
  assert.equal(requiredStepReadable(aliveRead), true);
  assert.equal(byId(rows, "training:page").status, "PASS");
  assert.equal(byId(rows, "training:read-api").status, "PASS");
});

test("gap-training: a read error fails that check and leaves the others", async () => {
  const rows = await gapChecks({
    db: fakeDb(fullRows(), { throwSql: true }),
    orgId: ORG,
    fetchImpl: fetchByUrl().impl,
    readText: aliveRead
  });
  rows.forEach(shape);
  assert.equal(byId(rows, "training:required-step").status, "FAIL");
  assert.match(byId(rows, "training:required-step").detail, /modules down/);
  assert.equal(byId(rows, "training:page").status, "PASS");
  assert.equal(byId(rows, "training:read-api").status, "PASS");
});

test("gap-training: the live training page and read are still wired", () => {
  assert.equal(trainingPageWired(), true);
  assert.equal(trainingReadWired(), true);
  assert.equal(requiredStepReadable(), true);
  assert.equal(MODULES.length, 13);
});
