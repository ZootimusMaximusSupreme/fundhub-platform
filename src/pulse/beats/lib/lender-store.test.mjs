// The lender readers the hourly beat lender-book runs are copies (lib/lender-store.mjs, lib/lender-match.mjs,
// lib/lender-tables.mjs) of src/lenders/store.mjs and what it calls. This test holds each copy equal to its
// original two ways: it reads the original files and fails on any difference in text, and it runs the real
// readers and the copies on the same rows (many shapes: no client, demo mode, sandbox and sample credit
// files, string JSON, a broken identity row, a read that throws) and fails on any difference in what they
// read or what they answer. So the morning lane and the hourly beat cannot drift apart.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import * as copyStore from "./lender-store.mjs";
import * as copyMatch from "./lender-match.mjs";
import * as copyTables from "./lender-tables.mjs";
import * as realStore from "../../../lenders/store.mjs";
import * as realMatch from "../../../lenders/match.mjs";
import * as realTables from "../../../lenders/tables.mjs";
import { orgDemoModeEnabled as realDemo } from "../../../demo/exclude-demo.mjs";
import { LENDER_LOGO_PLACEHOLDER as REAL_PLACEHOLDER, logoPathOrPlaceholder as realLogo } from "../../../lenders/resolve-logo.mjs";
import { pickCreditScore as realPickScore } from "../../../finance/crs-map.mjs";
import { UTILISATION_BANDS as REAL_BANDS, isSampleResult as realIsSample, triMerge as realTriMerge, utilisation as realUtil } from "../../../http/client-detail.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../../../..");
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const MARKER = "// ---- everything below this line is the original file, word for word ----\n";

/* ---------------- text: word for word ---------------- */

function afterMarker(text, name) {
  const at = text.indexOf(MARKER);
  assert.ok(at >= 0, `${name} has lost its marker line`);
  return text.slice(at + MARKER.length);
}

test("lender-tables.mjs is src/lenders/tables.mjs word for word", () => {
  const copy = afterMarker(read("src/pulse/beats/lib/lender-tables.mjs"), "lender-tables.mjs");
  assert.equal(copy, read("src/lenders/tables.mjs"), "src/lenders/tables.mjs changed: paste it in again below the marker line of lib/lender-tables.mjs");
});

test("lender-match.mjs is src/lenders/match.mjs word for word, except its one import", () => {
  const copy = afterMarker(read("src/pulse/beats/lib/lender-match.mjs"), "lender-match.mjs");
  const imports = copy.split("\n").filter((line) => /^\s*import\b/.test(line));
  assert.deepEqual(imports, ['import { isBusinessLenderTable } from "./lender-tables.mjs";']);
  assert.equal(
    copy.replace('from "./lender-tables.mjs";', 'from "./tables.mjs";'),
    read("src/lenders/match.mjs"),
    "src/lenders/match.mjs changed: paste it in again below the marker line of lib/lender-match.mjs (import ./lender-tables.mjs)"
  );
});

/** Each block lib/lender-store.mjs holds, by the file it was copied from. */
const HELD = Object.freeze([
  ["src/demo/exclude-demo.mjs", ["orgDemoModeEnabled"]],
  ["src/lenders/resolve-logo.mjs", ["LENDER_LOGO_PLACEHOLDER", "logoPathOrPlaceholder"]],
  ["src/finance/crs-map.mjs", ["asArray", "asInt", "pickCreditScore"]],
  ["src/http/client-detail.mjs", [
    "FICO_MIN", "FICO_MAX", "FICO_MODEL", "ficoOf", "scoresFromResult", "ficoFromBureau", "isSampleResult",
    "triMerge", "latestWithScores", "byNewest", "safeObject", "num", "UTILISATION_BANDS", "utilisation"
  ]],
  ["src/lenders/store.mjs", ["SELECT_COLS", "MAX_LENDER_ROWS", "publicLender", "listLenders", "matchForClient", "safeResult"]]
]);

