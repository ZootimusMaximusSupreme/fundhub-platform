import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { judgeLeadsHtml } from "../pulse/coverage/fin-b07-leads-page.mjs";
import { judgeLeadsResetHtml } from "../pulse/coverage/fin-b09-leads-reset.mjs";

const PAGE = new URL("../../public/leads/c01cb7592c8bb994130158e897e99bf1/index.html", import.meta.url);

test("the private lead list is noindex, browser-only, and has the exact five columns", async () => {
  const html = await readFile(PAGE, "utf8");
  const result = judgeLeadsHtml(html);
  assert.equal(result.ok, true, result.broke.join("; "));
});

test("Reset my edits asks first, clears the saved list, persists, and redraws", async () => {
  const html = await readFile(PAGE, "utf8");
  const result = judgeLeadsResetHtml(html);
  assert.equal(result.ok, true, result.broke.join("; "));
});
