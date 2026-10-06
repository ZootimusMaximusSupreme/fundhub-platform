// The files the script writer reads to pick an animation, an angle and a
// recipe (spec §7.3): marketing/broll/catalog.json (built by ./catalog.mjs),
// marketing/ads/angles.json and marketing/ads/RECIPES.md.
//
// The catalog tests run on the real kit and on small made-up kits. The real
// kit proves the committed file is current and complete. The made-up kits
// prove the reader stops instead of guessing when it meets code it cannot read.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildCatalog, buildCatalogReport, serializeCatalog, readKitSources, headerComment,
  CatalogReadError, CATALOG_SKIP
} from "./catalog.mjs";
import { LABEL_KEY_RE } from "../ads/label-keys.mjs";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const KIT = join(REPO, "marketing", "broll");
const CATALOG_FILE = join(KIT, "catalog.json");

const kitSources = readKitSources(KIT);
const committed = JSON.parse(readFileSync(CATALOG_FILE, "utf8"));
const byId = new Map(committed.map((e) => [e.id, e]));

// ---------------------------------------------------------------------------
// The real kit

test("catalog.json is exactly what the builder makes from the kit today (run node marketing/broll/scripts/catalog.mjs)", () => {
  const fresh = serializeCatalog(buildCatalog(kitSources));
  assert.equal(readFileSync(CATALOG_FILE, "utf8"), fresh,
    "marketing/broll/catalog.json is stale. Run: node marketing/broll/scripts/catalog.mjs");
});

/* An independent count: every id="..." written on a <Composition> in the kit,
   plus every id in the registry's TEMPLATES list. Found by plain text search,
   not by the builder, so a composition the builder failed to follow shows up
   here as missing. */
function compositionIdsByText() {
  const ids = new Set();
  for (const [file, text] of Object.entries(kitSources)) {
    // Attribute values hold "=>", so the element ends at its "/>", not its first ">".
    for (let at = text.indexOf("<Composition"); at !== -1; at = text.indexOf("<Composition", at + 1)) {
      const element = text.slice(at, text.indexOf("/>", at));
      const id = /\bid="([^"]+)"/.exec(element);
      if (id) ids.add(id[1]);
      else if (!/\bid=\{e\.id\}/.test(element)) assert.fail(`${file}: a <Composition> with an id the text search cannot read`);
    }
  }
  const registry = kitSources["src/templates/registry.tsx"];
  const list = registry.slice(registry.indexOf("export const TEMPLATES"));
  for (const m of list.matchAll(/^\s+id: '([^']+)',$/gm)) ids.add(m[1]);
  return ids;
}

test("every composition the kit registers is in the catalog, except the two kit tools", () => {
  const inSource = compositionIdsByText();
  const inCatalog = new Set(committed.map((e) => e.id));
  for (const id of CATALOG_SKIP) {
    assert.ok(inSource.has(id), `${id} is still registered in the kit`);
    assert.ok(!inCatalog.has(id), `${id} is a kit tool and must not be in the catalog`);
  }
  const expected = [...inSource].filter((id) => !CATALOG_SKIP.includes(id)).sort();
  assert.deepEqual([...inCatalog].sort(), expected);
  assert.equal(committed.length, inCatalog.size, "no id appears twice");
});

test("the catalog holds the 8 registry templates and every module Root.tsx registers", () => {
  for (const id of ["QualifyToday", "FileItems", "HiddenDataPoints", "InquiriesOff", "LenderList", "StepPath", "RatesRising", "SoftPull",
    "CompanyLine", "OfferStack", "BookCall", "LenderSlots", "FundingRounds", "LenderMatchScroll", "ProofWall", "ProofFlood",
    "ProofFloodWide", "BankPockets", "BankPocketsWide", "FlatTireHammer", "JackFix", "ToolMatch"]) {
    assert.ok(byId.has(id), `${id} is missing`);
  }
});

