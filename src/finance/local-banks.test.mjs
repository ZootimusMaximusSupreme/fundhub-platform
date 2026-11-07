// Local banks and credit unions near the client (Finance OS wave 4, unit LOC).
// Pure functions on a small made-up directory, then the real FDIC and NCUA
// files in the bundle for one Phoenix client. No database, no network.
import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  MAX_MILES, PLAN_MAX, PLAN_MONTHS, NEARBY_SHOWN, DEFAULT_DATA, LIST_INSTITUTIONS, LOCAL_BANK_SOURCES,
  cleanZip, cleanState, clientPlaces, bookBankName, creditUnionName, bankDisplayName, listInstitutionKey, tidyCaps,
  joinRule, walkInBank, directoryIndex, distanceWords, branchesNear, nearbyInstitutions, nearWords,
  planCandidates, nameVariants, logoAsks, logosFor, buildLocalBanks, attachLocalBanks, readPlaces,
  HOME_SQL, PERSON_SQL, BUSINESS_PLACES_SQL
} from "./local-banks.mjs";

function fixture() {
  return {
    banks: {
      institutions: {
        "628": ["JPMorgan Chase Bank, National Association", 1, 4091315000],
        "100": ["Desert Local Bank", 4, 500000],
        "200": ["Two State Bank", 4, 900000],
        "300": ["Card Bank, National Association", 3, 90000000],
        "400": ["Big One Office Bank", 9, 5000000],
        "500": ["First National Bank", 4, 100000],
        "501": ["First National Bank", 4, 120000],
        "600": ["Far Away Bank", 4, 100000],
        "700": ["Corner Bank", 4, 100000]
      },
      branches: [
        ["628", "1 Main St", "Phoenix", "AZ", "85001"],
        ["628", "9 Far St", "Reno", "NV", "89501"],
        ["100", "2 Main St", "Phoenix", "AZ", "85002"],
        ["200", "3 Main St", "Phoenix", "AZ", "85001"],
        ["200", "4 Lake St", "Reno", "NV", "89501"],
        ["300", "5 Card St", "Phoenix", "AZ", "85001"],
        ["400", "6 Tower St", "Phoenix", "AZ", "85003"],
        ["500", "7 Elm St", "Phoenix", "AZ", "85003"],
        ["501", "8 Oak St", "Tempe", "AZ", "85281"],
        ["600", "10 Pine St", "Flagstaff", "AZ", "86001"],
        ["700", "11 Corner Rd", "Corner", "AZ", "85999"]
      ]
    },
    creditUnions: {
      institutions: { "11": "DESERT COMMUNITY", "12": "U-HAUL", "5536": "NAVY FEDERAL CREDIT UNION", "13": "STATE CHARTER" },
      branches: [
        ["11", "s1", "10 Palm St", "PHOENIX", "AZ", "85002"],
        ["12", "s2", "11 Truck St", "PHOENIX", "AZ", "85001"],
        ["5536", "s3", "12 Navy St", "PHOENIX", "AZ", "85001"],
        ["13", "s4", "13 Mesa St", "TEMPE", "AZ", "85281"]
      ]
    },
    centroids: {
      "85001": [33.45, -112.07], "85002": [33.46, -112.07], "85003": [33.47, -112.07],
      "85281": [33.42, -111.93], "89501": [39.52, -119.81], "86001": [35.2, -111.65],
      /* Inside the quick box around 85001, but about 70 miles away. */
      "85999": [34.15, -111.17]
    },
    membership: { "11": "00", "12": "22", "5536": "05", "13": "99" }
  };
}

const HOME = { kind: "home", label: "Home", zip: "85001", city: "PHOENIX", state: "AZ" };
const BIZ = { kind: "business", label: "Cedar Grove LLC", zip: "85281", city: "TEMPE", state: "AZ" };

