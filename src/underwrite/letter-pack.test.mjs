import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  buildLetterPack, buildLetterPackForClient, personalFromClient, bureausFromEngine, PACK_REASON,
  NO_HOME_ADDRESS, homeAddressFromIdentity, pickCrsResultForPack, isStandInResult
} from "./letter-pack.mjs";
import { mergeBureauReports } from "../finance/crs-map.mjs";
import { extractPdfText } from "../company-brain/pdf-text.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SANDBOX = path.resolve(HERE, "../../vendor/underwriteiq-full/api/lite/crs/sandbox");

/** A stored pull in the shape crs_results.result really carries: result.bureaus. */
function mergedSandboxPull() {
  const load = (n) => JSON.parse(readFileSync(path.join(SANDBOX, n), "utf8"));
  return mergeBureauReports({
    reports: { TU: load("tu.json"), EX: load("exp.json"), EQ: load("efx.json") },
    requestIds: { TU: "tu-1", EX: "ex-1", EQ: "eq-1" },
    environment: "sandbox"
  });
}

// Unit tests stay letter-only — never call live Claude.
delete process.env.ANTHROPIC_API_KEY;

const PERSONAL = {
  name: "Jordan Sample",
  address: "5815 Knoll Krest St\nSan Antonio, TX 78242",
  employer: "Current Co",
  dob: "1963-11-12",
  ssn: "111223333"
};

const ENGINE = {
  normalized: {
    tradelines: [
      {
        source: "experian",
        creditorName: "SIGNET BANK/VIRGINIA",
        status: "closed",
        isDerogatory: true,
        accountIdentifier: "1200119007344443",
        currentBalance: 4798,
        reportedDate: "2021-09-03",
        closedDate: "2021-10-28",
        currentRatingType: "ChargeOff"
      }
    ],
    inquiries: [
      { source: "experian", creditorName: "GECS", date: "2024-04-01" },
      { source: "equifax", creditorName: "RESIDENTCHECK/IMT RESI", date: "2024-05-28" }
    ],
    identity: {
      names: [
        { first: "WILLIE", middle: "L", last: "BOOZE", source: "experian" },
        { first: "BARBARA", middle: "M", last: "DOTY", source: "transunion" }
      ],
      addresses: [
        { line1: "1234 MAIN ST", city: "SAN ANTONIO", state: "TX", zip: "78201", source: "experian" }
      ],
      employers: [{ name: "HAEMONETICS", source: "experian" }],
      ssns: [{ value: "666265040", source: "equifax" }],
      dobs: [{ value: "1963-11-12", source: "equifax" }]
    }
  }
};

// CHANGED 2026-08-19: this test used to assert reason === "empty_pack" here.
// That was the bug — "no engine result was supplied" and "the engine ran and
// found nothing to send" reported the same string, so nobody could tell a broken
// pipeline from a clean client. See the PACK_REASON block in letter-pack.mjs.
test("no engine result reports no_engine_result, not a bare empty_pack", async () => {
  const pack = await buildLetterPack({
    personal: { name: "Chris Sample", address: "1 Main St" },
    pack: "funding"
  });
  assert.equal(pack.files.filter((f) => /inquiry_|personal_info_|round/.test(f.filename)).length, 0);
  assert.equal(pack.reason, PACK_REASON.NO_ENGINE_RESULT);
  assert.notEqual(pack.reason, PACK_REASON.EMPTY_PACK);
});

test("engine result that yields nothing still reports the benign empty_pack", async () => {
  const pack = await buildLetterPack({
    crsResult: { outcome: "REPAIR_ONLY", normalized: { tradelines: [], inquiries: [], identity: {} } },
    personal: { name: "Chris Sample", address: "1 Main St" },
    pack: "funding"
  });
  assert.equal(pack.files.length, 0);
  assert.equal(pack.reason, PACK_REASON.EMPTY_PACK);
});

