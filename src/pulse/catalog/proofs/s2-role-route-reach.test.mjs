// "should be able to reach" and "should stay blocked" rows of the role journeys.
//
// The journey pages are a copy of what the code says; nothing signed in as a
// role and opened a route. This does: for each of the eight kinds of person, it
// signs in against a stand-in database and sends a GET and an empty POST through
// the REAL api adapter to every route (src/pulse/catalog/proofs/s2-role-probe.mjs),
// then judges each row's exact named group.
//
// A route counts toward a row only when two independent answers agree: the
// gate as written in the handler (scripts/journeys/extract.mjs) and what the
// route actually did to this person. Routes where the two disagree are named in
// EXPECTED_DISAGREEMENTS, with the reason, and are never counted as proved.
//
// A row passes when the agreed count in its group is at least the number the
// row names AND at least the count measured when this proof was written (FLOORS),
// so one route that is opened or closed by mistake turns a row red.
import assert from "node:assert/strict";
import fs from "node:fs";
import { before, describe, test } from "node:test";

import api from "../../../../netlify/functions/api.mjs";
import { extractAll, JOURNEYS, reaches } from "../../../../scripts/journeys/extract.mjs";
import { OPENS, probeRoute, verdictFor } from "./s2-role-probe.mjs";

const ROOT = new URL("../../../../", import.meta.url);
const JOURNEY_ROWS = JSON.parse(fs.readFileSync(
  new URL("ops/workflows/coverage-every-surface-2026-10-10/journeys.json", ROOT), "utf8"));

// Same grouping the journey pages use (scripts/journeys/render.mjs): the first
// path segment, with a few friendly names.
const AREA_LABEL = {
  read: "Reading data", dashboard: "The dashboard", campaigns: "Campaigns", creative: "Creative Factory",
  hiring: "Hiring", auth: "Signing in and out", finance: "Finance", webhooks: "Incoming webhooks",
  documents: "Documents", "top level": "Everything else",
};
const groupOf = (key) => {
  const area = key.includes("/") ? key.split("/")[0] : "top level";
  return AREA_LABEL[area] || area;
};

/* Routes whose empty-body probe is refused for being empty BEFORE the role check
   runs, so the probe sees a late 400 and the static reading sees a role gate. */
const VALIDATES_BODY_FIRST = [
  "brand/review", "partner-marketing/copy-history", "partner-marketing/enable",
  "partner-marketing/generate-copy", "partner-marketing/generate-logo", "partner-marketing/usage",
  "social/posts", "social/settings",
];
/* A client signed in to their own file reaches these; the static reading draws
   them as staff-only because it does not follow the client branch. */
const CLIENT_OWN_FILE = ["banking/link-exchange", "banking/link-token"];
/* 495: the payout-bank door admits the affiliate and client KINDS, then pins
   the caller to the affiliate id on their own session (a client only when a
   light affiliate, accounts.affiliate_id). The probe sessions carry no
   affiliate id, so the door answers 403 not_an_affiliate — correct; the static
   reading only sees the kinds. */
const CLIENT_LIGHT_AFFILIATE = ["affiliates/payout-account"];
const EXPECTED_DISAGREEMENTS = {
  client: [...CLIENT_OWN_FILE, ...CLIENT_LIGHT_AFFILIATE, "auth/authorized-rep-file"],
  // Native device registration has a client/staff outer gate, then permits
  // only owner, setter, and closer staff. The static reader sees the outer gate.
  "role-sales-manager": [...VALIDATES_BODY_FIRST, "push/native-device"],
  // A closer may create a payment link and is refused every other action: the
  // empty probe lands on an action the closer is refused.
  "role-closer": [...VALIDATES_BODY_FIRST, "payment-links"],
  "role-funding-advisor": [...VALIDATES_BODY_FIRST, "money/setup", "push/native-device"],
  "role-inquiry-remover": [...VALIDATES_BODY_FIRST, "money/setup", "push/native-device"],
  // This route has two doors. The static journey sees its signed playback URL;
  // the session-only probe sends no signature and therefore reaches the
  // metadata door, which correctly refuses affiliate and partner sessions.
  affiliate: ["content/welcome-video", "money/setup", ...CLIENT_LIGHT_AFFILIATE],
  "white-label": ["content/welcome-video", "money/setup"],
};