test("every entry has exactly the contract's fields, in order", () => {
  const FIELDS = ["id", "width", "height", "fps", "min_frames", "max_frames", "default_props", "purpose", "data_tied"];
  for (const e of committed) {
    assert.deepEqual(Object.keys(e), FIELDS, e.id);
    for (const k of ["width", "height", "fps", "min_frames", "max_frames"]) {
      assert.ok(Number.isInteger(e[k]) && e[k] > 0, `${e.id}.${k}`);
    }
    assert.ok(e.min_frames <= e.max_frames, e.id);
    assert.equal(typeof e.default_props, "object", e.id);
    assert.ok(e.purpose === null || (typeof e.purpose === "string" && e.purpose.length > 0), e.id);
    assert.equal(typeof e.data_tied, "boolean", e.id);
  }
});

test("lengths come from each composition's own clamp: registry 2-3 s, ProofWall up to 4 s, ProofFlood up to 6 s", () => {
  for (const id of ["QualifyToday", "FileItems", "HiddenDataPoints", "InquiriesOff", "LenderList", "StepPath", "RatesRising", "SoftPull"]) {
    const e = byId.get(id);
    assert.deepEqual([e.min_frames, e.max_frames, e.fps], [60, 90, 30], id); // brand/format.ts clampDuration
  }
  assert.deepEqual([byId.get("ProofWall").min_frames, byId.get("ProofWall").max_frames], [90, 120]);
  assert.deepEqual([byId.get("ProofFlood").min_frames, byId.get("ProofFlood").max_frames], [120, 180]);
  assert.deepEqual([byId.get("OfferStack").min_frames, byId.get("OfferStack").max_frames], [75, 105]); // offer-cta-timeline.ts
  assert.deepEqual([byId.get("LenderSlots").min_frames, byId.get("LenderSlots").max_frames], [75, 120]); // clipTimeline.ts
  assert.deepEqual([byId.get("LenderMatchScroll").min_frames, byId.get("LenderMatchScroll").max_frames], [105, 135]);
  assert.deepEqual([byId.get("ToolMatch").min_frames, byId.get("ToolMatch").max_frames], [75, 120]);
});

test("sizes: vertical 1080x1920, the two wide versions 3840x2160", () => {
  for (const e of committed) {
    const wide = e.id.endsWith("Wide");
    assert.deepEqual([e.width, e.height], wide ? [3840, 2160] : [1080, 1920], e.id);
  }
});

test("data-tied: QualifyToday, ProofWall and the ProofFlood family, and nothing else in the kit today", () => {
  const tied = committed.filter((e) => e.data_tied).map((e) => e.id).sort();
  assert.deepEqual(tied, ["ProofFlood", "ProofFloodWide", "ProofWall", "QualifyToday"]);
});

test("default props are read from the source, spreads included", () => {
  assert.equal(byId.get("QualifyToday").default_props.today.value, 199350);
  assert.deepEqual(byId.get("LenderSlots").default_props.landOn, ["Chase", "American Express", "Bank of America"]);
  // {...bankPocketsDefaults, format: 'wide' as const}: the override keeps its place.
  assert.deepEqual(Object.keys(byId.get("BankPocketsWide").default_props), ["format", "eyebrow", "headline", "subline", "transparent"]);
  assert.equal(byId.get("BankPocketsWide").default_props.format, "wide");
  assert.equal(byId.get("ProofFloodWide").default_props.format, "wide");
  assert.equal(byId.get("FundingRounds").default_props.amounts, null, "null survives as null");
});

/* A purpose is never written by the builder: a registry template's is its own
   title and what strings, any other's is words from a comment in the kit. */
