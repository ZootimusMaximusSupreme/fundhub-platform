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
//   node marketing/slideshows/build.mjs --check          exit 1 when a deck's shell is stale
//   node marketing/slideshows/build.mjs --artifact <deck.html> <out.html>
//                                                        write a copy shaped for an Artifact preview

import { readFileSync, writeFileSync, readdirSync } from "node:fs";
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

function main(args) {
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
  let stale = 0;
  let count = 0;
  for (const file of deckFiles()) {
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
