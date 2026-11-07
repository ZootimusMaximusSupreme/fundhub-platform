// Bank logos (owner rule 2026-11-07): Plaid's logo first, then the bank book's,
// then null — and Plaid's answer is stored once per bank, never per client.
//
// No network and no database: Plaid is a recorded answer in Plaid's documented
// shape (https://plaid.com/docs/api/institutions/#institutionsget_by_id), and
// the database is an in-memory stand-in that answers this module's statements.
// The SQL text itself is proved only on a real Postgres (not run here).
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";

import {
  bankKey, bankName, cleanInstitution, cleanLogoBase64, logoDataUri, bookLogoPath, pickLogo,
  findLogos, attachAccountLogos, attachOverviewLogos, attachCreditLogos, attachBankLogos, saveInstitution, refreshInstitutionLogo,
  saveLogoQuietly, backfillInstitutionLogos, LOGO_MAX_AGE_DAYS
} from "./institution-logos.mjs";
import { getInstitutionById } from "./providers/plaid-http.mjs";
import { refreshClientAccounts } from "./plaid-refresh.mjs";
import { encryptPlaidToken } from "./plaid.mjs";
import { fakeBankDb, plaidAccount } from "./plaid-fake-db.mjs";

/* A real 1x1 PNG, base64 — the same kind of string Plaid sends. */
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
const PNG_2 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==";
const ORG = "00000000-0000-0000-0000-0000000000aa";
const OTHER_ORG = "00000000-0000-0000-0000-0000000000bb";
const CLIENT = "00000000-0000-0000-0000-0000000000cc";
const CHASE_LENDER = "11111111-1111-1111-1111-111111111111";
const AMEX_LENDER = "22222222-2222-2222-2222-222222222222";
const NOW = "2026-11-07T07:00:00.000Z";

const ENV = Object.freeze({
  PLAID_CLIENT_ID: "cid",
  PLAID_SECRET: "sec",
  PLAID_TOKEN_ENC_KEY: crypto.randomBytes(32).toString("base64"),
  PLAID_ENV: "sandbox",
  ADAPTERS_DRY_RUN: "0"
});

/* Plaid's documented /institutions/get_by_id answer, trimmed to what we read. */
const plaidAnswer = (over = {}) => ({
  institution: {
    institution_id: "ins_56",
    name: "Chase",
    country_codes: ["US"],
    products: ["transactions"],
    oauth: true,
    url: "https://www.chase.com",
    primary_color: "#095aa6",
    logo: PNG,
    ...over
  },
  request_id: "req-1"
});

/** A stand-in fetch answering /institutions/get_by_id. Records every request. */
function plaidStub(answerFor = () => plaidAnswer(), { status = 200 } = {}) {
  const requests = [];
  const fetch = async (url, init) => {
    const body = JSON.parse(init.body);
    requests.push({ path: new URL(url).pathname, body });
    return new Response(JSON.stringify(answerFor(body)), { status, headers: { "content-type": "application/json" } });
  };
  return { fetch, requests };
}

/** In memory: plaid_institutions, lenders, plaid_items, bank_accounts. */
function logoDb({ institutions = [], lenders = [], items = [], accounts = [], failOn = null } = {}) {
  const inst = new Map(institutions.map((r) => [r.plaid_institution_id, { ...r }]));
  const calls = [];
  const key = (n) => bankKey(n);
  return {
    inst, calls,
    async query(sql, params = []) {
      calls.push({ sql, params });
      if (failOn && failOn.test(sql)) throw new Error("db down");
      if (/SELECT logo_fetched_at FROM plaid_institutions/.test(sql)) {
        const r = inst.get(params[0]);
        return { rows: r ? [{ logo_fetched_at: r.logo_fetched_at }] : [] };
      }
      if (/INSERT INTO plaid_institutions/.test(sql)) {
        const [id, name, nameKey, logo, color, url, at] = params;
        const was = inst.get(id);
        inst.set(id, {
          plaid_institution_id: id,
          name: name ?? was?.name ?? null,
          name_key: nameKey ?? was?.name_key ?? null,
          logo_base64: logo, primary_color: color, url, logo_fetched_at: at
        });
        return { rows: [{ plaid_institution_id: id }], rowCount: 1 };
      }
      if (/FROM plaid_institutions\s+WHERE logo_base64 IS NOT NULL/.test(sql)) {
        const [ids, keys] = params;
        return { rows: [...inst.values()].filter((r) => r.logo_base64 && (ids.includes(r.plaid_institution_id) || keys.includes(r.name_key))) };
      }
      if (/FROM lenders/.test(sql)) {
        const [org, ids, keys] = params;
        return {
          rows: lenders
            .filter((l) => l.org_id === org && l.logo_path && !l.is_demo && (ids.includes(l.id) || keys.includes(key(l.name))))
            .map((l) => ({ id: l.id, name_key: key(l.name), logo_path: l.logo_path }))
        };
      }
      if (/FROM bank_accounts ba\s+JOIN plaid_items p/.test(sql)) {
        const [org, client] = params;
        return {
          rows: accounts
            .filter((a) => a.org_id === org && a.client_id === client && a.plaid_item_id)
            .map((a) => {
              const p = items.find((i) => i.id === a.plaid_item_id && i.org_id === a.org_id && i.client_id === a.client_id);
              return p ? { bank_account_id: a.id, plaid_institution_id: p.plaid_institution_id, institution_name: p.institution_name } : null;
            })
            .filter(Boolean)
        };
      }
      if (/SELECT DISTINCT btrim\(plaid_institution_id\)/.test(sql)) {
        const ids = [...new Set(items.map((i) => (i.plaid_institution_id || "").trim()).filter(Boolean))].sort();
        return { rows: ids.slice(0, params[0]).map((id) => ({ plaid_institution_id: id })) };
      }
      throw new Error(`logoDb: nobody taught this statement: ${sql.replace(/\s+/g, " ").slice(0, 100)}`);
    }
  };
}

