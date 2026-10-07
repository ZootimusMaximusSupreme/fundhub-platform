// docs/finance/bank-relink.md is the contract the FinanceOS screen is built against. The
// JSON in it must BE what /api/banking/relink returns, so every sample in the doc is
// compared with a live answer from the real handler, the real repair service and the
// real refresh over fixed rows (src/banking/bank-relink-sample.mjs). A change to the API
// that is not in the doc fails here; so does a change to the doc that is not the API.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { buildRelinkSamples } from "../banking/bank-relink-sample.mjs";
import { FIX, ITEM_ERRORS } from "../banking/plaid-item-errors.mjs";
import { TEMPLATE_KEY } from "../finance/bank-reconnect-notice.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const DOC = readFileSync(join(ROOT, "docs", "finance", "bank-relink.md"), "utf8");

/** { name: parsed JSON } from every `<!-- sample:name -->` block in the doc. */
function docSamples() {
  const out = {};
  for (const m of DOC.matchAll(/<!-- sample:([a-z-]+) -->\s*```json\n([\s\S]*?)\n```/g)) out[m[1]] = JSON.parse(m[2]);
  return out;
}

/* Built once, awaited by each test. (Not inside an async describe: tests added after an
   await in a suite callback are not reliably collected.) */
const LIVE = buildRelinkSamples();
const SAMPLES = [
  ["get", "get", 200],
  ["start", "start", 200],
  ["start-refused", "startRefused", 409],
  ["finish-ok", "finishOk", 200],
  ["finish-still-broken", "finishStillBroken", 409]
];

describe("the doc's JSON is what the API returns", () => {
  const doc = docSamples();

  for (const [name, key, status] of SAMPLES) {
    test(`sample:${name} — HTTP ${status}, key for key`, async () => {
      const answer = (await LIVE)[key];
      assert.ok(doc[name], `the doc has no <!-- sample:${name} --> block`);
      assert.equal(answer.status, status);
      assert.deepEqual(doc[name], answer.body);
    });
  }

  test("the doc has no sample the API does not produce", () => {
    assert.deepEqual(Object.keys(doc).sort(), SAMPLES.map(([n]) => n).sort());
  });

  test("no sample carries a credential", async () => {
    const text = JSON.stringify(await LIVE);
    for (const s of ["access-sandbox-sample-token", "v1:", "encrypted", "PLAID_SECRET"]) {
      assert.equal(text.includes(s), false, `a sample contained ${s}`);
    }
  });
});

describe("what the doc promises about the rest", () => {
  test("every state the API can send is in the doc's state table", () => {
    for (const state of ["active", "needs_reconnect", "revoked", "pending", "not_connected"]) {
      assert.ok(DOC.includes(`\`${state}\``), `the doc does not name state ${state}`);
    }
  });

  test("every action the words can offer is in the doc, with the calls that carry it out", () => {
    const fixes = new Set(Object.values(ITEM_ERRORS).map((r) => r.fix));
    for (const fix of fixes) assert.ok(Object.values(FIX).includes(fix));
    for (const fix of Object.values(FIX)) assert.ok(DOC.includes(`\`${fix}\``), `the doc does not name the fix ${fix}`);
    assert.match(DOC, /link-exchange/, "connect_again names the normal flow");
  });

  test("the doc points at the files that hold the rules, and they exist", () => {
    for (const path of [
      "src/banking/plaid-relink.mjs", "src/banking/plaid-item-errors.mjs", "docs/journeys/bank-relink-flow.md",
      "scripts/plaid-relink-sandbox-proof.mjs", "db/migrations/474_bank_reconnect_notice.sql"
    ]) {
      assert.ok(existsSync(join(ROOT, path)), `${path} is gone`);
    }
    assert.match(DOC, /docs\/journeys\/bank-relink-flow\.md/);
    assert.match(DOC, /plaid-item-errors\.mjs/);
    assert.match(DOC, /474/);
    assert.ok(DOC.includes(TEMPLATE_KEY), "the doc names the template key the code sends");
  });

  test("the browser snippet never exchanges a public token after update mode", () => {
    const snippet = /```js\n([\s\S]*?)\n```/.exec(DOC)[1];
    assert.match(snippet, /action: "finish"/);
    assert.match(snippet, /action: "start"/);
    assert.doesNotMatch(snippet.replace(/\/\/.*$/gm, ""), /link-exchange|public_token/, "the snippet's code (not its comments) exchanges a token");
  });

  test("the doc says the access token never appears, and names the webhook gap", () => {
    assert.match(DOC, /access token never appears/i);
    assert.match(DOC, /No Plaid webhook route exists/);
  });

  test("the company is spelled Fundhub", () => {
    assert.doesNotMatch(DOC, /FundHub|Fund Hub|FUNDHUB/);
  });
});