test("funding pack returns openable inquiry, personal-info, and bureau dispute PDFs", async () => {
  const pack = await buildLetterPack({
    crsResult: ENGINE,
    personal: PERSONAL,
    pack: "funding"
  });
  const letters = pack.files.filter((f) => /inquiry_|personal_info_|round/.test(f.filename));
  assert.ok(letters.length >= 3, `expected funding letters, got ${letters.map((f) => f.filename)}`);
  assert.ok(pack.files.some((f) => /round1/.test(f.filename)), "gold funding pack includes bureau dispute letters");
  assert.ok(!letters.some((f) => /inquiry_tu/.test(f.filename)), "TransUnion has no inquiries");
  for (const f of letters) {
    assert.match(f.filename, /\.pdf$/);
    assert.equal(f.contentType, "application/pdf");
    const buf = Buffer.isBuffer(f.content) ? f.content : Buffer.from(f.content);
    assert.equal(buf.subarray(0, 4).toString(), "%PDF");
    const text = (await extractPdfText(buf)).text || "";
    assert.ok(text.length > 400, `${f.filename} looks empty`);
    assert.doesNotMatch(text, /fundhub|FundHub/);
  }
});

test("repair pack returns openable Round 1 dispute PDFs", async () => {
  const pack = await buildLetterPack({
    crsResult: ENGINE,
    personal: PERSONAL,
    pack: "repair"
  });
  assert.ok(pack.files.some((f) => /round1/.test(f.filename)));
  assert.ok(!pack.files.some((f) => /round2|round3/.test(f.filename)));
  const dispute = pack.files.find((f) => /round1/.test(f.filename));
  const buf = Buffer.isBuffer(dispute.content) ? dispute.content : Buffer.from(dispute.content);
  assert.equal(buf.subarray(0, 4).toString(), "%PDF");
  const text = (await extractPdfText(buf)).text || "";
  assert.match(text, /Field 21/);
  assert.match(text, /SIGNET BANK/);
  assert.doesNotMatch(text, /fundhub|FundHub/);
});

test("personalFromClient joins name and address", () => {
  const p = personalFromClient({
    first_name: "Chris",
    last_name: "Full",
    custom_fields: { address: "1100 Lynhurst Ln" }
  });
  assert.equal(p.name, "Chris Full");
  assert.equal(p.address, "1100 Lynhurst Ln");
});

test("bureausFromEngine groups tradelines by source", () => {
  const by = bureausFromEngine({
    normalized: {
      tradelines: [{ source: "experian", creditorName: "CapOne", status: "chargeoff", isDerogatory: true }],
      inquiries: [{ source: "experian" }, { source: "experian" }]
    }
  });
  assert.equal(by.experian.tradelines.length, 1);
  assert.equal(by.experian.inquiries, 2);
  assert.equal(by.experian.inquiryList.length, 2);
});

test("without crsResult does not call Claude", async () => {
  let called = false;
  const pack = await buildLetterPack({
    personal: PERSONAL,
    pack: "funding",
    generateDeliverablesFn: async () => {
      called = true;
      return { documents: {} };
    }
  });
  assert.equal(called, false);
  assert.equal(pack.deliverableCount, 0);
  assert.equal(pack.deliverableSkip, "no_engine");
});

test("funding letters without the four analysis PDFs are not a complete pack", async () => {
  const pack = await buildLetterPack({
    crsResult: ENGINE,
    personal: PERSONAL,
    pack: "funding"
  });
  assert.ok(pack.files.some((f) => /inquiry_|personal_info_/.test(f.filename)));
  assert.equal(pack.reason, "missing_funding_analysis");
});

function fakePackDb({ client, crs, identity } = {}) {
  return {
    async query(sql) {
      if (/FROM clients/.test(sql)) return { rows: client ? [client] : [] };
      if (/FROM pii_identity/.test(sql)) return { rows: identity ? [{ addresses: identity }] : [] };
      if (/FROM crs_results/.test(sql)) return { rows: crs ? [{ result: crs }] : [] };
      return { rows: [] };
    }
  };
}

