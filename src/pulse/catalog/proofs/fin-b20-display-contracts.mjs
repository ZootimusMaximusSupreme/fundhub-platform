// Finish-853 batch 20: the staff shell (account chip, search, sidebar, status chip, chat widget, brand,
// role gate), the shared rail file, and the sales-floor panels that no earlier batch owned.
//
// Two kinds of attachment, both honest about what they judge:
//
//   LIVE CHECK. A read-only SQL text (fin-b20-sql.mjs) judged every morning over the saved rows the
//   control writes or reads. Every contract is `emptyAs: "quiet"`: a control nobody has used in the
//   window has nothing to judge, so it reads green with the words "no saved results yet", and it
//   goes red on the first wrong result. Each live row also names the screen half (a real-browser
//   practice test with fake answers) that holds what the control does on the page.
//
//   PRACTICE TEST. A fake-data test that runs the real page script (shell.js, chat-widget.js,
//   sales-floor.js, the rail file) in a real Chromium, and for the sales floor the real read module
//   over a stand-in database with the real column names. Nothing is saved anywhere real.
//
// This file is read at build time by scripts/pulse/compile-catalog.mjs. It imports nothing but the two
// sibling data files, so the live bundle (which reads generated.json) never loads it.

import { FIN_B20_ROWS } from "./fin-b20-rows.mjs";
import {
  AVATAR_SQL,
  SESSION_SQL,
  BRAND_SQL,
  CHAT_PEER_SQL,
  BELIEF_SQL,
  SOURCE_SQL,
  DISCIPLINE_SQL,
  RECORDING_SQL,
} from "./fin-b20-sql.mjs";

export const FIN_B20_LANE = "src/pulse/coverage/gap-catalog-display.mjs";
export const FIN_B20_LIVE_TEST = "src/pulse/catalog/proofs/fin-b20-live-contracts.test.mjs";
export const FIN_B20_LIVE_FLOOR_TEST = "src/pulse/catalog/proofs/fin-b20-live-floor.test.mjs";
export const FIN_B20_FLOOR_READS_TEST = "src/pulse/catalog/proofs/fin-b20-sales-floor-reads.test.mjs";
export const FIN_B20_SHELL_TEST = "src/pulse/catalog/proofs/fin-b20-shell-chrome.test.mjs";
export const FIN_B20_GATE_TEST = "src/pulse/catalog/proofs/fin-b20-shell-gate.test.mjs";
export const FIN_B20_CHAT_TEST = "src/pulse/catalog/proofs/fin-b20-shell-chat.test.mjs";
export const FIN_B20_SIDEBAR_TEST = "src/pulse/catalog/proofs/fin-b20-sidebar.test.mjs";
export const FIN_B20_FLOOR_TEST = "src/pulse/catalog/proofs/fin-b20-sales-floor.test.mjs";
// Repair cycle 1: the gaps an independent checker found by breaking the product and watching what stayed green.
export const FIN_B20_R_FLOOR_TEST = "src/pulse/catalog/proofs/fin-b20-repair-floor.test.mjs";
export const FIN_B20_R_SHELL_TEST = "src/pulse/catalog/proofs/fin-b20-repair-shell.test.mjs";
export const FIN_B20_R_GATE_TEST = "src/pulse/catalog/proofs/fin-b20-repair-gate.test.mjs";
export const FIN_B20_R_CHAT_TEST = "src/pulse/catalog/proofs/fin-b20-repair-chat.test.mjs";
export const FIN_B20_R_SIDEBAR_TEST = "src/pulse/catalog/proofs/fin-b20-repair-sidebar.test.mjs";
// Existing product tests that run the real handler and the real session statement (attached, not new).
const LOGOUT_HANDLER_TEST = "src/http/auth-logout-handler.test.mjs";
const SESSION_TEST = "src/auth/session.test.mjs";

function contract(rowKey, requirement, key, body) {
  return Object.freeze({
    control: FIN_B20_ROWS[rowKey][2],
    mode: "query",
    emptyAs: "quiet",
    requirement,
    sql: `/* display-result:${key} */\n${body.trim()}`,
    rowKey,
  });
}

