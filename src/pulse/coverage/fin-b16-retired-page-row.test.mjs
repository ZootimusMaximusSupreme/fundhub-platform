// Finish-853 batch 16: the Decline Autopsy page row ("page:partner/autopsy/index.html") names its file under
// `file`, not `page`, so the catalog compiler used to miss that it is the retired page and left the row
// "not proved". It is the same retired page as its three form and link rows: the live lane GETs the old
// address and the menu it redirects to, and the row is nothing-to-judge only while that redirect is live.

import assert from "node:assert/strict";
import test from "node:test";

import { compileDisplayRuntimeData } from "../catalog/compiler.mjs";
import { DISPLAY_TRACKING_CASES, gapChecks, naVerify } from "./gap-catalog-display.mjs";

const PAGE_ROW = DISPLAY_TRACKING_CASES.find((e) => e.sourceFile === "public-pages.json"
  && e.surface === "page:partner/autopsy/index.html");

function redirect({ status = 302, location = "/partner/menu/", menuStatus = 200 } = {}) {
  return async (url) => String(url).endsWith("/partner/autopsy/")
    ? new Response(null, { status, headers: location ? { location } : {} })
    : new Response('<h1>Four Ways In. You Can Start Anywhere.</h1><a href="/partner/">See the Partnership</a>', { status: menuStatus });
}

test("the page row and its three form and link rows are all marked retired in the compiled catalog", () => {
  assert.ok(PAGE_ROW, "the page row is tracked");
  assert.equal(PAGE_ROW.retired, true);
  const autopsy = DISPLAY_TRACKING_CASES.filter((e) => e.sourceFile === "public-pages.json" && /partner\/autopsy\/index\.html/.test(e.surface));
  assert.equal(autopsy.length, 4);
  assert.ok(autopsy.every((e) => e.retired === true), "every row of that page is retired together");
});

test("the compiler reads the retired page from `file` as well as `page`", () => {
  const rows = [{ surface: "page:x", control: "c", kind: "page", file: "public/partner/autopsy/index.html" }];
  const out = compileDisplayRuntimeData([{ sourceFile: "public-pages.json", rows }], {
    proofCases: [], staffProofCases: [], contractFor: () => null, isTracked: () => true,
  });
  assert.equal(out.displayTrackingCases.length, 1);
  assert.equal(out.displayTrackingCases[0].retired, true);
  const other = compileDisplayRuntimeData([{ sourceFile: "public-pages.json", rows: [{ ...rows[0], file: "public/partner/menu/index.html" }] }], {
    proofCases: [], staffProofCases: [], contractFor: () => null, isTracked: () => true,
  });
  assert.equal(other.displayTrackingCases[0].retired, false, "only the autopsy page is retired");
});

test("the row is nothing-to-judge only while the live redirect and the menu are there, and red otherwise", async () => {
  const live = (await gapChecks({ fetchImpl: redirect() })).find((r) => r.id === PAGE_ROW.id);
  assert.equal(live.status, "na");
  assert.equal(live.na.code, "catalog-display-retired-autopsy");
  assert.equal(await naVerify["catalog-display-retired-autopsy"](
    { sourceFile: PAGE_ROW.sourceFile, surface: PAGE_ROW.surface, control: PAGE_ROW.control }, { fetchImpl: redirect() }), true);

  for (const broken of [{ status: 200 }, { location: "/app/login.html" }, { menuStatus: 404 }]) {
    const row = (await gapChecks({ fetchImpl: redirect(broken) })).find((r) => r.id === PAGE_ROW.id);
    assert.equal(row.status, "FAIL", JSON.stringify(broken));
    assert.equal(await naVerify["catalog-display-retired-autopsy"](
      { sourceFile: PAGE_ROW.sourceFile, surface: PAGE_ROW.surface, control: PAGE_ROW.control }, { fetchImpl: redirect(broken) }), false);
  }
});
