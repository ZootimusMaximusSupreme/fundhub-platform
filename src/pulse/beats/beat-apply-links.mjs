// Beat: apply-links. Does the bank page behind the Apply button still open?
//
// Pulse v1, piece B1 (ops/workflows/pulse-layer-2026-10-09-v1.md; brief 07 section 3; contract 8.1 row 4).
// Chris's failure: "the Apply button stopped working on one of the banks".
//
// READ ONLY. The beat reads the lenders table through ctx.read (Postgres itself refuses a write there) and
// GETs bank pages through ctx.http.get. It holds no write handle: what it learned goes back to the runner as
// `evidence.bankLinks`, and the runner saves it (src/pulse/records.mjs upsertBankLinks). The runner hands the
// last results in as ctx.state.bankLinks (needs = ["bankLinks"]).
//
// HOW IT WORKS
//   url-shape  read the distinct application_url values (with the sha-256 of each and the lender ids);
//              a bad address (a space in it, http://) is class BAD_URL and costs no network
//   pick       up to 40 addresses: suspects first, then oldest last_checked_at (never-checked first);
//              at most 6 per issuer tracking host, 2 per other host
//   fetch      GET them, 20 at a time; no new read starts after 4 s; a read is dropped after 4.5 s
//   classify   OK / WALL / HARD / SLOW / BAD_URL (lib/bank-classify.mjs)
//   confirm    an address that WAS good (it has a last_good_at) and reads HARD or BAD_URL is read ONCE MORE,
//              right away, for at most 5 addresses. Both reads broken = RED, and the beat stops here.
//   verdict    green: counts per class
//
// WHY AN ADDRESS THAT IS BROKEN IS READ AGAIN EVERY HOUR. The alert rule (damp 2) needs two red runs in a row.
// A rotation that reads each address once a day would be red for one hour and never alert. So a "suspect"
// (was good, last read HARD or BAD_URL) goes to the front of every run until it reads OK or WALL again.
//
// RED only for: an address with last_good_at that is HARD or BAD_URL on two reads in the same run; or the
// list of addresses vanishing (url-shape); or no bank page answering at all (fetch: the pulse is blind).
// NEVER red: WALL, SLOW, an address that was never good, the first pass (empty state).
//
// Detail leads with the bank host and the class, then a short lender id (the alert layer cuts the phone text to about
// 100 characters and turns long ids into "[long value]"). It never holds a query string (bank campaign codes).
//
// WHAT GREEN "OK" PROVES. OK means the bank host answered with a page that is not a wall and whose title does not say
// "not found". It does NOT prove the link id inside the address is alive: www.mycommunitycc.com answers 200 "Online
// Application" for an id that does not exist (about 181 of 987 addresses), so a dead id on that host reads OK.
// creditcardlearnmore.com gives a real 404. Only the title is read for a soft 404, never the body.
//
// STATE NOT LOADED. With no saved list the beat cannot tell a first pass from a failed load, and every red is off. So
// when the saved list is empty it asks the database (read only) whether the table is there and whether it has rows.
// Table missing, or rows there that the runner could not load, or the runner saying bankLinksLoaded === false: red at
// "pick" ("nothing can go red"). Only an empty table that exists is a true first pass.

import {
  CAPS, TIMING, checkShape, classifyRead, isBroken, pickLinks, buildRow, buildShapeRow, breakDetail,
  runPool, withinMs
} from "./lib/bank-classify.mjs";

export const id = "apply-links";
export const title = "Bank Apply links";
export const kind = "probe";
export const covers = ["route:lenders", "desk:lenders.html", "desk:client-control-panel.html"];
export const box = false;
export const reads = [{ host: "*", methods: ["GET"] }];
export const steps = ["url-shape", "pick", "fetch", "classify", "confirm", "verdict"];
export const deadlineMs = 12000;
export const damp = 2;
export const needs = ["bankLinks"];