describe("names and values", () => {
  test("bankKey treats case, spaces, punctuation and & as one bank; the sandbox tail is not the name", () => {
    assert.equal(bankKey("Bank of America"), "bankofamerica");
    assert.equal(bankKey("BANK OF  AMERICA"), "bankofamerica");
    assert.equal(bankKey("U.S. Bank"), "usbank");
    assert.equal(bankKey("Johnson & Johnson Bank"), bankKey("Johnson and Johnson Bank"));
    assert.equal(bankKey("First Platypus Bank (Plaid sandbox — test data)"), "firstplatypusbank");
    assert.equal(bankName("First Platypus Bank (Plaid sandbox — test data)"), "First Platypus Bank");
    assert.equal(bankKey(""), null);
    assert.equal(bankKey(null), null);
    assert.equal(bankKey("—"), null);
  });

  test("only a base64 PNG is a Plaid logo; colour and website are checked too", () => {
    assert.equal(cleanLogoBase64(PNG), PNG);
    assert.equal(cleanLogoBase64("R0lGODlhAQABAAAAACw="), null, "a GIF is not what Plaid sends");
    assert.equal(cleanLogoBase64("iVBORw0KGgo<script>"), null);
    assert.equal(cleanLogoBase64(null), null);
    const c = cleanInstitution({ institutionId: "ins_1", name: " Chase ", logo: PNG, primaryColor: "red", url: "javascript:alert(1)" });
    assert.deepEqual(c, { institutionId: "ins_1", name: "Chase", nameKey: "chase", logoBase64: PNG, primaryColor: null, url: null });
    assert.equal(cleanInstitution({ institutionId: "" }), null);
    assert.equal(logoDataUri(PNG), `data:image/png;base64,${PNG}`);
    assert.equal(logoDataUri(null), null);
  });

  test("a bank-book path is a file under /assets/lenders/; the placeholder tile is not a logo", () => {
    assert.equal(bookLogoPath("/assets/lenders/chase.png"), "/assets/lenders/chase.png");
    assert.equal(bookLogoPath("/assets/lenders/amex-bluebox.svg"), "/assets/lenders/amex-bluebox.svg");
    assert.equal(bookLogoPath("/assets/lenders/placeholder.svg"), null);
    assert.equal(bookLogoPath("/assets/lenders/../secret.png"), null);
    assert.equal(bookLogoPath("https://evil.example/logo.png"), null);
    assert.equal(bookLogoPath(""), null);
  });
});

