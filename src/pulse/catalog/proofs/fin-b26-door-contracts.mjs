// Finish-the-853 batch 26 (route rows, staff only and no-impact reads and writes): rows that a
// fake-data handler test now judges. A row is named by the same 20-hex id the catalog compiler gives
// it (sha256 of sourceFile, surface and control), so a changed control is a new, unproved row.
// Each entry lists the test file that runs the real api/ handler over stand-in tables and judges the
// exact saved result; every one of them was broken on purpose (product line changed, test seen red,
// line put back). These are practice tests with fake data, not live checks.
// src/pulse/catalog/proofs/fin-b26-door-contracts.test.mjs checks every entry against the coverage map
// and the test files.
import { createHash } from "node:crypto";

export const FIN_B26_DOOR_EVIDENCE = "src/pulse/catalog/proofs/fin-b26-door-contracts.test.mjs";

const DEFINITIONS = [
  // routes-2 read/inbox: GET /api/read/inbox — every conversation in the company, newest first: who, channel, last messag
  ["8ef94e8743c420e45ba1", ["src/http/fin-b26-read-inbox-messages.test.mjs"]],
  // routes-0 read/inquiry-cases: Active inquiry-removal case queue with document packets for the Specialist desk.
  ["a8af10e079f05bbe96cb", ["src/http/fin-b26-read-inquiry-cases.test.mjs"]],
  // routes-3 read/message-templates: GET the message copy library the template editor reads, with each row's body and who uses it (jo
  ["88f423da3e806c5eeeca", ["src/http/fin-b26-read-message-templates.test.mjs"]],
  // routes-0 read/messages: One conversation's messages in both directions, or the org's blocked messages (status=blocked).
  ["845af2412d2421b50095", ["src/http/fin-b26-read-inbox-messages.test.mjs"]],
  // routes-0 read/my-numbers: Closer's own performance (calls, show rate, close rate, cash); finance roles may view another cl
  ["7e010f40c4c194e0b56f", ["src/http/fin-b26-read-my-numbers.test.mjs"]],
  // routes-0 read/portal-contracts: Agreements on the signed-in client's file: sent, viewed, signed, and a fresh sign link when they
  ["9afeb2ba0da2333558bc", ["src/http/fin-b26-portal-contracts.test.mjs"]],
  // routes-0 scripts/write: Save an ad script (a rewrite is a new row pointing at its parent) and its labels so the ad spine
  ["afa8248a91adef4609bd", ["src/http/fin-b26-scripts-write.test.mjs"]],
  // routes-0 social/channels: Social Studio: a partner's connected social channels (tokens redacted, can_post flag).
  ["8cba63fad6aa1ea4faae", ["src/http/fin-b26-social-channels.test.mjs"]],
  // routes-2 social/oauth: GET /api/social/oauth?action=start|callback&channel=facebook|instagram|linkedin — connects a soc
  ["3d5a44ba21b28269fe01", ["src/http/fin-b26-social-oauth.test.mjs"]],
  // routes-0 social/posts: queue / schedule / approve / reject / discard a social post. Approve and reject are owner or adm
  ["5f1e3350680cd3b2fda8", ["src/http/fin-b26-social-posts.test.mjs"]],
  // routes-0 social/posts: Social Studio queue read: the partner's queued, held, scheduled posts with blocked reasons.
  ["e91799f6a451a9e06ea7", ["src/http/fin-b26-social-posts.test.mjs"]],
  // routes-1 social/publish: POST {all?|partner_id} run publishDue: publish every due scheduled post to its social channel (s
  ["c0d112c120989b36a604", ["src/http/fin-b26-social-publish.test.mjs"]],
  // routes-0 social/settings: Owner flips approve_before_launch (whether a person must read every social post before it goes o
  ["8f6bb774a0e63a605bd8", ["src/http/fin-b26-social-settings.test.mjs"]],
  // routes-0 social/settings: Partner marketing module settings read (approve-before-launch, caps, autopilot, suite on/off).
  ["92f8de4c812919f85da8", ["src/http/fin-b26-social-settings.test.mjs"]],
  // routes-0 training-progress: Record a partner's training: one module attended or complete, or one compliance gate passed, fai
  ["8ea500f6a71054881053", ["src/http/fin-b26-training-progress.test.mjs"]],
  // routes-2 trials/dashboard: GET /api/trials/dashboard — the live screen a $297 Live Trial buyer watches for a week: counts o
  ["c571dcd6b737a2fd3362", ["src/http/fin-b26-trials-dashboard.test.mjs"]],
];

export function finB26DoorRowId(sourceFile, row) {
  const file = String(sourceFile || "").split(/[\\/]/).at(-1);
  return createHash("sha256")
    .update(`${file}\0${row?.surface}\0${row?.control}`)
    .digest("hex")
    .slice(0, 20);
}

export const FIN_B26_DOOR_CONTRACTS = Object.freeze(
  DEFINITIONS.map(([id, tests]) => Object.freeze({ id, tests: Object.freeze([...tests]) })),
);

const BY_ID = new Map(FIN_B26_DOOR_CONTRACTS.map((entry) => [entry.id, entry]));

export function finB26DoorProof(sourceFile, row) {
  const entry = BY_ID.get(finB26DoorRowId(sourceFile, row));
  if (!entry) return null;
  return {
    depth: "e2e",
    evidence: [FIN_B26_DOOR_EVIDENCE, ...entry.tests].join(" "),
    asserts: row.control,
  };
}