const rec = (id, name, dep = null) => ({
  lender_id: id, name, kind: "bank", products: ["Business credit card (apply in a branch)"], lender_table: "InBranchBizCC",
  minimum_deposit_cents: dep, seasoning_days: dep ? 30 : null, logo: null, why: [], relationship_steps: [],
  source: { label: `Bank book · ${name}`, ref: "lenders.external_row_id · row" }
});
const CHASE = rec("a0000000-0000-4000-8000-0000000000a1", "Chase", 500000);
const PNC = rec("a0000000-0000-4000-8000-0000000000a2", "PNC Bank", null);

describe("addresses: ZIP, city and state only", () => {
  test("a ZIP is five digits; ZIP+4 is cut; anything else is unknown", () => {
    assert.equal(cleanZip("85004"), "85004");
    assert.equal(cleanZip("85004-1234"), "85004");
    assert.equal(cleanZip("8500"), null);
    assert.equal(cleanZip("ABCDE"), null);
    assert.equal(cleanZip(null), null);
    assert.equal(cleanState("az"), "AZ");
    assert.equal(cleanState("Arizona"), null);
  });

  test("home comes from the identity address first, then businesses; one search per ZIP", () => {
    const places = clientPlaces({
      identity: [{ zip: "85001", city: "Phoenix", state: "AZ" }, { zip: "10001", city: "New York", state: "NY" }],
      customFields: { bp_zip: "99999", bp_state: "AK" },
      businesses: [{ name: "Cedar Grove LLC", zip: "85281", city: "Tempe", state: "AZ" }, { name: "Same ZIP LLC", zip: "85001", state: "AZ" }]
    });
    assert.deepEqual(places, [HOME, BIZ]);
  });

  test("no identity address: the Blueprint setup ZIP, then plain person fields", () => {
    assert.deepEqual(clientPlaces({ customFields: { bp_zip: "85004", bp_state: "AZ" } }),
      [{ kind: "home", label: "Home", zip: "85004", city: null, state: "AZ" }]);
    assert.deepEqual(clientPlaces({ customFields: { zip: "85003", state: "az" } }),
      [{ kind: "home", label: "Home", zip: "85003", city: null, state: "AZ" }]);
    assert.deepEqual(clientPlaces({}), [], "unknown stays unknown");
  });

  test("the reads never select a street, an SSN or the whole address", () => {
    for (const sql of [HOME_SQL, PERSON_SQL, BUSINESS_PLACES_SQL]) {
      assert.doesNotMatch(sql, /ssn|addressLine1|address_line1|street|\baddresses\s+AS\b/i);
      assert.match(sql, /org_id = \$1::uuid/);
    }
    assert.match(HOME_SQL, /client_id = \$2::uuid/);
    assert.match(BUSINESS_PLACES_SQL, /client_id = \$2::uuid/);
    assert.match(PERSON_SQL, /id = \$2::uuid/);
  });

  test("readPlaces sends org and client on every query and builds the places", async () => {
    const seen = [];
    const db = { query: async (sql, params) => {
      seen.push(params);
      if (/pii_identity/.test(sql)) return { rows: [{ zip: "85001", city: "Phoenix", state: "AZ" }] };
      if (/FROM businesses/.test(sql)) return { rows: [{ id: "b1", name: "Cedar Grove LLC", zip: "85281", city: "Tempe", state: "AZ" }] };
      return { rows: [{}] };
    } };
    const places = await readPlaces(db, { orgId: "o1", clientId: "c1" });
    assert.deepEqual(places, [HOME, BIZ]);
    assert.equal(seen.length, 3);
    for (const p of seen) assert.deepEqual(p, ["o1", "c1"]);
  });
});

