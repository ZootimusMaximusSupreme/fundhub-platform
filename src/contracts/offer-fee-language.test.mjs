// THE PRICE IN THE CATALOGUE AND THE FEE IN THE CONTRACT MUST SAY THE SAME
// THING. This file fails when they stop.
//
// WHAT WENT WRONG, so the shape of these assertions makes sense.
// src/config/offers.mjs priced REPAIR_DFY at 100000 integer cents — $1,000,
// charged once. The contract wording seeded by
// db/migrations/169_contract_template_placeholders.sql read "You pay
// {{field.monthly_fee}} per month while services are active", and
// defaultContractValues() filled that blank with the SAME $1,000, alongside a
// 180-day term. Every repair client therefore signed for $1,000 a month for six
// months — $6,000 — against a $1,000 product. Nothing failed. Both halves were
// individually correct; only their meeting was wrong, and nothing was looking
// at the meeting. This file is what looks at it.
// db/migrations/273_repair_fee_charged_once.sql is the fix.
//
// FOUR CLASSES OF DRIFT ARE CAUGHT HERE:
//
//   1. The number disagrees. The blank a contract states a fee in no longer
//      carries the catalogue's priceCents.
//   2. The words disagree. The copy describes a repeating charge for a product
//      that is billed once.
//   3. The rename went half way. offers.mjs fills a blank the template does not
//      declare, or the template declares a required blank offers.mjs does not
//      fill — either way a client reads a fee line with nothing in it.
//   4. A new fee blank appears and nobody says what it is. Every money-shaped
//      blank has to be registered below as either a catalogue price or a
//      deliberate non-price.
//
// WHY THIS READS db/*.sql RATHER THAN A DATABASE. The .pg.test.mjs files skip
// without DATABASE_URL, and a guard that skips is not a guard — the same
// reasoning src/subscriptions/partner-subscriptions.test.mjs states. The SQL
// under db/ is what every environment is built from, so it is the honest
// source. It is read in db/migrate.mjs's own order (schema, migrations, seed;
// filenames sorted), and a later file superseding an earlier one is exactly
// what a later definition here does.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  OFFERS,
  formatCents,
  resolveContractTemplateKey,
  defaultContractValues
} from "../config/offers.mjs";
import { tagsIn, missingRequired, normaliseManualFields } from "./render.mjs";
import {
  CLIENT_AGREEMENT_KEYS, CONSENT_MARKERS, CONSENT_SECTION_NUMBERED, CONSENT_SECTION_PLAIN, NUMBERED_AGREEMENT_KEYS
} from "./consent-clauses.mjs";
import { readColumnCatalog, runContractSql } from "../pulse/catalog/proofs/fin-b04-sql-lite.mjs";
import { CONTRACT_DECK_SEND_SQL, CONTRACT_WORDINGS_SQL } from "../pulse/catalog/proofs/fin-b04-sql-flows.mjs";
import { CONSENT_CALL_RECORDING_SQL, CONSENT_MARKETING_USE_SQL } from "../pulse/catalog/proofs/consent-from-contract.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

/* ───────────────────────────────────────────────────────────────────────────
   The registry. Every blank in a contract that holds money is named here, on
   purpose, so that adding one is a decision somebody wrote down.

   FEE_BLANKS — this blank must equal that offer's priceCents, formatted.
   NON_PRICE_BLANKS — money-shaped, but not a catalogue price, with the reason.
   ─────────────────────────────────────────────────────────────────────────── */

const FEE_BLANKS = Object.freeze({
  "SOFT-PULL-CONSENT": [],            // an authorization; it states no fee at all
  "REPAIR-TRIAL-AGREEMENT": [{ field: "trial_fee", offer: "REPAIR_TRIAL" }],
  "CREDIT-REPAIR-AGREEMENT": [{ field: "one_time_fee", offer: "REPAIR_DFY" }],
  "FUNDING-AGREEMENT": [{ field: "deposit", offer: "FUNDING_DFY" }],
  "REPAIR-AND-FUNDING-AGREEMENT": [
    { field: "deposit", offer: "FUNDING_DFY" },
    { field: "repair_fee", offer: "REPAIR_DFY" }
  ],
  "FUNDING-MASTERY-AGREEMENT": [{ field: "program_fee", offer: "FUNDING_MASTERY" }],
  // Added 2026-09-03. Capital Blueprint had no contract template at all until
  // db/migrations/287_contract_seller_signature_and_real_text.sql — it was the
  // only client offer in the catalogue with none, so a Blueprint sale closed
  // with nothing to send and nothing anywhere said so.
  "CAPITAL-BLUEPRINT-AGREEMENT": [{ field: "package_fee", offer: "UWIQ_DELIVERABLES" }]
});

const NON_PRICE_BLANKS = Object.freeze({
  // A percentage of an amount nobody knows at signing, and the date it falls
  // due. Neither is a number this catalogue holds, so neither can be checked
  // against one.
  "FUNDING-AGREEMENT": ["success_fee", "fee_due"],
  "REPAIR-AND-FUNDING-AGREEMENT": ["success_fee", "fee_due"]
});

/* A blank whose name or label reads like money. Anything matching has to be in
   one of the two lists above. */
const MONEY_SHAPED = /(fee|price|cost|deposit|amount|payment|charge)/i;

/* Words that describe a charge that repeats. None of them may appear anywhere
   in a contract reachable from this catalogue, because every offer in it is a
   single charge — see the test that holds that premise. Negations are not
   special-cased on purpose: the copy is written to avoid the vocabulary
   altogether, which is a rule with no edge to argue about. */
