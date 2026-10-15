// Batch 04 live checks. These are practice tests of the checks themselves: the
// real SQL text runs over fake saved rows (fin-b04-sql-lite.mjs), a healthy set
// must be counted clean, and each single break must be counted as exactly one bad
// result. The live check on the server reads real rows; this proves the SQL it
// runs is wrong when the saved result is wrong, and right when it is right.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { dropOneCondition, parseContract, readColumnCatalog, runContractSql, runParsed } from "./fin-b04-sql-lite.mjs";
import { CASES, NOW, ORG, otherCompany, together } from "./fin-b04-display-fixtures.mjs";
import {
  FIN_B04_RESULT_CONTRACTS, FIN_B04_ROWS, FIN_B04_DISPLAY_PROOF_CASES, FIN_B04_TEST,
  FIN_B04_PRACTICE_ROWS, FIN_B04_COCKPIT_TEST
} from "./fin-b04-display-results.mjs";
import { judgeDisplayResult } from "../../coverage/gap-catalog-display.mjs";
import { STAFF_UI_PROOF_CASES } from "./display-batch-staff-ui.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../../../..");
const MAP_DIR = path.join(ROOT, "ops/workflows/coverage-every-surface-2026-10-10");
const CATALOG = readColumnCatalog(ROOT);
const clone = (v) => JSON.parse(JSON.stringify(v));

function judge(sql, tables) {
  const out = runContractSql(sql, { tables, params: [ORG], now: NOW, catalog: CATALOG });
  return { sample: out.sample_count, bad: out.bad_count };
}

const SQL_BY_KEY = new Map(FIN_B04_RESULT_CONTRACTS.map((c) => [/display-result:([^\s*]+)/.exec(c.sql)[1], c.sql]));

test("every query has a case file and every case has a query", () => {
  const caseKeys = CASES.map((c) => c.key).sort();
  assert.deepEqual(caseKeys, [...SQL_BY_KEY.keys()].sort());
  for (const c of CASES) {
    assert.equal(c.sql.trim(), SQL_BY_KEY.get(c.key).replace(/^\/\*[^*]*\*\/\s*/, "").trim(),
      `${c.key}: the case runs different SQL from the contract`);
  }
});

for (const c of CASES) {
  const sql = SQL_BY_KEY.get(c.key);

  test(`${c.key}: a healthy set is counted and none is bad`, () => {
    assert.deepEqual(judge(sql, c.good()), { sample: c.sample, bad: 0 });
  });

  test(`${c.key}: the same rows in another company are never counted`, () => {
    const healthy = c.good();
    assert.deepEqual(judge(sql, together(healthy, otherCompany(healthy))), { sample: c.sample, bad: 0 });
    for (const [label, fn] of c.breaks) {
      const broken = c.good();
      fn(broken);
      const mixed = together(c.good(), otherCompany(broken));
      assert.deepEqual(judge(sql, mixed), { sample: c.sample, bad: 0 }, `another company's broken row counted: ${label}`);
    }
  });

  for (const [label, fn, want] of c.breaks) {
    test(`${c.key}: BAD when ${label}`, () => {
      const tables = c.good();
      fn(tables);
      const expected = want || { sample: c.sample, bad: 1 };
      assert.deepEqual(judge(sql, tables), expected);
    });
  }

  for (const [label, fn, want] of c.ok) {
    test(`${c.key}: fine when ${label}`, () => {
      const tables = c.good();
      fn(tables);
      assert.deepEqual(judge(sql, tables), want || { sample: c.sample, bad: 0 });
    });
  }

  for (const [label, fn] of c.ignored) {
    test(`${c.key}: not counted when ${label}`, () => {
      const tables = c.good();
      fn(tables);
      assert.deepEqual(judge(sql, tables), { sample: 0, bad: 0 });
    });
  }
}