const AVATAR_REQ = "Every saved staff photo must sit under that person's own company and staff folder and be a png or jpeg file, so one person's photo is never another person's.";
const SIGN_OUT_REQ = "A signed-out session must never be seen again after the moment it was revoked, so a sign-out really ends the session and the page-load check never lets a revoked token in.";

const CONTRACTS = Object.freeze([
  contract("deskaAvatar", AVATAR_REQ, "fin-b20-staff-avatar", AVATAR_SQL),
  contract("deskbPhoto", AVATAR_REQ, "fin-b20-staff-avatar", AVATAR_SQL),
  contract("deskcAvatar", AVATAR_REQ, "fin-b20-staff-avatar", AVATAR_SQL),
  contract("fAvatar", AVATAR_REQ, "fin-b20-staff-avatar", AVATAR_SQL),
  contract("deskaSignOut", SIGN_OUT_REQ, "fin-b20-session", SESSION_SQL),
  contract("deskbSignOut", SIGN_OUT_REQ, "fin-b20-session", SESSION_SQL),
  contract("deskbSession", SIGN_OUT_REQ, "fin-b20-session", SESSION_SQL),
  contract("fClockHealthBrand", "Every saved company brand must carry a wordmark the shell will accept (https, or an image data address with a base64 body, holding no whitespace, quote, angle bracket or parenthesis), ink that differs from paper, and a ramp of no stops or six.", "fin-b20-brand", BRAND_SQL),
  contract("fChat", "Every person-to-person chat thread must have no client, exactly two staff of this company as participants, a pair key made of those two ids, and only internal notes sent by one of the two.", "fin-b20-chat-peer", CHAT_PEER_SQL),
  contract("sfBelief", "Every call outcome that names a failed belief must belong to a client of this company, or the belief panel never counts it.", "fin-b20-belief-join", BELIEF_SQL),
  contract("sfSource", "Every logged call must belong to a client of this company, or the lead-source panel's held, close and desire counts leave it out.", "fin-b20-source-join", SOURCE_SQL),
  contract("sfDiscipline", "A past-due closer booking task must not be counted as an unlogged call when a disposition with its booking reference is already saved, and a held call counted as having no recording and no transcript must not carry a transcript.", "fin-b20-discipline", DISCIPLINE_SQL),
  contract("sfRecordings", "Every recording the floor lists must link to https on Google Drive or Docs, belong to a client of this company, and a file shown as Words ready must hold indexed words or a transcript on that client's call.", "fin-b20-recordings", RECORDING_SQL),
]);

/** The contracts the display lane judges. The row key is internal and is dropped here. */
export const FIN_B20_RESULT_CONTRACTS = Object.freeze(
  CONTRACTS.map(({ rowKey, ...rest }) => Object.freeze(rest)),
);

