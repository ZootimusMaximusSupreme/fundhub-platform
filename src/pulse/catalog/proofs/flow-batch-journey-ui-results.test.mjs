import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const ROOT = new URL("../../../../", import.meta.url);

function read(path) {
  return fs.readFileSync(new URL(path, ROOT), "utf8");
}

test("the owner SLO tab shows every saved connection field named by the journey", () => {
  const html = read("public/app/products-commissions.html");
  assert.match(html, /id="sloTab"[^>]*>SLO connections<\/button>/);
  assert.match(html, /if\s*\(role\s*!==\s*["']owner["']\s*&&\s*role\s*!==\s*["']admin["']\)\s*return;[\s\S]{0,200}?sloTab/);

  const render = html.slice(html.indexOf("function renderSlo"), html.indexOf("function loadSlo"));
  assert.match(render, /cf_funnel_id/);
  assert.match(render, /cf_product_id/);
  assert.match(render, /product_name/);
  assert.match(render, /r\.active !== false/);
  assert.match(render, />On</);
  assert.match(render, />Off</);
});

test("the optimize booking result is a direct link and needs no form values", () => {
  const html = read("public/optimize.html");
  const book = /<a\b[^>]*\bid="book"[^>]*>[^<]*<\/a>/.exec(html)?.[0] || "";
  assert.match(book, /href="https:\/\/apply\.fundhub\.ai\/schedule\/phonecall"/);
  assert.doesNotMatch(book, /\brequired\b|onclick=|data-action=/i);
  assert.doesNotMatch(book, /<button\b/i);
});

test("soft-pull approval stays on one page, authorizes first, then shows Pay", () => {
  const html = read("public/app/soft-pull-approve.html");
  assert.match(html, /Authorize first, then pay the total shown below\./);
  const start = html.indexOf('document.getElementById("f").addEventListener("submit"');
  const submit = html.slice(start, start + 6_000);
  assert.ok(submit.indexOf('method: "POST"') >= 0);
  assert.ok(submit.indexOf('method: "POST"') < submit.indexOf('class="btn-pay"'));
  assert.match(submit, /innerHTML\s*=[\s\S]*class="btn-pay"[\s\S]*>Pay /);
  assert.match(submit, /href="'\s*\+\s*esc\(pay\)/);
});

test("the staff client screen shows each saved business and its extra-owner warning", () => {
  const html = read("public/app/client-control-panel.html");
  const paint = html.slice(html.indexOf("function paintBusinesses"), html.indexOf("function paintBusinessCredit"));
  for (const field of ["row.name", "row.state", "row.address", "row.ein", "row.extra_owner_name"]) {
    assert.match(paint, new RegExp(field.replace(".", "\\.")));
  }
  assert.match(paint, /row\.extra_owners_warning/);
  assert.match(paint, /Extra owner/);
});