test("a query that loses its company condition counts another company's row", () => {
  // The check that the other-company fixtures can fail: take the condition out
  // of one query and the foreign row is counted, so the test above would go red.
  const c = CASES.find((x) => x.key === "portal-message");
  const sql = SQL_BY_KEY.get("portal-message").replace("m.org_id = $1::uuid AND ", "");
  const tables = together(c.good(), otherCompany(c.good()));
  assert.equal(judge(sql, tables).sample, 2);
  assert.equal(judge(SQL_BY_KEY.get("portal-message"), tables).sample, 1);
});

test("a query that loses one bad-result condition stops catching that break", () => {
  const c = CASES.find((x) => x.key === "message-held");
  const weak = SQL_BY_KEY.get("message-held")
    .replace("OR to_char(m.scheduled_at AT TIME ZONE 'America/Phoenix', 'HH24:MI:SS') <> '08:00:00'\n", "\n");
  const tables = c.good();
  tables.messages[0].scheduled_at = "2026-10-14T16:00:00.000Z";
  assert.deepEqual(judge(weak, tables), { sample: 1, bad: 0 });
  assert.deepEqual(judge(SQL_BY_KEY.get("message-held"), tables), { sample: 1, bad: 1 });
});

// ── every condition in every query is held up by a test above ───────────────

function everyVariant(c) {
  const list = [c.good(), together(c.good(), otherCompany(c.good()))];
  for (const group of [c.breaks, c.ok, c.ignored]) {
    for (const [, fn] of group) { const t = c.good(); fn(t); list.push(t); }
  }
  return list;
}

for (const c of CASES) {
  test(`${c.key}: dropping any one condition changes the answer for some test row`, () => {
    const tree = parseContract(SQL_BY_KEY.get(c.key));
    const variants = everyVariant(c);
    const answer = (t, tables) => {
      const out = runParsed(t, { tables, params: [ORG], now: NOW, catalog: CATALOG });
      return `${out.sample_count}/${out.bad_count}`;
    };
    const baseline = variants.map((tables) => answer(tree, tables));
    const unproven = [];
    for (const mutation of dropOneCondition(tree)) {
      const changed = variants.some((tables, i) => answer(mutation.tree, tables) !== baseline[i]);
      if (!changed) unproven.push(mutation.label);
    }
    assert.deepEqual(unproven, [], `conditions no test row can tell from their absence:\n  ${unproven.join("\n  ")}`);
  });
}

// ── hygiene of the saved contracts ──────────────────────────────────────────

