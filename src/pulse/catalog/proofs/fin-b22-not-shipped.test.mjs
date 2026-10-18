// Batch 22, generation 3: the "this step is not on the live page" reader, tested.
//
// The pages this repo serves are the pages the live site serves (public/ goes out with every ship; the climate,
// consulting and ops-admin pages were measured byte for byte against the live site on 2026-10-15), so the reader
// runs over the real files here, and over copies with one thing changed at a time. The reads run through a
// stand-in site: a function that answers each address from a file or a string. No network.
//
// What must hold:
//   - the real pages say "na" for all seven steps, and say what is absent;
//   - a copy of a page that carries a step's word or door (in plain text, in a tag, hidden by an entity, a join,
//     a concatenation, a character code, base64, a lazily loaded file, a bare relative script) is NOT_PROVED;
//   - a page that was not read in full, or is not the page the claim is about, is a skip, never "na";
//   - the morning audit's question is true on the real pages and false on every one of those breaks.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import {
  NOT_SHIPPED_CODE, NOT_SHIPPED_CLAIMS, FIN_B22_NOT_SHIPPED_SURFACES, notShippedRowId, claimProblem,
  readSite, judgeClaim, runFinB22NotShipped, verifyNotShipped, DEFAULT_BASE_URL,
} from "./fin-b22-not-shipped.mjs";
import { REPO_ROOT } from "./fin-b22-sql-kit.mjs";

const PUBLIC = path.join(REPO_ROOT, "public");
const ORIGIN = DEFAULT_BASE_URL;

const CLIMATE = "/climate/";
const CONSULTING = "/consulting/";
const OPS = "/app/ops-admin.html";
const PRESENT_SURFACE = "journey:climate-lead-magnet-intended#3-state-click";

const claimFor = (needle) => {
  const found = NOT_SHIPPED_CLAIMS.find((claim) => claim.surface.includes(needle));
  assert.ok(found, needle);
  return found;
};
const idFor = (needle) => notShippedRowId(claimFor(needle));

function readPublic(pathname) {
  let file = path.join(PUBLIC, pathname);
  if (pathname.endsWith("/")) file = path.join(file, "index.html");
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) return null;
  return fs.readFileSync(file, "utf8");
}

/**
 * A stand-in site. `over` maps a path to a string, { status, body }, an Error to throw, or a function.
 * Anything not overridden is the real file under public/, or a 404.
 */
function site(over = {}) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    const u = new URL(String(url));
    calls.push(u.pathname);
    assert.equal(init.method, "GET", "the read is GET only");
    assert.equal(u.origin, ORIGIN, "the read stays on the site");
    if (Object.hasOwn(over, u.pathname)) {
      const hit = over[u.pathname];
      if (hit instanceof Error) throw hit;
      const answer = typeof hit === "function" ? hit(u) : hit;
      const spec = typeof answer === "string" ? { status: 200, body: answer } : answer;
      return new Response(spec.body ?? "", { status: spec.status ?? 200 });
    }
    const body = readPublic(u.pathname);
    return body === null ? new Response("not found", { status: 404 }) : new Response(body, { status: 200 });
  };
  fetchImpl.calls = calls;
  return fetchImpl;
}

/** The real page with a change. */
const changed = (pathname, fn) => ({ [pathname]: fn(readPublic(pathname)) });
const appended = (pathname, text) => changed(pathname, (html) => html.replace(/<\/body>/i, `${text}</body>`));
const withScript = (pathname, code) => appended(pathname, `<script>${code}</script>`);

async function rows(over = {}) {
  return runFinB22NotShipped({ fetchImpl: site(over) });
}

const statusOf = (map, needle) => map.get(idFor(needle)).status;
const site_ = site;
const squashed = (text) => String(text).toLowerCase().replace(/\s+/g, " ");

// ── the list itself ──────────────────────────────────────────────────────────

