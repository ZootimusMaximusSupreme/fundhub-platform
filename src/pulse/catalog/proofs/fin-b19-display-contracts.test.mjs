// Tests for the batch 19 live checks. There is no local Postgres here, so the very SQL text each contract
// carries is run on SQLite (node:sqlite) over stand-in tables, after one small rewrite: the Postgres casts
// (::uuid, ::int, ::text) are dropped, since SQLite has none. The SQL was written in the part of the
// language both read the same way. Every check is shown green on good rows, red on a wrong row, quiet on
// no rows, and blind to another company's rows. A second set of tests breaks the SQL on purpose and shows
// the wrong row would then go unseen, so each condition is held in place by a case.

import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";

import { DISPLAY_RESULT_CASES, gapChecks, judgeDisplayResult } from "../../coverage/gap-catalog-display.mjs";
import { FIN_B19_DISPLAY_CONTRACTS } from "./fin-b19-display-contracts.mjs";

const ORG = "org-a";
const OTHER = "org-b";

const SCHEMA = `
CREATE TABLE pipelines (id TEXT, org_id TEXT, key TEXT);
CREATE TABLE pipeline_stages (id TEXT, org_id TEXT, pipeline_id TEXT);
CREATE TABLE clients (id TEXT, org_id TEXT, is_demo INTEGER, custom_fields TEXT);
CREATE TABLE partners (id TEXT, org_id TEXT);
CREATE TABLE cards (id TEXT, org_id TEXT, client_id TEXT, partner_id TEXT, pipeline_id TEXT, stage_id TEXT, is_demo INTEGER);
CREATE TABLE staff (id TEXT, org_id TEXT, avatar_key TEXT);
CREATE TABLE marketing_flags (id TEXT, org_id TEXT, flagged_by TEXT, belief TEXT, outcome_count INTEGER, note TEXT, is_demo INTEGER);
CREATE TABLE brain_drive_sync (org_id TEXT, page_token TEXT, last_sync_at TEXT, last_error TEXT);
CREATE TABLE org_brand (org_id TEXT, wordmark_url TEXT);
`;

function stand() {
  const db = new DatabaseSync(":memory:");
  db.exec(SCHEMA);
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

function seedRail(s, key, { org = ORG, tag = key } = {}) {
  s.insert("pipelines", { id: `p-${tag}`, org_id: org, key });
  s.insert("pipeline_stages", { id: `st-${tag}-1`, org_id: org, pipeline_id: `p-${tag}` });
  s.insert("pipeline_stages", { id: `st-${tag}-2`, org_id: org, pipeline_id: `p-${tag}` });
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
    assert.ok(c.sql.includes(`p.key = '${KEYS[c.control]}'`), c.control);
    assert.match(c.sql, /\/\* display-result:fin-b19-rail-[a-z0-9-]+ \*\//);
  }
  assert.equal(new Set(RAILS.map((c) => c.sql)).size, 7);
});