test("missing client row skips without throw", async () => {
  const out = await buildLetterPackForClient(fakePackDb({}), { clientId: "cl-missing", pack: "funding" });
  assert.equal(out.reason, "no_client");
  assert.equal(out.files.length, 0);
  assert.equal(out.engineSkip, "no_client");
});

test("missing CRS skips engine without throw", async () => {
  const out = await buildLetterPackForClient(
    fakePackDb({ client: { first_name: "A", last_name: "B", custom_fields: {}, outcome_tier: "FULL_FUNDING" } }),
    { clientId: "cl-1", pack: "funding" }
  );
  assert.equal(out.engineSkip, "no_crs_result");
  assert.equal(out.engineOutcome, null);
  // "no pull on file yet" is a normal early state, so it is named plainly and is
  // NOT dressed up as an engine error.
  assert.equal(out.reason, PACK_REASON.NO_CRS_RESULT);
});

const SANDBOX_CLIENT = {
  first_name: "Barbara",
  last_name: "Doty",
  custom_fields: { address: "1100 Lynhurst Ln", city: "Denton", state: "TX", zip: "76205" },
  outcome_tier: null
};
// The saved identity record, in the shape the real credit form writes
// (api/soft-pull-approve.mjs). This is where the letters read the home address.
const SANDBOX_IDENTITY = [{ addressLine1: "1100 Lynhurst Ln", city: "Denton", state: "TX", postalCode: "76205" }];

test("a stored pull WITH result.bureaus builds real letters through the tier engine", async () => {
  const out = await buildLetterPackForClient(
    fakePackDb({ client: SANDBOX_CLIENT, crs: mergedSandboxPull(), identity: SANDBOX_IDENTITY }),
    { clientId: "cl-real", pack: "funding" }
  );
  assert.equal(out.engineSkip, null, `engine must run clean, got ${out.engineSkip}`);
  assert.ok(out.engineOutcome, "engine must return a tier");
  const letters = out.files.filter((f) => /inquiry_|personal_info_|round/.test(f.filename));
  assert.ok(letters.length >= 3, `expected letters, got ${out.files.map((f) => f.filename)}`);
  for (const f of letters) {
    const buf = Buffer.isBuffer(f.content) ? f.content : Buffer.from(f.content);
    assert.equal(buf.subarray(0, 4).toString(), "%PDF");
  }
  const html = out.files.filter((f) => f.contentType === "text/html");
  // The four analysis pages plus the Business Duplication Map (2026-10-02).
  assert.deepEqual(html.map((f) => f.filename), [
    "credit_analysis_report.html", "funding_snapshot.html", "lender_match_list.html",
    "optimization_roadmap.html", "business_duplication_map.html"
  ], `expected four HTML pages and the map, got ${html.map((f) => f.filename)}`);
  assert.equal(out.duplicationMapSkip, null);
  assert.equal(out.deliverableEngine, "html");
  assert.ok(html.every((f) => String(f.content).includes("<")));
});

// The exact failure the demo seed hit: crs_results.result had no `bureaus` key,
// so runTierEngineFromCrsResult threw and the pack came back empty. The point of
// this test is that the empty pack now SAYS WHY.
test("a stored pull WITHOUT result.bureaus names the engine fault, not empty_pack", async () => {
  const noBureaus = { outcome: "FULL_FUNDING", tradelines: [{ creditorName: "Chase", bureau: "EX" }] };
  const out = await buildLetterPackForClient(
    fakePackDb({ client: SANDBOX_CLIENT, crs: noBureaus }),
    { clientId: "cl-nobureaus", pack: "funding" }
  );
  assert.equal(out.files.length, 0);
  assert.notEqual(out.reason, PACK_REASON.EMPTY_PACK);
  assert.match(out.reason, /^engine_error: /);
  assert.match(out.reason, /no bureau reports to score/);
  assert.match(out.engineSkip, /no bureau reports to score/);
});

