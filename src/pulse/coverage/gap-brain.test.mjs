import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { EMBEDDING_DIMS } from "../../company-brain/embed.mjs";
import {
  CHECK_IDS,
  ID_AFFILIATE,
  ID_EMBED,
  ID_STAFF,
  PROBE_QUESTION,
  __test,
  gapChecks
} from "./gap-brain.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = fs.readFileSync(path.join(HERE, "gap-brain.mjs"), "utf8");
const ORG = "11111111-1111-4111-8111-111111111111";
/** Looks like a real key, is not one. Only used to prove the check never prints a key. */
const GOOD_KEY = "sk-proj-TESTONLY0123456789abcdefghijklmnopqrstuvwx";
const MASKED_KEY = "****************abcd";

function chunkRow(tier) {
  return {
    chunk_id: "c1",
    content: "x",
    access_tier: tier,
    chunk_index: 0,
    file_id: "f1",
    drive_file_id: "d1",
    file_name: "n",
    web_view_link: null,
    client_id: null,
    mime_type: "text/plain",
    distance: 0.5
  };
}

/** Records every query. The search SQL is the only thing it answers. */
function fakeDb({ staffRows = [], affiliateRows = [], fail = null } = {}) {
  const seen = [];
  const writes = [];
  return {
    seen,
    writes,
    async query(sql, params) {
      const text = String(sql);
      seen.push({ sql: text, params });
      if (!/^\s*select\b/i.test(text)) {
        writes.push(text.slice(0, 60));          // a door that swallows the error still shows up here
        throw new Error(`not a read: ${text.slice(0, 40)}`);
      }
      if (/brain_affiliate_allowlist/.test(text)) {
        if (fail) throw new Error(fail);
        return { rows: affiliateRows };
      }
      if (/FROM brain_chunks/.test(text)) {
        if (fail) throw new Error(fail);
        return { rows: staffRows };
      }
      throw new Error(`unexpected sql: ${text.slice(0, 80)}`);
    }
  };
}

function byId(rows, id) {
  const row = rows.find((r) => r.id === id);
  assert.ok(row, `missing ${id}`);
  return row;
}

function shape(row) {
  assert.deepEqual(Object.keys(row), ["id", "status", "detail", "suggestedFix"]);
  assert.ok(CHECK_IDS.includes(row.id));
  assert.ok(["PASS", "FAIL", "skip"].includes(row.status));
  assert.ok(row.detail.length > 0);
  if (row.status === "FAIL") {
    assert.match(row.suggestedFix, /Recon \(AG-07\) is the one tripwire/);
    assert.match(row.suggestedFix, /Do not run a new Drive sync/);
    assert.match(row.suggestedFix, /Do not upload/);
    assert.doesNotMatch(row.suggestedFix, /second watchdog|new watchdog|second tripwire/i);
  } else {
    assert.equal(row.suggestedFix, null);
  }
}

/** No test may reach the network. Any fetch while a check runs is a failure. */
async function withNoNetwork(fn) {
  const real = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    throw new Error("network is off in this test");
  };
  try {
    const out = await fn();
    assert.equal(calls, 0, "the check reached the network");
    return out;
  } finally {
    globalThis.fetch = real;
  }
}