test("every contract is a read-only, company-scoped query with the two counts", () => {
  assert.equal(FIN_B04_RESULT_CONTRACTS.length, FIN_B04_ROWS.length);
  for (const contract of FIN_B04_RESULT_CONTRACTS) {
    assert.equal(contract.mode, "query");
    assert.ok(contract.requirement.length > 40, contract.control);
    assert.match(contract.sql, /^\/\* display-result:[a-z-]+ \*\//);
    assert.match(contract.sql, /sample_count/);
    assert.match(contract.sql, /bad_count/);
    assert.match(contract.sql, /\$1::uuid/);
    assert.doesNotMatch(contract.sql, /\b(?:INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE|CREATE)\b/i);
    assert.doesNotMatch(contract.sql, /\$2/);
  }
  const grace = FIN_B04_RESULT_CONTRACTS.filter((c) => c.emptyAs === "quiet").length;
  assert.equal(grace, FIN_B04_RESULT_CONTRACTS.length - 1, "only the send panel row has no empty-grace");
  const strict = FIN_B04_RESULT_CONTRACTS.find((c) => c.emptyAs === undefined);
  assert.equal(strict.control, "Send contract button (opens panel)");
});

test("every contract names its control exactly as the coverage map does", () => {
  const seen = new Set();
  for (const row of FIN_B04_ROWS) {
    const map = JSON.parse(fs.readFileSync(path.join(MAP_DIR, row.sourceFile), "utf8"));
    const hits = map.filter((r) => r.surface === row.surface && r.control === row.control);
    assert.equal(hits.length, 1, `${row.sourceFile} / ${row.surface} / ${row.control}`);
    assert.equal(hits[0].impact, "customerMessage", "the lane only judges money, data and message controls deeply");
    assert.equal(seen.has(row.control), false, `duplicate control ${row.control}`);
    seen.add(row.control);
  }
  // Rows a browser spec already presses keep that evidence; the rest are listed here.
  const staffKeys = new Set(STAFF_UI_PROOF_CASES.map((e) => `${e.sourceFile}\0${e.surface}\0${e.control}`));
  for (const row of FIN_B04_ROWS) {
    const inStaffUi = staffKeys.has(`${row.sourceFile}\0${row.surface}\0${row.control}`);
    assert.equal(!!row.viaStaffUi, inStaffUi, `${row.control}: viaStaffUi must match display-batch-staff-ui.mjs`);
  }
  const practice = FIN_B04_PRACTICE_ROWS.length;
  assert.equal(FIN_B04_DISPLAY_PROOF_CASES.length, FIN_B04_ROWS.filter((r) => !r.viaStaffUi).length + practice);
  for (const entry of FIN_B04_DISPLAY_PROOF_CASES) {
    const cockpit = FIN_B04_PRACTICE_ROWS.some((r) => r.control === entry.control);
    if (cockpit) {
      assert.deepEqual(entry.tests, [FIN_B04_COCKPIT_TEST]);
      assert.equal(entry.evidence.includes("gap-catalog-display.mjs"), false, "a practice test row must not claim the live lane");
    } else {
      assert.deepEqual(entry.tests, [FIN_B04_TEST]);
      assert.ok(entry.evidence.includes(FIN_B04_TEST));
      assert.ok(entry.evidence.includes("src/pulse/coverage/gap-catalog-display.mjs"));
    }
  }
  for (const row of FIN_B04_PRACTICE_ROWS) {
    const map = JSON.parse(fs.readFileSync(path.join(MAP_DIR, row.sourceFile), "utf8"));
    assert.equal(map.filter((r) => r.surface === row.surface && r.control === row.control).length, 1);
    assert.equal(FIN_B04_RESULT_CONTRACTS.some((c) => c.control === row.control), false, "a practice row has no query");
  }
});

test("a control with no results yet is green, and the send panel with no wording is red", () => {
  for (const contract of FIN_B04_RESULT_CONTRACTS) {
    const entry = { id: "x", surface: "s", control: contract.control, contract };
    const empty = judgeDisplayResult(entry, { sample_count: 0, bad_count: 0 });
    if (contract.emptyAs === "quiet") assert.equal(empty.status, "PASS", contract.control);
    else assert.equal(empty.status, "FAIL", contract.control);
    assert.equal(judgeDisplayResult(entry, { sample_count: 3, bad_count: 1 }).status, "FAIL", contract.control);
    assert.equal(judgeDisplayResult(entry, { sample_count: 3, bad_count: 0 }).status, "PASS", contract.control);
  }
});

// ── the writers still write what the queries read ───────────────────────────

const read = (file) => fs.readFileSync(path.join(ROOT, file), "utf8");

test("only the dispatcher ever sets messages.scheduled_at", () => {
  // MESSAGE_HELD reads scheduled_at as "held for quiet hours". That holds only
  // while dispatch.mjs is the one writer. A second writer must be judged too.
  const writers = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
      const rel = `${dir}/${entry.name}`;
      if (entry.isDirectory()) {
        if (["node_modules", "pulse", "verification", "demo"].includes(entry.name)) continue;
        walk(rel);
      } else if (rel.endsWith(".mjs") && !/\.test\.mjs$/.test(rel)) {
        const text = read(rel);
        if (/(?:UPDATE\s+messages[^;`]{0,600}scheduled_at\s*=|INSERT\s+INTO\s+messages\s*\([^)]*scheduled_at)/i.test(text)) writers.push(rel);
      }
    }
  };
  for (const dir of ["src", "api", "netlify"]) walk(dir);
  assert.deepEqual(writers, ["src/messaging/dispatch.mjs"]);
});

test("the shift exemption is the owner alone, and the gate's clearing codes are the four the query lists", async () => {
  const { SUPER_ROLES } = await import("../../../http/middleware/requireRole.mjs");
  assert.deepEqual([...SUPER_ROLES], ["owner"]);
  const gate = read("src/messaging/gate.mjs");
  const clearing = new Set();
  for (const m of gate.matchAll(/\br\(\s*"([a-z_]+)"\s*,\s*"(consent|tcpa|engine)"/g)) clearing.add(m[1]);
  if (/code:\s*"gate_error"/.test(gate)) clearing.add("gate_error");
  assert.deepEqual([...clearing].sort(), ["gate_error", "opted_out", "quiet_hours", "recipient_unknown"]);
  assert.match(SQL_BY_KEY.get("message-blocked"), /\(opted_out\|quiet_hours\|recipient_unknown\|gate_error\)/);
  assert.match(gate, /export const GATE_SOURCE = "messaging-gate"/);
});

test("the quiet window is 8 am Arizona, as the held-text query says", async () => {
  const gate = await import("../../../messaging/gate.mjs");
  assert.equal(gate.QUIET_END_HOUR, 8);
  assert.equal(gate.QUIET_HOURS_TZ, "America/Phoenix");
  assert.deepEqual([...gate.QUIET_HOURS_CHANNELS], ["sms"]);
  assert.match(SQL_BY_KEY.get("message-held"), /'America\/Phoenix'.*'HH24:MI:SS'\) <> '08:00:00'/s);
});

test("the portal note and the staff send are written the way the queries read them", () => {
  const portal = read("api/chat/portal-message.mjs");
  assert.match(portal, /'inbound', \$4, \$5, 'received', true, 'client'/);
  const clientPage = read("public/app/client-portal.html");
  assert.match(clientPage, /'I would like a call about: ' \+ about/);
  const compose = read("src/messaging/compose.mjs");
  assert.match(compose, /'outbound',\$4,\$5,\$6,'queued',false,\$7,\$8,\$9,'staff',\$10/);
  assert.match(compose, /kind: "text_sent"/);
  assert.match(compose, /target\.channel === "sms" && result\.outcome === OUTCOME\.SENT/);
  const internal = read("src/chat/internal.mjs");
  assert.match(internal, /'outbound', 'internal',[\s\S]{0,80}'delivered', true,[\s\S]{0,60}'staff'/);
});

test("the round, contract, letter, pipeline and social writers match what the queries read", async () => {
  const rounds = read("src/funding/card-stacking-rounds.mjs");
  assert.match(rounds, /idempotencyKey = `card_stacking:\$\{clientId\}:\$\{rn\}:\$\{stageKey\}:\$\{eventName\}`/);
  assert.match(rounds, /rail: "card_stacking",\s*source: "card_stacking",\s*product: PRODUCT,\s*roundNumber,/);
  const { STAGE_TO_EVENT } = await import("../../../funding/card-stacking-rounds.mjs");
  assert.equal(STAGE_TO_EVENT.apply_now, "round.started");
  assert.equal(STAGE_TO_EVENT.round_submitted, "round.submitted");
  assert.equal(STAGE_TO_EVENT.approved, "round.approved");
  assert.equal(STAGE_TO_EVENT.closed, "round.closeout");

  const keys = {
    "SMS-ROUND-STARTED-NOTIFY": ["round-started-client-notify.mjs", "SMS_TEMPLATE_KEY"],
    "SMS-F03-ROUND-SUBMITTED": ["f-03-round-submitted.mjs", "SMS_TEMPLATE_KEY"],
    "EMAIL-F03-ROUND-SUBMITTED": ["f-03-round-submitted.mjs", "EMAIL_TEMPLATE_KEY"],
    "SMS-F04-ROUND-APPROVALS": ["f-04-round-approvals.mjs", "SMS_TEMPLATE_KEY"],
    "EMAIL-F04-ROUND-APPROVALS": ["f-04-round-approvals.mjs", "EMAIL_TEMPLATE_KEY"],
    "SMS-N04-POST-FUNDING": ["n-04-post-funding-nurture.mjs", "SMS_TEMPLATE_KEY"],
    "EMAIL-N04-POST-FUNDING": ["n-04-post-funding-nurture.mjs", "EMAIL_TEMPLATE_KEY"],
    "SMS-S00-WELCOME": ["s-00-welcome.mjs", "SMS_TEMPLATE_KEY"],
    "EMAIL-S00-WELCOME": ["s-00-welcome.mjs", "EMAIL_TEMPLATE_KEY"]
  };
  for (const [key, [file, name]] of Object.entries(keys)) {
    assert.match(read(`src/workflows/${file}`), new RegExp(`export const ${name} = "${key}"`), `${file} ${name}`);
  }
  const messaging = read("src/workflows/messaging.mjs");
  assert.match(messaging, /const providerRef = `workflow:\$\{templateKey\}:\$\{eventId\}`/);
  assert.match(read("src/workflows/f-03-round-submitted.mjs"), /const eventId = event\.id/);

  assert.match(read("src/contracts/notify.mjs"), /`contract:\$\{contract\.id\}:\$\{signer\.id\}:\$\{purpose\}`/);
  const closerDeck = read("src/sales/closer-deck.mjs");
  assert.match(closerDeck, /sourceEventId: `closer-deck-letters:\$\{clientId\}:\$\{offerKey\}`/);
  assert.match(closerDeck, /sourceEventId: `closer-deck-deliverables:\$\{clientId\}:\$\{offerKey\}`/);
  assert.match(closerDeck, /eventId: `closer-deck-letters:\$\{clientId\}:\$\{offerKey\}`/);
  assert.match(closerDeck, /generatedBy: "closer-deck"/);
  // the deck's pay-link and soft-pull texts are sent through composeAndSend with no
  // shift, under these two idempotency prefixes (the shift rule leaves them out)
  assert.match(closerDeck, /idempotencyKey: `pay-link-sms:\$\{link\.id\}`/);
  assert.match(closerDeck, /idempotencyKey: `soft-pull-sms:\$\{link\.id\}`/);
  assert.doesNotMatch(closerDeck, /shiftId/);
  assert.match(read("src/messaging/compose.mjs"), /const providerRef = idempotencyKey \? `staff:\$\{idempotencyKey\}` : null;/);
  const flows = await import("./fin-b04-sql-flows.mjs");
  const ds02 = await import("../../../workflows/ds-02-diy-letters.mjs");
  const u02 = await import("../../../workflows/u-02-analyzer-complete-delivery.mjs");
  assert.equal(flows.LETTERS_EMAIL_KEY, ds02.EMAIL_TEMPLATE_KEY);
  assert.equal(flows.DELIVERABLES_EMAIL_KEY, u02.FUNDING_EMAIL_TEMPLATE_KEY);
  const underwrite = await import("../../coverage/gap-underwrite.mjs");
  assert.deepEqual([...flows.CORE_PACK_SUBTYPES], [...underwrite.PACK_SUBTYPES]);

  const pipeline = read("api/pipeline-clients.mjs");
  assert.match(pipeline, /idempotencyKey: `pipeline-client:\$\{orgId\}:\$\{parsed\.email\}`/);
  assert.match(pipeline, /source: "pipeline"/);
  const social = read("api/social/posts.mjs");
  assert.match(social, /SET approved_at = now\(\), approved_by = \$2, status = 'queued'/);
  assert.match(social, /SET status = 'scheduled', updated_at = now\(\)/);
  assert.match(read("src/social/scheduler.mjs"), /taskKey: "social_post_failed"/);
  assert.match(read("src/push/store.mjs"), /revoked_at = now\(\), updated_at = now\(\)/);
});
