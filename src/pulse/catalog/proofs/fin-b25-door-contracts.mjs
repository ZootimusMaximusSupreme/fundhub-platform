// Finish-the-853 batch 25 (staff-only and public routes): rows that a fake-data handler test now judges.
// A row is named by the same 20-hex id the catalog compiler gives it (sha256 of sourceFile, surface and
// control), so a changed control is a new, unproved row. Each entry lists the test files that run the
// real api/ handler over a stand-in database and judge the exact result. Every one of them was broken on
// purpose, product line by product line, and went red (the mutation list is in the batch manifest).
// These are practice tests (fake data, stand-in tables, no network, no database), not live checks.
//
// NOT ATTACHED ON PURPOSE (a check must not be green on a product that is wrong today):
//   * routes-1 public/eeo-survey POST: a form that leaves any one of the four optional questions blank crashes
//     the handler (pickField returns null and parseEeoBody reads .ok on it, outside any try). A test of the
//     promised behavior is red until that is fixed, so the row stays unproved.
//   * routes-1 read/company-activity: every person's activity label reads "event" (the query names the column
//     "label" and the code reads row.kind). A test of the labels is red until that is fixed.
// src/pulse/catalog/proofs/fin-b25-door-contracts.test.mjs checks every entry against the coverage map
// and the test files.
import { createHash } from "node:crypto";

export const FIN_B25_DOOR_EVIDENCE = "src/pulse/catalog/proofs/fin-b25-door-contracts.test.mjs";

