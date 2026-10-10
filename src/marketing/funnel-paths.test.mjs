// The funnel address system (build unit X4): an address is picked for Chris,
// or the one he types is checked; taken, live and reserved addresses are refused.
// Pure: no database, no network.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  normalizePath, pagePaths, keyFor, tagFor, urlFor, nextFreePath, refuseReason,
  reservedPaths, isReserved, pathsFromPages, pathsFromFunnels, isTag, FUNNEL_OFFERS, isFunnelOffer, FUNNEL_HOST
} from "./funnel-paths.mjs";
import { OFFERS } from "../config/offers.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));

describe("an address from words", () => {
  test("letters and numbers joined by single dashes, always starting with /", () => {
    assert.equal(normalizePath("blueprint"), "/blueprint");
    assert.equal(normalizePath("/Blueprint/"), "/blueprint");
    assert.equal(normalizePath("Capital Blueprint!"), "/capital-blueprint");
    assert.equal(normalizePath("https://apply.fundhub.ai/blueprint-vip"), "/blueprint-vip");
    assert.equal(normalizePath("  --a__b--  "), "/a-b");
    assert.equal(normalizePath("!!!"), null);
    assert.equal(normalizePath(""), null);
    assert.ok(normalizePath("x".repeat(200)).length <= 48);
  });

  test("three pages share one word; key and tag follow it", () => {
    assert.deepEqual(pagePaths("/blueprint"), {
      landing: "/blueprint", booking: "/blueprint-book", thank_you: "/blueprint-thank-you"
    });
    assert.equal(keyFor("/blueprint-2"), "blueprint_2");
    assert.equal(tagFor("blueprint_2"), "fnl-blueprint-2");
    assert.equal(urlFor("/blueprint"), `https://${FUNNEL_HOST}/blueprint`);
    assert.match(tagFor(keyFor("/a-b-c")), /^fnl-[a-z0-9]+(-[a-z0-9]+)*$/);
  });
});

describe("picking a free address", () => {
  test("the first Blueprint funnel is /blueprint", () => {
    assert.deepEqual(nextFreePath("blueprint"), { base: "/blueprint" });
  });

  test("a live ClickFunnels page on any of the three addresses moves it to -2", () => {
    for (const taken of ["/blueprint", "/blueprint-book", "/blueprint-thank-you"]) {
      assert.deepEqual(nextFreePath("blueprint", { taken: new Set([taken]) }), { base: "/blueprint-2" }, taken);
    }
  });

  test("our own funnel key counts as taken too, and the counter keeps going", () => {
    const taken = new Set(["/blueprint", "/blueprint-2-book"]);
    assert.deepEqual(nextFreePath("blueprint", { taken, keys: new Set(["blueprint_3"]) }), { base: "/blueprint-4" });
  });

  test("a reserved word is never used, even when nothing is on it", () => {
    const roadmap = nextFreePath("roadmap");
    assert.ok("error" in roadmap, "every /roadmap address belongs to the roadmap funnel");
    assert.deepEqual(nextFreePath("apply"), { base: "/apply-2" });
  });

  test("gives up in plain words when every number is taken", () => {
    const taken = new Set(["/x", ...Array.from({ length: 60 }, (_, i) => `/x-${i + 2}`)]);
    const out = nextFreePath("x", { taken });
    assert.ok("error" in out);
    assert.match(out.error, /Type a name instead/);
  });
});