describe("names", () => {
  test("the bank book's scraped tail is cut; the charter tail is cut; NCUA capitals read normally", () => {
    assert.equal(bookBankName("PNC Bank (0% BT only)"), "PNC Bank");
    assert.equal(bookBankName("Native American Bank (via TCM)"), "Native American Bank");
    assert.equal(bankDisplayName("Wells Fargo Bank, National Association"), "Wells Fargo Bank");
    assert.equal(bankDisplayName("Zions Bancorporation, N.A."), "Zions Bancorporation");
    assert.equal(bankDisplayName("American Express National Bank"), "American Express National Bank");
    assert.equal(creditUnionName("DESERT FINANCIAL"), "Desert Financial");
    assert.equal(creditUnionName("THE NEW ORLEANS FIREMEN'S"), "The New Orleans Firemen's");
    assert.equal(creditUnionName("BANK OF THE WEST FCU"), "Bank of the West FCU");
    assert.equal(creditUnionName("Already Mixed Case"), "Already Mixed Case");
    assert.equal(creditUnionName("ONEAZ"), "OneAZ", "a brand keeps its own capitals");
    assert.equal(creditUnionName("TRUWEST"), "TruWest");
    assert.equal(creditUnionName("NUVISION"), "NuVision");
    assert.equal(creditUnionName("ONEAZ COMMUNITY"), "OneAZ Community", "whole words only; the rest reads normally");
    assert.equal(creditUnionName("ONEAZTEC"), "Oneaztec", "a longer word is not the brand");
    assert.equal(tidyCaps("2020 N CENTRAL AVE STE 100"), "2020 N Central Ave Ste 100");
    assert.equal(tidyCaps("PHOENIX"), "Phoenix");
    assert.equal(tidyCaps("411 N Central Ave Ste 140"), "411 N Central Ave Ste 140", "written in mixed case: kept");
  });

  test("a list name finds its FDIC or NCUA key; an unknown name finds nothing", () => {
    assert.equal(listInstitutionKey("Chase"), "fdic:628");
    assert.equal(listInstitutionKey("PNC Bank (0% BT only)"), "fdic:6384");
    assert.equal(listInstitutionKey("First National Bank of Omaha (FNBO)"), "fdic:5452");
    assert.equal(listInstitutionKey("FAB&T"), "fdic:16849");
    assert.equal(listInstitutionKey("Navy Federal Credit Union"), "ncua:5536");
    assert.equal(listInstitutionKey("Eagle Bank (0%"), null, "four FDIC banks share this name: never guessed");
    assert.equal(listInstitutionKey(""), null);
  });

  test("every list key points at the bank the FDIC or the NCUA names that way (bundled files)", () => {
    const want = {
      "fdic:628": "JPMorgan Chase Bank, National Association",
      "fdic:3510": "Bank of America, National Association",
      "fdic:3511": "Wells Fargo Bank, National Association",
      "fdic:9846": "Truist Bank",
      "fdic:6384": "PNC Bank, National Association",
      "fdic:57957": "Citizens Bank, National Association",
      "fdic:32541": "Flagstar Bank, National Association",
      "fdic:5452": "First National Bank of Omaha",
      "fdic:16849": "First Arkansas Bank and Trust",
      "fdic:12614": "Origin Bank",
      "fdic:4832": "Shore United Bank, National Association",
      "fdic:57919": "ConnectOne Bank",
      "fdic:30402": "Franklin Bank",
      "fdic:27026": "Native American Bank, National Association",
      "fdic:14646": "Newfield National Bank",
      "fdic:7659": "New Tripoli Bank",
      "fdic:7613": "Pennian Bank",
      "fdic:15614": "West Bank",
      "fdic:6959": "Ballston Spa National Bank",
      "ncua:1261": "LANGLEY",
      "ncua:5536": "NAVY FEDERAL CREDIT UNION"
    };
    const idx = directoryIndex();
    for (const key of new Set(Object.values(LIST_INSTITUTIONS))) {
      assert.ok(want[key], `${key} has no pinned legal name`);
      assert.equal(idx.inst.get(key)?.legal, want[key], key);
    }
  });
});