describe("the order: Plaid, then the bank book, then null", () => {
  test("Plaid's logo wins over the bank book's", () => {
    assert.deepEqual(pickLogo({ plaidLogoBase64: PNG, bookLogoPath: "/assets/lenders/chase.png" }),
      { logo: `data:image/png;base64,${PNG}`, logo_source: "plaid" });
  });
  test("no Plaid logo → the bank book's file", () => {
    assert.deepEqual(pickLogo({ plaidLogoBase64: null, bookLogoPath: "/assets/lenders/chase.png" }),
      { logo: "/assets/lenders/chase.png", logo_source: "bank_book" });
  });
  test("neither → null, never a placeholder", () => {
    assert.deepEqual(pickLogo({ plaidLogoBase64: null, bookLogoPath: null }), { logo: null, logo_source: null });
    assert.deepEqual(pickLogo({ plaidLogoBase64: "not-a-png", bookLogoPath: "/assets/lenders/placeholder.svg" }),
      { logo: null, logo_source: null });
  });

  test("findLogos: institution id, then name; bank book by lender id, then name", async () => {
    const db = logoDb({
      institutions: [{ plaid_institution_id: "ins_56", name: "Chase", name_key: "chase", logo_base64: PNG, logo_fetched_at: NOW }],
      lenders: [
        { id: CHASE_LENDER, org_id: ORG, name: "Chase", logo_path: "/assets/lenders/chase.png" },
        { id: AMEX_LENDER, org_id: ORG, name: "American Express", logo_path: "/assets/lenders/american-express.png" }
      ]
    });
    const out = await findLogos(db, {
      orgId: ORG,
      banks: [
        { institutionId: "ins_56", name: "Something Plaid calls it" },
        { name: "CHASE" },
        { lenderId: AMEX_LENDER, name: "Amex" },
        { name: "American Express" },
        { name: "Some Bank Nobody Has" }
      ]
    });
    assert.deepEqual(out.map((o) => o.logo_source), ["plaid", "plaid", "bank_book", "bank_book", null]);
    assert.equal(out[2].logo, "/assets/lenders/american-express.png");
    assert.equal(out[4].logo, null);
  });

  test("a name that points at two different logos is not a match", async () => {
    const db = logoDb({
      institutions: [
        { plaid_institution_id: "ins_a", name: "First National Bank", name_key: "firstnationalbank", logo_base64: PNG },
        { plaid_institution_id: "ins_b", name: "First National Bank", name_key: "firstnationalbank", logo_base64: PNG_2 }
      ]
    });
    const [byName, byId] = await findLogos(db, { orgId: ORG, banks: [{ name: "First National Bank" }, { institutionId: "ins_b", name: "First National Bank" }] });
    assert.deepEqual(byName, { logo: null, logo_source: null }, "one bank's logo shown on another bank");
    assert.equal(byId.logo, `data:image/png;base64,${PNG_2}`, "the id still matches exactly");
  });

  test("the bank book is the org's own: another org's file is never used", async () => {
    const db = logoDb({ lenders: [{ id: CHASE_LENDER, org_id: OTHER_ORG, name: "Chase", logo_path: "/assets/lenders/chase.png" }] });
    const [r] = await findLogos(db, { orgId: ORG, banks: [{ name: "Chase" }] });
    assert.deepEqual(r, { logo: null, logo_source: null });
    const sent = db.calls.find((c) => /FROM lenders/.test(c.sql));
    assert.match(sent.sql, /org_id = \$1::uuid/);
    assert.match(sent.sql, /COALESCE\(is_demo, false\) = false/);
    assert.equal(sent.params[0], ORG);
  });

  test("a read that fails leaves every logo null — the name shows alone", async () => {
    const db = logoDb({ failOn: /plaid_institutions/ });
    const out = await findLogos(db, { orgId: ORG, banks: [{ name: "Chase" }, { name: "Wells Fargo" }] });
    assert.deepEqual(out, [{ logo: null, logo_source: null }, { logo: null, logo_source: null }]);
  });
});

