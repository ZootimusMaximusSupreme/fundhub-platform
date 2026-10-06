// offerFacts — every price comes from the file that owns it, and no price is
// typed into src/marketing/. No database, no network.

import { test } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { offerFacts, OFFER_KEYS, isOfferKey } from "./offer-facts.mjs";
import { SLO_PRICE_CENTS, SLO_LIST_PRICE_CENTS } from "../slo/offer.mjs";
import { OFFERS } from "../config/offers.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));

test("slo_roadmap reads its price from src/slo/offer.mjs", () => {
  const f = offerFacts("slo_roadmap");
  assert.equal(f.key, "slo_roadmap");
  assert.equal(f.price_cents, SLO_PRICE_CENTS);
  assert.equal(f.book_call, false);
  assert.ok(f.label && typeof f.label === "string");
  assert.match(f.source, /src\/slo\/offer\.mjs/);
});

test("funding_dfy matches OFFERS.FUNDING_DFY", () => {
  const f = offerFacts("funding_dfy");
  assert.equal(f.key, "funding_dfy");
  assert.equal(f.label, OFFERS.FUNDING_DFY.name);
  assert.equal(f.price_cents, OFFERS.FUNDING_DFY.priceCents);
  assert.equal(f.book_call, true);
  assert.match(f.source, /OFFERS\.FUNDING_DFY/);
});

test("an unknown key is null, never a guess", () => {
  for (const k of ["nope", "", null, undefined, "toString", "__proto__", "constructor", "SLO_ROADMAP"]) {
    assert.equal(offerFacts(/** @type {any} */ (k)), null, `offerFacts(${String(k)})`);
    assert.equal(isOfferKey(/** @type {any} */ (k)), false);
  }
});

test("the keys are the two the seed uses, and each answers with the same shape", () => {
  assert.deepEqual([...OFFER_KEYS].sort(), ["funding_dfy", "slo_roadmap"]);
  for (const k of OFFER_KEYS) {
    const f = offerFacts(k);
    assert.deepEqual(Object.keys(f).sort(), ["book_call", "key", "label", "price_cents", "source"]);
    assert.ok(f.price_cents === null || Number.isInteger(f.price_cents), `${k}: integer cents or null`);
  }
  const seed = fs.readFileSync(path.resolve(HERE, "../../db/seed/297_marketing_funnels.sql"), "utf8");
  for (const k of OFFER_KEYS) assert.ok(seed.includes(`'${k}'`), `seed 297 names ${k}`);
});

test("no literal roadmap price is typed anywhere in src/marketing/ code", () => {
  // Built from the source constants so this file holds no literal either.
  const prices = [SLO_PRICE_CENTS, SLO_LIST_PRICE_CENTS].map(String);
  const re = new RegExp(`(^|[^0-9])(${prices.join("|")})([^0-9]|$)`);
  const found = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) { walk(full); continue; }
      if (!/\.m?js$/.test(e.name)) continue;
      // Test files may assert parser output (offer-generator.test.mjs checks that
      // "$297.00" parses to its cents). Only code that ships is held to this.
      if (/\.test\.m?js$/.test(e.name)) continue;
      fs.readFileSync(full, "utf8").split("\n").forEach((line, i) => {
        if (re.test(line)) found.push(`${path.relative(HERE, full)}:${i + 1}`);
      });
    }
  };
  walk(HERE);
  assert.deepEqual(found, [], "a price is typed into src/marketing/ — read it from src/slo/offer.mjs or src/config/offers.mjs");
});