describe("who can join, and which banks are walk-in", () => {
  test("NCUA membership codes: community, one group only, or check", () => {
    for (const c of ["00", "66", "77"]) assert.equal(joinRule(c), "community", c);
    for (const c of ["01", "05", "06", "10", "22", "24"]) assert.equal(joinRule(c), "one_group", c);
    for (const c of ["34", "35", "51", "98", "99"]) assert.equal(joinRule(c), "check", c);
    assert.equal(joinRule(null), "check");
    assert.equal(joinRule("5"), "check");
  });

  test("card, consumer-lending and international specialists and one-office billion-dollar banks are not walk-in", () => {
    assert.equal(walkInBank({ kind: "bank", specgrp: 3, offices: 1, asset: 90000000 }), false);
    assert.equal(walkInBank({ kind: "bank", specgrp: 6, offices: 4, asset: 9000 }), false);
    assert.equal(walkInBank({ kind: "bank", specgrp: 9, offices: 1, asset: 5000000 }), false);
    assert.equal(walkInBank({ kind: "bank", specgrp: 2, offices: 1, asset: 90000 }), true, "a small-town bank with one office");
    assert.equal(walkInBank({ kind: "bank", specgrp: 4, offices: 2, asset: 5000000 }), true);
    assert.equal(walkInBank({ kind: "credit_union", offices: 1 }), true);
  });
});

describe("branches near the client's places", () => {
  test("one entry per institution: its closest branch, ranked same ZIP, then miles", () => {
    const data = fixture();
    const hits = new Map(branchesNear([HOME], { data }).map((h) => [h.key, h]));
    assert.equal(hits.get("fdic:628").rank, 0);
    assert.equal(hits.get("fdic:628").branch.address, "1 Main St", "the Phoenix branch, not Reno");
    assert.equal(hits.get("fdic:100").rank, 1);
    assert.ok(hits.get("fdic:100").miles > 0 && hits.get("fdic:100").miles < 1);
    assert.ok(!hits.has("fdic:600"), "Flagstaff is past the 50-mile cap");
    assert.ok(!hits.has("fdic:700"), "about 70 miles away: past the cap, even inside the quick box");
    assert.equal(MAX_MILES, 50);
    const wide = new Map(branchesNear([HOME], { data, maxMiles: 100 }).map((h) => [h.key, h]));
    assert.ok(wide.get("fdic:700").miles > 60 && wide.get("fdic:700").miles < 80);
  });

  test("a ZIP with no Census point matches its own ZIP and its own city, with no made-up miles", () => {
    const data = fixture();
    delete data.centroids["85001"];
    const hits = new Map(branchesNear([HOME], { data }).map((h) => [h.key, h]));
    assert.equal(hits.get("fdic:628").rank, 0);
    assert.equal(hits.get("fdic:628").miles, null);
    assert.equal(hits.get("fdic:100").rank, 2, "same city");
    assert.equal(hits.get("fdic:100").miles, null);
  });

  test("distance words", () => {
    assert.equal(distanceWords(0, 0), "Same ZIP");
    assert.equal(distanceWords(1, 0.44), "0.4 mi");
    assert.equal(distanceWords(1, 14.4), "14 mi");
    assert.equal(distanceWords(2, null), "Same city");
  });
});

