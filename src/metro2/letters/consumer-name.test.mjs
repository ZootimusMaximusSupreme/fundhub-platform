// ═══════════════════════════════════════════════════════════════════════════════
// THE NAME CLASS, CLOSED AND KEPT CLOSED.
//
// COMPLIANCE REVIEW REQUIRED — dispute logic and credit-repair messaging.
//
// Two review rounds closed this defect one site at a time and both times it
// survived somewhere nobody had enumerated. Round 2's write-up said "there are
// exactly three places in this repository that print a customer's name onto a
// document"; a reviewer then found five, two of them outside src/, and rendered
// a Round 1 Experian letter headed `Client` and signed `Signature: ____ Client`.
//
// So this file does two things a per-site test cannot:
//
//   1. It EXERCISES every site in the class, by rendering, and asserts the same
//      one rule at each: a document that cannot be truthfully addressed refuses,
//      and the literal word "Client" is never a person's name on it.
//   2. It ENUMERATES the class off the filesystem and fails when a NEW site
//      appears — a fallback-to-a-word where a name goes, anywhere under src/ or
//      vendor/ — so the next one cannot be missed the way these were.
//
// The enumeration is deliberately a fixed, reviewed list rather than a grep
// scoped to one letter family: the round-2 grep was scoped to src/ and to
// metro2-only markers, which is exactly why it could not see the vendor writer.
// ═══════════════════════════════════════════════════════════════════════════════

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import path from "node:path";

import {
  NO_CONSUMER_NAME,
  isPlaceholderName,
  realConsumerName,
  requireConsumerName
} from "./consumer-name.mjs";
import { buildLetterText } from "./generate.mjs";
import { handwrittenSignOff, perjuryDeclaration } from "./sign-block.mjs";
import { buildFurnisherValidationLetter } from "./furnisher-validation.mjs";
import { buildCfpbComplaint, buildStateAgComplaint } from "./complaints.mjs";
import { buildDiyPackage } from "../diy/package.mjs";
import { renderLetterDraft } from "../../inquiry-ops/letter-draft.mjs";
import {
  personalFromClient,
  complaintIdentityFromPersonal,
  buildEscalationComplaints
} from "../../underwrite/letter-pack.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

/** Every stand-in a reviewer or a database has actually produced here. */
const NOT_NAMES = [
  undefined,
  null,
  "",
  "   ",
  "Client",
  "client",
  "  CLIENT  ",
  "The Client",
  "Consumer",
  "Customer",
  "Applicant",
  "N/A",
  "n/a",
  "unknown",
  "TBD",
  "[Consumer Name]",
  "[FULL LEGAL NAME]",
  "[Applicant Name]",
  "<name>",
  "{{name}}",
  "—",
  "123"
];

/** Names of real people that MUST still get their letters. */
const REAL_NAMES = [
  "Simone Repair-Vega",
  "Pat Client",          // somebody's actual surname
  "Client Okonkwo",      // and somebody's actual forename
  "Jean-Luc D'Angelo",
  "李 明",
  "Willie L Booze Jr."
];

const identity = (fullName) => ({
  fullName,
  addressLine1: "9 Oak Ave",
  city: "Austin",
  state: "TX",
  zip: "78701"
});

const violation = (ruleId, severity = "strong") => ({
  ruleId,
  severity,
  field: "21",
  observed: 1,
  expected: 0,
  reason: `Fixture ${ruleId}`,
  citations: ["15 U.S.C. § 1681e(b)"],
  metro2Ref: "Exhibit 4",
  creditor: "Midland",
  account_last4: "4521"
});

const bureauLetter = (fullName) =>
  buildLetterText({
    bureau: "EX",
    round: "R1",
    identity: identity(fullName),
    violations: [violation("M2-011")]
  });

const furnisherLetter = (fullName) =>
  buildFurnisherValidationLetter({
    identity: identity(fullName),
    furnisher: { name: "Midland Credit Management" },
    claims: [violation("M2-011")]
  });

const cfpb = (fullName) =>
  buildCfpbComplaint({
    identity: identity(fullName),
    bureau: "EX",
    violations: [violation("M2-011")]
  });

const stateAg = (fullName) =>
  buildStateAgComplaint({
    identity: identity(fullName),
    bureau: "EX",
    violations: [violation("M2-011")]
  });

// ─────────────────────────────────────────────────────────────────────────────
// 1. THE PREDICATE
// ─────────────────────────────────────────────────────────────────────────────

