#!/usr/bin/env node
// Fundhub slideshows: refresh the shared shell inside every deck.
//
// Each deck in marketing/slideshows/ is one self-contained HTML file, so it
// opens anywhere: a phone, an email link, a hosted page. The parts every deck
// shares live in one place and this script copies them in:
//   - public/app/fundhub-brand.css (colors, faces, parts), embedded whole
//   - the local SF Pro Rounded faces from public/app/fundhub-font.css
//   - _shell/slideshow.css and _shell/slideshow.js
// A deck marks where they go with <!-- fh:shell:head --> and
// <!-- fh:shell:script --> blocks. Edit the shell, never a deck's copy of it.
//
//   node marketing/slideshows/build.mjs                  refresh every deck
//   node marketing/slideshows/build.mjs a.html b.html    refresh just these decks
//   node marketing/slideshows/build.mjs --check          exit 1 when a deck's shell is stale
//   node marketing/slideshows/build.mjs --film [deck]    write film/<deck>.html, the 1080 x 960 boards
//   node marketing/slideshows/build.mjs --talk [deck]    write talk/<deck>.txt, the talking points for the teleprompter
//   node marketing/slideshows/build.mjs --artifact <deck.html> <out.html>
//                                                        write a copy shaped for an Artifact preview
//   node marketing/slideshows/build.mjs --publish [deck ...]
//                                                        write the page a lead opens, public/slideshows/<slug>/index.html
//                                                        for every deck (or just the named ones), and always rewrite the
//                                                        published list the pulse reads, src/slideshows/deck-pages.mjs

import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "../..");

// JetBrains Mono is the brand's mono face. Nunito is the brand's licensed
// rounded fallback for phones without Apple's rounded design.
const FONTS = "https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@500;700&family=Nunito:wght@500..800&display=swap";

const HEAD = /<!-- fh:shell:head -->[\s\S]*?<!-- \/fh:shell:head -->/;
const SCRIPT = /<!-- fh:shell:script -->[\s\S]*?<!-- \/fh:shell:script -->/;

function read(rel) {
  return readFileSync(join(repo, rel), "utf8");
}

function localRoundedFaces() {
  const faces = read("public/app/fundhub-font.css").match(/@font-face\{[^}]*"Fundhub Rounded Local"[^}]*\}/g) || [];
  if (faces.length !== 4) {
    throw new Error(`expected 4 "Fundhub Rounded Local" faces in public/app/fundhub-font.css, found ${faces.length}`);
  }
  return faces.join("\n");
}

export function shellHead({ artifact = false } = {}) {
  const parts = [
    `<link rel="preconnect" href="https://fonts.googleapis.com">`,
    `<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>`,
    `<link rel="stylesheet" href="${FONTS}">`,
  ];
  // An Artifact wraps the page in its own skeleton with this reset; a deck
  // opened on its own carries it here.
  if (!artifact) {
    parts.push(`<style data-fh="doc">:root{color-scheme:light;padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}[hidden]{display:none!important}</style>`);
  }
  parts.push(`<style data-fh="brand">\n/* public/app/fundhub-brand.css */\n${read("public/app/fundhub-brand.css").trim()}\n</style>`);
  parts.push(`<style data-fh="font">\n/* public/app/fundhub-font.css: local rounded faces */\n${localRoundedFaces()}\n</style>`);
  parts.push(`<style data-fh="slideshow">\n${read("marketing/slideshows/_shell/slideshow.css").trim()}\n</style>`);
  return parts.join("\n");
}

export function shellScript() {
  return `<script data-fh="slideshow">\n${read("marketing/slideshows/_shell/slideshow.js").trim()}\n</script>`;
}

/** The deck with a fresh shell, or null when the file is not a deck. */
export function applyShell(html, opts) {
  if (!HEAD.test(html) || !SCRIPT.test(html)) return null;
  return html
    .replace(HEAD, () => `<!-- fh:shell:head -->\n${shellHead(opts)}\n<!-- /fh:shell:head -->`)
    .replace(SCRIPT, () => `<!-- fh:shell:script -->\n${shellScript()}\n<!-- /fh:shell:script -->`);
}

/** Every .html file in this folder. Files without shell markers are skipped by callers. */
export function deckFiles() {
  return readdirSync(here).filter((f) => f.endsWith(".html")).sort().map((f) => join(here, f));
}