describe("the list under Branches near you", () => {
  const leftOut = [{ name: "Navy Federal Credit Union", reason: "book_says_membership_client_may_not_meet" }];

  test("keeps plan banks from the list and local walk-in banks; drops the rest", () => {
    const data = fixture();
    const list = nearbyInstitutions([HOME, BIZ], { recommended: [CHASE], leftOut, data });
    const keys = list.map((n) => n.key);
    assert.ok(keys.includes("fdic:628"), "Chase: on the list, a branch near home");
    assert.ok(keys.includes("fdic:100"), "a local bank, Arizona only");
    assert.ok(keys.includes("ncua:11"), "a community credit union");
    assert.ok(keys.includes("ncua:13"), "a state-charter credit union");
    assert.ok(!keys.includes("fdic:200"), "a two-state bank on no list is not local");
    assert.ok(!keys.includes("fdic:300"), "a credit-card bank");
    assert.ok(!keys.includes("fdic:400"), "one office, five billion dollars");
    assert.ok(!keys.includes("ncua:12"), "only one employer's staff can join");
    assert.ok(!keys.includes("ncua:5536"), "the book says you cannot join");
    const chase = list.find((n) => n.key === "fdic:628");
    assert.equal(chase.name, "Chase", "the list's own name");
    assert.equal(chase.lender_id, CHASE.lender_id);
    assert.equal(chase.on_list, true);
    assert.equal(chase.local, false);
    assert.equal(list.find((n) => n.key === "ncua:11").join_check, false, "community charter: no note");
    assert.equal(list.find((n) => n.key === "ncua:13").join_check, true);
    assert.equal(list.find((n) => n.key === "ncua:13").near.label, "Cedar Grove LLC");
  });

  test("nearest first", () => {
    const list = nearbyInstitutions([HOME], { recommended: [CHASE], leftOut, data: fixture() });
    const ranks = list.map((n) => [n.rank, n.miles ?? 0]);
    for (let i = 1; i < ranks.length; i += 1) {
      assert.ok(ranks[i][0] > ranks[i - 1][0] || (ranks[i][0] === ranks[i - 1][0] && ranks[i][1] >= ranks[i - 1][1]), JSON.stringify(ranks));
    }
  });

  test("a credit union the book says you cannot join stays off, even when anyone could join by its NCUA type", () => {
    const data = fixture();
    data.creditUnions.institutions["1261"] = "LANGLEY";
    data.creditUnions.branches.push(["1261", "s9", "14 Base St", "PHOENIX", "AZ", "85001"]);
    data.membership["1261"] = "35";
    const open = nearbyInstitutions([HOME], { recommended: [], leftOut: [], data });
    assert.ok(open.some((n) => n.key === "ncua:1261"), "several groups can join: shown, with Check who can join");
    const shut = nearbyInstitutions([HOME], { recommended: [],
      leftOut: [{ name: "Langley Federal Credit Union", reason: "book_says_membership_client_may_not_meet" }], data });
    assert.ok(!shut.some((n) => n.key === "ncua:1261"));
  });

  test("a list bank the bank match did not keep for this client is not marked on the list", () => {
    const list = nearbyInstitutions([HOME], { recommended: [], leftOut, data: fixture() });
    assert.ok(!list.some((n) => n.key === "fdic:628"), "Chase is in two states and on no plan: not local, not shown");
  });

  test("no state on file means nothing counts as local", () => {
    const list = nearbyInstitutions([{ kind: "home", label: "Home", zip: "85001", city: null, state: null }], { recommended: [], data: fixture() });
    assert.deepEqual(list, []);
  });

  test("the one line a plan row says; miles are ZIP area to ZIP area, so they say about (Codex CX19)", () => {
    assert.equal(nearWords({ on_list: true, rank: 1, distance_text: "0.4 mi", near: { kind: "home" } }), "Branch about 0.4 mi from your home ZIP.");
    assert.equal(nearWords({ on_list: false, kind: "credit_union", rank: 0, near: { kind: "business", label: "Cedar Grove LLC" } }),
      "Local credit union in the same ZIP as Cedar Grove LLC.");
    assert.equal(nearWords({ on_list: false, kind: "bank", rank: 1, distance_text: "12 mi", near: { kind: "home" } }), "Local bank, about 12 mi from your home ZIP.");
    assert.equal(nearWords({ on_list: false, kind: "credit_union", rank: 1, distance_text: "3.1 mi", near: { kind: "business", label: "Cedar Grove LLC" } }),
      "Local credit union, about 3.1 mi from the Cedar Grove LLC ZIP.");
    assert.equal(nearWords({ on_list: false, kind: "bank", rank: 2, near: { kind: "home" } }), "Local bank in the same city as your home.");
    assert.equal(nearWords(null), null);
  });
});