test("an engine that throws is reported as engine_error with its message", async () => {
  const out = await buildLetterPackForClient(
    fakePackDb({ client: SANDBOX_CLIENT, crs: { ok: true } }),
    { clientId: "cl-boom", pack: "funding" },
    { runEngine: () => { throw new Error("engine exploded"); } }
  );
  assert.equal(out.reason, "engine_error: engine exploded");
  assert.equal(out.engineSkip, "engine exploded");
});

test("REGRESSION: clients.outcome_tier is not stamped onto the engine", async () => {
  const out = await buildLetterPackForClient(
    fakePackDb({
      client: { first_name: "A", last_name: "B", custom_fields: {}, outcome_tier: "FULL_FUNDING" },
      crs: { ok: true }
    }),
    { clientId: "cl-1", pack: "funding" },
    { runEngine: () => ({ outcome: "REPAIR_ONLY", normalized: {} }) }
  );
  assert.equal(out.engineOutcome, "REPAIR_ONLY");
});

/* ═══ N9 — NO HOME ADDRESS, NO LETTERS (live, 2026-09-18) ═══════════════════
   Sim Combo's six funding letters were saved on live printing the client's name
   and the date and no home address, and the personal-information letters asked
   the bureau to "keep only my current address" while listing that very address
   among the ones to remove. The Repair desk showed the address on file the
   whole time: it lives on the identity record, and the builder was reading the
   typed custom_fields keys. */

const letterFilesOf = (out) => out.files.filter((f) => /inquiry_|personal_info_|round/.test(f.filename));
async function letterText(f) {
  const buf = Buffer.isBuffer(f.content) ? f.content : Buffer.from(f.content);
  return ((await extractPdfText(buf)).text || "").replace(/\s+/g, " ");
}

test("N9: every letter prints the home address from the saved identity record, not the typed custom fields", async () => {
  const out = await buildLetterPackForClient(
    fakePackDb({
      client: { ...SANDBOX_CLIENT, custom_fields: { address: "9 Typed Only Rd" } },
      crs: mergedSandboxPull(),
      identity: [{ addressLine1: "5815 Knoll Krest St", city: "San Antonio", state: "TX", postalCode: "78242" }]
    }),
    { clientId: "cl-n9", pack: "funding" }
  );
  const letters = letterFilesOf(out);
  assert.ok(letters.length >= 3, `expected letters, got ${out.files.map((f) => f.filename)}`);
  assert.equal(out.letterSkip, null);
  for (const f of letters) {
    const text = await letterText(f);
    assert.match(text, /5815 Knoll Krest St/, `${f.filename} prints no street`);
    assert.match(text, /San Antonio, TX 78242/, `${f.filename} prints no city, state and ZIP`);
    assert.doesNotMatch(text, /9 Typed Only Rd/, `${f.filename} printed the typed custom field`);
  }
});

test("N9: with no home address on the identity record no letter is built, and the analysis pages still are", async () => {
  // SANDBOX_CLIENT still carries a typed custom_fields address. It is not a home address.
  const out = await buildLetterPackForClient(
    fakePackDb({ client: SANDBOX_CLIENT, crs: mergedSandboxPull() }),
    { clientId: "cl-n9-none", pack: "funding" }
  );
  assert.deepEqual(letterFilesOf(out).map((f) => f.filename), []);
  assert.equal(out.letterSkip, NO_HOME_ADDRESS);
  assert.equal(out.files.filter((f) => f.contentType === "text/html").length, 5,
    "the four analysis pages and the Business Duplication Map name no address and are still owed");
});

test("N9: an identity row with no street line is no home address", async () => {
  const out = await buildLetterPackForClient(
    fakePackDb({
      client: SANDBOX_CLIENT,
      crs: mergedSandboxPull(),
      identity: [{ city: "Denton", state: "TX", postalCode: "76205" }]
    }),
    { clientId: "cl-n9-nostreet", pack: "funding" }
  );
  assert.deepEqual(letterFilesOf(out).map((f) => f.filename), []);
  assert.equal(out.letterSkip, NO_HOME_ADDRESS);
});

