// Finish-the-853, batch 01: the "cost sheet and two-tap confirm drawn before every
// paid tap" row of the Marketing Command Center.
//
// A browser spec can only press the taps it knows about, so this guard lists the
// taps. It counts every place a Command Center tab file asks the frame for a sheet
// (a cost sheet or a two-tap confirm) and fails when the count moves: a new paid tap
// with no row in the table below, or a tap taken out. Every row names the browser
// test that presses it twice, a Cancel that must send nothing and then one yes that
// must send one write, and the guard checks that test still exists.
//
// The sheets themselves (cost line, month line, focus, Escape, phone size) are
// judged on the real frame by e2e/marketing-command-center.spec.mjs.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");

const IDEAS = "e2e/fin-b01-paid-taps-ideas.spec.mjs";
const OTHER = "e2e/fin-b01-paid-taps-other-tabs.spec.mjs";

// kind: how the file asks for the sheet. count is how many call sites the file has.
const FILES = {
  "public/app/cc-tab-ideas.js": { paidTap: 8, twoTap: 1 },
  "public/app/marketing-cc-scripts.js": { withCostSheet: 3 },
  "public/app/cc-tab-launch.js": { askConfirm: 2 },
  "public/app/cc-tab-shoot.js": { "ctx.confirm": 1 },
};

// One row per call site, in the order the file has them. extraTest marks a second
// test for a call site that is already in the table (the flywheel step button is one
// call site that runs the avatar, the offer and the other steps).
const SITES = [
  { file: "public/app/cc-tab-ideas.js", site: "paidTap: write one script from an idea", spec: IDEAS, title: "Write one script from this idea" },
  { file: "public/app/cc-tab-ideas.js", site: "paidTap: start the research", spec: IDEAS, title: "Start the research" },
  { file: "public/app/cc-tab-ideas.js", site: "paidTap: short tweak of a research", spec: IDEAS, title: "Run a short tweak of this research" },
  { file: "public/app/cc-tab-ideas.js", site: "paidTap: run a flywheel step (avatar, ad research, offer, copy, strategy)", spec: IDEAS, title: "Build the avatar (a flywheel step)" },
  { file: "public/app/cc-tab-ideas.js", site: "paidTap: the same step, the offer", spec: IDEAS, title: "Write the offer (a flywheel step)", extraTest: true },
  { file: "public/app/cc-tab-ideas.js", site: "paidTap: tweak a step and re-run it", spec: IDEAS, title: "Tweak a step and re-run it" },
  { file: "public/app/cc-tab-ideas.js", site: "paidTap: make a new funnel", spec: IDEAS, title: "Make a new funnel" },
  { file: "public/app/cc-tab-ideas.js", site: "paidTap: write the pages for a funnel", spec: IDEAS, title: "Write the pages for a funnel" },
  { file: "public/app/cc-tab-ideas.js", site: "paidTap: one piece of quick copy", spec: IDEAS, title: "Write one piece of quick copy" },
  { file: "public/app/cc-tab-ideas.js", site: "twoTap: push a funnel live", spec: IDEAS, title: "Push live (the two-tap confirm that names the address)" },
  { file: "public/app/marketing-cc-scripts.js", site: "withCostSheet: rewrite a script from a note", spec: OTHER, title: "Rewrite it (Fix a script from a note)" },
  { file: "public/app/marketing-cc-scripts.js", site: "withCostSheet: write scripts now", spec: OTHER, title: "Write now (a whole batch)" },
  { file: "public/app/marketing-cc-scripts.js", site: "withCostSheet: write one script from a typed idea", spec: OTHER, title: "Write it now (one script from a typed idea)" },
  { file: "public/app/cc-tab-launch.js", site: "askConfirm: turn on one ad", spec: OTHER, title: "Turn on one ad" },
  { file: "public/app/cc-tab-launch.js", site: "askConfirm: load all approved ads", spec: OTHER, title: "Load all approved ads into Meta" },
  { file: "public/app/cc-tab-shoot.js", site: "ctx.confirm: close the shoot", spec: OTHER, title: "Close the shoot" },
];

function count(source, token) {
  const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const calls = source.match(new RegExp(`(?<!function )(?<![\\w.])${escaped}\\(`, "g")) || [];
  return calls.length;
}

test("every sheet-guarded tap in the Command Center tabs is in the table, with the count the files have", () => {
  for (const [file, expected] of Object.entries(FILES)) {
    const source = read(file);
    for (const [token, want] of Object.entries(expected)) {
      // askConfirm and ctx.confirm are also called from inside their own helper; count
      // only the call sites outside a function definition line.
      let got;
      if (token === "ctx.confirm") got = (source.match(/\bctx\.confirm\(\{/g) || []).length;
      else got = count(source, token);
      assert.equal(got, want, `${file} has ${got} ${token} call sites; the table expects ${want}. Add the new tap to SITES with a Cancel and yes test.`);
    }
    const rows = SITES.filter((s) => s.file === file && !s.extraTest);
    const wantRows = Object.values(expected).reduce((a, b) => a + b, 0);
    assert.equal(rows.length, wantRows, `${file}: ${rows.length} rows for ${wantRows} sites`);
  }
});

test("no other Command Center tab asks the frame for a sheet (a new one needs a row above)", () => {
  const html = read("public/app/marketing-command-center.html");
  const scripts = [...html.matchAll(/<script[^>]*\bsrc="([^"?]+)(?:\?[^"]*)?"/g)].map((m) => m[1])
    .filter((src) => !["shell.js", "marketing-command-center.js"].includes(src));
  assert.ok(scripts.length >= 7, "the tab script list shrank");
  for (const src of scripts) {
    const rel = src.startsWith("/") ? `public${src}` : `public/app/${src}`;
    if (FILES[rel]) continue;
    const source = read(rel);
    assert.doesNotMatch(source, /\bctx\.costSheet\b|\bctx\.confirm\b|\.costSheet\(|\.confirm\(/, `${rel} asks for a sheet but is not in the table`);
  }
});

test("every row names a browser test that exists and presses Cancel then yes", () => {
  for (const row of SITES) {
    const spec = read(row.spec);
    assert.ok(spec.includes(`test("${row.title}"`), `${row.spec} has no test "${row.title}"`);
  }
  const ideas = read(IDEAS);
  for (const mode of ["callback", "promise", "both"]) assert.ok(ideas.includes(`"${mode}"`), `the Ideas spec no longer runs the ${mode} sheet answer`);
  assert.match(ideas, /a Cancel sends nothing/);
  assert.match(read(OTHER), /a Cancel sends nothing/);
});

test("the frame's own sheet test, the one that judges the sheets, is still in the frame spec", () => {
  const spec = read("e2e/marketing-command-center.spec.mjs");
  assert.ok(spec.includes("the frame hosts main's FundhubCC tabs: a cc-tab file loaded before the frame shows, reads, and asks through the sheets (390)"));
});
