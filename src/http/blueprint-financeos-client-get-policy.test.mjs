// Capital Blueprint / FinanceOS client GET policy. Synthetic sessions only.
import { test } from "node:test";
import assert from "node:assert/strict";
import overview from "../../api/money/overview.mjs";
import banks from "../../api/money/banks.mjs";

const ORG = "org-synthetic";
const MINE = "11111111-2222-4333-8444-555555555555";
const OTHER = "99999999-8888-4777-8666-555555555555";
const AT = new Date("2026-10-29T00:00:00Z");

function response() {
  return {
    statusCode: null, body: null, headers: {},
    setHeader(name, value) { this.headers[name] = value; return this; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }
  };
}

const session = async () => ({
  kind: "client", accountId: "account-synthetic", orgId: ORG, clientId: MINE
});
const noDatabase = {
  async query() { throw new Error("Unexpected database query"); }
};

for (const [name, route, buildKey, payload] of [
  ["overview", overview, "moneyOverview", { ok: true, balances: ["synthetic"] }],
  ["banks", banks, "bankStrategy", { ok: true, recommended_banks: [], next_sequence: { suggestion: null } }]
]) {
  for (const [access, entitled] of [["nonbuyer", false], ["expired Blueprint", false],
    ["paid monthly", true], ["active Blueprint year", true]]) {
    test(`${name} client GET ${access}: gate uses session identity and ${entitled ? "returns" : "denies"} data`, async () => {
      const res = response();
      let built = 0;
      let checked = null;
      await route({ method: "GET", query: { client_id: OTHER } }, res, {
        db: noDatabase, requirePrincipal: session,
        financeOsEntitlement: async (_db, args) => {
          checked = args;
          return { entitled, subscriptionId: entitled ? "synthetic-access" : null };
        },
        [buildKey]: async (_db, args) => {
          built += 1;
          assert.equal(args.orgId, ORG);
          assert.equal(args.clientId, MINE);
          return { ...payload, clientId: args.clientId };
        },
        now: () => AT, env: {}
      });
      assert.deepEqual(checked, { orgId: ORG, clientId: MINE, asOf: AT });
      assert.equal(res.statusCode, entitled ? 200 : 403);
      assert.equal(built, entitled ? 1 : 0, "denied clients never reach premium data builders");
      if (entitled) assert.equal(res.body.clientId, MINE);
      else assert.equal(res.body.error, "finance_os_not_entitled");
    });
  }
}
