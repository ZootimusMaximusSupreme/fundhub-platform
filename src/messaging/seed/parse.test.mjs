// Parser + validation tests. No Postgres required — everything here is pure.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  parseSmsCurrent,
  workflowTemplateKey,
  blockquoteBlocks,
  slugifyKey,
} from "./parse-sms.mjs";
import { parseEmailTemplates, parseHeader } from "./parse-email.mjs";
import { extractMergeTags, collectMergeTags } from "./merge-tags.mjs";
import { validate, readSources, SOURCES } from "./collect.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIX = path.join(HERE, "fixtures");
const read = (f) => fs.readFileSync(path.join(FIX, f), "utf8");

// ---------------------------------------------------------------- blockquotes

test("blockquoteBlocks: contiguous > lines are one block, a gap starts another", () => {
  const blocks = blockquoteBlocks(["> a", "> b", "", "not quoted", "> c"]);
  assert.equal(blocks.length, 2);
  assert.deepEqual(blocks[0].lines, ["a", "b"]);
  assert.deepEqual(blocks[1].lines, ["c"]);
});

test("blockquoteBlocks: strips exactly one space after '>', keeps the rest verbatim", () => {
  assert.deepEqual(blockquoteBlocks([">  two spaces"])[0].lines, [" two spaces"]);
  assert.deepEqual(blockquoteBlocks([">"])[0].lines, [""]);
});

// ------------------------------------------------------------- SMS current

test("parseSmsCurrent: one row per ## KEY header", () => {
  const rows = parseSmsCurrent(read("SMS-TEMPLATES-CURRENT.md"), "fixture");
  assert.deepEqual(rows.map((r) => r.templateKey), [
    "SMS-FIX-01-PLAIN",
    "SMS-FIX-02-SINGLE",
    "SMS-CLEAN-01-PLAIN",
    "SMS-BROKEN-01-EMPTY",
    "SMS-F03-01-ROUND-SUBMITTED",
  ]);
});

/* The session footer the 2026-08-21 sweep appended to every fixture block.
   The parser preserves body lines verbatim and has not changed since 2026-08-06;
   these expectations had simply never been updated to the fixture, which is why
   they sat red. Named once so the next footer change is one edit, not seven. */
const FOOTER = "\n\u2014 Chris at Fundhub. Reply STOP to opt out.";

test("parseSmsCurrent: plain-text body under the header, multi-line preserved", () => {
  const rows = parseSmsCurrent(read("SMS-TEMPLATES-CURRENT.md"), "fixture");
  const r = rows.find((x) => x.templateKey === "SMS-FIX-01-PLAIN");
  assert.equal(
    r.body,
    "Hey {{contact.first_name}}, line one.\nLine two with {{custom_values.booking_link}}." + FOOTER
  );
});

test("parseSmsCurrent: single-line body", () => {
  const rows = parseSmsCurrent(read("SMS-TEMPLATES-CURRENT.md"), "fixture");
  assert.equal(
    rows.find((x) => x.templateKey === "SMS-CLEAN-01-PLAIN").body,
    "Body sits directly under the header." + FOOTER
  );
});

test("parseSmsCurrent: a header with no body yields an empty body, not a throw", () => {
  const rows = parseSmsCurrent(read("SMS-TEMPLATES-CURRENT.md"), "fixture");
  assert.equal(rows.find((x) => x.templateKey === "SMS-BROKEN-01-EMPTY").body, "");
});

test("parseSmsCurrent: sms channel, no subject, compliance_passed true", () => {
  for (const r of parseSmsCurrent(read("SMS-TEMPLATES-CURRENT.md"), "doc.md")) {
    assert.equal(r.channel, "sms");
    assert.equal(r.subject, null);
    assert.equal(r.compliancePassed, true);
    assert.equal(r.sourceDoc, "doc.md");
  }
});

// -------------------------------------------------------- key helpers

test("slugifyKey: uppercases and collapses punctuation, em-dashes included", () => {
  assert.equal(slugifyKey("AI-SET-03 — No-Answer SMS Cadence"), "AI-SET-03-NO-ANSWER-SMS-CADENCE");
  assert.equal(slugifyKey("Closer Hiring | Interview Booked"), "CLOSER-HIRING-INTERVIEW-BOOKED");
  assert.equal(slugifyKey("AI-SET-04 — 3-Way Text Handoff"), "AI-SET-04-3-WAY-TEXT-HANDOFF");
});

test("workflowTemplateKey: strips the ⚠️ annotation and the (N messages) count", () => {
  assert.equal(
    workflowTemplateKey("DS-01 Repair Referral  ⚠️ needs your real link", 0),
    "SMS-WF-DS-01-REPAIR-REFERRAL-01"
  );
  assert.equal(
    workflowTemplateKey("AI-SET-03 — No-Answer SMS Cadence  (3 messages)", 2),
    "SMS-WF-AI-SET-03-NO-ANSWER-SMS-CADENCE-03"
  );
});

test("workflowTemplateKey: is deterministic — same header always yields the same key", () => {
  const a = workflowTemplateKey("Round Started — Client Notify", 0);
  const b = workflowTemplateKey("Round Started — Client Notify", 0);
  assert.equal(a, b);
  assert.equal(a, "SMS-WF-ROUND-STARTED-CLIENT-NOTIFY-01");
});

// ------------------------------------------------------------------- emails

test("parseHeader: splits KEY / Name / folder on runs of 2+ spaces", () => {
  assert.deepEqual(parseHeader("## AF-06   Affiliate Reactivation      [folder: (root)]"), {
    key: "AF-06",
    name: "Affiliate Reactivation",
    folder: "(root)",
  });
});