export const fixGuide = [
  "Open the bank named in the alert and try its Apply link by hand; fix the address on that lender row.",
  "",
  "Likely causes:",
  "- The bank moved or removed its application page (class BAD_URL, shows at step confirm).",
  "- The bank site is down or its certificate ran out (class HARD, shows at step confirm).",
  "- Our stored address has a typo, a space, or an old issuer link id (shows at step url-shape or confirm).",
  "- The pulse itself lost its web link: no bank answered at all (shows at step fetch).",
  "Steps:",
  "- Copy the lender id from the text. Open the Lenders screen in the CRM and find that row.",
  "- Open its Apply address by hand from a phone. If it opens, it was a bot wall; wait one hour.",
  "- If the page is gone, find the bank's new application page and put it in application_url on that row.",
  "- If the bank no longer takes online applications, clear application_url. Do not delete the lender.",
  "- The text names the bank host first and a short lender id. The full ids are in pulse_beats evidence (confirmed) and pulse_bank_links.",
  "- At step pick: the saved list is not there or not loading (migration 475, or the database was slow). Nothing can go red until it is back.",
  "- Green OK means the bank host answered with a page, not that the link id is alive: mycommunitycc.com answers 200 for ANY id.",
  "- Many rows on one issuer host (creditcardlearnmore.com, mycommunitycc.com, mycardapply.com) mean the issuer changed its link id.",
  "Files: public/app/lenders.html, public/app/client-control-panel.html, api/lenders.mjs, src/pulse/beats/lib/bank-classify.mjs"
].join("\n");

/* Distinct stored addresses with a fingerprint and every lender that uses each. The fingerprint is the same
   sha-256 the runner keys pulse_bank_links on, so the address itself is never stored. */
export const SQL_APPLY_URLS = `SELECT encode(sha256(convert_to(application_url, 'UTF8')), 'hex') AS url_hash,
       application_url AS url,
       array_agg(id::text ORDER BY id::text) AS lender_ids
  FROM lenders
 WHERE active
   AND application_url IS NOT NULL
   AND btrim(application_url) <> ''
 GROUP BY application_url
 ORDER BY 1`;

/* The saved list's own health, asked only when the saved list came in empty (read only; the table may not exist yet). */
export const SQL_STATE_TABLE = "SELECT to_regclass('public.pulse_bank_links') IS NOT NULL AS there";
export const SQL_STATE_COUNT = "SELECT count(*)::int AS n FROM pulse_bank_links";

const HASH_RE = /^[0-9a-f]{64}$/;
const COUNT_KEYS = ["OK", "WALL", "HARD", "SLOW", "BAD_URL"];

