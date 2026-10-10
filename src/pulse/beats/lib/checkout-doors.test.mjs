import { test } from "node:test";
import assert from "node:assert/strict";

import {
  SELF_SERVE_SLUGS, funnelPrices, isWebAddress, judgeCheckoutLink, judgeFunnelCatalogue, judgeRepairDoor, parseJson, plain
} from "./checkout-doors.mjs";

const cat = (over = {}) => ({
  ok: true,
  checkout: { ready: true },
  items: [
    { slug: "autopsy", selfServe: true, priceCents: 2700, available: true },
    { slug: "board", selfServe: true, priceCents: 4700, available: true },
    { slug: "trial", selfServe: true, priceCents: 9700, available: true },
    { slug: "partner", selfServe: false, priceCents: 1000000, available: false }
  ],
  ...over
});
const judge = (body, status = 200) => judgeFunnelCatalogue({ status, body: typeof body === "string" ? body : JSON.stringify(body) });

test("checkout-doors: the three self-serve items are autopsy, board and trial", () => {
  assert.deepEqual([...SELF_SERVE_SLUGS], ["autopsy", "board", "trial"]);
});

test("checkout-doors: a sound catalogue has no problem, and the partner item is allowed to be off", () => {
  assert.deepEqual(judge(cat()), []);
});

test("checkout-doors: each break is its own plain sentence", () => {
  assert.match(judge(cat({ ok: false }))[0], /says not ok/);
  assert.match(judge(cat({ checkout: { ready: false } }))[0], /checkout is not ready/);
  assert.match(judge(cat({ checkout: undefined }))[0], /checkout is not ready/);
  assert.match(judge(cat({ items: [] }))[0], /lists no items/);
  const noPrice = cat();
  noPrice.items[1].priceCents = 0;
  assert.match(judge(noPrice)[0], /board has no price/);
  const fractional = cat();
  fractional.items[0].priceCents = 27.5;
  assert.match(judge(fractional)[0], /autopsy has no price/);
  const off = cat();
  off.items[2].available = false;
  assert.match(judge(off)[0], /trial is priced but not available/);
  assert.match(judge("not json")[0], /did not answer JSON/);
  assert.match(judge("[]")[0], /did not answer JSON/);
  assert.match(judge(cat(), 500)[0], /answered 500, not 200/);
  assert.match(judge(cat(), 0)[0], /answered nothing, not 200/);
});

test("checkout-doors: several breaks at once are all named", () => {
  const bad = cat({ checkout: { ready: false } });
  bad.items[0].priceCents = null;
  bad.items[2].available = false;
  assert.equal(judge(bad).length, 3);
});

test("checkout-doors: funnelPrices reads whole-cent prices only", () => {
  assert.deepEqual(funnelPrices(JSON.stringify(cat())), { autopsy: 2700, board: 4700, trial: 9700, partner: 1000000 });
  assert.deepEqual(funnelPrices("nope"), {});
  assert.deepEqual(funnelPrices(JSON.stringify({ items: [{ slug: "x", priceCents: -1 }, { slug: "y", priceCents: "5" }] })), {});
});

test("checkout-doors: the repair door must answer a GET with its own 405", () => {
  const own = JSON.stringify({ ok: false, error: "method_not_allowed" });
  assert.equal(judgeRepairDoor({ status: 405, body: own, allow: "POST, OPTIONS" }), null);
  assert.equal(judgeRepairDoor({ status: 405, body: own }), null);
  assert.match(judgeRepairDoor({ status: 404, body: "" }), /fell out of the ROUTES map/);
  assert.match(judgeRepairDoor({ status: 500, body: "" }), /answered 500/);
  assert.match(judgeRepairDoor({ status: 200, body: "" }), /wanted 405/);
  assert.match(judgeRepairDoor({ status: 0, body: "" }), /no answer/);
  assert.match(judgeRepairDoor({ status: 405, body: "<html>edge</html>" }), /not with its own answer/);
  assert.match(judgeRepairDoor({ status: 405, body: own, allow: "GET, HEAD" }), /no longer lists POST/);
});

test("checkout-doors: a checkout link is alive, dead or unclear, and a bot wall is never dead", () => {
  for (const s of [200, 204, 301, 302, 308]) assert.equal(judgeCheckoutLink(s), "alive", String(s));
  for (const s of [404, 410, 500, 502, 503]) assert.equal(judgeCheckoutLink(s), "dead", String(s));
  for (const s of [0, 401, 403, 405, 429, null, undefined, NaN]) assert.equal(judgeCheckoutLink(s), "unclear", String(s));
});

test("checkout-doors: only an http or https address with a dotted host is a web address", () => {
  assert.equal(isWebAddress("https://pay.example.test/c/abc"), true);
  assert.equal(isWebAddress("http://pay.example.test"), true);
  for (const bad of ["javascript:alert(1)", "ftp://x.example.test", "not a link", "", null, "https://localhost/x", "data:text/html,x"]) {
    assert.equal(isWebAddress(bad), false, String(bad));
  }
});

test("checkout-doors: plain keeps letters, digits and . _ - only, cut short", () => {
  assert.equal(plain("a b<script>c"), "abscriptc");
  assert.equal(plain(""), "none");
  assert.equal(plain("x".repeat(100), 8), "xxxxxxxx");
  assert.deepEqual(parseJson('{"a":1}'), { a: 1 });
  assert.equal(parseJson("[1]"), null);
});