test("every purpose is the registry's own words or a comment's own words", () => {
  const registry = kitSources["src/templates/registry.tsx"];
  const titles = new Map();
  for (const m of registry.matchAll(/id: '([^']+)',\s*\n\s*file: '[^']*',\s*\n\s*title: '([^']*)',\s*\n\s*what: '([^']*)',/g)) {
    titles.set(m[1], { title: m[2], what: m[3] });
  }
  assert.equal(titles.size, 8);
  const comments = Object.values(kitSources).map((text) =>
    text.split("\n").filter((l) => /^\s*\/\//.test(l)).map((l) => l.replace(/^\s*\/\/\s?/, "").trim()).join(" ").replace(/\s+/g, " ")
  ).join(" ");
  for (const e of committed) {
    if (e.purpose === null) continue;
    if (titles.has(e.id)) {
      const { title, what } = titles.get(e.id);
      assert.equal(e.purpose, `${title}. ${what}`, e.id);
    } else {
      assert.ok(comments.includes(e.purpose), `${e.id}: its purpose is not a comment in the kit`);
    }
  }
});

test("the builder imports only Node and its sibling validator: no TypeScript, no kit package, no new dependency", () => {
  const src = readFileSync(join(REPO, "src", "marketing", "catalog.mjs"), "utf8");
  const specs = [...src.matchAll(/^import\s[^;]*?from\s+["']([^"']+)["']/gm)].map((m) => m[1]);
  assert.ok(specs.length > 0);
  for (const s of specs) assert.ok(s.startsWith("node:") || s === "./animation-plan.mjs", `unexpected import ${s}`);
  const wrapper = readFileSync(join(KIT, "scripts", "catalog.mjs"), "utf8");
  for (const m of wrapper.matchAll(/^import\s[^;]*?from\s+["']([^"']+)["']/gm)) {
    assert.ok(m[1].startsWith("node:") || m[1] === "../../../src/marketing/catalog.mjs", `unexpected import ${m[1]}`);
  }
});

// ---------------------------------------------------------------------------
// Made-up kits: what the reader does with code it can and cannot read

const FRAME_TS = "export const FRAME = {width: 1080, height: 1920, fps: 30} as const;\n";

function kit(files) {
  return { "src/brand.ts": FRAME_TS, ...files };
}

const ROOT_BASIC = `import React from 'react';
import {Composition} from 'remotion';
import {FRAME} from './brand';
import {ClipCompositions} from './clip';
import {Tool} from './tool';

export const RemotionRoot: React.FC = () => (
  <>
    <ClipCompositions />
    <Composition id="ContactSheet" component={Tool} durationInFrames={10} fps={FRAME.fps} width={FRAME.width} height={FRAME.height} />
  </>
);
`;

const CLIP_BASIC = `import React from 'react';
import {Composition} from 'remotion';
import {FRAME} from './brand';

// Clip: a test clip that says what it is for.
// Still the first paragraph.
//
// Not the first paragraph.

export const CLIP_MIN = 75;
const clampClip = (frames: number | undefined, fallback: number, min = CLIP_MIN, max = 120): number =>
  Math.min(max, Math.max(min, Math.round(frames ?? fallback)));
export const clipDefaults = {label: 'Hi', rows: [{a: 1}], none: null};
export const Clip: React.FC = (props) => {
  return <div>It's a clip</div>;
};

export const ClipCompositions: React.FC = () => (
  <>
    <Composition
      id="Clip"
      component={Clip}
      durationInFrames={90}
      fps={FRAME.fps}
      width={FRAME.width}
      height={FRAME.height}
      defaultProps={{...clipDefaults, label: 'Hello' as const}}
      calculateMetadata={({props}) => ({durationInFrames: clampClip(props.durationInFrames, 90)})}
    />
    <Composition id="Fixed" component={Clip} durationInFrames={45} fps={FRAME.fps} width={FRAME.width} height={FRAME.height} />
  </>
);
`;

const TOOL = `export const Tool = () => null;\n`;

