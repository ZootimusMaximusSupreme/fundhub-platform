import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const TEST_FILE = "src/pulse/catalog/proofs/display-contracts-teams-social-1.test.mjs";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const MAP_DIR = path.join(ROOT, "ops/workflows/coverage-every-surface-2026-10-10");

function mapped(surface, control, recipe) {
  const rows = JSON.parse(fs.readFileSync(path.join(MAP_DIR, "desks-f.json"), "utf8"));
  const matches = rows.filter((row) => row.surface === surface && row.control === control);
  if (matches.length !== 1) throw new Error(`expected one mapped row: ${surface} / ${control}`);
  return Object.freeze({
    ...matches[0],
    sourceFile: "desks-f.json",
    surface,
    control,
    recipe,
    key: `desks-f.json\0${surface}\0${control}`,
    depth: ["money", "customerData", "customerMessage"].includes(matches[0].impact) ? "deep" : "e2e",
    evidence: TEST_FILE,
    tests: Object.freeze([TEST_FILE]),
  });
}

export const DISPLAY_CONTRACTS_TEAMS_SOCIAL_1_PROOF_CASES = Object.freeze([
  mapped("staff-teams.html", "Page open: roster (name, email, role, status, consent, open shift, today's monitor events, hidden-seed count)", "staff-roster-and-hidden-count"),
  mapped("staff-teams.html", "Page open: who am I (marks the 'you' row, owner-only consent buttons)", "staff-session-owner-row"),
  mapped("staff-teams.html", "Page open: my open shift (so 'Clock in / Clock out' shows the true state)", "staff-open-shift"),
  mapped("staff-teams.html", "Stat tiles: HEADCOUNT, ON SHIFT, CONSENT, PENDING and the 'N on shift' chip", "staff-stat-tiles"),
  mapped("staff-teams.html", "'Hidden from this list: N people (owner and seeded test logins)' line", "staff-hidden-count"),
  mapped("staff-teams.html", "Tabs: Roster, Permissions, Clock & consent, Telemetry", "staff-tabs"),
  mapped("staff-teams.html", "Permissions tab (static copy: says no permission list can be shown)", "staff-permissions-copy"),
  mapped("staff-teams.html", "Roster filters: role select and name/code box", "staff-roster-filters"),
  mapped("staff-teams.html", "Roster row click (opens that person in the editor)", "staff-row-editor"),
  mapped("staff-teams.html", "'+ Add person' (opens the empty editor; 'No employee code is issued by this system')", "staff-add-editor"),
  mapped("staff-teams.html", "Editor fields: first name, last name, email, phone, role select, start date", "staff-editor-fields"),
  mapped("staff-teams.html", "Editor switch: 'Monitoring consent on file' (owner only)", "staff-consent-switch"),
  mapped("staff-teams.html", "Editor 'Cancel', close X, click outside", "staff-editor-cancel"),
  mapped("staff-teams.html", "Clock tab 'Record form' / 'Revoke' monitoring consent (owner only, asks first)", "staff-consent-record"),
  mapped("staff-teams.html", "Telemetry tab: person select, Refresh (consent, payable hours, activity average, shifts, monitor events)", "staff-telemetry-refresh"),
  mapped("social-studio.html", "Page open: partner list for the picker", "social-partner-list"),
  mapped("social-studio.html", "Partner picker (select): reloads the page scoped to that partner (?partner_id=)", "social-partner-picker"),
  mapped("social-studio.html", "Page open per partner: connected accounts, saved approval setting, post queue, writing allowance, send history (5 reads)", "social-partner-reads"),
  mapped("social-studio.html", "Five tiles (Connected accounts, Waiting to post, Needs a rewrite, Could not be sent, Sent): switch the explanation strip", "social-stat-tiles"),
  mapped("social-studio.html", "'Write a post' button (top bar): scrolls to the writer", "social-compose-focus"),
  mapped("social-studio.html", "'Write 3 posts for me': asks the writing model for 3 funding posts, screens them, lands them in the waiting list", "social-generate"),
  mapped("social-studio.html", "Writer: account select, topic select (Funding / Credit cards / Credit repair), 'What the post says' box", "social-writer-fields"),
  mapped("social-studio.html", "Writer: picture/video select (disabled: attaching a picture is not built)", "social-media-disabled"),
  mapped("social-studio.html", "'Queue post': screens the words on the server, saves the post as waiting (or blocked / held) with its send time", "social-queue-post"),
  mapped("social-studio.html", "'Send anything due now': publishes every due waiting post for the partner to its connected accounts, in public (asks first)", "social-publish-confirm"),
  mapped("social-studio.html", "'Clear the form'", "social-clear-form"),
  mapped("social-studio.html", "Tab 'Waiting' (draft, queued, scheduled, awaiting approval)", "social-waiting-tab"),
  mapped("social-studio.html", "Tab 'Needs a rewrite' (blocked by the copy check or refused by a person)", "social-rewrite-tab"),
  mapped("social-studio.html", "Tab 'Send history' (one line per attempt, written before the attempt)", "social-history-tab"),
  mapped("social-studio.html", "Filters: account select and topic select, and the 'N shown' count", "social-filters"),
  mapped("social-studio.html", "'Best times to post': account select and the saved posting times (UTC)", "social-best-times"),
]);

export const DISPLAY_CONTRACTS_TEAMS_SOCIAL_1_ROW_KEYS = Object.freeze(
  DISPLAY_CONTRACTS_TEAMS_SOCIAL_1_PROOF_CASES.map((entry) => entry.key),
);

export const DISPLAY_CONTRACTS_TEAMS_SOCIAL_1_METADATA = Object.freeze({
  runner: "rendered Chromium with controlled local HTTP routes",
  sourceFiles: Object.freeze(["desks-f.json", "staff-teams.html", "social-studio.html"]),
  testFile: TEST_FILE,
  provedCount: DISPLAY_CONTRACTS_TEAMS_SOCIAL_1_PROOF_CASES.length,
});