export async function run(ctx) {
  const t0 = Date.now();
  const elapsed = () => Date.now() - t0;
  const nowIso = ctx.now.toISOString();

  const stateRows = Array.isArray(ctx.state && ctx.state.bankLinks) ? ctx.state.bankLinks : [];
  const stateByHash = new Map();
  for (const r of stateRows) {
    if (r && typeof r.urlHash === "string") stateByHash.set(r.urlHash.toLowerCase(), r);
  }
  const firstPass = stateByHash.size === 0;
  const saved = new Map(); // urlHash -> the row the runner saves

  // One read of one address. Never throws. A read that takes too long is given up on, not waited for.
  const readOnce = async (address) => {
    try { return await withinMs(ctx.http.get(address), TIMING.readLimitMs); } catch {
      return { ok: false, status: 0, finalHost: null, error: "the read did not finish", class: "timeout" };
    }
  };

  /* ---- url-shape: the addresses on file ---- */
  const book = await ctx.step("url-shape", async () => {
    const res = await ctx.read(SQL_APPLY_URLS);
    const good = [];
    const bad = [];
    for (const r of res.rows) {
      const urlHash = String((r && r.url_hash) ?? "").toLowerCase();
      if (!HASH_RE.test(urlHash)) throw ctx.fail("url-shape", "the lenders read came back in a shape the beat does not know (no fingerprint)");
      const lenderIds = Array.isArray(r.lender_ids) ? r.lender_ids.map(String) : [];
      const shape = checkShape(r.url);
      if (shape.ok) good.push({ urlHash, url: shape.url, host: shape.host, lenderIds });
      else bad.push({ urlHash, host: shape.host, lenderIds, reason: shape.reason });
    }
    const total = good.length + bad.length;
    // A wipe: the book is under half of the addresses already checked. (v1 keeps no run counter, so this is a
    // coarse check against the saved list, not the 5%-since-last-run check in the contract.)
    if (stateByHash.size >= 50 && total < stateByHash.size / 2) {
      throw ctx.fail("url-shape", `Apply links went missing: ${total} addresses on the lenders now, ${stateByHash.size} were checked before.`);
    }
    for (const b of bad) {
      const prev = stateByHash.get(b.urlHash);
      if (!prev || prev.lastClass !== "BAD_URL") saved.set(b.urlHash, buildShapeRow({ cand: b, prev, nowIso }));
    }
    return { good, badCount: bad.length, total };
  });

  /* ---- pick: which addresses to read now ---- */
  const plan = await ctx.step("pick", async () => {
    // Is the saved list really empty, or did it fail to load? An empty list switches every red off, so say it.
    if (ctx.state && ctx.state.bankLinksLoaded === false) {
      throw ctx.fail("pick", "The saved bank link list could not be loaded this hour, so nothing can go red. Check the database and migration 475.");
    }
    if (firstPass) {
      const t = await ctx.read(SQL_STATE_TABLE);
      if (!(t.rows[0] && t.rows[0].there)) {
        throw ctx.fail("pick", "The table that holds the saved bank link list is not there (migration 475 is not applied), so nothing can be saved and nothing can go red.");
      }
      const c = await ctx.read(SQL_STATE_COUNT);
      const n = Number(c.rows[0] && c.rows[0].n) || 0;
      if (n > 0) {
        throw ctx.fail("pick", `The saved bank link list has ${n} rows but the pulse could not load it this hour, so nothing can go red.`);
      }
    }
    return pickLinks({ candidates: book.good, stateByHash });
  });

  /* ---- fetch: the reads ---- */
  const answers = await ctx.step("fetch", async () => {
    const out = await runPool(plan.picks, (p) => readOnce(p.url), {
      concurrency: CAPS.concurrency,
      canStart: () => elapsed() < TIMING.stopStartMs
    });
    const done = out.filter(Boolean);
    if (done.length > 0 && done.every((r) => r.class === "blocked")) {
      throw ctx.fail("fetch", `The pulse cannot read bank pages: web calls are on hold (ADAPTERS_DRY_RUN). ${done.length} reads were held.`);
    }
    // Blind: not one answer from a spread of different banks. That is the pulse's own web link, not 8 dead banks.
    if (done.length >= 8 && done.every((r) => !(r.status > 0))) {
      throw ctx.fail("fetch", `No bank page answered, not one of ${done.length}. The pulse may have lost its web link, so nothing was saved.`);
    }
    return out;
  });

  /* ---- classify: one class per read ---- */
  const checked = await ctx.step("classify", async () => {
    const list = [];
    plan.picks.forEach((p, i) => {
      if (!answers[i]) return; // never started (the 4 s stop): keeps its old date and goes first next hour
      const read = classifyRead(answers[i]);
      list.push({ p, read });
      saved.set(p.urlHash, buildRow({ cand: p, prev: p.prev, read, nowIso }));
    });
    return list;
  });

  /* ---- confirm: a link that WAS good and reads dead is read once more ---- */
  const confirmInfo = await ctx.step("confirm", async () => {
    const wasGood = checked.filter((c) => isBroken(c.read.cls) && c.p.prev && c.p.prev.lastGoodAt);
    const toConfirm = elapsed() > TIMING.confirmStartMs ? [] : wasGood.slice(0, CAPS.maxConfirms);
    const second = await Promise.all(toConfirm.map((c) => readOnce(c.p.url)));
    const confirmed = [];
    toConfirm.forEach((c, i) => {
      const read = classifyRead(second[i]);
      saved.set(c.p.urlHash, buildRow({ cand: c.p, prev: c.p.prev, read, nowIso }));
      c.read = read; // the second read is the one on record
      if (isBroken(read.cls)) confirmed.push(c);
    });
    const unconfirmed = wasGood.length - toConfirm.length;
    if (confirmed.length > 0) {
      const items = confirmed.map((c) => ({
        lenderId: c.p.lenderIds[0],
        rows: c.p.lenderIds.length,
        cls: c.read.cls,
        status: c.read.status,
        host: c.read.finalHost || c.p.host
      }));
      throw ctx.fail("confirm", breakDetail(items), {
        bankLinks: [...saved.values()],
        confirmed: items,
        unconfirmed
      });
    }
    return { unconfirmed, confirmedReads: toConfirm.length };
  });

  /* ---- verdict: green ---- */
  return ctx.step("verdict", async () => {
    const counts = Object.fromEntries(COUNT_KEYS.map((k) => [k, 0]));
    let debt = 0; // broken but never good: link debt, counted, never red
    for (const c of checked) {
      counts[c.read.cls] += 1;
      if (isBroken(c.read.cls) && !(c.p.prev && c.p.prev.lastGoodAt)) debt += 1;
    }
    const notStarted = plan.picks.length - checked.length;
    const parts = [
      `read ${checked.length} of ${book.total} Apply links`,
      COUNT_KEYS.filter((k) => counts[k] > 0).map((k) => `${k} ${counts[k]}`).join(", ") || "none read",
      firstPass ? "first pass: filled the list, raised nothing" : null,
      debt > 0 ? `${debt} never worked (not an alarm)` : null,
      book.badCount > 0 ? `${book.badCount} stored address${book.badCount === 1 ? "" : "es"} cannot be opened (space or http)` : null,
      confirmInfo.unconfirmed > 0 ? `${confirmInfo.unconfirmed} broken not confirmed yet` : null,
      notStarted > 0 ? `${notStarted} not started (time)` : null
    ].filter(Boolean);
    return ctx.done(parts.join("; "), {
      bankLinks: [...saved.values()],
      counts,
      read: checked.length,
      total: book.total,
      firstPass
    });
  });
}

