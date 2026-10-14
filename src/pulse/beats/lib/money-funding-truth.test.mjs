import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { confirmedApprovalConditions, unpricedApprovalConditions } from "../../../funding/success-fee.mjs";
import * as daily from "../../coverage/gap-money-funding.mjs";
import * as truth from "./money-funding-truth.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const IMPORT_RE = /\b(?:import|export)\s+(?:[\s\S]*?\s+from\s+)?["']([^"']+)["']/g;

test("money funding truth: runtime has no dependency outside the beat-safe folder", () => {
  const seen = new Set();
  const visit = (file) => {
    const full = path.resolve(HERE, file);
    assert.equal(full.startsWith(`${HERE}${path.sep}`), true, `${file} left beats/lib`);
    if (seen.has(full)) return;
    seen.add(full);
    const source = fs.readFileSync(full, "utf8");
    assert.doesNotMatch(source, /\b(?:process\.env|fetch\s*\(|readFile|writeFile|node:fs|node:https?)\b/);
    for (const match of source.matchAll(IMPORT_RE)) {
      const spec = match[1];
      assert.equal(spec.startsWith("./"), true, `${path.basename(full)} imports ${spec}`);
      visit(spec);
    }
  };
  visit("money-funding-truth.mjs");
  assert.deepEqual(
    [...seen].map((file) => path.basename(file)).sort(),
    ["money-funding-checks.mjs", "money-funding-sql.mjs", "money-funding-truth.mjs"]
  );
});

test("money funding truth: daily lane re-exports the exact SQL and verdict functions", () => {
  for (const name of [
    "FUNDED_ROUNDS_SQL",
    "FUNDED_CARDS_SQL",
    "APPROVED_NO_AMOUNT_SQL",
    "HELD_PAYOUTS_SQL",
    "APPROVED_UNPAID_SQL",
    "LEDGER_RULE_SQL",
    "OPEN_VERSIONS_SQL",
    "SLO_PRODUCTS_SQL",
    "SAMPLE_ROWS_SQL",
    "roundProblems",
    "judgeFundedBills",
    "judgeApprovedNoAmount",
    "judgeHeldPayouts",
    "judgeLedger",
    "judgeSloMap",
    "judgeSampleRows"
  ]) {
    assert.equal(daily[name], truth[name], name);
  }
});

test("money funding truth: approval SQL stays pinned to the biller's pure conditions", () => {
  const compact = (value) => String(value).replaceAll(/\s+/g, " ").trim();
  assert.match(compact(truth.FUNDED_ROUNDS_SQL), new RegExp(compact(confirmedApprovalConditions("a")).replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(compact(truth.APPROVED_NO_AMOUNT_SQL), new RegExp(compact(unpricedApprovalConditions("a")).replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});

test("money funding truth: injected read runner and daily wrapper return identical rows", async () => {
  const orgId = "00000000-0000-4000-8000-000000000001";
  const now = new Date("2026-10-10T15:00:00.000Z");
  const answers = new Map([
    [truth.HELD_PAYOUTS_SQL, [{ kind: "affiliate", who: "Pat", amount: 125, created_at: now, license_missing: true, total: 1 }]]
  ]);
  const read = async (sql) => ({ rows: answers.get(sql) || [] });
  const direct = await truth.runMoneyFundingChecks({ read, orgId, now });
  const wrapped = await daily.gapChecks({ db: { query: read }, orgId, now });
  assert.deepEqual(wrapped, direct);
  assert.equal(direct.find((row) => row.id === "partners:payout-held").status, "FAIL");
});
