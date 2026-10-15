// Tests for the batch 19 live checks. There is no local Postgres here, so the very SQL text each contract
// carries is run on SQLite (node:sqlite) over stand-in tables, after one small rewrite: the Postgres casts
// (::uuid, ::int, ::text) are dropped, since SQLite has none. The SQL was written in the part of the
// language both read the same way. Every check is shown green on good rows, red on a wrong row, quiet on
// no rows, and blind to another company's rows. A second set of tests breaks the SQL on purpose and shows
// the wrong row would then go unseen, so each condition is held in place by a case.

import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";

import { DISPLAY_RESULT_CASES, gapChecks, judgeDisplayResult } from "../../coverage/gap-catalog-display.mjs";
import { FIN_B19_DISPLAY_CONTRACTS } from "./fin-b19-display-contracts.mjs";

const ORG = "org-a";
const OTHER = "org-b";

const SCHEMA = `
CREATE TABLE orgs (id TEXT);
CREATE TABLE pipelines (id TEXT, org_id TEXT, key TEXT);
CREATE TABLE pipeline_stages (id TEXT, org_id TEXT, pipeline_id TEXT);
CREATE TABLE clients (id TEXT, org_id TEXT, is_demo INTEGER, custom_fields TEXT, channel_source TEXT);
CREATE TABLE client_custom_fields (client_id TEXT, org_id TEXT, utm_campaign TEXT, utm_source TEXT, cf_setter_user_id TEXT);
CREATE TABLE partners (id TEXT, org_id TEXT);
CREATE TABLE cards (id TEXT, org_id TEXT, client_id TEXT, partner_id TEXT, pipeline_id TEXT, stage_id TEXT, is_demo INTEGER);
CREATE TABLE candidate_applications (id TEXT, org_id TEXT, stage_id TEXT);
CREATE TABLE call_outcomes (id TEXT, org_id TEXT, client_id TEXT, logged_at TEXT, belief_failed TEXT);
CREATE TABLE staff (id TEXT, org_id TEXT, avatar_key TEXT);
CREATE TABLE marketing_flags (id TEXT, org_id TEXT, flagged_by TEXT, belief TEXT, lead_source TEXT, setter_label TEXT,
  outcome_count INTEGER, period_start TEXT, period_end TEXT, note TEXT, is_demo INTEGER);
CREATE TABLE brain_drive_sync (org_id TEXT, page_token TEXT, last_sync_at TEXT, last_error TEXT);
CREATE TABLE org_brand (org_id TEXT, wordmark_url TEXT);
CREATE TABLE partner_brand (org_id TEXT, partner_id TEXT, wordmark_url TEXT, approval_status TEXT);
`;

function stand() {
  const db = new DatabaseSync(":memory:");
  db.exec(SCHEMA);
  // regexp_replace is a function in Postgres too, written the same way in the SQL. The pattern text is the
  // same text Postgres reads (\s inside a bracket is the same in both); only the engine behind it is JavaScript's.
  db.function("regexp_replace", { deterministic: true }, (text, pattern, replacement, flags) => {
    const f = String(flags || "");
    return String(text).replace(new RegExp(pattern, `${f.includes("g") ? "g" : ""}${f.includes("i") ? "i" : ""}`), replacement);
  });
  db.prepare("INSERT INTO orgs (id) VALUES (?)").run(ORG);
  db.prepare("INSERT INTO orgs (id) VALUES (?)").run(OTHER);
  const insert = (table, row) => {
    const keys = Object.keys(row);
    db.prepare(`INSERT INTO ${table} (${keys.join(",")}) VALUES (${keys.map(() => "?").join(",")})`).run(...keys.map((k) => row[k]));
  };
  // What the lane calls: query(sql, [orgId]) -> { rows: [{ sample_count, bad_count }] }.
  const adapter = {
    async query(sql, params) {
      const text = sql.replace(/::(uuid|int|text)\b/g, "");
      const row = db.prepare(text).get({ $1: params[0] });
      return { rows: [{ sample_count: Number(row.sample_count), bad_count: Number(row.bad_count) }] };
    },
  };
  return { db, insert, adapter };
}

const contract = (control) => {
  const found = DISPLAY_RESULT_CASES.find((c) => c.control === control);
  assert.ok(found, `no contract case for ${control}`);
  return found;
};
const stats = async (control, s, text = null) => {
  const entry = contract(control);
  const out = await s.adapter.query(text || entry.contract.sql, [ORG]);
  return out.rows[0];
};
const verdict = async (control, s) => judgeDisplayResult(contract(control), await stats(control, s));

// ---- rails -----------------------------------------------------------------------------------------------

const RAILS = FIN_B19_DISPLAY_CONTRACTS.filter((c) => c.control.startsWith("Rail tab "));
const KEYS = {
  "Rail tab R-01 Sales": "sales",
  "Rail tab R-02 Funding: Card Stacking": "funding_card_stacking",
  "Rail tab R-04 Optimization (Repair) Rounds": "optimization",
  "Rail tab R-05 Inquiry Removal": "inquiry_removal",
  "Rail tab R-06 AR / Collections": "ar_collections",
  "Rail tab R-08 Affiliates + White Label": "affiliates_white_label",
  "Rail tab R-09 Hiring": "hiring",
};

