// WHAT THE PARTNER SIGNS HAS TO BE WHAT THE OWNER DECIDED, AND IT MAY NEVER
// CLAIM ANYBODY WILL MAKE MONEY. This file fails when either stops being true.
//
// COMPLIANCE REVIEW REQUIRED (CLAUDE.md §7): fee timing, refund behaviour and
// payout behaviour, in customer-facing contract copy.
//
// THE COPY IS db/migrations/283_partner_license_template.sql. Its terms are
// owner-set in docs/specs/W0-decisions.md (2026-08-31) and recorded as fact:
// 50% of funding and repair front and back including half the 10% success fee
// and it never moves · e-products excluded · $10,000 once with nothing ongoing ·
// sub-affiliates out of the PARTNER'S half · 10 funding clients a calendar month
// with the warning → final notice (30-day cure) → 50-to-20-on-new-business
// ladder · fast payouts with no hold-back and no clawback · a 3-day refund
// window · no lender data · FundHub performs all fulfilment.
//
// THREE CLASSES OF DRIFT ARE CAUGHT HERE:
//
//   1. A TERM GOES MISSING. Somebody edits the copy and a promise the owner made
//      stops being in the document the partner signs.
//   2. A NUMBER DRIFTS FROM THE CODE THAT ENFORCES IT. The words say ten clients
//      and src/partners/floors.mjs scores them on twelve; the words say 20% and
//      the ladder writes 25. This is exactly the shape of the $1,000-a-month
//      defect that 273_repair_fee_charged_once.sql had to fix — two halves, each
//      individually correct, and nothing looking at their meeting. This file
//      looks at the meeting.
//   3. AN EARNINGS CLAIM APPEARS. FundHub has zero measured paid closes
//      (W1-money-model.md F3). A signed document that names, implies or forecasts
//      what a partner will make is the single worst sentence this repository
//      could ship, and the copy is written to have no vocabulary for it.
//
// WHY THIS READS db/*.sql RATHER THAN A DATABASE: every *.pg.test.mjs skips
// without DATABASE_URL, and a guard that skips is not a guard. The SQL under db/
// is what every environment is built from.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { readContractTemplatesFromDb } from "./db-template-source.mjs";
import { tagsIn } from "./render.mjs";
import {
  PARTNER_LICENSE_TEMPLATE_KEY, PARTNER_LICENSE_SUBTYPE, PARTNER_ID_MERGE_KEY,
  PARTNER_SHARE_PCT, PARTNER_ENTRY_REFUND_DAYS
} from "./partner-license.mjs";
import { OFFERS, formatCents } from "../config/offers.mjs";
import { FLOOR_CLIENTS_PER_MONTH, DOWNGRADED_SHARE_PCT, CURE_DAYS } from "../partners/floors.mjs";
import { SUBTYPES } from "../documents/kinds.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");

const TEMPLATES = readContractTemplatesFromDb();
const LICENCE = TEMPLATES.get(PARTNER_LICENSE_TEMPLATE_KEY);
const BODY = (LICENCE && LICENCE.body) || "";
const FIELDS = (LICENCE && LICENCE.fields) || [];

/** The signature line is a plain literal rather than an E'…' run, so it is
 *  pulled off the statement directly. It is copy a person reads and ticks, so it
 *  is held to the same rules as the body. */