describe("the plan: up to 5, Giovanni's list merged with the local finds", () => {
  const nearby = () => nearbyInstitutions([HOME, BIZ], { recommended: [CHASE, PNC], data: fixture() });

  test("list banks near you, then local finds nearest first, then list banks with no branch near", () => {
    const all = nearby();
    const c = planCandidates({ recommended: [CHASE, PNC], relationships: [], nearby: all });
    assert.deepEqual(c.map((x) => x.group), ["list_near", "local", "local", "local", "local"],
      "five local finds: the list bank with no branch near you waits");
    assert.equal(c[0].rec.name, "Chase");
    assert.equal(c.length, PLAN_MAX);
    assert.ok(c.filter((x) => x.group === "local").every((x) => x.rec.local === true && x.rec.lender_id === null));
    const miles = c.filter((x) => x.group === "local").map((x) => [x.near.rank, x.near.miles ?? 0]);
    for (let i = 1; i < miles.length; i += 1) assert.ok(miles[i][0] > miles[i - 1][0] || miles[i][1] >= miles[i - 1][1]);

    const two = all.filter((n) => n.on_list || ["fdic:100", "ncua:11"].includes(n.key));
    const d = planCandidates({ recommended: [CHASE, PNC], relationships: [], nearby: two });
    assert.deepEqual(d.map((x) => x.group), ["list_near", "local", "local", "list"]);
    assert.equal(d[3].rec.name, "PNC Bank", "PNC has no branch in this directory, so it comes last");
  });

  test("a bank staff already put on the tracker is never pushed off by a local find", () => {
    const relationships = [
      { id: "r1", bank: "Staff Pick One", bank_key: "staff pick one", status: "planned" },
      { id: "r2", bank: "Staff Pick Two", bank_key: "staff pick two", status: "open" }
    ];
    const c = planCandidates({ recommended: [CHASE, PNC], relationships, nearby: nearby() });
    assert.equal(c.length, PLAN_MAX - 2, "two places stay for the tracker banks");
  });

  test("a tracked candidate stays even when the cut is tight", () => {
    const relationships = [{ id: "r1", bank: "PNC Bank", bank_key: "pnc bank", status: "planned" }];
    const c = planCandidates({ recommended: [CHASE, PNC], relationships, nearby: nearby(), max: 2 });
    assert.deepEqual(c.map((x) => x.rec.name), ["Chase", "PNC Bank"]);
  });

  test("a bank staff skipped stays off", () => {
    const relationships = [{ id: "r1", bank: "Chase", bank_key: "chase", status: "skipped" }];
    const c = planCandidates({ recommended: [CHASE, PNC], relationships, nearby: nearby() });
    assert.ok(!c.some((x) => x.rec.name === "Chase"));
  });
});

