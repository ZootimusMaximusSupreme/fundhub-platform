// STRUCTURAL PROOF: nothing can reach the network except through the fence.
//
// The other fence tests ask "does the guard work?". This one asks the question
// that actually matters — "can anything get past it?" — and it is the reason
// this whole change is shaped the way it is.
//
// The fence this replaced was a condition each caller was trusted to remember.
// That is unverifiable by construction: a provider written next month either
// remembers or it does not, nothing fails when it does not, and the failure is
// discovered by a real client receiving a real message. No amount of testing
// the guard itself would have caught it, because the guard was never wrong —
// it was bypassed.
//
// So this test does not exercise behaviour. It reads the source tree and
// asserts that every module capable of an outbound call either routes through
// src/lib/outbound-fetch.mjs or is named on a list below with a written reason.
// A new file that calls fetch directly fails the build.
//
// Same pattern, and for the same reason, as src/http/routes.test.mjs: an
// escape hatch that requires editing a reviewed list is a decision. An escape
// hatch that requires nothing is a hole.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const SCANNED_DIRS = ["src", "api", "netlify"];
const CHOKEPOINT = "src/lib/outbound-fetch.mjs";

/* Tokens that mean "this module can put a request on the wire". Deliberately
   matched on the CALL, not the word: `await fetchContext(` and `fetchDoc(` are
   database reads with unlucky names and must not trip this. */