/** The film board (Chris, 2026-10-31): the same deck as one 1080 x 960 board
 *  per slide, for the bottom half of a vertical video with Chris on top. Same
 *  slides, same words; only the shell changes, so nothing drifts. */
export function toFilm(html) {
  if (!HEAD.test(html) || !SCRIPT.test(html)) return null;
  const head = [
    shellHead(),
    `<style data-fh="film">\n${read("marketing/slideshows/_shell/film.css").trim()}\n</style>`,
  ].join("\n");
  return html
    .replace(HEAD, () => `<!-- fh:shell:head -->\n${head}\n<!-- /fh:shell:head -->`)
    .replace(SCRIPT, () => `<!-- fh:shell:script -->\n<script data-fh="film">\n${read("marketing/slideshows/_shell/film.js").trim()}\n</script>\n<!-- /fh:shell:script -->`)
    .replace(/<title>([^<]*)<\/title>/i, (m, t) => `<title>${t} · Film board</title>`)
    .replace(/<meta name="viewport"[^>]*>/i, `<meta name="viewport" content="width=device-width, initial-scale=1">\n<!-- Film board: generated by build.mjs --film from ../<deck>.html. Edit the deck, not this file. -->`);
}

/** The script as plain text, one file per deck, for the teleprompter
 *  (public/app/teleprompter.js splits plain text on blank lines). Each
 *  <li> in a slide's talk track is one teleprompter block, about one screen
 *  (25 to 30 words). Blocks are 5 blank lines apart: Chris, 2026-10-22, long
 *  scripts need 5 blank lines between blocks or the roll does not work right.
 *  A "[Slide n]" cue marks where he clicks to the next slide. */
export const TALK_GAP = "\n".repeat(6);
export function toTalk(html) {
  const sections = [...html.matchAll(/<section class="slide\b[^"]*"[^>]*>([\s\S]*?)<\/section>/g)].map((m) => m[1]);
  if (!sections.length) return null;
  const strip = (s) => s.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&rsquo;/g, "'").replace(/\s+/g, " ").trim();
  const blocks = [];
  sections.forEach((sec, i) => {
    const talk = (/<aside class="talk"[^>]*>([\s\S]*?)<\/aside>/.exec(sec) || ["", ""])[1];
    const points = [...talk.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/g)].map((m) => strip(m[1])).filter(Boolean);
    blocks.push(`[Slide ${i + 1}]`, ...points);
  });
  return blocks.join(TALK_GAP).trim() + "\n";
}

/** An Artifact supplies its own doctype, head and body, so the copy drops ours. */
export function toArtifact(html) {
  const built = applyShell(html, { artifact: true });
  if (built === null) throw new Error("not a slideshow deck: no fh:shell markers");
  return built
    .replace(/<!doctype html>\s*/i, "")
    .replace(/<html[^>]*>\s*/i, "")
    .replace(/<\/html>\s*/i, "")
    .replace(/<head>\s*/i, "")
    .replace(/<\/head>\s*/i, "")
    .replace(/<body[^>]*>\s*/i, "")
    .replace(/<\/body>\s*/i, "")
    .replace(/<meta charset[^>]*>\s*/i, "")
    .replace(/<meta name="viewport"[^>]*>\s*/i, "")
    .replace(/(<title>[^<]*<\/title>)/i, `$1\n<meta name="claude:viewport-fit-sides" content="cover">`);
}

// ── The published pages ──────────────────────────────────────────────────
// A lead opens a deck at https://fundhub.ai/slideshows/<slug>/, which is public/slideshows/<slug>/index.html.
// That page is the built deck with what only Chris uses taken out, and nothing else changed. The company pulse
// watches every page from a generated list (src/slideshows/deck-pages.mjs), so a broken page turns it red.

export const PUBLIC_DIR = join(repo, "public/slideshows");
export const LIST_FILE = join(repo, "src/slideshows/deck-pages.mjs");
// A pulse beat may import nothing outside its own lib folder, so the hourly check reads this second copy of the list.
export const LIST_COPY_FILE = join(repo, "src/pulse/beats/lib/slideshow-pages-list.mjs");