describe("buildLocalBanks", () => {
  const payload = () => ({
    recommended_banks: [CHASE, PNC],
    banks_left_out: [{ name: "Navy Federal Credit Union", reason: "book_says_membership_client_may_not_meet" }],
    relationships: [],
    deposit_plan: [{ name: "Chase", status: "planned" }]
  });

  test("no address: the read's own plan stays and the screen asks for one", () => {
    const out = buildLocalBanks({ payload: payload(), places: [], today: "2026-11-07", data: fixture() });
    assert.equal(out.local_banks.status, "needs_address");
    assert.deepEqual(out.deposit_plan, [{ name: "Chase", status: "planned" }]);
  });

  test("with addresses: the deposit plan carries the local finds, each saying where it is", () => {
    const out = buildLocalBanks({ payload: payload(), places: [HOME, BIZ], today: "2026-11-07", data: fixture() });
    const lb = out.local_banks;
    assert.equal(lb.status, "ready");
    assert.deepEqual(lb.window, { from: "2026-11-07", to: "2027-05-07", months: PLAN_MONTHS });
    assert.ok(lb.nearby.length <= NEARBY_SHOWN);
    assert.equal(out.deposit_plan.length, PLAN_MAX);
    const [chase, ...rest] = out.deposit_plan;
    assert.equal(chase.name, "Chase");
    assert.equal(chase.deposit_cents, 500000, "the bank book's own minimum");
    assert.equal(chase.on_list, true);
    assert.equal(chase.local, false);
    const local = rest.find((r) => r.local);
    assert.equal(local.deposit_cents, null, "no bank book amount: not set");
    assert.equal(local.open_by, null, "no date is guessed");
    assert.match(local.reason, /^Local (bank|credit union)/);
    assert.equal(local.reason_source.label === "FDIC BankFind" || local.reason_source.label === "NCUA", true);
    assert.ok(local.near && local.near.branch && local.near.branch.address);
    assert.deepEqual(lb.recommended.map((r) => r.name), out.deposit_plan.map((r) => r.name));
  });
});

describe("logos: Plaid, then the bank book, then the name only", () => {
  test("a name two institutions share is never used to find a logo", () => {
    const data = fixture();
    assert.deepEqual(logoAsks({ kind: "bank", name: "First National Bank" }, data), []);
    assert.deepEqual(logoAsks({ kind: "bank", name: "Desert Local Bank" }, data).map((a) => a.name), ["Desert Local Bank", "Desert Local"]);
    assert.deepEqual(nameVariants({ kind: "credit_union", name: "Desert Community" }),
      ["Desert Community", "Desert Community Credit Union", "Desert Community Federal Credit Union", "Desert Community CU", "Desert Community FCU"]);
    assert.deepEqual(logoAsks({ kind: "bank", name: "Chase", on_list: true, lender_id: "L1" }, data), [{ lenderId: "L1", name: "Chase" }]);
  });

  test("Plaid wins over the bank book; none found means no logo", async () => {
    const data = fixture();
    const find = async (_db, { banks }) => banks.map((b) => {
      if (b.name === "Desert Community Credit Union") return { logo: "data:image/png;base64,iVBORw0KGgoAAAA", logo_source: "plaid" };
      if (b.name === "Desert Community CU") return { logo: "/assets/lenders/desert-community.png", logo_source: "bank_book" };
      if (b.lenderId === "L1") return { logo: "/assets/lenders/chase.png", logo_source: "bank_book" };
      return { logo: null, logo_source: null };
    });
    const out = await logosFor({}, { orgId: "o1", data, find, entries: [
      { kind: "credit_union", name: "Desert Community" },
      { kind: "bank", name: "Chase", on_list: true, lender_id: "L1" },
      { kind: "bank", name: "First National Bank" }
    ] });
    assert.deepEqual(out, [
      { logo: "data:image/png;base64,iVBORw0KGgoAAAA", logo_source: "plaid" },
      { logo: "/assets/lenders/chase.png", logo_source: "bank_book" },
      { logo: null, logo_source: null }
    ]);
  });

  test("a logo lookup that fails leaves every logo empty, never a broken read", async () => {
    const out = await logosFor({}, { orgId: "o1", data: fixture(), find: async () => { throw new Error("db down"); },
      entries: [{ kind: "bank", name: "Desert Local Bank" }] });
    assert.deepEqual(out, [{ logo: null, logo_source: null }]);
  });
});