describe("refusing a typed address", () => {
  test("every page the live funnels use is reserved", () => {
    const reserved = reservedPaths();
    for (const p of ["/watch", "/apply", "/funding-book-call", "/thank-you", "/order", "/roadmap",
      "/roadmap-book", "/roadmap-thank-you", "/home", "/schedule", "/privacy", "/terms", "/api", "/app",
      "/vsl-page", "/fundhub-297-roadmap-sales"]) {
      assert.ok(isReserved(p, reserved), p);
    }
    assert.ok(isReserved("/roadmap-vip", reserved), "a /roadmap- address belongs to the roadmap funnel");
    assert.equal(isReserved("/blueprint", reserved), false);
  });

  test("taken, reserved, malformed and too long each say why", () => {
    assert.equal(refuseReason("/blueprint"), null);
    assert.match(refuseReason("/blueprint", { taken: new Set(["/blueprint-book"]) }), /\/blueprint-book is already a page/);
    assert.match(refuseReason("/watch"), /already uses/);
    assert.match(refuseReason("/Bad Path"), /lower-case/);
    assert.match(refuseReason(`/${"a".repeat(60)}`), /too long/);
    assert.match(refuseReason("/blueprint", { keys: new Set(["blueprint"]) }), /already exists/);
  });
});

describe("addresses ClickFunnels already serves", () => {
  test("current_path, the step's path and the url's path all count", () => {
    const got = pathsFromPages([
      { current_path: "/Blueprint/" },
      { current_path: "/fundhub-297-roadmap-book--5df25", show_page_step: { current_path: "/roadmap-book" } },
      { url: "https://apply.fundhub.ai/some-page?x=1" },
      { current_path: null, url: null },
      null
    ]);
    assert.deepEqual([...got].sort(), ["/blueprint", "/fundhub-297-roadmap-book--5df25", "/roadmap-book", "/some-page"]);
  });
});

describe("the offers a book-a-call funnel can be built for", () => {
  test("the Blueprint is the uwiq lane, as the ad registry says", () => {
    const registry = JSON.parse(fs.readFileSync(path.resolve(HERE, "../../marketing/ads/registry.json"), "utf8"));
    assert.equal(registry.rules.uwiq.primary_offer, "capital_blueprint");
    assert.equal(FUNNEL_OFFERS.capital_blueprint.lane, "uwiq");
    assert.equal(FUNNEL_OFFERS.capital_blueprint.base, "blueprint");
    assert.equal(FUNNEL_OFFERS.capital_blueprint.product, OFFERS.UWIQ_DELIVERABLES);
    assert.equal(FUNNEL_OFFERS.capital_blueprint.product.productCode, "consulting-package");
    assert.equal(registry.rules[FUNNEL_OFFERS.funding_dfy.lane].primary_offer, "funding_dfy");
  });

  test("only offers sold on a call", () => {
    assert.equal(isFunnelOffer("capital_blueprint"), true);
    assert.equal(isFunnelOffer("funding_dfy"), true);
    assert.equal(isFunnelOffer("slo_roadmap"), false);
    assert.equal(isFunnelOffer("toString"), false);
  });
});

describe("X4F: the ClickFunnels funnel's own address, funnel paths and tags", () => {
  test("/fnl-... is the ClickFunnels funnel's own address, so no page may take it", () => {
    assert.equal(isReserved("/fnl-blueprint"), true);
    assert.equal(isReserved("/fnl"), true);
    assert.match(refuseReason("/fnl-blueprint"), /already uses/);
    assert.equal(isReserved("/fnlx"), false);
    assert.equal(nextFreePath("fnl").base, undefined, "a reserved word stays reserved");
  });

  test("a ClickFunnels funnel's own path is taken too (apply.fundhub.ai/vsl sends people on to /watch)", () => {
    const got = pathsFromFunnels([{ current_path: "/vsl" }, { current_path: "/Fundhub-297-Roadmap/" }, { current_path: null }, null]);
    assert.deepEqual([...got].sort(), ["/fundhub-297-roadmap", "/vsl"]);
  });

  test("a tag is fnl- and words joined by single dashes; the rule makes one for the two hand-mapped keys", () => {
    assert.equal(isTag(tagFor("book_call")), true);
    assert.equal(tagFor("book_call"), "fnl-book-call");
    assert.equal(tagFor("roadmap_147"), "fnl-roadmap-147");
    assert.equal(isTag(tagFor("a__b")), false, "a double dash is refused, as 425 refuses it");
    assert.equal(isTag(tagFor("x_")), false);
    assert.equal(isTag("fnl-" + "a".repeat(61)), false, "64 at most");
  });
});
