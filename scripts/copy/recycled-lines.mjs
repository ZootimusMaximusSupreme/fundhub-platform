#!/usr/bin/env node
// The parrot check (Chris, 2026-10-31): new copy may not repeat his existing
// ads, VSLs and call scripts, or another piece in the same batch, word for
// word. "You're just regurgitating all of my scripts. Just recycling the copy.
// It's not what I want you to do." Law: .ai/rules/ad-no-recycled-lines.md.
//
// A run of RUN words in a row that also appears in another source is a
// recycled line. Chris's own set phrases (ALLOWED) may repeat: they are
// masked before the runs are compared, so a line is never flagged for
// carrying "the maximum amount of funding" or the guarantee line.
//
// A machine check catches copied words. It does not catch the same angle said
// again in new words; the copy reviewer (marketing/copy-skills/copy-reviewer/)
// reads for that.
//
//   node scripts/copy/recycled-lines.mjs <file> [file ...]   check these files
//   node scripts/copy/recycled-lines.mjs --json <file> ...   the same, as JSON
//
// Files are .html slideshow decks (headline, lede, lines and talk track are
// read; pictures and source notes are not), or .md / .txt copy.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { basename, dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
export const REPO = resolve(here, "../..");

/** Words in a row that count as a copied line. */
export const RUN = 7;

/** Where Chris's existing marketing words live: ad scripts, VSLs, the ad rule
 *  book's examples, the nurture copy and the call scripts. */
export const CORPUS_DIRS = ["marketing/ads", "marketing/vsl", "docs/sops/weekend-2026-10-24"];

/** Owner-set wording that is meant to repeat. Each source line is cited. */
export const ALLOWED = [
  // The guarantee line, word for word (copybot/references/owner-voice.md:18).
  "Applications go out within 72 business hours.",
  "That's our guarantee, and it's in your contract.",
  "That typically means approvals come very shortly after.",
  // .ai/rules/copy-certainty.md
  "how much you qualify for based on where you're at right now",
  // Expressions to use (copybot/references/owner-voice.md:15) and Chris's memory rules.
  "the maximum amount of funding",
  "review your file the way a lender does",
  "we don't let people slip through the cracks",
  "you follow directions, you get there",
  "action takers, not shoppers",
];

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", rsquo: "'", lsquo: "'",
  ldquo: '"', rdquo: '"', middot: "·", mdash: "—", ndash: "–", hellip: "…" };

export function plain(html) {
  return html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
      if (e[0] === "#") return String.fromCodePoint(e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : Number(e.slice(1)));
      return ENTITIES[e.toLowerCase()] ?? m;
    })
    .replace(/\s+/g, " ")
    .trim();
}

/** Lowercase word tokens. "$100,000" -> "$100000", "you're" -> "youre". */
export function words(s) {
  return String(s)
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/(\d),(\d)/g, "$1$2")
    .replace(/'/g, "")
    .match(/[a-z0-9$%]+/g) || [];
}

const ALLOWED_TOKENS = ALLOWED.map(words).filter((t) => t.length).sort((a, b) => b.length - a.length);

/** Replace every owner-set phrase with one placeholder token, so it never counts as copying. */
export function mask(tokens) {
  const out = [];
  for (let i = 0; i < tokens.length; ) {
    let hit = -1;
    for (let k = 0; k < ALLOWED_TOKENS.length; k += 1) {
      const p = ALLOWED_TOKENS[k];
      if (i + p.length <= tokens.length && p.every((w, j) => tokens[i + j] === w)) { hit = k; break; }
    }
    if (hit >= 0) { out.push(`§${hit}`); i += ALLOWED_TOKENS[hit].length; } else { out.push(tokens[i]); i += 1; }
  }
  return out;
}

export function shingles(text, run = RUN) {
  const t = mask(words(text));
  const out = [];
  for (let i = 0; i + run <= t.length; i += 1) out.push(t.slice(i, i + run).join(" "));
  return out;
}

export function sentences(text) {
  return String(text).split(/(?<=[.!?])\s+|\n+/).map((s) => s.trim()).filter(Boolean);
}

/** The spoken and shown words of a slideshow deck: headline, lede, lines and
 *  talk track of each slide, labeled by the slide's code. Pictures (real
 *  report text, agreement clauses) and source notes are left out on purpose:
 *  real proof is supposed to repeat. */
