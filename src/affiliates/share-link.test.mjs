// One affiliate link per live funnel (owner call 2026-10-06). Same code, different page.
import { test } from "node:test";
import assert from "node:assert/strict";
import { offerLinksFor, liveOffers, LIVE_OFFERS_SQL } from "./share-link.mjs";

const FUNNELS = [
  { key: "book_call", name: "Book a call", landing_url: "https://apply.fundhub.ai/watch" },
  { key: "roadmap_147", name: "Roadmap", landing_url: "https://apply.fundhub.ai/roadmap" }
];

test("every live funnel gets its own link with the code as a1 and ref", () => {
  assert.deepEqual(offerLinksFor("AFF-000121", FUNNELS), [
    { key: "book_call", name: "Book a call", url: "https://apply.fundhub.ai/watch?a1=AFF-000121&ref=AFF-000121" },
    { key: "roadmap_147", name: "Roadmap", url: "https://apply.fundhub.ai/roadmap?a1=AFF-000121&ref=AFF-000121" }
  ]);
});

test("a new funnel needs no code change: it is just another row", () => {
  const links = offerLinksFor("AFF-000121", [...FUNNELS,
    { key: "new_offer", name: "New offer", landing_url: "https://apply.fundhub.ai/new-offer/" }]);
  assert.equal(links.length, 3);
  assert.equal(links[2].url, "https://apply.fundhub.ai/new-offer/?a1=AFF-000121&ref=AFF-000121");
});

test("no code, no links — never a link that credits nobody", () => {
  assert.deepEqual(offerLinksFor(null, FUNNELS), []);
  assert.deepEqual(offerLinksFor("   ", FUNNELS), []);
});

test("the code is URL-encoded and a landing URL's own query is kept", () => {
  const [l] = offerLinksFor("A B&C", [{ key: "k", name: "K", landing_url: "https://x.test/p?utm_source=aff" }]);
  const u = new URL(l.url);
  assert.equal(u.searchParams.get("utm_source"), "aff");
  assert.equal(u.searchParams.get("a1"), "A B&C");
  assert.equal(u.searchParams.get("ref"), "A B&C");
});

test("only live, active funnels of this company are read", async () => {
  assert.match(LIVE_OFFERS_SQL, /org_id = \$1/);
  assert.match(LIVE_OFFERS_SQL, /\bactive\b/);
  assert.match(LIVE_OFFERS_SQL, /status = 'live'/);
  const seen = [];
  const rows = await liveOffers({ query: async (sql, args) => { seen.push(args); return { rows: FUNNELS }; } }, "org-1");
  assert.deepEqual(seen, [["org-1"]]);
  assert.equal(rows, FUNNELS);
});
