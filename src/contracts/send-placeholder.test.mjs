// A template that still carries the "DO NOT SEND THIS" placeholder refuses to
// send (walkthrough-4 defect 2, 2026-09-06). Runs without a database: send()
// is driven through a two-query fake that answers the contract read and the
// template read, and the refusal must land before anything else is touched.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { send, hasPlaceholderText } from "./send.mjs";

const SEED = readFileSync(new URL("../../db/seed/007_contract_templates.sql", import.meta.url), "utf8");
const M287 = readFileSync(new URL("../../db/migrations/287_contract_seller_signature_and_real_text.sql", import.meta.url), "utf8");

const ORG = "00000000-0000-4000-8000-000000000001";
const ID = "00000000-0000-4000-8000-000000000002";
const TPL = "00000000-0000-4000-8000-000000000003";

function fakeDb(templateBody) {
  const seen = [];
  return {
    seen,
    async query(sql) {
      seen.push(sql);
      if (/FROM contracts\b/.test(sql)) {
        return { rows: [{ id: ID, org_id: ORG, client_id: "c", template_id: TPL, template_key: "FUNDING-AGREEMENT", status: "draft", source_kind: "text", merge_values: {} }] };
      }
      if (/FROM contract_templates\b/.test(sql)) {
        return { rows: [{ id: TPL, org_id: ORG, template_key: "FUNDING-AGREEMENT", body: templateBody, manual_fields: [] }] };
      }
      throw new Error(`send() went past the placeholder check and ran: ${sql.slice(0, 80)}`);
    }
  };
}

test("the marker the seed and migration 287 wrote is recognised", () => {
  for (const [name, src] of [["seed 007", SEED], ["migration 287", M287]]) {
    const line = src.split("\n").find((l) => /DO NOT SEND THIS/.test(l));
    assert.ok(line, `${name} no longer carries the placeholder line — re-check this test`);
    assert.equal(hasPlaceholderText(line), true, `${name}'s placeholder line was not recognised`);
  }
});

test("ordinary agreement wording is not mistaken for a placeholder", () => {
  assert.equal(hasPlaceholderText("This Consulting Services Agreement is made between {{client.name}} and Fundhub."), false);
  assert.equal(hasPlaceholderText(""), false);
  assert.equal(hasPlaceholderText(null), false);
});

test("send() refuses a placeholder template with a 409 before reading signers", async () => {
  const db = fakeDb(">>> PLACEHOLDER. THIS IS NOT THE REAL AGREEMENT TEXT. DO NOT SEND THIS. <<<");
  await assert.rejects(
    () => send(db, { orgId: ORG, staffId: "s", id: ID }),
    (err) => err.status === 409 && err.code === "placeholder_text" && /placeholder/i.test(err.message)
  );
  assert.equal(db.seen.length, 2, "only the contract and the template were read");
});

test("send() lets a real template past the placeholder check", async () => {
  const db = fakeDb("This Consulting Services Agreement is made between the parties.");
  // The fake answers nothing after the template, so getting past the check is
  // proved by send() asking for the signers next.
  await assert.rejects(
    () => send(db, { orgId: ORG, staffId: "s", id: ID }),
    /went past the placeholder check/
  );
});