// The hourly pulse reads only the first 64 KB (65,536 bytes) of a page (MAX_BODY_BYTES in
// src/messaging/providers/pulse-probe.mjs). Slide 1's code has to sit well inside that, or the hourly check is blind to it.
export const EYEBROW_WINDOW = 60000;

const NOINDEX = `<meta name="robots" content="noindex">`;
// A slide's opening tag. Quote-aware, so a ">" inside an attribute value cannot end the tag early.
const SLIDE_OPEN = /<section\b(?:[^>"']|"[^"]*"|'[^']*')*>/g;
const TALK_ON_ITS_LINE = /^[ \t]*<aside class="talk"[^>]*>[\s\S]*?<\/aside>[ \t]*\r?\n/gm;
const TALK_ANYWHERE = /<aside class="talk"[^>]*>[\s\S]*?<\/aside>/g;
const SOURCE_NOTES = /\s+data-(?:src|figures)=(?:"[^"]*"|'[^']*')/g;

export const slugOf = (file) => basename(file).replace(/\.html$/, "");

/** The page a lead opens (Chris, 2026-10-31, through the lead): the built deck, minus what only Chris uses.
 *  Taken out: every <aside class="talk"> block (his teleprompter script) and the data-src and data-figures notes on the
 *  slides (where each fact came from). Put in: <meta name="robots" content="noindex">, unless the deck has one, so a
 *  search engine never lists a page made for one person. Everything else is the deck byte for byte.
 *  Null when the file is not a deck. */
export function toPublic(html) {
  const built = applyShell(html);
  if (built === null) return null;
  let page = built
    .replace(TALK_ON_ITS_LINE, "")
    .replace(TALK_ANYWHERE, "")
    .replace(SLIDE_OPEN, (tag) => (/\bclass="slide\b/.test(tag) ? tag.replace(SOURCE_NOTES, "") : tag));
  if (/<aside\b[^>]*\btalk\b/.test(page)) {
    throw new Error(`a talking-points block is still in the public page; it has to be written <aside class="talk">`);
  }
  if (/\sdata-(?:src|figures)=/.test(page)) {
    throw new Error("a data-src or data-figures note sits on something that is not a slide, so it was not removed");
  }
  if (!/<meta\s+name=["']robots["']/i.test(page)) {
    const spot = [/(<meta name="viewport"[^>]*>)/, /(<meta charset[^>]*>)/, /(<head>)/].find((re) => re.test(page));
    if (!spot) throw new Error("there is no <head> to put the robots meta in");
    page = page.replace(spot, (m) => `${m}\n${NOINDEX}`);
  }
  return page;
}

/** What the pulse needs to know about a public page: how many slides it has, the deck's letters in slide 1's
 *  eyebrow ("PU" in "PU-01 / The red flag"), and its <title> text exactly as written. Throws when the page cannot be
 *  described, or when slide 1's eyebrow sits where the hourly pulse cannot read it. */
export function deckFacts(page, name = "deck") {
  const found = page.split(`<section class="slide`).length - 1;
  const strict = [...page.matchAll(/<section class="slide\b[^"]*"[^>]*>/g)].length;
  if (found < 1 || found !== strict) {
    throw new Error(`${name}: the slides count ${found} one way and ${strict} another; every slide opens with <section class="slide ...">`);
  }
  const start = page.indexOf(`<section class="slide`);
  const eyebrow = /<p class="eyebrow">([\s\S]*?)<\/p>/.exec(page.slice(start));
  const words = eyebrow ? eyebrow[1].replace(/<[^>]+>/g, "").trim() : "";
  const code = /^([A-Z]{2,3})-01(?![0-9])/.exec(words);
  if (!code) throw new Error(`${name}: slide 1's eyebrow reads "${words.slice(0, 40)}"; it has to start with the deck's letters and -01, like PU-01`);
  const seen = Buffer.byteLength(page.slice(0, start + eyebrow.index + eyebrow[0].length));
  if (seen > EYEBROW_WINDOW) {
    throw new Error(`${name}: slide 1's eyebrow ends at byte ${seen}, but the hourly pulse reads only the first ${EYEBROW_WINDOW} bytes of a page, so it could not see the code`);
  }
  const title = /<title>([^<]*)<\/title>/i.exec(page);
  if (!title || !title[1].trim()) throw new Error(`${name}: no <title>`);
  return { slides: found, code: code[1], title: title[1].trim() };
}

/** Anything in a page that points at a file next to the deck. The public page lives in its own folder, so a path like
 *  that would not be found. [] means the page is self-contained: its pictures are data: addresses and its fonts are https links. */
export function localRefs(page) {
  const out = [];
  const check = (what, url) => {
    const u = String(url ?? "").trim();
    if (!u || u.startsWith("#") || /^(?:https:\/\/|data:)/i.test(u)) return;
    out.push(`${what}="${u.slice(0, 60)}"`);
  };
  const urlsIn = (css, what) => {
    for (const m of css.matchAll(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*?))\s*\)/gi)) check(what, m[1] ?? m[2] ?? m[3]);
  };
  for (const [, name, attrs] of page.matchAll(/<([a-zA-Z][\w:-]*)\b((?:[^>"']|"[^"]*"|'[^']*')*)>/g)) {
    const tag = name.toLowerCase();
    for (const [, key, dq, sq, bare] of attrs.matchAll(/([^\s=/"'<>]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g)) {
      const attr = key.toLowerCase();
      const value = dq ?? sq ?? bare ?? "";
      if (attr === "src" || attr === "poster") check(`<${tag} ${attr}`, value);
      else if (attr === "srcset") value.split(",").forEach((part) => check(`<${tag} srcset`, part.trim().split(/\s+/)[0]));
      else if ((attr === "href" || attr === "xlink:href") && ["link", "image", "use"].includes(tag)) check(`<${tag} ${attr}`, value);
      else if (attr === "style") urlsIn(value, "style url");
    }
  }
  for (const [, css] of page.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)) {
    urlsIn(css, "css url");
    for (const m of css.matchAll(/@import\s+(?:url\()?\s*["']?([^"')\s;]+)/gi)) check("css @import", m[1]);
  }
  return out;
}

/** Every deck that has shell markers, in file-name order: { slug, file, page, slides, code, title }. Throws, naming
 *  the deck, when one cannot be published, so a broken deck never reaches the list quietly. */
export function publishedDecks() {
  const out = [];
  for (const file of deckFiles()) {
    const slug = slugOf(file);
    const page = toPublic(readFileSync(file, "utf8"));
    if (page === null) continue;
    const refs = localRefs(page);
    if (refs.length) {
      throw new Error(`${slug}: points at a file next to the deck (${refs.slice(0, 3).join(", ")}). The public page lives in its own folder, so that file would not be found. Inline it as a data: address, or use an https link.`);
    }
    out.push({ slug, file, page, ...deckFacts(page, slug) });
  }
  return out;
}

const listRows = (decks) => decks
  .map((d) => `  Object.freeze({ slug: ${JSON.stringify(d.slug)}, path: ${JSON.stringify(`/slideshows/${d.slug}/`)}, slides: ${d.slides}, code: ${JSON.stringify(d.code)}, title: ${JSON.stringify(d.title)} })`)
  .join(",\n");

const LIST_FIELDS = [
  "//   slug    the deck's file name in marketing/slideshows/, without .html",
  "//   path    the page's address on fundhub.ai",
  `//   slides  how many slides the page has: the count of <section class="slide`,
  `//   code    the deck's letters in slide 1's eyebrow (PU in "PU-01 / The red flag"); two decks can share one`,
  "//   title   the page's <title> text, exactly as written in the HTML",
];

/** The text of src/slideshows/deck-pages.mjs. */
export function listModuleText(decks) {
  return [
    "// GENERATED by node marketing/slideshows/build.mjs --publish. Do not edit by hand.",
    "//",
    "// The phone slideshows that are live at https://fundhub.ai/slideshows/<slug>/, one row per deck:",
    ...LIST_FIELDS,
    "//",
    "// The company pulse reads this list to GET every page and judge it: src/pulse/coverage/gap-slideshow-pages.mjs every",
    "// morning and src/pulse/beats/beat-slideshow-pages.mjs every hour. marketing/slideshows/check.mjs fails when this file,",
    "// the copy at src/pulse/beats/lib/slideshow-pages-list.mjs, or any page under public/slideshows/ is out of date.",
    "",
    "export const DECK_PAGES = Object.freeze([",
    listRows(decks),
    "]);",
    "",
  ].join("\n");
}

/** The text of src/pulse/beats/lib/slideshow-pages-list.mjs: the same rows, for the hourly check. */
export function listCopyText(decks) {
  return [
    "// GENERATED by node marketing/slideshows/build.mjs --publish. Do not edit by hand.",
    "//",
    "// A copy of the list in src/slideshows/deck-pages.mjs. An hourly pulse beat may read only files in this folder, so it",
    "// cannot reach the original. src/pulse/beats/beat-slideshow-pages.test.mjs fails when the two lists differ.",
    "// One row per deck page live at https://fundhub.ai/slideshows/<slug>/:",
    ...LIST_FIELDS,
    "",
    "export const DECK_PAGES = Object.freeze([",
    listRows(decks),
    "]);",
    "",
  ].join("\n");
}

function publish(named) {
  let decks;
  try {
    decks = publishedDecks();
  } catch (err) {
    console.error(`cannot publish: ${err.message}`);
    process.exit(1);
  }
  const want = named.length ? named.map((a) => slugOf(a)) : decks.map((d) => d.slug);
  const unknown = want.filter((slug) => !decks.some((d) => d.slug === slug));
  if (unknown.length) {
    console.error(`not a deck with shell markers: ${unknown.join(", ")}`);
    process.exit(2);
  }
  const put = (file, text) => {
    const same = existsSync(file) && readFileSync(file, "utf8") === text;
    if (!same) {
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, text);
    }
    return same;
  };
  for (const deck of decks.filter((d) => want.includes(d.slug))) {
    const same = put(join(PUBLIC_DIR, deck.slug, "index.html"), deck.page);
    console.log(`${same ? "ok     " : "wrote  "} public/slideshows/${deck.slug}/index.html  ${deck.slides} slides · ${deck.code}`);
  }
  // The list always covers every deck, even when only some were named.
  for (const [file, text] of [[LIST_FILE, listModuleText(decks)], [LIST_COPY_FILE, listCopyText(decks)]]) {
    const same = put(file, text);
    console.log(`${same ? "ok     " : "wrote  "} ${file.slice(repo.length + 1)}  ${decks.length} decks`);
  }
}

function main(args) {
  if (args.includes("--publish")) {
    publish(args.filter((a) => !a.startsWith("--")));
    return;
  }
  if (args[0] === "--artifact") {
    const [, src, out] = args;
    if (!src || !out) {
      console.error("usage: node marketing/slideshows/build.mjs --artifact <deck.html> <out.html>");
      process.exit(2);
    }
    writeFileSync(out, toArtifact(readFileSync(resolve(src), "utf8")));
    console.log(`artifact copy written: ${out}`);
    return;
  }
  const check = args.includes("--check");
  const named = args.filter((a) => !a.startsWith("--")).map((a) => resolve(a));
  if (args.includes("--talk")) {
    const dir = join(here, "talk");
    mkdirSync(dir, { recursive: true });
    for (const file of named.length ? named : deckFiles()) {
      const talk = toTalk(readFileSync(file, "utf8"));
      if (talk === null) continue;
      writeFileSync(join(dir, basename(file).replace(/\.html$/, ".txt")), talk);
      console.log(`talk   ${basename(file)}`);
    }
    return;
  }
  if (args.includes("--film")) {
    const dir = join(here, "film");
    mkdirSync(dir, { recursive: true });
    for (const file of named.length ? named : deckFiles()) {
      const film = toFilm(readFileSync(file, "utf8"));
      if (film === null) continue;
      const out = join(dir, basename(file));
      writeFileSync(out, film);
      console.log(`film   ${basename(file)}`);
    }
    return;
  }
  let stale = 0;
  let count = 0;
  for (const file of named.length ? named : deckFiles()) {
    const html = readFileSync(file, "utf8");
    const built = applyShell(html);
    if (built === null) continue;
    count += 1;
    if (built === html) {
      console.log(`ok     ${basename(file)}`);
    } else if (check) {
      stale += 1;
      console.log(`STALE  ${basename(file)}`);
    } else {
      writeFileSync(file, built);
      console.log(`built  ${basename(file)}`);
    }
  }
  if (check && stale) {
    console.error(`${stale} of ${count} decks have a stale shell. Run: node marketing/slideshows/build.mjs`);
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main(process.argv.slice(2));
}
