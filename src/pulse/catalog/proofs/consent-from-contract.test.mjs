// The signed contract is the consent (owner decision 2026-10-20). Practice tests
// of the two consent rows and the withdraw row: the real SQL text runs over fake
// rows (fin-b04-sql-lite.mjs). A healthy company is clean, each single break is
// red, and dropping any one condition from a query changes the answer for some
// test row, so no condition is decoration.

import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { dropOneCondition, parseContract, readColumnCatalog, runContractSql, runParsed } from "./fin-b04-sql-lite.mjs";
import { ORG, NOW, otherCompany, together } from "./fin-b04-display-fixtures.mjs";
import {
  CONSENT_CALL_RECORDING_SQL, CONSENT_MARKETING_USE_SQL, CONSENT_REVOKE_SQL, CONSENT_FROM_CONTRACT_CONTRACTS
} from "./consent-from-contract.mjs";
import { displaySavedResultContract } from "./display-saved-result.mjs";
import { judgeDisplayResult } from "../../coverage/gap-catalog-display.mjs";
import {
  CLIENT_AGREEMENT_KEYS, CONSENT_MARKERS, CONSENT_SECTION_NUMBERED, CONSENT_SECTION_PLAIN, NUMBERED_AGREEMENT_KEYS
} from "../../../contracts/consent-clauses.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const CATALOG = readColumnCatalog(ROOT);
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const CLIENT = id(900);
const ACCOUNT = id(901);
const STAFF = id(902);
const CONTRACT = id(903);
const LONG_AGO = "2026-08-01T20:00:00.000Z";
const LATER = "2026-12-01T20:00:00.000Z";

const sectionFor = (key) => (NUMBERED_AGREEMENT_KEYS.includes(key) ? CONSENT_SECTION_NUMBERED : CONSENT_SECTION_PLAIN);
const agreedWords = (key) => `This agreement is made between the parties.\n\n${sectionFor(key)}\n\nSIGNATURES`;

function good() {
  return {
    orgs: [{ id: ORG }],
    contract_templates: CLIENT_AGREEMENT_KEYS.map((key, i) => ({
      id: id(800 + i), org_id: ORG, template_key: key, name: key, active: true, is_demo: false,
      source_kind: "text", body: agreedWords(key)
    })),
    clients: [{ id: CLIENT, org_id: ORG, email: "pat@example.test", is_demo: false }],
    contracts: [{
      id: CONTRACT, org_id: ORG, client_id: CLIENT, template_key: "FUNDING-AGREEMENT", status: "signed",
      is_demo: false, source_kind: "text", rendered_body: agreedWords("FUNDING-AGREEMENT")
    }],
    client_consents: []
  };
}

/** A consent recorded separately on the consent screen, well formed and live. */
const separate = (kind, extra = {}) => ({
  id: id(950), org_id: ORG, client_id: CLIENT, kind, consent_text: "I agree.", consent_version: "v1",
  capture_method: "typed", granted_by_kind: "client", granted_by_account_id: ACCOUNT, granted_by_staff_id: null,
  granted_at: LONG_AGO, expires_at: null, revoked_at: null, ...extra
});

const judge = (sql, tables) => {
  const out = runContractSql(sql, { tables, params: [ORG], now: NOW, catalog: CATALOG });
  return { sample: out.sample_count, bad: out.bad_count };
};

const dropSentence = (text, sentence) => text.split(sentence).join("");

