// src/marketing/script-file.mjs — one script, one repo file (spec §7.9, plan
// unit U25). No database, no network.
//
// What it proves: parse(serialize(x)) gives x back; the body comes back byte
// for byte however odd it is; the path is set once and never changes across
// edits; every path is one the repo outbox allows.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  serializeScript, parseScript, scriptSlug, scriptFilePath, scriptFolder, frontMatterOf,
  bodyHash, FRONT_MATTER_KEYS, SCRIPTS_DIR, ON_DEMAND, DATA_MARKER
} from "./script-file.mjs";
import { isAllowedRepoPath } from "../repo/allow-list.mjs";

const BODY = "MOST lenders read TWO files before they say yes.\n\nIf one is a mess, they never open the other.\n\nthe personal file\nthe business file\nwhich one they read first\n\nWe check both before you apply anywhere.\n\nTap below and see what both files say today.";

const PARTS = [
  { kind: "hook", text: "MOST lenders read TWO files before they say yes." },
  { kind: "line2", text: "If one is a mess, they never open the other." },
  { kind: "cue", text: "the personal file" },
  { kind: "cue", text: "the business file" },
  { kind: "cue", text: "which one they read first" },
  { kind: "reveal", text: "We check both before you apply anywhere." },
  { kind: "cta", text: "Tap below and see what both files say today." }
];

const ROW = Object.freeze({
  id: "00000000-0000-4000-8000-000000000101",
  root_script_id: "00000000-0000-4000-8000-000000000101",
  version: 1,
  status: "locked",
  ad_id: "91",
  title: "Lenders read two files",
  body: BODY,
  parts: PARTS,
  script_format: "standard",
  style: "bullets",
  funnel_key: "roadmap_147",
  angle_key: "two_files",
  hook_key: "two_files_lenders_read",
  offer_key: "slo_roadmap",
  batch_id: "00000000-0000-4000-8000-000000000301",
  batch_week_key: "2026-W42",
  animation_plan: [{ anchor: { cue: 1, keyword: "personal" }, template: "FileItems", props: {}, seconds: 2.5 }],
  meta_copy: { primary_text: "Lenders read two files.", headline: "See both files first", description: "Your Funding Roadmap", cta_type: "LEARN_MORE" },
  repo_path: null,
  file_n: 3,
  updated_by: "00000000-0000-4000-8000-000000000002",
  updated_at: new Date("2026-10-12T15:06:00.000Z")
});

const expected = (row) => ({ ...frontMatterOf(row), body: row.body, parts: row.parts ?? null, animation_plan: row.animation_plan ?? null, meta_copy: row.meta_copy ?? null });

describe("serializeScript / parseScript", () => {
  test("parse(serialize(x)) gives back every front matter value, the body and the JSON block", () => {
    const { path, content } = serializeScript(ROW);
    assert.equal(path, "marketing/ads/scripts/machine/2026-W42/03-lenders-read-two-files.md");
    const back = parseScript(content);
    assert.deepEqual(back, expected(ROW));
    assert.equal(back.ad, "91", "the ad number stays a string of digits");
    assert.equal(back.version, 1);
    assert.equal(back.updated_at, "2026-10-12T15:06:00.000Z");
    assert.equal(back.batch, "2026-W42");
  });

  test("the front matter holds the eleven flat keys, in order, and nothing nested", () => {
    const { content } = serializeScript(ROW);
    const fm = content.slice(4, content.indexOf("\n---\n", 3)).split("\n");
    assert.deepEqual(fm.map((l) => l.split(":")[0]), [...FRONT_MATTER_KEYS]);
    assert.ok(fm.every((l) => !l.includes("{") && !l.includes("[")), "no object or list in the front matter");
    assert.ok(content.includes("\nad: 91\n"));
    assert.ok(content.includes("\nangle: two_files\n"));
  });

  test("odd bodies come back byte for byte", () => {
    const bodies = [
      "one line, no newline at the end",
      "ends with a newline\n",
      "ends with two\n\n",
      "\n\nstarts with blank lines",
      "CRLF line ends\r\nsecond line\r\n",
      "---\nlooks like front matter\n---\nstill body",
      "has a fence\n```json\n{\"parts\": []}\n```\nafter it",
      `has the marker itself\n\n${DATA_MARKER}\n\`\`\`json\n{"x":1}\n\`\`\`\nand more words`,
      "unicode ↑ CAPS — dash, “quotes”, émojis 🎬, tabs\tand  double  spaces",
      "   leading and trailing spaces   "
    ];
    for (const body of bodies) {
      const row = { ...ROW, body };
      const back = parseScript(serializeScript(row).content);
      assert.equal(back.body, body, `body changed: ${JSON.stringify(body)}`);
      assert.equal(bodyHash(back.body), bodyHash(body));
      assert.deepEqual(back.parts, PARTS);
    }
  });

  test("odd front matter values round-trip: nulls, spaces, quotes, words that read as null", () => {
    const row = {
      ...ROW,
      ad_id: null,
      status: "draft",
      offer_key: null,
      funnel_key: "null",
      angle_key: "true",
      script_format: "has space",
      style: "-dash",
      batch_week_key: null,
      batch_id: null,
      updated_by: 'says "hi"\nand a newline',
      parts: null,
      animation_plan: null,
      meta_copy: null,
      repo_path: "marketing/ads/scripts/machine/on-demand/01-x.md"
    };
    const back = parseScript(serializeScript(row).content);
    assert.deepEqual(back, expected(row));
    assert.equal(back.ad, null);
    assert.equal(back.funnel, "null", "the word null as a value is not null");
    assert.equal(back.angle, "true");
    assert.equal(back.batch, null);
  });

  test("a parsed file serializes to the very same text (stable)", () => {
    const a = serializeScript(ROW).content;
    const p = parseScript(a);
    const b = serializeScript({
      ...ROW, ad_id: p.ad, version: p.version, status: p.status, offer_key: p.offer, funnel_key: p.funnel,
      script_format: p.format, style: p.style, angle_key: p.angle, batch_week_key: p.batch,
      updated_by: p.updated_by, updated_at: p.updated_at, body: p.body, parts: p.parts,
      animation_plan: p.animation_plan, meta_copy: p.meta_copy
    }).content;
    assert.equal(b, a);
  });

  test("files this module did not write are refused in plain words", () => {
    assert.throws(() => parseScript("no front matter"), /no front matter/);
    assert.throws(() => parseScript("---\nad: 1\n"), /never ends/);
    assert.throws(() => parseScript("---\nad: 1\n---\nbody only\n"), /no data block/);
    const ok = serializeScript(ROW).content;
    assert.throws(() => parseScript(ok.replace("version: 1", "version: one")), /version/);
    assert.throws(() => parseScript(ok.replace("\nstatus: locked\n", "\nstatus: locked\nstatus: draft\n")), /twice/);
    assert.throws(() => parseScript(ok.replace('"parts"', "parts")), /not JSON/);
    assert.throws(() => serializeScript({ ...ROW, body: "  " }), /body/);
    assert.throws(() => serializeScript({ ...ROW, version: 0 }), /version/);
  });
});