const RECURRING =
  /(per\s+month|monthly|each\s+month|every\s+month|a\s+month|per\s+week|weekly|per\s+year|yearly|annually|annual|recurring|subscription|per\s+quarter|quarterly)/i;

/* recurringHit — the first mention of a repeating charge that is NOT a denial of one.
 *
 * "the copy is written to avoid the vocabulary altogether" held while every body was
 * synthesised in this repo. Chris's executed agreements are not, and they say:
 *
 *     "Tuition is five thousand dollars ($5,000), charged one time.
 *      There is no recurring billing and no subscription."
 *
 * A bare match on that sentence fails a document that states the rule this guard
 * exists to enforce, more plainly than the synthesised copy ever did — and the only
 * way to pass would be to delete a sentence out of an executed contract.
 *
 * So a hit inside a sentence that NEGATES it is not a hit. Everything else still is:
 * "billed monthly", "$1,000 per month" and "a monthly subscription" all have no
 * negation and all still fail, which is the $1,000-a-month defect (273) this was
 * written for. The negation must be in the same sentence, so "There is a monthly
 * fee. No refunds." cannot launder itself on a neighbour's "no". */
function recurringHit(text) {
  for (const sentence of String(text || "").split(/(?<=[.!?])\s+|\n/)) {
    const hit = sentence.match(RECURRING);
    if (!hit) continue;
    const before = sentence.slice(0, hit.index);
    if (/\b(no|not|never|without|nor)\b[^.!?]*$/i.test(before)) continue;
    return hit;
  }
  return null;
}

/* ───────────────────────────────────────────────────────────────────────────
   Reading the contract copy out of db/.
   ─────────────────────────────────────────────────────────────────────────── */

/** Full-line `--` comments only. A trailing one would need a string-aware
 *  scanner, and db/ has none inside these statements. */
const stripComments = (sql) =>
  sql.split("\n").filter((line) => !/^\s*--/.test(line)).join("\n");

/** Decode what Postgres' E'…' escape-string syntax means, for the parts db/
 *  actually uses: \n, \t, \\ and a doubled quote. */
function decodeEscapeLiteral(raw) {
  return raw
    .replace(/''/g, "'")
    .replace(/\\n/g, "\n")
    .replace(/\\t/g, "\t")
    .replace(/\\\\/g, "\\");
}

/** Every E'…' literal in a statement, concatenated. In db/ these are only ever
 *  used for a template body, so the concatenation IS the body. */
function bodyFrom(block) {
  const parts = [];
  for (let i = 0; i < block.length; i++) {
    const isStart =
      (block[i] === "E" || block[i] === "e") &&
      block[i + 1] === "'" &&
      !/[\w.]/.test(block[i - 1] || "");
    if (!isStart) continue;
    let j = i + 2;
    let buf = "";
    while (j < block.length) {
      const c = block[j];
      if (c === "\\") { buf += c + (block[j + 1] ?? ""); j += 2; continue; }
      if (c === "'") {
        if (block[j + 1] === "'") { buf += "''"; j += 2; continue; }
        break;
      }
      buf += c;
      j++;
    }
    parts.push(decodeEscapeLiteral(buf));
    i = j;
  }
  return parts.length ? parts.join("") : null;
}

/** The manual_fields array — the only '[ … ]'::jsonb literal in a statement. */
function fieldsFrom(block) {
  const m = [...block.matchAll(/'(\[[\s\S]*?\])'\s*::\s*jsonb/g)].pop();
  if (!m) return null;
  return normaliseManualFields(JSON.parse(m[1]));
}

