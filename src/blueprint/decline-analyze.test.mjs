// Decline defense — the reader. Pure: no database, no clock, no network.
//
// What this pins: every reason category names a real source; the bureau's own
// factor texts in the repo map to the right category; text the reader cannot
// place is "needs a person", never a guess; every worded plan line cites a
// source and every number in it comes from that source; blanks stay blank; the
// client's own numbers are masked; the tool the money agent calls is pure and
// carries no lender-book lines.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  analyzeDecline, readReasons, REASON_CATEGORIES, REASON_KEYS, SOURCE_KINDS, WHO, LOOKS_LIKE,
  maskSensitive, letterHash, findPhones, bureausNamed, normalizeBankName, bankKeys, rmOnFile,
  bookFacts, pickBookRows, letterDeadlines, catalogueText, categoryOf, outcomeWords, nextSequenceNote,
  dayOf, dayWords, TOOL, MASK_TEXT, S
} from "./decline-analyze.mjs";
import { DECLINE_REASONS } from "../autopsy/fields.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../..");
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");

/* The sample decline used across the B1 proof: the Blueprint sim client's own
   file has 4 hard inquiries (Experian 2), so the bank's reason is inquiries. One
   line is deliberately one no category covers. */
const SAMPLE = `Dear Sim Eleven-Blueprint,

Thank you for your recent application for a Chase Ink Business Cash credit card.
Unfortunately, we are unable to approve your request at this time. The principal reasons for our decision are:

- Too many inquiries in the last 12 months
- Requested credit line exceeds our guidelines

If you would like us to reconsider, please call 1-800-453-9719 within 30 days.

Our credit decision was based in whole or in part on information obtained in a report from the consumer reporting agency listed below. You have a right under the Fair Credit Reporting Act to know the information contained in your credit file at the consumer reporting agency. The reporting agency played no part in our decision and is unable to supply specific reasons why we have denied credit to you. You also have a right to a free copy of your report from the reporting agency, if you request it no later than 60 days after you receive this notice.

Experian, P.O. Box 2002, Allen, TX 75013, 1-888-397-3742, www.experian.com

Your credit score: 778
Key factors that adversely affected your credit score:
TOO MANY INQUIRIES LAST 12 MONTHS

The federal Equal Credit Opportunity Act prohibits creditors from discriminating against credit applicants on the basis of race, color, religion, national origin, sex, marital status, age.
Application number 123456789012
Sincerely, Chase Card Services`;

const letterFor = (reasonLine) => `Thank you for applying. Unfortunately, we are unable to approve your application.\nReasons:\n- ${reasonLine}\n`;

describe("the closed set of reason categories", () => {
  test("every category has plain words, recognisers, and at least one real source", () => {
    assert.ok(REASON_CATEGORIES.length >= 10);
    for (const c of REASON_CATEGORIES) {
      assert.ok(c.label && c.client_words, c.key);
      assert.ok(Array.isArray(c.patterns) && c.patterns.length > 0, c.key);
      assert.ok(Array.isArray(c.sources) && c.sources.length > 0, `${c.key} has no source`);
      for (const s of c.sources) {
        assert.ok(SOURCE_KINDS.includes(s.kind), `${c.key}: ${s.kind}`);
        assert.ok(String(s.ref || "").trim(), c.key);
      }
    }
  });

  test("the header comment documents every category with its source", () => {
    const src = read("src/blueprint/decline-analyze.mjs");
    const header = src.slice(0, src.indexOf("import "));
    for (const key of REASON_KEYS) assert.match(header, new RegExp(`\\b${key}\\b`), `${key} is not documented in the header`);
  });

  test("the migration's CHECK list is exactly this closed set", () => {
    const sql = read("db/migrations/470_blueprint_decline_defense.sql");
    const block = sql.match(/reason_categories <@ ARRAY\[([\s\S]*?)\]::text\[\]/)[1];
    const keys = [...block.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).sort();
    assert.deepEqual(keys, [...REASON_KEYS].sort());
  });

  test("every repo file a category cites exists", () => {
    for (const c of REASON_CATEGORIES) {
      for (const s of c.sources.filter((x) => x.kind === "repo")) {
        const file = s.ref.split(/\s+/)[0];
        assert.ok(fs.existsSync(path.join(ROOT, file)), `${c.key} cites ${file}, which is not in the repo`);
      }
    }
  });

  test("the autopsy reasons a category cites are real DECLINE_REASONS keys", () => {
    for (const c of REASON_CATEGORIES) {
      for (const s of c.sources.filter((x) => /DECLINE_REASONS/.test(x.ref))) {
        const named = s.ref.split("DECLINE_REASONS")[1].split(",").map((k) => k.trim()).filter(Boolean);
        for (const k of named) assert.ok(DECLINE_REASONS.includes(k), `${c.key} cites ${k}`);
      }
    }
  });

  test("the catalogue sentences a fix quotes are read from the engine, never copied", () => {
    for (const id of ["inquiries_many", "utilization_over_target", "negatives_some", "file_thin_partial"]) {
      assert.ok(catalogueText(id), id);
    }
    assert.equal(categoryOf("too_many_inquiries").fix[0].text, catalogueText("inquiries_many"));
  });
});

