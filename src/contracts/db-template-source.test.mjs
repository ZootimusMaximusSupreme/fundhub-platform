// src/contracts/db-template-source.mjs — the body-text patch shape
// (`SET body = replace(body, 'old', 'new')` guarded by `strpos(body, …) > 0`,
// as 592_partner_license_30k.sql writes it). Each case builds a tiny db/ tree in
// a temp folder and reads it the way the guards read the real one. No database.
import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { readContractTemplatesFromDb, bodyReplacementsFrom, bodyGuardFrom } from "./db-template-source.mjs";

const roots = [];
after(() => { for (const r of roots) fs.rmSync(r, { recursive: true, force: true }); });

function tree(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fh-db-template-"));
  roots.push(root);
  fs.mkdirSync(path.join(root, "db", "migrations"), { recursive: true });
  for (const [name, sql] of Object.entries(files)) fs.writeFileSync(path.join(root, "db", "migrations", name), sql);
  return root;
}

const INSERT = `-- seeds the template
INSERT INTO contract_templates (org_id, template_key, name, kind, subtype, body)
VALUES (
  v_org,
  'TEST-LICENSE',
  'Test',
  'contract',
  'partner_license',
  E'WHAT YOU PAY\\n\\n' ||
  E'You pay $10,000 to join. You pay it one time.'
)
ON CONFLICT (org_id, template_key) DO NOTHING;
`;

const PATCH = `-- moves the fee
UPDATE contract_templates
   SET body = replace(body, 'You pay $10,000 to join.', 'You pay $30,000 to join.'),
       updated_at = now()
 WHERE template_key = 'TEST-LICENSE'
   AND strpos(body, 'You pay $10,000 to join.') > 0;
`;

describe("a body-text patch", () => {
  test("reads the pair from the SET clause and the guard from the WHERE", () => {
    assert.deepEqual(bodyReplacementsFrom(PATCH), [["You pay $10,000 to join.", "You pay $30,000 to join."]]);
    assert.equal(bodyGuardFrom(PATCH), "You pay $10,000 to join.");
    assert.equal(bodyReplacementsFrom(INSERT), null, "an INSERT is not a patch");
  });

  test("changes only the patched sentence; the INSERT stays the block", () => {
    const t = readContractTemplatesFromDb(tree({ "001_seed.sql": INSERT, "002_fee.sql": PATCH })).get("TEST-LICENSE");
    assert.equal(t.body, "WHAT YOU PAY\n\nYou pay $30,000 to join. You pay it one time.");
    assert.match(t.block, /INSERT INTO contract_templates/);
    assert.deepEqual(t.sources, ["migrations/001_seed.sql", "migrations/002_fee.sql"]);
  });

  test("run twice, it changes nothing more: the guard no longer matches", () => {
    const t = readContractTemplatesFromDb(tree({ "001_seed.sql": INSERT, "002_fee.sql": PATCH, "003_again.sql": PATCH })).get("TEST-LICENSE");
    assert.equal(t.body, "WHAT YOU PAY\n\nYou pay $30,000 to join. You pay it one time.");
  });

  test("a body without the guard text is left alone, like the UPDATE's WHERE", () => {
    // The replaced sentence is there, but the guard asks for text that is not,
    // so Postgres would match no row and change nothing.
    const guarded = PATCH.replace("strpos(body, 'You pay $10,000 to join.')", "strpos(body, 'Placeholder fee.')");
    assert.equal(bodyGuardFrom(guarded), "Placeholder fee.");
    const t = readContractTemplatesFromDb(tree({ "001_seed.sql": INSERT, "002_fee.sql": guarded })).get("TEST-LICENSE");
    assert.equal(t.body, "WHAT YOU PAY\n\nYou pay $10,000 to join. You pay it one time.");
  });
});