const NETWORK_TOKENS = [
  /\bglobalThis\.fetch\b/,
  /\bawait\s+fetch\s*\(/,
  /* A bare, un-awaited fetch to a literal web address. A debugging beacon in
     api/social/oauth.mjs (fetch("http://127.0.0.1:7854/ingest/…").catch(…))
     shipped to production because every token above needs `await` or a
     named fetch helper (walkthrough-4 defect 10, 2026-09-06). */
  /(^|[^\w.$])fetch\s*\(\s*["'`]https?:\/\//m,
  /\bfetchImpl\s*\(/,
  /\bfetchFn\s*\(/,
  /\bdoFetch\s*\(/,
  /\bctx\.fetch\b/
];

/* ── ALLOWED_RAW_FETCH ──────────────────────────────────────────────────────
   Modules that reach the network without going through the chokepoint, each
   with the reason it is acceptable. Adding an entry is a deliberate, reviewed
   act; the test below also fails on a STALE entry, so this list cannot rot
   into a place where things are quietly parked.

   None of these can reach a client or change a client's record at a vendor.
   That is the bar. If a new entry can do either, it does not belong here — it
   belongs behind a fence. */
/* The morning pulse's gap lanes (src/pulse/coverage/gap-*.mjs): GET or HEAD of
   our own pages and read doors on fundhub.ai and apply.fundhub.ai, to see that a
   door answers. Report only. Never POSTs, never sends, never reaches a client or
   changes a vendor record. */
const PULSE_GAP_READS =
  "Read-only GET/HEAD probes of our own pages and read doors for the 6 a.m. " +
  "pulse. Never POSTs. Never sends SMS or email. No client, no vendor record.";

const ALLOWED_RAW_FETCH = {
  "netlify/functions/ad-video-sweeper.mjs":
    "The clock for the ad-video pipeline. Its ONE call is a POST to our own deploy " +
    "(process.env.URL) at /.netlify/functions/ad-video-worker-background, behind a shared " +
    "secret, to start the 15-minute worker that Netlify will not put on a schedule. " +
    "Nothing leaves fundhub.ai and no vendor is reached; the vendor calls happen inside " +
    "the worker, through the providers and the chokepoint. Added 2026-09-24 after the " +
    "worker had to move off Inngest (26 s) and off a scheduled function (30 s), both of " +
    "which killed a 120 MB upload mid-flight.",
  "src/marketing/offer-transport.mjs":
    "The offer generator's two calls, neither of which reaches a client or a vendor " +
    "record. (1) askAnthropic wraps the fetch handed to src/agents/model.mjs only to " +
    "attach an AbortSignal, the same as api/social/generate.mjs; the model call is a " +
    "question to a language model. (2) wakeOfferWorker is ONE POST to our own deploy " +
    "(process.env.URL) at /.netlify/functions/marketing-offer-background with the " +
    "owner's own session, to start the 15-minute writer the 26 s /api function cannot " +
    "hold (spec docs/specs/marketing-machine-2026-10-04.md §6 Step 4 names this wake). " +
    "Added 2026-10-05.",
  "src/marketing/wake.mjs":
    "The marketing machine's wake (spec docs/specs/marketing-machine-2026-10-04.md §6 " +
    "Step 2: a save writes its outbox row, then wakes the worker). Its ONE call is a POST " +
    "to our own deploy (process.env.URL or DEPLOY_URL) at /.netlify/functions/" +
    "marketing-worker-background, behind the MARKETING_WORKER_SECRET header, to start the " +
    "15-minute worker. Same shape as ad-video-sweeper above. Nothing leaves fundhub.ai and " +
    "no vendor is reached; the GitHub, Meta and model calls happen inside the worker, " +
    "through src/messaging/providers/* and the fence. Added 2026-10-05 (U05).",
  "src/marketing/funnel-transport.mjs":
    "The funnel builder's wake (build unit X4). Its ONE call is a POST to our own " +
    "deploy (process.env.URL or DEPLOY_URL) at /.netlify/functions/marketing-funnel-background " +
    "with the owner's own session and { job_id }, to start the 15-minute worker the 26 s " +
    "/api function cannot hold. Same shape as wakeOfferWorker above. Nothing leaves " +
    "fundhub.ai and no vendor is reached; the model call goes through src/agents/model.mjs " +
    "and every ClickFunnels call through src/messaging/providers/clickfunnels-pages.mjs " +
    "and the ADAPTERS fence. Added 2026-10-06.",
  // ── Not actually the global fetch ────────────────────────────────────────
  "src/http/read-api.mjs":
    "`fetch` here is a local parameter holding a database reader, not the global.",

  // ── Reads and internal infrastructure. No client, no vendor record ───────
  "src/adapters/hubstaff.mjs":
    "Reads staff time-tracking data for payroll. No write, no client involvement.",
  "src/payments/commas-api.mjs":
    "GET /payments/:id reconciliation. Reads a payment we were already told about.",
  "src/company-brain/auth.mjs":
    "Exchanges a Google refresh token for an access token. Internal infrastructure.",
  "src/company-brain/drive-client.mjs":
    "Reads company documents out of Google Drive. Read-only, staff-facing.",
  "src/documents/store.mjs":
    "Fetches a stored document by URL for internal rendering.",
  "src/agents/model.mjs":
    "Asks a language model a question. No client contact, no vendor record.",
  "api/journeys/ask.mjs":
    "Staff-facing question to a language model. No client contact.",
  "src/adapters/oxylabs.mjs":
    "Location lookup against a scraping proxy. No client data leaves.",
  "src/gmail/client.mjs":
    "Reads a Gmail mailbox — profile and message list only. Checked 2026-08-27: "
    + "the module exports no send function and issues no POST; gmailFetch() "
    + "defaults method to GET and every call site takes that default. Cannot "
    + "reach a client and cannot change a vendor record.",
  "src/handlers/inbound-mms-docs.mjs":
    "Downloads a photo the client already sent US, from the Twilio media URL "
    + "on the inbound webhook. Inbound only — GET with the account credentials, "
    + "no message leaves. Cannot reach a client.",

  // ── Conduits. Default a fetch and hand it to a module listed above ───────
  "src/agents/runtime.mjs":
    "Defaults fetchImpl and passes it to src/agents/model.mjs. Never calls it.",
  "src/creative/providers/copy.mjs":
    "Passes ctx.fetch to src/agents/model.mjs. Never calls fetch itself.",
  "src/creative-intel/job.mjs":
    "Passes ctx.fetch down to the ad-intelligence classifier, which asks a " +
    "language model to label COMPETITOR ad copy through src/agents/model.mjs. " +
    "Never calls fetch itself. Cannot reach a client and cannot change a vendor " +
    "record — the vendor adapters in src/creative-intel/vendors/ read recorded " +
    "fixtures and open no socket at all.",
  "api/social/generate.mjs":
    "Wraps globalThis.fetch only to attach an AbortSignal for callModel. The " +
    "model call itself is already fenced via src/agents/model.mjs. No client " +
    "contact and no vendor record change.",
  "src/company-brain/sync.mjs":
    "Defaults fetchImpl and passes it to the Drive client. Never calls it.",
  "src/company-brain/walk.mjs":
    "Defaults fetchImpl and passes it to the Drive client. Never calls it.",

  // ── Company-owned accounts. Reach the company's own pages, not a client ──
  "src/social/oauth.mjs":
    "OAuth token exchange for company-owned social accounts. Authenticates the " +
    "company to its own pages; reaches no client.",
  "src/social/adapters.mjs":
    "Publishes to company-owned social accounts, gated by its own older " +
    "SOCIAL_PUBLISH_DRY_RUN flag. Company marketing, not client contact. Worth " +
    "folding into the one fence later.",
  "src/hiring/linkedin.mjs":
    "Job posting to a company-owned LinkedIn account. No client contact.",

  /* ── SPENDS MONEY, REACHES NO CLIENT — flagged, deliberately not fenced ───
     These can change live ad campaigns, and therefore spend, but they cannot
     contact a client or alter a client's record. The fence built here covers
     client contact, which is what was asked for and where the compliance risk
     sits. Listing them IS the finding: nothing holds these back today, and if
     that matters it is a separate piece of work rather than a silent extension
     of this one. */
  "src/adplatforms/_api.mjs":
    "UNFENCED SPEND: shared ad-platform HTTP client. Can alter live ad campaigns.",
  "src/adplatforms/tiktok.mjs":
    "UNFENCED SPEND: TikTok ads, via the shared client above.",
  "src/creative/providers/_http.mjs":
    "UNFENCED SPEND: paid creative-generation providers.",

  /* ── CLAUDE.md §12 named exceptions — letter delivery / CRS letter POST ───
     These default fetchImpl to globalThis.fetch and hand it to letter-delivery
     helpers. Owner-documented exceptions, not new holes. Do not cite them to
     justify a fourth raw-fetch call site. */
  "src/workflows/c-06-crs-results-router.mjs":
    "CLAUDE.md §12 exception: POST to letter-delivery URL for funding letter pack. " +
    "fetchImpl is injectable; default is globalThis.fetch for test seams.",
  "src/workflows/ds-02-diy-letters.mjs":
    "CLAUDE.md §12 exception: POST to the same letter-delivery URL for DIY letters. " +
    "fetchImpl is injectable; default is globalThis.fetch for test seams.",

  /* ── Market / macro data. No client contact, no vendor client record ─────── */
  "src/climate/connectors.mjs":
    "Reads FRED/BLS/Census/NOAA/geocode public series for the climate engine. " +
    "Since 2026-09-22 the same two geocoder GETs also check that a $297 buyer's " +
    "typed home address exists (verifyStreetAddress): the street, city, state " +
    "and ZIP go to the Census geocoder or Google Geocoding as a lookup. Nothing " +
    "else of the buyer's leaves; no client is contacted and no client or vendor " +
    "record is written.",
  "src/analytics/clickfunnels.mjs":
    "Reads Chris's own ClickFunnels workspace: funnels, pages, page stats. " +
    "The raw fetch is GET only — listFunnels/listPages/fetchPageStats never POST, " +
    "PUT or DELETE anything. Its ONE write, upsertContact (a person's details onto " +
    "a ClickFunnels contact, since 2026-09-25), goes through transmit() behind the " +
    "ADAPTERS fence (2026-10-05; until then it rode the raw fetch while this entry " +
    "said 'GET only').",
  "src/analytics/youtube.mjs":
    "Reads watch time on Chris's own YouTube channel via the Analytics/Data " +
    "APIs. refreshAccessToken exchanges an OAuth token (matching " +
    "src/company-brain/auth.mjs's already-allowed pattern for the same kind of " +
    "call); listChannelVideos and fetchVideoStats are GET only. No client " +
    "contact, no video upload, no channel write of any kind.",
  "api/analytics/youtube-connect.mjs":
    "One small GET (channels?part=id&mine=true) to resolve the channel id " +
    "at connect time, alongside the two calls already allowed via " +
    "src/analytics/youtube.mjs above. Same read-only, no-client-contact " +
    "reasoning. Worth moving into youtube.mjs later so every outbound call " +
    "for this integration sits in one already-allowed file — not done "
    + "tonight to keep this change small.",
  "src/pulse/daily-pulse.mjs":
    "Read-only daily health audit. GET fundhub.ai pages and optional prove Gmail. " +
    "Does not send. Client SMS/WhatsApp go through messaging providers.",
  // ── Added 2026-10-05 (CI fix). Each was read before it was listed. ──────
  "src/adapters/clarity-export.mjs":
    "GET of Microsoft Clarity Data Export for Chris's own site analytics — the " +
    "one door owner law allows (.claude/rules/clarity-export-rate-limit.md), " +
    "rate-capped before the request. Reads session counts; no client is " +
    "contacted and no vendor record is changed.",
  "src/analytics/clarity-export.mjs":
    "GET of the same Clarity Data Export, reached only from the unregistered " +
    "clarity-insights-sweeper (DELIBERATELY_UNSERVED in src/workflows/" +
    "index.test.mjs). Read-only site analytics; no client, no vendor record.",
  "src/company-brain/local-whisper.mjs":
    "Downloads the open speech-to-text model file (WHISPER_CPP_MODEL_URL, a " +
    "public GET) onto the Mac for the Hormozi knowledge-base ingest. Nothing " +
    "about anybody leaves; no client, no vendor record.",
  "src/company-brain/hormozi-kb.mjs":
    "Conduit: defaults fetchImpl and hands it to whisperBytes " +
    "(src/company-brain/transcribe.mjs, INTERNAL), callModel " +
    "(src/agents/model.mjs) and the Drive client. Never calls it itself.",
  "src/adapters/clickfunnels.mjs":
    "Conduit: puts the caller's fetchImpl on ctx.fetch and hands it to " +
    "upsertContact in src/analytics/clickfunnels.mjs, which sends through " +
    "transmit() behind the ADAPTERS fence. Never calls fetch itself.",
  "src/slo/cf-contact.mjs":
    "Conduit: puts the caller's fetchImpl on ctx.fetch and hands it to " +
    "upsertContact in src/analytics/clickfunnels.mjs, which sends through " +
    "transmit() behind the ADAPTERS fence. Never calls fetch itself.",
  "src/pulse/registry.mjs":
    "Read-only GET uptime pings for the 7am pulse. Never POSTs. Never sends SMS " +
    "or email. Unrecorded is a local count only.",
  // ── Added 2026-10-09 (T3). Both landed 2026-10-07 (f5bf6534b) without being
  // sorted onto this list. Each was read before it was listed. ─────────────────
  "src/pulse/funnel-doors.mjs":
    "Read-only GET of our own ClickFunnels sales page (apply.fundhub.ai/roadmap) for " +
    "the 6 a.m. pulse and the 5-minute watch. The one call passes a URL and an accept " +
    "header and no method or body, so it is a GET. Never POSTs. Never sends. No " +
    "client is contacted and no vendor record is changed.",
  "src/pulse/instant-watch.mjs":
    "Conduit: defaults fetchImpl to globalThis.fetch and hands it on, never calling it " +
    "itself. It goes to (1) the read-only door checks, which GET our own pages " +
    "(src/pulse/daily-pulse.mjs and src/pulse/funnel-doors.mjs, both listed here), and " +
    "(2) the Twilio provider for the one alert text to the owner's own number, which " +
    "sends through postJsonTo() behind the MESSAGING fence; a fetchImpl handed to a " +
    "provider does not bypass that fence (src/messaging/providers/http.mjs).",
  // ── Added 2026-10-08 (heartbeat gap lanes). Each was read before it was
  // listed, and each lane was run against the live site with a fetch that
  // refuses anything but GET and HEAD: 0 refused calls in every lane. ──────
  "src/pulse/coverage/run-slices.mjs":
    "Conduit: puts the pulse's fetchImpl on ctx.fetchImpl and ctx.fetch for the " +
    "gap lanes. Never calls it itself.",
  "src/workflows/daily-pulse.mjs":
    "Conduit: hands globalThis.fetch to the gap lane steps (the same default " +
    "runDailyPulse uses). Never calls it itself.",
  "src/pulse/coverage/gap-keys.mjs":
    "Read-only key probes for the 6 a.m. pulse: GET the Twilio account record, GET the Resend domain list, " +
    "GET page 1 of Commas checkout transactions. Proves the live keys are accepted. Never sends, never " +
    "creates or changes a vendor record, never reaches a client. Read 2026-10-09 before it was listed.",
  "src/pulse/coverage/gap-built-funnels.mjs": PULSE_GAP_READS,
  "src/pulse/coverage/gap-calls.mjs": PULSE_GAP_READS,
  "src/pulse/coverage/gap-closer.mjs": PULSE_GAP_READS,
  "src/pulse/coverage/gap-closer-setup.mjs": PULSE_GAP_READS,
  "src/pulse/coverage/gap-consent.mjs": PULSE_GAP_READS,
  "src/pulse/coverage/gap-contracts.mjs": PULSE_GAP_READS,
  "src/pulse/coverage/gap-crm-links.mjs": PULSE_GAP_READS,
  "src/pulse/coverage/gap-funnels.mjs": PULSE_GAP_READS,
  "src/pulse/coverage/gap-inquiry.mjs": PULSE_GAP_READS,
  "src/pulse/coverage/gap-marketing-queue.mjs": PULSE_GAP_READS,
  "src/pulse/coverage/gap-owner-tools.mjs": PULSE_GAP_READS,
  "src/pulse/coverage/gap-partner-pages.mjs": PULSE_GAP_READS,
  "src/pulse/coverage/gap-partners.mjs": PULSE_GAP_READS,
  "src/pulse/coverage/gap-payments.mjs": PULSE_GAP_READS,
  "src/pulse/coverage/gap-pixels.mjs": PULSE_GAP_READS,
  "src/pulse/coverage/gap-portal.mjs": PULSE_GAP_READS,
  "src/pulse/coverage/gap-soft-pull.mjs": PULSE_GAP_READS,
  "src/pulse/coverage/gap-staff.mjs": PULSE_GAP_READS,
  "src/pulse/coverage/gap-training.mjs": PULSE_GAP_READS,
  "src/pulse/coverage/gap-webhooks.mjs": PULSE_GAP_READS,
};

/* Modules permitted to declare fence: INTERNAL. Pinned to an exact set, so a
   new module cannot quietly label itself internal to skip the flags.

   Shrank 2026-08-16: Company Brain completions (answer.mjs, classify.mjs) moved
   to Claude via src/agents/model.mjs, so they no longer declare a fence.
   embed.mjs stays — embeddings remain on OpenAI. */
const INTERNAL_CALLERS = new Set([
  "src/company-brain/embed.mjs",
  "src/company-brain/transcribe.mjs",
  "src/hiring/calendar-freebusy.mjs",
  // Added 2026-09-04. Sends a client's underwriting data to render-service/ —
  // our own Docker container running our own scripts/black-reports/fundhub_gen.py
  // — and gets four PDFs back. Reaches no person and changes no record at any
  // vendor; the service holds nothing after the response. It is INTERNAL for the
  // same reason an embedding call is: holding it behind the messaging or
  // adapters dry-run flag would not protect a consumer, it would just silently
  // downgrade every client's documents to the short pdf-lib set.
  "src/underwrite/black-report-pdf.mjs"
]);

function walk(dir, out = []) {
  let entries;
  try { entries = readdirSync(dir); } catch { return out; }
  for (const name of entries) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (name.endsWith(".mjs") && !name.endsWith(".test.mjs")) out.push(full);
  }
  return out;
}

const FILES = SCANNED_DIRS.flatMap((d) => walk(join(ROOT, d)))
  .map((f) => ({ path: relative(ROOT, f), source: readFileSync(f, "utf8") }));

/* Comment lines are dropped before scanning, or prose describing the fence
   trips the fence. Only whole-line comments are removed, and deliberately not
   trailing ones: stripping from the first `//` on a line would also cut
   "https://..." out of a real call and turn a genuine offender invisible. A
   false positive costs a line on a list; a false negative costs the point of
   the test. */
function stripCommentLines(source) {
  return source
    .split("\n")
    .filter((line) => {
      const t = line.trim();
      return !(t.startsWith("//") || t.startsWith("*") || t.startsWith("/*"));
    })
    .join("\n");
}

const reachesNetwork = (source) => NETWORK_TOKENS.some((re) => re.test(stripCommentLines(source)));
const usesChokepoint = (source) => source.includes("lib/outbound-fetch.mjs");

test("fence: the scan actually found the source tree", () => {
  // A regex that matches nothing would make every assertion below vacuously
  // pass. This is the canary for that.
  assert.ok(FILES.length > 300, `only scanned ${FILES.length} files — the walk is broken`);
  assert.ok(
    FILES.some((f) => f.path === CHOKEPOINT),
    "the chokepoint itself was not found — the paths in this test are wrong"
  );
  assert.ok(
    FILES.filter((f) => reachesNetwork(f.source)).length > 5,
    "no network-capable modules detected — the token list has stopped matching"
  );
});

test("fence: nothing reaches the network except through src/lib/outbound-fetch.mjs", () => {
  const offenders = FILES
    .filter((f) => f.path !== CHOKEPOINT)
    .filter((f) => reachesNetwork(f.source))
    .filter((f) => !usesChokepoint(f.source))
    .filter((f) => !Object.prototype.hasOwnProperty.call(ALLOWED_RAW_FETCH, f.path))
    .map((f) => f.path);

  assert.deepEqual(offenders, [],
    `These modules can make an outbound call without going through the fence:\n` +
    offenders.map((p) => `  - ${p}`).join("\n") +
    `\n\nRoute them through transmit()/postJsonTo() in ${CHOKEPOINT} with a declared ` +
    `fence, or — only if they cannot reach a client or change a vendor record — add ` +
    `them to ALLOWED_RAW_FETCH in this file with the reason.`);
});

test("fence: no ALLOWED_RAW_FETCH entry is stale", () => {
  // A list nobody prunes stops being a set of decisions and becomes a place to
  // hide things. Same guard as ALLOWED_UNROUTED in src/http/routes.test.mjs.
  const byPath = new Map(FILES.map((f) => [f.path, f]));
  for (const [path, reason] of Object.entries(ALLOWED_RAW_FETCH)) {
    const file = byPath.get(path);
    assert.ok(file, `ALLOWED_RAW_FETCH names "${path}", which no longer exists. Remove it.`);
    assert.ok(reason && reason.length > 20, `"${path}" needs a real written reason.`);
    assert.ok(
      reachesNetwork(file.source),
      `"${path}" is on ALLOWED_RAW_FETCH but no longer makes an outbound call. Remove it.`
    );
  }
});

test("fence: only the pinned modules may declare themselves INTERNAL", () => {
  // INTERNAL is the one category the flags do not hold. It has to be small and
  // it has to be a list somebody signed off on, or it becomes the way around
  // the fence.
  const declared = FILES
    .filter((f) => f.path !== CHOKEPOINT)
    .filter((f) => /\bfence:\s*INTERNAL\b/.test(f.source))
    .map((f) => f.path)
    .sort();

  assert.deepEqual(declared, [...INTERNAL_CALLERS].sort(),
    "The set of modules claiming fence: INTERNAL changed. INTERNAL skips the " +
    "dry-run flags, so a new one is a decision, not a detail. If it can reach a " +
    "client or change a vendor record it must use MESSAGING or ADAPTERS instead.");
});

test("fence: every messaging provider that transmits routes through the chokepoint", () => {
  // The specific regression that started this: a provider that sends without a
  // fence. Asserted directly rather than inferred from the sweep above.
  const providers = FILES.filter((f) =>
    f.path.startsWith("src/messaging/providers/") && !f.path.endsWith("index.mjs"));

  for (const p of providers) {
    if (!/TRANSMITS\s*=\s*true/.test(p.source) && !/sendLetter/.test(p.source)) continue;
    assert.ok(
      p.source.includes("postJson") || usesChokepoint(p.source),
      `${p.path} declares it transmits but does not go through the fenced HTTP helper.`
    );
  }
});