const DEFINITIONS = [
  // routes-3 marketing/funnels: GET where ads send people and which Meta campaigns belong to each funnel; POST edits a funnel.
  ["786c8217f7a506f47aa1", ["src/http/fin-b25-marketing-funnels.test.mjs"]],
  // routes-0 marketing/funnels/build: Queue a job that writes (or re-writes) a draft funnel's three pages. Refused when the funnel is live
  ["51680344f2bbbac33cfd", ["src/http/fin-b25-marketing-funnels.test.mjs"]],
  // routes-1 marketing/funnels/create: POST {request_id, offer_key, lane, name, path, build} make a draft book-a-call funnel and queue the 
  ["08daecd138f811a2acb2", ["src/http/fin-b25-marketing-funnels.test.mjs"]],
  // routes-0 marketing/funnels/rename: Rename a draft funnel's address (path); reads the live ClickFunnels workspace to refuse a taken addr
  ["4dd8bc316bd69ca74cf1", ["src/http/fin-b25-marketing-funnels.test.mjs"]],
  // routes-1 marketing/funnels/stats: GET marketing numbers by funnel, last 30 Arizona days (page views, leads, booked, showed, sales, cas
  ["6abe8dc942b69850b7e2", ["src/http/fin-b25-marketing-funnels.test.mjs"]],
  // routes-3 marketing/health: GET the Command Center health card: clock and worker last runs, queue, outbox state, model cost agai
  ["732572770142c747c035", ["src/http/fin-b25-marketing-queue.test.mjs"]],
  // routes-0 marketing/ideas: Ideas inbox: list ideas; POST saves an idea and may queue a one-idea batch (write_now = paid model r
  ["185e5e165c12d6ad087d", ["src/http/fin-b25-marketing-ideas-offer.test.mjs"]],
  // routes-1 marketing/jobs/retry: POST {request_id, job_id} put one failed marketing job back in the queue clean
  ["6390cfc4e573e207c5eb", ["src/http/fin-b25-marketing-queue.test.mjs"]],
  // routes-0 marketing/meta/load-status: How each ad video's Meta load is doing (waiting, loading, loaded, refused, failed).
  ["6d89db1e82b79fc448a4", ["src/http/fin-b25-marketing-queue.test.mjs"]],
  // routes-1 marketing/offer/generate: POST start the Write offer run (six offers, four judges, one winner; background writer, Anthropic mo
  ["2636cc897ddd20183f1c", ["src/http/fin-b25-marketing-ideas-offer.test.mjs"]],
  // routes-3 marketing/research: POST {question, depth, sources, max_cost_usd} starts a deep research run (one in flight per company)
  ["a89aeac9ee44ed8cecdb", ["src/http/fin-b25-marketing-research.test.mjs"]],
  // routes-0 marketing/research/approve: Approve a finished deep-research report (stamps who and when; re-saves the report file via the repo 
  ["b94af279153d03a26a92", ["src/http/fin-b25-marketing-research.test.mjs"]],
  // routes-1 marketing/research/brain: POST {id, request_id} save a finished deep-research report into Company Brain (owner tier, paid embe
  ["5e367f011e4ee2bc6474", ["src/http/fin-b25-marketing-research.test.mjs"]],
  // routes-3 marketing/research/tweak: POST {id, note} a one-line tweak starts a short re-run of the same research question that goes deepe
  ["54dd3d388c2d2f96974d", ["src/http/fin-b25-marketing-research.test.mjs"]],
  // routes-0 marketing/rules: Copy rules screen: read Part 0 rules, banned phrases and recent changes; POST queues an add / edit /
  ["7dbfb731a53932e6d58f", ["src/http/fin-b25-marketing-rules-settings.test.mjs"]],
  // routes-0 marketing/scripts/approve: Approve and lock an ad script; assigns its ad number once (next_ad_number) and queues the repo file 
  ["ece39db9fad161bcf7cd", ["src/http/fin-b25-marketing-scripts.test.mjs"]],
  // routes-1 marketing/scripts/edit: POST {request_id, id, version, body, parts} save a new script version (old one kept); also accepts a
  ["140ac89eb055c90d27ad", ["src/http/fin-b25-marketing-scripts.test.mjs"]],
  // routes-3 marketing/scripts/fix: POST {request_id, id, version, note, make_rule} the Fix button: queues a rewrite job from the note a
  ["f4ae6511655ad98fe583", ["src/http/fin-b25-marketing-scripts.test.mjs"]],
  // routes-0 marketing/scripts/order: Set the film order of approved scripts for Shoot Day.
  ["4d71fe98d0efbbdcdc17", ["src/http/fin-b25-marketing-scripts.test.mjs"]],
  // routes-1 marketing/scripts/reject: POST {request_id, id, version, reason} reject a draft script
  ["e1db7f29b275e89a9197", ["src/http/fin-b25-marketing-scripts.test.mjs"]],
  // routes-3 marketing/settings: GET the marketing machine's settings (one row per company; first read makes the defaults); POST chan
  ["65552f450ce4bd721beb", ["src/http/fin-b25-marketing-rules-settings.test.mjs"]],
  // routes-0 marketing/shoot: GET: Shoot Day read (what to film, order, file names, teleprompter text). Open to an unsigned GET fo
  ["7a6abd927e199cc266ae", ["src/http/fin-b25-marketing-shoot.test.mjs"]],
  // routes-0 marketing/shoot: POST: save Shoot Day moves (open or reorder a shoot, plan scripts).
  ["35dff3e1598a8df64f78", ["src/http/fin-b25-marketing-shoot.test.mjs"]],
  // routes-1 marketing/shoot/mark: POST {request_id, shoot_id, root_script_id, mark got_it|another_take} count a take on Shoot Day (mov
  ["d15beccc151d5134d861", ["src/http/fin-b25-marketing-shoot.test.mjs"]],
  // routes-0 ops/weekly-brief: Generate this week's ops brief with a model call and file it into Company Brain (owner tier), so it 
  ["58342852552f81d00c31", ["src/http/fin-b25-ops-partner.test.mjs"]],
  // routes-0 partner-addons: Read a partner's add-on catalog, current plan, history and orders.
  ["947e5262c31eb0e9fa0a", ["src/http/fin-b25-ops-partner.test.mjs"]],
  // routes-0 partner-marketing/copy-history: GET: version history of a partner page section. POST: restore an earlier version of the copy.
  ["7d0de110570037fe32b6", ["src/http/fin-b25-ops-partner.test.mjs"]],
  // routes-0 public/ad-video-approve: GET shows the filmed take; POST is the decision: Chris taps Approve or Reject from a phone notificat
  ["dd4ecaf3b77ea088d9cc", ["src/http/fin-b25-public-doors.test.mjs"]],
  // routes-1 public/eeo-survey: GET ?token= load the voluntary EEO self-ID form (never writes)
  ["f45c2fe84d1f72ec511b", ["src/http/fin-b25-public-doors.test.mjs"]],
  // routes-0 public/partner-page: JSON for a published white-label partner page (partner_id plus slug or domain).
  ["f354dffc9480c8065b41", ["src/http/fin-b25-public-doors.test.mjs"]],
  // routes-0 public/vsl-watch: VSL player beacon: stores watch sessions and position samples (rate limited by visitor and site-wide
  ["703af2ed5b6013367e16", ["src/http/fin-b25-public-doors.test.mjs"]],
  // routes-2 read/ad-books: GET /api/read/ad-books?group_by=lane|ad_id|variant|gate|entry|primary_offer|secondary_offer[&from&to
  ["c6184ed33f707cbe962e", ["src/http/fin-b25-read-doors.test.mjs"]],
  // routes-0 read/blueprint-combined-approval: Capital Blueprint primary buyer plus credit partner: prequal per file and the combined sum.
  ["6d75b247e6bcd633a04b", ["src/http/fin-b25-read-doors.test.mjs"]],
  // routes-0 read/closer-call: Closer Dashboard live-call payload for one client: cockpit, offers, ad lines, funding numbers.
  ["edb7c4e0d541022f6c5b", ["src/http/fin-b25-read-doors.test.mjs"]],
  // routes-2 read/closer-call: GET /api/read/closer-call?client_id= — the Closer Dashboard live-call payload (cockpit): everything 
  ["79c2ca0a249cdb1f167c", ["src/http/fin-b25-read-doors.test.mjs"]],
  // routes-3 read/closer-now: GET which call this closer is on and what is next. Scoped to the signed-in staff member.
  ["dbabdb28f5a26a80ff13", ["src/http/fin-b25-read-doors.test.mjs"]],
  // routes-0 read/csm-queue: The CSM's day: clients to talk to today, what they owe (open balance next to the name), and what the
  ["7a5ecea71540e8e50f35", ["src/http/fin-b25-read-doors.test.mjs"]],
  // routes-2 read/finance-ask: POST /api/read/finance-ask {question, client_id} — answers three fixed question shapes (can I afford
  ["c39f9f52738a06270043", ["src/http/fin-b25-read-doors.test.mjs"]],
];

export function finB25DoorRowId(sourceFile, row) {
  const file = String(sourceFile || "").split(/[\\/]/).at(-1);
  return createHash("sha256")
    .update(`${file}\0${row?.surface}\0${row?.control}`)
    .digest("hex")
    .slice(0, 20);
}

export const FIN_B25_DOOR_CONTRACTS = Object.freeze(
  DEFINITIONS.map(([id, tests]) => Object.freeze({ id, tests: Object.freeze([...tests]) })),
);

const BY_ID = new Map(FIN_B25_DOOR_CONTRACTS.map((entry) => [entry.id, entry]));

export function finB25DoorProof(sourceFile, row) {
  const entry = BY_ID.get(finB25DoorRowId(sourceFile, row));
  if (!entry) return null;
  return {
    depth: "e2e",
    evidence: [FIN_B25_DOOR_EVIDENCE, ...entry.tests].join(" "),
    asserts: row.control,
  };
}
