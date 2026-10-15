// Accounts for every batch 12 display row, and holds the three "cannot be attached" reasons to the repo.
//
// Every one of the 40 rows is exactly one of: a live check (fin-b12-display-contracts.mjs), a practice
// test (fin-b12-rows.json and the test file named beside it), or not attachable (fin-b12-not-attachable.mjs).
// The lane then reports it as not proved only when it is not attachable.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { FIN_B12_CONTROLS } from "./fin-b12-display-contracts.mjs";
import { FIN_B12_NOT_ATTACHABLE } from "./fin-b12-not-attachable.mjs";
import ROWS from "./fin-b12-rows.json" with { type: "json" };
import { gapChecks } from "../../coverage/gap-catalog-display.mjs";
import { schemaColumns } from "./fin-b12-sql-kit.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const read = (file) => fs.readFileSync(path.join(ROOT, file), "utf8");
const here = (file) => path.join(path.dirname(fileURLToPath(import.meta.url)), file);

const live = new Set(Object.values(FIN_B12_CONTROLS));
const practice = new Set(Object.values(ROWS).flatMap((groups) => groups.flatMap((group) => group.controls)));
const blocked = new Set(FIN_B12_NOT_ATTACHABLE.map((row) => row.control));

test("the 40 batch 12 rows split into 18 live checks, 19 practice tests and 3 that cannot be attached, with no overlap", () => {
  assert.equal(live.size, 18);
  assert.equal(practice.size, 19);
  assert.equal(blocked.size, 3);
  for (const control of practice) assert.ok(!live.has(control) && !blocked.has(control), control);
  for (const control of live) assert.ok(!blocked.has(control), control);
  assert.equal(live.size + practice.size + blocked.size, 40);
});

test("every practice-test file named in fin-b12-rows.json exists and claims its rows", () => {
  for (const file of Object.keys(ROWS)) {
    assert.ok(fs.existsSync(here(file)), `${file} exists`);
    const source = fs.readFileSync(here(file), "utf8");
    assert.match(source, /proof\.assertAllClaimed\(\)/, `${file} fails if a listed row is never exercised`);
  }
});

test("the lane leaves exactly the three that cannot be attached as not proved, and no other batch 12 row", async () => {
  const rows = await gapChecks({ env: {}, fetchImpl: async () => new Response("", { status: 200 }) });
  const byId = new Map(rows.map((row) => [row.id, row]));
  const all = [...live, ...practice, ...blocked];
  const pick = (control) => rows.filter((row) => row.id.endsWith(`:${control}`));
  for (const control of all) {
    const matches = pick(control);
    if (blocked.has(control)) {
      assert.equal(matches.length, 1, `${control}: one lane row`);
      assert.equal(matches[0].status, "NOT_PROVED", `${control}: stays not proved, and says what is missing`);
    } else {
      assert.ok(matches.every((row) => row.status !== "NOT_PROVED"), `${control}: no longer not proved`);
    }
  }
  assert.ok(byId.size > 0);
});

test("documents status filter: the Generation failed option still has nothing that can fill it", () => {
  const html = read("public/app/documents.html");
  assert.match(html, /<option value="gen-failed">Generation failed<\/option>/, "the option is still offered");
  assert.match(html, /if\(sf==='gen-failed' && d\.gen!=='failed'\) return false;/, "it keeps only rows whose gen is failed");
  const assigned = [...html.matchAll(/\bgen:\s*([^,\n]+),/g)].map((m) => m[1].trim());
  assert.deepEqual(assigned, ['r.generated_at ? "generated" : "queued"'], "the loader is the only place gen is set, and it never says failed");
  const columns = [...(schemaColumns().get("documents") || [])];
  assert.deepEqual(columns.filter((c) => /fail|error/.test(c)), [], "the documents table has no generation failure column");
});

test("galaxy legend: the sky still moves size and brightness on dice", () => {
  const html = read("public/app/galaxy.html");
  assert.match(html, /<i>size = output today<\/i>/);
  assert.match(html, /<i>brightness = working right now<\/i>/);
  const activity = html.slice(html.indexOf("function evActivity("), html.indexOf("/* -- one worker hands something to another -- */"));
  assert.match(activity, /n\.out \+= 1 \+ \(\(Math\.random\(\)\*3\)\|0\);/, "output is bumped by a random 1 to 3");
  assert.match(activity, /n\.state==='idle' && Math\.random\(\)<0\.55\)\{ n\.state='active'; \}/, "an idle worker flips to active at random");
});

test("galaxy rails: a hand-off thread still carries a client name picked at random", () => {
  const html = read("public/app/galaxy.html");
  assert.match(html, /function fillC\(s\)\{[\s\S]*?pick\(CLIENTS\)[\s\S]*?\.replace\('\{C\}', c\)/, "fillC picks any client from the feed");
  assert.match(html, /threads\.push\(\{a:a,b:b, label:fillC\(r\[2\]\)/, "a hand-off thread is labelled through fillC");
  assert.match(html, /ROUTES\.push\(\[ids\[ri\], ids\[\(ri\+1\)%ids\.length\], 'handoff — \{C\}'\]\);/, "the routes are neighbours in the list with the {C} label");
});
