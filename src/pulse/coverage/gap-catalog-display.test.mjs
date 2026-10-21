import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { DISPLAY_RESULT_CONTRACTS } from "../catalog/proofs/display-saved-result.mjs";
import { assertReadOnlySql } from "../beats/readbox.mjs";
import { retiredControlFor } from "./fin-b01-retired-controls.mjs";
import { ownerRemovedFor } from "./fin-b21-owner-removed.mjs";
import {
  CHECK_IDS,
  DISPLAY_RESULT_CASES,
  DISPLAY_TRACKING_CASES,
  LIVE_PAGE_CONTRACT_COUNT,
  PASS_CAPABLE_COUNT,
  SQL_BATCHES,
  UNMEASURED_CONTRACT_COUNT,
  gapChecks,
  judgeDisplayResult,
  naVerify,
} from "./gap-catalog-display.mjs";
import { leadsResetFor } from "./fin-b09-leads-reset.mjs";

const ORG = "11111111-1111-4111-8111-111111111111";

// A stand-in for the private leads page, built from plain words (the real one is git-excluded and holds names).
const LEADS_PAGE = '<meta name="robots" content="noindex,nofollow"><table><thead><tr><th>Name</th><th>Number</th><th>Follow up date</th><th>Response</th><th>Status</th></tr></thead></table><script>localStorage.setItem("k", "v"); localStorage.getItem("k");</script>';

function liveRedirect({ status = 302, location = "/partner/menu/", menuStatus = 200, menuHtml = '<h1>Four Ways In. You Can Start Anywhere.</h1><a href="/partner/">See the Partnership</a>', error = null } = {}) {
  return async (url, init) => {
    assert.equal(init.method, "GET");
    assert.equal(init.redirect, "manual");
    if (error) throw new Error(error);
    if (String(url).includes("/leads/")) return new Response(LEADS_PAGE, { status: 200 });
    return String(url).endsWith("/partner/autopsy/")
      ? new Response(null, { status, headers: location ? { location } : {} })
      : new Response(menuHtml, { status: menuStatus });
  };
}

function marker(sql) {
  return /display-result:([^*\s]+)/.exec(sql)?.[1] || "unknown";
}