describe("stored once per bank", () => {
  test("two clients at the same bank: one row, and the second link does not ask Plaid again", async () => {
    const db = logoDb();
    const plaid = plaidStub();
    const first = await refreshInstitutionLogo(db, { institutionId: "ins_56", env: ENV, fetchImpl: plaid.fetch, now: NOW });
    const second = await refreshInstitutionLogo(db, { institutionId: "ins_56", env: ENV, fetchImpl: plaid.fetch, now: "2026-11-08T07:00:00.000Z" });
    assert.equal(first.saved, true);
    assert.equal(first.hasLogo, true);
    assert.equal(second.skipped, true, "a bank asked yesterday was asked again");
    assert.equal(db.inst.size, 1);
    assert.equal(plaid.requests.length, 1);
    const row = db.inst.get("ins_56");
    assert.equal(row.logo_base64, PNG);
    assert.equal(row.primary_color, "#095aa6");
    assert.equal(row.url, "https://www.chase.com");
    assert.equal(row.name_key, "chase");
  });

  test("after a month it is read again and the same row is updated", async () => {
    const db = logoDb();
    const plaid = plaidStub();
    await refreshInstitutionLogo(db, { institutionId: "ins_56", env: ENV, fetchImpl: plaid.fetch, now: NOW });
    const later = new Date(Date.parse(NOW) + (LOGO_MAX_AGE_DAYS + 1) * 86_400_000).toISOString();
    const again = await refreshInstitutionLogo(db, { institutionId: "ins_56", env: ENV, fetchImpl: plaid.fetch, now: later });
    assert.equal(again.saved, true);
    assert.equal(plaid.requests.length, 2);
    assert.equal(db.inst.size, 1);
    assert.equal(db.inst.get("ins_56").logo_fetched_at, later);
  });

  test("Plaid has no logo → null is stored, never a made-up one", async () => {
    const db = logoDb();
    const plaid = plaidStub(() => plaidAnswer({ institution_id: "ins_109508", name: "First Platypus Bank", logo: null, primary_color: null, url: null }));
    const r = await refreshInstitutionLogo(db, { institutionId: "ins_109508", env: ENV, fetchImpl: plaid.fetch, now: NOW });
    assert.equal(r.saved, true);
    assert.equal(r.hasLogo, false);
    assert.equal(db.inst.get("ins_109508").logo_base64, null);
  });

  test("a Plaid error writes nothing", async () => {
    const db = logoDb();
    const plaid = plaidStub(() => ({ error_code: "INVALID_INSTITUTION", error_type: "INVALID_INPUT", error_message: "no such bank" }), { status: 400 });
    const r = await refreshInstitutionLogo(db, { institutionId: "ins_nope", env: ENV, fetchImpl: plaid.fetch, now: NOW });
    assert.equal(r.ok, false);
    assert.equal(r.errorCode, "INVALID_INSTITUTION");
    assert.equal(db.inst.size, 0);
  });

  test("no institution id, or no Plaid keys: nothing is sent and nothing is written", async () => {
    const db = logoDb();
    const plaid = plaidStub();
    assert.equal((await refreshInstitutionLogo(db, { institutionId: null, env: ENV, fetchImpl: plaid.fetch })).reason, "no_institution_id");
    assert.equal((await refreshInstitutionLogo(db, { institutionId: "ins_56", env: {}, fetchImpl: plaid.fetch })).reason, "not_configured");
    assert.equal(plaid.requests.length, 0);
    assert.equal(db.calls.length, 0);
  });

  test("saveLogoQuietly never throws, even when the database is down", async () => {
    const db = logoDb({ failOn: /plaid_institutions/ });
    const r = await saveLogoQuietly(db, { institutionId: "ins_56", env: ENV, fetchImpl: plaidStub().fetch });
    assert.equal(r.ok, false);
  });

  test("saveInstitution refuses a row with no id", async () => {
    const db = logoDb();
    assert.equal((await saveInstitution(db, { institutionId: " " })).ok, false);
    assert.equal(db.calls.length, 0);
  });
});

describe("the Plaid call", () => {
  test("asks /institutions/get_by_id with optional metadata, US, and no access token", async () => {
    const plaid = plaidStub();
    const r = await getInstitutionById("ins_56", {}, { environment: "sandbox", clientId: "cid", secret: "sec", env: { ADAPTERS_DRY_RUN: "0" }, fetchImpl: plaid.fetch });
    assert.equal(r.ok, true);
    assert.deepEqual(plaid.requests.map((q) => q.path), ["/institutions/get_by_id"]);
    const body = plaid.requests[0].body;
    assert.equal(body.institution_id, "ins_56");
    assert.deepEqual(body.country_codes, ["US"]);
    assert.deepEqual(body.options, { include_optional_metadata: true });
    assert.equal("access_token" in body, false, "no person's account is read");
    assert.deepEqual(r.institution, {
      institutionId: "ins_56", name: "Chase", logo: PNG, primaryColor: "#095aa6", url: "https://www.chase.com"
    });
    assert.equal(JSON.stringify(r).includes("sec"), false, "the secret came back in the result");
  });

  test("an empty id is refused before anything is sent", async () => {
    const plaid = plaidStub();
    const r = await getInstitutionById("  ", {}, { environment: "sandbox", env: { ADAPTERS_DRY_RUN: "0" }, fetchImpl: plaid.fetch });
    assert.equal(r.ok, false);
    assert.equal(r.transmitted, false);
    assert.equal(plaid.requests.length, 0);
  });
});

