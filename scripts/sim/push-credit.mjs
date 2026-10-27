#!/usr/bin/env node
// scripts/sim/push-credit.mjs — put a simulated credit file on an EXISTING client.
//
//   DATABASE_URL=… INNGEST_EVENT_KEY=… node scripts/sim/push-credit.mjs \
//     --email stanbridgejchris+sim-01@gmail.com --profile fundable [--dry]
//   --business-scenario two_clean adds fictional Experian Business reports and
//   matched business rows, only for a +sim address on a local scratch database.
//   --crm-only is the narrow exception for an existing, linked Simulated Buyer
//   on production: it saves sample credit and calls only the two local CRM handlers.
//   It never reads the owner's identity file, emits the bus, or builds a pack.
//   The normal non-dry path emits events that may build a document pack; use
//   --dry for inspection. No bureau request is made by this script.
//
// For the manual walkthrough (ops/workflows/manual-walkthrough-SOP.md). Chris
// opts a simulated client in through ClickFunnels; this puts the credit report
// behind that client WITHOUT touching the bureau — no CRS call, no $32, no
// inquiry on anyone's file. Everything downstream of a real pull still runs:
// the crs_results row, tradelines, card liabilities, the REAL tier engine, and
// the two events (analysis.completed, decision.rendered) that move the card and
// stamp the tier, exactly as src/finance/crs-pull.mjs does after a vendor call.
//
// The payload is stamped `environment: "simulated"` + `simulated: true`, the
// same marks src/demo/simulate-client.mjs and crs-pull's rehearsal mode use, so
// every screen and event can tell it was never a bureau pull. Each bureau report
// says it again in its own `responseDetail.requestingParty`, so a per-bureau view
// that never sees the top level still cannot mistake this for a bureau pull. The
// client row is NOT flagged is_demo — these clients must show on every dashboard
// like a real one, because that is what is being tested.
//
// Profiles are shaped for the path being walked (see PROFILES). The tier engine
// decides the outcome; nothing here forces a tier.
//
// ── THE TWO THINGS A REAL PULL LEAVES BEHIND (fixed 2026-09-18, hole N10) ──
//
// 1. AN IDENTITY ROW. A real pull cannot happen without one: the soft-pull form
//    (api/soft-pull-approve.mjs) saves SSN, date of birth and home address to
//    pii_identity first, and the pull reads them back from there. This tool used
//    to send the sim address to the "bureau" and save nothing, so Combo and
//    Sim Thirteen had a pull with an address on it and a Repair desk saying "no
//    address on file". It now saves the same three fields the form saves, in the
//    form's own shape, with the same values the pull carries (the never-issued
//    SIM_SSN below, the identity file's date of birth and address — measured
//    2026-09-18: that is exactly what the form holds for Sims #8 to #12). It only
//    FILLS what is missing. A row that already holds a value keeps it.
//
// 2. THE UNDERWRITEIQ PACK. On a funding result, analysis.completed runs C-06 in
//    this process (src/handlers/crs-deliverables.mjs), which saves the pack to
//    the document store. From the laptop that store cannot be opened (no Netlify
//    site id or token), C-06 caught the error, and the run printed success with
//    no pack saved. Now a funding run checks the store BEFORE writing anything and
//    stops loudly if it cannot be reached, and checks AFTER the events that the
//    pack really was saved, exiting non-zero if it was not.
//
// ── WHAT THE 2026-09-05 REBUILD CHANGED, AND WHY ──────────────────────────
//
// The old profiles were invented. They wrote the tradeline and score sections
// and left everything else empty, so whole halves of the system had never once
// run against them. The sections below are now shaped off the REAL vendor
// payloads — vendor/underwriteiq-crs/sandbox/{efx,exp}.json and
// vendor/underwriteiq-full/api/lite/crs/sandbox/tu.json — field for field:
//
//   * PERSONAL INFORMATION. `creditFiles[].aliases / addresses / employments /
//     dobs / ssns` were all empty arrays. That is the single source of name and
//     address variants anywhere in this system, so the owner's rule (2026-09-03:
//     credit repair ALWAYS consolidates to one legal name and one current
//     address and disputes every inquiry with no matching open account) could
//     never fire, on any profile, ever. It is now populated on all three files —
//     including the clean one, because the rule says even a clean file gets the
//     cleanup.
//   * responseDetail. Missing entirely, so `bureaus[].reportDate` was never set
//     and every month-age calculation in the engine — anchor seasoning, the 6-
//     and 12-month inquiry windows, report freshness — silently measured against
//     the wall clock instead of against the file.
//   * adverseRatings. The collections counter reads
//     `adverseRatings.highest.type === "CollectionOrChargeOff"`, NOT
//     currentRatingType (derive-consumer-signals.js). The old sim wrote the
//     rating type and no adverseRatings at all, so `derogatories.collections`
//     was 0 on every profile and the ACTIVE_COLLECTION reason code had never
//     been emitted once. The collection lines below carry a real month-by-month
//     adverse history, which is also the only date-of-first-delinquency the
//     system ever gets (normalize-soft-pull.js inferDofd).
//   * SCORES. One bare FICO row per bureau with no factors. Real responses ship
//     non-credit models in the same array (Experian's Income Insight, TU's
//     CreditVision Income Estimator) and TU returns its FICO row twice, which is
//     the whole reason pickCreditScore and the FICO whitelist exist. Both now
//     get exercised.
//   * INQUIRIES. Hardcoded subscriberCode "SIM", never duplicated, always from a
//     creditor already on the file. Each profile now carries a same-day duplicate
//     pair on Equifax (the real EQ quirk, and the one inquiry rule that can fire
//     from payload data alone — M2-036) and at least one inquiry from a creditor
//     with no account anywhere on the file.
//
// Everything the profiles assert about the owner's own identity — his legal
// name, his date of birth, his current address, the addresses he actually lived
// at before — is READ AT RUN TIME from credentials/sim-identity/owner-identity.local.json.
// None of it is written into this file. See loadOwnerIdentity below.

import { readFileSync } from "node:fs";
import { pool, close } from "../../src/db.mjs";
import { withTransaction } from "../../src/db/with-transaction.mjs";
import { resolveDefaultOrg } from "../../src/auth/org.mjs";
import { ensureRegistered } from "../../src/register-all.mjs";
import { emit } from "../../src/events/bus.mjs";
import { ingestCrsResult } from "../../src/tradelines/store.mjs";
import { ingestCrsLiabilities } from "../../src/liabilities/store.mjs";
import { mergeCustomFields } from "../../src/workflows/custom-fields.mjs";
import { runTierEngineFromCrsResult } from "../../src/finance/crs-tier.mjs";
import { scoreBuyerTotal } from "../../src/finance/crs-pull.mjs";
import { newInquiriesFor } from "../../src/finance/crs-map.mjs";
import { storeIdentity, encryptSsn } from "../../src/pii/index.mjs";
import { isFundingPath } from "../../src/config/product-path.mjs";
import { providerFromEnv } from "../../src/documents/store.mjs";
import { isLocalScratchDatabaseUrl } from "../../src/verification/scratch-guard.mjs";
import { onAnalysisCompleted, onDecisionRendered } from "../../src/handlers/client-lifecycle.mjs";
import { BUSINESS_SCENARIOS, buildBusinessScenario } from "./crs-scenarios.mjs";

const BUREAU_NAME = { EX: "Experian", EQ: "Equifax", TU: "TransUnion" };
const ALL_BUREAUS = Object.freeze(["EX", "EQ", "TU"]);

const SIM_NOTICE = "SIMULATED — fulfillment walkthrough. Not a bureau pull.";

/* ───────────────────────────────────────────────────────────────────────────
   THE OWNER'S IDENTITY — READ AT RUN TIME, NEVER WRITTEN DOWN HERE
   ───────────────────────────────────────────────────────────────────────────

   These three files are Chris's own. The name variants and the former addresses
   the cleanup rule is supposed to find are only worth anything if they are
   variants of HIS name and HIS real prior addresses — a made-up address teaches
   nothing about whether the rule works.

   So the script reads them from credentials/sim-identity/owner-identity.local.json
   at run time. credentials/ is gitignored (.gitignore:14). Nothing in this file
   is his real date of birth, his real home address or his real Social Security
   number, and nothing that runs from this file writes his real SSN anywhere —
   see SIM_SSN below for what goes in its place and why. */
const IDENTITY_FILE = new URL(
  "../../credentials/sim-identity/owner-identity.local.json",
  import.meta.url
);

export function loadOwnerIdentity(url = IDENTITY_FILE) {
  let raw;
  try {
    raw = readFileSync(url, "utf8");
  } catch {
    throw new Error(
      "identity file not found: credentials/sim-identity/owner-identity.local.json — " +
      "the simulated files are built from the owner's own name and prior addresses, so it is required"
    );
  }
  const id = JSON.parse(raw);
  const missing = ["legal_first_name", "legal_last_name", "current_address"]
    .filter((k) => !id[k]);
  if (missing.length) throw new Error(`identity file is missing ${missing.join(", ")}`);
  if (!id.current_address.line1 || !id.current_address.postal_code) {
    throw new Error("identity file current_address needs line1 and postal_code");
  }
  return {
    first: String(id.legal_first_name).trim(),
    middle: id.legal_middle_name ? String(id.legal_middle_name).trim() : null,
    last: String(id.legal_last_name).trim(),
    dob: id.dob ? String(id.dob).slice(0, 10) : null,
    current: id.current_address,
    priors: Array.isArray(id.known_prior_addresses) ? id.known_prior_addresses : [],
    /* The identity file records no employer today. If one is ever added it is
       used; until then the employer half of the cleanup uses the simulated
       names below, the same way the creditor names are simulated. */
    employer: id.employer ? String(id.employer).trim() : null
  };
}

/* THE SSN ON THE SIMULATED FILE IS NOT HIS.

   `creditFiles[].ssns` is where a mixed file shows itself — two different Social
   Security numbers on one credit file is the strongest mixed-file signal there
   is, and the deliverable prints it as "SSN Variations". Chris's real number
   could be read at run time exactly like his name is. It is deliberately NOT,
   because unlike a name this payload lands in `crs_results.result`, which is a
   plain JSON column, and it is printed into PDFs. This repo keeps full Social
   Security numbers in `pii_identity`, encrypted, precisely so that no second
   plaintext copy exists anywhere (src/finance/crs-map.mjs redactRequestEcho says
   the same thing about the bureau's own echo).

   These two are sandbox-pattern numbers. The Social Security Administration has
   never issued a number beginning 666 and never will, which is why the vendor's
   own sandbox files use one. They cannot collide with a real person. */
