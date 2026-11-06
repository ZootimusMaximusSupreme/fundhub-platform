/* FH Consulting packages page — marked DRAFT for Chris.
 *
 * Chris, 2026-11-06: "we need to add some more pazzaz for our offer ... a 30K package, a custom
 * package with no pricing on it, a 10K package, and anything in between ... Whop wants to know ...
 * make it super hypey maybe show some diagrams." Then: "dont mention funding or credit repair or
 * anything like that at all."
 *
 * Reads the new page (public/consulting/index.html) and its styles WITHOUT changing them, and writes
 * one self-contained preview with the review marks on top:
 *   green box   = a new or rewritten section
 *   yellow note = a pick the agent made that Chris should check
 * A button at the top hides the marks so the page reads clean.
 *
 * Run:  node marketing/landing-pages/preview/fh-consulting-packages-draft-build.mjs [--standalone <file>]
 * Out:  marketing/landing-pages/preview/fh-consulting-packages-draft.html (page body only, for the shared link)
 *       --standalone <file>  the same preview as a full HTML document, for a local browser check
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..", "..");
const page = readFileSync(join(root, "public/consulting/index.html"), "utf8");
const css = readFileSync(join(root, "public/consulting/site.css"), "utf8");

function swap(text, find, replace) {
  if (!text.includes(find)) throw new Error(`marker not found: ${find.slice(0, 80)}`);
  return text.replace(find, replace);
}

const SECTIONS = {
  top: "NEW · Hero and the engine",
  systems: "NEW · The four AI systems",
  engine: "NEW · Diagram: how the engine runs",
  enrich: "NEW · Diagram: one lead, before and after",
  packages: "NEW · The four packages",
  compare: "NEW · Side-by-side table",
  how: "REWRITTEN · Four steps",
  plain: "REWRITTEN · Straight talk",
  faq: "REWRITTEN · FAQ",
  consult: "CHANGED · The form now asks which package",
};

const CHECKS = [
  ['<div class="price">$20,000</div>', "Check: $20,000 is my pick for the middle package. You said “anything in between.”"],
  ['<p class="term">30 days of tuning after launch</p>', "Check: the tuning terms are my picks: 30, 60, and 90 days."],
  ["<li>Up to three offers and three target markets</li>", "Check: the offer limits are my picks: 1, up to 3, and up to 5."],
  ["<li>A fit score, so the best leads go first</li>\n          </ul>", "Check: this list should match what our enrichment system fills in."],
  ['<p class="sample-note">', "Check: this lead is made up and labeled as a sample. Nothing real is shown."],
  ['<p class="legal">', "Changed: the footer now names the four systems and the prices. “It is not a loan” and the payment approval line are gone."],
];

const head = page.slice(page.indexOf("<head>") + 6, page.indexOf("</head>"));
let body = page.slice(page.indexOf("<body>") + 6, page.indexOf("</body>"));

const title = "<title>FH Consulting Packages Draft</title>";
const fonts = [...head.matchAll(/<link\b[^>]*fonts\.(?:googleapis|gstatic)\.com[^>]*>/g)].map((m) => m[0]).join("\n");

body = body.replace(/<script src="\/funnel\/rb2b\.js"><\/script>\s*/, "");
body = body.replace(/href="\/consulting\/(terms|privacy|refund)\/"/g, 'href="https://fhconsulting.online/$1/"');
body = body.replace(/href="\/consulting\/"/g, 'href="#top"');

for (const [id, label] of Object.entries(SECTIONS)) {
  const re = new RegExp(`<section([^>]*)\\bid="${id}"`);
  if (!re.test(body)) throw new Error(`section not found: ${id}`);
  body = body.replace(re, `<section$1id="${id}" data-mark="${label}"`);
}
for (const [find, note] of CHECKS) {
  const tag = `<p class="dm-check">${note}</p>`;
  body = find.startsWith('<p class="sample-note">') || find.startsWith('<p class="legal">')
    ? swap(body, find, `${tag}\n${find}`)
    : swap(body, find, `${find}\n${tag}`);
}