for (const [control, key] of Object.entries(KEYS)) {
  test(`${control}: quiet with no cards, green on good cards, red on a card the board would drop`, async () => {
    // No cards at all on this rail: nothing to judge, green until the first wrong card.
    const empty = stand();
    seedRail(empty, key);
    const quiet = await verdict(control, empty);
    assert.equal(quiet.status, "PASS");
    assert.match(quiet.detail, /no saved results yet, so none are wrong/);

    // A client card and a partner card, both in a column of this rail: green, and counted.
    const good = stand();
    const cards = seedRail(good, key);
    cards.good();
    cards.partner();
    assert.deepEqual(await stats(control, good), { sample_count: 2, bad_count: 0 });
    assert.equal((await verdict(control, good)).status, "PASS");

    // A card whose column belongs to a different pipeline is on the rail in the database and missing from the screen.
    const wrongStage = stand();
    const w = seedRail(wrongStage, key);
    w.good();
    wrongStage.insert("pipelines", { id: "p-other", org_id: ORG, key: "something_else" });
    wrongStage.insert("pipeline_stages", { id: "st-other", org_id: ORG, pipeline_id: "p-other" });
    wrongStage.db.prepare("UPDATE cards SET stage_id = 'st-other' WHERE id = ?").run(`cd-${key}-g`);
    assert.deepEqual(await stats(control, wrongStage), { sample_count: 1, bad_count: 1 });
    const red = await verdict(control, wrongStage);
    assert.equal(red.status, "FAIL");
    assert.match(red.detail, /1 of 1 saved result failed the exact check/);

    // A card whose column was deleted, and a card with no person, are wrong in the same way.
    const noStage = stand();
    const n = seedRail(noStage, key);
    n.good();
    noStage.db.prepare("DELETE FROM pipeline_stages WHERE id = ?").run(`st-${key}-1`);
    assert.equal((await stats(control, noStage)).bad_count, 1, "column gone");
    const noPerson = stand();
    const q = seedRail(noPerson, key);
    q.good();
    noPerson.db.prepare("UPDATE cards SET client_id = NULL, partner_id = NULL WHERE id = ?").run(`cd-${key}-g`);
    assert.equal((await stats(control, noPerson)).bad_count, 1, "no person");

    // A card of another company's client, a demo client, a demo card and an archived client are not part of the board's
    // answer for this company: not counted, not wrong.
    const apart = stand();
    const a = seedRail(apart, key);
    a.good();
    apart.insert("clients", { id: "cl-demo", org_id: ORG, is_demo: 1, custom_fields: "{}" });
    apart.insert("cards", { id: "cd-demo", org_id: ORG, client_id: "cl-demo", partner_id: null, pipeline_id: `p-${key}`, stage_id: "missing-stage" });
    apart.insert("clients", { id: "cl-arch", org_id: ORG, is_demo: 0, custom_fields: '{"crm_archived_at":"2026-10-01"}' });
    apart.insert("cards", { id: "cd-arch", org_id: ORG, client_id: "cl-arch", partner_id: null, pipeline_id: `p-${key}`, stage_id: "missing-stage" });
    apart.insert("cards", { id: "cd-demo-card", org_id: ORG, client_id: `cl-${key}`, partner_id: null, pipeline_id: `p-${key}`, stage_id: "missing-stage", is_demo: 1 });
    const theirs = seedRail(apart, key, { org: OTHER, tag: `${key}-theirs` });
    theirs.good();
    apart.db.prepare("UPDATE cards SET stage_id = 'nowhere' WHERE id = ?").run(`cd-${key}-theirs-g`);
    assert.deepEqual(await stats(control, apart), { sample_count: 1, bad_count: 0 });
  });
}

test("a rail check reads only its own rail: a wrong card on Sales does not turn the Hiring tab red", async () => {
  const s = stand();
  const sales = seedRail(s, "sales");
  sales.good();
  s.db.prepare("UPDATE cards SET stage_id = 'nowhere' WHERE id = 'cd-sales-g'").run();
  assert.equal((await stats("Rail tab R-01 Sales", s)).bad_count, 1);
  assert.equal((await stats("Rail tab R-09 Hiring", s)).bad_count, 0);
  assert.equal((await stats("Rail tab R-09 Hiring", s)).sample_count, 0);
});

// ---- the sales floor flag --------------------------------------------------------------------------------

const FLAG = "'Flag <belief>' button: stores a belief x source row for marketing";
const note = (label, now, last) => `Flagged from sales floor — ${label} this period ${now} vs last ${last}`;