test("a made-up kit: fields, the clamp range, spreads, the header comment, and the skipped tool", () => {
  const report = buildCatalogReport(kit({ "src/Root.tsx": ROOT_BASIC, "src/clip.tsx": CLIP_BASIC, "src/tool.tsx": TOOL }));
  assert.deepEqual(report.skipped, ["ContactSheet"]);
  assert.equal(report.catalog.length, 2);
  const [clip, fixed] = report.catalog;
  assert.deepEqual(clip, {
    id: "Clip", width: 1080, height: 1920, fps: 30, min_frames: 75, max_frames: 120,
    default_props: { label: "Hello", rows: [{ a: 1 }], none: null },
    purpose: "Clip: a test clip that says what it is for. Still the first paragraph.",
    data_tied: false
  });
  // No calculateMetadata: the clip is exactly its durationInFrames long.
  assert.deepEqual([fixed.min_frames, fixed.max_frames], [45, 45]);
  assert.deepEqual(fixed.default_props, {});
});

test("a component file with no header comment gets purpose null, and the report lists it", () => {
  const clip = CLIP_BASIC.replace(/\/\/ Clip:[\s\S]*?Not the first paragraph\.\n/, "");
  const report = buildCatalogReport(kit({ "src/Root.tsx": ROOT_BASIC, "src/clip.tsx": clip, "src/tool.tsx": TOOL }));
  assert.equal(report.catalog[0].purpose, null);
  assert.deepEqual(report.nullPurpose, ["Clip", "Fixed"]);
});

test("a value that needs the kit to run stops the build with its file and line, never a guess", () => {
  const clip = CLIP_BASIC.replace("width={FRAME.width}\n      height", "width={useVideoConfig().width}\n      height")
    .replace("import {Composition} from 'remotion';", "import {Composition, useVideoConfig} from 'remotion';");
  assert.throws(
    () => buildCatalog(kit({ "src/Root.tsx": ROOT_BASIC, "src/clip.tsx": clip, "src/tool.tsx": TOOL })),
    (e) => e instanceof CatalogReadError && /src\/clip\.tsx:\d+: the kit calls remotion \(useVideoConfig\)/.test(e.message)
  );
});

test("a clamp with no ceiling stops the build instead of writing a made-up maximum", () => {
  const clip = CLIP_BASIC.replace("Math.min(max, Math.max(min, Math.round(frames ?? fallback)))", "Math.max(min, Math.round(frames ?? fallback))");
  assert.throws(
    () => buildCatalog(kit({ "src/Root.tsx": ROOT_BASIC, "src/clip.tsx": clip, "src/tool.tsx": TOOL })),
    (e) => e instanceof CatalogReadError && /Clip: its length has no ceiling/.test(e.message)
  );
});

test("default props that hold code stop the build", () => {
  const clip = CLIP_BASIC.replace("none: null}", "none: null, render: () => 1}");
  assert.throws(
    () => buildCatalog(kit({ "src/Root.tsx": ROOT_BASIC, "src/clip.tsx": clip, "src/tool.tsx": TOOL })),
    (e) => e instanceof CatalogReadError && /Clip defaultProps\.render is code/.test(e.message)
  );
});

test("an id registered twice stops the build", () => {
  const clip = CLIP_BASIC.replace('id="Fixed"', 'id="Clip"');
  assert.throws(
    () => buildCatalog(kit({ "src/Root.tsx": ROOT_BASIC, "src/clip.tsx": clip, "src/tool.tsx": TOOL })),
    (e) => e instanceof CatalogReadError && /registered twice/.test(e.message)
  );
});

test("a composition that Root does not render is not in the catalog", () => {
  const root = ROOT_BASIC.replace("    <ClipCompositions />\n", "");
  assert.deepEqual(buildCatalog(kit({ "src/Root.tsx": root, "src/clip.tsx": CLIP_BASIC, "src/tool.tsx": TOOL })), []);
});