describe("the one predicate that decides what counts as a name", () => {
  it("answers NULL — never a substitute word — for every stand-in", () => {
    for (const value of NOT_NAMES) {
      assert.equal(isPlaceholderName(value), true, `accepted as a name: ${JSON.stringify(value)}`);
      assert.equal(
        realConsumerName(value),
        null,
        `did not answer null for ${JSON.stringify(value)}`
      );
    }
  });

  it("does not deny a real person their letters", () => {
    for (const name of REAL_NAMES) {
      assert.equal(isPlaceholderName(name), false, `a real name was refused: ${name}`);
      assert.equal(realConsumerName(name), name.replace(/\s+/g, " ").trim());
    }
  });

  it("collapses whitespace but never edits the name itself", () => {
    assert.equal(realConsumerName("  Simone   Repair-Vega  "), "Simone Repair-Vega");
  });

  it("refuses with one shared reason string", () => {
    assert.equal(NO_CONSUMER_NAME, "missing_consumer_name");
    assert.throws(() => requireConsumerName("Client", "test letter"), /missing_consumer_name/);
    assert.equal(requireConsumerName("Simone Repair-Vega"), "Simone Repair-Vega");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. EVERY SITE IN THE CLASS, PROVED BY RENDERING
// ─────────────────────────────────────────────────────────────────────────────

describe("every renderer refuses a document it cannot truthfully address", () => {
  /* Each entry renders something that leaves the building, and every one of
     these six returns the finished page as a plain string. `build` must throw
     for a stand-in name and must return the real name's page unchanged. */
  const SITES = [
    {
      where: "src/metro2/letters/generate.mjs buildLetterText — bureau dispute letter",
      build: bureauLetter
    },
    {
      where: "src/metro2/letters/sign-block.mjs handwrittenSignOff — the signature line",
      build: (n) => handwrittenSignOff(n)
    },
    {
      where: "src/metro2/letters/sign-block.mjs perjuryDeclaration — sworn under penalty of perjury",
      build: (n) => perjuryDeclaration(n, { stateName: "Texas" })
    },
    {
      where: "src/metro2/letters/furnisher-validation.mjs — validation demand to a collector",
      build: furnisherLetter
    },
    {
      where: "src/metro2/letters/complaints.mjs buildCfpbComplaint — federal regulator complaint",
      build: cfpb
    },
    {
      where: "src/metro2/letters/complaints.mjs buildStateAgComplaint — state attorney general complaint",
      build: stateAg
    }
  ];

  for (const site of SITES) {
    it(`REFUSES: ${site.where}`, () => {
      for (const value of NOT_NAMES) {
        assert.throws(
          () => site.build(value),
          /missing_consumer_name/,
          `built a document for ${JSON.stringify(value)} at ${site.where}`
        );
      }
    });

    it(`STILL BUILDS for a real person: ${site.where}`, () => {
      const out = site.build("Simone Repair-Vega");
      // Five of the six answer a plain string; buildFurnisherValidationLetter
      // answers {type, text, solYears}.
      const text = typeof out === "string" ? out : String(out.text);
      assert.match(text, /Simone Repair-Vega/, "the real name is not on the document");
      assert.doesNotMatch(
        text,
        /\bClient\b|\[Consumer Name\]|\[FULL LEGAL NAME\]|\[Applicant Name\]/,
        "a stand-in is still printed alongside the real name"
      );
    });
  }
});

describe("the DIY packet — the caller a review round recorded as unreachable", () => {
  const violationsByBureau = { EX: [violation("M2-011"), violation("M2-031")] };

  it("REFUSES the whole packet, with a reason the desk can act on", async () => {
    for (const value of NOT_NAMES) {
      const r = await buildDiyPackage({
        violationsByBureau,
        identity: identity(value),
        seed: "name-class"
      });
      assert.equal(r.ok, false, `a packet was built for ${JSON.stringify(value)}`);
      assert.equal(r.reason, NO_CONSUMER_NAME);
      assert.equal(r.stalled, true);
      assert.equal(r.files, undefined, "a refused packet still handed back files");
    }
  });

  it("renders a real packet with the real name and the word Client nowhere in it", async () => {
    const r = await buildDiyPackage({
      violationsByBureau,
      identity: identity("Simone Repair-Vega"),
      seed: "name-class"
    });
    assert.equal(r.ok, true, `a named client got no packet: ${r.reason}`);
    const texts = r.files.filter((f) => typeof f.text === "string");
    assert.ok(texts.length > 0, "the packet rendered no text");
    const withName = texts.filter((f) => /Simone Repair-Vega/.test(f.text));
    assert.ok(withName.length > 0, "no rendered page carries the client's name");
    for (const f of texts) {
      assert.doesNotMatch(
        f.text,
        /^Client$|\n\s*Client\s*\n|Signature: _+\s+Client/,
        `the literal word Client is printed on ${f.path}`
      );
    }
  });
});

describe("the inquiry-removal draft — the fifth site", () => {
  const inquiries = [{ id: "i1", furnisher: "Acme Bank", date: "2026-01-04" }];

  it("answers NULL rather than a draft signed Consumer", () => {
    for (const value of NOT_NAMES) {
      const [first, ...rest] = String(value ?? "").split(" ");
      const out = renderLetterDraft({
        bureau: "EX",
        client: { first_name: first, last_name: rest.join(" ") },
        inquiries
      });
      assert.equal(out, null, `a draft was written for ${JSON.stringify(value)}`);
    }
  });

  it("writes the draft for a real person", () => {
    const out = renderLetterDraft({
      bureau: "EX",
      client: { first_name: "Simone", last_name: "Repair-Vega" },
      inquiries
    });
    assert.ok(typeof out === "string" && out.length > 0);
    assert.match(out, /Simone Repair-Vega/);
    // The bureau's own "Consumer Dispute Department" is a department, not a
    // name, so the check is on the two places a NAME is printed: the letterhead
    // and the sign-off.
    assert.doesNotMatch(out, /<p>(Consumer|Client)<br>/);
    assert.doesNotMatch(out, /Sincerely,?<br>\s*(Consumer|Client)\b/);
  });
});

describe("the funding/repair letter pack and the vendor writer behind it", () => {
  it("personalFromClient answers NULL, never the word Client", () => {
    assert.equal(personalFromClient(null).name, null);
    assert.equal(personalFromClient({}).name, null);
    assert.equal(personalFromClient({ first_name: "", last_name: "" }).name, null);
    assert.equal(
      personalFromClient({ first_name: "Simone", last_name: "Repair-Vega" }).name,
      "Simone Repair-Vega"
    );
  });

  it("complaintIdentityFromPersonal refuses every stand-in, not just the word Client", () => {
    for (const value of NOT_NAMES) {
      assert.equal(
        complaintIdentityFromPersonal({ name: value }).fullName,
        "",
        `a complaint identity was minted for ${JSON.stringify(value)}`
      );
    }
    assert.equal(
      complaintIdentityFromPersonal({ name: "Simone Repair-Vega" }).fullName,
      "Simone Repair-Vega"
    );
  });

  it("the repair desk's own complaint pair is gated too — it is NOT a DIY-only document", async () => {
    // The gate above buildEscalationComplaints is `pack !== "repair"`, so this
    // builder fires ONLY on the repair path. Round 2's write-up said the opposite.
    const out = await buildEscalationComplaints({
      pack: "repair",
      personal: { name: "Client", address: "" },
      disputeLetters: [{ filename: "Experian-Dispute-Letter.pdf" }],
      onRepairPath: true
    });
    assert.deepEqual(out.files, []);
    assert.equal(out.skip, NO_CONSUMER_NAME);
  });

  it("the vendor writer refuses at the sender block, which is also the signature", () => {
    const src = readFileSync(
      path.join(REPO, "vendor/underwriteiq-full/api/lite/letter-generator.js"),
      "utf8"
    );
    // Read the CODE, not the comment above it — that comment quotes the old
    // line on purpose, and a naive grep for the old line matches the quote.
    const code = src
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .split("\n")
      .filter((l) => !/^\s*(\/\/|\*)/.test(l))
      .join("\n");
    assert.doesNotMatch(
      code,
      /\|\|\s*"Client"/,
      "senderLines still falls back to the literal word Client"
    );
    assert.match(code, /requireConsumerName\(personal && personal\.name/);
    // And it runs the SAME predicate as src/, not a second copy of the rule.
    assert.match(src, /src\/metro2\/letters\/consumer-name\.cjs/);
  });

  it("CommonJS and ESM load one predicate, not two", () => {
    const out = execFileSync(
      process.execPath,
      [
        "-e",
        'const m = require("./src/metro2/letters/consumer-name.cjs");' +
          'process.stdout.write(JSON.stringify([m.realConsumerName("Client"), m.realConsumerName("Pat Client")]));'
      ],
      { cwd: REPO, encoding: "utf8" }
    );
    assert.equal(out, JSON.stringify([null, "Pat Client"]));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. THE ENUMERATION ITSELF — so the NEXT site cannot be missed
// ─────────────────────────────────────────────────────────────────────────────

describe("the enumeration is kept honest", () => {
  /* Every place in src/ and vendor/ where a value that reaches a printed page
     falls back to a word instead of a name. Reviewed on 2026-09-06 by reading
     the filesystem, not by grepping one letter family's markers.

     A line here is either GATED (this lane closed it) or RECORDED with the
     reason it is not a false claim about a person. When this list and the tree
     disagree, this test fails and somebody has to look. */
  const ALLOWED = [
    // ── GATED BY THIS LANE ────────────────────────────────────────────────
    // The predicate itself, and the two renderers whose comments quote the
    // defect they closed.
    "src/metro2/letters/consumer-name.cjs",
    "src/metro2/letters/complaints.mjs",
    "src/underwrite/letter-pack.mjs",
    "vendor/underwriteiq-full/api/lite/letter-generator.js",

    // ── RECORDED, NOT A FALSE CLAIM ABOUT A PERSON ────────────────────────
    // Bracketed blanks on the funding / repair summary pages, which the CLIENT
    // reads. A visible blank asserts nothing about anybody, which is the right
    // outcome of an absent name. Reached from letter-pack; not in this lane.
    "vendor/underwriteiq-full/api/lite/crs/summary-doc-generator.js",
    // A byte-identical pair (md5 197d1e46afb19c2b883be8e403d553bd). Neither has
    // an importer anywhere in src/, api/, netlify/ or scripts/ — reached only by
    // two vendor demo scripts and a vendor test. Prints "[CONSUMER NAME]" and
    // "[Applicant Name]": blanks, not claims.
    "vendor/underwriteiq-full/api/lite/crs/render-pdf.js",
    "vendor/underwriteiq-crs/render-pdf.js",

    // ── HANDED OFF, STILL OPEN ────────────────────────────────────────────
    // A Vercel serverless handler inside the vendor app, absent from the
    // Netlify ROUTES map, so unreachable from this product.
    "vendor/underwriteiq-full/api/lite/crs-analyze.js",
    // Another lane owns src/underwrite/black-report-*. It still does
    // `String(who.name || "").trim() || "Client"` on a report a client reads.
    "src/underwrite/black-report-client.mjs",
    // A contract signer LABEL, not a letter to a bureau. Outside this lane.
    "src/contracts/send.mjs",

    // ── STAFF SCREENS — nothing here is printed onto a mailed document ────
    "src/sales/closer-deck.mjs",
    "src/sales/unrecorded.mjs",
    // Reviewed 2026-10-05. fundingSnapshotNumbersForClient() hands a "Client"
    // stand-in to buildBlackReportClient() only to get the two pre-approval
    // NUMBERS back; the name is dropped right there. What leaves the function
    // is { preapprovalNow, preapprovalAfter, prequalDisplay, source }, written
    // onto a staff welcome-kit task. Nothing with the word is printed or sent.
    "src/blueprint/welcome-kit.mjs"
  ];

  it("no NEW place substitutes a word where a person's name goes", () => {
    const out = execFileSync(
      "grep",
      [
        "-rlnE",
        String.raw`(\[(Consumer Name|CONSUMER NAME|FULL LEGAL NAME|Applicant Name)\])|(name[^;]*\|\| *"(Client|Consumer|Customer|Applicant|Borrower)")`,
        "src",
        "vendor"
      ],
      { cwd: REPO, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 }
    );
    const hits = out
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .filter((f) => !/node_modules|__pycache__|\/pdfjs\/|\.min\.|\.map$/.test(f))
      .filter((f) => !/(^|\/)__tests__\//.test(f))
      // Tests are excluded, this file included: a test that NAMES a placeholder
      // in order to assert it is refused is not a place one gets printed.
      .filter((f) => !/\.test\.(mjs|js|cjs)$/.test(f))
      .sort();

    const unexpected = hits.filter((f) => !ALLOWED.includes(f));
    assert.deepEqual(
      unexpected,
      [],
      "a name stand-in appeared somewhere this class has not been reviewed:\n" +
        unexpected.join("\n")
    );

    // And the reverse: an entry that no longer matches is a stale note. Reviewed
    // entries that were FIXED elsewhere should be struck from the list, not left
    // to rot into a claim nobody checked — which is the whole failure mode here.
    const stale = ALLOWED.filter((f) => !hits.includes(f));
    assert.deepEqual(
      stale,
      [],
      "these entries no longer match and should be removed from ALLOWED:\n" + stale.join("\n")
    );
  });
});