test("gap brain: does not repeat the Drive sync read or the door ping, and never writes", () => {
  assert.doesNotMatch(SRC, /\b(INSERT|UPDATE|DELETE|DROP)\b/);
  // The Drive reads belong to machine.mjs (meet-transcript-sweeper). Not copied here.
  assert.doesNotMatch(SRC, /FROM\s+brain_drive_sync/i);
  assert.doesNotMatch(SRC, /\blast_sync_at\b[^\n]*\bSELECT\b|SELECT[^\n]*\blast_sync_at\b/i);
  assert.doesNotMatch(SRC, /FROM agents/);
  assert.doesNotMatch(SRC, /syncDriveIncremental/);
  assert.doesNotMatch(SRC, /company-brain\/(upload|sync)/);
  assert.doesNotMatch(SRC, /\bfetch\s*\(/);
  assert.doesNotMatch(SRC, /method:\s*["']POST["']\s*,\s*headers[^}]*accept/);
  assert.doesNotMatch(SRC, /second watchdog|new watchdog|second tripwire/i);
  assert.deepEqual([...CHECK_IDS], ["brain:search-staff", "brain:search-affiliate", "brain:embed-key"]);
  // The key row looks at the env it is handed. It never reaches for the process env or the network.
  assert.doesNotMatch(SRC, /process\.env/);
});

test("gap brain: no database skips both search rows, and with no env the key row skips too", async () => {
  const rows = await withNoNetwork(() => gapChecks({}));
  assert.equal(rows.length, 3);
  rows.forEach(shape);
  assert.deepEqual(rows.map((r) => r.status), ["skip", "skip", "skip"]);
  const noOrg = await gapChecks({ db: fakeDb() });
  assert.deepEqual(noOrg.map((r) => r.status), ["skip", "skip", "skip"]);
  // The key row needs only env: it still answers when there is no database.
  const keyOnly = await gapChecks({ env: { OPENAI_API_KEY: GOOD_KEY } });
  assert.deepEqual(keyOnly.map((r) => r.status), ["skip", "skip", "PASS"]);
});

test("gap brain: the real doors run on the database, with no AI call and no write", async () => {
  const db = fakeDb({ staffRows: [chunkRow("staff")], affiliateRows: [chunkRow("affiliate")] });
  const rows = await withNoNetwork(() => gapChecks({ db, orgId: ORG, env: { OPENAI_API_KEY: GOOD_KEY } }));
  assert.equal(rows.length, 3);
  rows.forEach(shape);
  assert.equal(byId(rows, ID_STAFF).status, "PASS");
  assert.equal(byId(rows, ID_AFFILIATE).status, "PASS");
  assert.equal(byId(rows, ID_EMBED).status, "PASS");
  assert.match(byId(rows, ID_STAFF).detail, /no AI call, nothing saved/);

  // Exactly the two search reads ran, both plain SELECTs. Not one write was even tried.
  assert.deepEqual(db.writes, []);
  assert.equal(db.seen.length, 2);
  const staff = db.seen.find((q) => !/brain_affiliate_allowlist/.test(q.sql));
  const affiliate = db.seen.find((q) => /brain_affiliate_allowlist/.test(q.sql));
  assert.equal(staff.params[0], ORG);
  assert.ok(staff.params[1].includes("owner"));          // the owner role reads every internal tier
  assert.equal(staff.params[1].includes("affiliate"), false);
  assert.equal(staff.params[3], 1);                       // limit 1
  assert.match(staff.params[2], new RegExp(`^\\[1(,0){${EMBEDDING_DIMS - 1}}\\]$`)); // the fixed stub vector
  assert.equal(affiliate.params[0], ORG);
  assert.deepEqual(affiliate.params[1], ["affiliate"]);
  assert.equal(PROBE_QUESTION.length > 0, true);
});

test("gap brain: a crashed search read is a FAIL for each door and names the cause", async () => {
  const db = fakeDb({ fail: 'relation "brain_chunks" does not exist' });
  const rows = await gapChecks({ db, orgId: ORG });
  rows.forEach(shape);
  for (const id of [ID_STAFF, ID_AFFILIATE]) {
    const row = byId(rows, id);
    assert.equal(row.status, "FAIL");
    assert.match(row.detail, /crashed/);
    assert.match(row.detail, /brain_chunks/);
  }
});

test("gap brain: a 500 or an error body from a door is a FAIL, a 200 is not", async () => {
  const ok = { staff: async (req, res) => res.status(200).json({ ok: true }), affiliate: async (req, res) => res.status(200).json({ ok: true }) };
  const clear = await gapChecks({ db: fakeDb(), orgId: ORG, brainDoors: ok });
  assert.deepEqual(clear.map((r) => r.status), ["PASS", "PASS", "skip"]);

  const five = await gapChecks({
    db: fakeDb(),
    orgId: ORG,
    brainDoors: {
      staff: async (req, res) => res.status(500).json({ ok: false, error: "boom" }),
      affiliate: ok.affiliate
    }
  });
  five.forEach(shape);
  assert.equal(byId(five, ID_STAFF).status, "FAIL");
  assert.match(byId(five, ID_STAFF).detail, /answered 500/);
  assert.match(byId(five, ID_STAFF).detail, /boom/);
  assert.equal(byId(five, ID_AFFILIATE).status, "PASS");

  const gate = await gapChecks({
    db: fakeDb(),
    orgId: ORG,
    brainDoors: {
      staff: ok.staff,
      affiliate: async (req, res) => res.status(200).json({ ok: false, error: "weird" })
    }
  });
  assert.equal(byId(gate, ID_AFFILIATE).status, "FAIL");

  const thrown = await gapChecks({
    db: fakeDb(),
    orgId: ORG,
    brainDoors: {
      staff: async () => { throw new Error("handler blew up"); },
      affiliate: ok.affiliate
    }
  });
  assert.equal(byId(thrown, ID_STAFF).status, "FAIL");
  assert.match(byId(thrown, ID_STAFF).detail, /handler blew up/);
});

test("gap brain: the real affiliate door fails when a non-affiliate chunk comes back", async () => {
  const db = fakeDb({ affiliateRows: [chunkRow("staff")] });
  const rows = await gapChecks({ db, orgId: ORG });
  const row = byId(rows, ID_AFFILIATE);
  assert.equal(row.status, "FAIL");
  assert.match(row.detail, /answered 500/);
  assert.match(row.detail, /affiliate_tier_violation/);
  assert.equal(byId(rows, ID_STAFF).status, "PASS");
});

test("gap brain: the search doors still take the injected parts this check swaps out", () => {
  // If a door stops taking one of these, the real-door test above fails first.
  // This pins the names so the reason is obvious.
  const staffDoor = fs.readFileSync(path.join(HERE, "../../../api/read/company-brain.mjs"), "utf8");
  const affiliateDoor = fs.readFileSync(path.join(HERE, "../../../api/read/company-brain-affiliate.mjs"), "utf8");
  for (const name of ["deps.requireAuth", "deps.retrieveChunks", "deps.synthesizeAnswer", "deps.createThread", "deps.appendMessage", "deps.getThread"]) {
    assert.ok(staffDoor.includes(name), name);
  }
  for (const name of ["deps.requirePrincipal", "deps.retrieveAffiliateChunks", "deps.synthesizeAnswer"]) {
    assert.ok(affiliateDoor.includes(name), name);
  }
});

test("gap brain: a missing or masked OpenAI key is a FAIL that names the variable and never prints the key", async () => {
  const probe = async (env) => byId(await withNoNetwork(() => gapChecks({ env })), ID_EMBED);

  const good = await probe({ OPENAI_API_KEY: GOOD_KEY });
  shape(good);
  assert.equal(good.status, "PASS");
  assert.match(good.detail, /OPENAI_API_KEY is set and is not a mask/);
  assert.match(good.detail, /nothing was sent to OpenAI/);
  assert.equal(good.detail.includes(GOOD_KEY), false);

  // The real embed step reads OPENAI_API_KEY first, then COMPANY_BRAIN_OPENAI_API_KEY.
  const spare = await probe({ COMPANY_BRAIN_OPENAI_API_KEY: GOOD_KEY });
  assert.equal(spare.status, "PASS");
  assert.match(spare.detail, /COMPANY_BRAIN_OPENAI_API_KEY is set/);
  const maskFirst = await probe({ OPENAI_API_KEY: MASKED_KEY, COMPANY_BRAIN_OPENAI_API_KEY: GOOD_KEY });
  assert.equal(maskFirst.status, "FAIL", "the real embed step would use the masked OPENAI_API_KEY");

  const masked = await probe({ OPENAI_API_KEY: MASKED_KEY });
  shape(masked);
  assert.equal(masked.status, "FAIL");
  assert.match(masked.detail, /OPENAI_API_KEY is a row of asterisks/);
  assert.match(masked.detail, /502/);
  assert.equal(masked.detail.includes("abcd"), false);
  assert.match(masked.suggestedFix, /Do not unset or delete any stored key/);

  for (const env of [{}, { OPENAI_API_KEY: "" }, { OPENAI_API_KEY: "   " }]) {
    const none = await probe(env);
    shape(none);
    assert.equal(none.status, "FAIL", JSON.stringify(env));
    assert.match(none.detail, /No OpenAI key is set/);
  }

  // Four asterisks in a row is the line: a real key never has them.
  assert.equal((await probe({ OPENAI_API_KEY: "sk-****" })).status, "FAIL");
  assert.equal((await probe({ OPENAI_API_KEY: "sk-***x" })).status, "PASS");
});

test("gap brain: the key row reads the env it is handed, not the process env", async () => {
  const saved = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = GOOD_KEY;
  try {
    const row = byId(await gapChecks({ env: { OPENAI_API_KEY: MASKED_KEY } }), ID_EMBED);
    assert.equal(row.status, "FAIL");
    const none = byId(await gapChecks({}), ID_EMBED);
    assert.equal(none.status, "skip");
  } finally {
    if (saved === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = saved;
  }
});

test("gap brain: the parts swapped into the doors save no chat history and carry no real sign-in", async () => {
  const staff = __test.staffDeps(fakeDb(), ORG);
  for (const name of ["getThread", "createThread", "appendMessage"]) {
    assert.deepEqual(await staff[name](), { ok: false }, name);
  }
  assert.equal((await staff.requireAuth()).id, null);
  assert.equal((await staff.requireAuth()).org_id, ORG);
  assert.deepEqual(await staff.synthesizeAnswer(), { text: "", citations: [], thin: true, source: "pulse-read-check" });
  const affiliate = __test.affiliateDeps(fakeDb(), ORG);
  assert.equal((await affiliate.requirePrincipal()).kind, "affiliate");
  assert.equal((await affiliate.requirePrincipal()).org_id, ORG);
  assert.deepEqual(await affiliate.synthesizeAnswer(), { text: "", citations: [], thin: true, source: "pulse-read-check" });
  assert.equal("createThread" in affiliate, false);
});
