// The gate's banker branch (495). Both directions: a saved banker who has not
// said stop is allowed; an unsaved address or an opted-out banker is blocked.
// The bank copy from the migration is run through the real restricted-word rules.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gate, BANK_OUTREACH_EMAIL_KEYS } from "./gate.mjs";
import { clearRuleCache } from "../compliance/screen.mjs";
import { BANK_EMAIL_KEYS } from "../outreach/mail.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ORG = "00000000-0000-4000-8000-000000000001";
const MIDDAY = () => new Date("2026-10-21T16:00:00Z");

function seededRules() {
  const sql = fs.readFileSync(path.join(HERE, "../../db/migrations/047_compliance_rules.sql"), "utf8");
  const block = sql.slice(sql.indexOf("CROSS JOIN (VALUES"), sql.indexOf("AS v(rule_set"));
  const re = /\(\s*'((?:[^']|'')*)'\s*,\s*'((?:[^']|'')*)'\s*,\s*'((?:[^']|'')*)'\s*,\s*'((?:[^']|'')*)'\s*,\s*'((?:[^']|'')*)'\s*,\s*'((?:[^']|'')*)'\s*,\s*'((?:[^']|'')*)'\s*,\s*'((?:[^']|'')*)'\s*,\s*'((?:[^']|'')*)'\s*\)/g;
  const rows = []; let m;
  while ((m = re.exec(block))) {
    const [, rule_set, rule_key, offer_types, platforms, match_type, pattern, severity, message, citation] = m;
    rows.push({ rule_set, rule_key, offer_types: JSON.parse(offer_types), platforms: JSON.parse(platforms), match_type, pattern: pattern.replace(/''/g, "'"), severity, message: message.replace(/''/g, "'"), citation });
  }
  assert.ok(rows.length > 5, "the seeded compliance rules were read");
  return rows;
}
const RULES = seededRules();

function fakeDb({ bankers = { saved: 1, opted_out: 0 } } = {}) {
  const seen = [];
  return {
    seen,
    query: async (sql, params) => {
      seen.push({ sql, params });
      if (sql.includes("FROM outreach_contacts")) return { rows: [bankers] };
      if (sql.includes("FROM compliance_rules")) return { rows: RULES };
      if (sql.includes("FROM tasks")) return { rows: [] };
      if (sql.includes("INSERT INTO tasks")) return { rows: [{ id: "00000000-0000-4000-8000-0000000000aa" }] };
      throw new Error(`unexpected query: ${sql.slice(0, 60)}`);
    }
  };
}
const msg = (over = {}) => ({ orgId: ORG, clientId: null, channel: "email", templateKey: "EMAIL-BANK-OUTREACH-1", toAddress: "banker@bank.example", body: "Hi Jane, Fundhub sends pre-verified clients.", ...over });
const codes = (res) => res.reasons.map((x) => x.code);

beforeEach(() => clearRuleCache());

test("the gate's banker keys are exactly the bank outreach keys", () => {
  assert.deepEqual([...BANK_OUTREACH_EMAIL_KEYS].sort(), [...BANK_EMAIL_KEYS].sort());
  assert.equal(BANK_EMAIL_KEYS.length, 7);
});

test("a saved banker who has not said stop is allowed, checked by org and address", async () => {
  const db = fakeDb();
  const res = await gate(db, msg(), { now: MIDDAY });
  assert.equal(res.state, "allowed", JSON.stringify(codes(res)));
  const probe = db.seen.find((q) => q.sql.includes("FROM outreach_contacts"));
  assert.deepEqual(probe.params, [ORG, "banker@bank.example"]);
});

test("an address that is not a saved banker is blocked", async () => {
  const res = await gate(fakeDb({ bankers: { saved: 0, opted_out: 0 } }), msg(), { now: MIDDAY });
  assert.equal(res.state, "blocked");
  assert.ok(codes(res).includes("recipient_unknown"));
});

test("a banker who said stop is blocked", async () => {
  const res = await gate(fakeDb({ bankers: { saved: 1, opted_out: 1 } }), msg(), { now: MIDDAY });
  assert.equal(res.state, "blocked");
  assert.ok(codes(res).includes("opted_out"));
});

test("a non-bank key with no client is still refused (no new door for other mail)", async () => {
  const res = await gate(fakeDb(), msg({ templateKey: "EMAIL-S00-WELCOME" }), { now: MIDDAY });
  assert.equal(res.state, "blocked");
  assert.ok(codes(res).includes("recipient_unknown"));
});

test("every bank email in migration 495 passes the restricted-word rules", async () => {
  const sql = fs.readFileSync(path.join(HERE, "../../db/migrations/495_bank_outreach_automation.sql"), "utf8");
  const bodies = [...sql.matchAll(/\('(EMAIL-BANK-OUTREACH-[A-Z0-9-]+)', '([^']*)',\s*\$c\$([\s\S]*?)\$c\$\)/g)];
  assert.equal(bodies.length, 7);
  for (const [, key, subject, body] of bodies) {
    const res = await gate(fakeDb(), msg({ templateKey: key, body: `${subject}\n${body}` }), { now: MIDDAY });
    assert.equal(res.state, "allowed", `${key}: ${JSON.stringify(codes(res))}`);
  }
});