// One rail as the company has it: its pipeline, two columns, a client and a partner of the company.
// good() / partner() add a card that the board would show.
function seedRail(s, key, { org = ORG, tag = key, stages = 2 } = {}) {
  s.insert("pipelines", { id: `p-${tag}`, org_id: org, key });
  for (let i = 1; i <= stages; i += 1) s.insert("pipeline_stages", { id: `st-${tag}-${i}`, org_id: org, pipeline_id: `p-${tag}` });
  s.insert("clients", { id: `cl-${tag}`, org_id: org, is_demo: 0, custom_fields: "{}" });
  s.insert("partners", { id: `pa-${tag}`, org_id: org });
  return {
    good: () => s.insert("cards", { id: `cd-${tag}-g`, org_id: org, client_id: `cl-${tag}`, partner_id: null, pipeline_id: `p-${tag}`, stage_id: `st-${tag}-1` }),
    partner: () => s.insert("cards", { id: `cd-${tag}-p`, org_id: org, client_id: null, partner_id: `pa-${tag}`, pipeline_id: `p-${tag}`, stage_id: `st-${tag}-2` }),
  };
}

test("all seven rail checks are registered once, with their own rail key in the SQL", () => {
  assert.equal(RAILS.length, 7);
  assert.deepEqual(RAILS.map((c) => c.control), Object.keys(KEYS));
  for (const c of RAILS) {
    assert.equal(c.mode, "query");
    assert.equal(c.emptyAs, "quiet");
    assert.equal(c.sql.split(`p.key = '${KEYS[c.control]}'`).length - 1, 1, `${c.control}: the cards read`);
    assert.ok(c.sql.includes(`p0.key = '${KEYS[c.control]}'`), `${c.control}: the rail's own pipeline read`);
    assert.match(c.sql, /\/\* display-result:fin-b19-rail-[a-z0-9-]+ \*\//);
    // Only the Hiring tab also reads job applications.
    assert.equal(c.sql.includes("candidate_applications"), KEYS[c.control] === "hiring", c.control);
  }
  assert.equal(new Set(RAILS.map((c) => c.sql)).size, 7);
});

for (const [control, key] of Object.entries(KEYS)) {
  test(`${control}: green on a rail with its columns, red when the rail or its columns are missing, red on a card the board would drop`, async () => {
    // A rail with its columns and no cards yet is one good result (the rail itself) and green.
    const empty = stand();
    seedRail(empty, key);
    assert.deepEqual(await stats(control, empty), { sample_count: 1, bad_count: 0 });
    assert.equal((await verdict(control, empty)).status, "PASS");

    // The company has no such pipeline: the tab answers "unknown_pipeline" and paints nothing. Red with no
    // card at all (the checker's stand-in with no pipeline row used to read green and quiet).
    const noRail = stand();
    assert.deepEqual(await stats(control, noRail), { sample_count: 1, bad_count: 1 });
    const missing = await verdict(control, noRail);
    assert.equal(missing.status, "FAIL");
    assert.match(missing.detail, /1 of 1 saved result failed the exact check/);

    // The pipeline is there and has no columns: the same 404, the same red.
    const noColumns = stand();
    seedRail(noColumns, key, { stages: 0 });
    assert.deepEqual(await stats(control, noColumns), { sample_count: 1, bad_count: 1 });
    assert.equal((await verdict(control, noColumns)).status, "FAIL");

    // Another company's rail is not this company's rail.
    const theirs = stand();
    seedRail(theirs, key, { org: OTHER, tag: "theirs" });
    assert.deepEqual(await stats(control, theirs), { sample_count: 1, bad_count: 1 });

    // A client card and a partner card, both in a column of this rail: green, and counted.
    const good = stand();
    const cards = seedRail(good, key);
    cards.good();
    cards.partner();
    assert.deepEqual(await stats(control, good), { sample_count: 3, bad_count: 0 });
    assert.equal((await verdict(control, good)).status, "PASS");

    // A card whose column belongs to a different pipeline is on the rail in the database and missing from the screen.
    const wrongStage = stand();
    seedRail(wrongStage, key).good();
    wrongStage.insert("pipelines", { id: "p-other", org_id: ORG, key: "something_else" });
    wrongStage.insert("pipeline_stages", { id: "st-other", org_id: ORG, pipeline_id: "p-other" });
    wrongStage.db.prepare("UPDATE cards SET stage_id = 'st-other' WHERE id = ?").run(`cd-${key}-g`);
    assert.deepEqual(await stats(control, wrongStage), { sample_count: 2, bad_count: 1 });
    const red = await verdict(control, wrongStage);
    assert.equal(red.status, "FAIL");
    assert.match(red.detail, /1 of 2 saved results failed the exact check/);

    // A card of this company whose client belongs to ANOTHER company: the board joins the client within the
    // company, finds nobody, and drops the card. In the database it is on the rail; on the screen it is missing.
    const strangerClient = stand();
    seedRail(strangerClient, key).good();
    strangerClient.insert("clients", { id: "cl-stranger", org_id: OTHER, is_demo: 0, custom_fields: "{}" });
    strangerClient.db.prepare("UPDATE cards SET client_id = 'cl-stranger' WHERE id = ?").run(`cd-${key}-g`);
    assert.deepEqual(await stats(control, strangerClient), { sample_count: 2, bad_count: 1 }, "client of another company");

    // The same for the partner a card names (the Affiliates + White Label rail lives on this).
    const strangerPartner = stand();
    seedRail(strangerPartner, key).partner();
    strangerPartner.insert("partners", { id: "pa-stranger", org_id: OTHER });
    strangerPartner.db.prepare("UPDATE cards SET partner_id = 'pa-stranger' WHERE id = ?").run(`cd-${key}-p`);
    assert.deepEqual(await stats(control, strangerPartner), { sample_count: 2, bad_count: 1 }, "partner of another company");

    // A card of this company that sits on another company's pipeline of this key.
    const strangerRail = stand();
    seedRail(strangerRail, key).good();
    strangerRail.insert("pipelines", { id: "p-foreign", org_id: OTHER, key });
    strangerRail.insert("pipeline_stages", { id: "st-foreign", org_id: OTHER, pipeline_id: "p-foreign" });
    strangerRail.db.prepare("UPDATE cards SET pipeline_id = 'p-foreign', stage_id = 'st-foreign' WHERE id = ?").run(`cd-${key}-g`);
    assert.deepEqual(await stats(control, strangerRail), { sample_count: 2, bad_count: 1 }, "pipeline of another company");

    // A demo client, a demo card and an archived client are left off the board on purpose: not counted, not wrong.
    const apart = stand();
    seedRail(apart, key).good();
    apart.insert("clients", { id: "cl-demo", org_id: ORG, is_demo: 1, custom_fields: "{}" });
    apart.insert("cards", { id: "cd-demo", org_id: ORG, client_id: "cl-demo", partner_id: null, pipeline_id: `p-${key}`, stage_id: "st-missing" });
    apart.insert("clients", { id: "cl-arch", org_id: ORG, is_demo: 0, custom_fields: '{"crm_archived_at":"2026-10-01"}' });
    apart.insert("cards", { id: "cd-arch", org_id: ORG, client_id: "cl-arch", partner_id: null, pipeline_id: `p-${key}`, stage_id: "st-missing" });
    apart.insert("cards", { id: "cd-demo-card", org_id: ORG, client_id: `cl-${key}`, partner_id: null, pipeline_id: `p-${key}`, stage_id: "st-missing", is_demo: 1 });
    // And another company's own good card on its own rail is not read at all.
    seedRail(apart, key, { org: OTHER, tag: `${key}-theirs` }).good();
    assert.deepEqual(await stats(control, apart), { sample_count: 2, bad_count: 0 });
  });
}

test("a rail check reads only its own rail: a wrong card on Sales does not turn the Affiliates tab red", async () => {
  const s = stand();
  seedRail(s, "sales").good();
  seedRail(s, "affiliates_white_label").partner();
  s.insert("pipelines", { id: "p-x", org_id: ORG, key: "elsewhere" });
  s.insert("pipeline_stages", { id: "st-x", org_id: ORG, pipeline_id: "p-x" });
  s.db.prepare("UPDATE cards SET stage_id = 'st-x' WHERE id = 'cd-sales-g'").run();
  assert.equal((await stats("Rail tab R-01 Sales", s)).bad_count, 1);
  assert.deepEqual(await stats("Rail tab R-08 Affiliates + White Label", s), { sample_count: 2, bad_count: 0 });
});

test("Hiring tab: a job application on a Hiring column is a person the tab does not show, so it is red; none is green", async () => {
  const control = "Rail tab R-09 Hiring";
  // The company has its Hiring rail and no applicant: green.
  const none = stand();
  seedRail(none, "hiring");
  assert.deepEqual(await stats(control, none), { sample_count: 1, bad_count: 0 });
  assert.equal((await verdict(control, none)).status, "PASS");

  // Applicants are saved on the rail's own columns (hiring.html reads them) and no card names a candidate.
  // This is the stand-in the checker used: 25 applications on the hiring pipeline and no card.
  const apps = stand();
  seedRail(apps, "hiring");
  for (let i = 0; i < 25; i += 1) apps.insert("candidate_applications", { id: `app-${i}`, org_id: ORG, stage_id: `st-hiring-${(i % 2) + 1}` });
  assert.deepEqual(await stats(control, apps), { sample_count: 26, bad_count: 25 });
  const red = await verdict(control, apps);
  assert.equal(red.status, "FAIL");
  assert.match(red.detail, /25 of 26 saved results failed the exact check/);

  // Another company's applicants, and an application on some other pipeline's column, are not this tab's.
  const apart = stand();
  seedRail(apart, "hiring");
  seedRail(apart, "hiring", { org: OTHER, tag: "theirs" });
  apart.insert("candidate_applications", { id: "app-theirs", org_id: OTHER, stage_id: "st-theirs-1" });
  apart.insert("pipelines", { id: "p-else", org_id: ORG, key: "something_else" });
  apart.insert("pipeline_stages", { id: "st-else", org_id: ORG, pipeline_id: "p-else" });
  apart.insert("candidate_applications", { id: "app-else", org_id: ORG, stage_id: "st-else" });
  assert.deepEqual(await stats(control, apart), { sample_count: 1, bad_count: 0 });

  // No other rail looks at applications: the same applicants leave every other tab green.
  for (const other of Object.keys(KEYS).filter((c) => c !== control)) {
    const s = stand();
    seedRail(s, KEYS[other]);
    s.insert("candidate_applications", { id: "app-x", org_id: ORG, stage_id: `st-${KEYS[other]}-1` });
    assert.equal((await stats(other, s)).bad_count, 0, other);
  }
});

// ---- the sales floor flag --------------------------------------------------------------------------------

const FLAG = "'Flag <belief>' button: stores a belief x source row for marketing";
const note = (label, now, last) => `Flagged from sales floor \u2014 ${label} this period ${now} vs last ${last}`;
const PERIOD_END = "2026-11-01T00:00:00.000Z";

// A client of ORG with one logged call, cut by utm_campaign "meta" and setter "josh": the source and setter
// a flag may honestly name. A second client is cut by the channel only, and a third by nothing at all.
function seedCalls(s) {
  s.insert("clients", { id: "k1", org_id: ORG, is_demo: 0, custom_fields: "{}", channel_source: "organic" });
  s.insert("client_custom_fields", { client_id: "k1", org_id: ORG, utm_campaign: "meta", utm_source: "facebook", cf_setter_user_id: "josh" });
  s.insert("call_outcomes", { id: "o1", org_id: ORG, client_id: "k1", logged_at: "2026-10-05T10:00:00.000Z", belief_failed: "cost" });
  s.insert("clients", { id: "k2", org_id: ORG, is_demo: 0, custom_fields: "{}", channel_source: "referral" });
  s.insert("call_outcomes", { id: "o2", org_id: ORG, client_id: "k2", logged_at: "2026-10-06T10:00:00.000Z", belief_failed: "trust" });
  s.insert("clients", { id: "k3", org_id: ORG, is_demo: 0, custom_fields: "{}", channel_source: null });
  s.insert("call_outcomes", { id: "o3", org_id: ORG, client_id: "k3", logged_at: "2026-10-07T10:00:00.000Z", belief_failed: "cost" });
}
const flagRow = (id, extra = {}) => ({
  id, org_id: ORG, flagged_by: "st-1", belief: "cost", lead_source: "meta", setter_label: "josh", outcome_count: 5,
  period_start: "2026-10-01T00:00:00.000Z", period_end: PERIOD_END, note: note('Cost \u00b7 "not right now"', 5, 2), is_demo: 0, ...extra,
});

test("Flag: quiet with none, green on a flag that names its own belief, count and a real source, red on any of those wrong", async () => {
  const s = stand();
  assert.equal((await verdict(FLAG, s)).status, "PASS");

  s.insert("staff", { id: "st-1", org_id: ORG, avatar_key: null });
  seedCalls(s);
  s.insert("marketing_flags", flagRow("f1"));
  // Not filed from the sales floor, and a demo row: neither is this control's result.
  s.insert("marketing_flags", flagRow("f2", { note: "from the api", belief: "pain", lead_source: "made-up" }));
  s.insert("marketing_flags", flagRow("f3", { flagged_by: "nobody", is_demo: 1, lead_source: "made-up" }));
  assert.deepEqual(await stats(FLAG, s), { sample_count: 1, bad_count: 0 });
  assert.equal((await verdict(FLAG, s)).status, "PASS");

  const bad = async (id, extra, why) => {
    s.insert("marketing_flags", flagRow(id, extra));
    assert.deepEqual(await stats(FLAG, s), { sample_count: 2, bad_count: 1 }, why);
    assert.equal((await verdict(FLAG, s)).status, "FAIL", why);
    s.db.prepare("DELETE FROM marketing_flags WHERE id = ?").run(id);
  };
  // The page sent one count in the row and another in the note.
  await bad("f4", { outcome_count: 7, note: note("Doubt", 3, 1), belief: "doubt" }, "a different count in the note");
  // The row saved one belief and the note names another: the flag says Cost and was filed as Pain.
  await bad("f5", { belief: "pain" }, "belief pain, note says Cost");
  // The belief in the note is written as its key when the floor has no label.
  s.insert("marketing_flags", flagRow("f6", { belief: "trust", note: note("trust", 5, 2), lead_source: "referral", setter_label: "unknown" }));
  assert.deepEqual(await stats(FLAG, s), { sample_count: 2, bad_count: 0 }, "key spelled as the note's belief is the same belief");
  s.db.prepare("DELETE FROM marketing_flags WHERE id = 'f6'").run();
  // A flag with no source and no setter at all (the checker's stand-in: both NULL).
  await bad("f7", { lead_source: null, setter_label: null }, "no source, no setter");
  await bad("f8", { lead_source: null }, "no source");
  await bad("f9", { setter_label: null }, "no setter");
  // A source that no call of this company has.
  await bad("f10", { lead_source: "invented-campaign" }, "made-up source");
  await bad("f11", { setter_label: "nobody" }, "made-up setter");
  // A real source with a setter from a different call is a pair no call has.
  await bad("f12", { lead_source: "referral", setter_label: "josh" }, "a pair no call has");
  // The "unknown" source and setter are real when a call has no campaign, source, channel or setter.
  s.insert("marketing_flags", flagRow("f13", { lead_source: "unknown", setter_label: "unknown" }));
  assert.deepEqual(await stats(FLAG, s), { sample_count: 2, bad_count: 0 }, "calls with nothing recorded are cut by unknown");
  s.db.prepare("DELETE FROM marketing_flags WHERE id = 'f13'").run();
  // A call only counts when it was logged before the period ended: a source first seen after is not one.
  // (Both flags of "meta" and "josh" lose their only call, so both go red.)
  s.db.prepare("UPDATE call_outcomes SET logged_at = '2026-12-01T00:00:00.000Z' WHERE id = 'o1'").run();
  s.insert("marketing_flags", flagRow("f14"));
  assert.deepEqual(await stats(FLAG, s), { sample_count: 2, bad_count: 2 }, "the only call with that source came after the period");
  s.db.prepare("DELETE FROM marketing_flags WHERE id = 'f14'").run();
  s.db.prepare("UPDATE call_outcomes SET logged_at = '2026-10-05T10:00:00.000Z' WHERE id = 'o1'").run();
  assert.deepEqual(await stats(FLAG, s), { sample_count: 1, bad_count: 0 });

  // Filed by a staff member who is not in this company.
  s.insert("staff", { id: "st-x", org_id: OTHER, avatar_key: null });
  await bad("f15", { flagged_by: "st-x" }, "a staff member of another company");

  // Another company's flag is not read at all.
  s.insert("marketing_flags", flagRow("f16", { org_id: OTHER, lead_source: "made-up" }));
  assert.deepEqual(await stats(FLAG, s), { sample_count: 1, bad_count: 0 });
});

// ---- the Drive sync --------------------------------------------------------------------------------------

const SYNC = "'Sync recordings from Drive': scans Drive, indexes Meet files, reloads the floor";

test("Sync: quiet before the first scan, green after a finished scan, red on a saved error or a missing cursor", async () => {
  const s = stand();
  assert.equal((await verdict(SYNC, s)).status, "PASS");
  s.insert("brain_drive_sync", { org_id: ORG, page_token: "tok-1", last_sync_at: "2026-10-14T10:00:00Z", last_error: null });
  assert.deepEqual(await stats(SYNC, s), { sample_count: 1, bad_count: 0 });
  assert.equal((await verdict(SYNC, s)).status, "PASS");

  s.db.prepare("UPDATE brain_drive_sync SET last_error = 'page_token_expired', page_token = NULL WHERE org_id = ?").run(ORG);
  assert.deepEqual(await stats(SYNC, s), { sample_count: 1, bad_count: 1 });
  assert.equal((await verdict(SYNC, s)).status, "FAIL");

  // An error with a cursor still held is wrong; a cursor missing with no error is wrong too.
  s.db.prepare("UPDATE brain_drive_sync SET last_error = 'boom', page_token = 'tok-2'").run();
  assert.equal((await stats(SYNC, s)).bad_count, 1);
  s.db.prepare("UPDATE brain_drive_sync SET last_error = NULL, page_token = NULL").run();
  assert.equal((await stats(SYNC, s)).bad_count, 1);
  s.db.prepare("UPDATE brain_drive_sync SET last_error = NULL, page_token = 'tok-3', last_sync_at = NULL").run();
  assert.equal((await stats(SYNC, s)).bad_count, 1);

  // Another company's scan state is not this company's.
  const other = stand();
  other.insert("brain_drive_sync", { org_id: OTHER, page_token: null, last_sync_at: "x", last_error: "boom" });
  assert.deepEqual(await stats(SYNC, other), { sample_count: 0, bad_count: 0 });
});

// ---- the staff photo -------------------------------------------------------------------------------------

const PHOTO = "Account chip: add or change your photo (hidden file input, PNG or JPEG)";
const HEX = "a".repeat(64);

test("Photo: quiet with no photos, green on a photo in the person's own folder, red under another person or a wrong file type", async () => {
  const s = stand();
  assert.equal((await verdict(PHOTO, s)).status, "PASS");
  s.insert("staff", { id: "s1", org_id: ORG, avatar_key: `memory://staff-avatars/${ORG}/s1/${HEX}.png` });
  s.insert("staff", { id: "s2", org_id: ORG, avatar_key: `https://blob.example.test/staff-avatars/${ORG}/s2/${HEX}.jpg` });
  s.insert("staff", { id: "s3", org_id: ORG, avatar_key: null });
  s.insert("staff", { id: "s4", org_id: OTHER, avatar_key: "garbage" });
  assert.deepEqual(await stats(PHOTO, s), { sample_count: 2, bad_count: 0 });
  assert.equal((await verdict(PHOTO, s)).status, "PASS");

  // A photo that landed in somebody else's folder.
  s.db.prepare("UPDATE staff SET avatar_key = ? WHERE id = 's2'").run(`memory://staff-avatars/${ORG}/s1/${HEX}.png`);
  assert.deepEqual(await stats(PHOTO, s), { sample_count: 2, bad_count: 1 });
  assert.equal((await verdict(PHOTO, s)).status, "FAIL");
  // A photo kept under another company's folder.
  s.db.prepare("UPDATE staff SET avatar_key = ? WHERE id = 's2'").run(`memory://staff-avatars/${OTHER}/s2/${HEX}.png`);
  assert.equal((await stats(PHOTO, s)).bad_count, 1);
  // Right folder, wrong kind of file.
  s.db.prepare("UPDATE staff SET avatar_key = ? WHERE id = 's2'").run(`memory://staff-avatars/${ORG}/s2/${HEX}.pdf`);
  assert.equal((await stats(PHOTO, s)).bad_count, 1);
});

// ---- the brand logo --------------------------------------------------------------------------------------

const BRAND = "Brand paint: company colors and logo applied to the chrome";
// The very function the chrome uses (safeWordmark in public/app/shell.js), cut out of the shipped file and run
// here, so the SQL is held to the chrome's own rule and not to a copy of it written in this test.
let chromeFn = null;
function chromeRule() {
  if (chromeFn) return chromeFn;
  const text = fs.readFileSync(new URL("../../../../public/app/shell.js", import.meta.url), "utf8");
  const start = text.indexOf("function safeWordmark(url) {");
  const end = text.indexOf("\n  }\n", start) + 4;
  assert.ok(start > 0 && end > start, "safeWordmark is still in shell.js");
  chromeFn = new Function(`${text.slice(start, end)}; return safeWordmark;`)();
  return chromeFn;
}
const refusedByChrome = (value) => chromeRule()(value) === null;

test("Brand: quiet with no logo, green on every logo the chrome paints, red on every logo it refuses (the chrome's own function decides)", async () => {
  const s = stand();
  assert.equal((await verdict(BRAND, s)).status, "PASS");
  s.insert("org_brand", { org_id: ORG, wordmark_url: null });
  s.insert("org_brand", { org_id: OTHER, wordmark_url: "http://nope" });
  assert.deepEqual(await stats(BRAND, s), { sample_count: 0, bad_count: 0 }, "no logo, and another company's logo, are not judged");
  const painted = [
    "https://cdn.example.test/logo.svg", "HTTPS://cdn.example.test/logo.png", "data:image/png;base64,iVBORw0KGgo=",
    "  https://cdn.example.test/logo.svg  ", "\thttps://cdn.example.test/logo.svg\n", "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=",
  ];
  const refused = [
    "http://cdn.example.test/logo.svg", "/assets/logo.svg", "javascript:alert(1)", "https://cdn.example.test/a b.svg",
    'https://cdn.example.test/a"b.svg', "https://cdn.example.test/a'b.svg", "https://cdn.example.test/a(b).svg",
    "https://cdn.example.test/<b>.svg", "data:text/html;base64,AAAA",
    // The ones the first version of this check read as fine: refused by the chrome, not by its looser rule.
    "https://", "data:image/png;base64,", "data:image/png;base64,abc-def_ghi", "data:image/png;base64,@@@@",
    "DATA:IMAGE/PNG;BASE64,AAAA", "data:image/;base64,AAAA", "https://cdn.example.test/a\tb.svg", "https://cdn.example.test/a\nb.svg",
  ];
  for (const value of painted) {
    assert.equal(refusedByChrome(value), false, `the chrome paints ${JSON.stringify(value)}`);
    s.db.prepare("DELETE FROM org_brand WHERE org_id = ?").run(ORG);
    s.insert("org_brand", { org_id: ORG, wordmark_url: value });
    assert.deepEqual(await stats(BRAND, s), { sample_count: 1, bad_count: 0 }, JSON.stringify(value));
  }
  for (const value of refused) {
    assert.equal(refusedByChrome(value), true, `the chrome refuses ${JSON.stringify(value)}`);
    s.db.prepare("DELETE FROM org_brand WHERE org_id = ?").run(ORG);
    s.insert("org_brand", { org_id: ORG, wordmark_url: value });
    assert.deepEqual(await stats(BRAND, s), { sample_count: 1, bad_count: 1 }, JSON.stringify(value));
    assert.equal((await verdict(BRAND, s)).status, "FAIL", JSON.stringify(value));
  }
});

test("Brand: a partner's approved logo is judged the same way, an unapproved one is not painted so it is not judged", async () => {
  const s = stand();
  s.insert("partner_brand", { org_id: ORG, partner_id: "pa-1", wordmark_url: "https://cdn.example.test/p.svg", approval_status: "approved" });
  s.insert("partner_brand", { org_id: ORG, partner_id: "pa-2", wordmark_url: "javascript:alert(1)", approval_status: "draft" });
  s.insert("partner_brand", { org_id: ORG, partner_id: "pa-3", wordmark_url: "javascript:alert(1)", approval_status: "review" });
  s.insert("partner_brand", { org_id: OTHER, partner_id: "pa-4", wordmark_url: "javascript:alert(1)", approval_status: "approved" });
  s.insert("partner_brand", { org_id: ORG, partner_id: "pa-5", wordmark_url: null, approval_status: "approved" });
  assert.deepEqual(await stats(BRAND, s), { sample_count: 1, bad_count: 0 });
  // An approved partner whose logo the chrome would refuse: the partner is approved and sees Fundhub's logo.
  s.db.prepare("UPDATE partner_brand SET wordmark_url = 'http://cdn.example.test/p.svg' WHERE partner_id = 'pa-1'").run();
  assert.deepEqual(await stats(BRAND, s), { sample_count: 1, bad_count: 1 });
  assert.equal((await verdict(BRAND, s)).status, "FAIL");
  // The org's own good logo beside it is counted and stays good.
  s.insert("org_brand", { org_id: ORG, wordmark_url: "https://cdn.example.test/logo.svg" });
  assert.deepEqual(await stats(BRAND, s), { sample_count: 2, bad_count: 1 });
});

// ---- the checks held in place: break each SQL on purpose and see the wrong row go unseen -----------------

const rail = (key, build) => (s) => { build(seedRail(s, key), s); };
const BREAKS = [
  // [control, text to find in the SQL, replacement, builder that adds one wrong row]
  [
    "Rail tab R-02 Funding: Card Stacking", "st.pipeline_id <> cd.pipeline_id", "1 = 0",
    rail("funding_card_stacking", (c, s) => {
      c.good();
      s.insert("pipelines", { id: "p-o", org_id: ORG, key: "x" });
      s.insert("pipeline_stages", { id: "st-o", org_id: ORG, pipeline_id: "p-o" });
      s.db.prepare("UPDATE cards SET stage_id = 'st-o'").run();
    }),
  ],
  [
    "Rail tab R-02 Funding: Card Stacking", "p.org_id <> cd.org_id", "1 = 0",
    rail("funding_card_stacking", (c, s) => {
      c.good();
      s.insert("pipelines", { id: "p-f", org_id: OTHER, key: "funding_card_stacking" });
      s.insert("pipeline_stages", { id: "st-f", org_id: OTHER, pipeline_id: "p-f" });
      s.db.prepare("UPDATE cards SET pipeline_id = 'p-f', stage_id = 'st-f'").run();
    }),
  ],
  [
    "Rail tab R-04 Optimization (Repair) Rounds", "AND c.org_id = cd.org_id", "",
    rail("optimization", (c, s) => {
      c.good();
      s.insert("clients", { id: "cl-x", org_id: OTHER, is_demo: 0, custom_fields: "{}" });
      s.db.prepare("UPDATE cards SET client_id = 'cl-x'").run();
    }),
  ],
  [
    "Rail tab R-08 Affiliates + White Label", "AND pr.org_id = cd.org_id", "",
    rail("affiliates_white_label", (c, s) => {
      c.partner();
      s.insert("partners", { id: "pa-x", org_id: OTHER });
      s.db.prepare("UPDATE cards SET partner_id = 'pa-x'").run();
    }),
  ],
  [
    "Rail tab R-05 Inquiry Removal", "OR (cd.client_id IS NOT NULL AND c.id IS NULL)", "",
    rail("inquiry_removal", (c, s) => {
      c.good();
      s.insert("clients", { id: "cl-x", org_id: OTHER, is_demo: 0, custom_fields: "{}" });
      s.db.prepare("UPDATE cards SET client_id = 'cl-x'").run();
    }),
  ],
  [
    "Rail tab R-09 Hiring", "SELECT 1 AS bad", "SELECT 0 AS bad",
    rail("hiring", (c, s) => { s.insert("candidate_applications", { id: "app-1", org_id: ORG, stage_id: "st-hiring-1" }); }),
  ],
  [
    FLAG, "f.note NOT LIKE ('% this period ' || f.outcome_count || ' vs last %')", "1 = 0", (s) => {
      s.insert("staff", { id: "st-1", org_id: ORG, avatar_key: null });
      seedCalls(s);
      s.insert("marketing_flags", flagRow("f", { outcome_count: 7, note: note("Cost", 3, 1) }));
    },
  ],
  [
    FLAG, "lower(f.note) NOT LIKE ('flagged from sales floor \u2014 ' || f.belief || '%')", "1 = 0", (s) => {
      s.insert("staff", { id: "st-1", org_id: ORG, avatar_key: null });
      seedCalls(s);
      s.insert("marketing_flags", flagRow("f", { belief: "pain" }));
    },
  ],
  [
    FLAG, "AND COALESCE(cf.utm_campaign, cf.utm_source, c.channel_source, 'unknown') = f.lead_source", "AND 1 = 1", (s) => {
      s.insert("staff", { id: "st-1", org_id: ORG, avatar_key: null });
      seedCalls(s);
      s.insert("marketing_flags", flagRow("f", { lead_source: "invented-campaign" }));
    },
  ],
  [
    FLAG, "AND COALESCE(cf.cf_setter_user_id, 'unknown') = f.setter_label", "AND 1 = 1", (s) => {
      s.insert("staff", { id: "st-1", org_id: ORG, avatar_key: null });
      seedCalls(s);
      s.insert("marketing_flags", flagRow("f", { setter_label: "nobody" }));
    },
  ],
  [
    FLAG, "s.id IS NULL\n         OR", "", (s) => {
      s.insert("staff", { id: "st-x", org_id: OTHER, avatar_key: null });
      seedCalls(s);
      s.insert("marketing_flags", flagRow("f", { flagged_by: "st-x" }));
    },
  ],
  [
    SYNC, "d.last_error IS NOT NULL OR ", "", (s) => {
      s.insert("brain_drive_sync", { org_id: ORG, page_token: "tok", last_sync_at: "x", last_error: "boom" });
    },
  ],
  [
    PHOTO, "s.avatar_key NOT LIKE ('%staff-avatars/' || s.org_id::text || '/' || s.id::text || '/%')", "1 = 0", (s) => {
      s.insert("staff", { id: "s1", org_id: ORG, avatar_key: `memory://staff-avatars/${ORG}/someone-else/${HEX}.png` });
    },
  ],
  [
    // The https test written looser than the chrome's: any text after https:// reads as a good address.
    BRAND, "'^https://[^\\s\"''<>()]+$'", "'^https://.*$'", (s) => {
      s.insert("org_brand", { org_id: ORG, wordmark_url: "https://cdn.example.test/a b.svg" });
    },
  ],
  [
    // The inline-image test written looser than the chrome's: any text after base64, reads as a good image.
    BRAND, "base64,[A-Za-z0-9+/=]+$'", "base64,.*$'", (s) => {
      s.insert("org_brand", { org_id: ORG, wordmark_url: "data:image/png;base64,@@@@" });
    },
  ],
  [
    BRAND, "AND pb.approval_status = 'approved'", "AND 1 = 0", (s) => {
      s.insert("partner_brand", { org_id: ORG, partner_id: "pa-1", wordmark_url: "http://cdn.example.test/p.svg", approval_status: "approved" });
    },
  ],
];

for (const [control, from, to, build] of BREAKS) {
  test(`breaking "${from.slice(0, 48).replace(/\n/g, " ")}" in ${control.slice(0, 40)} hides a wrong row the real SQL catches`, async () => {
    const entry = contract(control);
    assert.ok(entry.contract.sql.includes(from), "the SQL still contains the part this case breaks");
    const s = stand();
    build(s);
    const real = await s.adapter.query(entry.contract.sql, [ORG]);
    assert.ok(real.rows[0].bad_count >= 1, "the real SQL sees the wrong row");
    const broken = await s.adapter.query(entry.contract.sql.replace(from, () => to), [ORG]);
    assert.ok(broken.rows[0].bad_count < real.rows[0].bad_count, "with the condition removed the wrong row goes unseen");
  });
}

test("the rail SQL's own row: with the company's pipeline read broken, a company with no such rail reads green", async () => {
  // The same break the checker made with a stand-in that has no pipeline: take the missing-rail arm out and
  // the Hiring tab goes green on a company that has no Hiring rail. With the arm in, it is red (above).
  const entry = contract("Rail tab R-09 Hiring");
  const s = stand();
  const real = await s.adapter.query(entry.contract.sql, [ORG]);
  assert.deepEqual(real.rows[0], { sample_count: 1, bad_count: 1 });
  const broken = entry.contract.sql.replace("THEN 0 ELSE 1 END AS bad", "THEN 0 ELSE 0 END AS bad");
  assert.notEqual(broken, entry.contract.sql);
  assert.deepEqual((await s.adapter.query(broken, [ORG])).rows[0], { sample_count: 1, bad_count: 0 });
});

test("the logo check trims like the chrome: without the trim a logo the chrome paints would read as refused", async () => {
  const entry = contract(BRAND);
  const s = stand();
  s.insert("org_brand", { org_id: ORG, wordmark_url: "  https://cdn.example.test/logo.svg \n" });
  assert.deepEqual((await s.adapter.query(entry.contract.sql, [ORG])).rows[0], { sample_count: 1, bad_count: 0 });
  const raw = entry.contract.sql.split("regexp_replace(b.wordmark_url, '^\\s+|\\s+$', '', 'g')").join("b.wordmark_url");
  assert.notEqual(raw, entry.contract.sql);
  assert.deepEqual((await s.adapter.query(raw, [ORG])).rows[0], { sample_count: 1, bad_count: 1 });
});

// ---- through the lane ------------------------------------------------------------------------------------

test("through the lane: each of the 11 checks answers PASS on a clean database and FAIL once one wrong row is added", async () => {
  const ids = new Map(DISPLAY_RESULT_CASES.filter((c) => FIN_B19_DISPLAY_CONTRACTS.some((f) => f.mode === "query" && f.control === c.control)).map((c) => [c.control, c.id]));
  assert.equal(ids.size, 11);

  const clean = stand();
  for (const key of Object.values(KEYS)) { seedRail(clean, key).good(); }
  clean.insert("staff", { id: "st-1", org_id: ORG, avatar_key: `memory://staff-avatars/${ORG}/st-1/${HEX}.png` });
  seedCalls(clean);
  clean.insert("marketing_flags", flagRow("f1"));
  clean.insert("brain_drive_sync", { org_id: ORG, page_token: "tok", last_sync_at: "x", last_error: null });
  clean.insert("org_brand", { org_id: ORG, wordmark_url: "https://cdn.example.test/logo.svg" });
  const rows = await gapChecks({ db: clean.adapter, orgId: ORG, fetchImpl: null });
  const byId = new Map(rows.map((r) => [r.id, r]));
  for (const [control, id] of ids) {
    assert.equal(byId.get(id).status, "PASS", `${control}: ${byId.get(id).detail}`);
    assert.match(byId.get(id).detail, /saved results? passed the exact check/);
  }

  // One wrong row in each place: every one of the 11 goes red, and only its own.
  clean.db.prepare("UPDATE cards SET stage_id = (SELECT id FROM pipeline_stages WHERE pipeline_id <> cards.pipeline_id LIMIT 1)").run();
  clean.db.prepare("UPDATE marketing_flags SET outcome_count = 99").run();
  clean.db.prepare("UPDATE brain_drive_sync SET last_error = 'boom'").run();
  clean.db.prepare("UPDATE staff SET avatar_key = 'somewhere-else.png'").run();
  clean.db.prepare("UPDATE org_brand SET wordmark_url = 'http://x'").run();
  const red = new Map((await gapChecks({ db: clean.adapter, orgId: ORG, fetchImpl: null })).map((r) => [r.id, r]));
  for (const [control, id] of ids) assert.equal(red.get(id).status, "FAIL", control);
});