const banner = `
<div class="dm-banner" role="region" aria-label="Draft notes">
  <div class="dm-inner">
    <div>
      <strong>Draft for Chris. Not live yet.</strong>
      <ul>
        <li><span class="dm-key dm-key-green"></span>Green box: a new or rewritten section.</li>
        <li><span class="dm-key dm-key-yellow"></span>Yellow note: a pick I made. Check it.</li>
        <li>Gone: the three vague tool cards, and every loan or approval line. Nothing on the site says funding or credit.</li>
      </ul>
    </div>
    <button type="button" id="dm-toggle" class="dm-toggle">Hide marks</button>
  </div>
</div>`;

const draftCss = `
:root { --dm-green: #1f9d55; --dm-yellow: #f2c94c; --dm-yellow-soft: #fff6d6; --dm-ink: #141613; }
body { background: var(--paper); color: var(--ink); }
header { top: env(safe-area-inset-top, 0px); }
.dm-banner { background: var(--dm-ink); color: #f4f1ea; font: 500 14px/1.45 Outfit, system-ui, sans-serif; }
.dm-inner { max-width: 1120px; margin: 0 auto; padding: 14px 24px; display: flex; gap: 16px; align-items: center; justify-content: space-between; flex-wrap: wrap; }
.dm-banner ul { list-style: none; margin-top: 6px; display: grid; gap: 3px; }
.dm-key { display: inline-block; width: 12px; height: 12px; border-radius: 3px; margin-right: 8px; vertical-align: -1px; }
.dm-key-green { border: 2px solid var(--dm-green); }
.dm-key-yellow { background: var(--dm-yellow); }
.dm-toggle { font: 600 14px Outfit, system-ui, sans-serif; background: #f4f1ea; color: var(--dm-ink); border: 0; border-radius: 999px; padding: 10px 16px; cursor: pointer; }
.dm-toggle:focus-visible { outline: 2px solid var(--dm-yellow); outline-offset: 3px; }
body.dm-on section[data-mark] { position: relative; box-shadow: inset 0 0 0 3px var(--dm-green); }
body.dm-on section[data-mark]::after {
  content: attr(data-mark);
  position: absolute; top: 10px; left: 10px; z-index: 5;
  background: var(--dm-green); color: #fff; font: 600 11.5px/1 Outfit, system-ui, sans-serif;
  letter-spacing: 0.08em; text-transform: uppercase; padding: 6px 9px; border-radius: 6px;
}
.dm-check { display: none; }
body.dm-on .dm-check {
  display: block; margin: 10px 0; padding: 9px 12px; border-radius: 10px;
  background: var(--dm-yellow-soft); border: 1px solid var(--dm-yellow); color: var(--dm-ink);
  font: 500 13px/1.4 Outfit, system-ui, sans-serif;
}
`;

const toggle = `
<script>
(function () {
  document.body.classList.add("dm-on");
  var b = document.getElementById("dm-toggle");
  b.addEventListener("click", function () {
    var on = document.body.classList.toggle("dm-on");
    b.textContent = on ? "Hide marks" : "Show marks";
  });
})();
</script>`;

const content = `${title}\n<meta name="color-scheme" content="light">\n${fonts}\n<style>\n${css}\n${draftCss}\n</style>\n${banner}\n${body.trim()}\n${toggle}\n`;
const out = join(here, "fh-consulting-packages-draft.html");
writeFileSync(out, content);
console.log(`wrote ${out}`);

const i = process.argv.indexOf("--standalone");
if (i > -1 && process.argv[i + 1]) {
  const doc = `<!DOCTYPE html>\n<html lang="en">\n<head>\n<meta charset="UTF-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n${content}</head>`;
  const split = doc.indexOf(banner);
  const full = `${doc.slice(0, split).replace("</head>", "")}</head>\n<body>\n${doc.slice(split)}</body>\n</html>\n`;
  writeFileSync(process.argv[i + 1], full);
  console.log(`wrote ${process.argv[i + 1]}`);
}
