// The parrot check must catch a copied line and must leave fresh lines and
// Chris's owner-set phrases alone (scripts/copy/recycled-lines.mjs).
import { test } from "node:test";
import assert from "node:assert";
import { findRecycled, deckSegments, words } from "./recycled-lines.mjs";

const corpus = [{ name: "marketing/ads/scripts/sample.md", text: "The banks see the inquiries stack, and they start denying you. Then it gets worse." }];
const seg = (text) => [{ where: "PU-01 talk", text }];

test("a line copied from an ad script is flagged, with its source", () => {
  const f = findRecycled({ targets: [{ name: "deck.html", segments: seg("Here's the thing: the banks see the inquiries stack, and they start denying you.") }], corpus });
  assert.equal(f.length, 1);
  assert.equal(f[0].source, "marketing/ads/scripts/sample.md");
});

test("a fresh line passes", () => {
  const f = findRecycled({ targets: [{ name: "deck.html", segments: seg("Every pull you send on your own sits on your report where the next bank reads it.") }], corpus });
  assert.equal(f.length, 0);
});

test("the guarantee line and owner phrases may repeat", () => {
  const owner = "Applications go out within 72 business hours. That's our guarantee, and it's in your contract. You see how much you qualify for based on where you're at right now.";
  const f = findRecycled({
    targets: [{ name: "a.html", segments: seg(owner) }, { name: "b.html", segments: seg(owner) }],
    corpus: [{ name: "marketing/vsl/x.md", text: owner }],
  });
  assert.equal(f.length, 0);
});

test("the same line in two decks is flagged in both", () => {
  const line = "We pull your file together right on the call with a soft pull so your score stays put.";
  const f = findRecycled({ targets: [{ name: "a.html", segments: seg(line) }, { name: "b.html", segments: seg(line) }], corpus: [] });
  assert.deepEqual(f.map((x) => x.name).sort(), ["a.html", "b.html"]);
});

test("deck reading takes headline, lines and talk track, and skips the picture", () => {
  const html = `<section class="slide" data-src="x"><p class="eyebrow">PU-01 / Hook</p><h2>One headline here.</h2>
    <ul class="lines"><li>A line.</li></ul><figure class="pic"><div class="real">RATIO OF BALANCE TO LIMIT TOO HIGH</div></figure>
    <aside class="talk"><ul><li>Spoken words.</li></ul></aside></section>`;
  const s = deckSegments(html);
  assert.deepEqual(s.map((x) => x.where), ["PU-01 headline", "PU-01 line", "PU-01 talk"]);
  assert.ok(!s.some((x) => /RATIO/.test(x.text)));
  assert.deepEqual(words("$100,000 you're"), ["$100000", "youre"]);
});
