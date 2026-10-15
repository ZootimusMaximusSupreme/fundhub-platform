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
  FIN_B04_PRACTICE_ROWS, FIN_B04_NOT_ATTACHABLE
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
  assert.equal(grace, FIN_B04_RESULT_CONTRACTS.length - 2, "only the send panel row and the deck's Send contract row have no empty-grace");
  const strict = FIN_B04_RESULT_CONTRACTS.filter((c) => c.emptyAs === undefined).map((c) => c.control).sort();
  assert.deepEqual(strict, [
    "'Send contract': picks the agreement that matches the offer, creates the draft, sends it, returns the sign link",
    "Send contract button (opens panel)"
  ]);
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
    const practice = FIN_B04_PRACTICE_ROWS.find((r) => r.control === entry.control);
    if (practice) {
      assert.deepEqual(entry.tests, [practice.test]);
      assert.ok(fs.existsSync(path.join(ROOT, practice.test)), practice.test);
      assert.equal(entry.evidence.includes("gap-catalog-display.mjs"), false, "a practice test row must not claim the live lane");
    } else {
      const row = FIN_B04_ROWS.find((r) => r.control === entry.control);
      assert.deepEqual(entry.tests, [FIN_B04_TEST, ...(row.extraTests || [])]);
      for (const name of entry.tests) assert.ok(entry.evidence.includes(name));
      assert.ok(entry.evidence.includes("src/pulse/coverage/gap-catalog-display.mjs"));
    }
  }
  for (const row of FIN_B04_PRACTICE_ROWS) {
    const map = JSON.parse(fs.readFileSync(path.join(MAP_DIR, row.sourceFile), "utf8"));
    assert.equal(map.filter((r) => r.surface === row.surface && r.control === row.control).length, 1);
    assert.equal(FIN_B04_RESULT_CONTRACTS.some((c) => c.control === row.control), false, "a practice row has no query");
  }
});