test("the list names seven steps, each complete, and each is a different Flow row", () => {
  assert.equal(NOT_SHIPPED_CLAIMS.length, 7);
  assert.equal(FIN_B22_NOT_SHIPPED_SURFACES.size, 7);
  for (const claim of NOT_SHIPPED_CLAIMS) assert.equal(claimProblem(claim), null, claim.surface);
  assert.equal(new Set(NOT_SHIPPED_CLAIMS.map(notShippedRowId)).size, 7);
  assert.deepEqual([...FIN_B22_NOT_SHIPPED_SURFACES].sort(), [
    "journey:climate-lead-magnet-intended#1-headline-button",
    "journey:climate-lead-magnet-intended#3-state-click",
    "journey:climate-lead-magnet-intended#4-form",
    "journey:climate-lead-magnet-intended#6-gate",
    "journey:fh-consulting-intended#2-education-only",
    "journey:fh-consulting-intended#3-three-prices",
    "ui:ops-admin outbound mail panel",
  ]);
  assert.equal(NOT_SHIPPED_CODE, "catalog-flow-step-not-shipped");
});

test("an incomplete claim is refused", () => {
  const good = claimFor("#1-headline");
  assert.equal(claimProblem({ ...good, anchors: [] }), "no anchor");
  assert.equal(claimProblem({ ...good, markers: [] }), "no marker");
  assert.equal(claimProblem({ ...good, pages: ["climate"] }), "pages are not site paths");
  assert.equal(claimProblem({ ...good, surface: "" }), "no family or surface");
  assert.equal(claimProblem({ ...good, identity: {} }), "no identity");
  assert.equal(claimProblem({ ...good, identity: { title: "" } }), "no identity");
  assert.equal(claimProblem({ ...good, identity: null }), "no identity");
});

test("the four climate steps each hold the dashboard's identity: its title, and no form on the page", () => {
  for (const needle of ["#1-headline", "#3-state-click", "#4-form", "#6-gate"]) {
    assert.deepEqual({ ...claimFor(needle).identity }, { title: "Lending Climate Dashboard", noControls: true }, needle);
  }
});

// ── the real pages ───────────────────────────────────────────────────────────

test("on the real pages six steps are absent and the restored state-click step stays red", async () => {
  const fetchImpl = site();
  const map = await runFinB22NotShipped({ fetchImpl });
  assert.equal(map.size, 7);
  for (const claim of NOT_SHIPPED_CLAIMS) {
    const row = map.get(notShippedRowId(claim));
    if (claim.surface === PRESENT_SURFACE) {
      assert.equal(row.status, "NOT_PROVED", claim.surface);
      assert.equal(row.na, undefined);
      assert.match(row.detail, /live page carries this step now.*"not a decision about you"/);
      assert.match(row.suggestedFix, /attach a check on the saved result/);
      continue;
    }
    assert.equal(row.status, "na", claim.surface);
    assert.deepEqual(row.na, { code: NOT_SHIPPED_CODE, args: { family: claim.family, surface: claim.surface } });
    assert.ok(row.detail.startsWith(`${claim.surface}:`), row.detail);
    assert.match(row.detail, /does not carry it/);
    assert.equal(row.suggestedFix, null);
  }
  // Three page sets, one read each: the four climate steps share one.
  const climateReads = fetchImpl.calls.filter((p) => p === CLIMATE).length;
  assert.equal(climateReads, 1, "four climate steps, one read of /climate/");
  assert.equal(fetchImpl.calls.filter((p) => p === CONSULTING).length, 1);
  assert.equal(fetchImpl.calls.filter((p) => p === OPS).length, 1);
});

test("the live address of the ops-admin page, the climate page and the consulting page are read, nothing else is called", async () => {
  const fetchImpl = site();
  await runFinB22NotShipped({ fetchImpl });
  const allowed = (p) => p.startsWith("/climate/") || p.startsWith("/consulting/") || p.startsWith("/app/")
    || p === "/funnel/rb2b.js" || p.startsWith("/vendor/");
  for (const p of fetchImpl.calls) assert.ok(allowed(p), `unexpected address read: ${p}`);
});

test("the morning audit reports the restored state-click step as present and the other six as absent", async () => {
  const fetchImpl = site();
  for (const claim of NOT_SHIPPED_CLAIMS) {
    assert.equal(
      await verifyNotShipped({ family: claim.family, surface: claim.surface }, { fetchImpl }),
      claim.surface !== PRESENT_SURFACE,
      claim.surface,
    );
  }
});

// ── a page that carries the step ─────────────────────────────────────────────