test("a registry list: a template's purpose is its own title and what, and data-tied ids are flagged", () => {
  const root = `import React from 'react';
import {Composition} from 'remotion';
import {TEMPLATES} from './registry';

export const RemotionRoot: React.FC = () => <>{TEMPLATES.map((t) => t.composition())}</>;
`;
  const registry = `import React from 'react';
import {Composition} from 'remotion';
import {FRAME} from './brand';
import {Card, cardDefaults} from './card';

const clampDuration = (frames: number | undefined, fallback: number): number => {
  const f = Math.round(frames ?? fallback);
  return Math.min(90, Math.max(60, f));
};

const entry = <P extends {durationInFrames?: number}>(e: {id: string; title: string; what: string; base: number; component: React.ComponentType<P>; defaultProps: P}) => ({
  id: e.id,
  title: e.title,
  what: e.what,
  composition: () => (
    <Composition key={e.id} id={e.id} component={e.component} durationInFrames={e.base} fps={FRAME.fps} width={FRAME.width} height={FRAME.height}
      defaultProps={e.defaultProps}
      calculateMetadata={({props}) => ({durationInFrames: clampDuration(typeof props.durationInFrames === 'number' ? props.durationInFrames : undefined, e.base)})} />
  ),
});

export const TEMPLATES = [
  entry({id: 'QualifyToday', title: 'Qualify today', what: 'Two amounts roll up.', base: 75, component: Card, defaultProps: cardDefaults}),
  entry({id: 'Plain', title: 'A plain card', what: 'Nothing more.', base: 75, component: Card, defaultProps: {...cardDefaults}}),
];
`;
  const card = "export const cardDefaults = {eyebrow: 'Card'};\nexport const Card = () => null;\n";
  const out = buildCatalog(kit({ "src/Root.tsx": root, "src/registry.tsx": registry, "src/card.tsx": card }));
  assert.deepEqual(out.map((e) => [e.id, e.min_frames, e.max_frames, e.purpose, e.data_tied]), [
    ["QualifyToday", 60, 90, "Qualify today. Two amounts roll up.", true],
    ["Plain", 60, 90, "A plain card. Nothing more.", false]
  ]);
});

test("a component body is never read unless a value needs it, and then it stops cleanly", () => {
  // CLIP_BASIC's Clip component returns <div>It's a clip</div>. The builds
  // above pass because that body is never read: `component={Clip}` is followed
  // to its file for the purpose, never run. Asking for a value that needs the
  // body stops with a CatalogReadError, never a crash or a wrong number.
  const clip = CLIP_BASIC.replace('id="Fixed" component={Clip} durationInFrames={45}', 'id="Fixed" component={Clip} durationInFrames={Clip()}');
  assert.notEqual(clip, CLIP_BASIC);
  assert.throws(
    () => buildCatalog(kit({ "src/Root.tsx": ROOT_BASIC, "src/clip.tsx": clip, "src/tool.tsx": TOOL })),
    (e) => e instanceof CatalogReadError && /src\/clip\.tsx:\d+: a function body could not be read/.test(e.message)
  );
});

test("headerComment: the first paragraph of the // block right after the imports", () => {
  assert.equal(headerComment("import a from 'a';\n\n// One two.\n// Three.\n//\n// Four.\nexport const x = 1;\n"), "One two. Three.");
  assert.equal(headerComment("import {\n  a,\n} from 'a';\n// Multi-line import first.\n"), "Multi-line import first.");
  assert.equal(headerComment("import a from 'a';\n/** A doc comment is not a header. */\nexport const x = 1;\n"), null);
  assert.equal(headerComment("import a from 'a';\nexport const x = 1;\n// Too late.\n"), null);
});

// ---------------------------------------------------------------------------
// marketing/ads/angles.json

const ANGLES = JSON.parse(readFileSync(join(REPO, "marketing", "ads", "angles.json"), "utf8"));
const ASSET_BANK = readFileSync(join(REPO, "marketing", "ads", "ASSET-BANK.md"), "utf8");

function assetBankSection(n) {
  const start = ASSET_BANK.indexOf(`\n## ${n}. `);
  assert.ok(start >= 0, `ASSET-BANK.md has a §${n}`);
  const end = ASSET_BANK.indexOf("\n## ", start + 5);
  return ASSET_BANK.slice(start, end === -1 ? undefined : end);
}
const unmark = (s) => s.replace(/\*\*/g, "").replace(/(^|[^*])\*([^*]+)\*/g, "$1$2").trim();