describe("the bureau's own factor texts map to the right category", () => {
  const factors = [];
  for (const file of ["vendor/underwriteiq-crs/sandbox/exp.json", "vendor/underwriteiq-crs/sandbox/efx.json"]) {
    const raw = read(file);
    for (const m of raw.matchAll(/"scoreFactorCode":\s*"(\d+)",\s*"scoreFactorText":\s*"([^"]+)"/g)) {
      factors.push({ file, code: m[1], text: m[2].replace(/\\r\\n/g, " ") });
    }
  }
  const want = { 8: "too_many_inquiries", 10: "high_utilization", 5: "accounts_with_balances", 38: "negative_items", 12: "short_history" };

  test("the sandbox files carry the factors the categories cite", () => {
    const codes = new Set(factors.map((f) => f.code));
    for (const code of Object.keys(want)) assert.ok(codes.has(code), `factor ${code} missing from the sandbox files`);
  });

  for (const [code, key] of Object.entries(want)) {
    test(`factor ${code} → ${key}`, () => {
      for (const f of factors.filter((x) => x.code === code)) {
        const { reasons } = readReasons(f.text);
        assert.deepEqual(reasons.map((r) => r.category), [key], `${f.file}: "${f.text}"`);
      }
    });
  }
});

describe("reading a letter", () => {
  test("the sample: inquiries found with the letter's own words; the odd line goes to a person", () => {
    const a = analyzeDecline({ text: SAMPLE, bank: "Chase", product: "Ink Business Cash", declined: true });
    assert.equal(a.looks_like, "decline");
    assert.deepEqual(a.reasons.map((r) => r.category), ["too_many_inquiries"]);
    assert.equal(a.reasons[0].evidence_quote, "Too many inquiries in the last 12 months");
    assert.deepEqual(a.unknown_parts, ["Requested credit line exceeds our guidelines"]);
    assert.equal(a.needs_person, true);
    assert.match(a.needs_person_why, /did not match/);
    assert.ok(a.recon_steps.some((s) => s.key === "read_unknown"));
    assert.deepEqual(a.bureaus_named, ["experian"]);
  });

  const cases = [
    ["Number of recent inquiries", "too_many_inquiries"],
    ["Proportion of balances to credit limits is too high", "high_utilization"],
    ["Too many accounts with balances", "accounts_with_balances"],
    ["Serious delinquency", "negative_items"],
    ["Length of time accounts have been established", "short_history"],
    ["Too many recently opened accounts", "too_many_new_accounts"],
    ["Your credit score is below our minimum", "credit_score"],
    ["Insufficient time in business", "business_too_new"],
    ["Insufficient income", "income_or_revenue"],
    ["Type of business", "industry"],
    ["We were unable to verify your identity", "could_not_verify"],
    ["Your credit report is frozen", "frozen_report"],
    ["No existing banking relationship with us", "bank_relationship"],
    ["Existing credit with us", "same_bank_exposure"]
  ];
  for (const [line, key] of cases) {
    test(`"${line}" → ${key}, quoting the letter`, () => {
      const text = letterFor(line);
      const a = analyzeDecline({ text, bank: "Example Bank", declined: true });
      const r = a.reasons.find((x) => x.category === key);
      assert.ok(r, `${key} not found in ${JSON.stringify(a.reasons.map((x) => x.category))}`);
      assert.ok(text.includes(r.evidence_quote), "the quote is the letter's own words");
    });
  }

  test("text it cannot map is needs-a-person, never a guess", () => {
    const a = analyzeDecline({ text: letterFor("The requested amount exceeds program limits"), bank: "Example Bank", declined: true });
    assert.deepEqual(a.reasons, []);
    assert.equal(a.needs_person, true);
    assert.deepEqual(a.unknown_parts, ["The requested amount exceeds program limits"]);
  });

  test("a letter with no reason in it at all is needs-a-person", () => {
    const a = analyzeDecline({ text: "Unfortunately we are unable to approve your application at this time. Thank you.", declined: true });
    assert.equal(a.reasons.length, 0);
    assert.equal(a.needs_person, true);
    assert.match(a.needs_person_why, /could not find a reason/);
    assert.equal(a.looks_like, "decline", "the person said the bank said no, so the plan still asks for a second look");
    assert.ok(a.recon_steps.some((s) => s.key === "call_recon"));
  });

  test("legal notices, greetings, addresses and the score line are never unknown parts", () => {
    const { unknown_parts } = readReasons(SAMPLE.replace("Requested credit line exceeds our guidelines", "Too many inquiries"));
    assert.deepEqual(unknown_parts, []);
  });

  test("an approval is not read as a decline, even when the person said it was", () => {
    const a = analyzeDecline({ text: "Congratulations! You have been approved for a credit limit of $25,000 on your new card.", declined: true });
    assert.equal(a.looks_like, "approval");
    assert.equal(a.needs_person, true);
    assert.ok(!a.recon_steps.some((s) => s.key === "call_recon"), "no reconsideration call on an approval");
  });

  test("a request for papers gets the Calling PENDING step, not a reconsideration push", () => {
    const a = analyzeDecline({ text: "Action needed: please provide additional documentation so we can verify your identity before we decide.", bank: "Truist" });
    assert.equal(a.looks_like, "needs_info");
    const s = a.recon_steps.find((x) => x.key === "call_pending");
    assert.ok(s);
    assert.equal(s.sources[0].ref, "Calling PENDING — Step 4-B");
    assert.ok(!a.recon_steps.some((x) => x.key === "call_recon"));
  });

  test("no text yet: the plan waits for the letter and a person reads it when it comes", () => {
    const a = analyzeDecline({ text: "", bank: "Chase", declined: true });
    assert.equal(a.needs_person, true);
    assert.match(a.needs_person_why, /no letter text yet/);
    assert.equal(a.recon_steps.find((s) => s.key === "get_letter").status, "open");
    assert.match(a.recon_steps.find((s) => s.key === "read_unknown").step, /when it comes in/);
  });
});