// Each step's words and doors, written out here on purpose: this list is the test's own, so a marker dropped
// from the module's list is a red test, not a shorter loop.
const EXPECTED = Object.freeze([
  { needle: "#1-headline", page: CLIMATE, markers: ["See how many banks in our book fit your state", "Get your number"] },
  { needle: "#3-state-click", page: CLIMATE, markers: ["not a decision about you", "wider picture", "Pick a state"] },
  { needle: "#4-form", page: CLIMATE, markers: ["climate-match", "climate_match", "Show my number", "website:climate"] },
  { needle: "#6-gate", page: CLIMATE, markers: ["Business Financial Assessment", "Get the full list", "more names are in the full list", "/api/public/optimize"] },
  { needle: "#2-education-only", page: CONSULTING, markers: ["education for business operations", "education only", "not a lender"] },
  { needle: "#3-three-prices", page: CONSULTING, markers: ["$5,000", "$10,000", "Operations Foundations", "Operations Systems", "Operations Intensive"] },
  { needle: "ops-admin outbound mail panel", page: OPS, markers: ["alert_email", "alertEmail", "alert-email", "alert address", "alert email"] },
]);

test("each step's list of words and doors is exactly the one written down here", () => {
  assert.equal(EXPECTED.length, 7);
  for (const { needle, markers } of EXPECTED) {
    assert.deepEqual([...claimFor(needle).markers].sort(), [...markers].sort(), needle);
  }
});

test("every word and door turns its row red without hiding the restored state-click red", async () => {
  for (const { needle, page, markers } of EXPECTED) {
    for (const marker of markers) {
      const map = await rows(appended(page, `<p>${marker}</p>`));
      assert.equal(statusOf(map, needle), "NOT_PROVED", `${needle}: ${marker}`);
      assert.ok(map.get(idFor(needle)).detail.includes(JSON.stringify(marker)), `${needle}: ${marker}`);
      for (const other of EXPECTED.filter((entry) => entry.needle !== needle)) {
        const expected = other.needle === "#3-state-click" ? "NOT_PROVED" : "na";
        assert.equal(statusOf(map, other.needle), expected, `${other.needle} is untouched by ${needle}: ${marker}`);
      }
    }
  }
});

test("a consulting page that posts a price turns only the price step back to not proved", async () => {
  const map = await rows(appended(CONSULTING, "<p>Operations Foundations — $5,000</p>"));
  assert.equal(statusOf(map, "#3-three-prices"), "NOT_PROVED");
  assert.equal(statusOf(map, "#2-education-only"), "na");
  assert.match(map.get(idFor("#3-three-prices")).detail, /No check yet judges/);
});

test("a consulting page that says it is not a lender turns only the education step back to not proved", async () => {
  const map = await rows(appended(CONSULTING, "<p>Fundhub is not a lender.</p>"));
  assert.equal(statusOf(map, "#2-education-only"), "NOT_PROVED");
  assert.equal(statusOf(map, "#3-three-prices"), "na");
});

test("an ops-admin panel with an alert-address field is not proved, a different app page with the words is not", async () => {
  const field = await rows(changed(OPS, (html) => html.replace(
    '<div id="outboxMsg"', '<label>Alert address <input id="alertEmail"></label><div id="outboxMsg"')));
  assert.equal(statusOf(field, "ops-admin outbound mail panel"), "NOT_PROVED");
  assert.match(field.get(idFor("ops-admin outbound mail panel")).detail, /alert address/i);

  // Another app page that talks about an alert email is not this panel. The shell script names every app page
  // in a string; those are guesses, and the read of this panel does not follow them.
  const other = await rows({ "/app/messaging.html": "<!doctype html><html><body>Set the alert email here</body></html>" });
  assert.equal(statusOf(other, "ops-admin outbound mail panel"), "na");
});

test("a script the ops-admin page loads by a bare relative name is read (data.js)", async () => {
  const real = readPublic("/app/data.js");
  assert.ok(real, "the real data.js is there");
  const map = await rows({ "/app/data.js": `${real}\nvar leak = { alert_email: "" };` });
  assert.equal(statusOf(map, "ops-admin outbound mail panel"), "NOT_PROVED");
});

