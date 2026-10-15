// Batch 24 (finish the 853), staff doors, two refusals the first pass left open.
//
// Found by breaking each refusal inside the handlers on purpose, one at a time,
// and listing the ones no test noticed:
//   * the welcome video player's link, when the signing key is not set up, is
//     a 503 that says so, not the plain 404 a forged link gets
//   * the dashboard numbers, when a statement is refused for a bad value, are a
//     400 that blames the request, and any other fault is a 500 that does not
//
// The real api/ handlers and a stand-in database. This is a PRACTICE TEST with
// fake data. It is not a live check.

import assert from "node:assert/strict";
import test from "node:test";

import dashboardKpis from "../../../../api/dashboard/kpis.mjs";
import welcomeVideo from "../../../../api/content/welcome-video.mjs";
import { hit, sqlCalls } from "./s5-route-kit.mjs";

const VIDEO_ID = "0d000000-0000-4000-8000-000000000001";

test("content/welcome-video says the signing key is not set up, in plain words and without its name, when a player asks for the bytes with no key to check the link against", async () => {
  const secretName = ["DOCUMENT", "URL", "SECRET"].join("_");
  const keep = process.env[secretName];
  delete process.env[secretName];
  try {
    const query = { id: VIDEO_ID, exp: String(Math.floor(Date.now() / 1000) + 600), sig: "ab".repeat(32) };
    const out = await hit(welcomeVideo, { anonymous: true, query, rules: [] });
    assert.equal(out.status, 503);
    assert.equal(out.body.ok, false);
    assert.equal(out.body.error, "not_configured");
    assert.match(out.body.message, /cannot be opened right now/);
    assert.equal(JSON.stringify(out.body).includes(secretName), false, "the variable's name is never shown");
    assert.equal(sqlCalls(out, /FROM content_videos/).length, 0, "nothing about the video is looked up or told");
  } finally {
    if (keep === undefined) delete process.env[secretName]; else process.env[secretName] = keep;
  }
});

test("dashboard/kpis blames the request, not the server, when a statement is refused for a bad value, and answers a real fault with a plain 500", async () => {
  const fault = (code, text) => [/FROM transactions/, Object.assign(new Error(text), { code })];
  const badValue = await hit(dashboardKpis, { role: "sales_manager", query: { period: "30d" }, rules: [fault("22P02", "invalid input syntax for type uuid")] });
  assert.equal(badValue.status, 400);
  assert.equal(badValue.body.error, "invalid_parameter");
  assert.equal(JSON.stringify(badValue.body).includes("invalid input syntax"), false, "the database's words stay on the server");

  const realFault = await hit(dashboardKpis, { role: "sales_manager", query: { period: "30d" }, rules: [fault("XX000", "internal error")] });
  assert.equal(realFault.status, 500);
  assert.equal(realFault.body.error, "query_failed");
  assert.equal(realFault.body.message, "Something went wrong loading KPIs.");
});