describe("the reads gain a logo", () => {
  const ITEM = "00000000-0000-0000-0000-0000000000a1";
  const view = () => ({
    client_id: CLIENT,
    containers: [{
      id: "c1", kind: "personal", name: "Me",
      accounts: [{ id: "acc-chk", source: "bank_account", name: "Total Checking", provider: "plaid" }],
      cards: [{ id: "tl-1", source: "tradeline", name: "American Express" }],
      loans: [], bills: []
    }],
    unassigned: { accounts: [{ id: "acc-hand", source: "bank_account", name: "Hand Typed Account", provider: "manual" }], cards: [], loans: [], bills: [] },
    billing: {}
  });

  test("accounts: a linked account gets its bank's Plaid logo; a credit-report card its bank-book file; an unknown one null", async () => {
    const db = logoDb({
      institutions: [{ plaid_institution_id: "ins_56", name: "Chase", name_key: "chase", logo_base64: PNG }],
      lenders: [{ id: AMEX_LENDER, org_id: ORG, name: "American Express", logo_path: "/assets/lenders/american-express.png" }],
      items: [{ id: ITEM, org_id: ORG, client_id: CLIENT, plaid_institution_id: "ins_56", institution_name: "Chase (Plaid sandbox — test data)" }],
      accounts: [{ id: "acc-chk", org_id: ORG, client_id: CLIENT, plaid_item_id: ITEM }]
    });
    const out = await attachAccountLogos(db, { orgId: ORG, clientId: CLIENT, view: view() });
    const chk = out.containers[0].accounts[0];
    assert.equal(chk.logo, `data:image/png;base64,${PNG}`);
    assert.equal(chk.logo_source, "plaid");
    assert.equal(chk.institution, "Chase", "the sandbox tail is not the bank's name");
    assert.equal(out.containers[0].cards[0].logo, "/assets/lenders/american-express.png");
    assert.equal(out.containers[0].cards[0].logo_source, "bank_book");
    assert.deepEqual(
      { logo: out.unassigned.accounts[0].logo, logo_source: out.unassigned.accounts[0].logo_source, institution: out.unassigned.accounts[0].institution },
      { logo: null, logo_source: null, institution: null }
    );
    const sent = db.calls.find((c) => /FROM bank_accounts ba/.test(c.sql));
    assert.match(sent.sql, /ba\.org_id = \$1 AND ba\.client_id = \$2/);
    assert.match(sent.sql, /p\.org_id = ba\.org_id AND p\.client_id = ba\.client_id/);
    assert.deepEqual(sent.params, [ORG, CLIENT]);
    assert.equal(out.billing && typeof out.billing, "object", "the rest of the view is untouched");
  });

  test("accounts: another client's login is never joined in", async () => {
    const db = logoDb({
      institutions: [{ plaid_institution_id: "ins_56", name: "Chase", name_key: "chase", logo_base64: PNG }],
      items: [{ id: ITEM, org_id: ORG, client_id: "someone-else", plaid_institution_id: "ins_56", institution_name: "Chase" }],
      accounts: [{ id: "acc-chk", org_id: ORG, client_id: CLIENT, plaid_item_id: ITEM }]
    });
    const out = await attachAccountLogos(db, { orgId: ORG, clientId: CLIENT, view: view() });
    assert.equal(out.containers[0].accounts[0].institution, null);
  });

  test("banks: each recommended bank, stacking line and relationship carries its logo, in place", async () => {
    const db = logoDb({
      institutions: [{ plaid_institution_id: "ins_56", name: "Chase", name_key: "chase", logo_base64: PNG }],
      lenders: [
        { id: CHASE_LENDER, org_id: ORG, name: "Chase", logo_path: "/assets/lenders/chase.png" },
        { id: AMEX_LENDER, org_id: ORG, name: "American Express", logo_path: "/assets/lenders/american-express.png" }
      ]
    });
    const payload = {
      ok: true,
      recommended_banks: [{ lender_id: CHASE_LENDER, name: "Chase" }, { lender_id: null, name: "Tiny Credit Union" }],
      card_stacking: { order_rule: { text: "x" }, items: [{ order: 1, issuer: "American Express", lender_id: AMEX_LENDER }] },
      relationships: [{ id: "r1", bank: "Chase", lender_id: null }]
    };
    const out = await attachBankLogos(db, { orgId: ORG, payload });
    assert.equal(out.recommended_banks[0].logo_source, "plaid", "Plaid's logo comes before the bank book's");
    assert.equal(out.recommended_banks[1].logo, null);
    assert.equal(out.card_stacking.items[0].logo, "/assets/lenders/american-express.png");
    assert.equal(out.card_stacking.order_rule.text, "x", "the rest of the stacking block is kept");
    assert.equal(out.relationships[0].logo_source, "plaid");
    assert.equal(payload.recommended_banks[0].logo, undefined, "the read's own object was changed in place");
  });

  test("banks: the bank plan (deposit_plan) gets Plaid's logo first, keeps its book file otherwise, and says which", async () => {
    const db = logoDb({
      institutions: [{ plaid_institution_id: "ins_56", name: "Chase", name_key: "chase", logo_base64: PNG }],
      lenders: [{ id: AMEX_LENDER, org_id: ORG, name: "American Express", logo_path: "/assets/lenders/american-express.png" }]
    });
    const payload = {
      ok: true,
      recommended_banks: [],
      deposit_plan: [
        { lender_id: CHASE_LENDER, name: "Chase", logo: "/assets/lenders/chase.png", logo_alt: "Chase logo", open_by: "2026-12-01" },
        { lender_id: AMEX_LENDER, name: "American Express", logo: null, logo_alt: null },
        { lender_id: null, name: "Tiny Credit Union", logo: null, logo_alt: null }
      ]
    };
    const out = await attachBankLogos(db, { orgId: ORG, payload });
    assert.equal(out.deposit_plan[0].logo, `data:image/png;base64,${PNG}`, "Plaid's logo comes before the book file");
    assert.equal(out.deposit_plan[0].logo_source, "plaid");
    assert.equal(out.deposit_plan[0].logo_alt, "Chase logo");
    assert.equal(out.deposit_plan[0].open_by, "2026-12-01", "the rest of the row is kept");
    assert.equal(out.deposit_plan[1].logo, "/assets/lenders/american-express.png");
    assert.equal(out.deposit_plan[1].logo_alt, "American Express logo");
    assert.deepEqual([out.deposit_plan[2].logo, out.deposit_plan[2].logo_source, out.deposit_plan[2].logo_alt], [null, null, null]);
  });

  test("banks: when the logo read fails, the bank plan keeps the book file it came with", async () => {
    const payload = { ok: true, deposit_plan: [{ lender_id: CHASE_LENDER, name: "Chase", logo: "/assets/lenders/chase.png", logo_alt: "Chase logo" }] };
    const out = await attachBankLogos(logoDb({ failOn: /./ }), { orgId: ORG, payload });
    assert.equal(out.deposit_plan[0].logo, "/assets/lenders/chase.png");
    assert.equal(out.deposit_plan[0].logo_source, "bank_book");
  });

  test("overview: each account gets its bank's logo, and its card and loan rows take the same one", async () => {
    const db = logoDb({
      institutions: [{ plaid_institution_id: "ins_56", name: "Chase", name_key: "chase", logo_base64: PNG }],
      lenders: [{ id: AMEX_LENDER, org_id: ORG, name: "American Express", logo_path: "/assets/lenders/american-express.png" }],
      items: [{ id: ITEM, org_id: ORG, client_id: CLIENT, plaid_institution_id: "ins_56", institution_name: "Chase (Plaid sandbox — test data)" }],
      accounts: [{ id: "acc-card", org_id: ORG, client_id: CLIENT, plaid_item_id: ITEM }]
    });
    const payload = {
      ok: true,
      accounts: [
        { id: "acc-card", name: "Sapphire", institution: "Chase (Plaid sandbox — test data)", type: "credit" },
        { id: "acc-amex", name: "Blue Business", institution: "American Express", type: "credit" },
        { id: "acc-hand", name: "Hand Typed", institution: null, type: "depository" }
      ],
      debt: {
        total_cents: 100,
        cards: [{ account_id: "acc-card", name: "Sapphire" }, { account_id: "acc-amex", name: "Blue Business" }],
        loans: [{ account_id: "acc-hand", name: "Car" }]
      }
    };
    const out = await attachOverviewLogos(db, { orgId: ORG, clientId: CLIENT, payload });
    assert.equal(out.accounts[0].logo, `data:image/png;base64,${PNG}`);
    assert.equal(out.accounts[0].logo_source, "plaid");
    assert.equal(out.accounts[1].logo, "/assets/lenders/american-express.png");
    assert.equal(out.accounts[1].logo_source, "bank_book");
    assert.deepEqual([out.accounts[2].logo, out.accounts[2].logo_source], [null, null]);
    assert.equal(out.debt.cards[0].logo, out.accounts[0].logo, "a card takes its own account's logo");
    assert.equal(out.debt.cards[1].logo_source, "bank_book");
    assert.equal(out.debt.loans[0].logo, null);
    assert.equal(out.debt.total_cents, 100, "the rest of the debt block is kept");
    const sent = db.calls.find((c) => /FROM bank_accounts ba/.test(c.sql));
    assert.deepEqual(sent.params, [ORG, CLIENT]);
    assert.equal(payload.accounts[0].logo, undefined, "the read's own object was changed in place");
  });

  test("overview: a failed logo read leaves every logo null and the payload whole", async () => {
    const db = logoDb({ failOn: /./ });
    const payload = { ok: true, accounts: [{ id: "a1", name: "Checking", institution: "Chase" }], debt: { cards: [], loans: [] } };
    const out = await attachOverviewLogos(db, { orgId: ORG, clientId: CLIENT, payload });
    assert.deepEqual([out.accounts[0].logo, out.accounts[0].logo_source], [null, null]);
    assert.equal(out.accounts[0].name, "Checking");
  });

  test("credit: a lender whose name is a bank's name gets its logo; any other name gets none", async () => {
    const db = logoDb({
      lenders: [{ id: CHASE_LENDER, org_id: ORG, name: "Chase", logo_path: "/assets/lenders/chase.png" }]
    });
    const payload = { ok: true, accounts: { count: 2, list: [{ lender: "CHASE", kind: "revolving" }, { lender: "JPMCB CARD SERVICES", kind: "revolving" }] } };
    const out = await attachCreditLogos(db, { orgId: ORG, payload });
    assert.equal(out.accounts.list[0].logo, "/assets/lenders/chase.png");
    assert.equal(out.accounts.list[0].logo_source, "bank_book");
    assert.deepEqual([out.accounts.list[1].logo, out.accounts.list[1].logo_source], [null, null], "no near match");
    assert.equal(out.accounts.count, 2);
    assert.equal(db.calls.find((c) => /FROM lenders/.test(c.sql)).params[0], ORG);
  });

  test("credit and overview: no rows means no read and the same payload back", async () => {
    const db = logoDb();
    const credit = { ok: true, accounts: { list: [] } };
    const overview = { ok: true, accounts: [] };
    assert.equal(await attachCreditLogos(db, { orgId: ORG, payload: credit }), credit);
    assert.equal(await attachOverviewLogos(db, { orgId: ORG, clientId: CLIENT, payload: overview }), overview);
    assert.equal(db.calls.length, 0);
  });
});