/** The practice tests that hold the screen half of each row (the real page, fake answers). */
const SCREEN_TESTS = Object.freeze({
  deskaSidebar: [FIN_B20_SIDEBAR_TEST, FIN_B20_R_SIDEBAR_TEST],
  deskaSearch: [FIN_B20_SHELL_TEST, FIN_B20_R_SHELL_TEST],
  deskaSignOut: [FIN_B20_SHELL_TEST, FIN_B20_R_SHELL_TEST, LOGOUT_HANDLER_TEST, SESSION_TEST],
  deskaAvatar: [FIN_B20_SHELL_TEST],
  deskbNavLinks: [FIN_B20_SIDEBAR_TEST, FIN_B20_R_SIDEBAR_TEST],
  deskbHeads: [FIN_B20_SIDEBAR_TEST, FIN_B20_R_SIDEBAR_TEST],
  deskbSignOut: [FIN_B20_SHELL_TEST, FIN_B20_R_SHELL_TEST, LOGOUT_HANDLER_TEST, SESSION_TEST],
  deskbPhoto: [FIN_B20_SHELL_TEST],
  deskbSession: [FIN_B20_GATE_TEST, FIN_B20_R_GATE_TEST, FIN_B20_R_SHELL_TEST, SESSION_TEST],
  deskbBanners: [FIN_B20_GATE_TEST],
  deskcNav: [FIN_B20_SIDEBAR_TEST],
  deskcHeads: [FIN_B20_SIDEBAR_TEST],
  deskcSearch: [FIN_B20_SHELL_TEST, FIN_B20_R_SHELL_TEST],
  deskcAvatar: [FIN_B20_SHELL_TEST],
  deskcStatus: [FIN_B20_SHELL_TEST, FIN_B20_R_SHELL_TEST],
  deskcBetaDismiss: [FIN_B20_GATE_TEST],
  sfRoster: [FIN_B20_FLOOR_TEST, FIN_B20_R_FLOOR_TEST],
  sfBelief: [FIN_B20_FLOOR_READS_TEST, FIN_B20_FLOOR_TEST],
  sfSource: [FIN_B20_FLOOR_READS_TEST, FIN_B20_FLOOR_TEST],
  sfRecordings: [FIN_B20_FLOOR_TEST, FIN_B20_R_FLOOR_TEST],
  sfCompliance: [FIN_B20_FLOOR_READS_TEST, FIN_B20_FLOOR_TEST],
  sfDiscipline: [FIN_B20_FLOOR_READS_TEST, FIN_B20_FLOOR_TEST, FIN_B20_R_FLOOR_TEST],
  sfChips: [FIN_B20_FLOOR_TEST],
  fragHeads: [FIN_B20_SIDEBAR_TEST, FIN_B20_R_SIDEBAR_TEST],
  linkHome: [FIN_B20_SIDEBAR_TEST],
  linkFinanceOs: [FIN_B20_SIDEBAR_TEST],
  linkConsent: [FIN_B20_SIDEBAR_TEST, FIN_B20_R_GATE_TEST],
  linkGalaxy: [FIN_B20_SIDEBAR_TEST],
  linkOpsAdmin: [FIN_B20_SIDEBAR_TEST],
  linkAgentEditor: [FIN_B20_SIDEBAR_TEST],
  linkWorkflows: [FIN_B20_SIDEBAR_TEST],
  linkJourneys: [FIN_B20_SIDEBAR_TEST],
  linkHiring: [FIN_B20_SIDEBAR_TEST],
  linkBrandStudio: [FIN_B20_SIDEBAR_TEST],
  linkAffiliate: [FIN_B20_SIDEBAR_TEST],
  fRoleGate: [FIN_B20_GATE_TEST, FIN_B20_R_GATE_TEST],
  fChip: [FIN_B20_SHELL_TEST, FIN_B20_R_SHELL_TEST],
  fAvatar: [FIN_B20_SHELL_TEST],
  fChat: [FIN_B20_CHAT_TEST, FIN_B20_R_CHAT_TEST],
  fClockHealthBrand: [FIN_B20_GATE_TEST, FIN_B20_SHELL_TEST, FIN_B20_R_SHELL_TEST],
});

const LIVE_KEYS = Object.freeze(CONTRACTS.map((c) => c.rowKey));

function entry(rowKey, tests, withLane) {
  const [sourceFile, surface, control] = FIN_B20_ROWS[rowKey];
  const evidence = withLane ? `${tests.join("; ")}; ${FIN_B20_LANE}` : tests.join("; ");
  return Object.freeze({ sourceFile, surface, control, depth: "deep", evidence, tests: Object.freeze([...tests]) });
}

const FLOOR_LIVE_KEYS = new Set(["sfBelief", "sfSource", "sfDiscipline", "sfRecordings"]);

/** Rows judged by the live lane. Also handed to the catalog compiler as deep cases. */
export const FIN_B20_LIVE_CASES = Object.freeze(
  LIVE_KEYS.map((key) => entry(key, [FLOOR_LIVE_KEYS.has(key) ? FIN_B20_LIVE_FLOOR_TEST : FIN_B20_LIVE_TEST, ...SCREEN_TESTS[key]], true)),
);

/** Rows proved by a practice test only (the real page or read module, fake answers). */
export const FIN_B20_PRACTICE_CASES = Object.freeze(
  Object.keys(SCREEN_TESTS)
    .filter((key) => !LIVE_KEYS.includes(key))
    .map((key) => entry(key, SCREEN_TESTS[key], false)),
);

export const FIN_B20_DISPLAY_CASES = Object.freeze([...FIN_B20_LIVE_CASES, ...FIN_B20_PRACTICE_CASES]);

/** Rows this batch looked at and cannot attach without a product change. Each reason is exact. */
export const FIN_B20_NOT_ATTACHABLE = Object.freeze([]);

export { LIVE_KEYS as FIN_B20_LIVE_KEYS };
