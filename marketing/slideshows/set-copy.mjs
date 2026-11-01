#!/usr/bin/env node
// Write a deck's words without touching its pictures.
//
// A copy round changes the headline, the lede, the lines and the talk track
// (the teleprompter script) of each slide. The real report crops, agreement
// clauses and diagrams stay exactly as they are. Slides are found by the code
// in their eyebrow ("PU-01").
//
//   node marketing/slideshows/set-copy.mjs <deck.html> <copy.json>
//
// copy.json:
// {
//   "description": "the meta description (optional)",
//   "slides": {
//     "PU-01": {
//       "label": "The red flag",          eyebrow words after the code (optional)
//       "headline": "...",                the slide's one headline
//       "lede": "..." or null,            null removes the lede; leave it out to keep it
//       "lines": ["...", "..."],          the copy lines on the slide
//       "talk": ["...", "..."],           the script: one teleprompter block per entry
//       "src": "...",                     added to the slide's data-src (optional)
//       "figures": "..."                  sets data-figures (optional)
//     }
//   }
// }
// Afterwards run: node marketing/slideshows/build.mjs --film <deck> && node marketing/slideshows/build.mjs --talk <deck>

import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const escAttr = (s) => esc(s).replace(/"/g, "&quot;");

function setAttr(open, name, value) {
  const re = new RegExp(`\\s${name}="[^"]*"`);
  const attr = ` ${name}="${escAttr(value)}"`;
  return re.test(open) ? open.replace(re, () => attr) : open.replace(/>$/, () => `${attr}>`);
}

export function applyCopy(html, copy) {
  const seen = new Set();
  let out = html.replace(/<section class="slide\b[^"]*"[^>]*>[\s\S]*?<\/section>/g, (sec) => {
    const eyebrow = /<p class="eyebrow">([\s\S]*?)<\/p>/.exec(sec);
    const code = eyebrow ? eyebrow[1].split("/")[0].trim() : "";
    const c = copy.slides?.[code];
    if (!c) return sec;
    seen.add(code);
    let open = /^<section[^>]*>/.exec(sec)[0];
    let body = sec.slice(open.length);
    if (c.src) {
      const cur = (/\sdata-src="([^"]*)"/.exec(open) || ["", ""])[1].replace(/&quot;/g, '"').replace(/&amp;/g, "&");
      open = setAttr(open, "data-src", `${cur} ${c.src}`.trim());
    }
    if (c.figures) open = setAttr(open, "data-figures", c.figures);
    if (c.label !== undefined) body = body.replace(/<p class="eyebrow">[\s\S]*?<\/p>/, () => `<p class="eyebrow">${esc(code)} / ${esc(c.label)}</p>`);
    if (c.headline !== undefined) body = body.replace(/<h2([^>]*)>[\s\S]*?<\/h2>/, (m, a) => `<h2${a}>${esc(c.headline)}</h2>`);
    if (c.lede !== undefined) {
      const hasLede = /\n?[ \t]*<p class="lede"[^>]*>[\s\S]*?<\/p>/.test(body);
      if (c.lede === null) body = body.replace(/\n?[ \t]*<p class="lede"[^>]*>[\s\S]*?<\/p>/, "");
      else if (hasLede) body = body.replace(/<p class="lede"([^>]*)>[\s\S]*?<\/p>/, (m, a) => `<p class="lede"${a}>${esc(c.lede)}</p>`);
      else body = body.replace(/(<\/h2>)/, (m) => `${m}\n    <p class="lede">${esc(c.lede)}</p>`);
    }
    if (c.lines) {
      const ul = `<ul class="lines">\n${c.lines.map((l) => `      <li>${esc(l)}</li>`).join("\n")}\n    </ul>`;
      if (/<ul class="lines"[^>]*>[\s\S]*?<\/ul>/.test(body)) body = body.replace(/<ul class="lines"[^>]*>[\s\S]*?<\/ul>/, () => ul);
      else if (/<p class="lede"[^>]*>[\s\S]*?<\/p>/.test(body)) body = body.replace(/(<p class="lede"[^>]*>[\s\S]*?<\/p>)/, (m) => `${m}\n    ${ul}`);
      else body = body.replace(/(<\/h2>)/, (m) => `${m}\n    ${ul}`);
    }
    if (c.talk) {
      const ul = `<ul>\n${c.talk.map((t) => `        <li>${esc(t)}</li>`).join("\n")}\n      </ul>`;
      if (/<aside class="talk"[^>]*>/.test(body)) body = body.replace(/(<aside class="talk"[^>]*>)[\s\S]*?(<\/aside>)/, (m, a, b) => `${a}\n      ${ul}\n    ${b}`);
      else body = body.replace(/<\/section>$/, () => `  <aside class="talk" aria-hidden="true">\n      ${ul}\n    </aside>\n  </section>`);
    }
    return open + body;
  });
  const missing = Object.keys(copy.slides || {}).filter((k) => !seen.has(k));
  if (missing.length) throw new Error(`no slide with the code ${missing.join(", ")}`);
  if (copy.description) out = out.replace(/<meta name="description" content="[^"]*">/, () => `<meta name="description" content="${escAttr(copy.description)}">`);
  return out;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [deck, json] = process.argv.slice(2);
  if (!deck || !json) {
    console.error("usage: node marketing/slideshows/set-copy.mjs <deck.html> <copy.json>");
    process.exit(2);
  }
  const file = resolve(deck);
  writeFileSync(file, applyCopy(readFileSync(file, "utf8"), JSON.parse(readFileSync(resolve(json), "utf8"))));
  console.log(`copy set: ${deck}`);
}