export function deckSegments(html) {
  const out = [];
  const slides = [...html.matchAll(/<section class="slide\b[^"]*"[^>]*>([\s\S]*?)<\/section>/g)].map((m) => m[1]);
  slides.forEach((sec, k) => {
    const code = plain((/<p class="eyebrow">([\s\S]*?)<\/p>/.exec(sec) || ["", ""])[1]).split("/")[0].trim() || `slide ${k + 1}`;
    const add = (part, raw) => { for (const s of sentences(plain(raw))) out.push({ where: `${code} ${part}`, text: s }); };
    for (const m of sec.matchAll(/<h2[^>]*>([\s\S]*?)<\/h2>/g)) add("headline", m[1]);
    for (const m of sec.matchAll(/<p class="lede"[^>]*>([\s\S]*?)<\/p>/g)) add("lede", m[1]);
    for (const ul of sec.matchAll(/<ul class="lines"[^>]*>([\s\S]*?)<\/ul>/g)) {
      for (const li of ul[1].matchAll(/<li[^>]*>([\s\S]*?)<\/li>/g)) add("line", li[1]);
    }
    for (const a of sec.matchAll(/<aside class="talk"[^>]*>([\s\S]*?)<\/aside>/g)) {
      for (const li of a[1].matchAll(/<li[^>]*>([\s\S]*?)<\/li>/g)) add("talk", li[1]);
    }
  });
  return out;
}

export function fileSegments(file) {
  const raw = readFileSync(file, "utf8");
  if (extname(file) === ".html") return deckSegments(raw);
  return sentences(raw.replace(/[#*>`_|]/g, " ")).map((text, i) => ({ where: `line ${i + 1}`, text }));
}

function walk(dir) {
  let out = [];
  let names = [];
  try { names = readdirSync(dir); } catch { return out; }
  for (const n of names) {
    const p = join(dir, n);
    let st;
    try { st = statSync(p); } catch { continue; }
    if (st.isDirectory()) out = out.concat(walk(p));
    else if (/\.(md|txt)$/i.test(n)) out.push(p);
  }
  return out;
}

/** Chris's existing marketing words, one entry per file. */
export function loadCorpus(repo = REPO, dirs = CORPUS_DIRS) {
  return dirs.flatMap((d) => walk(join(repo, d))).map((p) => ({ name: relative(repo, p), text: readFileSync(p, "utf8") }));
}

/**
 * targets: [{ name, segments: [{ where, text }] }]
 * corpus:  [{ name, text }]
 * Returns [{ name, where, sentence, source, run }]: every target sentence that
 * shares a RUN-word run with a corpus file or with a different target.
 */
export function findRecycled({ targets, corpus, run = RUN }) {
  const index = new Map();
  const add = (key, src) => { let s = index.get(key); if (!s) index.set(key, (s = new Set())); s.add(src); };
  const targetNames = new Set(targets.map((t) => t.name));
  for (const c of corpus) {
    if (targetNames.has(c.name)) continue;
    for (const key of shingles(c.text, run)) add(key, c.name);
  }
  for (const t of targets) for (const seg of t.segments) for (const key of shingles(seg.text, run)) add(key, `#${t.name}`);

  const findings = [];
  for (const t of targets) {
    for (const seg of t.segments) {
      for (const key of shingles(seg.text, run)) {
        const others = [...(index.get(key) || [])].filter((s) => s !== `#${t.name}`);
        if (!others.length) continue;
        const source = others[0].startsWith("#") ? others[0].slice(1) : others[0];
        findings.push({ name: t.name, where: seg.where, sentence: seg.text, source, run: key.replace(/§\d+/g, "…") });
        break;
      }
    }
  }
  return findings;
}

function main(argv) {
  const json = argv.includes("--json");
  const files = argv.filter((a) => !a.startsWith("--")).map((a) => resolve(a));
  if (!files.length) {
    console.error("usage: node scripts/copy/recycled-lines.mjs [--json] <file> [file ...]");
    process.exit(2);
  }
  const targets = files.map((f) => ({ name: relative(REPO, f), segments: fileSegments(f) }));
  const findings = findRecycled({ targets, corpus: loadCorpus() });
  if (json) {
    console.log(JSON.stringify(findings, null, 2));
  } else {
    for (const t of targets) {
      const mine = findings.filter((f) => f.name === t.name);
      console.log(`${mine.length ? "FAIL" : "PASS"}  ${basename(t.name)}  ${mine.length} recycled line${mine.length === 1 ? "" : "s"}`);
      for (const f of mine) console.log(`  ${f.where}: "${f.sentence}"\n      same words as ${f.source}: "${f.run}"`);
    }
  }
  if (findings.length) process.exit(1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main(process.argv.slice(2));
}