function casesFor(kind, sentences) {
  const signedLacks = (t) => {
    for (const s of sentences) t.contracts[0].rendered_body = dropSentence(t.contracts[0].rendered_body, s);
  };
  const breaks = [
    ...sentences.flatMap((s) => [
      [`a client agreement wording lost "${s}"`, (t) => { t.contract_templates[2].body = dropSentence(t.contract_templates[2].body, s); }],
      [`a signed agreement lacks "${s}" and the client gave no separate consent`, (t) => {
        t.contracts[0].rendered_body = dropSentence(t.contracts[0].rendered_body, s);
      }]
    ]),
    ["a signed agreement has no words at all", (t) => { t.contracts[0].rendered_body = null; }],
    ["a wording has no words at all", (t) => { t.contract_templates[0].body = null; }],
    ["a signed agreement lacks the clause and the separate consent was withdrawn", (t) => {
      signedLacks(t); t.client_consents = [separate(kind, { revoked_at: LONG_AGO })];
    }],
    ["a signed agreement lacks the clause and the separate consent expired", (t) => {
      signedLacks(t); t.client_consents = [separate(kind, { expires_at: LONG_AGO })];
    }],
    ["a signed agreement lacks the clause and the separate consent starts in the future", (t) => {
      signedLacks(t); t.client_consents = [separate(kind, { granted_at: LATER })];
    }],
    ["a signed agreement lacks the clause and the separate consent is another kind", (t) => {
      signedLacks(t); t.client_consents = [separate(kind === "call_recording" ? "marketing_use" : "call_recording")];
    }],
    ["a signed agreement lacks the clause and the separate consent is another client's", (t) => {
      signedLacks(t); t.client_consents = [separate(kind, { client_id: id(999) })];
    }],
    ["a signed agreement lacks the clause and the only live consent sits in another company", (t) => {
      signedLacks(t); t.client_consents = [separate(kind, { org_id: "22222222-2222-4222-8222-222222222222" })];
    }],
    ["a separate consent has no words", (t) => { t.client_consents = [separate(kind, { consent_text: " " })]; }],
    ["a separate consent has no version", (t) => { t.client_consents = [separate(kind, { consent_version: null })]; }],
    ["a separate consent has an unknown capture method", (t) => { t.client_consents = [separate(kind, { capture_method: "phone" })]; }],
    ["a client consent names no client login", (t) => { t.client_consents = [separate(kind, { granted_by_account_id: null })]; }],
    ["a staff consent names no staff member", (t) => {
      t.client_consents = [separate(kind, { granted_by_kind: "staff", granted_by_account_id: null })];
    }],
    ["a client consent also names a staff member", (t) => {
      t.client_consents = [separate(kind, { granted_by_kind: "client", granted_by_staff_id: STAFF })];
    }]
  ];
  const ok = [
    ["the signed agreement lacks the clause but the client gave a live separate consent", (t) => {
      signedLacks(t); t.client_consents = [separate(kind)];
    }],
    ["a badly formed consent of another kind belongs to that kind's row", (t) => {
      t.client_consents = [separate(kind === "call_recording" ? "marketing_use" : "call_recording", { consent_text: " " })];
    }],
    ["a separate consent recorded by staff names the staff member", (t) => {
      t.client_consents = [separate(kind, { granted_by_kind: "staff", granted_by_account_id: null, granted_by_staff_id: STAFF })];
    }],
    ["a sent agreement not yet signed is judged by its wording only", (t) => {
      t.contracts[0].status = "sent"; signedLacks(t);
    }],
    ["an older signed contract on a demo client is test data", (t) => { t.clients[0].is_demo = true; signedLacks(t); }],
    ["a demo contract is test data", (t) => { t.contracts[0].is_demo = true; signedLacks(t); }],
    ["a signed staff agreement is not a client agreement", (t) => {
      t.contracts[0].template_key = "EMPLOYEE-CLOSER-AGREEMENT"; signedLacks(t);
    }],
    ["a signed uploaded PDF holds boxes, not words", (t) => { t.contracts[0].source_kind = "pdf"; signedLacks(t); }],
    ["a switched-off wording is not sent any more", (t) => { t.contract_templates[1].active = false; t.contract_templates[1].body = "old"; }],
    ["a demo wording is not judged", (t) => { t.contract_templates[1].is_demo = true; t.contract_templates[1].body = "old"; }],
    ["an uploaded PDF wording holds boxes, not words", (t) => { t.contract_templates[1].source_kind = "pdf"; t.contract_templates[1].body = null; }],
    ["the soft-pull authorization is not a client service agreement", (t) => {
      t.contract_templates.push({ id: id(899), org_id: ORG, template_key: "SOFT-PULL-CONSENT", name: "Soft pull", active: true,
        is_demo: false, source_kind: "text", body: "I authorize a soft pull." });
    }]
  ];
  return { breaks, ok };
}

const CASES = [
  { key: "consent-call-recording", kind: "call_recording", sql: CONSENT_CALL_RECORDING_SQL,
    sentences: [CONSENT_MARKERS.callRecording, CONSENT_MARKERS.ai] },
  { key: "consent-marketing-use", kind: "marketing_use", sql: CONSENT_MARKETING_USE_SQL,
    sentences: [CONSENT_MARKERS.marketing] }
];

