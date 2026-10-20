import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  blueprintContractValues, createDraft, saveDraft, preview, send, bodyHash
} from "./send.mjs";
import { assertBlueprintAgreementPrice } from "./blueprint-price.mjs";

const KEY = "CAPITAL-BLUEPRINT-AGREEMENT";
const BODY = "The tuition for this program is {{field.package_fee}} United States dollars.\n" +
  "Tuition is {{field.package_fee}}, charged one time. There is no recurring billing and no subscription.";
const args = { orgId: "org", staffId: "staff", clientId: "client", templateId: "template", id: "contract" };

function fakeDb({ values = {}, body = BODY, status = "draft", sourceKind = "text" } = {}) {
  const contract = {
    id: "contract", org_id: "org", client_id: "client", template_id: "template",
    template_key: KEY, title: "Blueprint", kind: "contract", subtype: "capital_blueprint",
    status, source_kind: sourceKind, merge_values: values
  };
  const template = {
    id: "template", template_key: KEY, body, active: true, manual_fields: [],
    kind: "contract", name: "Blueprint", source_kind: sourceKind
  };
  const writes = [];
  return {
    contract, template, writes,
    async query(sql, params = []) {
      if (/FROM contract_templates/.test(sql)) return { rows: [template] };
      if (/FROM contracts\b/.test(sql)) return { rows: [contract] };
      if (/INSERT INTO contracts\b/.test(sql)) {
        writes.push(sql);
        contract.merge_values = JSON.parse(params[8]);
        return { rows: [contract] };
      }
      if (/UPDATE contracts SET merge_values/.test(sql)) {
        writes.push(sql);
        contract.merge_values = JSON.parse(params[2]);
        return { rows: [contract] };
      }
      if (/FROM clients\b/.test(sql)) return { rows: [{ first_name: "Test", last_name: "Buyer" }] };
      if (/FROM contract_signers/.test(sql)) return { rows: [{ id: "signer", signer_index: 0 }] };
      if (/UPDATE contract_signers|INSERT INTO contract_signers/.test(sql)) return { rows: [{ id: "signer", signer_index: 0 }] };
      throw new Error(`Unexpected query: ${sql.slice(0, 80)}`);
    }
  };
}

for (const amountCents of [500000, 750000, 1000000]) {
  test(`draft and preview preserve ${amountCents} cents in both price clauses`, async () => {
    const db = fakeDb();
    const draft = await createDraft(db, { ...args, amountCents });
    const expected = `$${(amountCents / 100).toLocaleString("en-US")}`;
    assert.equal(draft.merge_values.package_fee, expected);
    assert.equal(draft.merge_values._blueprint_amount_cents, amountCents);
    const saved = await saveDraft(db, { ...args, title: "Preserve chosen price" });
    assert.equal(saved.merge_values.package_fee, expected);
    const out = await preview(db, { ...args, values: saved.merge_values });
    assert.equal(out.body.split(expected).length - 1, 2);
    assert.deepEqual(out.missing_tags, []);
  });
}

test("a fresh draft with no amount uses the $5,000 default", async () => {
  const db = fakeDb();
  assert.equal((await createDraft(db, args)).merge_values.package_fee, "$5,000");
});

for (const amountCents of [499999, 1000001, "750000", 750000.5, 750001, null]) {
  test(`invalid explicit amount ${JSON.stringify(amountCents)} is refused before writing`, async () => {
    const db = fakeDb();
    await assert.rejects(createDraft(db, { ...args, amountCents }), { code: "invalid_blueprint_amount" });
    assert.deepEqual(db.writes, []);
  });
}

test("explicit amount and fee wording cannot disagree", async () => {
  const db = fakeDb();
  await assert.rejects(createDraft(db, { ...args, amountCents: 1000000, values: { package_fee: "$5,000" } }),
    { code: "blueprint_amount_mismatch" });
  assert.deepEqual(db.writes, []);
});

test("save preserves a legacy custom fee and refuses an unpriced fee change", async () => {
  const db = fakeDb({ values: { package_fee: "$7,500", scope: "keep this" } });
  const saved = await saveDraft(db, args);
  assert.equal(saved.merge_values.package_fee, "$7,500");
  assert.equal(saved.merge_values.scope, "keep this");
  await assert.rejects(saveDraft(db, { ...args, values: { package_fee: "$5,000" } }),
    { code: "blueprint_amount_mismatch" });
});

test("save can deliberately change the selected amount using validated cents", async () => {
  const db = fakeDb({ values: { package_fee: "$7,500", _blueprint_amount_cents: 750000 } });
  assert.equal((await saveDraft(db, { ...args, amountCents: 1000000 })).merge_values.package_fee, "$10,000");
});

test("out-of-range and malformed fee-only values are refused", () => {
  for (const package_fee of ["$1,000", "$10,001", "$7,500.01", "$7,500.001", "7,5,00", "7500oops"]) {
    assert.throws(() => blueprintContractValues(KEY, { package_fee }), { code: "invalid_blueprint_amount" });
  }
});

test("saved amount/fee tampering is refused before send can store or notify", async () => {
  const db = fakeDb({ values: { package_fee: "$5,000", _blueprint_amount_cents: 1000000 } });
  await assert.rejects(send(db, args), { code: "blueprint_amount_mismatch" });
  assert.deepEqual(db.writes, []);
});

