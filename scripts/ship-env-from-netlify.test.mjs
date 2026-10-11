import { test } from "node:test";
import assert from "node:assert/strict";
import { loadShipDatabase, productionDatabaseUrl } from "./ship-env-from-netlify.mjs";

const url = "postgres://app:example-password@db.example.test:5432/production";
const entry = (values) => [{ key: "DATABASE_URL", values }];

test("uses the production app connection and rejects masked, missing and non-database values", () => {
  assert.equal(productionDatabaseUrl(entry([{ context: "all", value: "postgres://fallback@db.test/db" }, { context: "production", value: url }])), url);
  assert.equal(productionDatabaseUrl(entry([{ context: "all", value: url }])), url);
  for (const value of ["", "********", "https://db.example.test", url + "\nINJECTED=true"]) {
    assert.throws(() => productionDatabaseUrl(entry([{ context: "production", value }])));
  }
  assert.throws(() => productionDatabaseUrl([]));
});

test("loads only this site's connection, masks it, and preserves an existing local credential file", async () => {
  const calls = [], writes = [], logs = [];
  await loadShipDatabase({
    env: { NETLIFY_AUTH_TOKEN: "example-token", NETLIFY_SITE_ID: "site-1", GITHUB_ENV: "runner-env" },
    fetcher: async (endpoint, options) => {
      calls.push({ endpoint, options });
      return { ok: true, json: async () => calls.length === 1 ? { id: "site-1", account_id: "account-1" } : entry([{ context: "production", value: url }]) };
    },
    write: (...args) => writes.push(args), exists: () => true, log: (s) => logs.push(s)
  });
  assert.equal(calls[1].endpoint, "https://api.netlify.com/api/v1/accounts/account-1/env?site_id=site-1");
  assert.equal(writes.length, 1);
  assert.equal(writes[0][0], "runner-env");
  assert.equal(logs[0], "::add-mask::" + url);
  assert.ok(logs.slice(1).every((s) => !s.includes(url)));
});

test("never writes credentials when Netlify denies access or returns a different project", async () => {
  for (const response of [{ ok: false, status: 401 }, { ok: true, json: async () => ({ id: "another-site", account_id: "account-1" }) }]) {
    const writes = [];
    await assert.rejects(loadShipDatabase({
      env: { NETLIFY_AUTH_TOKEN: "example-token", NETLIFY_SITE_ID: "site-1", GITHUB_ENV: "runner-env" },
      fetcher: async () => response, write: (...args) => writes.push(args), log: () => {}
    }));
    assert.equal(writes.length, 0);
  }
});