test("parseHeader: a header with only a key keeps an empty name", () => {
  assert.deepEqual(parseHeader("## AF   [folder: AF-Series (Affiliate Emails)]"), {
    key: "AF",
    name: "",
    folder: "AF-Series (Affiliate Emails)",
  });
});

test("parseHeader: single-space header absorbs the name into the key (reported, not guessed)", () => {
  assert.equal(parseHeader("## S-01 New Lead Intake   [folder: S - Series Sales Emails]").key, "S-01 New Lead Intake");
});

/* Same 2026-08-21 sweep as FOOTER above, in the email shape. EM-01 used to end
   in " Unsubscribe"; the sweep replaced that with the signature block. The
   parser is untouched since 2026-08-06 — only the fixture moved. */
const EMAIL_FOOTER = "\n\n\u2013 Chris\nFundHub.ai\n\nFundHub.ai \u2022 Funding Intelligence for Entrepreneurs";

test("parseEmailTemplates: first line is the subject, the rest is the body", () => {
  const rows = parseEmailTemplates(read("EMAIL-TEMPLATES-SOURCE-OF-TRUTH.md"), "fixture");
  const r = rows.find((x) => x.templateKey === "EM-01");
  assert.equal(r.subject, "Subject line one");
  assert.equal(r.body, " Hey {{contact.first_name}},\n\n Body line with {{sender_name}}." + EMAIL_FOOTER);
  assert.equal(r.channel, "email");
});

test("parseEmailTemplates: body copy is verbatim — the export's leading space survives", () => {
  const rows = parseEmailTemplates(read("EMAIL-TEMPLATES-SOURCE-OF-TRUTH.md"), "fixture");
  assert.ok(rows.find((x) => x.templateKey === "EM-01").body.startsWith(" Hey"));
});

test("parseEmailTemplates: emails are never marked compliance_passed", () => {
  for (const r of parseEmailTemplates(read("EMAIL-TEMPLATES-SOURCE-OF-TRUTH.md"), "fixture")) {
    assert.equal(r.compliancePassed, false);
  }
});

test("parseEmailTemplates: subject with no body yields an empty body, not a throw", () => {
  const rows = parseEmailTemplates(read("EMAIL-TEMPLATES-SOURCE-OF-TRUTH.md"), "fixture");
  const r = rows.find((x) => x.templateKey === "EM-EMPTY");
  assert.equal(r.subject, "Only a subject, no body");
  assert.equal(r.body, "");
});

// ---------------------------------------------------------------- merge tags

test("extractMergeTags: pulls raw tag names, trims inner whitespace", () => {
  assert.deepEqual(extractMergeTags("Hi {{contact.first_name}} — {{ cta-link }}"), [
    "contact.first_name",
    "cta-link",
  ]);
  assert.deepEqual(extractMergeTags(null), []);
});

test("collectMergeTags: distinct, sorted, counted, with the channels that use them", () => {
  const tags = collectMergeTags([
    { templateKey: "A", channel: "sms", subject: null, body: "{{contact.first_name}} {{x}}" },
    { templateKey: "B", channel: "email", subject: "{{x}}", body: "{{x}}" },
  ]);
  assert.deepEqual(tags.map((t) => t.tag), ["contact.first_name", "x"]);
  assert.deepEqual(tags[1], { tag: "x", count: 3, channels: ["email", "sms"], templateKeys: ["A", "B"] });
});

// ----------------------------------------------------------------- validate

function fixtureTemplates() {
  return readSources(FIX, SOURCES).templates;
}

test("validate: empty bodies are pulled out and never reach the seedable set", () => {
  const { seedable, problems } = validate(fixtureTemplates());
  assert.deepEqual(problems.emptyBody.map((p) => p.templateKey).sort(), ["EM-EMPTY", "SMS-BROKEN-01-EMPTY"]);
  assert.ok(!seedable.some((t) => t.templateKey === "SMS-BROKEN-01-EMPTY"));
  assert.ok(!seedable.some((t) => t.templateKey === "EM-EMPTY"));
});

test("validate: a byte-identical duplicate key collapses to a single row", () => {
  const { seedable, problems } = validate(fixtureTemplates());
  assert.equal(seedable.filter((t) => t.templateKey === "EM-SAME").length, 1);
  const p = problems.duplicates.find((d) => d.templateKey === "EM-SAME");
  assert.equal(p.resolution, "collapsed");
});

test("validate: a duplicate key with different copy keeps both, suffixing the later one", () => {
  const { seedable, problems } = validate(fixtureTemplates());
  const first = seedable.find((t) => t.templateKey === "EM-DUP");
  const second = seedable.find((t) => t.templateKey === "EM-DUP--2");
  assert.equal(first.body, " Body A." + EMAIL_FOOTER);
  assert.equal(second.body, " Body B." + EMAIL_FOOTER);
  assert.equal(second.disambiguatedFrom, "EM-DUP");
  assert.equal(problems.duplicates.find((d) => d.templateKey === "EM-DUP").resolution, "disambiguated");
});

test("validate: every seedable key is unique — the upsert can never silently overwrite", () => {
  const { seedable } = validate(fixtureTemplates());
  assert.equal(new Set(seedable.map((t) => t.templateKey)).size, seedable.length);
});

test("validate: keys carrying whitespace are seeded but reported", () => {
  const { seedable, problems } = validate(fixtureTemplates());
  assert.ok(problems.keyHygiene.some((p) => p.templateKey === "EM-04 Single Space Header"));
  assert.ok(seedable.some((t) => t.templateKey === "EM-04 Single Space Header"));
});

test("validate: is deterministic — same input, same rows in the same order", () => {
  const a = validate(fixtureTemplates()).seedable.map((t) => t.templateKey);
  const b = validate(fixtureTemplates()).seedable.map((t) => t.templateKey);
  assert.deepEqual(a, b);
});