describe("the plan only says what a source says", () => {
  const letters = [SAMPLE, ...REASON_CATEGORIES.map((c) => letterFor(caseLine(c.key)))];
  function caseLine(key) {
    return ({
      too_many_inquiries: "Too many inquiries", high_utilization: "Utilization too high",
      accounts_with_balances: "Too many accounts with balances", negative_items: "Collection account",
      short_history: "Limited credit history", too_many_new_accounts: "Too many new accounts",
      credit_score: "Low credit score", business_too_new: "Time in business", income_or_revenue: "Insufficient revenue",
      industry: "Industry", could_not_verify: "Unable to verify information", frozen_report: "Credit file frozen",
      bank_relationship: "No relationship with the bank", same_bank_exposure: "Existing credit with us"
    })[key];
  }

  const NUMBER_WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve"];

  /* Every number a worded line uses must appear in one of its sources (the
     note, the ref, or the catalogue sentence it names). That is the "never
     invent a window or an amount" rule, checked. */
  function sourceText(sources) {
    return sources.map((s) => {
      const id = (/SUGGESTION_CATALOGUE\s+(\w+)/.exec(s.ref) || [])[1];
      return [s.ref, s.note || "", id ? catalogueText(id) || "" : ""].join(" ");
    }).join(" ");
  }

  test("every worded step cites a known source; every blank has no words and says what to write", () => {
    for (const text of letters) {
      const a = analyzeDecline({ text, bank: "Chase", product: "Ink Business Cash", declined: true });
      for (const s of a.recon_steps) {
        assert.ok(WHO.includes(s.who), s.key);
        assert.ok(String(s.client_step || "").trim(), `${s.key} has no client words`);
        if (s.blank) {
          assert.equal(s.step, null, s.key);
          assert.deepEqual(s.sources, [], s.key);
          assert.match(s.blank_label, /no source/i, s.key);
        } else {
          assert.ok(String(s.step || "").trim(), s.key);
          assert.ok(s.sources.length > 0, `${s.key} has no source`);
          for (const src of s.sources) assert.ok(SOURCE_KINDS.includes(src.kind), `${s.key}: ${src.kind}`);
        }
      }
    }
  });

  test("every number in a step, a fix or a timing line comes from its source", () => {
    for (const text of letters) {
      const a = analyzeDecline({ text, bank: "Chase", product: "Ink Business Cash", declined: true });
      const lines = [
        ...a.recon_steps.filter((s) => !s.blank).map((s) => ({ text: s.step, sources: s.sources })),
        ...[a.timing.call, a.timing.retries, a.timing.second_no].filter(Boolean),
        ...a.timing.reapply
      ];
      for (const line of lines) {
        const pool = sourceText(line.sources);
        for (const n of String(line.text).match(/\d+/g) || []) {
          const word = NUMBER_WORDS[Number(n)];
          const said = new RegExp(`(^|\\D)${n}(\\D|$)`).test(pool) || (word && new RegExp(`\\b${word}\\b`, "i").test(pool));
          assert.ok(said, `"${line.text}" uses ${n}, which its source does not: ${pool}`);
        }
      }
    }
  });

  test("timing quotes the letter's own deadline and never picks a day", () => {
    const a = analyzeDecline({ text: SAMPLE, bank: "Chase", declined: true });
    assert.deepEqual(a.timing.letter.map((l) => l.text), ["If you would like us to reconsider, please call 1-800-453-9719 within 30 days."]);
    assert.equal(a.timing.letter[0].sources[0].kind, "letter");
    assert.equal(a.timing.call_date, null);
    assert.equal(letterDeadlines("You also have a right to a free copy of your credit report from the agency within 60 days.").length, 0,
      "the free-report notice is about the report, not the decision");
  });

  test("the reconsideration script cites the Notion pages by title", () => {
    const a = analyzeDecline({ text: SAMPLE, bank: "Chase", declined: true });
    const ref = (k) => a.recon_steps.find((s) => s.key === k).sources.map((s) => s.ref).join(" + ");
    assert.match(ref("call_recon"), /Calling DENIED — Step 3/);
    assert.match(ref("ask_manual_review"), /Calling DENIED — Step 4/);
    assert.match(ref("call_again"), /Calling DENIED — Step 5/);
    assert.match(ref("second_no"), /Preparing Funding Plan/);
    assert.match(ref("ask_rm"), /Relationship Managers/);
  });

  test("a reason no source has a line for gets a blank for the ops person, not made-up words", () => {
    const a = analyzeDecline({ text: letterFor("Low credit score"), bank: "Example Bank", declined: true });
    const say = a.recon_steps.find((s) => s.key === "say:credit_score");
    const fix = a.recon_steps.find((s) => s.key === "fix:credit_score");
    assert.equal(say.blank, true);
    assert.equal(fix.blank, true);
    assert.ok(a.fix_first.some((f) => f.blank && f.category === "credit_score"));
  });

  /* Owner rule: Fundhub runs about six rounds inside one funding sequence, and
     the next one is "the next funding sequence". The old two-word name for it is
     built from pieces here so this file does not say it either. */
  test("the old name for the next funding sequence is not used anywhere in this unit", () => {
    const banned = new RegExp(["round", "[\\s-]*", "(?:two|2\\b)"].join(""), "i");
    for (const f of ["src/blueprint/decline-analyze.mjs", "src/blueprint/decline-defense.mjs", "api/blueprint/declines.mjs",
      "public/app/money-declines.js", "public/app/money-declines.html", "public/app/ccp-declines.js",
      "db/migrations/470_blueprint_decline_defense.sql", "docs/finance/decline-defense.md", "docs/journeys/decline-defense-flow.md",
      "src/blueprint/decline-analyze.test.mjs"]) {
      assert.doesNotMatch(read(f), banned, f);
    }
  });
});