describe("the path", () => {
  test("first save: <week or on-demand>/<nn>-<slug>.md, and it needs the script's place", () => {
    assert.equal(serializeScript({ ...ROW, file_n: 12 }).path, `${SCRIPTS_DIR}2026-W42/12-lenders-read-two-files.md`);
    assert.equal(serializeScript({ ...ROW, batch_week_key: null }).path, `${SCRIPTS_DIR}${ON_DEMAND}/03-lenders-read-two-files.md`);
    assert.throws(() => serializeScript({ ...ROW, file_n: undefined }), /file_n/);
    assert.equal(scriptFolder("2026-W42"), "2026-W42");
    assert.equal(scriptFolder(null), ON_DEMAND);
    assert.equal(scriptFolder("../etc"), ON_DEMAND, "a week that is not a week never becomes a folder");
  });

  test("the path never changes across edits: a saved repo_path wins over everything", () => {
    const first = serializeScript(ROW).path;
    const edited = {
      ...ROW, repo_path: first, version: 2, title: "A whole new title", angle_key: "other",
      batch_week_key: "2026-W50", file_n: 9, body: "New words.\n", status: "locked"
    };
    assert.equal(serializeScript(edited).path, first);
    assert.equal(serializeScript({ ...edited, version: 3, file_n: undefined }).path, first);
  });

  test("slugs: from the title, else the angle or hook key, else 'script'; short, a-z 0-9 and dashes", () => {
    assert.equal(scriptSlug({ title: "Lenders read TWO files!" }), "lenders-read-two-files");
    assert.equal(scriptSlug({ title: "Crédit — ¿qué?" }), "credit-que");
    assert.equal(scriptSlug({ title: "   ", angle_key: "two_files" }), "two-files");
    assert.equal(scriptSlug({ hook_key: "hook_9" }), "hook-9");
    assert.equal(scriptSlug({}), "script");
    const long = scriptSlug({ title: "word ".repeat(40) });
    assert.ok(long.length <= 60 && /^[a-z0-9]+(-[a-z0-9]+)*$/.test(long), long);
  });

  test("every path it makes is one the repo outbox allows", () => {
    for (const row of [ROW, { ...ROW, batch_week_key: null }, { ...ROW, title: "../../etc/passwd" }, { ...ROW, title: null, angle_key: null }]) {
      const p = serializeScript(row).path;
      assert.ok(isAllowedRepoPath(p), p);
    }
    assert.throws(() => scriptFilePath({ weekKey: "2026-W42", n: 0, slug: "x" }), /n must/);
    assert.throws(() => scriptFilePath({ weekKey: "2026-W42", n: 1, slug: "../x" }), /slug/);
  });
});
