import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const PUBLIC_MAP = JSON.parse(fs.readFileSync(
  path.join(ROOT, "ops/workflows/coverage-every-surface-2026-10-10/public-pages.json"),
  "utf8",
));
const TEST_FILE = "src/pulse/catalog/proofs/display-batch-public-ui.test.mjs";
const UNREACHABLE_SOURCE_PAGES = new Set(["public/partner/autopsy/index.html"]);

function frozenAction(row, extra = {}) {
  return Object.freeze({
    sourceFile: "public-pages.json",
    surface: row.surface,
    control: row.control,
    page: row.page,
    ...extra,
  });
}

function rowFor(surface) {
  const matches = PUBLIC_MAP.filter((row) => row.surface === surface);
  if (matches.length !== 1) {
    throw new Error(`Expected one public display row for ${surface}, found ${matches.length}`);
  }
  return matches[0];
}

export const PUBLIC_LINK_ACTIONS = Object.freeze(PUBLIC_MAP
  .filter((row) => row.kind === "link"
    && row.impact === "none"
    && row.page
    && !row.repeats_row_in
    && !UNREACHABLE_SOURCE_PAGES.has(row.page))
  .map((row) => frozenAction(row, {
    action: "link",
    href: row.surface.slice(row.surface.indexOf(" -> ") + 4),
  })));

const RERUN_ACTIONS = [
  ["button:index.html#rerun", " underwrite --diagnostic"],
  ["button:education/index.html#rerun", " request --credit-mastery"],
  ["button:affiliates/index.html#rerun", " partner --apply"],
].map(([surface, expectedCommand]) => frozenAction(rowFor(surface), {
  action: "rerun",
  expectedCommand,
}));

const BOARD_ACTIONS = [
  ["button:partner/board/live/index.html#This week's movers", "movers", "Nothing ranked in this week"],
  ["button:partner/board/live/index.html#Death watch", "death-watch", "Nothing has dropped out yet"],
  ["button:partner/board/live/index.html#Saturation map", "saturation", "Treat it as a hypothesis"],
  ["button:partner/board/live/index.html#New entrants", "new-entrants", "No new advertisers this week"],
].map(([surface, view, expectedResult]) => frozenAction(rowFor(surface), {
  action: "board-tab",
  view,
  expectedResult,
}));

export const PUBLIC_BUTTON_ACTIONS = Object.freeze([...RERUN_ACTIONS, ...BOARD_ACTIONS]);

export const PUBLIC_UI_PROOF_CASES = Object.freeze([
  ...PUBLIC_LINK_ACTIONS,
  ...PUBLIC_BUTTON_ACTIONS,
].map((entry) => Object.freeze({
  sourceFile: entry.sourceFile,
  surface: entry.surface,
  control: entry.control,
  depth: "e2e",
  evidence: TEST_FILE,
  tests: Object.freeze([TEST_FILE]),
})));