describe("the client's own numbers", () => {
  test("an SSN, a long number and a date of birth are masked; the bank's phone is kept", () => {
    const { text, masked } = maskSensitive("SSN 123-45-6789. Ref 9876543210123. Date of birth: 01/02/1980. Call 1-800-453-9719.");
    assert.doesNotMatch(text, /123-45-6789|9876543210123|01\/02\/1980/);
    assert.match(text, /1-800-453-9719/);
    assert.equal(masked, 3);
    assert.equal(text, `SSN ${MASK_TEXT}. Ref ${MASK_TEXT}. Date of birth: ${MASK_TEXT}. Call 1-800-453-9719.`,
      "the number is replaced and nothing else around it changes");
  });

  test("the analysis never quotes a masked number", () => {
    const a = analyzeDecline({ text: `${letterFor("Too many inquiries")}\nSSN on file 123-45-6789`, declined: true });
    assert.doesNotMatch(JSON.stringify(a), /123-45-6789/);
  });

  test("the same letter twice is one hash, whatever the spacing", () => {
    assert.equal(letterHash("Too many  inquiries\n\nThanks"), letterHash("too many inquiries thanks"));
    assert.equal(letterHash("   "), null);
  });

  test("the bank's line is found; the credit bureau's address block is skipped", () => {
    assert.deepEqual(findPhones(SAMPLE).map((p) => p.number), ["800-453-9719"]);
    assert.deepEqual(bureausNamed("Equifax and TransUnion"), ["equifax", "transunion"]);
  });
});

