// The marketing machine API contract: the doc and the module must say the same
// thing, and every example must pass its own contract. No database, no network.
//
// docs/specs/marketing-machine-api.md is what people read.
// src/marketing/api-contract.mjs is what code checks against.
// Spec §7.8: a PR that changes a route's shape changes both. This file is what
// notices when only one of them changed.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  CONTRACT,
  COMMON_ERRORS,
  RATE_KEYS,
  SCRIPT_KEYS,
  assertMatchesContract,
  assertRequestMatchesContract,
  missingKeys,
  exampleResponse,
  describeShape
} from "./api-contract.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "../..");
const SPECS = path.join(REPO, "docs/specs");
const DOC = fs.readFileSync(path.join(SPECS, "marketing-machine-api.md"), "utf8");
const KEYS = Object.keys(CONTRACT);

/* Every "#### `ROUTE KEY`" heading in the doc, in order, with the text under it
   up to the next heading. Lines inside code fences are never headings. */
function routeSections(doc) {
  const order = [];
  const text = new Map();
  let key = null;
  let buf = [];
  let inFence = false;
  const close = () => {
    if (key !== null) text.set(key, buf.join("\n"));
  };
  for (const line of doc.split("\n")) {
    if (line.startsWith("```")) inFence = !inFence;
    if (!inFence && /^#{1,4} /.test(line)) {
      close();
      const m = line.match(/^#### `([^`]+)`\s*$/);
      key = m ? m[1] : null;
      buf = [];
      if (key !== null) order.push(key);
      continue;
    }
    if (key !== null) buf.push(line);
  }
  close();
  return { order, text };
}

const { order: DOC_KEYS, text: SECTIONS } = routeSections(DOC);

function firstJsonBlock(section) {
  const m = section.match(/```json\n([\s\S]*?)\n```/);
  return m ? JSON.parse(m[1]) : undefined;
}

function errorRow(e) {
  return `| ${e.status} | \`${e.error}\` | ${e.field ? "`" + e.field + "`" : "none"} | ${e.when}${e.message ? `; message: "${e.message}"` : ""} |`;
}

/* Visit every [key, value] pair in a nested value. */
function eachPair(value, fn) {
  if (Array.isArray(value)) {
    for (const item of value) eachPair(item, fn);
  } else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      fn(k, v);
      eachPair(v, fn);
    }
  }
}

describe("the doc and the module list the same routes", () => {
  test("same route keys, no duplicates", () => {
    assert.ok(KEYS.length >= 46, `expected every spec route, found ${KEYS.length}`);
    assert.equal(new Set(DOC_KEYS).size, DOC_KEYS.length, "a route heading appears twice in the doc");
    assert.deepEqual([...DOC_KEYS].sort(), [...KEYS].sort());
  });

  test("the route index names every route with its owner", () => {
    for (const key of KEYS) {
      assert.ok(DOC.includes(`| \`${key}\` | ${CONTRACT[key].owner} |`), `route index row for ${key}`);
    }
  });

  for (const key of KEYS) {
    test(`${key}: the doc prints the module's owner, shapes, errors and example`, () => {
      const c = CONTRACT[key];
      const section = SECTIONS.get(key);
      assert.ok(section, `no doc section for ${key}`);
      assert.ok(section.includes(`**Owner:** ${c.owner} ·`), "owner");
      const where = c.method === "GET" ? "query" : "JSON body";
      assert.ok(section.includes(`**Request (${where}):** \`${describeShape(c.requestKeys)}\``), "request line");
      assert.ok(section.includes(`**Response:** \`${describeShape(c.responseKeys)}\``), "response line");
      for (const e of c.errors) assert.ok(section.includes(errorRow(e)), `error row: ${errorRow(e)}`);
      assert.deepEqual(firstJsonBlock(section), c.example, "the doc's example is the module's example");
    });
  }
});

describe("every example passes its own contract", () => {
  for (const key of KEYS) {
    test(key, () => {
      const { example } = CONTRACT[key];
      assertMatchesContract(key, example.response);
      assertRequestMatchesContract(key, example.request);
    });
  }
});