/* ------------------------------------------------------------------ */
/* Self test: fake book, fake bank answers, no network, no database.      */
/* ------------------------------------------------------------------ */

const pad = (n) => String(n).padStart(64, "0");
const lender = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const hashOf = (n) => pad(n.toString(16));

const BOOK = [
  { n: 1, url: "https://apply.good-bank.example.com/start?code=SECRET-A1" },
  { n: 2, url: "https://www.walled-bank.example.com/card/apply?ecid=SECRET-B2" },
  { n: 3, url: "https://www.new-bank.example.com/apply" },
  { n: 4, url: "https://www.old-link.example.com/gone?id=SECRET-D4" },
  { n: 5, url: "http://www.plain-http.example.com/apply" }
];
const bookRows = () => BOOK.map((b) => ({ url_hash: hashOf(b.n), url: b.url, lender_ids: [lender(b.n)] }));
const goodBefore = (n, over = {}) => ({
  urlHash: hashOf(n), lenderId: lender(n), lastCheckedAt: "2026-10-08T10:00:00.000Z", lastGoodAt: "2026-10-08T10:00:00.000Z",
  lastClass: "OK", lastStatus: 200, lastHost: new URL(BOOK[n - 1].url).hostname, ...over
});
const page = (title) => ({ status: 200, body: `<html><head><title>${title}</title></head><body>Apply</body></html>` });

export const selfTest = {
  // Every address answers as it should: one real page, one bot wall (never red), one new page,
  // one dead link that was never good (link debt, never red), one http address (cannot be opened).
  pass: () => ({
    read: [{ match: /FROM lenders/, rows: bookRows() }],
    state: { bankLinks: [goodBefore(1), goodBefore(2), goodBefore(4, { lastGoodAt: null, lastClass: "BAD_URL" })] },
    http: (method, url) => {
      if (url.includes("good-bank")) return page("Apply for a card");
      if (url.includes("walled-bank")) return { status: 403, body: "<title>Just a moment...</title>" };
      if (url.includes("new-bank")) return page("Start your application");
      if (url.includes("old-link")) return { status: 404, body: "<title>Page Not Found</title>" };
      return new Error("not in the book");
    }
  }),
  // A link that worked yesterday now reads dead twice in the same run: red at "confirm".
  fail: () => ({
    read: [{ match: /FROM lenders/, rows: bookRows() }],
    state: { bankLinks: [goodBefore(1)] },
    http: (method, url) => {
      if (url.includes("good-bank")) return new Error("fetch failed");
      return page("Fine");
    }
  })
};