/** Every angle ASSET-BANK.md §2, §3 and §4 list, read straight from the file. */
function assetBankAngles() {
  const out = [];
  for (const m of assetBankSection(2).matchAll(/^### Mechanism \d+ — (.+?)(?: ← .*)?$/gm)) out.push(["ASSET-BANK §2", m[1].trim()]);
  for (const m of assetBankSection(3).matchAll(/^\d+\. (.+)$/gm)) out.push(["ASSET-BANK §3", unmark(m[1])]);
  const s4 = assetBankSection(4);
  out.push(["ASSET-BANK §4", /^### Core avatar — "(.+)"$/m.exec(s4)[1]]);
  for (const m of s4.matchAll(/^\| \*\*[A-Z]\*\* \| \*\*(.+?)\*\* \|/gm)) out.push(["ASSET-BANK §4", m[1]]);
  out.push(["ASSET-BANK §4", /^### The sixth — (.+)$/m.exec(s4)[1].trim()]);
  return out;
}

test("angles.json: every entry is {key, name, notes, source} with a key the database accepts", () => {
  assert.ok(Array.isArray(ANGLES) && ANGLES.length > 0);
  const keys = new Set();
  for (const a of ANGLES) {
    assert.deepEqual(Object.keys(a), ["key", "name", "notes", "source"], JSON.stringify(a));
    for (const k of ["key", "name", "notes", "source"]) assert.equal(typeof a[k], "string", `${a.key}.${k}`);
    assert.match(a.key, LABEL_KEY_RE, `${a.key} must fit ad_scripts_angle_ck (377)`);
    assert.ok(!keys.has(a.key), `${a.key} appears twice`);
    keys.add(a.key);
    assert.ok(a.name.trim() && a.notes.trim(), a.key);
  }
});

test("angles.json holds every angle in ASSET-BANK §2, §3 and §4, names exactly as written", () => {
  const listed = assetBankAngles();
  assert.equal(listed.length, 29, "5 mechanisms, 18 enemy items, 6 audiences");
  const have = new Set(ANGLES.map((a) => `${a.source}|${a.name}`));
  for (const [source, name] of listed) assert.ok(have.has(`${source}|${name}`), `missing: ${source} ${name}`);
});

test("angles.json invents no angle: every ASSET-BANK entry is in that section's list", () => {
  const listed = new Set(assetBankAngles().map(([s, n]) => `${s}|${n}`));
  for (const a of ANGLES.filter((x) => /^ASSET-BANK §\d+$/.test(x.source))) {
    assert.ok(listed.has(`${a.source}|${a.name}`), `${a.name} is not listed in ${a.source}`);
  }
  // Anything else must say where it came from (the writer may add one later
  // through the outbox, spec §7.3); today there is nothing else.
  assert.equal(ANGLES.filter((x) => !/^ASSET-BANK §\d+$/.test(x.source)).length, 0);
});

test("angles.json: the key is a slug of the name, cut at a word to fit 49 characters", () => {
  for (const a of ANGLES) {
    const slug = a.name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
    assert.ok(slug === a.key || (slug.startsWith(`${a.key}_`) && slug.length > 49), `${a.key} vs ${slug}`);
  }
});

// ---------------------------------------------------------------------------
// marketing/ads/RECIPES.md

test("RECIPES.md is Appendix B of the spec, word for word", () => {
  const spec = readFileSync(join(REPO, "docs", "specs", "marketing-machine-2026-10-04.md"), "utf8");
  const head = spec.indexOf("## Appendix B: Recipes");
  assert.ok(head >= 0, "the spec still has Appendix B");
  const from = spec.indexOf("\n", head) + 1;
  const to = spec.indexOf("\n---\n", from);
  const appendix = spec.slice(from, to).trim();
  const recipes = readFileSync(join(REPO, "marketing", "ads", "RECIPES.md"), "utf8");
  assert.ok(recipes.startsWith("# Recipes\n\n"), "a title line, then the appendix");
  assert.equal(recipes.slice("# Recipes\n\n".length).trim(), appendix);
});
