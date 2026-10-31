#!/usr/bin/env node
// Fundhub slideshows: the checks every deck passes before Chris sees it.
// The rules come from marketing/copy-skills/copybot/references/voice-and-quality.md
// and the owner rules it lists (.ai/rules/copy-certainty.md, outcome-first-copy.md,
// funding-sequence-term.md, fundhub-company-name.md, sample-clients-consistent.md,
// no-ssn-before-checkout-step-3.md). A script cannot pretend it ran; run it and read it.
// Passing it is the floor, not the bar: a person still reads every slide.
//
//   node marketing/slideshows/check.mjs              every deck in this folder
//   node marketing/slideshows/check.mjs a.html ...   just these

import { readFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { applyShell, deckFiles } from "./build.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "../..");

// Chris's exact guarantee line (owner-voice.md, 2026-10-31).
const GUARANTEE = "Applications go out within 72 business hours. That's our guarantee, and it's in your contract. That typically means approvals come very shortly after.";

const BANNED = [
  [/\bCRS\b/, `"CRS" in customer copy (Chris, 2026-10-31)`],
  [/\bnumbers?\b/i, `"number" in sales copy (outcome-first-copy)`],
  [/\bfunding gap\b/i, `"funding gap" (outcome-first-copy)`],
  [/\bfunding snapshot\b/i, `"Funding Snapshot" (outcome-first-copy)`],
  [/\bbiggest yes\b/i, `"the biggest yes" (outcome-first-copy)`],
  [/\bround two\b/i, `"round two" (funding-sequence-term)`],
  [/\bwe (think|believe|feel)\b/i, "a hedge (copy-certainty)"],
  [/\byou (might|may)\b/i, "a hedge (copy-certainty)"],
  [/\b(maybe|could|possibly|probably|likely|hopefully)\b/i, "a hedge (copy-certainty)"],
  [/\bchances are\b/i, "a hedge (copy-certainty)"],
  [/\bsocial security\b|\bSSN\b/i, "the Social Security number before checkout step 3"],
];

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", rsquo: "'", lsquo: "'",
  ldquo: '"', rdquo: '"', middot: "·", mdash: "—", ndash: "–", hellip: "…", rarr: "→", larr: "←", rsaquo: "›" };

function text(html) {
  return html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
      if (e[0] === "#") return String.fromCodePoint(e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : Number(e.slice(1)));
      return ENTITIES[e.toLowerCase()] ?? m;
    })
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

function all(re, s) {
  return [...s.matchAll(re)].map((m) => m[1]);
}

function attr(tag, name) {
  const m = new RegExp(`\\b${name}="([^"]*)"`).exec(tag);
  return m ? m[1].trim() : null;
}

// Fundhub's own prices (src/config/offers.mjs). None may appear on a slide.
function priceRules() {
  const src = readFileSync(join(repo, "src/config/offers.mjs"), "utf8");
  const cents = new Set(all(/price(?:Min|Max)?Cents:\s*(\d+)/g, src).map(Number));
  return [...cents].filter((c) => c > 0).map((c) => {
    const dollars = c / 100;
    const comma = dollars.toLocaleString("en-US");
    const forms = [`\\$\\s?${comma.replace(/,/g, ",")}(?![\\d,])`, `\\$\\s?${dollars}(?![\\d,])`];
    if (dollars >= 1000 && dollars % 1000 === 0) forms.push(`\\$\\s?${dollars / 1000}\\s?[kK]\\b`);
    return { re: new RegExp(forms.join("|")), label: `$${comma}` };
  });
}

function syllables(word) {
  let w = word.toLowerCase().replace(/[^a-z]/g, "");
  if (!w) return 0;
  if (w.length <= 3) return 1;
  w = w.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, "").replace(/^y/, "");
  const groups = w.match(/[aeiouy]{1,2}/g);
  return Math.max(1, groups ? groups.length : 1);
}

// Flesch Reading Ease, the measure Copybot's readability reference names. A
// rough syllable count, so it flags a deck for a reread, never a rewrite.
function readingEase(sentences) {
  const words = sentences.join(" ").split(/\s+/).filter((w) => /[a-z0-9]/i.test(w));
  if (!words.length) return 100;
  const syl = words.reduce((n, w) => n + syllables(w), 0);
  return 206.835 - 1.015 * (words.length / sentences.length) - 84.6 * (syl / words.length);
}