/** A top-level declaration's text, from its first line to its closing line, with any "export " dropped. */
function block(text, name) {
  const lines = text.split("\n");
  const start = new RegExp(`^(?:export\\s+)?(?:async\\s+)?(?:function\\s+${name}\\s*\\(|const\\s+${name}\\s*=)`);
  const i = lines.findIndex((line) => start.test(line));
  if (i < 0) return null;
  if (/;\s*$/.test(lines[i])) return lines[i].replace(/^export\s+/, "");
  for (let j = i + 1; j < lines.length; j += 1) {
    if (/^(?:\}|\};|\];|`;)\s*$/.test(lines[j])) return lines.slice(i, j + 1).join("\n").replace(/^export\s+/, "");
  }
  return null;
}

test("lender-store.mjs: every block is its original's text, unchanged", () => {
  const copy = read("src/pulse/beats/lib/lender-store.mjs");
  for (const [file, names] of HELD) {
    const original = read(file);
    for (const name of names) {
      const want = block(original, name);
      assert.ok(want, `${name} is no longer a top-level declaration in ${file}`);
      assert.equal(block(copy, name), want, `${name} in ${file} changed: copy its block into lib/lender-store.mjs again`);
    }
  }
});

test("lender-store.mjs holds nothing but those blocks, its two imports and comments", () => {
  let rest = read("src/pulse/beats/lib/lender-store.mjs");
  for (const [, names] of HELD) {
    for (const name of names) {
      const text = block(rest, name);
      assert.ok(text, `${name} is missing from lib/lender-store.mjs`);
      rest = rest.replace(`export ${text}`, "").replace(text, "");
    }
  }
  const left = rest.split("\n").filter((line) => line.trim() && !/^\s*\/\//.test(line));
  assert.deepEqual(left, [
    'import { matchLenders, resolveMatchStates, resolveCreditProfile } from "./lender-match.mjs";',
    'import { isLenderTable } from "./lender-tables.mjs";'
  ]);
});

test("the copied modules export what the originals export", () => {
  assert.deepEqual(Object.keys(copyMatch).sort(), Object.keys(realMatch).sort());
  assert.deepEqual(Object.keys(copyTables).sort(), Object.keys(realTables).sort());
  for (const key of Object.keys(realTables)) {
    const real = realTables[key];
    if (typeof real === "function") continue;
    assert.deepEqual(real instanceof Set ? [...copyTables[key]] : copyTables[key], real instanceof Set ? [...real] : real, key);
  }
  assert.equal(copyStore.LENDER_LOGO_PLACEHOLDER, REAL_PLACEHOLDER);
  assert.deepEqual(copyStore.UTILISATION_BANDS, REAL_BANDS);
});

/* ---------------- behaviour: same rows in, same answer out ---------------- */

/** The answer, or the error's type and message, so a throw is compared like a value. */
async function outcome(fn) {
  try {
    return { value: await fn() };
  } catch (err) {
    return { error: `${err && err.name}: ${err && err.message}` };
  }
}

const ORG = "11111111-1111-4111-8111-111111111111";
const CLIENT = "22222222-2222-4222-8222-222222222222";
const DAY = 86400000;
const ago = (days) => new Date(Date.now() - days * DAY).toISOString();

const BANKS = Object.freeze([
  { id: "b01", org_id: ORG, lender_table: "OnlineBizCC", name: "Alpha Biz", eligible_states: "All", bureaus_pulled: "Experian", priority_tier: "1", active: true, is_demo: false, typical_approval_range: "25000", logo_path: "/assets/lenders/a.png" },
  { id: "b02", org_id: ORG, lender_table: "InBranchBizCC", name: "Beta Branch", eligible_states: "AZ, NM", bureaus_pulled: "Equifax", priority_tier: 2, active: true, is_demo: false, logo_path: null },
  { id: "b03", org_id: ORG, lender_table: "BizLOC_Stated", name: "Gamma LOC", eligible_states: "FL", bureaus_pulled: "TransUnion, Experian", double_pull: true, priority_tier: 3, active: true, is_demo: false, stated_requirements: "Minimum 700 FICO score" },
  { id: "b04", org_id: ORG, lender_table: "BizLOC_Documented", name: "Delta Docs", eligible_states: null, bureaus_pulled: "EX/EQ/TU", active: true, is_demo: false, stated_requirements: "2+ years business age" },
  { id: "b05", org_id: ORG, lender_table: "PersonalCC", name: "Echo Card", eligible_states: "*", bureaus_pulled: "TU", active: true, is_demo: false, logo_path: "  " },
  { id: "b06", org_id: ORG, lender_table: "PersonalLoans", name: "Foxtrot Loans", eligible_states: "TX, CA", bureaus_pulled: null, active: true, is_demo: false, stated_requirements: "credit score of at least 680 required" },
  { id: "b07", org_id: ORG, lender_table: "PersonalLOC", name: "Golf Line", eligible_states: "all states", bureaus_pulled: "Experian", active: true, is_demo: true },
  { id: "b08", org_id: ORG, lender_table: "PersonalCC", name: "DEMO Hotel", eligible_states: "AZ", bureaus_pulled: "Equifax", active: true, is_demo: true },
  { id: "b09", org_id: ORG, lender_table: "OnlineBizCC", name: "India Biz", eligible_states: "Nationwide", bureaus_pulled: "Equifax, TransUnion", active: true, is_demo: false, max_known_loc: "150000.00", minimum_deposit: "0" },
  { id: "b10", org_id: ORG, lender_table: "PersonalCC", name: "Juliet", eligible_states: "", bureaus_pulled: "experian", active: false, is_demo: false, notes: "score requirement not stated" }
]);

const FIELDS = [
  {},
  { state: "AZ", total_funding_estimate: 75000, utilization: 18 },
  { home_state: "TX", business_state: "FL" },
  { mailing_state: "fl", utilization: "62" },
  null,
  { business_state: "NM", total_funding_estimate: "40000" }
];
const BUSINESSES = [[], [{ entity_data: { state: "FL" } }], [{ entity_data: null }, { entity_data: { business_state: "AZ" } }]];
const IDENTITY = [
  [],
  [{ addresses: [{ state: "NM" }] }],
  [{ addresses: JSON.stringify([{ addressState: "AZ" }]) }],
  new Error('column "addresses" does not exist'),
  [{ addresses: "not json" }]
];
const FICO9 = (value) => ({ modelName: "FICO Score 9", scoreValue: String(value), scoreMaximumValue: "850" });
const CRS = [
  [],
  [{ result: { scores: { ex: 712, eq: 698, tu: 705 }, utilization: 22, fundingEstimate: 90000 }, outcome_tier: "T2", created_at: ago(3) }],
  [
    { result: { environment: "sandbox", scores: { ex: 800 } }, outcome_tier: "T1", created_at: ago(1) },
    { result: JSON.stringify({ scores: { experian: 640 }, scoreModels: { experian: "FICO 8" } }), outcome_tier: "T3", created_at: ago(20) }
  ],
  [{ result: { bureaus: { EX: { scores: [{ modelName: "Income Insight", scoreValue: "47 B", scoreMaximumValue: null }, FICO9(731)] }, TU: { scores: [FICO9(690), FICO9(690)] }, EQ: { scores: [{ modelName: "", scoreValue: "702", scoreMaximumValue: "850" }] } } }, outcome_tier: null, created_at: ago(9) }],
  [{ result: { simulated: true, environment: "simulated", scores: { eq: 655 }, utilization: 71 }, outcome_tier: "T4", created_at: ago(2) }],
  [{ result: { scores: { ex: 120, eq: 999 }, scoreModels: { ex: "VantageScore" } }, outcome_tier: "T2", created_at: null }]
];
const INQUIRIES = [
  [],
  [{ bureau: "Experian", status: "removed", created_at: ago(5) }, { bureau: "EQ", status: "removed", created_at: ago(90) }],
  [{ bureau: "TransUnion", status: "open", created_at: ago(200) }, { bureau: "nonsense", status: "new", created_at: ago(1) }]
];
const CASES = [[], [{ id: "c1", selected_bureaus_raw: "Experian, TransUnion", case_status: "In Progress", gate_override_by: null, gate_override_at: null }]];

function scenarios() {
  const out = [];
  for (let i = 0; i < 48; i += 1) {
    out.push({
      demo: i % 4 === 3,
      client: i % 11 === 10 ? null : { id: CLIENT, custom_fields: FIELDS[i % FIELDS.length] },
      businesses: BUSINESSES[i % BUSINESSES.length],
      identity: IDENTITY[i % IDENTITY.length],
      crs: CRS[i % CRS.length],
      inquiries: INQUIRIES[i % INQUIRIES.length],
      cases: CASES[i % CASES.length],
      lenders: i % 13 === 12 ? new Error('column "loc_type" does not exist') : BANKS
    });
  }
  return out;
}

/** A db that answers the reader's SELECTs from one scenario and writes down every read. */
function fakeDb(s, log) {
  const answer = (rows) => ({ rows: rows.map((r) => ({ ...r })), rowCount: rows.length });
  return {
    async query(sql, params) {
      const text = String(sql);
      log.push({ sql: text, params });
      assert.doesNotMatch(text, /\b(INSERT|UPDATE|DELETE|DROP|TRUNCATE|ALTER|BEGIN|COMMIT|ROLLBACK)\b/i);
      if (/FROM orgs/.test(text)) return answer([{ demo_mode_enabled: s.demo }]);
      if (/FROM clients/.test(text)) return answer(s.client ? [s.client] : []);
      if (/FROM businesses/.test(text)) return answer(s.businesses);
      if (/FROM pii_identity/.test(text)) {
        if (s.identity instanceof Error) throw s.identity;
        return answer(s.identity);
      }
      if (/FROM crs_results/.test(text)) return answer(s.crs);
      if (/FROM inquiry_log/.test(text)) return answer(s.inquiries);
      if (/FROM inquiry_removal_cases/.test(text)) return answer(s.cases);
      if (/FROM lenders/.test(text)) {
        if (s.lenders instanceof Error) throw s.lenders;
        const realOnly = /COALESCE\(is_demo, false\) = false/.test(text);
        return answer(s.lenders.filter((bank) => !realOnly || !bank.is_demo));
      }
      throw new Error(`unexpected sql: ${text.slice(0, 80)}`);
    }
  };
}

async function both(s, call) {
  const realLog = [];
  const copyLog = [];
  const real = await outcome(() => call(realStore, fakeDb(s, realLog)));
  const copy = await outcome(() => call(copyStore, fakeDb(s, copyLog)));
  return { real, copy, realLog, copyLog };
}

test("matchForClient: the copy reads the same rows and gives the same answer as the real reader", async () => {
  const list = scenarios();
  let answered = 0;
  let threw = 0;
  let noClient = 0;
  for (const [i, s] of list.entries()) {
    const { real, copy, realLog, copyLog } = await both(s, (mod, db) => mod.matchForClient(db, { orgId: ORG, clientId: CLIENT }));
    assert.deepEqual(copyLog, realLog, `scenario ${i}: the reads differ`);
    assert.deepEqual(copy, real, `scenario ${i}: the answers differ`);
    if (real.error) threw += 1;
    else if (real.value === null) noClient += 1;
    else answered += 1;
  }
  // The scenarios really do cover an answer, no client and a throw.
  assert.ok(answered >= 30 && noClient >= 3 && threw >= 3, `${answered} answered, ${noClient} no client, ${threw} threw`);
});

test("matchForClient: a lender table filter and a different inquiry window read and answer the same", async () => {
  for (const [i, s] of scenarios().slice(0, 12).entries()) {
    for (const opts of [{ lenderTable: "PersonalCC" }, { lenderTable: "OnlineBizCC", recentInquiryDays: 365 }, { lenderTable: "Bogus", recentInquiryDays: 0 }]) {
      const { real, copy, realLog, copyLog } = await both(s, (mod, db) => mod.matchForClient(db, { orgId: ORG, clientId: CLIENT, ...opts }));
      assert.deepEqual(copyLog, realLog, `scenario ${i} ${JSON.stringify(opts)}: the reads differ`);
      assert.deepEqual(copy, real, `scenario ${i} ${JSON.stringify(opts)}: the answers differ`);
    }
  }
});

test("listLenders: the copy builds the same SELECT, with the same values, and maps rows the same way", async () => {
  const filters = [
    { orgId: ORG, limit: 5 },
    { orgId: ORG, active: true, limit: 5000, includeDemo: false },
    { orgId: ORG, active: true, limit: 5000, includeDemo: true },
    { orgId: ORG, lender_table: "PersonalCC" },
    { orgId: ORG, lender_table: "Bogus" },
    { orgId: ORG, priority_tier: "2" },
    { orgId: ORG, priority_tier: "" },
    { orgId: ORG, active: "false" },
    { orgId: ORG, active: "yes" },
    { orgId: ORG, bureau: " Experian " },
    { orgId: ORG, state: "AZ" },
    { orgId: ORG, q: "bank" },
    { orgId: ORG, limit: 0 },
    { orgId: ORG, limit: 99999, offset: -3 },
    { orgId: ORG, limit: "abc", offset: "7" },
    { orgId: ORG, forExport: true },
    { orgId: null },
    {}
  ];
  for (const demo of [false, true]) {
    for (const f of filters) {
      const s = { demo, lenders: BANKS };
      const { real, copy, realLog, copyLog } = await both(s, (mod, db) => mod.listLenders(db, f));
      assert.deepEqual(copyLog, realLog, `${JSON.stringify(f)} demo=${demo}: the SELECT differs`);
      assert.deepEqual(copy, real, `${JSON.stringify(f)} demo=${demo}: the rows differ`);
    }
  }
  const thrown = await both({ demo: false, lenders: new Error("boom") }, (mod, db) => mod.listLenders(db, { orgId: ORG }));
  assert.deepEqual(thrown.copy, thrown.real);
  assert.match(thrown.real.error, /boom/);
});

test("orgDemoModeEnabled: the copy sends the same SQL and reads the setting the same way", async () => {
  const shapes = [[{ demo_mode_enabled: true }], [{ demo_mode_enabled: false }], [{ demo_mode_enabled: "true" }], [{}], []];
  for (const orgId of [ORG, null, "", undefined]) {
    for (const rows of shapes) {
      const logs = { real: [], copy: [] };
      const db = (log) => ({ query: async (sql, params) => { log.push({ sql, params }); return { rows }; } });
      const real = await outcome(() => realDemo(db(logs.real), orgId));
      const copy = await outcome(() => copyStore.orgDemoModeEnabled(db(logs.copy), orgId));
      assert.deepEqual(copy, real, `${orgId} ${JSON.stringify(rows)}`);
      assert.deepEqual(logs.copy, logs.real, `${orgId} ${JSON.stringify(rows)}: the SQL differs`);
    }
  }
});

test("the pure helpers give the same answer as their originals on many inputs", async () => {
  const same = async (name, real, copy, argSets) => {
    for (const args of argSets) assert.deepEqual(await outcome(() => copy(...args)), await outcome(() => real(...args)), `${name}(${JSON.stringify(args)})`);
  };
  await same("logoPathOrPlaceholder", realLogo, copyStore.logoPathOrPlaceholder, [[null], [undefined], [""], ["  "], ["/assets/lenders/x.png"], [" a.png "], [0], [42]]);
  const scoreSets = [
    [undefined], [null], [[]], ["x"],
    [[FICO9(731)]],
    [[{ modelName: "Income Insight", scoreValue: "47 B", scoreMaximumValue: null }, FICO9(650)]],
    [[{ modelName: "Fair Isaac 8", scoreValue: "712" }]],
    [[{ modelName: "", scoreValue: "702", scoreMaximumValue: "850" }]],
    [[{ modelName: "IncomeView", scoreValue: "81", scoreMaximumValue: "100" }]],
    [[{ scoreValue: "900", scoreMaximumValue: "900" }, { scoreValue: " 299 ", scoreMaximumValue: "850" }, { scoreValue: "300", scoreMaximumValue: "850" }]],
    [[null, { modelName: "FICO", scoreValue: 7.5 }]]
  ];
  await same("pickCreditScore", realPickScore, copyStore.pickCreditScore, scoreSets);
  const crsSets = [...CRS.map((rows) => [rows]), [undefined], [null], [[{ result: "not json", created_at: ago(1) }]], [[{ result: null }]]];
  await same("triMerge", realTriMerge, copyStore.triMerge, crsSets);
  const clients = [{}, { custom_fields: { utilization: 5 } }, { custom_fields: { utilization: "35" } }, { custom_fields: { utilization: "" } }, null, undefined];
  const utilArgs = [];
  for (const rows of crsSets) for (const client of clients) utilArgs.push([rows[0], client]);
  await same("utilisation", realUtil, copyStore.utilisation, utilArgs);
  await same("isSampleResult", realIsSample, copyStore.isSampleResult, [[null], [{ simulated: true }], [{ environment: "SIMULATED" }], ['{"environment":"simulated"}'], ["nope"], [{ environment: "sandbox" }]]);
  await same("publicLender", realStore.publicLender, copyStore.publicLender, [[null], [undefined], ...BANKS.map((bank) => [bank]), [{ name: "DEMO Already", is_demo: true }], [{ active: null, priority_tier: "x" }]]);
});

test("matchLenders: the copied matcher answers the same on many inputs (fixed clock)", () => {
  const now = new Date("2026-10-20T12:00:00.000Z");
  for (const [i, s] of scenarios().entries()) {
    const lenders = Array.isArray(s.lenders) ? s.lenders.map(realStore.publicLender) : [];
    const opts = {
      lenders,
      homeState: s.client?.custom_fields?.state ?? null,
      businessState: s.businesses[0]?.entity_data?.state ?? null,
      businessOnFile: i % 3 === 0 ? null : i % 3 === 1,
      inquiryLog: s.inquiries.map((row, n) => ({ ...row, created_at: new Date(now.getTime() - (n * 40 + 5) * DAY).toISOString() })),
      cases: s.cases,
      lenderTable: i % 5 === 4 ? "PersonalCC" : null,
      includeInactive: i % 7 === 6,
      includeDemo: s.demo,
      recentInquiryDays: 30,
      credit: realMatch.resolveCreditProfile({ scores: { EX: 600 + i * 4, EQ: null, TU: i % 2 ? 710 : null }, utilizationPct: i, tier: "T2" }),
      now
    };
    assert.deepEqual(copyMatch.matchLenders(opts), realMatch.matchLenders(opts), `scenario ${i}`);
    assert.deepEqual(copyMatch.resolveMatchStates(s.client?.custom_fields || {}, s.businesses, Array.isArray(s.identity) ? s.identity.flatMap((r) => (Array.isArray(r.addresses) ? r.addresses : [])) : []),
      realMatch.resolveMatchStates(s.client?.custom_fields || {}, s.businesses, Array.isArray(s.identity) ? s.identity.flatMap((r) => (Array.isArray(r.addresses) ? r.addresses : [])) : []), `states ${i}`);
  }
});
