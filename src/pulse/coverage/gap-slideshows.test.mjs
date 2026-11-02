import { test } from "node:test";
import assert from "node:assert/strict";
import { gapChecks, SLIDESHOW_PAGES } from "./gap-slideshows.mjs";

const page = '<title>Fundhub Deck</title><main class="ss" data-deck="test">' +
  '<section class="slide"><h2>Point</h2></section>'.repeat(5) + '</main>';

function reader(broken = {}) {
  return async (url, init) => {
    assert.equal(init.method, "GET");
    const name = new URL(url).pathname;
    const body = Object.hasOwn(broken, name) ? broken[name] : page;
    return { status: body == null ? 404 : 200, text: async () => body ?? "", headers: new Headers({ "content-type": "text/html" }) };
  };
}

test("all 22 phone decks pass a read-only content check", async () => {
  assert.equal(SLIDESHOW_PAGES.length, 22);
  assert.deepEqual((await gapChecks({ fetchImpl: reader() })).map((row) => row.status), ["PASS"]);
});

test("a missing or blank phone deck makes the shared check red", async () => {
  const missing = `/${SLIDESHOW_PAGES[0]}`;
  const blank = `/${SLIDESHOW_PAGES[1]}`;
  const [missingRow] = await gapChecks({ fetchImpl: reader({ [missing]: null }) });
  assert.equal(missingRow.status, "FAIL");
  assert.match(missingRow.detail, new RegExp(SLIDESHOW_PAGES[0]));
  const [blankRow] = await gapChecks({ fetchImpl: reader({ [blank]: "<title>Fundhub Deck</title>" }) });
  assert.equal(blankRow.status, "FAIL");
  assert.match(blankRow.detail, /lost its deck title, body, or slides/);
});