test("a control this batch could not make honest carries no query and no case, and its map row still exists", () => {
  assert.equal(FIN_B04_NOT_ATTACHABLE.length, 1);
  for (const row of FIN_B04_NOT_ATTACHABLE) {
    const map = JSON.parse(fs.readFileSync(path.join(MAP_DIR, row.sourceFile), "utf8"));
    assert.equal(map.filter((r) => r.surface === row.surface && r.control === row.control).length, 1,
      `${row.sourceFile} / ${row.surface} / ${row.control}`);
    assert.ok(row.reason.length > 60, "a not-attachable row says exactly why");
    assert.equal(FIN_B04_RESULT_CONTRACTS.some((c) => c.control === row.control), false, `${row.control} must have no query`);
    assert.equal(FIN_B04_DISPLAY_PROOF_CASES.some((c) => c.control === row.control), false, `${row.control} must have no case`);
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

test("the quiet window is 8 pm to 8 am Arizona, as the held-text query says", async () => {
  const gate = await import("../../../messaging/gate.mjs");
  const messages = await import("./fin-b04-sql-messages.mjs");
  assert.equal(gate.QUIET_END_HOUR, 8);
  assert.equal(gate.QUIET_START_HOUR, 20);
  assert.equal(messages.QUIET_END_HOUR, gate.QUIET_END_HOUR);
  assert.equal(messages.QUIET_START_HOUR, gate.QUIET_START_HOUR);
  assert.equal(gate.QUIET_HOURS_TZ, "America/Phoenix");
  assert.deepEqual([...gate.QUIET_HOURS_CHANNELS], ["sms"]);
  assert.match(SQL_BY_KEY.get("message-held"), /'America\/Phoenix'.*'HH24:MI:SS'\) <> '08:00:00'/s);
  // a hold is never longer than the window itself: 8 pm to 8 am is 12 hours
  assert.equal(gate.QUIET_END_HOUR + 24 - gate.QUIET_START_HOUR, 12);
  assert.match(SQL_BY_KEY.get("message-held"), /m\.last_attempt_at \+ interval '12 hours'/);
});

test("the product's own hold is the next 8 am Arizona and never more than 12 hours on (the bound the held query reads)", async () => {
  const { nextQuietHoursEnd } = await import("../../../messaging/dispatch.mjs");
  const phoenix = (d) => new Intl.DateTimeFormat("en-GB", {
    timeZone: "America/Phoenix", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false
  }).format(d);
  // every kind of moment inside the window, 8 pm through 7:59:59 am
  for (const from of [
    "2026-10-15T03:00:00.000Z", "2026-10-15T04:30:00.000Z", "2026-10-15T08:00:00.000Z",
    "2026-10-15T14:59:59.000Z", "2026-10-14T07:00:00.000Z", "2026-12-31T06:00:00.000Z"
  ]) {
    const start = new Date(from);
    const due = nextQuietHoursEnd(start);
    assert.equal(phoenix(due), "08:00:00", `${from}: the hold is not 8:00 am Arizona`);
    assert.ok(due > start, `${from}: the hold is not after the moment it was held`);
    assert.ok(due - start <= 12 * 3600 * 1000, `${from}: the hold is longer than the 12 hours the query allows`);
  }
});

test("the task roles the blocked query accepts are the roles a task can be given", async () => {
  const messages = await import("./fin-b04-sql-messages.mjs");
  const { TASK_ROLES } = await import("../../../lib/create-task.mjs");
  assert.deepEqual([...messages.TASK_ASSIGNEE_ROLES].sort(), [...TASK_ROLES].sort());
});

test("the figures the contract queries compare to are the catalogue's own", async () => {
  const flows = await import("./fin-b04-sql-flows.mjs");
  const offers = await import("../../../config/offers.mjs");
  for (const key of flows.SALE_CONTRACT_KEYS) {
    assert.deepEqual(flows.CONTRACT_DEFAULTS[key], offers.defaultContractValues({ templateKey: key }), key);
  }
  // every offer that names a wording is a wording a sale may send, and the combined one is by tier
  for (const o of Object.values(offers.OFFERS)) {
    if (o.contractTemplateKey) assert.ok(flows.SALE_CONTRACT_KEYS.includes(o.contractTemplateKey), o.key);
  }
  assert.ok(flows.SALE_CONTRACT_KEYS.includes(offers.resolveContractTemplateKey({ offerKey: null, tier: "FUNDING_PLUS_REPAIR" })));
  // the deck picks one wording per offer except the soft-pull consent, which has its own button
  assert.ok(!flows.DECK_CONTRACT_KEYS.includes("SOFT-PULL-CONSENT"));
  assert.equal(flows.DECK_CONTRACT_KEYS.length, flows.SALE_CONTRACT_KEYS.length - 1);
  // no dollar sign next to a digit anywhere in a saved query: that shape reads as a bind parameter
  for (const [key, sql] of SQL_BY_KEY) assert.doesNotMatch(sql, /\$[2-9]/, `${key} has a $N inside its text`);
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
  // the claim that sends a text stamps last_attempt_at; the deferral keeps it
  const dispatch = read("src/messaging/dispatch.mjs");
  assert.match(dispatch, /SET status = 'sending', last_attempt_at = now\(\), attempts = m\.attempts \+ 1/);
  assert.match(dispatch, /SET status = 'queued', scheduled_at = \$2, attempts = GREATEST\(attempts - 1, 0\)/);
  assert.doesNotMatch(dispatch.slice(dispatch.indexOf("SET status = 'queued', scheduled_at = $2"), dispatch.indexOf("SET status = 'queued', scheduled_at = $2") + 120),
    /last_attempt_at/, "the deferral must not move the claim time the hold length is read from");
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
  assert.match(social, /const APPROVAL_ROLES = new Set\(\["owner", "admin"\]\)/);
  assert.match(social, /SET status = 'queued',\s*scheduled_for = COALESCE\(\$2::timestamptz, scheduled_for\),/);
  assert.match(read("src/social/scheduler.mjs"), /AND p\.scheduled_for <= COALESCE\(\$2::timestamptz, now\(\)\)/);
  // a card is moved first and a lost emit is kept (the round queries start from the cards)
  const cards = read("src/workflows/cards.mjs");
  assert.match(cards, /UPDATE cards SET stage_id = \$2 WHERE id = \$1/);
  assert.match(cards, /never undo the move for an emit failure/);
  // the shift gate is on every staff send route, owner exempt
  assert.match(read("api/messages.mjs"), /requireActiveShift\(req, res, \{ db, principal, exempt: SUPER_ROLES \}\)/);
  assert.match(read("api/chat/messages.mjs"), /requireActiveShift\(req, res, \{\s*db, principal, exempt: SUPER_ROLES\s*\}\)/);
  // the unlock modal hands the client "I would like a call about: <topic>"
  assert.match(read("src/handlers/client-lifecycle.mjs"), /return \{ firstName: parts\[0\], lastName: null \}/);
});
