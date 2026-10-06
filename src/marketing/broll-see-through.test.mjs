// The see-through switch on the Remotion kit (spec §9.4; step 1 of the 10/2
// saved plan in ops/workflows/broll-v2-2026-10-02.md).
//
// Every template takes `transparent` (default false). On, the page drops out
// (no paper, no grid) so the clip renders with alpha and can sit over filmed
// video. Off, nothing changes.
//
// The kit is TypeScript and React and is not installed in CI (see
// ./catalog.mjs), so these checks read its source text and the committed
// catalog. They fail when a new template lands without the switch, or when a
// page background stops listening to it. The pictures themselves are proved
// by hand with `npx remotion still` (marketing/broll/README.md).

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const KIT = join(REPO, "marketing", "broll");
const TEMPLATES = join(KIT, "src", "templates");
const read = (...p) => readFileSync(join(...p), "utf8");

const catalog = JSON.parse(read(KIT, "catalog.json"));
const templateFiles = readdirSync(TEMPLATES).filter((f) => f.endsWith(".tsx")).sort();
const sources = Object.fromEntries(templateFiles.map((f) => [f, read(TEMPLATES, f)]));

/* A template file is one that exports a props type with the kit's review
   switch (showSafeZones). Helpers (toolScene.tsx) and registration-only
   modules (registry.tsx, offer-cta.tsx, lenderMatching.tsx, toolAnalogy.tsx)
   do not. */
const PROPS_TYPE_RE = /export type (\w+)Props = \{([\s\S]*?)\n\};/g;
function templatePropsTypes() {
  const out = [];
  for (const [file, text] of Object.entries(sources)) {
    for (const m of text.matchAll(PROPS_TYPE_RE)) {
      if (m[2].includes("showSafeZones?: boolean;")) out.push({ file, name: m[1], body: m[2] });
    }
  }
  return out;
}

test("every catalog entry offers transparent, and it defaults to false", () => {
  assert.equal(catalog.length, 22, "the kit registers 22 ad clips today");
  for (const e of catalog) {
    assert.ok(Object.hasOwn(e.default_props, "transparent"), `${e.id}: default_props has no transparent`);
    assert.equal(e.default_props.transparent, false, `${e.id}: transparent must default to false`);
  }
});

test("every template's props type declares transparent?: boolean", () => {
  const types = templatePropsTypes();
  assert.equal(types.length, 20, `20 template files today, found ${types.map((t) => t.file).join(", ")}`);
  for (const t of types) {
    assert.match(t.body, /\n {2}transparent\?: boolean;/, `${t.file}: ${t.name}Props has no transparent?: boolean`);
  }
});

test("every template wraps its frame in <SeeThrough> driven by its own transparent prop", () => {
  for (const { file, name } of templatePropsTypes()) {
    const text = sources[file];
    assert.match(text, /^import \{SeeThrough(?:, useSeeThrough)?\} from '\.\.\/brand\/Grid';$/m, `${file}: no SeeThrough import`);
    const wraps = text.match(/<SeeThrough on=\{(?:props\.)?transparent\}>/g) ?? [];
    assert.ok(wraps.length >= 1, `${file}: ${name} never wraps its frame in <SeeThrough on={transparent}>`);
  }
});

test("Grid draws nothing when see-through, and is the page every BrandFrame paints", () => {
  const grid = read(KIT, "src", "brand", "Grid.tsx");
  assert.match(grid, /const SeeThroughContext = createContext\(false\);/, "the switch is off unless a template turns it on");
  assert.match(grid, /export const Grid: React\.FC = \(\) => \{\n {2}const seeThrough = useSeeThrough\(\);\n {2}if \(seeThrough\) return null;/);
  const frame = read(KIT, "src", "brand", "BrandFrame.tsx");
  assert.match(frame, /<Grid \/>/, "BrandFrame paints its page with Grid");
  assert.doesNotMatch(frame, /backgroundColor|COLORS\.paper/, "BrandFrame paints no page of its own that see-through would miss");
});

test("a template that paints its own page (the wide 4K formats) skips it when see-through", () => {
  const painters = Object.entries(sources).filter(([, text]) => text.includes("backgroundColor: COLORS.paper"));
  assert.deepEqual(painters.map(([f]) => f).sort(), ["BankPockets.tsx", "ProofFlood.tsx"]);
  assert.match(sources["BankPockets.tsx"], /const WideGrid: React\.FC = \(\) => \{\n {2}const seeThrough = useSeeThrough\(\);\n {2}const line = 3;\n {2}if \(seeThrough\) return null;/);
  assert.match(sources["ProofFlood.tsx"], /\{props\.transparent \? null : \(\n {8}<AbsoluteFill\n {10}style=\{\{\n {12}backgroundColor: COLORS\.paper,/);
});

test("the README gives the alpha render commands: ProRes 4444 .mov and VP9 .webm", () => {
  const readme = read(KIT, "README.md");
  assert.match(readme, /--props='\{"transparent":true\}'/);
  assert.match(readme, /--codec=prores --prores-profile=4444 --image-format=png --pixel-format=yuva444p10le/);
  assert.match(readme, /--codec=vp9 --image-format=png --pixel-format=yuva420p/);
});