/** Which template a statement is about. */
function keyFrom(block) {
  const insert = block.match(/VALUES\s*\(\s*v_org\s*,\s*'([A-Z0-9][A-Z0-9-]*)'/);
  if (insert) return insert[1];
  const update = block.match(/\bWHERE\b[\s\S]*?\btemplate_key\s*=\s*'([A-Z0-9][A-Z0-9-]*)'/);
  return update ? update[1] : null;
}

/** Price/scope patches replace exact literals in the previous full template. */
function applyBodyReplacements(block, body) {
  const replacements = [...block.matchAll(/'((?:[^']|'')*)'\s*,\s*'((?:[^']|'')*)'/g)];
  for (const [, before, after] of replacements) {
    body = body?.replaceAll(before.replace(/''/g, "'"), after.replace(/''/g, "'"));
  }
  return body;
}

/**
 * Every contract template db/ defines, as the last word on it wins.
 * Map<template_key, { body, fields, sources: string[] }>.
 */
function readTemplatesFromDb({ omitMigrations = new Set() } = {}) {
  const out = new Map();
  for (const dir of ["schema", "migrations", "seed"]) {
    const full = path.join(ROOT, "db", dir);
    if (!fs.existsSync(full)) continue;
    for (const name of fs.readdirSync(full).filter((f) => f.endsWith(".sql")).sort()) {
      // A seed file may be left out too (492's fresh-database half lives in db/seed).
      if ((dir === "migrations" || dir === "seed") && omitMigrations.has(name)) continue;
      const sql = fs.readFileSync(path.join(full, name), "utf8");
      if (!/contract_templates/.test(sql)) continue;
      const blocks = stripComments(sql)
        .split(/(?=INSERT INTO contract_templates|UPDATE contract_templates)/)
        .filter((b) => /^(INSERT INTO|UPDATE) contract_templates/.test(b.trim()));
      for (const block of blocks) {
        const key = keyFrom(block);
        if (!key) continue;
        const prev = out.get(key) || { body: null, fields: null, sources: [] };
        let body = bodyFrom(block);
        // A later price-only migration uses replace(body, old, new), so apply
        // its literal substitutions to the previously parsed full agreement.
        if (/SET body = (?:replace\()+body,/.test(block)) {
          body = applyBodyReplacements(block, prev.body);
        }
        const fields = fieldsFrom(block);
        out.set(key, {
          body: body ?? prev.body,
          fields: fields ?? prev.fields,
          sources: [...prev.sources, `${dir}/${name}`]
        });
      }
    }
  }
  return out;
}

const TEMPLATES = readTemplatesFromDb();

/* Every route from an offer to a piece of contract copy. The last entry is the
   combined tier, which resolves by tier rather than by offer key. */
const PATHS = Object.freeze([
  { label: "SOFT_PULL", offerKey: "SOFT_PULL", tier: null },
  { label: "FUNDING_DFY", offerKey: "FUNDING_DFY", tier: null },
  { label: "REPAIR_DFY", offerKey: "REPAIR_DFY", tier: null },
  { label: "REPAIR_TRIAL", offerKey: "REPAIR_TRIAL", tier: null },
  { label: "FUNDING_MASTERY", offerKey: "FUNDING_MASTERY", tier: null },
  { label: "UWIQ_DELIVERABLES", offerKey: "UWIQ_DELIVERABLES", tier: null },
  { label: "FUNDING_PLUS_REPAIR tier", offerKey: "FUNDING_DFY", tier: "FUNDING_PLUS_REPAIR" }
]);

const pathsWithTemplates = PATHS.map((p) => ({
  ...p,
  templateKey: resolveContractTemplateKey({ offerKey: p.offerKey, tier: p.tier }),
  values: defaultContractValues({ offerKey: p.offerKey, tier: p.tier })
})).filter((p) => p.templateKey);

describe("the copy this guard reads is really there", () => {
  // Without this, every assertion below could pass over an empty map — a guard
  // that silently stopped finding anything is worse than no guard.
  test("every contract the catalogue points at was found in db/", () => {
    assert.ok(pathsWithTemplates.length >= 7, "the offer catalogue stopped naming contracts");
    for (const p of pathsWithTemplates) {
      const tpl = TEMPLATES.get(p.templateKey);
      assert.ok(tpl, `${p.label}: no db/ file defines ${p.templateKey}`);
      assert.ok(tpl.body && tpl.body.length > 100, `${p.templateKey}: body did not parse`);
      /* ZERO BLANKS IS A LEGITIMATE STATE, and it is the better one.
         This used to demand at least one blank, which was right while every body
         was synthesised here with a {{field.program_fee}} to fill. Chris's executed
         agreements state their own price in their own words, so they have nothing
         to type — that is F27 (one-click send, owner-set) working, not a parse
         failure. What must never happen is a body that ASKS for a value nobody
         declared, so the pairing is checked in both directions instead. */
      assert.ok(Array.isArray(tpl.fields), `${p.templateKey}: blanks did not parse`);
      const asks = [...tpl.body.matchAll(/\{\{field\.([a-z0-9_]+)\}\}/gi)].map((m) => m[1]);
      const declared = new Set([
        ...tpl.fields.map((f) => f.key),
        ...(p.templateKey === "CAPITAL-BLUEPRINT-AGREEMENT" ? ["package_fee"] : [])
      ]);
      for (const key of asks) {
        assert.ok(declared.has(key),
          `${p.templateKey}: the words ask for {{field.${key}}} and no blank declares it, ` +
          `so it renders empty on the copy the client signs.`);
      }
      if (!tpl.fields.length) {
        assert.ok(asks.every((key) => declared.has(key)),
          `${p.templateKey}: a field tag has neither a form blank nor a server default.`);
      }
    }
  });

  test("169 is superseded, not edited — editing an applied migration is a no-op", () => {
    // db/migrate.mjs keys schema_migrations by '<dir>/<file>'. A database that
    // already ran 169 never reads it again, so "fixing" it in place changes
    // nothing anywhere and looks like a fix. The defective wording must still
    // be sitting in 169, with a later file correcting it.
    const original = fs.readFileSync(
      path.join(ROOT, "db", "migrations", "169_contract_template_placeholders.sql"), "utf8");
    assert.match(original, /\{\{field\.monthly_fee\}\} per month/,
      "169 was edited in place. Restore it and supersede it with a new numbered migration.");
    const tpl = TEMPLATES.get("CREDIT-REPAIR-AGREEMENT");
    assert.ok(tpl.sources.length >= 2,
      "nothing supersedes 169's repair wording — the monthly fee defect is back");
  });
});

describe("the fee a contract states is the price the catalogue charges", () => {
  for (const p of pathsWithTemplates) {
    const expected = FEE_BLANKS[p.templateKey];

    test(`${p.label}: ${p.templateKey} is registered`, () => {
      assert.ok(expected, `${p.templateKey} has no entry in FEE_BLANKS — add one`);
    });

    for (const { field, offer } of expected || []) {
      test(`${p.label}: ${field} is ${offer}'s price, to the cent`, () => {
        const price = formatCents(OFFERS[offer].priceCents);
        assert.ok(price, `${offer} has no usable priceCents`);
        assert.equal(
          p.values[field], price,
          `${p.templateKey} states its fee in {{field.${field}}}, and offers.mjs fills it ` +
          `with ${JSON.stringify(p.values[field])} while ${offer} costs ${price}. ` +
          `The client would sign for the wrong number.`
        );
      });
    }
  }

  test("a new money blank cannot appear unregistered", () => {
    for (const p of pathsWithTemplates) {
      const registered = new Set([
        ...(FEE_BLANKS[p.templateKey] || []).map((f) => f.field),
        ...(NON_PRICE_BLANKS[p.templateKey] || [])
      ]);
      for (const f of TEMPLATES.get(p.templateKey).fields) {
        if (!MONEY_SHAPED.test(f.key) && !MONEY_SHAPED.test(f.label)) continue;
        assert.ok(
          registered.has(f.key),
          `${p.templateKey} has a money blank "${f.key}" (${f.label}) that this guard ` +
          `does not know about. Add it to FEE_BLANKS with the offer whose price it holds, ` +
          `or to NON_PRICE_BLANKS with the reason it is not one.`
        );
      }
    }
  });
});

describe("no contract describes a charge that repeats", () => {
  test("the premise: every offer in the catalogue is a single charge", () => {
    // PartnerAddOn carries a `billing` field ("monthly" / "per_unit"); Offer has
    // no way to say it, and none of the add-ons has a contract template. If a
    // genuinely recurring CLIENT offer is ever added, this file has to be
    // reopened deliberately rather than quietly relaxed.
    for (const [key, offer] of Object.entries(OFFERS)) {
      assert.equal("billing" in offer, false,
        `${key} gained a billing shape — the fee-wording rule below assumes one charge`);
    }
  });

  /* THE GUARD'S OWN TEETH, pinned. recurringHit() learned to forgive a negated
     mention so an executed contract could say "There is no recurring billing"
     without failing. A forgiving rule that forgives too much is how a guard goes
     quietly blind, so the exact defect it exists to catch — 273's $1,000 a month —
     is asserted here as still failing. */
  test("recurringHit still catches a real repeating charge, and only forgives a denial", () => {
    assert.ok(recurringHit("You pay $1,000 per month for twelve months."), "a real monthly fee slipped through");
    assert.ok(recurringHit("This is billed monthly."), "a monthly bill slipped through");
    assert.ok(recurringHit("Your subscription renews automatically."), "a subscription slipped through");
    assert.ok(recurringHit("The fee is annual."), "an annual fee slipped through");
    assert.equal(recurringHit("Tuition is $5,000, charged one time. There is no recurring billing and no subscription."), null);
    assert.equal(recurringHit("There is no monthly fee."), null);
    // A neighbouring sentence's denial must not launder a real charge.
    assert.ok(recurringHit("There are no refunds. You pay $99 per month."),
      "a denial in one sentence excused a charge in the next");
  });

  for (const p of pathsWithTemplates) {
    test(`${p.templateKey} says nothing about a repeating charge`, () => {
      const tpl = TEMPLATES.get(p.templateKey);
      const hit = recurringHit(tpl.body);
      assert.equal(
        hit, null,
        `${p.templateKey} contains ${JSON.stringify(hit && hit[0])} — this product is ` +
        `charged once. Defined in: ${tpl.sources.join(" → ")}`
      );
    });

    test(`${p.templateKey}'s blanks are not named or explained as repeating`, () => {
      for (const f of TEMPLATES.get(p.templateKey).fields) {
        for (const [what, text] of [["key", f.key], ["label", f.label], ["help", f.help || ""]]) {
          const hit = String(text).match(RECURRING);
          assert.equal(
            hit, null,
            `${p.templateKey}: blank "${f.key}" has ${JSON.stringify(hit && hit[0])} in its ` +
            `${what}. That is how the $1,000-a-month defect was written in the first place.`
          );
        }
      }
    });
  }
});

describe("a rename cannot go half way", () => {
  for (const p of pathsWithTemplates) {
    test(`${p.templateKey}: every blank in the words is a blank on the form`, () => {
      const declared = new Set([
        ...TEMPLATES.get(p.templateKey).fields.map((f) => f.key),
        ...(p.templateKey === "CAPITAL-BLUEPRINT-AGREEMENT" ? ["package_fee"] : [])
      ]);
      for (const tag of tagsIn(TEMPLATES.get(p.templateKey).body)) {
        if (!tag.startsWith("field.")) continue;
        const key = tag.slice("field.".length);
        assert.ok(
          declared.has(key),
          `${p.templateKey} prints {{${tag}}} but declares no such blank, so nobody can ` +
          `fill it and it renders empty.`
        );
      }
    });

    test(`${p.templateKey}: offers.mjs fills every blank the contract requires`, () => {
      // This is the assertion that catches the other half of a rename: the
      // template says one_time_fee, offers.mjs still says monthly_fee, and the
      // fee line goes out blank.
      const missing = missingRequired(TEMPLATES.get(p.templateKey).fields, p.values);
      assert.deepEqual(
        missing, [],
        `${p.label}: defaultContractValues() leaves ${JSON.stringify(missing)} empty on ` +
        `${p.templateKey}. A required blank with nothing in it is a fee line with nothing in it.`
      );
    });
  }
});

/* ───────────────────────────────────────────────────────────────────────────
   THE PARTIES AND THE SIGNATURE BLOCK (F28 and F29, live walk 2026-09-03).

   These live in this file rather than a new one because it already parses the
   contract copy out of db/, and a second parser of the same SQL is the
   "two functions doing the same thing" bug CLAUDE.md §8 names — on the copy a
   client signs, of all places.

   F28: every client contract opened "Between: {{field.company_name}} ("we")",
   filled by a staff member at send time. On 2026-09-03 a closer typed the
   CLIENT's own company into it and a $5,000 Fundhub agreement went out saying
   the client's company was the seller. The seller is Fundhub LLC on every one,
   so it is a sentence in the template and not a value any screen can reach.

   F29: the bodies ended at "YOUR COPY" with no execution block, so the copy a
   client read and downloaded had nowhere on it that looked signed.
   ─────────────────────────────────────────────────────────────────────────── */

describe("the seller is Fundhub, written into the words", () => {
  for (const p of pathsWithTemplates) {
    test(`${p.templateKey} never prints a typed company name`, () => {
      const tpl = TEMPLATES.get(p.templateKey);
      assert.equal(
        /\{\{\s*field\.company_name\s*\}\}/.test(tpl.body), false,
        `${p.templateKey} still prints {{field.company_name}}. A staff member ` +
        `types that, and on 2026-09-03 one typed the client's own company into ` +
        `it and it rendered as the seller. Defined in: ${tpl.sources.join(" → ")}`
      );
      assert.equal(
        tpl.fields.some((f) => f.key === "company_name"), false,
        `${p.templateKey} still declares a company_name blank, so a screen can ` +
        `still put a box on the page for somebody to fill in.`
      );
    });

    test(`${p.templateKey} names Fundhub LLC itself`, () => {
      assert.match(
        TEMPLATES.get(p.templateKey).body, /Fundhub LLC/,
        `${p.templateKey} does not name the seller anywhere. Removing the blank ` +
        `without writing the party in leaves the document with no seller at all.`
      );
    });

    test(`${p.label}: nothing fills a company_name value any more`, () => {
      assert.equal(
        Object.prototype.hasOwnProperty.call(p.values, "company_name"), false,
        `defaultContractValues() still returns company_name for ${p.label}. The ` +
        `blank is gone from the copy, so a value for it is a live seam with ` +
        `nothing on the other end.`
      );
    });
  }
});

describe("every document carries its own signature block", () => {
  for (const p of pathsWithTemplates) {
    test(`${p.templateKey} has parties, a signed-by line and a date inside the body`, () => {
      const body = TEMPLATES.get(p.templateKey).body;

      /* TWO WORDINGS SATISFY THIS, and the property is what matters: the copy the
         client reads and downloads must carry an execution block, so the document
         does not end where a contract normally starts signing.

         Synthesised bodies (287, and the ones still awaiting real text) use a
         SIGNATURES section with ruled lines. Chris's executed agreements use their
         own Acknowledgement plus STUDENT / FUNDHUB EDUCATION blocks. Demanding the
         first wording would have failed the real documents, and the only way to
         pass would have been to append a SECOND signature block underneath theirs.

         Both shapes are checked strictly. A body with neither still fails, which is
         F29. */
      const synthesised = /\nSIGNATURES\n/.test(body);
      const executed = /\bSTUDENT\b/.test(body) && /FUNDHUB EDUCATION/i.test(body);
      assert.ok(synthesised || executed,
        `${p.templateKey} has no signature block in the words the client reads. ` +
        `Expected either a SIGNATURES section or the executed document's own ` +
        `STUDENT / FUNDHUB EDUCATION blocks.`);

      if (synthesised) {
        assert.match(body, /Signed by: an authorised signer of Fundhub LLC/,
          `${p.templateKey} does not say who signs for Fundhub.`);
        assert.match(body, /Signed by: _{6,}/,
          `${p.templateKey} gives the client nowhere that reads as a signature line.`);
        assert.match(body, /Date: _{6,}/,
          `${p.templateKey} has no date line for the client's signature.`);
        assert.match(body, /\{\{contact\.full_name\}\}/,
          `${p.templateKey} does not name the client in its signature block.`);
      } else {
        // Both sides sign, both sides date, and the client is still addressed by
        // name — the merge header carries that for an executed document.
        assert.ok((body.match(/^Signature\s*$/gm) || []).length >= 2,
          `${p.templateKey}: the executed block does not give both parties a signature line.`);
        assert.ok((body.match(/^Date\s*$/gm) || []).length >= 2,
          `${p.templateKey}: the executed block does not give both parties a date line.`);
        assert.match(body, /\{\{contact\.full_name\}\}/,
          `${p.templateKey} does not name the client anywhere in the document.`);
        assert.match(body, /Acknowledgement/i,
          `${p.templateKey} lost the acknowledgement that precedes the signatures.`);
      }
    });
  }
});

describe("the live defect, named", () => {
  test("Blueprint describes twelve months, the AI coach and the Fundhub team, and no automatic year-two charge", () => {
    const body = TEMPLATES.get("CAPITAL-BLUEPRINT-AGREEMENT").body;
    assert.match(body, /1\.1 Capital Blueprint is a twelve \(12\)-month educational planning and accountability program/);
    assert.match(body, /AI accountability coach supports routine progress and follow-up/);
    // Owner-set 2026-10-20 (migration 491): no named human advisor; the Fundhub team handles questions.
    assert.match(body, /The Fundhub team answers program questions and handles exceptions and funding preparation/);
    assert.match(body, /The Fundhub team handles program questions, exceptions and funding preparation/);
    assert.doesNotMatch(body, /human advisor/);
    assert.match(body, /text messages and automated voice calls, subject to your contact preferences/);
    assert.match(body, /No automatic renewal or charge after those twelve months is authorized/);
    assert.match(body, /continued paid access requires a separately stated price and your agreement before billing/);
    assert.doesNotMatch(body, /AI (?:accountability )?advisor/);
  });

  test("the draft program migration changes only its three approved clauses and never signed contracts", () => {
    const sql = fs.readFileSync(path.join(ROOT, "db/migrations/485_blueprint_program_scope.sql"), "utf8");
    assert.match(sql, /DRAFT/);
    const statements = stripComments(sql);
    assert.match(statements, /^UPDATE contract_templates/);
    assert.doesNotMatch(statements, /UPDATE contracts\b|DELETE|ALTER TABLE/);
    assert.match(statements, /WHERE template_key = 'CAPITAL-BLUEPRINT-AGREEMENT'/);
    // Judge 485 on its own: the later 491 advisor-wording change is proved separately below.
    const updated = readTemplatesFromDb({ omitMigrations: new Set(["491_blueprint_agreement_fundhub_team.sql"]) })
      .get("CAPITAL-BLUEPRINT-AGREEMENT").body;
    const previous = readTemplatesFromDb({ omitMigrations: new Set(["485_blueprint_program_scope.sql", "491_blueprint_agreement_fundhub_team.sql"]) })
      .get("CAPITAL-BLUEPRINT-AGREEMENT").body;
    const pairs = [...statements.matchAll(/'((?:[^']|'')*)'\s*,\s*'((?:[^']|'')*)'/g)];
    assert.equal(pairs.length, 3);
    assert.deepEqual(pairs.map(([, before]) => before.slice(0, 3)), ["1.1", "5.1", "6.1"]);
    assert.equal(applyBodyReplacements(statements, previous), updated);
    // This migration intentionally uses only nested built-in replace calls.
    // Assert the complete statement shape, including every closing delimiter.
    const shape = statements.replace(/'(?:[^']|'')*'/g, "STRING").replace(/\s+/g, " ").trim();
    assert.equal(shape, "UPDATE contract_templates SET body = replace(replace(replace(body, STRING, STRING), STRING, STRING), STRING, STRING), updated_at = now() WHERE template_key = STRING;");
    const section = (body, number) => body.match(new RegExp(`\\n${number}\\. [\\s\\S]*?(?=\\n${number + 1}\\. )`))?.[0];
    for (const number of [3, 7, 8]) {
      assert.ok(section(previous, number));
      assert.equal(section(updated, number), section(previous, number));
    }
    const removeApproved = (body) => body.split("\n").filter((line) => !/^(1\.1|5\.1|6\.1) /.test(line)).join("\n");
    assert.equal(removeApproved(updated), removeApproved(previous));
  });

  test("migration 491 swaps only the two advisor sentences for the Fundhub team", () => {
    const sql = fs.readFileSync(path.join(ROOT, "db/migrations/491_blueprint_agreement_fundhub_team.sql"), "utf8");
    const statements = stripComments(sql);
    assert.doesNotMatch(statements, /UPDATE contracts\b|DELETE|ALTER TABLE/);
    assert.match(statements, /WHERE template_key = 'CAPITAL-BLUEPRINT-AGREEMENT'/);
    const before = readTemplatesFromDb({ omitMigrations: new Set(["491_blueprint_agreement_fundhub_team.sql"]) })
      .get("CAPITAL-BLUEPRINT-AGREEMENT").body;
    const after = TEMPLATES.get("CAPITAL-BLUEPRINT-AGREEMENT").body;
    assert.equal((before.match(/human advisor/g) || []).length, 2);
    assert.equal(applyBodyReplacements(statements, before), after);
    const changed = before.split("\n").filter((line, i) => line !== after.split("\n")[i]);
    assert.deepEqual(changed.map((line) => line.slice(0, 3)), ["1.1", "6.1"]);
  });

  test("Blueprint uses the validated server price in both clauses without typed blanks", () => {
    const tpl = TEMPLATES.get("CAPITAL-BLUEPRINT-AGREEMENT");
    assert.deepEqual(tpl.fields, []);
    assert.equal((tpl.body.match(/\{\{field\.package_fee\}\}/g) || []).length, 2);
    assert.doesNotMatch(tpl.body, /five thousand|\$5,000/);
    assert.equal(defaultContractValues({ offerKey: "UWIQ_DELIVERABLES" }).package_fee, "$5,000");
    assert.match(tpl.body, /There is no recurring billing and no subscription\./);
  });

  test("credit repair is one payment of the catalogue price", () => {
    const tpl = TEMPLATES.get("CREDIT-REPAIR-AGREEMENT");
    assert.match(tpl.body, /\{\{field\.one_time_fee\}\}/,
      "the repair fee blank is no longer one_time_fee");
    assert.doesNotMatch(tpl.body, /monthly_fee/,
      "the repair contract still names a monthly fee blank");
    assert.match(tpl.body, /one time/i,
      "the repair contract no longer says the fee is charged one time");
    assert.equal(
      defaultContractValues({ offerKey: "REPAIR_DFY" }).one_time_fee,
      formatCents(OFFERS.REPAIR_DFY.priceCents)
    );
    assert.equal(formatCents(OFFERS.REPAIR_DFY.priceCents), "$1,000");
  });

  test("the repair trial was checked too, and is a single payment", () => {
    // REPAIR_TRIAL fills `trial_fee` — verified, not assumed. Its sentence
    // ("You pay {{field.trial_fee}} for the first done-for-you dispute round")
    // states one payment for one round, and the blank carries the $200 price.
    const tpl = TEMPLATES.get("REPAIR-TRIAL-AGREEMENT");
    assert.match(tpl.body, /You pay \{\{field\.trial_fee\}\} for the first/);
    assert.equal(
      defaultContractValues({ offerKey: "REPAIR_TRIAL" }).trial_fee,
      formatCents(OFFERS.REPAIR_TRIAL.priceCents)
    );
    assert.equal(formatCents(OFFERS.REPAIR_TRIAL.priceCents), "$200");
  });

  test("the combined agreement states the repair fee the same way", () => {
    const tpl = TEMPLATES.get("REPAIR-AND-FUNDING-AGREEMENT");
    assert.match(tpl.body, /\{\{field\.repair_fee\}\}[^.]*single payment/,
      "the combined agreement no longer says the repair fee is a single payment");
    assert.equal(
      defaultContractValues({ tier: "FUNDING_PLUS_REPAIR" }).repair_fee,
      formatCents(OFFERS.REPAIR_DFY.priceCents)
    );
  });
});

/* THE SIGNED CONTRACT IS THE CONSENT (owner decision 2026-10-20). Every client
   agreement carries one section saying calls may be recorded, Fundhub uses AI,
   and Fundhub may use the client's words, results and testimonial in marketing
   (db/migrations/492 and its fresh-database half db/seed/035). The heartbeat
   reads the same sentences in each signed copy. */
describe("every client agreement carries the consent", () => {
  // 493 (and its seed half 036) later replace the two placeholder bodies whole, so
  // 492 is judged on the wordings as they stood before 493.
  const LATER = ["493_funding_and_repair_agreement_text.sql", "036_funding_and_repair_agreement_text.sql"];
  const WITHOUT_492 = new Set(["492_client_agreement_consent_clauses.sql", "035_client_agreement_consent_clauses.sql", ...LATER]);
  const before = readTemplatesFromDb({ omitMigrations: WITHOUT_492 });
  const upTo492 = readTemplatesFromDb({ omitMigrations: new Set(LATER) });

  for (const key of CLIENT_AGREEMENT_KEYS) {
    test(`${key} says it once: recorded calls, AI, and marketing use`, () => {
      const body = TEMPLATES.get(key).body;
      for (const marker of Object.values(CONSENT_MARKERS)) {
        assert.equal(body.split(marker).length - 1, 1, `${key}: "${marker}" must appear exactly once`);
      }
    });

    test(`${key}: 492 adds the one section and changes no other word`, () => {
      const after = upTo492.get(key).body;
      const numbered = NUMBERED_AGREEMENT_KEYS.includes(key);
      const inserted = numbered ? `\n${CONSENT_SECTION_NUMBERED}\nAcknowledgement\n` : `\n\n${CONSENT_SECTION_PLAIN}\n\nSIGNATURES\n`;
      assert.ok(after.includes(inserted), `${key}: the section is not just above the signature block`);
      const removed = after.replace(numbered ? `\n${CONSENT_SECTION_NUMBERED}` : `\n\n${CONSENT_SECTION_PLAIN}`, "");
      assert.equal(removed, before.get(key).body);
    });
  }

  test("staff, partner and soft-pull wordings are not client service agreements and are untouched", () => {
    for (const [key, tpl] of TEMPLATES) {
      if (CLIENT_AGREEMENT_KEYS.includes(key)) continue;
      if (!before.has(key)) continue; // a wording first created after 492 (the 493 disclosure)
      assert.equal(tpl.body, upTo492.get(key)?.body, `${key} changed after 492`);
      assert.equal(tpl.body, before.get(key)?.body, `${key} changed`);
      assert.equal(tpl.body.includes(CONSENT_MARKERS.callRecording), false, `${key} gained the clause`);
    }
  });
});

/* NO CLIENT AGREEMENT IS A PLACEHOLDER (493, owner direction 2026-10-20). The
   Funding Agreement is the owner-approved ready-to-send text; the Credit Repair
   Agreement's placeholder block is replaced by finished terms, everything around
   it kept. */
describe("the two placeholder agreements carry real words", () => {
  const PLACEHOLDER = /NOT THE REAL AGREEMENT TEXT|>>>\s*PLACEHOLDER/i;
  const without493 = readTemplatesFromDb({ omitMigrations: new Set([
    "493_funding_and_repair_agreement_text.sql", "036_funding_and_repair_agreement_text.sql"
  ]) });

  test("before 493 both were placeholders, so the guard has something to catch", () => {
    assert.match(without493.get("FUNDING-AGREEMENT").body, PLACEHOLDER);
    assert.match(without493.get("CREDIT-REPAIR-AGREEMENT").body, PLACEHOLDER);
  });

  for (const key of CLIENT_AGREEMENT_KEYS) {
    test(`${key} carries no placeholder text`, () => {
      assert.doesNotMatch(TEMPLATES.get(key).body, PLACEHOLDER);
    });
  }

  test("the Funding Agreement is the owner-approved ready-to-send text, with the system's signature block", () => {
    const body = TEMPLATES.get("FUNDING-AGREEMENT").body;
    const approved = fs.readFileSync(path.join(ROOT, "docs/agreements/FUNDING-AGREEMENT-ready-to-send.txt"), "utf8");
    const sections = approved.split("\n\nFundhub LLC\nAuthorized signer:")[0];
    const oldBody = without493.get("FUNDING-AGREEMENT").body;
    assert.ok(body.startsWith(sections), "the approved sections 1-8 are not the body, word for word");
    assert.equal(body.slice(sections.length), "\n\n" + oldBody.slice(oldBody.indexOf("SIGNATURES\n")));
    assert.match(body, /\{\{field\.deposit\}\}/);
    assert.match(body, /\{\{field\.success_fee\}\}/);
  });

  test("the Credit Repair Agreement changes only its placeholder block", () => {
    const old = without493.get("CREDIT-REPAIR-AGREEMENT").body;
    const now = TEMPLATES.get("CREDIT-REPAIR-AGREEMENT").body;
    const endMark = ">>> END OF PLACEHOLDER <<<";
    const start = old.indexOf(">>> PLACEHOLDER.");
    const end = old.indexOf(endMark) + endMark.length;
    assert.ok(start > 0 && end > start);
    assert.ok(now.startsWith(old.slice(0, start)), "the words before the block changed");
    assert.ok(now.endsWith(old.slice(end)), "the words after the block changed");
    const terms = now.slice(start, now.length - (old.length - end));
    assert.match(terms, /Round one goes out the day you sign this agreement/);
    assert.match(terms, /up to six dispute rounds/);
    assert.match(terms, /30 to 45 days/);
    assert.match(terms, /The fee in WHAT YOU PAY below is charged when you sign this agreement/);
    assert.doesNotMatch(terms, /not charged or received until all services/);
    assert.match(terms, /you may request return of the fee you paid/);
    assert.match(terms, /THIRD BUSINESS DAY AFTER THE DATE YOU SIGNED IT/);
    assert.match(terms, /support@tryfundhub\.com/);
  });
});

/* The heartbeat judges these same words. Run the live checks' own SQL over the
   wordings rebuilt from db/: the send panel's wording check and the deck's Send
   contract check go green only after 493, and the two consent checks only after
   492. PASS and FAIL both shown. */
describe("the heartbeat's wording checks pass on the real words", () => {
  const ORG = "11111111-1111-4111-8111-111111111111";
  const CATALOG = readColumnCatalog(ROOT);
  const rows = (templates) => [...templates].map(([key, tpl], i) => ({
    id: `00000000-0000-4000-8000-${String(700 + i).padStart(12, "0")}`, org_id: ORG, template_key: key, name: key,
    active: true, is_demo: false, source_kind: "text", body: tpl.body, signature_statement: "I agree."
  }));
  const judge = (sql, templates) => {
    const out = runContractSql(sql, {
      tables: { orgs: [{ id: ORG }], contract_templates: rows(templates), contracts: [], clients: [], client_consents: [] },
      params: [ORG], now: "2026-10-20T20:00:00.000Z", catalog: CATALOG
    });
    return { sample: out.sample_count, bad: out.bad_count };
  };
  const before493 = readTemplatesFromDb({ omitMigrations: new Set([
    "493_funding_and_repair_agreement_text.sql", "036_funding_and_repair_agreement_text.sql"
  ]) });
  const before492 = readTemplatesFromDb({ omitMigrations: new Set([
    "492_client_agreement_consent_clauses.sql", "035_client_agreement_consent_clauses.sql",
    "493_funding_and_repair_agreement_text.sql", "036_funding_and_repair_agreement_text.sql"
  ]) });

  test("send panel wordings: PASS now, FAIL with the two placeholders", () => {
    assert.equal(judge(CONTRACT_WORDINGS_SQL, TEMPLATES).bad, 0);
    assert.equal(judge(CONTRACT_WORDINGS_SQL, before493).bad, 2);
  });

  test("deck Send contract: PASS now, FAIL with the two placeholders", () => {
    assert.deepEqual(judge(CONTRACT_DECK_SEND_SQL, TEMPLATES), { sample: 1, bad: 0 });
    assert.deepEqual(judge(CONTRACT_DECK_SEND_SQL, before493), { sample: 1, bad: 1 });
  });

  test("consent from the contract: PASS now, FAIL before 492", () => {
    for (const sql of [CONSENT_CALL_RECORDING_SQL, CONSENT_MARKETING_USE_SQL]) {
      assert.deepEqual(judge(sql, TEMPLATES), { sample: 1, bad: 0 });
      assert.deepEqual(judge(sql, before492), { sample: 1, bad: 1 });
    }
  });
});

/* 15 U.S.C. 1679c: the Consumer Credit File Rights statement, given to a credit
   repair client before any agreement is signed, as its own document (493). The
   words were copied from govinfo.gov; the repo copy is
   docs/agreements/CREDIT-FILE-RIGHTS-DISCLOSURE.txt. */
describe("the credit file rights disclosure is its own wording", () => {
  const KEY = "CREDIT-FILE-RIGHTS-DISCLOSURE";
  const file = fs.readFileSync(path.join(ROOT, "docs/agreements/CREDIT-FILE-RIGHTS-DISCLOSURE.txt"), "utf8").trimEnd();

  test("the wording is exactly the repo copy of the statement", () => {
    assert.equal(TEMPLATES.get(KEY)?.body, file);
    assert.deepEqual(TEMPLATES.get(KEY).fields, []);
  });

  test("it carries the statute's title, every right, and the FTC address", () => {
    const body = TEMPLATES.get(KEY).body;
    assert.ok(body.startsWith("Consumer Credit File Rights Under State and Federal Law\n"));
    for (const line of [
      "You have a right to dispute inaccurate information in your credit report by contacting the credit bureau directly.",
      "You have a right to obtain a copy of your credit report from a credit bureau.",
      "You have a right to sue a credit repair organization that violates the Credit Repair Organization Act.",
      "You have the right to cancel your contract with any credit repair organization for any reason within 3 business days from the date you signed it.",
      "Credit bureaus are required to follow reasonable procedures to ensure that the information they report is accurate.",
      "You may, on your own, notify a credit bureau in writing that you dispute the accuracy of information in your credit file.",
      "If the credit bureau's reinvestigation does not resolve the dispute to your satisfaction",
      "The Public Reference Branch\nFederal Trade Commission\nWashington, D.C. 20580"
    ]) assert.ok(body.includes(line), line);
    assert.match(body, /\nSIGNATURES\n/);
    assert.match(body, /Signed by: _{6,}/);
  });

  test("it is a separate document, never inside the agreement", () => {
    assert.equal(TEMPLATES.get("CREDIT-REPAIR-AGREEMENT").body.includes("Consumer Credit File Rights"), false);
    const sql = fs.readFileSync(path.join(ROOT, "db/migrations/493_funding_and_repair_agreement_text.sql"), "utf8");
    assert.match(sql, /'authorization',\s*'credit_file_rights_disclosure'/);
    assert.match(sql, /ON CONFLICT \(org_id, template_key\) DO NOTHING/);
    assert.match(sql, /govinfo\.gov\/content\/pkg\/USCODE-2023-title15/);
  });
});