describe("the bank", () => {
  test("bank names reduce to one key", () => {
    assert.equal(normalizeBankName("Chase Bank, N.A."), "chase");
    assert.equal(normalizeBankName("U.S. Bank"), "us");
    assert.deepEqual(bankKeys("Chase"), ["chase", "chasebank"]);
    assert.deepEqual(bankKeys(""), []);
  });

  test("an RM is on file only for the banks the RM list names", () => {
    for (const b of ["Chase", "JPMorgan Chase Bank", "US Bank", "U.S. Bank", "PNC Bank", "Truist", "Wells Fargo", "BlueVine"]) assert.equal(rmOnFile(b), true, b);
    for (const b of ["American Express", "Capital One", ""]) assert.equal(rmOnFile(b), false, b);
    const rms = read("docs/legacy-strong/bankers-rms.md");
    for (const b of ["Chase", "US Bank", "PNC", "Truist", "BlueVine", "Wells Fargo"]) assert.match(rms, new RegExp(b), `${b} is not in the RM list`);
  });

  const BOOK = [
    { id: "l1", name: "Truist", lender_table: "OnlineBizCC", requires_account_opening: "yes", relationship_required: null,
      insider_tips: "Business checking account required.; Can request cards via Truist Business OTP: 844-450-1985; Claim 6-figure net worth + $50k/month spend (unverified but helpful)", notes: "Source: Notion Deep State Datapoints (Legacy Strong)", bureaus_pulled: "EX" },
    { id: "l2", name: "Truist", lender_table: "PersonalCC", insider_tips: "Personal card tip", bureaus_pulled: "EQ" }
  ];

  test("book facts keep the decline-relevant lines and drop income and spend claims", () => {
    const f = bookFacts(BOOK, { bank: "Truist", product: "Business card" });
    assert.deepEqual(f.lender_ids, ["l1"], "a business product narrows to the business rows");
    assert.deepEqual(f.book_phones.map((p) => p.number), ["844-450-1985"]);
    assert.ok(f.book_notes.some((n) => /checking/.test(n.text)));
    assert.ok(!f.book_notes.some((n) => /net worth|spend|Source:/i.test(n.text)), JSON.stringify(f.book_notes));
    assert.equal(f.requires_account_opening, true);
    assert.equal(pickBookRows(BOOK, { product: "" }).length, 2);
  });

  test("book lines are ops steps with a book source; the bank's phone from the book closes the find step", () => {
    const a = analyzeDecline({ text: letterFor("A business checking account is required"), bank: "Truist", product: "Business card", lenders: BOOK, declined: true });
    const book = a.recon_steps.find((s) => s.key === "book:bank_relationship");
    assert.equal(book.who, "ops");
    assert.equal(book.sources[0].kind, "book");
    const find = a.recon_steps.find((s) => s.key === "find_recon_line");
    assert.equal(find.status, "done");
    assert.match(find.filled, /844-450-1985/);
  });
});