describe("assertMatchesContract", () => {
  const good = exampleResponse("GET marketing/settings");

  test("passes a full body and allows extra keys", () => {
    assertMatchesContract("GET marketing/settings", good);
    assertMatchesContract("GET marketing/settings", { ...good, ok: true, extra: 1, settings: { ...good.settings, more: 2 } });
  });

  test("throws and lists every missing key", () => {
    const body = exampleResponse("GET marketing/settings");
    delete body.settings.enabled;
    delete body.settings.quiet_end;
    assert.throws(() => assertMatchesContract("GET marketing/settings", body), (err) => {
      assert.match(err.message, /settings\.enabled/);
      assert.match(err.message, /settings\.quiet_end/);
      return true;
    });
  });

  test("checks every item of a list", () => {
    const body = exampleResponse("GET marketing/batches");
    delete body.batches[1].counts.flagged;
    assert.throws(() => assertMatchesContract("GET marketing/batches", body), /batches\[\]\.counts\.flagged/);
    const notList = { ...exampleResponse("GET marketing/batches"), batches: "nope" };
    assert.throws(() => assertMatchesContract("GET marketing/batches", notList), /batches \(not a list\)/);
  });

  test("a null parent is allowed (null means unknown), a missing one is not", () => {
    assertMatchesContract("GET marketing/batches/next", { ...exampleResponse("GET marketing/batches/next"), saved: null });
    const body = exampleResponse("GET marketing/batches/next");
    delete body.saved;
    assert.throws(() => assertMatchesContract("GET marketing/batches/next", body), /saved/);
  });

  test("a body that is not an object, or an unknown route, throws", () => {
    assert.throws(() => assertMatchesContract("GET marketing/settings", null), /not an object/);
    assert.throws(() => assertMatchesContract("GET marketing/nope", {}), /no route/);
  });

  test("optional keys may be left out; required ones may not", () => {
    assert.deepEqual(missingKeys(["a", "b?", "c.d?"], { a: 1, c: {} }), []);
    assert.deepEqual(missingKeys(["a", "b?"], { b: 1 }), ["a"]);
    assertRequestMatchesContract("POST marketing/ideas", { request_id: "r", raw_points: "an idea" });
    assert.throws(() => assertRequestMatchesContract("POST marketing/ideas", { raw_points: "an idea" }), /request_id/);
  });

  test("a one-of request needs one of its keys", () => {
    assertRequestMatchesContract("POST marketing/meta/load", { request_id: "r", ad_video_id: "v" });
    assertRequestMatchesContract("POST marketing/meta/load", { request_id: "r", all: true });
    assert.throws(() => assertRequestMatchesContract("POST marketing/meta/load", { request_id: "r" }), /one of ad_video_id \/ all/);
  });
});