test("send rejects a price different from the selected draft", async () => {
  const db = fakeDb({ values: { package_fee: "$7,500", _blueprint_amount_cents: 750000 } });
  await assert.rejects(send(db, { ...args, amountCents: 1000000 }), { code: "blueprint_amount_mismatch" });
  assert.deepEqual(db.writes, []);
});

test("custom price requires both runtime template clauses to be updated", async () => {
  for (const body of ["Tuition is five thousand dollars ($5,000).", "Tuition: {{field.package_fee}}. $5,000."]) {
    const db = fakeDb({ body, values: { package_fee: "$7,500" } });
    await assert.rejects(send(db, args), { code: "blueprint_price_template_outdated" });
    assert.deepEqual(db.writes, []);
  }
});

test("custom draft and preview fail closed before the template migration is applied", async () => {
  const db = fakeDb({ body: "Tuition is five thousand dollars ($5,000)." });
  await assert.rejects(createDraft(db, { ...args, amountCents: 750000 }), { code: "blueprint_price_template_outdated" });
  await assert.rejects(preview(db, { ...args, amountCents: 750000 }), { code: "blueprint_price_template_outdated" });
  assert.deepEqual(db.writes, []);
});

test("saving a signed agreement cannot change its selected price", async () => {
  const db = fakeDb({ status: "signed", values: { package_fee: "$7,500", _blueprint_amount_cents: 750000 } });
  await assert.rejects(saveDraft(db, { ...args, amountCents: 1000000 }), { code: "already_sent" });
  assert.deepEqual(db.writes, []);
});

test("the send renderer passes the saved custom amount to immutable storage", async () => {
  const db = fakeDb({ values: { package_fee: "$10,000", _blueprint_amount_cents: 1000000 } });
  let captured;
  await assert.rejects(send(db, {
    ...args, amountCents: 1000000,
    store: { async put(input) { captured = input.body; throw new Error("storage capture only"); } }
  }), /storage capture only/);
  assert.equal(captured.split("$10,000").length - 1, 2);
  assert.doesNotMatch(captured, /\$5,000/);
});

test("non-Blueprint contracts reject a custom amount and keep their existing defaults", () => {
  assert.throws(() => blueprintContractValues("FUNDING-AGREEMENT", {}, { amountCents: 750000 }),
    { code: "invalid_blueprint_amount" });
  assert.equal(blueprintContractValues("FUNDING-AGREEMENT", {}).deposit, "$3,000");
});

test("migration changes only the two template price phrases and leaves signed copies alone", () => {
  const sql = readFileSync(new URL("../../db/migrations/483_blueprint_variable_agreement_price.sql", import.meta.url), "utf8");
  const statements = sql.split("\n").filter((line) => !/^\s*--/.test(line)).join("\n");
  assert.match(statements, /UPDATE contract_templates/);
  assert.doesNotMatch(statements, /UPDATE contracts\b|DELETE|ALTER TABLE/i);
  assert.match(statements, /manual_fields = '\[\]'::jsonb/);
  assert.equal((statements.match(/\{\{field\.package_fee\}\}/g) || []).length, 2);
  assert.match(statements, /WHERE template_key = 'CAPITAL-BLUEPRINT-AGREEMENT'/);
});

test("checkout requires the latest frozen agreement for the same company, client and price", async () => {
  let query;
  const body = "Tuition $7,500, charged one time.";
  const contract = { id: "agreement", status: "signed", merge_values: { package_fee: "$7,500" }, rendered_body: body, body_sha: bodyHash(body) };
  const db = { async query(sql, params) { query = { sql, params }; return { rows: [contract] }; } };
  assert.deepEqual(await assertBlueprintAgreementPrice(db, { ...args, amountCents: 750000 }),
    { contractId: "agreement", amountCents: 750000 });
  assert.deepEqual(query.params, ["org", "client"]);
  assert.match(query.sql, /ORDER BY created_at DESC, id DESC/);
  assert.match(query.sql, /status NOT IN \('void', 'declined'\)/);
  for (const status of ["draft", "void", "declined"]) {
    contract.status = status;
    await assert.rejects(assertBlueprintAgreementPrice(db, { ...args, amountCents: 750000 }), { code: "blueprint_agreement_required" });
  }
  contract.status = "sent";
  await assert.rejects(assertBlueprintAgreementPrice(db, { ...args, amountCents: 1000000 }), { code: "blueprint_agreement_price_mismatch" });
  contract.rendered_body += " Tuition is five thousand dollars ($5,000).";
  contract.body_sha = bodyHash(contract.rendered_body);
  await assert.rejects(assertBlueprintAgreementPrice(db, { ...args, amountCents: 750000 }), { code: "blueprint_agreement_price_mismatch" });
  contract.rendered_body = body;
  contract.rendered_body += " changed";
  await assert.rejects(assertBlueprintAgreementPrice(db, { ...args, amountCents: 750000 }), { code: "blueprint_agreement_price_mismatch" });
});

test("checkout refuses a missing agreement or noncanonical fee", async () => {
  await assert.rejects(assertBlueprintAgreementPrice({ async query() { return { rows: [] }; } }, { ...args, amountCents: 500000 }),
    { code: "blueprint_agreement_required" });
  const body = "Tuition $7,500.";
  const db = { async query() { return { rows: [{ status: "sent", merge_values: { package_fee: "7500" }, rendered_body: body, body_sha: bodyHash(body) }] }; } };
  await assert.rejects(assertBlueprintAgreementPrice(db, { ...args, amountCents: 750000 }), { code: "blueprint_agreement_price_mismatch" });
});