describe("the tool the money agent calls", () => {
  test("named, described, with a schema; run() is pure and carries no lender-book lines", () => {
    assert.equal(TOOL.name, "analyze_decline");
    assert.deepEqual(TOOL.input_schema.required, ["text"]);
    const out = TOOL.run({ text: SAMPLE, bank: "Chase", product: "Ink Business Cash", declined: true });
    assert.equal(out.ok, true);
    assert.deepEqual(Object.keys(out.bank_facts), ["rm_on_file"]);
    assert.ok(!out.recon_steps.some((s) => s.key.startsWith("book:")));
    assert.ok(out.reasons.length && out.recon_steps.length && out.timing && Array.isArray(out.fix_first));
    assert.ok(LOOKS_LIKE.includes(out.looks_like));
  });

  test("the module imports no database and no network", () => {
    const src = read("src/blueprint/decline-analyze.mjs");
    assert.doesNotMatch(src, /from "\.\.\/db|with-transaction|fetch\(|node:http|node:https/);
  });
});

describe("words for people", () => {
  test("outcome words and the next funding sequence note", () => {
    assert.equal(outcomeWords("open"), "Fundhub is working on it");
    assert.equal(outcomeWords("approved_on_recon"), "Approved after a second look");
    assert.equal(outcomeWords("reapply_later", "2026-12-01"), "We will try again on Dec 1, 2026");
    assert.equal(nextSequenceNote({ bank: "Chase", product: "Ink", outcome: "reapply_later", reapply_on: "2026-12-01" }),
      "Chase · Ink: re-apply on or after Dec 1, 2026.");
    assert.equal(nextSequenceNote({ bank: "Chase", outcome: "open" }), null);
  });

  test("a date column read back as a local Date keeps its calendar day", () => {
    assert.equal(dayOf(new Date(2026, 11, 1)), "2026-12-01");
    assert.equal(dayWords("2026-10-02"), "Oct 2, 2026");
    assert.equal(dayOf("not a date"), null);
  });

  test("the sources table has no brand name from the scrape and no price", () => {
    const blob = JSON.stringify(S);
    assert.doesNotMatch(blob, /Legacy Strong|\$\s?\d/);
  });
});