test("N9: a street with no city, state or ZIP is no home address — no letter prints a part-address", async () => {
  // Sim Eight's saved letters printed a street and no city line. That is not
  // an address a bureau can answer, so it builds no letter at all.
  for (const partial of [
    { addressLine1: "5815 Knoll Krest St" },
    { addressLine1: "5815 Knoll Krest St", city: "San Antonio", state: "TX" },
    { addressLine1: "5815 Knoll Krest St", city: "San Antonio", postalCode: "78242" },
    { addressLine1: "5815 Knoll Krest St", state: "TX", postalCode: "78242" }
  ]) {
    const out = await buildLetterPackForClient(
      fakePackDb({ client: SANDBOX_CLIENT, crs: mergedSandboxPull(), identity: [partial] }),
      { clientId: "cl-n9-partial", pack: "funding" }
    );
    assert.deepEqual(letterFilesOf(out).map((f) => f.filename), [], `built letters for ${Object.keys(partial)}`);
    assert.equal(out.letterSkip, NO_HOME_ADDRESS);
  }
});

test("N9: buildLetterPack withholds every letter, funding and repair, for a named client with no home address", async () => {
  for (const pack of ["funding", "repair"]) {
    const out = await buildLetterPack({ crsResult: ENGINE, personal: { name: "Jordan Sample", address: "" }, pack });
    assert.deepEqual(letterFilesOf(out).map((f) => f.filename), [], `${pack} pack built a letter with no address`);
    assert.equal(out.letterSkip, NO_HOME_ADDRESS);
  }
});

test("homeAddressFromIdentity reads the shape the credit form saves, and a missing street is empty", () => {
  assert.deepEqual(
    homeAddressFromIdentity([{ addressLine1: "5815 Knoll Krest St", city: "San Antonio", state: "TX", postalCode: "78242" }]),
    { address: "5815 Knoll Krest St\nSan Antonio, TX 78242", city: "San Antonio", state: "TX", zip: "78242" }
  );
  assert.equal(
    homeAddressFromIdentity(JSON.stringify([{ address_line1: "1 Elm", address_line2: "Apt 2", address_city: "Mesa", address_state: "AZ", address_zip: "85201" }])).address,
    "1 Elm\nApt 2\nMesa, AZ 85201"
  );
  assert.deepEqual(homeAddressFromIdentity([]), { address: "", city: "", state: "", zip: "" });
  assert.deepEqual(homeAddressFromIdentity(null), { address: "", city: "", state: "", zip: "" });
  assert.deepEqual(homeAddressFromIdentity([{ city: "Mesa", zip: "85201" }]), { address: "", city: "", state: "", zip: "" });
  // All four parts or none: a street with no ZIP is empty too.
  assert.deepEqual(homeAddressFromIdentity([{ addressLine1: "1 Elm", city: "Mesa", state: "AZ" }]), { address: "", city: "", state: "", zip: "" });
});

// CB-11 / R18. A rehearsal pull (crs-pull `simulate: true`) is the NEWEST row and
// holds no scores or tradelines. Reading "the newest row" built the pack from
// nothing while the client's real pull sat one row down.
const REHEARSAL_ROW = { result: { simulated: true, environment: "sandbox", scores: { ex: null, eq: null, tu: null }, bureaus: {} } };
const REAL_ROW = { result: { environment: "production", scores: { ex: 702, eq: 709, tu: 706 }, bureaus: { EX: { tradelines: [] } } } };
const SANDBOX_ROW = { result: { environment: "sandbox", scores: { ex: 800, eq: 800, tu: 800 }, bureaus: {} } };
const WALKTHROUGH_ROW = { result: { simulated: true, environment: "simulated", scores: { ex: 771, eq: 778, tu: 766 }, bureaus: {} } };