function checkDeck(file, prices) {
  const html = readFileSync(file, "utf8");
  const errors = [];
  const warns = [];

  const fresh = applyShell(html);
  if (fresh === null) return null;
  if (fresh !== html) errors.push("stale shell: run node marketing/slideshows/build.mjs");

  const title = (/<title>([^<]*)<\/title>/i.exec(html) || [])[1];
  if (!title) errors.push("no <title>");
  if (!/<html[^>]*\blang="en"/.test(html)) errors.push('no <html lang="en">');
  if (!/<meta name="description" content="[^"]+">/.test(html)) errors.push("no description meta");

  const slides = [...html.matchAll(/<section class="slide\b[^"]*"[^>]*>[\s\S]*?<\/section>/g)].map((m) => m[0]);
  if (slides.length < 5 || slides.length > 8) errors.push(`${slides.length} slides; a deck has 5 to 8`);

  const deckText = [];
  const sentences = [];
  slides.forEach((slide, k) => {
    const open = /^<section[^>]*>/.exec(slide)[0];
    const code = text((/<p class="eyebrow">([\s\S]*?)<\/p>/.exec(slide) || [])[1] || "") || `slide ${k + 1}`;
    const where = code.split("/")[0].trim();
    const body = text(slide);
    deckText.push(body);

    if (!attr(open, "data-src")) errors.push(`${where}: no data-src (every fact traces to a file or Chris's saved words)`);
    const heads = all(/<h2[^>]*>([\s\S]*?)<\/h2>/g, slide).map(text);
    if (heads.length !== 1) errors.push(`${where}: ${heads.length} headlines; a slide has one`);
    if (!/class="pic\b/.test(slide)) warns.push(`${where}: no picture`);
    const ledes = all(/<p class="lede"[^>]*>([\s\S]*?)<\/p>/g, slide).map(text);
    heads.forEach((h) => {
      sentences.push(h);
      if (h.length > 72) warns.push(`${where}: headline is ${h.length} characters`);
    });
    ledes.forEach((l) => {
      sentences.push(...l.split(/(?<=[.!?])\s+/).filter(Boolean));
      if (l.length > 200) warns.push(`${where}: lede is ${l.length} characters`);
    });

    const figures = /\$\s?\d|\b\d{1,3}(?:\.\d+)?\s?%|\b[5-8]\d\d\b/.test(body);
    if (figures && !/\bsample\b/i.test(body) && !attr(open, "data-figures")) {
      errors.push(`${where}: shows a figure with no "Sample" label and no data-figures reason`);
    }
    if (body.includes("—")) warns.push(`${where}: an em dash; say it as two sentences`);
  });

  const all_ = [title || "", text((/<meta name="description" content="([^"]*)">/.exec(html) || [])[1] || ""), ...deckText].join(" \n ");
  for (const [re, why] of BANNED) {
    const m = re.exec(all_);
    if (m) errors.push(`banned: "${m[0]}" — ${why}`);
  }
  for (const m of all_.matchAll(/fund\s?hub(?:\.ai)?/gi)) {
    if (m[0] !== "Fundhub" && m[0].toLowerCase() !== "fundhub.ai") errors.push(`spelling: "${m[0]}" is written Fundhub`);
  }
  const withoutGuarantee = all_.split(GUARANTEE).join(" ");
  if (/\btypically\b/i.test(withoutGuarantee)) errors.push(`"typically" outside the guarantee line (copy-certainty)`);
  if (/\b72\b/.test(all_)) {
    const joined = deckText.join(" ");
    if (!joined.includes(GUARANTEE)) errors.push("says 72 without the exact guarantee line");
    if (/approv\w*[^.]{0,40}\b72\b|\b72\b[^.]{0,40}approv/i.test(withoutGuarantee)) {
      errors.push("ties approvals to 72 hours; only applications are guaranteed");
    }
  }
  for (const p of prices) {
    if (p.re.test(all_)) errors.push(`a Fundhub price on a slide: ${p.label} (no prices before the call)`);
  }

  const ease = readingEase(sentences);
  if (ease < 75) warns.push(`reading ease ${ease.toFixed(0)}; aim for 80 or higher (grade 6 or easier)`);
  return { name: basename(file), slides: slides.length, ease, errors, warns };
}

const args = process.argv.slice(2);
const files = args.length ? args.map((a) => resolve(a)) : deckFiles();
const prices = priceRules();
let failed = 0;
for (const file of files) {
  const r = checkDeck(file, prices);
  if (!r) continue;
  const ok = r.errors.length === 0;
  if (!ok) failed += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${r.name}  ${r.slides} slides · reading ease ${r.ease.toFixed(0)}`);
  for (const e of r.errors) console.log(`  error  ${e}`);
  for (const w of r.warns) console.log(`  warn   ${w}`);
}
if (failed) {
  console.error(`${failed} deck(s) failed.`);
  process.exit(1);
}
