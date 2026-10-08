import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  AGENT_CODE,
  CALL_DUE_STATUSES,
  LETTER_SQL,
  LETTER_STATUSES,
  OPEN_MOVE_STATUSES,
  RECON_SQL,
  SOURCE_WORKFLOW,
  SPECIALIST_GETS,
  STUCK_AFTER_MS,
  STUCK_SQL,
  UPLOAD_DOOR_PATH,
  gapChecks
} from "./gap-inquiry.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ORG = "11111111-1111-1111-1111-111111111111";
const NOW = new Date("2026-10-08T18:00:00Z");

const SHAPE = ["id", "status", "detail", "suggestedFix"];
const IDS = [
  "inquiry:case-stuck",
  "inquiry:letter-round",
  "inquiry:specialist-api",
  "inquiry:upload-door",
  "recon"
];

function assertShape(rows) {
  assert.equal(rows.length, 5);
  assert.deepEqual(rows.map((row) => row.id), IDS);
  for (const row of rows) {
    assert.deepEqual(Object.keys(row), SHAPE);
    assert.ok(row.status === "PASS" || row.status === "FAIL" || row.status === "skip");
    assert.equal(typeof row.detail, "string");
    assert.ok(row.detail.length > 0);
    if (row.status === "FAIL") {
      assert.equal(typeof row.suggestedFix, "string");
      assert.match(row.suggestedFix, /Do not auto-fix|Do not invent a second watchdog/);
    } else {
      assert.equal(row.suggestedFix, null);
    }
  }
}

function dbFrom(map) {
  return {
    async query(sql, params) {
      if (!Object.prototype.hasOwnProperty.call(map, sql)) {
        throw new Error(`unexpected query: ${String(sql).slice(0, 80)}`);
      }
      const answer = map[sql];
      return typeof answer === "function" ? answer(params) : answer;
    }
  };
}

function quietDb() {
  return dbFrom({
    [STUCK_SQL]: { rows: [{ n: 0 }] },
    [LETTER_SQL]: { rows: [{ n: 0 }] },
    [RECON_SQL]: {
      rows: [{ code: AGENT_CODE, status: "live", runtime: "inngest", runtime_ref: SOURCE_WORKFLOW }]
    }
  });
}

function liveFetch(methods) {
  return async function fetchImpl(url, opts) {
    methods.push({ url, method: opts && opts.method });
    const portal = String(url).includes(UPLOAD_DOOR_PATH);
    return {
      status: 200,
      text: async () => (portal ? '<div class="upload-door" data-kind="inquiry_doc"></div>' : "{}")
    };
  };
}

test("gap inquiry: no database and no fetch skips every row", async () => {
  const rows = await gapChecks({});
  assertShape(rows);
  assert.deepEqual(rows.map((row) => row.status), ["skip", "skip", "skip", "skip", "skip"]);
});

test("gap inquiry: quiet file, live doors, and Recon pass", async () => {
  const methods = [];
  const rows = await gapChecks({
    db: quietDb(),
    orgId: ORG,
    fetchImpl: liveFetch(methods),
    baseUrl: "http://pulse.test/",
    now: NOW
  });
  assertShape(rows);
  assert.deepEqual(rows.map((row) => row.status), ["PASS", "PASS", "PASS", "PASS", "PASS"]);
  assert.deepEqual(methods.map((call) => call.method), ["GET", "GET", "GET"]);
  assert.deepEqual(
    methods.map((call) => call.url),
    [
      `http://pulse.test${SPECIALIST_GETS[0]}`,
      `http://pulse.test${SPECIALIST_GETS[1]}`,
      `http://pulse.test${UPLOAD_DOOR_PATH}`
    ]
  );
});

test("gap inquiry: a stale or overdue case is stuck, and the read stays a count", async () => {
  let stuckParams;
  const db = dbFrom({
    [STUCK_SQL]: (params) => {
      stuckParams = params;
      return { rows: [{ n: 2 }] };
    },
    [LETTER_SQL]: { rows: [{ n: 0 }] },
    [RECON_SQL]: {
      rows: [{ code: AGENT_CODE, status: "live", runtime: "inngest", runtime_ref: SOURCE_WORKFLOW }]
    }
  });
  const rows = await gapChecks({
    db,
    orgId: ORG,
    fetchImpl: liveFetch([]),
    baseUrl: "http://pulse.test",
    now: NOW
  });
  const stuck = rows[0];
  assert.equal(stuck.status, "FAIL");
  assert.match(stuck.detail, /2 inquiry cases are stuck/);
  assert.match(stuck.suggestedFix, /Do not mail a bureau/);
  assert.equal(stuckParams[0], ORG);
  assert.deepEqual(stuckParams[1], [...OPEN_MOVE_STATUSES]);
  assert.equal(stuckParams[2], new Date(NOW.getTime() - STUCK_AFTER_MS).toISOString());
  assert.equal(stuckParams[3], NOW.toISOString());
  assert.deepEqual(stuckParams[4], [...CALL_DUE_STATUSES]);
  assert.equal(STUCK_AFTER_MS, 72 * 60 * 60 * 1000);
});