function fakeDb(overrides = {}, failOn = null) {
  return {
    calls: [],
    async query(sql, params) {
      const keys = [...sql.matchAll(/\/\* display-result:([^*\s]+) \*\//g)].map((match) => match[1]);
      this.calls.push({ keys, sql, params });
      if (keys.includes(failOn)) throw new Error(`read failed for ${failOn}`);
      return { rows: keys.map((key, probe_index) => ({ probe_index, sample_count: 1, bad_count: 0, ...(overrides[key] || {}) })) };
    },
  };
}

test("all deep display controls own one exact contract", () => {
  const linkGates = DISPLAY_RESULT_CASES.filter((entry) => entry.contract.mode === "link-gate").length;
  assert.equal(DISPLAY_RESULT_CONTRACTS.length, 281);
  assert.equal(DISPLAY_RESULT_CASES.length, 282);
  assert.equal(PASS_CAPABLE_COUNT, 275);
  assert.equal(UNMEASURED_CONTRACT_COUNT, 4);
  assert.equal(LIVE_PAGE_CONTRACT_COUNT, 1);
  assert.equal(linkGates, 2);
  assert.equal(PASS_CAPABLE_COUNT + UNMEASURED_CONTRACT_COUNT + LIVE_PAGE_CONTRACT_COUNT + linkGates, 282);
  assert.equal(new Set(DISPLAY_RESULT_CONTRACTS.map((entry) => entry.control)).size, 281);
  assert.equal(new Set(DISPLAY_RESULT_CASES.map((entry) => entry.control)).size, 281);
  assert.equal(CHECK_IDS.length, DISPLAY_TRACKING_CASES.length);
  assert.equal(new Set(CHECK_IDS).size, CHECK_IDS.length);

  for (const entry of DISPLAY_RESULT_CASES) {
    assert.ok(entry.sourceFile.endsWith(".json"));
    assert.ok(entry.surface);
    assert.equal(entry.contract.control, entry.control);
    assert.ok(entry.contract.requirement.length > 40, entry.control);
    assert.ok(["query", "always-red", "live-page", "link-gate"].includes(entry.contract.mode));
    assert.equal(entry.contract.mode === "query", typeof entry.contract.sql === "string");
  }
});

test("PASS-capable contracts use exact read-only links, never generic completeness", () => {
  assert.equal(SQL_BATCHES.length, 264);
  for (const sql of SQL_BATCHES) {
    assert.match(sql, /\/\* display-result:[^*]+ \*\//);
    assert.match(sql, /sample_count/);
    assert.match(sql, /bad_count/);
    assert.match(sql, /\$1::uuid/);
    assert.doesNotMatch(sql, /complete_count|to_jsonb\(t\)|DISPLAY_RESULT_TABLE_RULES/);
    assert.doesNotMatch(sql, /\b(?:INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE|CREATE)\b/i);
  }
  const ready = SQL_BATCHES.find((sql) => marker(sql) === "ready-to-fund");
  assert.match(ready, /\|\| \(l\.detail->>'round'\)/);
  const commissionTable = SQL_BATCHES.find((sql) => sql.includes("display-result:commission-ledger-table"));
  assert.match(commissionTable, /l\.rule_snapshot/);
  assert.match(commissionTable, /l\.base_amount/);
  assert.match(commissionTable, /LEFT JOIN clients/);
  assert.match(commissionTable, /LEFT JOIN commission_rules/);
});

test("query contracts pass only with a real exact sample and no broken links", () => {
  // A strict contract (no emptyAs): no saved result at all is red.
  const entry = DISPLAY_RESULT_CASES.find((item) => item.contract.mode === "query" && !item.contract.emptyAs);
  assert.ok(entry);

  const clean = judgeDisplayResult(entry, { sample_count: 2, bad_count: 0 });
  assert.equal(clean.status, "PASS");
  assert.match(clean.detail, /exact check/);

  const absent = judgeDisplayResult(entry, { sample_count: 0, bad_count: 0 });
  assert.equal(absent.status, "FAIL");
  assert.match(absent.detail, /no saved receipt or linked result/);

  const broken = judgeDisplayResult(entry, { sample_count: 3, bad_count: 1 });
  assert.equal(broken.status, "FAIL");
  assert.match(broken.detail, /1 of 3/);
  assert.match(broken.suggestedFix, /Do not auto-fix\. Chris fixes reds\./);
});

test("missing contracts are not proved while measured breaks stay broken", () => {
  const unprovedEntry = DISPLAY_TRACKING_CASES.find((item) => !item.retired && !item.contract);
  assert.ok(unprovedEntry);
  const unproved = judgeDisplayResult(unprovedEntry);
  assert.equal(unproved.status, "NOT_PROVED");
  assert.match(unproved.detail, /no exact safe action\/result contract is attached yet/);
  assert.match(unproved.suggestedFix, /links this exact control's input to its saved result/);

  const measuredEntry = DISPLAY_RESULT_CASES.find((item) => item.contract.mode === "query");
  assert.ok(measuredEntry);
  const broken = judgeDisplayResult(measuredEntry, { sample_count: 3, bad_count: 1 });
  assert.equal(broken.status, "FAIL");
  assert.match(broken.detail, /1 of 3/);
});

test("unmeasured contracts stay not proved and name the missing exact link", () => {
  const entries = DISPLAY_RESULT_CASES.filter((item) => item.contract.mode === "always-red");
  assert.equal(entries.length, 4);
  for (const entry of entries) {
    const out = judgeDisplayResult(entry, { sample_count: 99, bad_count: 0 });
    assert.equal(out.status, "NOT_PROVED", entry.control);
    assert.match(out.detail, new RegExp(entry.control.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.ok(out.detail.includes(entry.contract.requirement));
    assert.match(out.suggestedFix, /exact input-to-result receipt/);
  }
});

test("the lane keeps missing contracts not proved and measured gaps red", async () => {
  const db = fakeDb();
  const rows = await gapChecks({ db, orgId: ORG, fetchImpl: liveRedirect() });
  const resultIds = new Set(DISPLAY_RESULT_CASES.map((entry) => entry.id));
  // Controls the product no longer has are judged "nothing to judge" by the live files (fin-b01-retired-controls.test.mjs).
  // The owner-removed controls (fin-b21-owner-removed.mjs) are read live and answer on their own.
  const unprovedIds = new Set(DISPLAY_TRACKING_CASES
    // The Reset button on the private lead list is read from the live page (fin-b09-leads-reset.mjs).
    .filter((entry) => !entry.retired && !entry.contract && !retiredControlFor(entry) && !leadsResetFor(entry) && !ownerRemovedFor(entry))
    .map((entry) => entry.id));
  const focused = rows.filter((row) => resultIds.has(row.id));
  const unproved = rows.filter((row) => unprovedIds.has(row.id));

  assert.equal(db.calls.length, 14);
  assert.equal(db.calls.flatMap((call) => call.keys).length, SQL_BATCHES.length);
  assert.ok(db.calls.every((call) => call.params[0] === ORG));
  for (const call of db.calls) assert.doesNotThrow(() => assertReadOnlySql(call.sql));
  // Every saved-result check plus the live-page reads.
  assert.equal(focused.filter((row) => row.status === "PASS").length, 276);
  // This stub returns the offer menu for unrelated pages. Two link gates, three sidebar heads,
  // and one climate-page control must stay unchecked, never be guessed green.
  const skippedControls = focused.filter((row) => row.status === "skip");
  assert.equal(skippedControls.length, 6);
  assert.equal(skippedControls.filter((row) => /Sidebar group/.test(row.id)).length, 3);
  assert.equal(skippedControls.filter((row) => /climate\/index\.html/.test(row.id)).length, 1);
  assert.equal(focused.filter((row) => row.status === "NOT_PROVED").length, 0);
  assert.equal(focused.filter((row) => row.status === "FAIL").length, 0);
  // The link-gate rows read the deployed shell by GET and also remain unchecked with this stub.
  assert.equal(skippedControls.filter((row) => /Quick launch links|More menu/.test(row.id)).length, 2);
  assert.equal(unproved.length, unprovedIds.size);
  assert.ok(unproved.every((row) => row.status === "NOT_PROVED"));
});

test("a failed exact read stays unchecked while unmeasured contracts stay not proved", async () => {
  const failedKey = marker(SQL_BATCHES[0]);
  const rows = await gapChecks({ db: fakeDb({}, failedKey), orgId: ORG, fetchImpl: liveRedirect() });
  const resultIds = new Set(DISPLAY_RESULT_CASES.map((entry) => entry.id));
  const focused = rows.filter((row) => resultIds.has(row.id));
  const affected = DISPLAY_RESULT_CASES.find((entry) => entry.contract.sql === SQL_BATCHES[0]);
  const unaffected = DISPLAY_RESULT_CASES.find((entry) => entry.contract.sql === SQL_BATCHES[20]);
  assert.equal(focused.find((row) => row.id === affected.id).status, "skip");
  assert.equal(focused.find((row) => row.id === unaffected.id).status, "PASS");
  assert.equal(focused.filter((row) => row.status === "NOT_PROVED").length, 0);
  assert.equal(focused.filter((row) => row.status === "FAIL").length, 0);
});

test("a broken saved result stays red inside a grouped read", async () => {
  const brokenSql = SQL_BATCHES[21];
  const broken = DISPLAY_RESULT_CASES.find((entry) => entry.contract.sql === brokenSql);
  const clean = DISPLAY_RESULT_CASES.find((entry) => entry.contract.sql === SQL_BATCHES[20]);
  const rows = await gapChecks({
    db: fakeDb({ [marker(brokenSql)]: { sample_count: 3, bad_count: 1 } }),
    orgId: ORG,
    fetchImpl: liveRedirect(),
  });
  assert.equal(rows.find((row) => row.id === broken.id).status, "FAIL");
  assert.match(rows.find((row) => row.id === broken.id).detail, /1 of 3/);
  assert.equal(rows.find((row) => row.id === clean.id).status, "PASS");
});

test("only the exact retired redirect can be nothing-to-judge", async () => {
  const retired = DISPLAY_TRACKING_CASES.find((item) => item.retired);
  assert.ok(retired);
  const retiredResult = judgeDisplayResult(retired);
  assert.equal(retiredResult.status, "na");
  assert.equal(await naVerify["catalog-display-retired-autopsy"]({
    sourceFile: retired.sourceFile,
    surface: retired.surface,
    control: retired.control,
  }, { fetchImpl: liveRedirect() }), true);
});


test("wrong, unread, and invalid retired-page GETs stay red", async () => {
  const retired = DISPLAY_TRACKING_CASES.find((item) => item.retired);
  for (const options of [{ status: 200 }, { location: "/app/login.html" }, { location: "https://other.example/partner/menu/" }, { location: null }, { menuStatus: 404 }, { menuHtml: "<h1>Sign in</h1>" }, { menuHtml: "<h1>Four Ways In. You Can Start Anywhere.</h1>" }]) {
    const ctx = { fetchImpl: liveRedirect(options) };
    const rows = await gapChecks(ctx);
    assert.equal(rows.find((row) => row.id === retired.id).status, "FAIL");
    assert.equal(await naVerify["catalog-display-retired-autopsy"](retired, ctx), false);
  }
  const rows = await gapChecks({ fetchImpl: liveRedirect({ error: "offline" }) });
  assert.equal(rows.find((row) => row.id === retired.id).status, "FAIL");
  const invalidBase = await gapChecks({ fetchImpl: liveRedirect(), baseUrl: "not a URL" });
  assert.equal(invalidBase.find((row) => row.id === retired.id).status, "FAIL");
  const noGet = await gapChecks({ fetchImpl: null });
  assert.equal(noGet.find((row) => row.id === retired.id).status, "FAIL");
  assert.equal(await naVerify["catalog-display-retired-autopsy"](retired, { fetchImpl: null }), false);
  assert.equal(await naVerify["catalog-display-retired-autopsy"]({ ...retired, control: "invented" }, { fetchImpl: liveRedirect() }), false);
});

test("display lane loads with shipped data and no ops folder or netlify config", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fundhub-display-bundle-"));
  try {
    const sourceRoot = new URL("../", import.meta.url);
    fs.cpSync(sourceRoot, path.join(root, "pulse"), { recursive: true });
    assert.equal(fs.existsSync(path.join(root, "ops")), false);
    assert.equal(fs.existsSync(path.join(root, "netlify.toml")), false);
    const mod = await import(pathToFileURL(path.join(root, "pulse/coverage/gap-catalog-display.mjs")));
    assert.deepEqual(mod.CHECK_IDS, CHECK_IDS);
    assert.equal(mod.DISPLAY_RESULT_CASES.length, 282);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("emptyAs quiet: a control with no saved results yet is green, and red on the first wrong result", () => {
  const entry = {
    id: "x", surface: "s", control: "c",
    contract: { mode: "query", emptyAs: "quiet", requirement: "R.", sql: "select 1" }
  };
  const quiet = judgeDisplayResult(entry, { sample_count: 0, bad_count: 0 });
  assert.equal(quiet.status, "PASS");
  assert.match(quiet.detail, /no saved results yet/);
  assert.equal(judgeDisplayResult(entry, { sample_count: 2, bad_count: 1 }).status, "FAIL");
  assert.equal(judgeDisplayResult(entry, { sample_count: 2, bad_count: 0 }).status, "PASS");
  // Without emptyAs the old rule stands: no result at all is red.
  const strict = { ...entry, contract: { ...entry.contract, emptyAs: undefined } };
  assert.equal(judgeDisplayResult(strict, { sample_count: 0, bad_count: 0 }).status, "FAIL");
});

/* Set A 2026-10-20, items 14-20. Owner fact: "There are zero funding rounds." The round and lender-row
   contracts judge real rows only; with no real funding work they are "nothing to judge" with a reason
   the morning audit re-checks, and the first wrong real result is red. */
const FUNDING_CONTROLS = [
  "Mark round submitted button",
  "Mark funded… button, amount box, Save funded, Cancel",
  "Close round button",
  "Lender row: Approved $ amount input",
  "Lender row: Approved button",
  "Lender row: Declined button",
  "Lender row: Doesn't count / Count again button (exclude or reinstate an approval, asks for a reason)",
];

test("funding round contracts judge real rows only and say nothing-to-judge only with no real funding work", () => {
  for (const control of FUNDING_CONTROLS) {
    const entry = DISPLAY_RESULT_CASES.find((item) => item.control === control);
    assert.ok(entry, control);
    assert.equal(entry.contract.emptyAs, "no-real-funding", control);
    assert.match(entry.contract.sql, /is_demo, false\) = true/, `${control} leaves test rows out`);
    const scoped = { ...entry, orgId: ORG };
    const na = judgeDisplayResult(scoped, { sample_count: 0, bad_count: 0 }, { total: 0 });
    assert.equal(na.status, "na", control);
    assert.deepEqual(na.na, { code: "no-real-funding-round", args: { orgId: ORG } });
    // Real funding work with no receipt for this control is still red.
    assert.equal(judgeDisplayResult(scoped, { sample_count: 0, bad_count: 0 }, { total: 3 }).status, "FAIL", control);
    // The count could not be read: unchecked, never green.
    assert.equal(judgeDisplayResult(scoped, { sample_count: 0, bad_count: 0 }, null).status, "skip", control);
    assert.equal(judgeDisplayResult(scoped, { sample_count: 2, bad_count: 1 }, { total: 2 }).status, "FAIL", control);
    assert.equal(judgeDisplayResult(scoped, { sample_count: 2, bad_count: 0 }, { total: 2 }).status, "PASS", control);
  }
});

test("Close round: a round close may never claim the whole engagement is complete", () => {
  const entry = DISPLAY_RESULT_CASES.find((item) => item.control === "Close round button");
  assert.match(entry.contract.sql, /lower\(COALESCE\(e\.payload->>'engagementComplete', ''\)\) = 'true'/);
  assert.doesNotMatch(entry.contract.sql, /engagementComplete' IS DISTINCT FROM 'true'/);
  assert.match(entry.contract.requirement, /funding sequence closes/);
});

test("Mark funded: the receipt must name the same round by client and round number, and the same amount", () => {
  const entry = DISPLAY_RESULT_CASES.find((item) => item.control === "Mark funded… button, amount box, Save funded, Cancel");
  assert.match(entry.contract.sql, /e\.client_id IS DISTINCT FROM fr\.client_id/);
  assert.match(entry.contract.sql, /IS DISTINCT FROM fr\.round_number/);
  assert.match(entry.contract.sql, /fr\.funded_amount IS DISTINCT FROM/);
});

test("bank decisions and Doesn't count must name the staff member by id in the same company", () => {
  for (const control of FUNDING_CONTROLS.slice(4)) {
    const entry = DISPLAY_RESULT_CASES.find((item) => item.control === control);
    assert.match(entry.contract.sql, /LEFT JOIN staff s ON s\.org_id = d\.org_id AND s\.id = d\.staff_id/, control);
    assert.match(entry.contract.sql, /OR s\.id IS NULL/, control);
  }
  const exclusion = DISPLAY_RESULT_CASES.find((item) => item.control === FUNDING_CONTROLS[6]);
  assert.match(exclusion.contract.sql, /d\.notes/);
});

test("the lane reads the real-funding count once, only when a funding contract has nothing saved", async () => {
  const fundingKeys = new Set(DISPLAY_RESULT_CASES
    .filter((entry) => entry.contract.emptyAs === "no-real-funding")
    .map((entry) => marker(entry.contract.sql)));
  const empty = Object.fromEntries([...fundingKeys].map((key) => [key, { sample_count: 0, bad_count: 0 }]));
  const counted = [];
  const db = {
    calls: [],
    async query(sql, params) {
      const keys = [...sql.matchAll(/\/\* display-result:([^*\s]+) \*\//g)].map((match) => match[1]);
      this.calls.push({ keys, sql, params });
      if (/AS rounds/.test(sql) && /AS receipts/.test(sql)) {
        counted.push(params);
        return { rows: [{ rounds: 0, receipts: 0, decisions: 0 }] };
      }
      return { rows: keys.map((key, probe_index) => ({ probe_index, sample_count: 1, bad_count: 0, ...(empty[key] || {}) })) };
    },
  };
  const rows = await gapChecks({ db, orgId: ORG, fetchImpl: liveRedirect() });
  assert.equal(counted.length, 1);
  assert.deepEqual(counted[0], [ORG]);
  for (const control of FUNDING_CONTROLS) {
    const row = rows.find((item) => item.id.endsWith(`:${control}`));
    assert.equal(row.status, "na", control);
    assert.equal(row.na.code, "no-real-funding-round");
  }
  // Not one other saved-result contract changed colour because of it.
  const queryIds = new Set(DISPLAY_RESULT_CASES.filter((entry) => entry.contract.mode === "query").map((entry) => entry.id));
  assert.deepEqual(rows.filter((row) => queryIds.has(row.id) && row.status === "FAIL").map((row) => row.id), []);
});