// ── a rebuilt page: the words may all be different, the page is not the dashboard ───────────────────────────
//
// The four climate steps are "nothing to judge" because the page that ships is the owner's lending-climate
// dashboard. They name a headline, a button, a state sentence, a form and a gate. A person who builds that
// visitor page again can word every one of them a little differently, so the words alone would call the new page
// "nothing to judge". The page's identity (its title, and no form on it) cannot be reworded away.

const CLIMATE_STEPS = Object.freeze(["#1-headline", "#3-state-click", "#4-form", "#6-gate"]);
const OTHER_STEPS = Object.freeze(["#2-education-only", "#3-three-prices", "ops-admin outbound mail panel"]);

// A visitor page as it might be built again: its own title, the data door wired in, and not one of the
// markers above in it (headline, button, state sentence, form button and gate all worded another way).
const REWORDED_VISITOR_PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<title>fundhub | Lending Climate: which banks fit your state</title></head><body>
<h1>Find out which banks lend in your state</h1><button id="go">Show me banks</button>
<section id="card"><p>Here is how lending looks where you live.</p><p>This is not a verdict on you.</p></section>
<form id="lead"><input name="state"><input name="revenue"><input name="email"><button>Send my score</button></form>
<a href="/checkout">Unlock the whole report</a>
<script>fetch("/api/climate").then(r => r.json());</script></body></html>`;

function assertAllFourNotProved(map, why) {
  for (const needle of CLIMATE_STEPS) assert.equal(statusOf(map, needle), "NOT_PROVED", `${needle}: ${why}`);
  for (const needle of OTHER_STEPS) assert.equal(statusOf(map, needle), "na", `${needle} is untouched: ${why}`);
}

test("the mock the manifest points a builder to, wired to the data door, turns all four climate steps back to not proved", async () => {
  const mock = fs.readFileSync(path.join(REPO_ROOT, "marketing/landing-pages/climate-front-door-2026-09-18/climate-front-door-mock.html"), "utf8");
  const built = mock.replace(/<\/body>/i, '<script>fetch("/api/climate");</script></body>');
  assert.ok(!/Show my number|climate-match/.test(built), "the mock names none of the step's doors, which is the point");
  // The mock links into the app, and the real app pages lead to more than the read's file cap, so on the full site
  // this is a skip; with the rest of the site missing it is a NOT_PROVED. Either way it is never "na".
  const onlyTheTwoPages = async (url) => {
    const pathname = new URL(String(url)).pathname;
    return [CLIMATE, "/climate/lender-climate/"].includes(pathname)
      ? new Response(built, { status: 200 })
      : new Response("not found", { status: 404 });
  };
  const withTheWholeSite = site({ [CLIMATE]: built, "/climate/lender-climate/": built });
  for (const [label, fetchImpl, expected] of [
    ["the rest of the site as it is", withTheWholeSite, ["NOT_PROVED", "skip"]],
    ["only the two pages", onlyTheTwoPages, ["NOT_PROVED"]],
  ]) {
    const map = await runFinB22NotShipped({ fetchImpl });
    for (const needle of CLIMATE_STEPS) {
      assert.notEqual(statusOf(map, needle), "na", `${needle}: ${label}`);
      assert.ok(expected.includes(statusOf(map, needle)), `${needle}: ${label}: ${statusOf(map, needle)}`);
    }
    for (const claim of NOT_SHIPPED_CLAIMS.filter((c) => c.surface.includes("climate-lead"))) {
      assert.equal(await verifyNotShipped({ family: claim.family, surface: claim.surface }, { fetchImpl }), false, `${claim.surface}: ${label}`);
    }
  }
});

test("a visitor page rebuilt with every headline, button, sentence and gate worded another way is not nothing-to-judge", async () => {
  for (const marker of EXPECTED.filter((e) => e.page === CLIMATE).flatMap((e) => e.markers)) {
    assert.ok(!squashed(REWORDED_VISITOR_PAGE).includes(squashed(marker)), `the rebuilt page must not carry ${marker}`);
  }
  const map = await rows({ [CLIMATE]: REWORDED_VISITOR_PAGE, "/climate/lender-climate/": REWORDED_VISITOR_PAGE });
  assertAllFourNotProved(map, "reworded rebuild");
  const detail = map.get(idFor("#1-headline")).detail;
  assert.match(detail, /not the page this step was judged against/);
  assert.match(detail, /no longer titled "Lending Climate Dashboard"/);
});

test("the dashboard's own page with a form dropped on it is not nothing-to-judge", async () => {
  const form = '<form><input name="email"><button>Go</button></form>';
  const map = await rows(appended(CLIMATE, form));
  assertAllFourNotProved(map, "a form on the dashboard");
  assert.match(map.get(idFor("#4-form")).detail, /holds a form or an input/);
});

test("a lone input, textarea or select on the page is enough", async () => {
  for (const tag of ["<input name=x>", "<textarea></textarea>", "<select></select>", "<FORM>"]) {
    assertAllFourNotProved(await rows(appended(CLIMATE, tag)), tag);
  }
});

test("a retitled dashboard is not nothing-to-judge, and the title is read on every page the step names", async () => {
  const retitle = (html, title) => html.replace(/<title>[^<]*<\/title>/i, `<title>${title}</title>`);
  assertAllFourNotProved(await rows(changed(CLIMATE, (html) => retitle(html, "Lending map for visitors"))), "retitled /climate/");
  const second = "/climate/lender-climate/";
  assertAllFourNotProved(await rows(changed(second, (html) => retitle(html, "Lending map for visitors"))), "retitled the second page");
  // A title that only says it with other capital letters and spacing is the same title.
  const same = await rows(changed(CLIMATE, (html) => retitle(html, "FundHub  LENDING climate   dashboard")));
  for (const needle of CLIMATE_STEPS) {
    assert.equal(statusOf(same, needle), needle === "#3-state-click" ? "NOT_PROVED" : "na", needle);
  }
});

test("a title with no title tag at all is a change, not a pass", async () => {
  const map = await rows(changed(CLIMATE, (html) => html.replace(/<title>[^<]*<\/title>/i, "")));
  assertAllFourNotProved(map, "no title");
});

test("judgeClaim says changed for a page that is no longer the dashboard, with the reason", async () => {
  const claim = claimFor("#6-gate");
  const site = await readSite(claim.pages, {
    fetchImpl: site_({ [CLIMATE]: REWORDED_VISITOR_PAGE, "/climate/lender-climate/": REWORDED_VISITOR_PAGE }), origin: ORIGIN,
  });
  const verdict = judgeClaim(claim, site);
  assert.equal(verdict.state, "changed");
  assert.match(verdict.reason, /no longer titled/);
  assert.equal(await verifyNotShipped({ family: claim.family, surface: claim.surface },
    { fetchImpl: site_({ [CLIMATE]: REWORDED_VISITOR_PAGE, "/climate/lender-climate/": REWORDED_VISITOR_PAGE }) }), false);
});

test("the consulting and ops-admin steps carry no identity rule (their own pages are judged by their words)", () => {
  for (const needle of OTHER_STEPS) assert.equal(claimFor(needle).identity, undefined, needle);
});

// ── the easy ways to hide a word are undone ──────────────────────────────────

const SENTENCE = "See how many banks in our book fit your state";

const HIDINGS = Object.freeze({
  "tags between the words": () => appended(CLIMATE, "<h1>See how many <b>banks</b> in our <i>book</i> fit your state</h1>"),
  "an entity for a letter": () => appended(CLIMATE, "<h1>See how many b&#97;nks in our book fit your state</h1>"),
  "a non-breaking space": () => appended(CLIMATE, "<h1>See&nbsp;how many banks in our book fit your state</h1>"),
  "capital letters": () => appended(CLIMATE, "<h1>SEE HOW MANY BANKS IN OUR BOOK FIT YOUR STATE</h1>"),
  "a string put together": () => withScript(CLIMATE, 'document.title="See how many banks in " + "our book fit your state";'),
  "a concat": () => withScript(CLIMATE, 'document.title="See how many banks".concat(" in our book fit your state");'),
  "an array join": () => withScript(CLIMATE, 'document.title=["See how many banks","in our book fit your state"].join(" ");'),
  "base64": () => withScript(CLIMATE, `document.title=atob("${Buffer.from(SENTENCE).toString("base64")}");`),
  "character codes": () => withScript(CLIMATE, `document.title=String.fromCharCode(${[...SENTENCE].map((c) => c.charCodeAt(0)).join(",")});`),
  "an escape in a script": () => withScript(CLIMATE, 'document.title="See how many banks in our book fit your \\u0073tate";'),
});

for (const [name, make] of Object.entries(HIDINGS)) {
  test(`the headline hidden by ${name} is still found`, async () => {
    const map = await rows(make());
    assert.equal(statusOf(map, "#1-headline"), "NOT_PROVED", name);
  });
}

test("a step carried only by a script the page loads later is found (an import with no file extension)", async () => {
  // The page names the script only by a dynamic import, and the address has no .js: only the import is a clue.
  const map = await rows({
    ...withScript(CLIMATE, 'import("/climate/lazy/lead-form");'),
    "/climate/lazy/lead-form": 'fetch("/api/public/climate-match", { method: "POST" });',
  });
  assert.equal(statusOf(map, "#4-form"), "NOT_PROVED");
  assert.equal(statusOf(map, "#1-headline"), "na");
});

test("a step carried by an iframe page is found (a frame address with no file extension)", async () => {
  const map = await rows({
    ...appended(CLIMATE, '<iframe src="/climate/frame/lead"></iframe>'),
    "/climate/frame/lead": "<!doctype html><html><body><h1>Business Financial Assessment</h1></body></html>",
  });
  assert.equal(statusOf(map, "#6-gate"), "NOT_PROVED");
});

// ── a page that was not read in full is never "nothing to judge" ─────────────

async function onlyRow(over, needle = "#1-headline") {
  return (await rows(over)).get(idFor(needle));
}

test("no GET client: every row is a skip with the reason", async () => {
  const map = await runFinB22NotShipped({});
  assert.equal(map.size, 7);
  for (const row of map.values()) {
    assert.equal(row.status, "skip");
    assert.match(row.detail, /no GET client/);
  }
});

test("the page answers 404, 500 or a redirect: skip", async () => {
  for (const status of [404, 500, 301]) {
    const row = await onlyRow({ [CLIMATE]: { status, body: "" } });
    assert.equal(row.status, "skip", String(status));
    assert.match(row.detail, new RegExp(`answered ${status}`));
  }
});

test("the page comes back empty or as something that is not a web page: skip (the offline stub case)", async () => {
  assert.equal((await onlyRow({ [CLIMATE]: "" })).status, "skip");
  const row = await onlyRow({ [CLIMATE]: '{"error":"nope"}' });
  assert.equal(row.status, "skip");
  assert.match(row.detail, /did not come back as a web page/);
});

test("a login page that answers 200 is not the page the claim is about: skip, not nothing-to-judge", async () => {
  const login = "<!doctype html><html><body><h1>Sign in</h1><form></form></body></html>";
  for (const [pathname, needle] of [[CLIMATE, "#1-headline"], [CONSULTING, "#2-education"], [OPS, "ops-admin outbound mail panel"]]) {
    const row = await onlyRow({ [pathname]: login }, needle);
    assert.equal(row.status, "skip", pathname);
    assert.match(row.detail, /is not the page this claim is about/);
  }
});

test("a file the page loads that fails to read is a skip, never nothing-to-judge", async () => {
  const climateHtml = readPublic(CLIMATE);
  const src = /<script\b[^>]*\bsrc="(\/climate\/[^"]+)"/.exec(climateHtml)[1];
  const row = await onlyRow({ [src]: { status: 500, body: "" } });
  assert.equal(row.status, "skip");
  assert.match(row.detail, /a file the page leads to answered 500/);
});

test("a thrown read is a skip with the reason", async () => {
  const row = await onlyRow({ [CLIMATE]: new Error("socket hang up") });
  assert.equal(row.status, "skip");
  assert.match(row.detail, /socket hang up/);
});

test("a page that leads to far too many files is a skip, not a guess", async () => {
  const many = Array.from({ length: 60 }, (_, i) => `<script src="/climate/many-${i}.js"></script>`).join("");
  const row = await onlyRow(appended(CLIMATE, many));
  assert.equal(row.status, "skip");
  assert.match(row.detail, /more than 40 files/);
});

test("a read that runs out of time is a skip", async () => {
  const realNow = Date.now;
  let clock = realNow();
  try {
    Date.now = () => clock;
    const slow = async (url) => {
      clock += 9000;
      return new Response(readPublic(new URL(String(url)).pathname) ?? "", { status: 200 });
    };
    const map = await runFinB22NotShipped({ fetchImpl: slow });
    const row = map.get(idFor("#1-headline"));
    assert.equal(row.status, "skip");
    assert.match(row.detail, /ran out of time/);
  } finally {
    Date.now = realNow;
  }
});

test("a judge that throws is a skip, never a thrown lane", async () => {
  const claims = [{ ...claimFor("#1-headline"), markers: null }];
  const map = await runFinB22NotShipped({ fetchImpl: site() }, claims);
  assert.equal(map.get(notShippedRowId(claims[0])).status, "skip");
});

test("readSite and judgeClaim: the pure parts say absent, present and unread", async () => {
  const claim = claimFor("#1-headline");
  const real = await readSite(claim.pages, { fetchImpl: site(), origin: ORIGIN });
  assert.equal(real.state, "read");
  assert.ok(real.files >= 1);
  assert.equal(judgeClaim(claim, real).state, "absent");
  const bad = await readSite(claim.pages, { fetchImpl: site(appended(CLIMATE, `<p>${SENTENCE}</p>`)), origin: ORIGIN });
  assert.deepEqual(judgeClaim(claim, bad), { state: "present", found: [SENTENCE] });
  assert.equal(judgeClaim(claim, { state: "unread", reason: "x" }).state, "unread");
  assert.equal(judgeClaim(claim, null).state, "unread");
  assert.equal((await readSite(["/x/"], { fetchImpl: null, origin: ORIGIN })).state, "unread");
  assert.equal((await readSite(["/x/"], { fetchImpl: site(), origin: "not a url" })).state, "unread");
});

// ── the morning audit's question ─────────────────────────────────────────────

test("the audit's question turns false for a page that carries the step, an unread page, and an unknown claim", async () => {
  const climate = { family: "journey", surface: "journey:climate-lead-magnet-intended#4-form" };
  assert.equal(await verifyNotShipped(climate, { fetchImpl: site() }), true);
  assert.equal(await verifyNotShipped(climate, { fetchImpl: site(appended(CLIMATE, 'fetch("/api/public/climate-match")')) }), false);
  assert.equal(await verifyNotShipped(climate, { fetchImpl: site({ [CLIMATE]: { status: 500, body: "" } }) }), false);
  assert.equal(await verifyNotShipped(climate, { fetchImpl: site({ [CLIMATE]: "" }) }), false);
  assert.equal(await verifyNotShipped({ family: "journey", surface: "journey:invented#1" }, { fetchImpl: site() }), false);
  assert.equal(await verifyNotShipped({ family: "message", surface: climate.surface }, { fetchImpl: site() }), false, "the family must match");
  assert.equal(await verifyNotShipped(undefined, { fetchImpl: site() }), false);
  assert.equal(await verifyNotShipped({ ...climate }, { fetchImpl: site(), baseUrl: "not a url" }), false);
});

test("the audit hands no GET client, so the global one is used; four steps share one read", async () => {
  const fetchImpl = site();
  const real = globalThis.fetch;
  globalThis.fetch = fetchImpl;
  try {
    const answers = [];
    for (const needle of ["#1-headline", "#3-state-click", "#4-form", "#6-gate"]) {
      const claim = claimFor(needle);
      answers.push(await verifyNotShipped({ family: claim.family, surface: claim.surface }, { db: null, now: new Date() }));
    }
    assert.deepEqual(answers, [true, false, true, true]);
    assert.equal(fetchImpl.calls.filter((p) => p === CLIMATE).length, 1, "one read of /climate/ for the four steps");
  } finally {
    globalThis.fetch = real;
  }
});

test("the audit's read of a page does not reuse an old read after the page changes (new client, new read)", async () => {
  const claim = { family: "journey", surface: "journey:climate-lead-magnet-intended#4-form" };
  assert.equal(await verifyNotShipped(claim, { fetchImpl: site() }), true);
  assert.equal(await verifyNotShipped(claim, { fetchImpl: site(appended(CLIMATE, "climate-match")) }), false);
});