test("gap inquiry: one funding round with open inquiries and no draft fails", async () => {
  let letterParams;
  const db = dbFrom({
    [STUCK_SQL]: { rows: [{ n: 0 }] },
    [LETTER_SQL]: (params) => {
      letterParams = params;
      return { rows: [{ n: 1 }] };
    },
    [RECON_SQL]: {
      rows: [{ code: AGENT_CODE, status: "live", runtime: "inngest", runtime_ref: SOURCE_WORKFLOW }]
    }
  });
  const rows = await gapChecks({
    db,
    orgId: ORG,
    fetchImpl: liveFetch([]),
    baseUrl: "http://pulse.test",
    now: NOW
  });
  const letter = rows[1];
  assert.equal(letter.status, "FAIL");
  assert.match(letter.detail, /1 funding round has open inquiries and no letter draft/);
  assert.match(letter.suggestedFix, /Do not mail a bureau/);
  assert.equal(letterParams[0], ORG);
  assert.deepEqual(letterParams[1], [...LETTER_STATUSES]);
});

test("gap inquiry: specialist desk API 500 fails and never posts a call", async () => {
  const methods = [];
  const fetchImpl = async (url, opts) => {
    methods.push(opts && opts.method);
    const path = String(url);
    if (path.includes("/api/read/inquiry-cases")) return { status: 500, text: async () => "boom" };
    if (path.includes("client-portal")) {
      return { status: 200, text: async () => 'data-kind="inquiry_doc"' };
    }
    return { status: 401, text: async () => "{}" };
  };
  const rows = await gapChecks({
    db: quietDb(),
    orgId: ORG,
    fetchImpl,
    baseUrl: "http://pulse.test",
    now: NOW
  });
  const api = rows[2];
  assert.equal(api.status, "FAIL");
  assert.match(api.detail, /specialist desk API 500/);
  assert.match(api.detail, /\/api\/read\/inquiry-cases 500/);
  assert.match(api.suggestedFix, /Do not place a bureau call/);
  assert.ok(methods.every((method) => method === "GET"));
  assert.equal(methods.includes("POST"), false);
});

test("gap inquiry: upload door is dead when the portal box is missing or the page errors", async () => {
  const missing = async (url) => {
    if (String(url).includes(UPLOAD_DOOR_PATH)) return { status: 200, text: async () => "<html>no door</html>" };
    return { status: 401, text: async () => "{}" };
  };
  const dead = async (url) => {
    if (String(url).includes(UPLOAD_DOOR_PATH)) return { status: 500, text: async () => "" };
    return { status: 200, text: async () => "{}" };
  };
  const ctx = { db: quietDb(), orgId: ORG, baseUrl: "http://pulse.test", now: NOW };
  const gone = await gapChecks({ ...ctx, fetchImpl: missing });
  const crashed = await gapChecks({ ...ctx, fetchImpl: dead });
  assert.equal(gone[3].status, "FAIL");
  assert.match(gone[3].detail, /upload door dead/);
  assert.match(gone[3].detail, /inquiry_doc box missing=true/);
  assert.match(gone[3].suggestedFix, /Do not upload a real ID/);
  assert.equal(crashed[3].status, "FAIL");
  assert.match(crashed[3].detail, /portal 500/);
});

test("gap inquiry: Recon is the one tripwire, and a missing or off AG-07 fails", async () => {
  const liveLetters = { rows: [{ n: 0 }] };
  const missing = await gapChecks({
    db: dbFrom({
      [STUCK_SQL]: liveLetters,
      [LETTER_SQL]: liveLetters,
      [RECON_SQL]: { rows: [] }
    }),
    orgId: ORG,
    now: NOW
  });
  assert.equal(missing[4].id, "recon");
  assert.equal(missing[4].status, "FAIL");
  assert.match(missing[4].detail, /AG-07 is missing/);
  assert.match(missing[4].suggestedFix, /Do not invent a second watchdog/);

  const retired = await gapChecks({
    db: dbFrom({
      [STUCK_SQL]: liveLetters,
      [LETTER_SQL]: liveLetters,
      [RECON_SQL]: {
        rows: [{ code: "AG-07", status: "retired", runtime: "inngest", runtime_ref: "daily-pulse" }]
      }
    }),
    orgId: ORG,
    now: NOW
  });
  assert.equal(retired[4].status, "FAIL");
  assert.match(retired[4].detail, /status=retired/);
  assert.match(retired[4].suggestedFix, /Do not invent a second watchdog/);
});

test("gap inquiry: a thrown read fails that row and does not invent a send", async () => {
  const db = dbFrom({
    [STUCK_SQL]: () => {
      throw new Error("connection refused");
    },
    [LETTER_SQL]: () => {
      throw new Error("letter table missing");
    },
    [RECON_SQL]: () => {
      throw new Error("agents down");
    }
  });
  const rows = await gapChecks({ db, orgId: ORG, now: NOW });
  assert.equal(rows[0].status, "FAIL");
  assert.match(rows[0].detail, /connection refused/);
  assert.equal(rows[1].status, "FAIL");
  assert.match(rows[1].detail, /letter table missing/);
  assert.equal(rows[4].status, "FAIL");
  assert.match(rows[4].detail, /agents down/);
  assert.match(rows[0].suggestedFix, /Do not mail a bureau/);
});

test("gap inquiry: this file does not repeat slice 29 and does not send", () => {
  const src = fs.readFileSync(path.join(HERE, "gap-inquiry.mjs"), "utf8");
  assert.equal(src.includes("slice-29-inquiry-remover"), false);
  assert.equal(src.includes("inquiry-remover.html"), false);
  assert.equal(src.includes('method: "POST"'), false);
  assert.equal(src.includes("method: 'POST'"), false);
  assert.equal(src.includes("documents-upload"), false);
  assert.equal(src.includes("mail-letter"), false);
  assert.equal(src.includes("postgrid"), false);
  for (const id of [
    "c-02-inquiry-created",
    "c-02b-inquiry-removal-requested",
    "inquiry-call-sweeper"
  ]) {
    assert.equal(src.includes(id), false, id);
  }
});