describe("attachLocalBanks", () => {
  test("adds local_banks and the merged deposit plan, with logos", async () => {
    const payload = { ok: true, recommended_banks: [CHASE], banks_left_out: [], relationships: [], deposit_plan: [] };
    const out = await attachLocalBanks({}, {
      orgId: "o1", clientId: "c1", payload, now: new Date("2026-11-07T12:00:00Z"), data: fixture(),
      read: async () => [HOME],
      find: async (_db, { banks }) => banks.map((b) => (b.lenderId ? { logo: "/assets/lenders/chase.png", logo_source: "bank_book" } : { logo: null, logo_source: null }))
    });
    assert.equal(out.ok, true);
    assert.equal(out.local_banks.status, "ready");
    assert.equal(out.deposit_plan[0].name, "Chase");
    assert.equal(out.deposit_plan[0].logo, "/assets/lenders/chase.png");
    assert.equal(out.deposit_plan[0].logo_alt, "Chase logo");
    assert.equal(out.local_banks.nearby.find((n) => n.name === "Chase").logo, "/assets/lenders/chase.png");
    assert.ok(out.deposit_plan.some((r) => r.local && r.logo === null && r.logo_alt === null), "no logo: the name only");
  });

  test("a failed read keeps the bank read's own plan and says local banks are unavailable", async () => {
    const payload = { ok: true, recommended_banks: [], deposit_plan: [{ name: "Chase" }] };
    const quiet = console.error;
    console.error = () => {};
    try {
      const out = await attachLocalBanks({}, { orgId: "o1", clientId: "c1", payload, read: async () => { throw new Error("db down"); } });
      assert.equal(out.local_banks.status, "unavailable");
      assert.deepEqual(out.deposit_plan, [{ name: "Chase" }]);
    } finally {
      console.error = quiet;
    }
  });
});

describe("the real FDIC and NCUA files in the bundle", () => {
  test("sources are dated", () => {
    assert.equal(LOCAL_BANK_SOURCES.banks.asOf, "2026-11-06");
    assert.equal(LOCAL_BANK_SOURCES.credit_unions.asOf, "2026-06-30");
    assert.equal(LOCAL_BANK_SOURCES.membership.asOf, "2026-06-30");
    assert.ok(Object.keys(DEFAULT_DATA.banks.institutions).length > 3000);
    assert.ok(DEFAULT_DATA.banks.branches.length > 50000);
  });

  test("a Phoenix home and a Tempe business: Giovanni's banks near, Arizona-only locals, no employer or military credit unions", () => {
    const places = [
      { kind: "home", label: "Home", zip: "85004", city: "PHOENIX", state: "AZ" },
      { kind: "business", label: "Cedar Grove LLC", zip: "85281", city: "TEMPE", state: "AZ" }
    ];
    const recommended = [
      rec("a0000000-0000-4000-8000-0000000000a1", "Chase", 500000),
      rec("a0000000-0000-4000-8000-0000000000a2", "Bank of America", 500000),
      rec("a0000000-0000-4000-8000-0000000000a3", "Wells Fargo", null)
    ];
    const out = buildLocalBanks({
      payload: { recommended_banks: recommended, relationships: [],
        banks_left_out: [{ name: "Navy Federal Credit Union", reason: "book_says_membership_client_may_not_meet" }] },
      places, today: "2026-11-07"
    });
    const nearby = out.local_banks.nearby;
    for (const name of ["Chase", "Bank of America", "Wells Fargo"]) {
      const n = nearby.find((x) => x.name === name);
      assert.ok(n && n.on_list && n.miles !== undefined, `${name} has a branch near`);
    }
    const idx = directoryIndex();
    for (const n of nearby.filter((x) => x.local)) {
      assert.deepEqual([...idx.inst.get(n.key).states], ["AZ"], `${n.name} only works in Arizona`);
      assert.notEqual(idx.inst.get(n.key).join, "one_group", `${n.name} is open to more than one group`);
    }
    assert.ok(!nearby.some((n) => /u-haul|navy federal/i.test(n.name)));
    assert.deepEqual(out.deposit_plan.slice(0, 3).map((r) => r.name), ["Chase", "Bank of America", "Wells Fargo"]);
    assert.equal(out.deposit_plan.length, 5);
    assert.ok(out.deposit_plan.slice(3).every((r) => r.local));
  });
});