for (const c of CASES) {
  const { breaks, ok } = casesFor(c.kind, c.sentences);

  test(`${c.key}: a company whose agreements all carry the consent is clean`, () => {
    assert.deepEqual(judge(c.sql, good()), { sample: 1, bad: 0 });
  });

  test(`${c.key}: PASS on the heartbeat when every agreement carries it, FAIL when one does not`, () => {
    const contract = CONSENT_FROM_CONTRACT_CONTRACTS.find((x) => x.sql.includes(`display-result:${c.key}`));
    const entry = { id: c.key, control: contract.control, surface: "consent-capture.html", contract };
    const pass = judge(c.sql, good());
    assert.equal(judgeDisplayResult(entry, { sample_count: pass.sample, bad_count: pass.bad }).status, "PASS");
    const tables = good();
    breaks[1][1](tables);
    const fail = judge(c.sql, tables);
    assert.equal(judgeDisplayResult(entry, { sample_count: fail.sample, bad_count: fail.bad }).status, "FAIL");
  });

  test(`${c.key}: another company's broken rows are never counted`, () => {
    for (const [label, fn] of breaks) {
      const broken = good();
      fn(broken);
      assert.deepEqual(judge(c.sql, together(good(), otherCompany(broken))), { sample: 1, bad: 0 }, label);
    }
  });

  for (const [label, fn] of breaks) {
    test(`${c.key}: BAD when ${label}`, () => {
      const tables = good();
      fn(tables);
      assert.deepEqual(judge(c.sql, tables), { sample: 1, bad: 1 });
    });
  }

  for (const [label, fn] of ok) {
    test(`${c.key}: fine when ${label}`, () => {
      const tables = good();
      fn(tables);
      assert.deepEqual(judge(c.sql, tables), { sample: 1, bad: 0 });
    });
  }

  test(`${c.key}: dropping any one condition changes the answer for some test row`, () => {
    const tree = parseContract(c.sql);
    const variants = [good(), together(good(), otherCompany(good()))];
    for (const [, fn] of [...breaks, ...ok]) { const t = good(); fn(t); variants.push(t); }
    const answer = (t, tables) => {
      const out = runParsed(t, { tables, params: [ORG], now: NOW, catalog: CATALOG });
      return `${out.sample_count}/${out.bad_count}`;
    };
    const baseline = variants.map((tables) => answer(tree, tables));
    const unproven = [];
    for (const mutation of dropOneCondition(tree)) {
      if (!variants.some((tables, i) => answer(mutation.tree, tables) !== baseline[i])) unproven.push(mutation.label);
    }
    assert.deepEqual(unproven, [], `conditions no test row can tell from their absence:\n  ${unproven.join("\n  ")}`);
  });
}

test("the recording row also needs the AI sentence; the marketing row needs only its own", () => {
  const noAi = good();
  noAi.contract_templates[0].body = dropSentence(noAi.contract_templates[0].body, CONSENT_MARKERS.ai);
  assert.deepEqual(judge(CONSENT_CALL_RECORDING_SQL, noAi), { sample: 1, bad: 1 });
  assert.deepEqual(judge(CONSENT_MARKETING_USE_SQL, noAi), { sample: 1, bad: 0 });
});

// ── the withdraw row ────────────────────────────────────────────────────────

const revoked = (extra = {}) => separate("marketing_use", {
  revoked_at: LONG_AGO, revoked_reason: "Changed my mind", revoked_by_kind: "client",
  revoked_by_account_id: ACCOUNT, revoked_by_staff_id: null, ...extra
});

test("consent-revoke: a withdrawal with its reason and one revoker is clean", () => {
  assert.deepEqual(judge(CONSENT_REVOKE_SQL, { client_consents: [revoked()] }), { sample: 1, bad: 0 });
  assert.deepEqual(judge(CONSENT_REVOKE_SQL, { client_consents: [revoked({ revoked_by_kind: "staff", revoked_by_account_id: null, revoked_by_staff_id: STAFF })] }), { sample: 1, bad: 0 });
});

for (const [label, extra] of [
  ["no reason", { revoked_reason: "  " }],
  ["an unknown revoker kind", { revoked_by_kind: "robot" }],
  ["a client revoker with no login", { revoked_by_account_id: null }],
  ["a client revoker that also names staff", { revoked_by_staff_id: STAFF }],
  ["a staff revoker with no staff member", { revoked_by_kind: "staff", revoked_by_account_id: null }]
]) {
  test(`consent-revoke: BAD with ${label}`, () => {
    assert.deepEqual(judge(CONSENT_REVOKE_SQL, { client_consents: [revoked(extra)] }), { sample: 1, bad: 1 });
  });
}

test("consent-revoke: a live consent is not a withdrawal, and nothing withdrawn yet is green until the first wrong one", () => {
  assert.deepEqual(judge(CONSENT_REVOKE_SQL, { client_consents: [separate("marketing_use")] }), { sample: 0, bad: 0 });
  const contract = CONSENT_FROM_CONTRACT_CONTRACTS.find((x) => x.sql.includes("display-result:consent-revoke"));
  const entry = { id: "consent-revoke", control: contract.control, surface: "consent-capture.html", contract };
  assert.equal(judgeDisplayResult(entry, { sample_count: 0, bad_count: 0 }).status, "PASS");
  assert.equal(judgeDisplayResult(entry, { sample_count: 1, bad_count: 1 }).status, "FAIL");
});

// ── wiring ──────────────────────────────────────────────────────────────────

test("the three consent-screen rows use these checks, and the two consent rows never wait for a first result", () => {
  for (const contract of CONSENT_FROM_CONTRACT_CONTRACTS) {
    assert.equal(displaySavedResultContract({ control: contract.control }), contract);
  }
  const [recording, marketing] = CONSENT_FROM_CONTRACT_CONTRACTS;
  assert.equal(recording.emptyAs, undefined);
  assert.equal(marketing.emptyAs, undefined);
  assert.match(recording.sql, /FROM orgs o\s+WHERE o\.id = \$1::uuid/);
});
