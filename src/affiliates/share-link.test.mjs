// One affiliate link per offer (owner call 2026-10-06). Same code, different page.
import { test } from "node:test";
import assert from "node:assert/strict";
import { offerLinksFor, OFFER_PAGES } from "./share-link.mjs";

test("every offer gets its own link with the code as a1 and ref", () => {
  const links = offerLinksFor("AFF-000121");
  assert.deepEqual(links, [
    { key: "funding_dfy", name: "Book a call", url: "https://apply.fundhub.ai/watch?a1=AFF-000121&ref=AFF-000121" },
    { key: "slo_roadmap", name: "Roadmap", url: "https://apply.fundhub.ai/roadmap?a1=AFF-000121&ref=AFF-000121" }
  ]);
  assert.equal(links.length, OFFER_PAGES.length);
});

test("no code, no links — never a link that credits nobody", () => {
  assert.deepEqual(offerLinksFor(null), []);
  assert.deepEqual(offerLinksFor("   "), []);
});

test("the code is URL-encoded", () => {
  assert.ok(offerLinksFor("A B&C")[0].url.endsWith("?a1=A%20B%26C&ref=A%20B%26C"));
});