test("Flag: quiet with none, green on a flag whose note carries its own count, red on a different count or a stranger", async () => {
  const s = stand();
  assert.equal((await verdict(FLAG, s)).status, "PASS");

  s.insert("staff", { id: "st-1", org_id: ORG, avatar_key: null });
  s.insert("marketing_flags", { id: "f1", org_id: ORG, flagged_by: "st-1", belief: "cost", outcome_count: 5, note: note("Cost", 5, 2), is_demo: 0 });
  // Not filed from the sales floor, and a demo row: neither is this control's result.
  s.insert("marketing_flags", { id: "f2", org_id: ORG, flagged_by: "st-1", belief: "pain", outcome_count: 9, note: "from the api", is_demo: 0 });
  s.insert("marketing_flags", { id: "f3", org_id: ORG, flagged_by: "nobody", belief: "pain", outcome_count: 1, note: note("Pain", 4, 1), is_demo: 1 });
  assert.deepEqual(await stats(FLAG, s), { sample_count: 1, bad_count: 0 });
  assert.equal((await verdict(FLAG, s)).status, "PASS");

  // The page sent one count in the row and another in the note.
  s.insert("marketing_flags", { id: "f4", org_id: ORG, flagged_by: "st-1", belief: "doubt", outcome_count: 7, note: note("Doubt", 3, 1), is_demo: 0 });
  assert.deepEqual(await stats(FLAG, s), { sample_count: 2, bad_count: 1 });
  assert.equal((await verdict(FLAG, s)).status, "FAIL");
  s.db.prepare("DELETE FROM marketing_flags WHERE id = 'f4'").run();

  // Filed by a staff member who is not in this company.
  s.insert("staff", { id: "st-x", org_id: OTHER, avatar_key: null });
  s.insert("marketing_flags", { id: "f5", org_id: ORG, flagged_by: "st-x", belief: "cost", outcome_count: 2, note: note("Cost", 2, 0), is_demo: 0 });
  assert.deepEqual(await stats(FLAG, s), { sample_count: 2, bad_count: 1 });

  // Another company's flag is not read at all.
  s.db.prepare("DELETE FROM marketing_flags WHERE id = 'f5'").run();
  s.insert("marketing_flags", { id: "f6", org_id: OTHER, flagged_by: "st-1", belief: "cost", outcome_count: 8, note: note("Cost", 1, 0), is_demo: 0 });
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

test("Brand: quiet with no brand, green on https and inline logos or no logo, red on a logo the chrome refuses", async () => {
  const s = stand();
  assert.equal((await verdict(BRAND, s)).status, "PASS");
  s.insert("org_brand", { org_id: ORG, wordmark_url: null });
  assert.deepEqual(await stats(BRAND, s), { sample_count: 1, bad_count: 0 });
  for (const ok of ["https://cdn.example.test/logo.svg", "HTTPS://cdn.example.test/logo.png", "data:image/png;base64,iVBORw0KGgo="]) {
    s.db.prepare("UPDATE org_brand SET wordmark_url = ?").run(ok);
    assert.equal((await stats(BRAND, s)).bad_count, 0, ok);
  }
  for (const refused of [
    "http://cdn.example.test/logo.svg", "/assets/logo.svg", "javascript:alert(1)", "https://cdn.example.test/a b.svg",
    'https://cdn.example.test/a"b.svg', "https://cdn.example.test/a'b.svg", "https://cdn.example.test/a(b).svg",
    "https://cdn.example.test/<b>.svg", "data:text/html;base64,AAAA",
  ]) {
    s.db.prepare("UPDATE org_brand SET wordmark_url = ?").run(refused);
    assert.equal((await stats(BRAND, s)).bad_count, 1, refused);
    assert.equal((await verdict(BRAND, s)).status, "FAIL", refused);
  }
  const other = stand();
  other.insert("org_brand", { org_id: OTHER, wordmark_url: "http://nope" });
  assert.deepEqual(await stats(BRAND, other), { sample_count: 0, bad_count: 0 });
});

// ---- the checks held in place: break each SQL on purpose and see the wrong row go unseen -----------------

const BREAKS = [
  // [control, text to find in the SQL, replacement, builder that adds one wrong row]
  [
    "Rail tab R-02 Funding: Card Stacking", "st.pipeline_id <> cd.pipeline_id", "1 = 0",
    (s) => {
      const c = seedRail(s, "funding_card_stacking"); c.good();
      s.insert("pipelines", { id: "p-o", org_id: ORG, key: "x" });
      s.insert("pipeline_stages", { id: "st-o", org_id: ORG, pipeline_id: "p-o" });
      s.db.prepare("UPDATE cards SET stage_id = 'st-o'").run();
    },
  ],
  [
    "Rail tab R-02 Funding: Card Stacking", "st.id IS NULL OR", "", (s) => {
      const c = seedRail(s, "funding_card_stacking"); c.good();
      s.db.prepare("DELETE FROM pipeline_stages WHERE id = 'st-funding_card_stacking-1'").run();
    },
  ],
  [
    "Rail tab R-01 Sales", "OR (c.id IS NULL AND pr.id IS NULL)", "", (s) => {
      const c = seedRail(s, "sales"); c.good();
      s.db.prepare("UPDATE cards SET client_id = NULL").run();
    },
  ],
  [
    FLAG, "f.note NOT LIKE ('% this period ' || f.outcome_count || ' vs last %')", "1 = 0", (s) => {
      s.insert("staff", { id: "st-1", org_id: ORG, avatar_key: null });
      s.insert("marketing_flags", { id: "f", org_id: ORG, flagged_by: "st-1", belief: "cost", outcome_count: 7, note: note("Cost", 3, 1), is_demo: 0 });
    },
  ],
  [
    FLAG, "s.id IS NULL\n         OR", "", (s) => {
      s.insert("staff", { id: "st-x", org_id: OTHER, avatar_key: null });
      s.insert("marketing_flags", { id: "f", org_id: ORG, flagged_by: "st-x", belief: "cost", outcome_count: 3, note: note("Cost", 3, 1), is_demo: 0 });
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
    BRAND, "lower(b.wordmark_url) LIKE 'https://%'", "lower(b.wordmark_url) LIKE 'http%'", (s) => {
      s.insert("org_brand", { org_id: ORG, wordmark_url: "http://cdn.example.test/logo.svg" });
    },
  ],
  [
    BRAND, "b.wordmark_url NOT LIKE '% %' AND ", "", (s) => {
      s.insert("org_brand", { org_id: ORG, wordmark_url: "https://cdn.example.test/a b.svg" });
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
    assert.equal(real.rows[0].bad_count, 1, "the real SQL sees the wrong row");
    const broken = await s.adapter.query(entry.contract.sql.replace(from, to), [ORG]);
    assert.equal(broken.rows[0].bad_count, 0, "with the condition removed the wrong row goes unseen");
  });
}

// ---- through the lane ------------------------------------------------------------------------------------

test("through the lane: each of the 11 checks answers PASS on a clean database and FAIL once one wrong row is added", async () => {
  const ids = new Map(DISPLAY_RESULT_CASES.filter((c) => FIN_B19_DISPLAY_CONTRACTS.some((f) => f.mode === "query" && f.control === c.control)).map((c) => [c.control, c.id]));
  assert.equal(ids.size, 11);

  const clean = stand();
  for (const key of Object.values(KEYS)) { const r = seedRail(clean, key); r.good(); }
  clean.insert("staff", { id: "st-1", org_id: ORG, avatar_key: `memory://staff-avatars/${ORG}/st-1/${HEX}.png` });
  clean.insert("marketing_flags", { id: "f1", org_id: ORG, flagged_by: "st-1", belief: "cost", outcome_count: 5, note: note("Cost", 5, 2), is_demo: 0 });
  clean.insert("brain_drive_sync", { org_id: ORG, page_token: "tok", last_sync_at: "x", last_error: null });
  clean.insert("org_brand", { org_id: ORG, wordmark_url: "https://cdn.example.test/logo.svg" });
  const rows = await gapChecks({ db: clean.adapter, orgId: ORG, fetchImpl: null });
  const byId = new Map(rows.map((r) => [r.id, r]));
  for (const [control, id] of ids) {
    assert.equal(byId.get(id).status, "PASS", `${control}: ${byId.get(id).detail}`);
    assert.match(byId.get(id).detail, /saved result passed the exact check/);
  }

  // One wrong row in each place: every one of the 11 goes red, and only its own.
  clean.db.prepare("UPDATE cards SET stage_id = 'nowhere'").run();
  clean.db.prepare("UPDATE marketing_flags SET outcome_count = 99").run();
  clean.db.prepare("UPDATE brain_drive_sync SET last_error = 'boom'").run();
  clean.db.prepare("UPDATE staff SET avatar_key = 'somewhere-else.png'").run();
  clean.db.prepare("UPDATE org_brand SET wordmark_url = 'http://x'").run();
  const red = new Map((await gapChecks({ db: clean.adapter, orgId: ORG, fetchImpl: null })).map((r) => [r.id, r]));
  for (const [control, id] of ids) assert.equal(red.get(id).status, "FAIL", control);
});
