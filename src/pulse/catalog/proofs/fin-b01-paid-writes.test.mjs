// Finish-the-853, batch 01, repair cycle 1: every WRITE a Command Center tab can send, sorted.
//
// The row says "cost sheet and two-tap confirm sheet drawn before every paid tap". The older guard
// (fin-b01-paid-taps.test.mjs) counts the places a tab file asks the frame for a sheet, so it can
// only notice a sheet that is added or taken out. It cannot notice a NEW paid tap that posts with no
// sheet at all, which is the break this row is about. This guard reads the other side: every place
// a tab file posts. Each one must be in the table below, in order, with what guards it:
//
//   sheet       a frame sheet (cost sheet or two-tap confirm) is asked for in the lines just above it
//   own-sheet   the tab draws its own sheet or inline two-tap (named in mustContain, checked)
//   cost-line   the button prints its cost under it and has no second tap. Today's two paid buttons.
//               This is a product finding, written down in the manifest, not a pass.
//   free        spends no model money and no ad money (saves an idea, a note, an approval, a mark,
//               a setting, or loads an ad into Meta PAUSED for $0, as the tab's own header says)
//
// A new write site, a changed count, a new transport (a direct fetch, a PUT, a beacon) or a
// classification whose proof text left the file turns this red until a person sorts it.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");