describe("the link and refresh paths", () => {
  const ITEM_A = "00000000-0000-0000-0000-0000000000a1";
  const TOKEN = "access-sandbox-secret-A";
  const login = () => ({
    id: ITEM_A, org_id: ORG, client_id: CLIENT, plaid_item_id: "item-A", institution_name: "Chase",
    encrypted_access_token: encryptPlaidToken(TOKEN, { itemId: "item-A", env: ENV }),
    consent_granted_at: "2026-09-20T10:00:00.000Z", created_at: "2026-09-20T10:00:00.000Z", link_state: "active"
  });

  /* The bank fake, with the logo table bolted on. */
  function bothDbs() {
    const bank = fakeBankDb({ items: [login()], accounts: [] });
    const logos = logoDb();
    return {
      bank, logos,
      state: bank.state,
      calls: bank.calls,
      query: (sql, params) => (/plaid_institutions/.test(sql) ? logos.query(sql, params) : bank.query(sql, params))
    };
  }

  function plaidFor({ institutionId = "ins_56", logoStatus = 200 } = {}) {
    const requests = [];
    const fetch = async (url, init) => {
      const path = new URL(url).pathname;
      const body = JSON.parse(init.body);
      requests.push({ path, body });
      const respond = (b, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "content-type": "application/json" } });
      if (path === "/accounts/get") {
        return respond({ accounts: [plaidAccount({ id: "p-chk", name: "Total Checking" })], item: { item_id: "item-A", institution_id: institutionId }, request_id: "r" });
      }
      if (path === "/institutions/get_by_id") {
        return logoStatus === 200 ? respond(plaidAnswer()) : respond({ error_code: "INTERNAL_SERVER_ERROR", error_type: "API_ERROR" }, logoStatus);
      }
      return respond({ error_code: "UNKNOWN" }, 400);
    };
    return { fetch, requests };
  }

  test("a refresh saves the bank's logo once, from the Item Plaid names", async () => {
    const db = bothDbs();
    const plaid = plaidFor();
    const r = await refreshClientAccounts(db, { orgId: ORG, clientId: CLIENT, env: ENV, asOf: NOW, fetchImpl: plaid.fetch });
    assert.equal(r.ok, true);
    assert.deepEqual(plaid.requests.map((q) => q.path), ["/accounts/get", "/institutions/get_by_id"]);
    assert.equal(db.logos.inst.get("ins_56").logo_base64, PNG);

    await refreshClientAccounts(db, { orgId: ORG, clientId: CLIENT, env: ENV, asOf: "2026-11-08T07:00:00.000Z", fetchImpl: plaid.fetch });
    assert.equal(plaid.requests.filter((q) => q.path === "/institutions/get_by_id").length, 1, "the bank was asked again the next day");
    assert.equal(db.logos.inst.size, 1);
  });

  test("a logo that fails never fails the refresh", async () => {
    const db = bothDbs();
    const plaid = plaidFor({ logoStatus: 500 });
    const r = await refreshClientAccounts(db, { orgId: ORG, clientId: CLIENT, env: ENV, asOf: NOW, fetchImpl: plaid.fetch });
    assert.equal(r.ok, true);
    assert.equal(r.totals.written, 1);
    assert.equal(db.logos.inst.size, 0);
  });

  test("an Item with no institution id asks for no logo", async () => {
    const db = bothDbs();
    const plaid = plaidFor({ institutionId: null });
    await refreshClientAccounts(db, { orgId: ORG, clientId: CLIENT, env: ENV, asOf: NOW, fetchImpl: plaid.fetch });
    assert.deepEqual(plaid.requests.map((q) => q.path), ["/accounts/get"]);
  });
});

