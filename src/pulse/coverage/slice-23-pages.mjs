// Live desk pages for the 7:00 a.m. pulse. Report only. Never auto-fix.
// A GET desk is red when its morning ping is missing from PULSE_REGISTRY.
// Scoped to routed employee/client desks: pipeline, funding, portal,
// contracts, hiring, and FinanceOS money tabs.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { coverageKey, PULSE_REGISTRY } from "../registry.mjs";

export const SLICE_ID = "23-pages";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP_DIR = path.resolve(HERE, "../../../public/app");
const SHELL_SRC = fs.readFileSync(path.join(APP_DIR, "shell.js"), "utf8");

const SCHEDULE = "daily";

/** `var NAME = [ "a.html", … ];` lifted from public/app/shell.js. */
function shellList(name) {
  const m = SHELL_SRC.match(new RegExp(`var\\s+${name}\\s*=\\s*\\[([\\s\\S]*?)\\];`));
  if (!m) return [];
  return (m[1].match(/"[^"]*\.html"/g) || []).map((s) => JSON.parse(s));
}

/** Sidebar rows under one `data-fh-section` group (SIDEBAR_HTML escapes quotes). */
function sidebarSectionDesks(sectionId) {
  const marker = `data-fh-section=\\"${sectionId}\\"`;
  const start = SHELL_SRC.indexOf(marker);
  if (start === -1) return [];
  const chunk = SHELL_SRC.slice(start, start + 6000);
  const end = chunk.indexOf("</div></div>");
  const part = end === -1 ? chunk : chunk.slice(0, end);
  return [...part.matchAll(/href=\\"([^\\"]+\.html)\\"/g)].map((match) => match[1]);
}

const ON_DISK = new Set(fs.readdirSync(APP_DIR).filter((name) => name.endsWith(".html")));
const ALL = new Set(shellList("ALL"));
const STAFF_MONEY = shellList("STAFF_MONEY");

/** Shell-guarded desks only — not orphan HTML on disk. */
export function isRoutedDesk(file) {
  return ON_DISK.has(file) && (ALL.has(file) || STAFF_MONEY.includes(file));
}

/** Routed desks in the six pulse page lanes (deduped, sorted). */
export function scopedRoutedDesks() {
  const files = new Set([
    ...sidebarSectionDesks("sales"),
    ...sidebarSectionDesks("funding"),
    ...sidebarSectionDesks("portals"),
    "contracts.html",
    "hiring.html",
    ...STAFF_MONEY
  ]);
  return [...files].filter(isRoutedDesk).sort();
}

function defaultListed() {
  return new Set(PULSE_REGISTRY.map((row) => coverageKey(row)));
}

function deskRow(file, listed) {
  const alreadyInRegistry = listed.has(file);
  const slug = file.replace(/\.html$/, "");
  return {
    id: slug,
    file,
    schedule: SCHEDULE,
    redAfter: `3x ${SCHEDULE}`,
    alreadyInRegistry,
    proof: alreadyInRegistry
      ? "PASS"
      : `Add ${file} to DESK_FILES in src/pulse/registry.mjs (same change as the screen). Do not auto-fix from this pulse.`
  };
}

/** Missing routed category desks only — never edits the registry. */
export function buildChecks(listed = defaultListed()) {
  return scopedRoutedDesks()
    .filter((file) => !listed.has(file))
    .map((file) => deskRow(file, listed));
}

export const CHECKS = buildChecks();

/** Same as CHECKS; lets callers pass a custom list in tests. */
export function gaps(checks = CHECKS) {
  return checks;
}