const SIGNATURE_LINE = (() => {
  const m = LICENCE && LICENCE.block.match(/'(I have read[^']*(?:''[^']*)*)'/);
  return m ? m[1].replace(/''/g, "'") : "";
})();

/** Everything a human ever reads on this document: the words, every blank's
 *  name, label and help, and the sentence next to the signing box. */
const ALL_COPY = [
  BODY,
  SIGNATURE_LINE,
  ...FIELDS.flatMap((f) => [f.key, f.label, f.help || ""])
].join("\n");

/* ═════════════════════════════════════════════════════════════════════════
   The copy this guard reads is really there.
   ═════════════════════════════════════════════════════════════════════════ */

describe("the partner licence exists in db/", () => {
  test("db/ defines a PARTNER-LICENSE contract template", () => {
    // Without this, every assertion below would pass over an empty string.
    assert.ok(
      LICENCE,
      "no file under db/ defines PARTNER-LICENSE. 042_partners.sql holds every partner " +
      "payout until agreement_signed_at is stamped, and this is the document it holds " +
      "out for — without it a partner can be approved, produce, and never be paid.");
    assert.ok(BODY.length > 2000, "the partner licence body did not parse");
    assert.ok(FIELDS.length >= 1, "the partner licence blanks did not parse");
    assert.ok(SIGNATURE_LINE.length > 20, "the signature line did not parse");
  });

  test("it is seeded by the migration this unit owns", () => {
    assert.deepEqual(LICENCE.sources, ["migrations/283_partner_license_template.sql"]);
  });

  test("it is a signable contract with the subtype 030 names", () => {
    assert.match(LICENCE.block, /'contract',/, "the licence is not typed as a contract");
    assert.match(
      LICENCE.block, new RegExp(`'${PARTNER_LICENSE_SUBTYPE}'`),
      `the licence is not filed under the '${PARTNER_LICENSE_SUBTYPE}' subtype, which is the ` +
      `name 030_documents.sql and 033_affiliates.sql both hang the payout hold on`);
    assert.match(LICENCE.block, /\btrue\b/, "signature_required is not set");
    assert.ok(
      SUBTYPES.contract.includes(PARTNER_LICENSE_SUBTYPE),
      "src/documents/kinds.mjs stopped listing the partner_license subtype");
  });

  test("every blank in the words is a blank on the form, and the reverse", () => {
    // The half-done rename that made a fee line render empty (273) caught in
    // both directions.
    const declared = new Set(FIELDS.map((f) => f.key));
    for (const tag of tagsIn(BODY)) {
      if (!tag.startsWith("field.")) continue;
      const key = tag.slice("field.".length);
      assert.ok(declared.has(key),
        `the licence prints {{${tag}}} but declares no such blank, so it renders empty`);
    }
    for (const f of FIELDS) {
      assert.ok(BODY.includes(`{{field.${f.key}}}`),
        `the licence declares a blank "${f.key}" that its words never print`);
    }
  });

  test("the client's own details still come from the client record", () => {
    for (const tag of ["contact.full_name", "contact.email", "today"]) {
      assert.ok(BODY.includes(`{{${tag}}}`), `the licence stopped printing {{${tag}}}`);
    }
  });
});

/* ═════════════════════════════════════════════════════════════════════════
   Every owner-set term, in the words a partner signs.
   ═════════════════════════════════════════════════════════════════════════ */

/** term → what has to be in the document for that term to be stated. Each row
 *  is one promise from W0-decisions.md, named the way the owner said it. */
const TERMS = [
  ["FundHub does all the work", /FundHub performs all fulfilment/i],
  ["the split is half and half", /You keep 50%\. We keep 50%\./],
  ["it covers funding work", /half of what the clients on your book pay for funding work/i],
  ["it covers credit repair work", /half of what they pay for credit repair work/i],
  ["it covers the front end", /the front end/i],
  ["it covers the back end", /the back end/i],
  ["half the 10% success fee is included", /half of the 10% success fee/i],
  ["the split never changes", /This split does not change/i],
  ["e-products are not split", /Courses, training and other digital products are not split/i],
  ["e-products stay with FundHub in full", /stay with FundHub in full/i],
  ["joining costs ten thousand dollars", /You pay \$10,000 to join/],
  ["it is paid one time", /You pay it one time/],
  ["there is nothing ongoing", /carries no repeating charge of any kind/i],
  ["they are never billed again", /never billed again for it/i],
  ["financing is a way to pay, not a test", /not a test you have to pass/i],
  ["the review call decides, never a lender", /The review call decides that/i],
  ["their own affiliates come out of their half", /comes out of your half, not out of ours/i],
  ["FundHub's half never moves", /FundHub's 50% never moves/],
  ["ten funding clients a month", /at least 10 funding clients in each calendar month/i],
  ["what a funding client is", /paid the funding deposit and kept it/i],
  ["miss once is a warning", /That letter is a warning/i],
  ["miss twice is a final notice", /That letter is your final notice/i],
  ["the final notice starts a 30-day cure", /starts a 30-day period to put it right/i],
  ["miss three times drops 50 to 20", /Your share moves from 50% to 20%/],
  ["the drop is on new business only", /applies to NEW business only/],
  ["nothing already earned is restated", /nothing already paid is taken back/i],
  ["one good window puts it back", /Your share goes back to 50% on new business/],
  ["payouts are fast", /We pay you as fast as we can/i],
  ["there is no hold-back", /There is no hold-back/],
  ["a payout is not held against an affiliate's unconverted lead",
    /do not hold your payout because one of your affiliates/i],
  ["there is no clawback", /There is no clawback/],
  ["a later refund is FundHub's loss", /that is our loss and we do not take it back/i],
  ["the refund window is three days", /You have 3 days from the day you pay/],
  ["after that the joining fee is not refundable", /the joining fee is not refundable/i],
  ["partners are blocked from the client system", /You do not get the client management system/i],
  ["partners are never shown lender data", /You are never shown lender data/],
  ["nor are their affiliates", /The same applies to every affiliate you bring on/i],
  ["nothing is promised", /We do not promise you any amount of money/i],
  ["and nothing above is a forecast", /Nothing written above is a forecast of what you will be paid/i]
];

describe("every owner-set term is in the words the partner signs", () => {
  for (const [term, pattern] of TERMS) {
    test(term, () => {
      assert.match(
        BODY, pattern,
        `the partner licence no longer states: ${term}. That term is owner-set in ` +
        `docs/specs/W0-decisions.md and a partner cannot agree to a term the document ` +
        `does not contain.`);
    });
  }
});

/* ═════════════════════════════════════════════════════════════════════════
   The numbers in the words are the numbers the code enforces.
   ═════════════════════════════════════════════════════════════════════════ */

describe("the words and the code hold the same numbers", () => {
  test("50% is the schema's own default share, not a number typed twice", () => {
    const partners042 = read("db/migrations/042_partners.sql");
    const m = partners042.match(/revenue_share_pct\s+numeric\([^)]*\)\s+NOT NULL DEFAULT\s+(\d+)/);
    assert.ok(m, "042_partners.sql no longer declares a default revenue_share_pct");
    assert.equal(Number(m[1]), PARTNER_SHARE_PCT,
      "the partner licence promises a share the partners table does not default to");
    assert.ok(BODY.includes(`You keep ${PARTNER_SHARE_PCT}%. We keep ${PARTNER_SHARE_PCT}%.`));
  });

  test("the downgrade number is src/partners/floors.mjs's, to the point", () => {
    assert.ok(
      BODY.includes(`Your share moves from ${PARTNER_SHARE_PCT}% to ${DOWNGRADED_SHARE_PCT}%`),
      `the ladder writes ${DOWNGRADED_SHARE_PCT}% and the signed document says something else`);
    assert.ok(BODY.includes(`goes back to ${PARTNER_SHARE_PCT}% on new business`));
  });

  test("the production floor is the number the monthly job scores against", () => {
    assert.ok(
      BODY.includes(`at least ${FLOOR_CLIENTS_PER_MONTH} funding clients in each calendar month`),
      `src/partners/floors.mjs scores partners on ${FLOOR_CLIENTS_PER_MONTH} clients and the ` +
      `document they signed names a different bar`);
  });

  test("the cure period is the one the final notice actually gives", () => {
    assert.ok(BODY.includes(`starts a ${CURE_DAYS}-day period`),
      `src/partners/floors.mjs gives ${CURE_DAYS} days to cure and the document promises another number`);
  });

  test("the joining fee is the catalogue price, to the cent", () => {
    const price = formatCents(OFFERS.PARTNER_ENTRY.priceCents);
    assert.equal(price, "$10,000", "PARTNER_ENTRY stopped costing ten thousand dollars");
    assert.ok(BODY.includes(`You pay ${price} to join`),
      `the catalogue charges ${price} to join and the document says something else — ` +
      `the partner would sign for the wrong number`);
  });

  test("the success fee share is half of the catalogue's success fee", () => {
    const pct = OFFERS.FUNDING_DFY.successFeePercent;
    assert.equal(pct, 10);
    assert.ok(BODY.includes(`half of the ${pct}% success fee`));
  });

  test("the refund window is the recorded one", () => {
    assert.equal(PARTNER_ENTRY_REFUND_DAYS, 3, "W0 records a 3-day window on the joining fee");
    assert.ok(BODY.includes(`You have ${PARTNER_ENTRY_REFUND_DAYS} days from the day you pay`));
  });

  test("no owner-set number is left as a blank for somebody to fill in", () => {
    // 273's lesson: a blank in a money sentence, filled from another file, is
    // how a $1,000 product came to be signed for at $1,000 a month. W0 fixes
    // these for every partner, so they belong in the sentence.
    const moneyShaped = /(fee|price|cost|deposit|amount|payment|charge|share|percent|pct|days|clients|floor)/i;
    for (const f of FIELDS) {
      assert.ok(
        !moneyShaped.test(f.key) && !moneyShaped.test(f.label),
        `the partner licence has a blank "${f.key}" (${f.label}) holding an owner-set number. ` +
        `Put the number in the sentence — a blank filled from another file is the seam ` +
        `273_repair_fee_charged_once.sql had to close.`);
    }
  });
});

/* ═════════════════════════════════════════════════════════════════════════
   No earnings claim, anywhere on the document.
   ═════════════════════════════════════════════════════════════════════════ */

/* Each row is one way a document can suggest somebody will make money, or that
   a credit file will improve. NEGATIONS ARE NOT SPECIAL-CASED, on purpose: the
   copy is written to avoid the vocabulary rather than to argue with it, which is
   a rule with no edge to litigate.

   This is deliberately NOT the guard src/http/partner-apply-success-screen.test.mjs
   applies to public marketing copy — that one bans "$" and "%" outright, which a
   contract cannot do because stating the price and the split IS the contract.
   What is banned here is a FORECAST: what somebody will make, is likely to make,
   or typically makes. */
const EARNINGS_CLAIMS = [
  ["a dollar figure per period", /\$\s?[\d,]+(?:\.\d+)?\s*(?:\/|per\b|a\b|each\b|every\b)\s*(?:month|week|year|day|client|deal|sale|close)/i],
  ["earning or making a number", /\b(?:earn|earns|earned|earning|earnings|make|makes|making|profit|profits|income|take home|pocket|net)\b[^.]{0,40}\$\s?[\d,]/i],
  ["up to a number", /\bup to\s+\$?\s?[\d,]/i],
  ["as much as a number", /\bas much as\s+\$?\s?[\d,]/i],
  ["a typical or average outcome", /\b(?:typical|typically|average|expected|projected|potential|anticipated|on average)\b[^.]{0,40}\b(?:result|results|income|earnings|return|returns|profit|revenue|payout|month|year|client|clients|partner|partners)\b/i],
  ["figures", /\b(?:six|seven|eight)[-\s]?figure/i],
  ["a guarantee", /\bguarantee(?:s|d|ing)?\b/i],
  ["return on investment", /\breturn on investment\b|\bROI\b/],
  ["paying for itself", /\bpays? for itself\b|\bmake your money back\b|\brecoup\b|\bearn(?:s|ed)? back\b|\bpay(?:s|ed)? back your\b/i],
  ["telling them what they will make", /\byou (?:will|can|could|should|are going to)\s+(?:earn|make|profit|expect)\b/i],
  ["a promised credit outcome", /\b(?:score|scores|fico)\b[^.]{0,30}\b(?:increase|increases|improve|improves|jump|jumps|rise|rises|boost|go up|goes up|repaired|fixed)\b/i],
  ["a promised deletion", /\b(?:delete|deletes|deleted|deletion|deletions|remove|removes|removed|removal)\b[^.]{0,30}\b(?:negative|item|items|tradeline|tradelines|collection|collections|late|derogatory)\b/i],
  ["results language", /\b(?:proven|guaranteed|real|typical|consistent)\s+results\b/i],
  ["income framing", /\b(?:passive|extra|additional|second|residual|recurring)\s+income\b/i],
  ["a worth or value figure", /\bworth\s+\$\s?[\d,]/i]
];

describe("the partner licence never claims anybody will make money", () => {
  for (const [name, pattern] of EARNINGS_CLAIMS) {
    test(`no ${name}`, () => {
      const hit = ALL_COPY.match(pattern);
      assert.equal(
        hit, null,
        `the partner licence contains ${JSON.stringify(hit && hit[0])} — that reads as an ` +
        `earnings or credit-outcome claim. FundHub has zero measured paid closes ` +
        `(W1-money-model.md F3); this document may state what a partner PAYS and how a ` +
        `split is COMPUTED, and nothing about what anybody will receive.`);
    });
  }

  test("and it says so in as many words", () => {
    assert.match(BODY, /We do not promise you any amount of money/i);
    assert.match(BODY, /not for you and not for anybody on your book/i);
    assert.match(BODY, /any credit score change/i);
  });

  test("the guard bites — every one of these would be caught", () => {
    /* A guard that has never refused anything is indistinguishable from a guard
       that cannot. Each line is a sentence somebody might genuinely write into
       partner copy, and each has to be stopped by at least one pattern above. */
    const WOULD_BE_REFUSED = [
      "Partners bank $30,000 per month once they ramp.",
      "You can earn $250,000 in your first year.",
      "Earnings of up to $500,000 are available.",
      "Our average partner closes 14 clients a month.",
      "Build a six-figure book with us.",
      "Your payout is guaranteed.",
      "Expect a strong return on investment.",
      "The program pays for itself after three clients.",
      "You will make more than you paid.",
      "Client scores improve within 45 days.",
      "We remove negative items from the file.",
      "Proven results across the network.",
      "Build passive income on the back end.",
      "A book worth $1,200,000."
    ];
    for (const line of WOULD_BE_REFUSED) {
      assert.ok(
        EARNINGS_CLAIMS.some(([, pattern]) => pattern.test(line)),
        `no pattern above catches ${JSON.stringify(line)}. The guard has a hole in it.`);
    }
  });

  test("the only dollar figure on the document is what the partner pays", () => {
    const amounts = [...BODY.matchAll(/\$\s?[\d,]+(?:\.\d+)?/g)].map((m) => m[0]);
    assert.deepEqual(
      [...new Set(amounts)], ["$10,000"],
      "a dollar figure other than the joining fee appeared on the partner licence");
  });
});

/* ═════════════════════════════════════════════════════════════════════════
   Nothing on this document reads as a subscription.
   ═════════════════════════════════════════════════════════════════════════ */

/* The same vocabulary offer-fee-language.test.mjs polices on client contracts.
   "No monthly fee" is an owner-set term, and the safest way to keep it true in a
   document people skim is for the recurring words not to be on the page at all —
   a reader who carries "monthly" away from its negation has been misled by copy
   that was technically correct. */
const RECURRING =
  /(per\s+month|monthly|each\s+month|every\s+month|a\s+month|per\s+week|weekly|per\s+year|yearly|annually|annual|recurring|subscription|per\s+quarter|quarterly)/i;

describe("the base program has nothing ongoing, and the words cannot be misread", () => {
  test("no recurring-charge vocabulary anywhere on the document", () => {
    const hit = ALL_COPY.match(RECURRING);
    assert.equal(
      hit, null,
      `the partner licence contains ${JSON.stringify(hit && hit[0])}. The $10,000 is charged ` +
      `once and there is no monthly fee (W0-decisions.md), so the copy avoids the vocabulary ` +
      `rather than negating it.`);
  });

  test("the production floor is a production period, never a billing one", () => {
    // "each calendar month" instead of "each month" is the difference between a
    // bar somebody has to clear and a charge somebody has to pay.
    assert.match(BODY, /in each calendar month/);
    assert.doesNotMatch(BODY, /\bbill(ed|ing)?\b[^.]{0,20}\bmonth/i);
  });
});

/* ═════════════════════════════════════════════════════════════════════════
   The gate and the document are actually connected.
   ═════════════════════════════════════════════════════════════════════════ */

/** Files that WRITE partners.agreement_signed_at, with the reason each is
 *  allowed to. Comments are stripped before the scan, so a file that only talks
 *  about the column does not appear. A new entry is a new way to make somebody
 *  payable and has to be a decision somebody wrote down. */
const STAMP_SITES = Object.freeze({
  "src/contracts/partner-license.mjs":
    "GUARDED. The supported door: it stamps only from a signed PARTNER-LICENSE contract " +
    "carrying this partner's id in the merge values frozen at send.",
  "src/trials/conversion.mjs":
    "UNGUARDED, KNOWN GAP (owned by the live-trial unit, not this one). convertTrial() " +
    "refuses without an agreementSignedAt but takes that timestamp from its caller and " +
    "never checks that a signed licence exists. Route it through stampPartnerAgreement().",
  "api/trials/convert.mjs":
    "UNGUARDED, KNOWN GAP, same chain. The endpoint reads agreement_signed_at off the " +
    "request body and refuses when it is absent, but a staff member can type any moment " +
    "into it with no signed document behind it. Owner or admin only (requireRole), which " +
    "is a real control and is not the same control as a signature.",
  "src/demo/platform-seed.mjs":
    "Demo fixture only. Every row it writes carries is_demo = true (148_demo_mode.sql).",
  /* THESE TWO READ THE COLUMN, THEY DO NOT WRITE IT. The sweep above cannot tell
     a SELECT from an UPDATE — it matches the column name anywhere outside a
     comment — so a read-only user has to be listed or the guard goes red on it.
     Both are named here with what they actually do, rather than being made to
     dodge the sweep by aliasing the column, which would hide a real write the
     next time somebody edited them. */
  "src/training/entitlement.mjs":
    "READS ONLY. `SELECT id, status, agreement_signed_at FROM partners` — a signed " +
    "partner licence is what opens the $10,000 training (docs/specs/W7-curriculum.md). " +
    "It contains no INSERT and no UPDATE of any kind.",
  "api/read/partner-training.mjs":
    "READS ONLY. Selects the same column to report it on the training screen. GET only; " +
    "the handler answers 405 to anything else.",
  "src/pulse/coverage/gap-money-funding.mjs":
    "READS ONLY. The morning payout check (partners:payout-held) selects the column to say why a " +
    "payout is held. Every statement in the file is a SELECT; it has no INSERT, UPDATE or DELETE."
});

/** `//` line comments and `/* *\/` blocks removed, so a mention in prose is not
 *  mistaken for a write. */
const stripJsComments = (src) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

function walk(dir, out = []) {
  for (const name of fs.readdirSync(dir)) {
    if (name === "node_modules" || name === ".git") continue;
    const p = path.join(dir, name);
    const st = fs.statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (name.endsWith(".mjs") && !name.endsWith(".test.mjs")) out.push(p);
  }
  return out;
}

describe("the payout gate and this document are connected", () => {
  test("042 really does hold every payout on agreement_signed_at", () => {
    const sql = read("db/migrations/042_partners.sql");
    assert.match(sql, /FUNCTION partner_payout_agreement_gate\(\)/,
      "the partner payout gate is gone — this whole document is decoration without it");
    assert.match(sql, /IF signed IS NULL THEN[\s\S]{0,200}RAISE EXCEPTION/,
      "the gate stopped raising on an unsigned partner");
  });

  test("033 holds affiliate payouts on the same document", () => {
    const sql = read("db/migrations/033_affiliates.sql");
    assert.match(sql, /partner_license_signed_at/,
      "the affiliate half of the partner-licence hold is gone");
  });

  test("the only guarded way to open the gate names this template", () => {
    const mod = read("src/contracts/partner-license.mjs");
    assert.match(mod, new RegExp(`"${PARTNER_LICENSE_TEMPLATE_KEY}"`));
    assert.match(mod, new RegExp(`"${PARTNER_ID_MERGE_KEY}"`));
    assert.match(mod, /partner_license_template_missing/,
      "the refusal for an org with no licence copy is gone — the gate can be opened " +
      "with no template present");
    assert.match(mod, /partner_license_not_signed/,
      "the refusal for an unsigned partner is gone");
  });

  test("no new file learned to stamp agreement_signed_at behind everyone's back", () => {
    const found = [];
    for (const dir of ["src", "api"]) {
      const full = path.join(ROOT, dir);
      if (!fs.existsSync(full)) continue;
      for (const file of walk(full)) {
        if (!/agreement_signed_at/.test(stripJsComments(fs.readFileSync(file, "utf8")))) continue;
        found.push(path.relative(ROOT, file).split(path.sep).join("/"));
      }
    }
    for (const file of found) {
      assert.ok(
        STAMP_SITES[file],
        `${file} writes partners.agreement_signed_at and is not on the list in this file. ` +
        `That column is the only thing between an unsigned partner and a payout ` +
        `(042_partners.sql). Route it through stampPartnerAgreement(), or add it here ` +
        `with the reason it is allowed to stamp on its own.`);
    }
    assert.ok(
      found.includes("src/contracts/partner-license.mjs"),
      "the guarded door disappeared — nothing can open the payout gate any more");
  });
});