const SHEET_TOKENS = /\b(?:paidTap|twoTap|withCostSheet|askConfirm)\(|\bctx\.(?:confirm|costSheet)\(/;
const WINDOW = 45; // lines above a write in which its sheet must be asked for

// route, in file order. `sites` lists the guard of each place that route is posted, in file order.
const WRITES = {
  "public/app/marketing-cc-today.js": {
    posts: 3, transports: { "fetch(": 1 },
    rows: [
      { route: "/api/creative/generate", sites: ["cost-line"], mustContain: ["copyCostLine"], why: "Write ad copy: the cost line is printed under the button; there is no Cancel/yes sheet" },
      { route: "/api/creative/run", sites: ["cost-line"], mustContain: ["copyCostLine"], why: "the second half of Write ad copy" },
      { route: "/api/marketing/offer/generate", sites: ["cost-line"], mustContain: ["offerCostLine"], why: "Write offer: cost line under the button, no sheet" },
    ],
  },
  "public/app/marketing-cc-settings.js": {
    posts: 0, ctxPosts: 3, transports: {},
    rows: [
      { route: "/api/marketing/settings", sites: ["free", "free"], mustContain: ["switchAsk", "switch-yes"], why: "the weekly-scripts switch after its own two-tap that names the money, and the settings form; neither spends by itself" },
      { route: "/api/marketing/funnels", sites: ["free"], why: "saves a funnel's settings" },
    ],
  },
  "public/app/marketing-avatar-row.js": {
    posts: 1, transports: { "fetch(": 1 },
    rows: [
      { route: "/api/marketing/flywheel/run", sites: ["own-sheet"], mustContain: ["showModal", 'dlg.returnValue === "go"'], why: "Build the avatar opens its own cost dialog and sends only on Go. Retry (picks a failed run up again) shares the send" },
    ],
  },
  "public/app/cc-tab-ideas.js": {
    posts: 20, transports: {},
    rows: [
      { route: "marketing/ideas", sites: ["free", "free", "free"], why: "saves an idea, an accepted suggestion, or a 'more of this angle' idea. No model call" },
      { route: "marketing/batches/write-now", sites: ["sheet"] },
      { route: "marketing/research", sites: ["sheet"] },
      { route: "marketing/research/tweak", sites: ["sheet"] },
      { route: "marketing/jobs/retry", sites: ["free", "free"], mustContain: ["Free. It picks up from the saved steps."], why: "Retry: the card itself says Free, it picks up from the saved steps" },
      { route: "marketing/flywheel/campaign", sites: ["free"], why: "starts a campaign record" },
      { route: "marketing/flywheel/spend-read", sites: ["free"], why: "reads the spend; the step is marked free in the tab" },
      { route: "marketing/flywheel/run", sites: ["sheet", "free"], why: "the first runs a step behind its sheet; the second hands a failed job back to its own route (Retry, free)" },
      { route: "marketing/flywheel/approve", sites: ["free"], why: "records an approval" },
      { route: "marketing/flywheel/tweak", sites: ["sheet"] },
      { route: "marketing/funnels/create", sites: ["sheet"] },
      { route: "marketing/funnels/build", sites: ["sheet"] },
      { route: "marketing/funnels/rename", sites: ["free"], why: "renames a funnel's path" },
      { route: "marketing/funnels/push-live", sites: ["sheet"] },
      { route: "creative/generate", sites: ["sheet"] },
      { route: "creative/run", sites: ["sheet"] },
      { route: "marketing/research/approve", sites: ["free"], why: "approves a finished research" },
      { route: "marketing/research/brain", sites: ["free"], why: "saves a finished research to the brain" },
    ],
  },
  "public/app/marketing-cc-scripts.js": {
    // ctx.post( appears twice in the file's own transport wrapper (call), which every site above goes through.
    posts: 8, ctxPosts: 2, transports: {},
    rows: [
      { route: "marketing/scripts/approve", sites: ["free"], why: "approves a finished script" },
      { route: "marketing/scripts/edit", sites: ["free"], why: "saves a typed edit" },
      { route: "marketing/scripts/fix", sites: ["sheet"] },
      { route: "marketing/scripts/reject", sites: ["free"], why: "rejects a script" },
      { route: "marketing/scripts/order", sites: ["free"], why: "saves the order of scripts" },
      { route: "marketing/batches/write-now", sites: ["sheet"] },
      { route: "marketing/ideas", sites: ["free"], mustContain: ["if (writeIt) withCostSheet(", "if (writeIt) req.write_now = true;"], why: "saves an idea; when it also asks to write now (write_now) it goes behind a cost sheet first" },
      { route: "marketing/rules", sites: ["free"], why: "saves a writing rule" },
    ],
  },
  "public/app/cc-tab-shoot.js": {
    posts: 2, transports: {},
    rows: [
      { route: "marketing/shoot", sites: ["free"], mustContain: ["ctx.confirm({"], why: "plans or closes a shoot (closing asks through the frame's two-tap first); no spend" },
      { route: "marketing/shoot/mark", sites: ["free"], why: "marks a script as got it" },
    ],
  },
  "public/app/cc-tab-launch.js": {
    posts: 3, transports: {},
    rows: [
      { route: "campaigns/write", sites: ["sheet"] },
      { route: "marketing/meta/load", sites: ["free", "sheet"], mustContain: ["Loads are PAUSED. Every load button says so and costs $0."], why: "loading ONE ad puts it into Meta paused, for $0 (the tab's own header); loading all goes behind the two-tap" },
    ],
  },
  "public/app/cc-tab-numbers.js": {
    posts: 1, transports: {},
    rows: [
      { route: "marketing/ideas", sites: ["free"], why: "saves an idea from the Numbers tab" },
    ],
  },
};

// Every way a route string can be handed to a post in these files.
const SITE_PATTERNS = [
  /\bcall\(\s*["']POST["']\s*,\s*["']([^"']+)["']/g,
  /\bcallApi\(\s*\w+\s*,\s*["']POST["']\s*,\s*["']([^"']+)["']/g,
  /\bctx\.post\(\s*["']([^"']+)["']/g,
  /\bdeps\.api\(\s*["']([^"']+)["']\s*,\s*\{\s*method:\s*["']POST["']/g,
  /\bdeps\.api\(\s*([A-Z_]\w*)\s*,\s*\{\s*method:\s*["']POST["']/g,
  /(?<![\w.])api\(\s*["']([^"']+)["']\s*,\s*\{\s*method:\s*["']POST["']/g,
  /\bresearchSimple\(\s*\w+\s*,\s*["']([^"']+)["']/g,
];

function lineOf(source, index) {
  return source.slice(0, index).split("\n").length;
}

function resolveName(source, name) {
  const m = new RegExp(`\\b(?:var|const|let)\\s+${name}\\s*=\\s*["']([^"']+)["']`).exec(source);
  return m ? m[1] : name;
}

function sitesOf(source) {
  const found = [];
  for (const re of SITE_PATTERNS) {
    for (const m of source.matchAll(re)) {
      found.push({ route: resolveName(source, m[1]), line: lineOf(source, m.index) });
    }
  }
  return found.sort((a, b) => a.line - b.line);
}

const canonical = (route) => route.replace(/^\/api\//, "").replace(/^\//, "");

test("the files listed are exactly the tab scripts the Command Center page loads", () => {
  const html = read("public/app/marketing-command-center.html");
  const scripts = [...html.matchAll(/<script[^>]*\bsrc="([^"?]+)(?:\?[^"]*)?"/g)].map((m) => `public/app/${m[1]}`)
    .filter((rel) => !["public/app/shell.js", "public/app/marketing-command-center.js"].includes(rel));
  assert.deepEqual([...scripts].sort(), Object.keys(WRITES).sort(),
    "a script was added to or taken out of the Command Center page: sort its writes in this table");
});

for (const [file, spec] of Object.entries(WRITES)) {
  test(`${file}: every write is in the table, in order, and nothing posts any other way`, () => {
    const source = read(file);
    // Nothing writes through a transport this guard does not read.
    assert.equal((source.match(/["']POST["']/g) || []).length, spec.posts, `${file}: the count of "POST" literals moved`);
    assert.equal((source.match(/\bctx\.post\(/g) || []).length, spec.ctxPosts || 0, `${file}: the count of ctx.post( moved`);
    for (const token of ["fetch(", "XMLHttpRequest", "sendBeacon"]) {
      assert.equal(source.split(token).length - 1, spec.transports[token] || 0, `${file}: ${token} appears a different number of times`);
    }
    assert.equal((source.match(/["'](?:PUT|PATCH|DELETE)["']/g) || []).length, 0, `${file} sends a PUT, PATCH or DELETE`);

    // Every site the file has, against the table.
    const found = sitesOf(source);
    const wantSites = spec.rows.reduce((n, r) => n + r.sites.length, 0);
    const byRoute = new Map();
    for (const site of found) {
      const key = canonical(site.route);
      if (!byRoute.has(key)) byRoute.set(key, []);
      byRoute.get(key).push(site);
    }
    for (const row of spec.rows) {
      const here = byRoute.get(canonical(row.route)) || [];
      assert.equal(here.length, row.sites.length, `${file}: ${row.route} is posted ${here.length} times; the table says ${row.sites.length}. Sort the new write.`);
      byRoute.delete(canonical(row.route));
    }
    assert.deepEqual([...byRoute.keys()], [], `${file}: writes not in the table: ${[...byRoute.keys()].join(", ")}`);
    assert.equal(found.length, wantSites);
  });

  test(`${file}: each write the table calls "sheet" has its sheet asked for just above it, and each other class still has its proof`, () => {
    const source = read(file);
    const lines = source.split("\n");
    const found = sitesOf(source);
    for (const row of spec.rows) {
      const here = found.filter((s) => canonical(s.route) === canonical(row.route));
      row.sites.forEach((kind, i) => {
        const site = here[i];
        if (kind === "sheet") {
          const above = lines.slice(Math.max(0, site.line - 1 - WINDOW), site.line).join("\n");
          assert.match(above, SHEET_TOKENS, `${file}:${site.line} posts ${row.route} with no sheet asked for in the ${WINDOW} lines above it`);
        }
      });
      for (const proof of row.mustContain || []) {
        assert.ok(source.includes(proof), `${file}: ${row.route} is classed ${[...new Set(row.sites)].join("/")} because of "${proof}", which is no longer in the file`);
      }
      if (row.sites.some((k) => k !== "sheet")) {
        assert.ok(row.why, `${file}: ${row.route} is not behind a frame sheet and says why nowhere`);
      }
    }
  });
}

test("the two Today paid buttons are the only paid taps with no second tap, and the table says so", () => {
  const costLine = Object.entries(WRITES).flatMap(([file, s]) => s.rows.filter((r) => r.sites.includes("cost-line")).map((r) => `${file} ${r.route}`));
  assert.deepEqual(costLine, [
    "public/app/marketing-cc-today.js /api/creative/generate",
    "public/app/marketing-cc-today.js /api/creative/run",
    "public/app/marketing-cc-today.js /api/marketing/offer/generate",
  ]);
});

test("a write added with no sheet is caught: the same scan finds a made-up unsheeted post in a copy of a tab file", () => {
  const source = read("public/app/cc-tab-ideas.js");
  const broken = `${source}\nfunction sneaky(call) { call("POST", "marketing/batches/write-now", { count: 50 }); }\n`;
  const before = sitesOf(source).filter((s) => canonical(s.route) === "marketing/batches/write-now").length;
  const after = sitesOf(broken).filter((s) => canonical(s.route) === "marketing/batches/write-now").length;
  assert.equal(after, before + 1);
  // And the sheet window does not see a sheet for it, because the last sheet is far above.
  const lines = broken.split("\n");
  const site = sitesOf(broken).filter((s) => canonical(s.route) === "marketing/batches/write-now").pop();
  const above = lines.slice(Math.max(0, site.line - 1 - WINDOW), site.line).join("\n");
  assert.doesNotMatch(above, SHEET_TOKENS);
});
