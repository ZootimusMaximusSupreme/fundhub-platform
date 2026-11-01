#!/usr/bin/env node
// Screenshot every slide of a deck at phone size (390 x 844), so a person or an
// agent can look at what a lead sees before Chris does.
//
//   node marketing/slideshows/shoot.mjs <deck.html> <out-dir> [--notes]
//
// Writes <out-dir>/<deck>-01.png, -02.png, ... Uses the installed Chrome when
// there is one (CHROME_PATH, or /usr/bin/google-chrome), else Playwright's own.

import { existsSync, mkdirSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";

const [deckArg, outArg] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const notes = process.argv.includes("--notes");
if (!deckArg || !outArg) {
  console.error("usage: node marketing/slideshows/shoot.mjs <deck.html> <out-dir> [--notes]");
  process.exit(2);
}
const deck = resolve(deckArg);
const out = resolve(outArg);
mkdirSync(out, { recursive: true });
const chrome = [process.env.CHROME_PATH, "/usr/bin/google-chrome"].find((p) => p && existsSync(p));
const browser = await chromium.launch(chrome ? { executablePath: chrome } : {});
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
await page.goto(pathToFileURL(deck).href + (notes ? "#notes" : ""));
await page.waitForTimeout(400);
const count = await page.locator("section.slide").count();
const name = basename(deck, ".html");
for (let i = 0; i < count; i += 1) {
  const file = join(out, `${name}-${String(i + 1).padStart(2, "0")}.png`);
  await page.screenshot({ path: file, fullPage: true });
  console.log(file);
  await page.keyboard.press("ArrowRight");
  await page.waitForTimeout(350);
}
await browser.close();