function fakeRowsDb({ client, rows, identity }) {
  const seen = { crsSql: null };
  return {
    seen,
    async query(sql) {
      if (/FROM clients/.test(sql)) return { rows: [client] };
      if (/FROM pii_identity/.test(sql)) return { rows: identity ? [{ addresses: identity }] : [] };
      if (/FROM crs_results/.test(sql)) { seen.crsSql = sql; return { rows }; }
      return { rows: [] };
    }
  };
}

/** runEngine spy: records which stored pull the pack was built from, then stops. */
function engineSpy() {
  const spy = { arg: undefined, runEngine(stored) { spy.arg = stored; throw new Error("spy: stop here"); } };
  return spy;
}

test("CB-11: a newer rehearsal pull does not hide the client's real pull from the letter pack", async () => {
  const spy = engineSpy();
  const db = fakeRowsDb({ client: SANDBOX_CLIENT, rows: [REHEARSAL_ROW, REAL_ROW], identity: SANDBOX_IDENTITY });
  await buildLetterPackForClient(db, { clientId: "cl-cb11", pack: "funding" }, { runEngine: spy.runEngine });
  assert.equal(spy.arg, REAL_ROW.result, "the pack must be built from the real pull, not the rehearsal above it");
  assert.match(db.seen.crsSql, /LIMIT\s+10\b/, "the read must fetch more than the single newest row");
});

test("CB-11: a sandbox fixture does not outrank a real pull either", async () => {
  const spy = engineSpy();
  const db = fakeRowsDb({ client: SANDBOX_CLIENT, rows: [SANDBOX_ROW, REAL_ROW], identity: SANDBOX_IDENTITY });
  await buildLetterPackForClient(db, { clientId: "cl-cb11", pack: "funding" }, { runEngine: spy.runEngine });
  assert.equal(spy.arg, REAL_ROW.result);
});

test("CB-11: a client with only stand-in rows (walkthrough, sandbox host) still gets their newest one", async () => {
  for (const rows of [[WALKTHROUGH_ROW], [SANDBOX_ROW, REHEARSAL_ROW], [WALKTHROUGH_ROW, REHEARSAL_ROW]]) {
    const spy = engineSpy();
    const db = fakeRowsDb({ client: SANDBOX_CLIENT, rows, identity: SANDBOX_IDENTITY });
    await buildLetterPackForClient(db, { clientId: "cl-cb11", pack: "funding" }, { runEngine: spy.runEngine });
    assert.equal(spy.arg, rows[0].result, "falls back to the newest row exactly as before");
  }
});

test("CB-11: pickCrsResultForPack takes the newest own pull and answers null on no rows", () => {
  const older = { result: { environment: "production", scores: { ex: 650 } } };
  assert.equal(pickCrsResultForPack([REHEARSAL_ROW, REAL_ROW, older]), REAL_ROW.result);
  assert.equal(pickCrsResultForPack([REAL_ROW, REHEARSAL_ROW]), REAL_ROW.result);
  assert.equal(pickCrsResultForPack([]), null);
  assert.equal(pickCrsResultForPack(undefined), null);
  assert.equal(pickCrsResultForPack([{ result: null }]), null);
});

test("CB-11: isStandInResult names rehearsal, sandbox and sample files, and never a real pull", () => {
  assert.equal(isStandInResult(REHEARSAL_ROW.result), true);
  assert.equal(isStandInResult(SANDBOX_ROW.result), true);
  assert.equal(isStandInResult(WALKTHROUGH_ROW.result), true);
  assert.equal(isStandInResult({ simulated: true }), true);
  assert.equal(isStandInResult(JSON.stringify({ environment: "Sandbox" })), true);
  assert.equal(isStandInResult(REAL_ROW.result), false);
  assert.equal(isStandInResult({ scores: { ex: 700 } }), false);
  assert.equal(isStandInResult("not json"), false);
  assert.equal(isStandInResult(null), false);
});