describe("the backfill", () => {
  const items = [
    { id: "i1", plaid_institution_id: "ins_56" },
    { id: "i2", plaid_institution_id: "ins_56" },
    { id: "i3", plaid_institution_id: " ins_3 " },
    { id: "i4", plaid_institution_id: null }
  ];

  test("without --confirm it only lists the banks: no Plaid call, no write", async () => {
    const db = logoDb({ items });
    const plaid = plaidStub();
    const r = await backfillInstitutionLogos(db, { env: ENV, fetchImpl: plaid.fetch, now: NOW });
    assert.equal(r.confirm, false);
    assert.deepEqual(r.ids, ["ins_3", "ins_56"]);
    assert.equal(plaid.requests.length, 0);
    assert.equal(db.inst.size, 0);
    assert.ok(db.calls.every((c) => !/INSERT|UPDATE/i.test(c.sql)));
  });

  test("with --confirm each bank is asked once and only plaid_institutions is written", async () => {
    const db = logoDb({ items, institutions: [{ plaid_institution_id: "ins_3", logo_fetched_at: NOW, logo_base64: null }] });
    const plaid = plaidStub((body) => plaidAnswer({ institution_id: body.institution_id }));
    const r = await backfillInstitutionLogos(db, { env: ENV, fetchImpl: plaid.fetch, confirm: true, now: "2026-11-07T08:00:00.000Z" });
    assert.equal(r.institutions, 2);
    assert.equal(r.saved, 1);
    assert.equal(r.skipped, 1, "a bank read this month was read again");
    assert.deepEqual(plaid.requests.map((q) => q.body.institution_id), ["ins_56"]);
    for (const c of db.calls.filter((x) => /INSERT|UPDATE/i.test(x.sql))) assert.match(c.sql, /INSERT INTO plaid_institutions/);
  });
});