const SIM_SSN = "666154480";
const SIM_SSN_VARIANT = "666145480"; // two digits transposed — the classic keying error

/* The employer pair is the HAEMONETICS / HARMONETICS case out of the Experian
   sandbox: one employer, reported twice, spelled two ways. It is simulated for
   the same reason the creditor names are — the identity file records no employer. */
const SIM_EMPLOYER = "STANBRIDGE CAPITAL GROUP";
const SIM_EMPLOYER_MISSPELLED = "STANBRIDGE CAPTIAL GROUP";

// The CRM-only call uses this invented person, never the owner's identity file.
export const SIMULATED_BUYER_IDENTITY = Object.freeze({
  first: "Simulated", middle: null, last: "Buyer", dob: "1990-01-01",
  current: { line1: "100 Simulation Way", city: "Phoenix", state: "AZ", postal_code: "85004" },
  priors: [], employer: "SIMULATION SUPPLY CO"
});

/* ── Dates ─────────────────────────────────────────────────────────────────
   Every date on the file is derived from the pull date rather than typed as a
   literal year. A hardcoded "2019-04-12" is right for one afternoon: the anchor
   seasoning test (open at least 24 months), the 6- and 12-month inquiry windows
   and the stale-address rule all measure a gap against the report date, and a
   file replayed a year later would quietly land in a different tier. */
function isoDay(value) {
  return String(value).slice(0, 10);
}