const FLOORS = {
  "affiliate|reach": { "Signing in and out": 6, "contracts": 1, "Documents": 1, "Everything else": 4, "Incoming webhooks": 1 },
  "affiliate|blocked": { "Signing in and out": 8, "banking": 7, "Campaigns": 10, "consent": 1, "Creative Factory": 7, "The dashboard": 7, "Finance": 13, "Hiring": 7, "journeys": 2, "privacy": 1, "Reading data": 65, "Everything else": 39 },
  "client|reach": { "Signing in and out": 6, "consent": 1, "contracts": 1, "Documents": 1, "Finance": 1, "Reading data": 6, "Everything else": 8, "Incoming webhooks": 1 },
  // The client-only push/preferences route and the client affiliate read are now
  // reachable. The explicit assertions below pin both changes.
  "client|blocked": { "Signing in and out": 7, "banking": 5, "Campaigns": 10, "Creative Factory": 7, "The dashboard": 7, "Finance": 12, "Hiring": 7, "journeys": 2, "privacy": 1, "Reading data": 62, "Everything else": 34 },
  "role-owner|reach": { "Signing in and out": 13, "banking": 7, "Campaigns": 10, "consent": 1, "contracts": 1, "Creative Factory": 7, "The dashboard": 7, "Documents": 1, "Finance": 13, "Hiring": 8, "journeys": 2, "privacy": 1, "Reading data": 67, "Everything else": 42, "Incoming webhooks": 1 },
  "role-owner|blocked": {  },
  "role-sales-manager|reach": { "Signing in and out": 6, "banking": 6, "Campaigns": 10, "contracts": 1, "Creative Factory": 7, "The dashboard": 6, "Documents": 1, "Finance": 11, "Reading data": 56, "Everything else": 30, "Incoming webhooks": 1 },
  "role-sales-manager|blocked": { "Signing in and out": 8, "banking": 1, "consent": 1, "Finance": 2, "Hiring": 7, "journeys": 1, "privacy": 1, "Reading data": 11, "Everything else": 13 },
  "role-closer|reach": { "Signing in and out": 6, "banking": 5, "Campaigns": 10, "consent": 1, "contracts": 1, "Creative Factory": 7, "The dashboard": 6, "Documents": 1, "Finance": 7, "Reading data": 49, "Everything else": 25, "Incoming webhooks": 1 },
  "role-closer|blocked": { "Signing in and out": 8, "banking": 2, "Finance": 6, "Hiring": 7, "journeys": 2, "privacy": 1, "Reading data": 18, "Everything else": 17 },
  "role-funding-advisor|reach": { "Signing in and out": 6, "banking": 1, "Campaigns": 10, "consent": 1, "contracts": 1, "Creative Factory": 7, "The dashboard": 6, "Documents": 1, "Finance": 7, "Reading data": 53, "Everything else": 26, "Incoming webhooks": 1 },
  "role-funding-advisor|blocked": { "Signing in and out": 8, "banking": 6, "Finance": 6, "Hiring": 7, "journeys": 2, "privacy": 1, "Reading data": 15, "Everything else": 17 },
  "role-inquiry-remover|reach": { "Signing in and out": 6, "banking": 1, "Campaigns": 10, "contracts": 1, "Creative Factory": 7, "The dashboard": 6, "Documents": 1, "Finance": 5, "Reading data": 50, "Everything else": 25, "Incoming webhooks": 1 },
  "role-inquiry-remover|blocked": { "Signing in and out": 8, "banking": 6, "consent": 1, "Finance": 8, "Hiring": 7, "journeys": 2, "privacy": 1, "Reading data": 18, "Everything else": 18 },
  "white-label|reach": { "Signing in and out": 6, "Campaigns": 10, "contracts": 1, "Creative Factory": 7, "Documents": 1, "Reading data": 5, "Everything else": 6, "Incoming webhooks": 1 },
  "white-label|blocked": { "Signing in and out": 8, "banking": 7, "consent": 1, "The dashboard": 7, "Finance": 13, "Hiring": 7, "journeys": 2, "privacy": 1, "Reading data": 63, "Everything else": 37 },
};

const state = { verdicts: {}, disagreements: {}, agreed: {} };

before(async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("network refused in this test"); };
  try {
    const data = extractAll();
    const keys = data.endpoints.map((e) => e.key).filter((key) => key !== "inngest");
    for (const journey of JOURNEYS) {
      const verdicts = {};
      for (const key of keys) verdicts[key] = verdictFor(await probeRoute(api, key, journey.name));
      state.verdicts[journey.name] = verdicts;
      state.disagreements[journey.name] = [];
      state.agreed[journey.name] = { reach: {}, blocked: {} };
      for (const endpoint of data.endpoints) {
        if (endpoint.key === "inngest") continue;
        const written = reaches(journey, endpoint.gate).reachable;
        if (written === null) continue;
        const opens = OPENS.has(verdicts[endpoint.key]);
        const group = groupOf(endpoint.key);
        if (written !== opens) {
          state.disagreements[journey.name].push(endpoint.key);
        } else if (opens) {
          state.agreed[journey.name].reach[group] = (state.agreed[journey.name].reach[group] || 0) + 1;
        } else {
          state.agreed[journey.name].blocked[group] = (state.agreed[journey.name].blocked[group] || 0) + 1;
        }
      }
    }
  } finally {
    globalThis.fetch = realFetch;
  }
});