describe("the global rules hold", () => {
  test("money is whole cents, model bills are dollars, rates are 0..1, ad numbers are digit strings", () => {
    for (const key of KEYS) {
      const { request, response } = CONTRACT[key].example;
      for (const body of [request, response]) {
        eachPair(body, (k, v) => {
          if (k.endsWith("_cents")) assert.ok(v === null || Number.isInteger(v), `${key}: ${k} = ${v} must be whole cents or null`);
          if (k.endsWith("_usd")) assert.ok(v === null || Number.isFinite(v), `${key}: ${k} = ${v} must be dollars or null`);
          if (RATE_KEYS.includes(k)) assert.ok(v === null || (typeof v === "number" && v >= 0 && v <= 1), `${key}: ${k} = ${v} must be 0..1 or null`);
          if (k === "roas") assert.ok(v === null || (typeof v === "number" && v >= 0), `${key}: roas = ${v}`);
          if (k === "ad_number") assert.ok(v === null || /^\d+$/.test(v), `${key}: ad_number = ${v} must be a string of digits`);
        });
      }
      // In answers, ad_id is always the ad number. (resume_ad's REQUEST ad_id is our ads.id.)
      eachPair(response, (k, v) => {
        if (k === "ad_id") assert.ok(v === null || /^\d+$/.test(v), `${key}: ad_id = ${v} must be a string of digits`);
      });
    }
  });

  test("every write carries request_id; every guard is a request key; 202 answers say queued", () => {
    for (const key of KEYS) {
      const c = CONTRACT[key];
      if (c.method === "POST") assert.ok(c.requestKeys.includes("request_id"), `${key} has no request_id`);
      if (c.guard === "version") assert.ok(c.requestKeys.includes("version"), `${key}: version guard`);
      if (c.guard === "updated_at") {
        assert.ok(c.requestKeys.some((k) => /(^|\.)updated_at\??$/.test(k)), `${key}: updated_at guard`);
      }
      if (c.success === 202) assert.ok(c.responseKeys.includes("queued"), `${key}: 202 without queued`);
      if (c.method === "GET") assert.equal(c.guard, null, `${key}: a read has no guard`);
    }
  });

  test("error rows follow the shapes: 400 invalid names a field, 409 is stale, 404 is not_found", () => {
    for (const key of KEYS) {
      for (const e of CONTRACT[key].errors) {
        if (e.error === "invalid") assert.ok(e.field, `${key}: 400 invalid without a field`);
        if (e.status === 409) assert.equal(e.error, "stale", `${key}: 409 must be stale`);
        if (e.status === 404) assert.equal(e.error, "not_found", `${key}: 404 must be not_found`);
        assert.ok(e.when && e.when.length > 5, `${key}: every error says when`);
      }
    }
  });

  test("every route gates on ROLE_SETS.MARKETING and names an owner", () => {
    for (const key of KEYS) {
      const c = CONTRACT[key];
      assert.match(c.gate, /ROLE_SETS\.MARKETING/, key);
      // U = the plan's units; X = the extras units (ops/workflows/marketing-machine-2026-10-extras.json).
      assert.match(c.owner, /^(U\d\d|X\d+|deferred)$/, key);
      assert.equal(key, c.path === "campaigns/write" ? `${c.method} ${c.path}#resume_ad` : `${c.method} ${c.path}`);
      if (c.path !== "campaigns/write") assert.match(c.path, /^marketing\//, key);
    }
  });

  test("a request_id reused by another org or route is a 400 on request_id", () => {
    assert.ok(COMMON_ERRORS.some((e) => e.status === 400 && e.error === "invalid" && e.field === "request_id"));
    assert.ok(
      DOC.includes("a request_id already used by another org or another route returns 400 {error:'invalid', field:'request_id'}"),
      "the global rule is in the doc word for word"
    );
  });
});

describe("the fixed shapes the brief names are in the contract", () => {
  test("write_now_ready, source, held_reason and the resume_ad refusal", () => {
    assert.ok(CONTRACT["GET marketing/batches"].responseKeys.includes("write_now_ready"));
    assert.ok(CONTRACT["POST marketing/ideas"].requestKeys.includes("source?"));
    assert.ok(CONTRACT["GET marketing/health"].responseKeys.includes("outbox.held_reason"));
    const forbidden = CONTRACT["POST campaigns/write#resume_ad"].errors.find((e) => e.status === 403);
    assert.equal(forbidden && forbidden.message, "Only Chris can turn ads on.");
    assert.ok(CONTRACT["POST marketing/jobs/retry"].errors.some((e) => e.status === 400 && e.field === "job_id"));
    assert.ok(CONTRACT["POST marketing/jobs/retry"].errors.some((e) => e.status === 404));
  });

  test("the Script object is the brief's 34 keys, and the doc prints it as S", () => {
    assert.equal(SCRIPT_KEYS.length, 34);
    assert.equal(describeShape(CONTRACT["GET marketing/scripts"].responseKeys), "{scripts:[S], as_of}");
    assert.equal(describeShape(CONTRACT["POST marketing/scripts/approve"].responseKeys), "{script:S, ad_number, registry, registry_note}");
  });

  test("GET marketing/today keeps every key of the existing today contract", () => {
    const today = fs.readFileSync(path.join(SPECS, "marketing-today-contract.md"), "utf8");
    const block = today.match(/```jsonc\n([\s\S]*?)\n```/);
    assert.ok(block, "the today contract's body block");
    const existing = [...block[1].matchAll(/^ {2}"(\w+)":/gm)].map((m) => m[1]);
    assert.ok(existing.length >= 10, `found ${existing.length} existing today keys`);
    for (const k of existing) assert.ok(CONTRACT["GET marketing/today"].responseKeys.includes(k), `today key ${k}`);
  });

  test("the today and offer contracts are linked and still exist", () => {
    for (const name of ["marketing-today-contract.md", "marketing-offer-contract.md"]) {
      assert.ok(DOC.includes(`](${name})`), `link to ${name}`);
      assert.ok(fs.existsSync(path.join(SPECS, name)), `${name} exists`);
    }
  });
});

describe("the contract cannot be changed by accident", () => {
  test("CONTRACT is frozen all the way down; exampleResponse hands out a copy", () => {
    const entry = CONTRACT["GET marketing/settings"];
    assert.ok(Object.isFrozen(CONTRACT) && Object.isFrozen(entry) && Object.isFrozen(entry.example.response.settings));
    const copy = exampleResponse("GET marketing/settings");
    copy.settings.enabled = true;
    assert.equal(entry.example.response.settings.enabled, false);
  });
});
