// The consent clauses (owner decision 2026-10-20: the signed contract is the
// consent). The migration and the seed must hold exactly the words in
// consent-clauses.mjs, for exactly the client agreements, and must never touch a
// contract already sent or signed. The words themselves, as they land in each
// agreement, are checked in offer-fee-language.test.mjs, which rebuilds every
// wording from db/.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  CLIENT_AGREEMENT_KEYS, CONSENT_MARKERS, CONSENT_SECTION_NUMBERED, CONSENT_SECTION_PLAIN, NUMBERED_AGREEMENT_KEYS
} from "./consent-clauses.mjs";
import { DECK_CONTRACT_KEYS } from "../pulse/catalog/proofs/fin-b04-sql-flows.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const MIGRATION = fs.readFileSync(path.join(ROOT, "db/migrations/492_client_agreement_consent_clauses.sql"), "utf8");
const SEED = fs.readFileSync(path.join(ROOT, "db/seed/035_client_agreement_consent_clauses.sql"), "utf8");
const code = (sql) => sql.split("\n").filter((line) => !/^\s*--/.test(line)).join("\n");
const literal = (text) => `'${text.replace(/'/g, "''")}'`;

test("the client agreements are exactly the wordings the closer's deck can send", () => {
  assert.deepEqual([...CLIENT_AGREEMENT_KEYS].sort(), [...DECK_CONTRACT_KEYS].sort());
  for (const key of NUMBERED_AGREEMENT_KEYS) assert.ok(CLIENT_AGREEMENT_KEYS.includes(key));
});

test("each clause says what the owner asked for, in a sentence the heartbeat can find", () => {
  for (const section of [CONSENT_SECTION_PLAIN, CONSENT_SECTION_NUMBERED]) {
    for (const marker of Object.values(CONSENT_MARKERS)) {
      assert.equal(section.split(marker).length - 1, 1, `${marker} must appear once`);
    }
    assert.match(section, /recorded/);
    assert.match(section, /AI tools analyze your credit file/);
    assert.match(section, /AI agents work on your file/);
    assert.match(section, /AI may call you and text you/);
    assert.match(section, /testimonial in its marketing/);
    assert.match(section, /By signing, you agree to all three/);
    assert.doesNotMatch(section, /'/, "an apostrophe would need SQL doubling; keep the words plain");
  }
});

test("the migration adds the section to all six client agreements and nothing else", () => {
  const sql = code(MIGRATION);
  for (const key of CLIENT_AGREEMENT_KEYS) {
    const section = NUMBERED_AGREEMENT_KEYS.includes(key) ? CONSENT_SECTION_NUMBERED : CONSENT_SECTION_PLAIN;
    const statement = sql.split("UPDATE contract_templates").find((s) => s.includes(`WHERE template_key = '${key}'`))?.trim();
    assert.ok(statement, `${key} has no statement`);
    assert.ok(statement.includes(section), `${key}: the statement does not carry the exact section`);
    assert.ok(statement.includes(`strpos(body, ${literal(CONSENT_MARKERS.callRecording)}) = 0`), `${key}: not idempotent`);
  }
  assert.ok(sql.includes(CONSENT_SECTION_PLAIN));
  assert.doesNotMatch(sql, /UPDATE contracts\b|DELETE|ALTER TABLE|INSERT INTO|DROP /i);
  assert.doesNotMatch(sql, /EMPLOYEE-|PARTNER-LICENSE|SOFT-PULL-CONSENT/);
});

test("the seed repeats the two statements whose rows only seeds create on a fresh database", () => {
  const sql = code(SEED);
  for (const key of ["FUNDING-AGREEMENT", "FUNDING-MASTERY-AGREEMENT"]) {
    const ownStatement = (file) => code(file).split("UPDATE contract_templates").find((s) => s.includes(`WHERE template_key = '${key}'`))?.trim();
    assert.equal(ownStatement(SEED), ownStatement(MIGRATION), `${key}: seed and migration differ`);
  }
  assert.equal((sql.match(/WHERE template_key = '/g) || []).length, 2);
  assert.doesNotMatch(sql, /UPDATE contracts\b|DELETE|ALTER TABLE|INSERT INTO|DROP /i);
});
