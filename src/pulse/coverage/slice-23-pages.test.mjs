import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { coverageKey, PULSE_REGISTRY } from "../registry.mjs";
import {
  CHECKS,
  SHELL_ALL,
  SHELL_STAFF_MONEY,
  SIDEBAR_SECTION_DESKS,
  SLICE_ID,
  buildChecks,
  gaps,
  isRoutedDesk,
  scopedRoutedDesks
} from "./slice-23-pages.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP_DIR = path.resolve(HERE, "../../../public/app");

// The slice may not read shell.js at run time, so it carries a copy. These helpers
// (the same reading the slice used to do) let the test prove the copy is still true.
function shellList(src, name) {
  const m = src.match(new RegExp(`var\\s+${name}\\s*=\\s*\\[([\\s\\S]*?)\\];`));
  if (!m) return [];
  return (m[1].match(/"[^"]*\.html"/g) || []).map((s) => JSON.parse(s));
}

function sidebarSectionDesks(src, sectionId) {
  const marker = `data-fh-section=\\"${sectionId}\\"`;
  const start = src.indexOf(marker);
  if (start === -1) return [];
  const chunk = src.slice(start, start + 6000);
  const end = chunk.indexOf("</div></div>");
  const part = end === -1 ? chunk : chunk.slice(0, end);
  return [...part.matchAll(/href=\\"([^\\"]+\.html)\\"/g)].map((match) => match[1]);
}

/** Every difference between the copy in the slice and what shell.js says. Empty = no drift. */
function shellDrift(src) {
  const out = [];
  const same = (a, b) => JSON.stringify([...a]) === JSON.stringify([...b]);
  if (!same(shellList(src, "ALL"), SHELL_ALL)) out.push("ALL");
  if (!same(shellList(src, "STAFF_MONEY"), SHELL_STAFF_MONEY)) out.push("STAFF_MONEY");
  for (const [section, desks] of Object.entries(SIDEBAR_SECTION_DESKS)) {
    if (!same(sidebarSectionDesks(src, section), desks)) out.push(`section:${section}`);
  }
  return out;
}

test("slice 23-pages: every check has id, schedule, redAfter, alreadyInRegistry, proof", () => {
  assert.equal(SLICE_ID, "23-pages");
  for (const row of CHECKS) {
    assert.equal(typeof row.id, "string");
    assert.ok(row.id.length > 0);
    assert.equal(typeof row.schedule, "string");
    assert.equal(typeof row.redAfter, "string");
    assert.match(row.redAfter, /^3x \S+$/);
    assert.equal(row.redAfter, `3x ${row.schedule}`);
    assert.equal(row.alreadyInRegistry, false);
    assert.equal(typeof row.proof, "string");
    assert.ok(row.proof.length > 0);
    assert.doesNotMatch(row.proof, /^PASS/);
  }
});

test("slice 23-pages: scoped desks are routed, on disk, and in the pulse registry", () => {
  const scoped = scopedRoutedDesks();
  assert.ok(scoped.includes("pipeline.html"));
  assert.ok(scoped.includes("client-portal.html"));
  assert.ok(scoped.includes("contracts.html"));
  assert.ok(scoped.includes("hiring.html"));
  assert.ok(scoped.includes("financeos.html"));
  assert.ok(scoped.includes("lenders.html"));

  for (const file of scoped) {
    assert.ok(fs.existsSync(path.join(APP_DIR, file)), `${file} missing on disk`);
    assert.ok(isRoutedDesk(file), `${file} is not shell-routed`);
  }

  const listed = new Set(PULSE_REGISTRY.filter((row) => row.kind === "desk").map(coverageKey));
  for (const file of scoped) {
    assert.ok(listed.has(file), `${file} should be in PULSE_REGISTRY or CHECKS`);
  }

  assert.deepEqual(CHECKS, []);
  assert.deepEqual(gaps(), []);
});

test("slice 23-pages: buildChecks surfaces a desk dropped from the registry", () => {
  const listed = new Set(PULSE_REGISTRY.map((row) => coverageKey(row)));
  listed.delete("pipeline.html");
  const missing = buildChecks(listed);
  assert.equal(missing.length, 1);
  assert.equal(missing[0].id, "pipeline");
  assert.equal(missing[0].file, "pipeline.html");
  assert.equal(missing[0].alreadyInRegistry, false);
  assert.match(missing[0].proof, /DESK_FILES/);
  assert.match(missing[0].proof, /Do not auto-fix/);
});

test("slice 23-pages: the desk lists it carries equal public/app/shell.js, and every desk is on disk", () => {
  const src = fs.readFileSync(path.join(APP_DIR, "shell.js"), "utf8");
  assert.deepEqual(shellDrift(src), []);
  const onDisk = new Set(fs.readdirSync(APP_DIR).filter((name) => name.endsWith(".html")));
  const carried = [
    ...SHELL_ALL,
    ...SHELL_STAFF_MONEY,
    ...Object.values(SIDEBAR_SECTION_DESKS).flat()
  ];
  for (const file of carried) assert.ok(onDisk.has(file), `${file} is in the slice but not in public/app`);
});

test("slice 23-pages: the drift test goes red when shell.js adds a desk or drops one", () => {
  const src = fs.readFileSync(path.join(APP_DIR, "shell.js"), "utf8");
  const added = src.replace(/(var\s+ALL\s*=\s*\[)/, '$1"brand-new-desk.html", ');
  assert.deepEqual(shellDrift(added), ["ALL"]);
  const dropped = src.replace('"money-vault.html"', "");
  assert.deepEqual(shellDrift(dropped), ["STAFF_MONEY"]);
});

test("slice 23-pages: a desk that is not in the shell lists is not routed", () => {
  assert.equal(isRoutedDesk("pipeline.html"), true);
  assert.equal(isRoutedDesk("money-vault.html"), true);
  assert.equal(isRoutedDesk("orphan-page-on-disk.html"), false);
});

test("slice 23-pages: reads no repo file at run time", () => {
  const code = fs.readFileSync(path.join(HERE, "slice-23-pages.mjs"), "utf8");
  assert.doesNotMatch(code, /node:fs|readFileSync|readdirSync|existsSync/);
});