describe("the probe and the written gates", () => {
  test("bank outreach admits its four staff roles and denies other staff, outside accounts and anonymous requests", async () => {
    const data = extractAll();
    const allowed = ["role-owner", "role-admin", "role-sales-manager", "role-outbound-rep"];
    const denied = ["role-closer", "role-funding-advisor", "role-inquiry-remover", "role-csm", "role-setter", "client", "affiliate", "white-label"];
    for (const key of ["bank-outreach", "read/bank-outreach"]) {
      const endpoint = data.endpoints.find((e) => e.key === key);
      assert.ok(endpoint, `${key} is routed`);
      assert.deepEqual([...endpoint.gate.roles].sort(), ["admin", "outbound_rep", "owner", "sales_manager"]);
      for (const name of allowed) assert.equal(verdictFor(await probeRoute(api, key, name)), "reach", `${name}: ${key}`);
      for (const name of denied) assert.equal(verdictFor(await probeRoute(api, key, name)), "blocked", `${name}: ${key}`);
      assert.equal(verdictFor(await probeRoute(api, key)), "blocked", `anonymous: ${key}`);
    }
    for (const key of ["dashboard/clients", "read/lenders", "read/documents"]) {
      assert.ok(data.endpoints.some((e) => e.key === key), `${key} is routed`);
      assert.equal(verdictFor(await probeRoute(api, key, "role-outbound-rep")), "blocked", `outbound rep: ${key}`);
    }
  });

  test("only a signed-in client with a file reaches the marketing push switch", () => {
    assert.equal(state.verdicts.client["push/preferences"], "reach");
    assert.equal(state.verdicts.client["read/affiliates"], "reach");
    for (const journey of JOURNEYS) {
      if (journey.name === "client") continue;
      assert.equal(state.verdicts[journey.name]["push/preferences"], "blocked", journey.name);
    }
  });

  test("native device registration denies other staff roles", () => {
    assert.equal(state.verdicts["role-sales-manager"]["push/native-device"], "blocked");
    assert.equal(state.verdicts["role-funding-advisor"]["push/native-device"], "blocked");
    assert.equal(state.verdicts["role-inquiry-remover"]["push/native-device"], "blocked");
  });

  test("agree on every route except the ones named here, and no stale name is left", () => {
    for (const journey of JOURNEYS) {
      assert.deepEqual(
        [...state.disagreements[journey.name]].sort(),
        [...(EXPECTED_DISAGREEMENTS[journey.name] || [])].sort(),
        journey.name,
      );
    }
  });

  test("a webhook door is judged by its signature, not by who is signed in", () => {
    for (const journey of JOURNEYS) {
      assert.equal(state.verdicts[journey.name]["webhooks/:provider"], "secret-door", journey.name);
    }
  });
});

const ROLE_ROW = /^journey:(.+)-intended#(reach-.+|stays-blocked)$/;
const SALES_MANAGER_RUNNER_POLICY = "journey:role-sales-manager-policy#stays-blocked-journey-runner";
const ROWS = JOURNEY_ROWS.filter((row) => {
  const m = ROLE_ROW.exec(row.surface);
  return row.surface === SALES_MANAGER_RUNNER_POLICY || (m && JOURNEYS.some((j) => j.name === m[1]));
});

describe("each journey row, judged on its own named group", () => {
  test("the rows are the ones the catalog lists", () => {
    assert.equal(ROWS.length, 90);
  });

  for (const row of ROWS) {
    const parsed = ROLE_ROW.exec(row.surface);
    const name = parsed?.[1];
    const kind = parsed?.[2];
    test(row.surface, () => {
      if (row.surface === SALES_MANAGER_RUNNER_POLICY) {
        assert.equal(state.verdicts["role-sales-manager"]["journeys/run"], "blocked");
        assert.equal(state.verdicts["role-owner"]["journeys/run"], "reach");
        return;
      }
      if (kind === "stays-blocked") {
        const groups = [...row.control.split(": ").slice(1).join(": ").matchAll(/([^,()]+?) \((\d+)\)/g)]
          .map((m) => [m[1].trim(), Number(m[2])]);
        assert.ok(groups.length > 0, row.control);
        for (const [group, named] of groups) {
          const agreed = state.agreed[name].blocked[group] || 0;
          const floor = FLOORS[`${name}|blocked`][group];
          assert.ok(floor >= named, `${name} blocked ${group}: floor ${floor} is under the named ${named}`);
          assert.ok(agreed >= floor, `${name} is no longer blocked from ${group}: ${agreed} of ${floor} routes`);
        }
      } else {
        const m = /should be able to reach: (.+) \((\d+) routes?\)$/.exec(row.control);
        assert.ok(m, row.control);
        const [group, named] = [m[1], Number(m[2])];
        const agreed = state.agreed[name].reach[group] || 0;
        const floor = FLOORS[`${name}|reach`][group];
        assert.ok(floor >= named, `${name} reach ${group}: floor ${floor} is under the named ${named}`);
        assert.ok(agreed >= floor, `${name} can no longer reach ${group}: ${agreed} of ${floor} routes`);
      }
    });
  }
});