describe("the routes return the field", () => {
  const res = () => ({
    statusCode: null, body: null, headers: {},
    status(c) { this.statusCode = c; return this; },
    setHeader(k, v) { this.headers[String(k).toLowerCase()] = v; return this; },
    json(o) { this.body = o; return this; }
  });
  const clientGate = async () => ({ kind: "client", accountId: "acc-1", orgId: ORG, clientId: CLIENT });

  test("GET /api/money/banks: each bank carries logo and logo_source, scoped to the session's org", async () => {
    const { default: banks } = await import("../../api/money/banks.mjs");
    const db = logoDb({ lenders: [{ id: CHASE_LENDER, org_id: ORG, name: "Chase", logo_path: "/assets/lenders/chase.png" }] });
    const r = res();
    await banks({ method: "GET", query: {} }, r, {
      db: { query: (sql, p) => (/FROM clients/.test(sql) ? { rows: [{ "?column?": 1 }] } : db.query(sql, p)) },
      requirePrincipal: clientGate,
      now: () => new Date(NOW),
      bankStrategy: async () => ({ ok: true, client: { id: CLIENT, name: "Sam" }, recommended_banks: [{ lender_id: CHASE_LENDER, name: "Chase" }],
        card_stacking: { items: [] }, relationships: [] })
    });
    assert.equal(r.statusCode, 200);
    assert.equal(r.body.recommended_banks[0].logo, "/assets/lenders/chase.png");
    assert.equal(r.body.recommended_banks[0].logo_source, "bank_book");
    assert.equal(db.calls.find((c) => /FROM lenders/.test(c.sql)).params[0], ORG);
  });

  test("accountsView: every account row carries institution, logo and logo_source", async () => {
    const { accountsView } = await import("../finance/money-accounts.mjs");
    const ITEM = "00000000-0000-0000-0000-0000000000a1";
    const logos = logoDb({
      institutions: [{ plaid_institution_id: "ins_56", name: "Chase", name_key: "chase", logo_base64: PNG }],
      items: [{ id: ITEM, org_id: ORG, client_id: CLIENT, plaid_institution_id: "ins_56", institution_name: "Chase" }],
      accounts: [{ id: "acc-chk", org_id: ORG, client_id: CLIENT, plaid_item_id: ITEM }]
    });
    const db = {
      query: async (sql, p) => {
        if (/FROM bank_accounts ba\s+JOIN plaid_items|plaid_institutions|FROM lenders/.test(sql)) return logos.query(sql, p);
        if (/FROM bank_accounts\s+WHERE org_id = \$1 AND client_id = \$2/.test(sql)) {
          return { rows: [{ id: "acc-chk", name: "Total Checking", account_type: "depository", entity_kind: "unknown", plaid_item_id: ITEM }] };
        }
        if (/count\(\*\)/.test(sql)) return { rows: [{ n: 0 }] };
        return { rows: [] };
      }
    };
    const v = await accountsView(db, { orgId: ORG, clientId: CLIENT, env: {} });
    const row = v.unassigned.accounts[0];
    assert.equal(row.name, "Total Checking");
    assert.equal(row.institution, "Chase");
    assert.equal(row.logo, `data:image/png;base64,${PNG}`);
    assert.equal(row.logo_source, "plaid");
  });
});