function daysBefore(iso, n) {
  const d = new Date(`${isoDay(iso)}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

function monthsBefore(iso, n, { firstOfMonth = false } = {}) {
  const d = new Date(`${isoDay(iso)}T00:00:00Z`);
  if (firstOfMonth) d.setUTCDate(1);
  else d.setUTCDate(Math.min(d.getUTCDate(), 28)); // never roll a 31st into the next month
  d.setUTCMonth(d.getUTCMonth() - n);
  return d.toISOString().slice(0, 10);
}

/* ── Name variants ─────────────────────────────────────────────────────────

   REBUILD HAZARD, AND THE REASON THE LEGAL NAME COMES FIRST. The identity gate
   passed on the old profiles only because `aliases` was empty — checkNameMatch
   returns ok with the warning NO_NAMES_ON_FILE when there are no names to
   compare (identity-fraud-gate.js:62-73). The moment aliases exist, the name
   submitted with the pull must match one of them on first + last or the gate
   returns MANUAL_REVIEW, OUTCOME_MODIFIER.MANUAL_REVIEW is 0, and the whole
   pre-approval collapses to $0.

   So the SUBMITTED name (the clients row) is always the first alias on every
   bureau, and the variants sit alongside it. They never replace it. */
function nameParts(full) {
  const bits = String(full || "").trim().split(/\s+/).filter(Boolean);
  if (bits.length === 0) return null;
  if (bits.length === 1) return { first: bits[0], middle: null, last: "" };
  return { first: bits[0], middle: bits.length > 2 ? bits.slice(1, -1).join(" ") : null, last: bits[bits.length - 1] };
}

function alias({ first, middle, last }) {
  return {
    firstName: String(first || "").toUpperCase(),
    middleName: middle ? String(middle).toUpperCase() : null,
    lastName: String(last || "").toUpperCase()
  };
}

function sameFirstLast(a, b) {
  return a && b
    && String(a.first).toUpperCase() === String(b.first).toUpperCase()
    && String(a.last).toUpperCase() === String(b.last).toUpperCase();
}

/**
 * The names on one bureau's file.
 *
 * `legal` is the consolidation target — what the cleanup letter asks the bureau
 * to keep. `middleInitial` is the same person with the middle name shortened:
 * the deliverable counts it as a name variation (that is what a real file looks
 * like) but the Metro 2 rule deliberately ignores a dropped initial, because
 * "CHRIS J STANBRIDGE" and "CHRIS JACKSON STANBRIDGE" are one person and a check
 * that called that a mixed file would fire on most files in the country
 * (src/metro2/checks/personal-info.mjs sameName). `keyingError` is the one that
 * is genuinely wrong — a surname a letter short — and it is the real dispute
 * target. It sits on ONE bureau, because that is how a keying error travels.
 */
function namesFor(code, identity, submitted, plan) {
  const legal = { first: identity.first, middle: identity.middle, last: identity.last };
  const names = [];
  if (submitted) names.push(alias(submitted));
  if (!submitted || !sameFirstLast(submitted, legal)) names.push(alias(legal));
  if (plan.middleInitialOn.includes(code) && identity.middle) {
    names.push(alias({ first: identity.first, middle: identity.middle.slice(0, 1), last: identity.last }));
  }
  if (plan.keyingErrorOn === code && identity.last.length > 3) {
    names.push(alias({ first: identity.first, middle: null, last: identity.last.slice(0, -1) }));
  }
  return names;
}

/* ── Addresses ─────────────────────────────────────────────────────────────

   SECOND REBUILD HAZARD. checkAddressConflicts compares the FIRST address of
   each bureau by ZIP and reports ADDRESS_CONFLICT when two bureaus disagree.
   That is not fatal — it passes with reduced confidence — but it is noise on a
   file that has none, so the current address leads every bureau's list and the
   former addresses follow it. `borrowerResidencyType: "Current"` is the vendor's
   own current/former marker and it appears ONLY on the current one, exactly as
   in exp.json: an address without it is a former address, and that absence is
   what M2-031 keys on.

   THIRD HAZARD, the quiet one. src/metro2/diy/package.mjs dropCurrentStreet
   throws away any personal-information claim whose subject starts with the
   client's own current street. Both sides come from this one identity file, so
   they match — but if the client's stored address is ever edited by hand to
   something else, the cleanup letter will start disputing the address the
   client actually lives at. */
function addressRecord(a, { current = false, reportedOn }) {
  const rec = {
    addressLine1: String(a.line1).toUpperCase(),
    city: String(a.city || "").toUpperCase(),
    state: String(a.state || "").toUpperCase(),
    postalCode: String(a.postal_code || ""),
    dateReported: reportedOn
  };
  if (a.line2) rec.addressLine2 = String(a.line2).toUpperCase();
  if (current) return { borrowerResidencyType: "Current", ...rec };
  return rec;
}

function addressesFor(code, identity, plan, asOf) {
  const out = [addressRecord(identity.current, { current: true, reportedOn: monthsBefore(asOf, 1) })];
  const wanted = plan.formerAddressesOn[code] || [];
  for (const i of wanted) {
    const prior = identity.priors[i] ?? identity.priors[0];
    if (!prior) continue;
    /* Reported well over the two reporting cycles M2-031 allows, so the rule has
       something real to find. The gap is measured from the report date, so it
       stays true whenever this is re-run. */
    out.push(addressRecord(prior, { reportedOn: monthsBefore(asOf, 14 + i * 12) }));
  }
  return out;
}

function employmentsFor(code, identity, plan, asOf) {
  const wanted = plan.employersOn[code] || [];
  const primary = identity.employer || SIM_EMPLOYER;
  const misspelled = identity.employer ? `${identity.employer} INC` : SIM_EMPLOYER_MISSPELLED;
  const rows = [];
  if (wanted.includes("primary")) {
    rows.push({
      employerName: primary.toUpperCase(),
      employmentStatusType: "Current",
      employmentStartDate: monthsBefore(asOf, 61, { firstOfMonth: true }),
      employmentReportedDate: monthsBefore(asOf, 4, { firstOfMonth: true })
    });
  }
  if (wanted.includes("misspelled")) {
    rows.push({
      employerName: misspelled.toUpperCase(),
      employmentStartDate: monthsBefore(asOf, 60, { firstOfMonth: true }),
      employmentReportedDate: monthsBefore(asOf, 58, { firstOfMonth: true })
    });
  }
  return rows;
}

/* One personal-information plan, shared by all three profiles. The owner's rule
   is that the cleanup happens on EVERY file — the clean one included — so there
   is no reason for the fundable file to carry a thinner personal section than
   the damaged ones. Only the SSN variant differs, and that is a per-profile
   flag: a mixed file is a symptom of a long, messy credit history, not of a
   clean one. */
const PERSONAL_PLAN = Object.freeze({
  middleInitialOn: ["EQ", "TU"],
  keyingErrorOn: "EX",
  formerAddressesOn: { EX: [0, 1], EQ: [0], TU: [1] },
  /* Equifax is the only bureau whose sandbox response carries a date of birth;
     Experian and TransUnion omit the key entirely. Copying that is what makes
     the deliverable's "DOB on file for 1 bureau(s)" row real rather than a
     rounding of three identical values. */
  dobOn: ["EQ"],
  employersOn: { EX: ["primary", "misspelled"], EQ: ["primary"], TU: [] }
});

/* ── Accounts ──────────────────────────────────────────────────────────────

   One account, in the VENDOR's field names (the three sandbox files are the
   reference) plus the handful of repo spellings the tradeline and liability
   ingests read (src/tradelines/index.mjs, src/liabilities/index.mjs).

   The two halves are kept APART on purpose. `vendor` is the only thing that goes
   inside a bureau report, so a bureau report now contains nothing a real bureau
   report would not contain — the old sim pushed five invented keys and a
   `bureaus` array into the middle of the vendor payload. `repo` is added only on
   the flat top-level list, which is the only thing the ingests read. */
const RATING = {
  current: {
    currentRatingType: "AsAgreed", currentRatingCode: "C", derogatoryDataIndicator: false,
    _30: "0", _60: "0", _90: "0", pastDue: "0",
    pattern: "CCCCCCCCCCCCCCCCCCCCCCCC", paymentStatus: "current"
  },
  late30: {
    currentRatingType: "Late30Days", currentRatingCode: "1", derogatoryDataIndicator: true,
    _30: "2", _60: "0", _90: "0", pastDue: "185",
    pattern: "1CC1CCCCCCCCCCCCCCCCCCCC", paymentStatus: "30 days late",
    adverse: { type: "Late30Days", code: "1", months: 4 }
  },
  collection: {
    currentRatingType: "CollectionOrChargeOff", currentRatingCode: "9", derogatoryDataIndicator: true,
    _30: "0", _60: "0", _90: "0", pastDue: "0",
    pattern: "999999999999", paymentStatus: "collection",
    /* THIS is what makes the file a collection as far as the engine is
       concerned. derive-consumer-signals.js counts collections off
       adverseRatings.highest.type — never off currentRatingType — so the old
       profiles reported zero collections while showing two on screen. */
    adverse: { type: "CollectionOrChargeOff", code: "9", months: 12 }
  },
  chargeoff: {
    currentRatingType: "ChargeOff", currentRatingCode: "9", derogatoryDataIndicator: true,
    _30: "1", _60: "1", _90: "3", pastDue: "0",
    pattern: "9999999321CCCCCCCCCCCCCC", paymentStatus: "charge-off",
    adverse: { type: "ChargeOff", code: "9", months: 9 }
  }
};

/* accountType is the vendor's enum and it decides everything downstream:
   Revolving is the only thing counted in card utilisation, Open is what the
   vendor uses for a collection, Installment for a loan. */
const VENDOR_TYPE = {
  revolving: { accountType: "Revolving", loanType: "CreditCard", businessType: "Banking" },
  installment: { accountType: "Installment", loanType: "Automobile", businessType: "Automotive" },
  /* loanType "CollectionAgencyAttorney" is the vendor's own value and it is what
     src/metro2/diy/derogatory.mjs matches on to raise a DEROG-COLLECTION claim.
     businessType "Collection" is belt and braces — the same regex reads both
     fields, and losing the collection claim would empty the repair walk. */
  collection: { accountType: "Open", loanType: "CollectionAgencyAttorney", businessType: "Collection" }
};

/**
 * A month-by-month adverse history, newest first, exactly as Equifax returns it.
 *
 * This is not decoration. It is the collections counter (above), it is the only
 * date of first delinquency the system ever sees (normalize-soft-pull.js
 * inferDofd walks these dates), and it is what a dispute letter cites when it
 * says how long an item has been reported.
 */
function adverseRatings({ type, code, months }, asOf) {
  const prior = [];
  for (let i = 0; i < months; i++) {
    prior.push({
      priorAdverseRatingDate: monthsBefore(asOf, i, { firstOfMonth: true }),
      priorAdverseRatingCode: code,
      priorAdverseRatingType: type
    });
  }
  const oldest = prior[prior.length - 1];
  const newest = prior[0];
  return {
    highestAdverseRatingDate: oldest.priorAdverseRatingDate,
    highestAdverseRatingCode: code,
    highestAdverseRatingType: type,
    mostRecentAdverseRatingDate: newest.priorAdverseRatingDate,
    mostRecentAdverseRatingCode: code,
    mostRecentAdverseRatingType: type,
    priorAdverseRatings: prior
  };
}

/* Account identifiers carry FOUR digits at the end on purpose. The system reads
   the last four DIGITS off this string (src/metro2/normalize.mjs lastFour), and
   the old "SIM-MCM-001" endings held only three, so every simulated account had
   no account number at all: letters could not say "ending 1234", cross-bureau
   matching (creditor + last four) could never fire, and a bureau's written reply
   could not be matched back to the account it was about. The endings are also
   distinct from each other, so two accounts never collapse into one.

   The SAME identifier is used on every bureau that furnishes the account. That
   is what lets anything downstream recognise three bureau rows as one account —
   see the note on F43 in buildPayload. */
function buildLine(spec, asOf) {
  const r = RATING[spec.status || "current"];
  const t = VENDOR_TYPE[spec.kind];
  const opened = monthsBefore(asOf, spec.openedMonthsAgo);
  const closed = spec.closedMonthsAgo != null ? monthsBefore(asOf, spec.closedMonthsAgo) : null;
  /* See the note on accountReportedDate below. Fresh by default; stale only when
     a line asks, and only lines that carry no derogatory claim ask. */
  const reported = spec.reportedMonthsAgo != null
    ? monthsBefore(asOf, spec.reportedMonthsAgo)
    : daysBefore(asOf, 6);
  const limit = spec.limit ?? null;
  const high = spec.high ?? (limit != null ? Math.max(limit, spec.balance) : spec.balance);

  const vendor = {
    creditorName: spec.creditor,
    accountIdentifier: spec.ref,
    subscriberCode: spec.sub,
    // sourceType is stamped per bureau in bureauReport — one account, three copies.
    borrowerSourceType: "Borrower",
    accountType: t.accountType,
    loanType: t.loanType,
    businessType: t.businessType,
    accountOwnershipType: "Individual",
    accountStatusType: closed ? "Closed" : "Open",
    accountOpenedDate: opened,
    /* A LIVE ACCOUNT IS REPORTED WITHIN THE LAST MONTH. A furnisher is required
       to update monthly, and M2-005 raises a claim on any account whose reported
       date is more than 30 days before the report date. Dating every account to
       the first of last month made all of them stale, which put a stale-data
       claim on every line of the CLEAN file — a letter arguing that four
       perfectly-reported accounts are out of date. Six days back is what an
       account that is actually being furnished looks like.

       A CLOSED ACCOUNT IS REPORTED TOO, AND THAT MATTERS MORE THAN IT LOOKS.
       This used to be `closed || daysBefore(asOf, 6)` — a closed account carried
       its own close date as its reported date — on the reasoning that a furnisher
       stops updating a dead account. That reasoning is wrong twice over.

       Wrong on the facts: a charged-off balance is still furnished every month
       until it is sold or paid, and the real vendor payload agrees. In
       vendor/underwriteiq-crs/sandbox/efx.json the charged-off row is reported
       2025-08-01 with last activity 2024-04-01, and the closed HOLIDAY FINANCE
       row is reported 2025-07-01 against a close date of 2025-03-01. Reported
       date AFTER close date, on both.

       Wrong on the consequences, which is the expensive half: an old reported
       date fires M2-005 on that account, and mergeDerogatoryClaims
       (src/metro2/diy/derogatory.mjs) DROPS any DEROG-* claim whose creditor and
       last four are already covered by a Metro 2 violation. So the stale-date
       finding silently ate the charge-off dispute. The client's letter argued
       "this account has not been updated" instead of "I dispute this charged-off
       account", on every bureau of both repair files — and on repair-trial's
       Equifax copy the charge-off is the ONLY negative, so that bureau produced
       no derogatory claim at all.

       So the reported date is fresh unless a line ASKS to be stale, via
       `reportedMonthsAgo`. Only accounts with nothing else to dispute ask for it
       (see CREDIT ONE BANK and WELLS FARGO CARD below), which is how the walk
       keeps an M2-005 finding to look at without that finding swallowing a
       dispute that matters more.

       `lastActivityDate` is a different field and it keeps the close date. Date
       of last activity on a dead account really is old, no Metro 2 rule reads it
       (only accountReportedDate maps to field 24 — src/metro2/normalize.mjs:197),
       and the sandbox rows above show exactly this split. */
    accountReportedDate: reported,
    lastActivityDate: closed || daysBefore(asOf, 6),
    monthsReviewedCount: String(Math.min(spec.openedMonthsAgo, 84)),
    derogatoryDataIndicator: r.derogatoryDataIndicator,
    currentRatingType: r.currentRatingType,
    currentRatingCode: r.currentRatingCode,
    currentBalanceAmount: String(spec.balance),
    highBalanceAmount: String(high),
    pastDueAmount: r.pastDue,
    _30DayLates: r._30, _60DayLates: r._60, _90DayLates: r._90,
    paymentPatternData: r.pattern,
    /* The payment pattern's most recent month is the month the account was last
       reported, so this tracks accountReportedDate rather than the close date. */
    paymentPatternStartDate: reported
  };
  /* An installment loan has a payment and a term, not a credit line. Real
     Equifax rows come back with these money fields simply MISSING rather than
     zero, and a missing limit is what stops a car loan being counted as a credit
     line in the utilisation sum. */
  if (limit != null) vendor.creditLimitAmount = String(limit);
  if (spec.monthlyPayment != null) vendor.monthlyPaymentAmount = String(spec.monthlyPayment);
  if (spec.termMonths != null) {
    vendor.termsMonthsCount = String(spec.termMonths);
    vendor.termsDescription = `${spec.termMonths} months at $${spec.monthlyPayment} per month`;
  }
  if (closed) {
    vendor.accountClosedDate = closed;
    if (spec.status === "chargeoff") vendor.chargeOffAmount = String(spec.balance);
  }
  if (r.adverse) vendor.adverseRatings = adverseRatings(r.adverse, monthsBefore(asOf, 1, { firstOfMonth: true }));
  if (spec.comment) {
    vendor.comments = [{
      commentCode: spec.comment.code,
      commentSourceType: "CreditBureau",
      commentType: "BureauRemarks",
      commentText: spec.comment.text
    }];
  }

  return {
    furnishesTo: spec.bureaus || ALL_BUREAUS,
    vendor,
    /* The repo spellings. These go on the flat top-level list ONLY — they are not
       vendor fields and have no business inside a bureau report. */
    repo: {
      currentBalance: String(spec.balance),
      apr: String(spec.apr ?? 0),
      account_ref: spec.ref,
      paymentStatus: r.paymentStatus,
      kind: spec.kind
    }
  };
}

/* ── The three files ───────────────────────────────────────────────────────

   Chris is hand-walking three clients through fulfillment. These are their
   credit files. Each one is built to land on a specific tier through the REAL
   engine — nothing here forces an outcome — and the arithmetic that gets it
   there is written out beside it, because a number that drifts by fifty dollars
   silently moves a file into a different tier.

   THE WATERFALL (vendor/underwriteiq-full/api/lite/crs/route-outcome.js, first
   match wins): FRAUD_HOLD → MANUAL_REVIEW → REPAIR_ONLY → FUNDING_PLUS_REPAIR →
   FULL_FUNDING → PREMIUM_STACK. */

/* FUNDABLE. Three seasoned cards and a car loan, nothing late, nothing
   derogatory on any bureau.

   F13 was that no profile could ever reach the top tier: the old `academy` file
   was 762 median with 17% card use against a rule of 10% or less, so it stopped
   one clause short of PREMIUM_STACK every single time and the top tier had never
   been awarded to anything. Every clause is now satisfied, deliberately:

     median 771 ≥ 760                       scores below
     card use 2,750 / 45,000 = 6% ≤ 10      excellent band, which is also the
                                            "excellent or good" clause FULL_FUNDING needs
     revolving anchor 20,000 ≥ 10,000       Chase, opened 88 months ago — the anchor
                                            must be open, primary, non-derogatory and
                                            at least 24 months old
     open primary revolving lines ≥ 3       three cards
     every bureau clean                     no lates, no derogatory indicator anywhere
     not a thin file                        four accounts

   Move any card balance and the card-use clause is the first thing to break. */
const FUNDABLE_LINES = [
  { creditor: "CHASE CARD SERVICES", sub: "190FP02874", kind: "revolving", limit: 20000, balance: 1200, apr: 21.24, ref: "SIM-CHASE-8814", openedMonthsAgo: 88 },
  { creditor: "AMEX", sub: "838FP00105", kind: "revolving", limit: 15000, balance: 850, apr: 18.49, ref: "SIM-AMEX-2007", openedMonthsAgo: 64 },
  { creditor: "CAPITAL ONE", sub: "413FP01212", kind: "revolving", limit: 10000, balance: 700, apr: 22.99, ref: "SIM-CAP1-5163", openedMonthsAgo: 43 },
  { creditor: "TOYOTA MOTOR CREDIT", sub: "621AU00318", kind: "installment", high: 34000, balance: 11200, apr: 5.9, ref: "SIM-TOYO-4490", openedMonthsAgo: 39, monthlyPayment: 612, termMonths: 60 }
];

/* REPAIR-FULL. The six-round programme. Two collections, one charge-off, one
   account 30 days late, high-500s scores.

   REPAIR_ONLY needs BOTH halves and the second half is the one that is easy to
   lose: there must be active negatives AND no bureau may be clean. A collection
   that furnishes to only two bureaus leaves the third clean, and the file drops
   to FUNDING_PLUS_REPAIR — a different tier, a different desk, a different set
   of letters. The Capital One card is 30 days late on ALL THREE bureaus, which
   is what guarantees the third bureau is never clean no matter how the
   collections are distributed:

     Experian    late 30 · Midland collection · Synchrony charge-off
     Equifax     late 30 · Portfolio collection · Synchrony charge-off
     TransUnion  late 30 · Midland collection · Portfolio collection

   Collections furnishing to two bureaus rather than three is not a shortcut —
   a debt buyer furnishes to the bureaus it has a contract with, and the letters
   for each bureau differ because of it. */
const REPAIR_FULL_LINES = [
  { creditor: "CAPITAL ONE", sub: "413FP01212", kind: "revolving", limit: 3000, balance: 2870, apr: 29.99, ref: "SIM-CAP1-7729", openedMonthsAgo: 54, status: "late30" },
  /* THE STALE-DATE ACCOUNT. `reportedMonthsAgo: 4` is deliberate: it is the only
     thing on this file that fires M2-005, so the walk still shows a stale-data
     letter. It sits on an account that is CURRENT and carries no derogatory
     claim of its own, because a Metro 2 violation suppresses the DEROG-* claim
     on the same account (mergeDerogatoryClaims) — put it on the charge-off and
     it eats the charge-off dispute, which is exactly what used to happen. */
  { creditor: "CREDIT ONE BANK", sub: "247FP08830", kind: "revolving", limit: 1500, balance: 1490, apr: 31.49, ref: "SIM-CRED1-3018", openedMonthsAgo: 36, reportedMonthsAgo: 4 },
  { creditor: "MIDLAND CREDIT MGMT", sub: "512VS00471", kind: "collection", balance: 1840, ref: "SIM-MCM-6642", openedMonthsAgo: 19, status: "collection", bureaus: ["EX", "TU"], comment: { code: "CZ", text: "PLACED FOR COLLECTION" } },
  { creditor: "PORTFOLIO RECOVERY", sub: "512VS00902", kind: "collection", balance: 960, ref: "SIM-PRA-9075", openedMonthsAgo: 14, status: "collection", bureaus: ["EQ", "TU"], comment: { code: "CZ", text: "PLACED FOR COLLECTION" } },
  /* A charged-off card is normally reported CLOSED. Keeping it closed is what
     stops a maxed, dead account being counted in the live card-use figure — the
     utilisation sum reads open primary revolving lines only — while the
     charge-off itself is still counted, because that counter walks every
     tradeline regardless of status. */
  { creditor: "SYNCB/CARE CREDIT", sub: "108FP04455", kind: "revolving", limit: 2500, balance: 2500, apr: 26.99, ref: "SIM-SYNC-1256", openedMonthsAgo: 70, status: "chargeoff", closedMonthsAgo: 8, bureaus: ["EX", "EQ"], comment: { code: "AV", text: "CHARGED OFF ACCOUNT" } }
];

/* REPAIR-TRIAL. The two-round test run, and the upsell after it. Lighter damage
   — one collection and one charge-off, no 30-day lates — and low-600s scores.

   It still has to land REPAIR_ONLY, because that is the tier the enrolment
   script expects for both repair paths (scripts/sim/seed-fulfillment-client.mjs)
   and it is the second of the two gates that switches derogatory-item claims on
   (src/repair/analyze.mjs onRepairPath). So again: no bureau clean.

     Experian    LVNV collection
     Equifax     Comenity charge-off
     TransUnion  LVNV collection · Comenity charge-off */
const REPAIR_TRIAL_LINES = [
  { creditor: "DISCOVER BANK", sub: "281FP00614", kind: "revolving", limit: 4500, balance: 1350, apr: 24.49, ref: "SIM-DISC-3382", openedMonthsAgo: 46 },
  /* The stale-date account on this file, for the same reason as CREDIT ONE BANK
     on the full programme: current, no derogatory claim of its own, so the
     M2-005 finding it raises cannot swallow one. */
  { creditor: "WELLS FARGO CARD", sub: "155FP07723", kind: "revolving", limit: 2000, balance: 900, apr: 27.24, ref: "SIM-WF-6104", openedMonthsAgo: 31, reportedMonthsAgo: 4 },
  { creditor: "LVNV FUNDING LLC", sub: "512VS00733", kind: "collection", balance: 740, ref: "SIM-LVNV-4417", openedMonthsAgo: 11, status: "collection", bureaus: ["EX", "TU"], comment: { code: "CZ", text: "PLACED FOR COLLECTION" } },
  { creditor: "COMENITY BANK", sub: "744FP02061", kind: "revolving", limit: 1200, balance: 1180, apr: 29.99, ref: "SIM-COMY-2298", openedMonthsAgo: 58, status: "chargeoff", closedMonthsAgo: 5, bureaus: ["EQ", "TU"], comment: { code: "AV", text: "CHARGED OFF ACCOUNT" } }
];

/* ── Inquiries ─────────────────────────────────────────────────────────────

   [creditor, bureau, monthsAgo, businessType, subscriberCode].

   Every profile carries three things the old ones never did:

     1. An inquiry from a creditor with an account ON the file. The creditor
        string is IDENTICAL to a tradeline creditor string on purpose — the rule
        matches the inquiry name against the reported creditor names verbatim,
        so this is the control case that proves a match is possible.
     2. An inquiry from a creditor with NO account anywhere on the file. That is
        the owner's rule — dispute every inquiry with no matching open account —
        and it is what M2-035 looks for.
     3. A same-day duplicate pair on EQUIFAX, same creditor, same subscriber
        code. Equifax really does return the same inquiry twice; the engine
        de-duplicates Equifax inquiries and nothing else, so this exercises that
        path AND gives M2-036 (one application, more than one entry) the only
        inquiry finding it can make from payload data alone. */
const FUNDABLE_INQUIRIES = [
  ["CAPITAL ONE", "EX", 7, "Banking", "413FP01212"],
  ["SYNCB/PAYPAL CREDIT", "EX", 4, "DepartmentAndMailOrder", "108FP09912"],
  ["NAVY FEDERAL CU", "TU", 9, "Banking", "334FP00218"],
  ["CITIBANK NA", "EQ", 2, "Banking", "190ZB04441"],
  ["CITIBANK NA", "EQ", 2, "Banking", "190ZB04441"]
];
const REPAIR_FULL_INQUIRIES = [
  ["CAPITAL ONE", "EX", 6, "Banking", "413FP01212"],
  ["ONEMAIN FINANCIAL", "EQ", 3, "Finance", "662FP01180"],
  ["FIRST PREMIER BANK", "EQ", 2, "Banking", "801ZB03317"],
  ["FIRST PREMIER BANK", "EQ", 2, "Banking", "801ZB03317"],
  ["KROLL FACTUAL DATA", "TU", 5, "Miscellaneous", "999ZB04441"]
];
const REPAIR_TRIAL_INQUIRIES = [
  ["DISCOVER BANK", "TU", 8, "Banking", "281FP00614"],
  ["SANTANDER CONSUMER", "EX", 5, "Automotive", "477AU00693"],
  ["AVANT LLC", "EQ", 3, "Finance", "550FP02284"],
  ["AVANT LLC", "EQ", 3, "Finance", "550FP02284"]
];

/**
 * Scores. Two things here that the old sim never produced.
 *
 * The model name is what decides whether a score counts at all — only three
 * strings are on the FICO whitelist (normalize-soft-pull.js), and each bureau
 * uses a different one. And real responses ship NON-credit models in the same
 * array: Experian returns an Income Insight value in the 30s, TransUnion a
 * CreditVision income estimate whose value is the string "47 B". Both would be
 * read as a credit score by anything that just took the first row, which is
 * exactly why the filter exists — and until now it had never had anything to
 * filter. TransUnion also returns its FICO row twice; that is copied too.
 */
const SCORE_MODEL = {
  TU: { modelName: "FICO® Score 9", modelNameType: "00W18" },
  EX: { modelName: "Experian/Fair Isaac Risk Model V9", modelNameType: "F9" },
  EQ: { modelName: "FICO Score 9", modelNameType: "05206" }
};

const CLEAN_FACTORS = [
  { scoreFactorCode: "14", scoreFactorText: "LENGTH OF TIME ACCOUNTS HAVE BEEN ESTABLISHED" },
  { scoreFactorCode: "10", scoreFactorText: "PROPORTION OF BALANCES TO CREDIT LIMITS IS TOO HIGH ON BANK REVOLVING ACCOUNTS" }
];
const DAMAGED_FACTORS = [
  { scoreFactorCode: "38", scoreFactorText: "SERIOUS DELINQUENCY AND PUBLIC RECORD OR COLLECTION FILED" },
  { scoreFactorCode: "10", scoreFactorText: "RATIO OF BALANCE TO LIMIT ON BANK REVOLVING OR OTHER REV ACCTS TOO HIGH" },
  { scoreFactorCode: "5", scoreFactorText: "TOO MANY ACCOUNTS WITH BALANCES" },
  { scoreFactorCode: "13", scoreFactorText: "TIME SINCE DELINQUENCY IS TOO RECENT OR UNKNOWN" }
];

function scoresFor(code, profile) {
  const model = SCORE_MODEL[code];
  const sourceType = BUREAU_NAME[code];
  const fico = {
    borrowerSourceType: "Borrower",
    modelName: model.modelName,
    modelNameType: model.modelNameType,
    sourceType,
    factaInquiriesIndicator: true,
    scoreValue: String(profile.scores[code]),
    scoreRankPercentileValue: String(profile.percentile[code]),
    scoreMaximumValue: "850",
    scoreMinimumValue: "300",
    scoreFactors: profile.scoreFactors
  };
  const rows = [fico];
  // The decoy models, per bureau, exactly where the real responses put them.
  if (code === "EX") {
    rows.push({
      borrowerSourceType: "Borrower", modelName: "Income Insight", modelNameType: "II",
      sourceType, scoreValue: "37", scoreFactors: []
    });
  }
  if (code === "TU") {
    rows.push({ ...fico }); // TransUnion returns the FICO row twice
    rows.push({
      borrowerSourceType: "Borrower", modelName: "CreditVision Income Estimator", modelNameType: "CVIE",
      sourceType, scoreValue: "47 B", scoreFactors: []
    });
  }
  return rows;
}

export const PROFILES = Object.freeze({
  fundable: {
    note: "Walk 1 — clean file, three seasoned cards, 6% card use. Should reach the top funding tier.",
    scores: { EX: 771, EQ: 778, TU: 766 },
    percentile: { EX: 88, EQ: 90, TU: 86 },
    scoreFactors: CLEAN_FACTORS,
    lineSpecs: FUNDABLE_LINES,
    inquirySpecs: FUNDABLE_INQUIRIES,
    ssnVariant: false,
    businessAgeMonths: 30
  },
  "repair-full": {
    note: "Walk 2 — high-500s, two collections, a charge-off and a 30-day late. Six-round repair.",
    scores: { EX: 541, EQ: 566, TU: 552 },
    percentile: { EX: 8, EQ: 11, TU: 9 },
    scoreFactors: DAMAGED_FACTORS,
    lineSpecs: REPAIR_FULL_LINES,
    inquirySpecs: REPAIR_FULL_INQUIRIES,
    /* Two Social Security numbers on one file. It is the strongest mixed-file
       signal there is and it belongs on the messiest history, not on the clean
       one. Neither number is real — see SIM_SSN. */
    ssnVariant: true,
    businessAgeMonths: 18
  },
  "repair-trial": {
    note: "Walk 3 — low-600s, one collection and one charge-off. Two-round trial, then the upsell.",
    scores: { EX: 604, EQ: 618, TU: 611 },
    percentile: { EX: 22, EQ: 26, TU: 24 },
    scoreFactors: DAMAGED_FACTORS,
    lineSpecs: REPAIR_TRIAL_LINES,
    inquirySpecs: REPAIR_TRIAL_INQUIRIES,
    ssnVariant: false,
    businessAgeMonths: 0
  }
});

/* The old profile names still work. scripts/sim/seed-fulfillment-client.mjs
   prints `--profile funding` and `--profile repair` in the runbook it hands
   Chris, and five walkthrough documents in ops/workflows/ do the same. Renaming
   without an alias would break every one of those commands with a "unknown
   profile" a week after they were written. `blueprint` and `academy` were both
   clean files and both now resolve to the one clean file there is. */
export const PROFILE_ALIASES = Object.freeze({
  funding: "fundable",
  blueprint: "fundable",
  academy: "fundable",
  repair: "repair-full",
  trial: "repair-trial"
});

export function resolveProfileKey(key) {
  const k = String(key || "").trim();
  if (PROFILES[k]) return k;
  if (PROFILE_ALIASES[k]) return PROFILE_ALIASES[k];
  return null;
}

/* ── Building one bureau's report ──────────────────────────────────────────
   The section order is the vendor's own: requestData, repositoryIncluded,
   responseDetail, responseAlertMessages, creditFiles, inquiries, tradelines,
   publicRecords, scores. */
function bureauReport(code, profile, { identity, submitted, lines, inquiries, pulledAt, infileDate }) {
  const sourceType = BUREAU_NAME[code];
  const asOf = infileDate;

  const ssns = [{ ssn: SIM_SSN }];
  if (profile.ssnVariant && code === "EQ") ssns.push({ ssn: SIM_SSN_VARIANT });

  const creditFile = {
    creditFileDetail: {
      borrowerSourceType: "Borrower",
      sourceType,
      creditFileResultStatusType: "FileReturned",
      /* The file date is the day the file was compiled. It was hardcoded to
         2019-01-15 while every account on it reported 2026-08-28 — seven years
         in the FUTURE relative to the file. The stale-reporting rule measures
         the gap between the two, and a negative gap can never fire. It is the
         pull date, so the file is internally consistent, and it is also the
         `asOf` the Metro 2 engine measures every age against
         (src/metro2/diy/from-crs.mjs reportAsOf). */
      creditFileInfileDate: infileDate
    },
    aliases: namesFor(code, identity, submitted, PERSONAL_PLAN),
    ssns,
    addresses: addressesFor(code, identity, PERSONAL_PLAN, asOf),
    employments: employmentsFor(code, identity, PERSONAL_PLAN, asOf)
  };
  /* Only Equifax carries a date of birth, as in the vendor's own responses. The
     key is omitted entirely on the others rather than written as an empty array
     — an empty array is a claim that the bureau holds none, which is different. */
  if (PERSONAL_PLAN.dobOn.includes(code) && identity.dob) {
    creditFile.dobs = [{ dob: identity.dob }];
  }

  return {
    /* The identity echo, already redacted. A real stored pull carries this with
       the Social Security number stripped and only the last four kept
       (src/finance/crs-map.mjs redactRequestEcho). Writing it in that shape
       means a screen reading `requestData` sees the same thing it would see
       after a real pull, and no full number is ever stored. */
    requestData: {
      firstName: submitted.first.toUpperCase(),
      middleName: submitted.middle ? submitted.middle.toUpperCase() : "",
      lastName: submitted.last.toUpperCase(),
      suffix: "",
      birthDate: identity.dob,
      ssnLast4: SIM_SSN.slice(-4),
      ssnRedacted: true,
      addresses: [addressRecord(identity.current, { current: true, reportedOn: monthsBefore(asOf, 1) })]
    },
    repositoryIncluded: { transunion: code === "TU", experian: code === "EX", equifax: code === "EQ" },
    responseDetail: {
      dateRequested: pulledAt,
      requestingParty: { name: `FUNDHUB — ${SIM_NOTICE}` },
      creditBureauContact: {
        name: "CREDIT REPORTING SERVICES, INC",
        address: { addressLine1: "1024 IRON POINT ROAD", city: "FOLSOM", state: "CA", postalCode: "95630" }
      }
    },
    /* No freeze, no fraud alert. Either one forces FRAUD_HOLD before a single
       credit rule runs, and none of these three walks is about that path. */
    responseAlertMessages: [],
    creditFiles: [creditFile],
    inquiries: inquiries.filter((i) => i.bureau === code).map((i) => ({
      creditorName: i.creditorName,
      borrowerSourceType: "Borrower",
      inquiryDate: i.date,
      businessType: i.businessType,
      subscriberCode: i.subscriberCode,
      sourceType
    })),
    /* Only the accounts that actually furnish to THIS bureau, and nothing but
       vendor fields. Copying the whole list into all three made every account
       appear everywhere, which no real damaged file does and which the letter
       engine reads directly. */
    tradelines: lines
      .filter((l) => l.furnishesTo.includes(code))
      .map((l) => ({ ...l.vendor, sourceType })),
    publicRecords: [],
    scores: scoresFor(code, profile)
  };
}

/* Equifax returns the same inquiry twice. The engine de-duplicates Equifax
   inquiries on creditor + date + subscriber code and nothing else, so the
   duplicate is left in the bureau report (that is where the duplicate-inquiry
   rule reads it) and removed from the flat top-level list, which is what the
   inquiry events and the inquiry-remover desk read. Emitting the duplicate there
   too would log the same inquiry against the client twice. */
function dedupeEquifax(rows) {
  const seen = new Set();
  return rows.filter((i) => {
    if (i.bureau !== "EQ") return true;
    const key = `${i.creditorName}|${i.date}|${i.subscriberCode}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function buildPayload(profileKey, { email, name, pulledAt = new Date().toISOString(), identity = null } = {}) {
  const key = resolveProfileKey(profileKey);
  if (!key) throw new Error(`unknown profile ${profileKey}; one of ${Object.keys(PROFILES).join("|")}`);
  const p = PROFILES[key];
  const id = identity || loadOwnerIdentity();
  const infileDate = isoDay(pulledAt);

  /* The submitted name is the one the identity gate compares against the file.
     It comes from the clients row; the identity file is the fallback so a --dry
     run with no client still builds. */
  const submitted = nameParts(name) || { first: id.first, middle: id.middle, last: id.last };

  const lines = p.lineSpecs.map((spec) => buildLine(spec, infileDate));
  const inquiries = p.inquirySpecs.map(([creditorName, bureau, monthsAgo, businessType, subscriberCode]) => ({
    creditorName, bureau, businessType, subscriberCode, date: monthsBefore(infileDate, monthsAgo)
  }));

  const scores = { ex: p.scores.EX, eq: p.scores.EQ, tu: p.scores.TU };

  /* `accountType` is the VENDOR spelling and the vendor capitalises it —
     "Revolving", not "revolving". Matching lower case matched nothing, so the
     stored card-use figure was always 0% and the stored total limit counted the
     car loan as if it were a credit line. Both numbers are read straight onto
     the screen, so both were wrong and flattering.

     Only OPEN cards count. A charged-off card is closed and dead; including it
     would show 97% card use on a file whose live cards are nowhere near that. */
  const isOpenCard = (l) => l.vendor.accountType === "Revolving" && l.vendor.accountStatusType === "Open";
  const bal = lines.filter(isOpenCard).reduce((n, l) => n + Number(l.vendor.currentBalanceAmount || 0), 0);
  const revLimit = lines.filter(isOpenCard).reduce((n, l) => n + Number(l.vendor.creditLimitAmount || 0), 0);
  const utilization = revLimit ? Math.round((bal / revLimit) * 100) : 0;

  return {
    source: "crs",
    product: "prequal-fico9",
    environment: "simulated",
    simulated: true,
    simulatedNotice: SIM_NOTICE,
    pulledAt,
    bureausPulled: ["TU", "EX", "EQ"],
    bureaus_pulled: "TU/EX/EQ",
    scores,
    scoreModels: { ex: SCORE_MODEL.EX.modelName, eq: SCORE_MODEL.EQ.modelName, tu: SCORE_MODEL.TU.modelName },
    /* F43 — THE TRIPLE COUNT, AND WHY IT CANNOT COME BACK HERE.
       Every account was being counted three times in the deliverables: nine card
       rows for three cards, and dollar totals three times what they should have
       been. The mechanism is that a tri-merge pull genuinely carries the same
       account from three bureaus, and a printer that lists them without merging
       prints it three times.

       This list is ONE ROW PER ACCOUNT. It is what the tradeline ingest, the
       card liabilities ingest and the inquiry events read, so nothing that reads
       it can triple anything. The per-bureau reports above keep all three copies,
       because that is what a real file looks like and pretending otherwise would
       make the simulation useless — but every copy carries the SAME
       accountIdentifier, so anything that wants to merge them has the key to do
       it with.

       THE PRINTER HALF IS NOW FIXED TOO (2026-09-05). Storing one row per account
       here was never enough on its own: the Black Report does not read this list.
       It re-runs the engine over the stored file and prefers the engine's
       re-normalized list, which is all three bureau copies concatenated — so the
       funding walk still printed nine card rows, a $135,000 credit line against a
       real $45,000, and a paydown target of $13,500 against a real $4,500. That is
       fixed where it belongs, in src/underwrite/black-report-client.mjs, which now
       collapses bureau copies on accountIdentifier before it prints or sums. Do
       not "fix" it a second time by hiding the duplicates in this file — a real
       tri-merge pull carries them and the simulation has to as well. */
    tradelines: lines.map((l) => {
      const code = l.furnishesTo[0];
      return { ...l.vendor, ...l.repo, bureau: code, sourceType: BUREAU_NAME[code] };
    }),
    inquiries: dedupeEquifax(inquiries).map((i) => ({
      creditorName: i.creditorName,
      sourceType: BUREAU_NAME[i.bureau],
      inquiryDate: i.date,
      businessType: i.businessType,
      subscriberCode: i.subscriberCode,
      source: i.bureau,
      date: i.date
    })),
    publicRecords: [],
    /* The client screen reads card use off a TOP-LEVEL `utilization` number
       (src/http/client-detail.mjs). It was only ever written inside
       consumerSignals, so the screen and the lender matcher both saw nothing
       while the deliverables saw a figure. */
    utilization,
    bureaus: {
      TU: bureauReport("TU", p, { identity: id, submitted, lines, inquiries, pulledAt, infileDate }),
      EX: bureauReport("EX", p, { identity: id, submitted, lines, inquiries, pulledAt, infileDate }),
      EQ: bureauReport("EQ", p, { identity: id, submitted, lines, inquiries, pulledAt, infileDate })
    },
    bureauErrors: {},
    requestIds: { TU: "simulated-TU", EX: "simulated-EX", EQ: "simulated-EQ" },
    crm_payload: {
      contact: { email: email || null, name: name || null },
      scores: { ...scores },
      customFields: { crs_utilization: utilization, crs_total_limit: revLimit }
    }
  };
}

/** Assemble the ordinary simulated personal file with matched business rows/reports. */
export function buildScenarioPayload(profileKey, options, businessScenario) {
  const payload = buildPayload(profileKey, options);
  if (!businessScenario) return { payload, businesses: [] };
  const { businesses, businessReports } = buildBusinessScenario(businessScenario, { asOf: payload.pulledAt });
  payload.businessReports = businessReports;
  return { payload, businesses };
}

/** The ordinary fixture path stays scratch-only; CRM-only has its own client fence. */
export function assertBusinessScenarioSafe({ databaseUrl, email, businessScenario, crmOnly = false }) {
  if (!businessScenario) return;
  if (!BUSINESS_SCENARIOS[businessScenario]) throw new Error(`unknown business scenario ${businessScenario}`);
  if (!/^[^@+]+\+sim[\w-]*@[^@]+$/i.test(String(email || ""))) {
    throw new Error("business scenarios require a +sim email address");
  }
  if (!crmOnly && !isLocalScratchDatabaseUrl(databaseUrl)) {
    throw new Error("business scenarios require a local scratch database");
  }
}

/** Production CRM-only writes are limited to the existing fictional buyer. */
export function assertCrmOnlyTarget(client, email) {
  if (!/^[^@+]+\+sim[\w-]*@[^@]+$/i.test(String(email || ""))) {
    throw new Error("CRM-only mode requires a +sim email address");
  }
  if (!client || String(client.email || "").trim().toLowerCase() !== String(email).trim().toLowerCase()
      || String(client.first_name || "").trim().toLowerCase() !== "simulated"
      || String(client.last_name || "").trim().toLowerCase() !== "buyer") {
    throw new Error("CRM-only mode requires the existing Simulated Buyer client");
  }
  if (client.custom_fields?.slo_ref) {
    throw new Error("CRM-only mode requires a client with no SLO reference");
  }
}

/** Replace only this script's prior fictional business rows, never form-saved companies. */
export async function saveScenarioBusinesses(db, { orgId, clientId, businesses, databaseUrl, email, businessScenario, crmOnly = false }) {
  assertBusinessScenarioSafe({ databaseUrl, email, businessScenario, crmOnly });
  if (!businessScenario) throw new Error("business scenario required before saving business rows");
  const expected = buildBusinessScenario(businessScenario).businesses;
  if (!Array.isArray(businesses) || businesses.length !== expected.length
      || businesses.some((row, i) => row.name !== expected[i].name
        || row.entity_data?.state !== expected[i].entity_data.state
        || row.entity_data?.source !== "simulated_crs")) {
    throw new Error("business rows do not match the selected simulated scenario");
  }
  return withTransaction(db, async (tx) => {
    if (crmOnly) {
      const selected = (await tx.query(
        `SELECT id, first_name, last_name, email, ghl_contact_id, custom_fields
           FROM clients WHERE org_id = $1 AND id = $2 FOR UPDATE`, [orgId, clientId]
      )).rows[0];
      assertCrmOnlyTarget(selected, email);
    }
    await tx.query(
      `DELETE FROM businesses WHERE org_id = $1 AND client_id = $2 AND entity_data->>'source' = 'simulated_crs'`,
      [orgId, clientId]
    );
    for (const business of businesses) {
      await tx.query(
        `INSERT INTO businesses (org_id, client_id, name, age_months, entity_data)
         VALUES ($1, $2, $3, $4, $5::jsonb)`,
        [orgId, clientId, business.name, business.age_months, JSON.stringify(business.entity_data)]
      );
    }
  });
}

/* ── The identity row, the way the soft-pull form saves it ─────────────────
   api/soft-pull-approve.mjs refuses without street, city, a two-letter state and
   ZIP, and a YYYY-MM-DD date of birth, then calls storeIdentity with
   [{ addressLine1, city, state, postalCode }]. Same rules, same shape here, so a
   Sim that never saw the form looks exactly like one that did. */
export function formAddress(current = {}) {
  const a = {
    addressLine1: String(current.line1 ?? "").trim(),
    city: String(current.city ?? "").trim(),
    state: String(current.state ?? "").trim().toUpperCase(),
    postalCode: String(current.postal_code ?? "").trim()
  };
  if (!a.addressLine1 || !a.city || !/^[A-Z]{2}$/.test(a.state) || !a.postalCode) {
    throw new Error("the identity file's current_address needs line1, city, a two-letter state and postal_code — the soft-pull form refuses anything less");
  }
  return a;
}

// The same "is there a street" test the Repair desk uses (src/repair/read-repair-signals.mjs ADDRESS_SQL).
const hasStreet = (a) => Boolean(a && String(a.address_line1 ?? a.addressLine1 ?? a.line1 ?? a.street ?? "").trim());

/* identityPlan — what to save, given the row already on file (or null).
   FILLS ONLY WHAT IS MISSING. storeIdentity keeps the SSN and the date of birth
   when passed null (COALESCE), and the address list is handed back whole, so no
   value already on file is ever replaced or dropped. */
export function identityPlan(existing, identity) {
  const address = formAddress(identity?.current);
  const dob = String(identity?.dob ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dob)) {
    throw new Error("the identity file needs a YYYY-MM-DD dob — the soft-pull form refuses without one");
  }
  if (!existing) {
    return { write: true, fills: ["address", "date of birth", "SSN"], ssn: SIM_SSN, dob, addresses: [address] };
  }
  const list = Array.isArray(existing.addresses) ? existing.addresses : [];
  const plan = { fills: [], ssn: null, dob: null, addresses: list };
  if (!hasStreet(list[0])) { plan.addresses = [address, ...list]; plan.fills.push("address"); }
  if (!existing.has_dob) { plan.dob = dob; plan.fills.push("date of birth"); }
  if (!existing.has_ssn) { plan.ssn = SIM_SSN; plan.fills.push("SSN"); }
  return { write: plan.fills.length > 0, ...plan };
}

async function readIdentityOnFile(db, clientId) {
  return (await db.query(
    `SELECT ssn_enc IS NOT NULL AS has_ssn, dob IS NOT NULL AS has_dob, addresses
       FROM pii_identity WHERE client_id = $1`, [clientId])).rows[0] || null;
}

/* packStoreProblem — can the UnderwriteIQ pack be saved from THIS process?
   Returns null when it can, or a plain sentence saying why not. It only opens
   the store (the same provider C-06 will use); it writes nothing.

   The netlify-blobs provider opens with NETLIFY_SITE_ID + NETLIFY_BLOBS_TOKEN,
   or with the context a deployed Netlify function is handed. A laptop has
   neither unless they are set for the run, and the SDK then throws
   MissingBlobsEnvironmentError — which C-06 catches, so without this check the
   run said nothing. A Netlify-masked token opens fine and fails later, so it is
   caught here too. `makeProvider` is injectable for the test only. */
export async function packStoreProblem(env = process.env, { makeProvider = providerFromEnv } = {}) {
  const name = env.DOCUMENT_STORE_PROVIDER || "memory";
  if (name === "memory") {
    return "DOCUMENT_STORE_PROVIDER is memory (or not set), so the pack would be kept only in this script's memory and lost when it exits. " +
      "Run it with DOCUMENT_STORE_PROVIDER=netlify-blobs, NETLIFY_SITE_ID and NETLIFY_BLOBS_TOKEN set";
  }
  if (name !== "netlify-blobs") return null;
  if ((String(env.NETLIFY_BLOBS_TOKEN || "").match(/\*/g) || []).length >= 4) {
    return "NETLIFY_BLOBS_TOKEN is Netlify's masked copy (asterisks), not the token, so the save would be refused";
  }
  try {
    await makeProvider(env).exists(`netlify-blob://${env.NETLIFY_BLOBS_STORE || "documents"}/push-credit-preflight`);
  } catch (e) {
    return "the netlify-blobs document store cannot be opened from this machine " +
      `(${String(e?.message || e).slice(0, 160)}). Run it with NETLIFY_SITE_ID and ` +
      "NETLIFY_BLOBS_TOKEN set — the document store reads both (src/documents/store.mjs)";
  }
  return null;
}

/* packSavedFor — did C-06 save the pack for THIS pull? C-06 stamps
   funding_letters_delivered_event_id with the analysis.completed id only after
   at least one file is stored (deliverFundingLettersOnce), so the stamp is the
   honest answer; the file count is printed alongside. */
export async function packSavedFor(db, clientId, analysisEventId) {
  const r = (await db.query(
    `SELECT custom_fields->>'funding_letters_delivered_event_id' AS stamp,
            (SELECT count(*)::int FROM documents d WHERE d.client_id = c.id AND d.kind = 'deliverable') AS files
       FROM clients c WHERE c.id = $1`, [clientId])).rows[0] || {};
  return {
    saved: Boolean(analysisEventId) && r.stamp === String(analysisEventId),
    files: Number(r.files || 0)
  };
}

function countNegatives(rows) {
  return rows.filter((t) => t.derogatoryDataIndicator === true).length;
}

/** Save one sample decision and call only the two CRM state handlers. No event bus or document pack. */
export async function runCrmOnlyScenario(db, { orgId, email, profileKey, businessScenario, databaseUrl, dry = false }) {
  if (!orgId || !resolveProfileKey(profileKey) || !businessScenario) {
    throw new Error("CRM-only mode requires an org, personal profile, and business scenario");
  }
  assertBusinessScenarioSafe({ databaseUrl, email, businessScenario, crmOnly: true });
  return withTransaction(db, async (tx) => {
    const client = (await tx.query(
      `SELECT id, first_name, last_name, email, ghl_contact_id, custom_fields
         FROM clients WHERE org_id = $1 AND lower(email) = $2 FOR UPDATE`,
      [orgId, String(email).trim().toLowerCase()]
    )).rows[0];
    assertCrmOnlyTarget(client, email);
    // A previously form-saved company must not be silently mixed with a fixture.
    const realBusinesses = (await tx.query(
      `SELECT count(*)::int AS n FROM businesses
        WHERE org_id = $1 AND client_id = $2
          AND COALESCE(entity_data->>'source', '') <> 'simulated_crs'`,
      [orgId, client.id]
    )).rows[0]?.n ?? 0;
    if (realBusinesses) throw new Error("CRM-only mode refuses a client with form-saved business rows");

    const name = "Simulated Buyer";
    const { payload, businesses } = buildScenarioPayload(profileKey, {
      email, name, identity: SIMULATED_BUYER_IDENTITY
    }, businessScenario);
    const { tierResult, fundingEstimate } = scoreBuyerTotal(runTierEngineFromCrsResult, payload, {
      submittedName: name,
      submittedAddress: "100 Simulation Way, Phoenix, AZ, 85004",
      formData: { name, email, phone: null }
    });
    payload.outcome = tierResult.outcome;
    payload.preapprovals = tierResult.preapprovals ? {
      ...tierResult.preapprovals,
      totalBusiness: fundingEstimate - Number(tierResult.preapprovals.totalPersonal || 0),
      totalCombined: fundingEstimate
    } : null;
    payload.reason_codes = tierResult.reasonCodes ?? tierResult.reason_codes ?? ["simulated"];
    payload.consumerSignals = tierResult.consumerSignals ?? null;
    if (dry) return { dry: true, clientId: client.id, outcomeTier: tierResult.outcome, fundingEstimate, businessCount: businesses.length };

    await saveScenarioBusinesses({ query: (...args) => tx.query(...args) }, {
      orgId, clientId: client.id, businesses, databaseUrl, email, businessScenario, crmOnly: true
    });
    const crs = (await tx.query(
      `INSERT INTO crs_results (org_id, client_id, result, outcome_tier, is_demo)
       VALUES ($1, $2, $3::jsonb, $4, true) RETURNING *`,
      [orgId, client.id, JSON.stringify(payload), tierResult.outcome]
    )).rows[0];
    await ingestCrsResult(tx, crs);
    await ingestCrsLiabilities(tx, crs);
    await mergeCustomFields(tx, client.id, {
      crs_utilization: payload.utilization,
      utilization: payload.utilization,
      business_age_months: businesses[0]?.age_months ?? 0
    });
    const eventBase = { orgId, clientId: client.id };
    const stamp = { crsResultId: crs.id, source: "crs", simulated: true,
      simulatedNotice: payload.simulatedNotice, outcomeTier: tierResult.outcome };
    const localOnly = { skipCrmLink: true, skipChecklist: true };
    await onAnalysisCompleted({ ...eventBase, name: "analysis.completed", payload: {
      ...stamp, scores: payload.scores, newInquiries: newInquiriesFor(payload)
    } }, tx, localOnly);
    await onDecisionRendered({ ...eventBase, name: "decision.rendered", payload: {
      ...stamp, fundingEstimate
    } }, tx, localOnly);
    return { dry: false, clientId: client.id, crsResultId: crs.id,
      outcomeTier: tierResult.outcome, fundingEstimate, businessCount: businesses.length };
  });
}

function arg(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith("--") ? process.argv[i + 1] : fallback;
}

async function main() {
  const email = String(arg("email", "")).trim().toLowerCase();
  const profileArg = String(arg("profile", "")).trim();
  const businessScenario = arg("business-scenario");
  const crmOnly = process.argv.includes("--crm-only");
  const dry = process.argv.includes("--dry");
  const profileKey = resolveProfileKey(profileArg);
  if (!email || !profileKey) {
    console.error("usage: node scripts/sim/push-credit.mjs --email <client email> --profile fundable|repair-full|repair-trial [--business-scenario seasoned_clean|young_clean|lien_stressed|inactive|two_clean|mixed] [--crm-only] [--dry]");
    console.error(`       old names still work: ${Object.entries(PROFILE_ALIASES).map(([a, t]) => `${a}=${t}`).join(" ")}`);
    process.exit(2);
  }
  if (process.argv.includes("--business-scenario") && !businessScenario) {
    throw new Error("--business-scenario needs a scenario name");
  }
  if (!process.env.DATABASE_URL) { console.error("DATABASE_URL is not set"); process.exit(2); }
  if (crmOnly) {
    const db = pool();
    try {
      const orgId = await resolveDefaultOrg(db);
      const result = await runCrmOnlyScenario(db, {
        orgId, email, profileKey, businessScenario, databaseUrl: process.env.DATABASE_URL, dry
      });
      console.log(`CRM-only ${result.dry ? "dry" : "saved"}: ${result.outcomeTier}, estimate ${result.fundingEstimate}, ${result.businessCount} fictional business(es)`);
      console.log(result.dry ? "No rows written." : "Stopped at CRM decision; no event bus, document pack, payment, or fulfillment was called.");
    } finally { await close(); }
    return;
  }
  assertBusinessScenarioSafe({ databaseUrl: process.env.DATABASE_URL, email, businessScenario });
  const identity = loadOwnerIdentity();
  const db = pool();
  ensureRegistered();

  const orgId = await resolveDefaultOrg(db);
  const c = (await db.query(
    `SELECT id, first_name, last_name, email, outcome_tier FROM clients WHERE org_id = $1 AND lower(email) = $2 ORDER BY created_at DESC LIMIT 1`,
    [orgId, email]
  )).rows[0];
  if (!c) { console.error(`no client with email ${email} in the default company — opt in through ClickFunnels first`); process.exit(1); }
  const name = [c.first_name, c.last_name].filter(Boolean).join(" ");

  const prior = (await db.query(`SELECT count(*)::int AS n FROM crs_results WHERE client_id = $1`, [c.id])).rows[0].n;
  const p = PROFILES[profileKey];
  const { payload, businesses: scenarioBusinesses } = buildScenarioPayload(profileKey, { email, name, identity }, businessScenario);

  /* SAY IT BEFORE THE ENGINE RUNS. The name on the credit file has to match the
     name on the client row or the identity gate sends the file to manual review
     and the funding estimate becomes $0 — not because the credit is bad, but
     because the two names disagree. The legal name is always written onto the
     file so this cannot happen by accident, but a client row whose name is not
     Chris's is still worth saying out loud. */
  const submitted = nameParts(name);
  if (!submitted || submitted.first.toLowerCase() !== identity.first.toLowerCase()
      || submitted.last.toLowerCase() !== identity.last.toLowerCase()) {
    console.log(`note     client row is "${name}" but the identity file says "${identity.first} ${identity.last}" — both are written onto the file so the identity check still passes`);
  }

  // The real tier engine decides. Nothing here forces an outcome.
  const tierOptions = {
    submittedName: name,
    /* The gate ignores the address today (identity-fraud-gate.js takes it and
       never reads it) but passing the real one means it is right the day it
       starts reading it. */
    submittedAddress: [identity.current.line1, identity.current.city, identity.current.state, identity.current.postal_code].filter(Boolean).join(", "),
    formData: { name, email, phone: null }
  };
  const scored = businessScenario
    ? scoreBuyerTotal(runTierEngineFromCrsResult, payload, tierOptions)
    : { tierResult: runTierEngineFromCrsResult(payload, tierOptions) };
  const tier = scored.tierResult;
  const fundingEstimate = businessScenario
    ? scored.fundingEstimate
    : (tier.preapprovals?.totalCombined ?? null);
  payload.outcome = tier.outcome;
  payload.preapprovals = businessScenario && tier.preapprovals
    ? { ...tier.preapprovals,
        totalBusiness: fundingEstimate - Number(tier.preapprovals.totalPersonal || 0),
        totalCombined: fundingEstimate }
    : (tier.preapprovals ?? null);
  payload.reason_codes = tier.reasonCodes ?? tier.reason_codes ?? ["simulated"];
  /* F45 — the engine's OWN signals, not a hand-written stub. The old sim wrote
     `{ scores: { perBureau }, utilization: { pct } }` and the deliverable
     builders fall back to whatever is stored when the engine is not re-run. That
     stub had no `median`, and the lender matcher reads exactly that key — so
     every lender in the book came back "Score N+ required (currently 0)". A
     partial stub is worse than none; this is the whole thing the engine computed,
     median, anchors, per-bureau negatives and all. */
  payload.consumerSignals = tier.consumerSignals ?? null;

  const negatives = countNegatives(payload.tradelines);
  const cs = payload.consumerSignals;
  console.log(`client   ${name} <${email}> id=${c.id}`);
  console.log(`profile  ${profileKey}${profileArg !== profileKey ? ` (asked for "${profileArg}")` : ""} — ${p.note}`);
  console.log(`scores   EX ${p.scores.EX} · EQ ${p.scores.EQ} · TU ${p.scores.TU} · median ${cs?.scores?.median ?? "?"}`);
  console.log(`file     ${payload.tradelines.length} accounts · ${negatives} negative · card use ${payload.utilization}% · ${payload.inquiries.length} inquiries`);
  console.log(`personal ${payload.bureaus.EX.creditFiles[0].aliases.length} names · ${payload.bureaus.EX.creditFiles[0].addresses.length} addresses on Experian (1 current + former) · ${payload.bureaus.EX.creditFiles[0].employments.length} employers`);
  console.log(`derogs   ${cs?.derogatories?.collections ?? 0} collection rows · ${cs?.derogatories?.chargeoffs ?? 0} charge-off rows · worst severity ${cs?.derogatories?.worstSeverity ?? 0}`);
  console.log(`tier     ${tier.outcome} · funding estimate ${fundingEstimate ?? "none"}`);
  /* Say it out loud so the walkthrough is not surprised by a $0 business figure. */
  console.log(businessScenario
    ? `business ${businessScenario}: ${scenarioBusinesses.length} fictional company report(s), engine total $${payload.preapprovals?.totalBusiness ?? 0}`
    : `business $0 — no business credit report is passed, so business_age_months ${p.businessAgeMonths} is never read`);
  console.log(`prior    ${prior} crs_results row(s) already on this client${prior ? " — a new one is added, the newest wins" : ""}`);

  /* BEFORE ANYTHING IS WRITTEN — the identity row and the pack (hole N10; see
     the header). Every problem is collected and the run stops with none of it
     written, dry or not, so a dry run says exactly what a real run would do. */
  const problems = [];
  let idPlan = null;
  const idOnFile = await readIdentityOnFile(db, c.id);
  try {
    idPlan = identityPlan(idOnFile, identity);
    if (idPlan.ssn) encryptSsn(idPlan.ssn, { clientId: c.id }); // throws if PII_ENC_KEY cannot encrypt
    console.log(`identity ${!idOnFile ? "none on file" : "on file"} — ${idPlan.write
      ? `${dry ? "would save" : "will save"} ${idPlan.fills.join(", ")} the way the soft-pull form does (the simulated SSN is a never-issued 666 number)`
      : "address, date of birth and SSN all there, left as is"}`);
  } catch (e) {
    problems.push(`identity row: ${e.message}`);
  }
  const packExpected = isFundingPath(tier.outcome);
  if (packExpected) {
    const why = await packStoreProblem(process.env);
    if (why) problems.push(`UnderwriteIQ pack: ${tier.outcome} is a funding result, so C-06 builds the pack — but ${why}`);
    else console.log(`pack     ${tier.outcome} is a funding result — the UnderwriteIQ pack ${dry ? "would be" : "will be"} saved and checked`);
  } else {
    console.log(`pack     ${tier.outcome} is not a funding result — C-06 builds no UnderwriteIQ pack`);
  }
  if (problems.length) {
    console.error("\nSTOP — nothing was written. A real pull would not get this far without these:");
    for (const p of problems) console.error(`  - ${p}`);
    process.exitCode = 1;
    await close();
    return;
  }
  if (dry) { console.log("dry run — nothing written"); await close(); return; }

  if (idPlan.write) {
    await storeIdentity(db, { orgId, clientId: c.id, ssn: idPlan.ssn, dob: idPlan.dob, addresses: idPlan.addresses });
  }
  if (businessScenario) {
    await saveScenarioBusinesses(db, {
      orgId, clientId: c.id, businesses: scenarioBusinesses,
      databaseUrl: process.env.DATABASE_URL, email, businessScenario
    });
  }

  const crs = (await db.query(
    `INSERT INTO crs_results (org_id, client_id, result, outcome_tier, is_demo) VALUES ($1, $2, $3::jsonb, $4, true) RETURNING *`,
    [orgId, c.id, JSON.stringify(payload), tier.outcome]
  )).rows[0];
  const ingested = await ingestCrsResult(db, crs);
  const liabilities = await ingestCrsLiabilities(db, crs);

  const inqCount = (code) => payload.inquiries.filter((i) => i.source === code).length;
  await mergeCustomFields(db, c.id, {
    crs_inquiries_ex: inqCount("EX"),
    crs_inquiries_eq: inqCount("EQ"),
    crs_inquiries_tu: inqCount("TU"),
    crs_negative_items_count: negatives,
    crs_late_payments_count: payload.tradelines.filter((t) => /late/i.test(String(t.paymentStatus))).length,
    /* Display fallback only. The engine reads the saved business report's
       incorporated date; without --business-scenario it still gets no report
       and business funding stays $0. */
    business_age_months: scenarioBusinesses[0]?.age_months ?? p.businessAgeMonths,
    crs_utilization: payload.utilization,
    /* The client screen's own fallback key. It looks for `utilization`, not
       `crs_utilization`, and finding neither it showed no card use at all. */
    utilization: payload.utilization
  });

  const stamp = { simulated: true, simulatedNotice: payload.simulatedNotice };
  const requestId = `sim-walkthrough:${crs.id}`;
  const analysis = await emit(db, "analysis.completed", {
    crsResultId: crs.id, requestId, source: "crs",
    // `newInquiries` — the key c-02-inquiry-created reads. Emitting `inquiries`
    // here meant the sim's inquiries were never logged either.
    scores: payload.scores, bureaus: payload.bureaus, newInquiries: newInquiriesFor(payload),
    outcomeTier: tier.outcome, ...stamp
  }, { orgId, clientId: c.id, isDemo: true, idempotencyKey: `crs-result:${crs.id}:analysis.completed:v1` });
  await emit(db, "decision.rendered", {
    crsResultId: crs.id, requestId, source: "crs",
    outcomeTier: tier.outcome, fundingEstimate, ...stamp
  }, { orgId, clientId: c.id, isDemo: true, idempotencyKey: `crs-result:${crs.id}:decision.rendered:v1` });

  const after = (await db.query(`SELECT outcome_tier, custom_fields->>'total_funding_estimate' AS est FROM clients WHERE id = $1`, [c.id])).rows[0];
  void ingested; void liabilities;
  const counts = (await db.query(
    `SELECT (SELECT count(*) FROM tradelines WHERE client_id = $1)::int AS lines,
            (SELECT count(*) FROM card_liabilities WHERE client_id = $1)::int AS liabilities`, [c.id])).rows[0];
  console.log(`written  crs_results ${crs.id} · ${counts.lines} tradelines · ${counts.liabilities} liabilities on the client`);
  console.log(`client   outcome_tier=${after.outcome_tier} total_funding_estimate=${after.est ?? "none"}`);
  console.log("events   analysis.completed + decision.rendered emitted (card advances to Decision rendered)");
  if (idPlan.write) console.log(`identity saved ${idPlan.fills.join(", ")}`);
  if (packExpected) {
    const pack = await packSavedFor(db, c.id, analysis?.id);
    if (pack.saved) {
      console.log(`pack     UnderwriteIQ pack saved for this pull — ${pack.files} deliverable file(s) on the client`);
    } else {
      console.error("\nFAILED — the UnderwriteIQ pack was NOT saved for this pull. The credit file above IS written;");
      console.error("         nothing retries the pack on its own. C-06 ran but stored no file — check the document");
      console.error("         store settings (DOCUMENT_STORE_PROVIDER, NETLIFY_SITE_ID, NETLIFY_BLOBS_TOKEN) and the");
      console.error("         client's credit file, then push the credit again.");
      process.exitCode = 1;
    }
  }
  await close();
}

import { fileURLToPath } from "node:url";
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch(async (e) => { console.error(e); try { await close(); } catch { /* noop */ } process.exit(1); });
}
