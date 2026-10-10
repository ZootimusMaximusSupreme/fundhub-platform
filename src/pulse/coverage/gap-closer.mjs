// Closer desk, Present, and closer context. Read only.
// One tripwire. Do not add another watcher. Do not start a call.
//
// slice-27-closer.mjs already names the registry doors (closer dashboard,
// Present, closer-deck, call-outcomes). The registry GET rows reg:closer-dashboard
// and reg:present already go red when a page does not answer 2xx. slice-20-sales.mjs
// already names s-offer-bucket. This file does not repeat those. It does not watch
// bookings or recordings.
//
// The page row reads the pages over HTTP, the way a closer opens them. It does not
// read repo files: the shipped function holds no public/ folder and no site config file,
// so a file read there fails every morning whether or not the page is fine.
// present.js has no registry row. If it is down, nothing else says so, so that is a FAIL
// here. The two html pages have registry rows, so a down page is a skip that names the row.

export const CHECK_IDS = Object.freeze(["closer:desk-pages", "closer:held-disposition"]);

const TRIP =
  "Present log_disposition is the one tripwire. It writes the call_outcomes row. " +
  "fetchContext reads that row. Do not start a call. Do not auto-fix.";

const DEFAULT_BASE = "https://fundhub.ai";
const LOOKBACK_MS = 14 * 24 * 60 * 60 * 1000;
const LOG_GRACE_MS = 2 * 60 * 60 * 1000;
const PAGE_TIMEOUT_MS = 8000;

/**
 * What each page must say for the closer desk to work.
 * reg is the registry row that already goes red when the page is down. null means
 * no row watches it, so this check must.
 */
export const PAGES = Object.freeze([
  {
    path: "/app/closer-dashboard.html",
    name: "Closer Dashboard",
    reg: "reg:closer-dashboard",
    must: [
      [/<title>[^<]*Closer Dashboard/i, "is not the Closer Dashboard page"],
      [/src=["']shell\.js["']/, "does not load shell.js"]
    ],
    mustNot: []
  },
  {
    path: "/app/present.html",
    name: "Present",
    reg: "reg:present",
    must: [
      [/<title>[^<]*Present/i, "is not the Present page"],
      [/src=["']present\.js["']/, "does not load present.js"]
    ],
    mustNot: [[/src=["']shell\.js["']/, "loads shell.js, so the deck bounces"]]
  },
  {
    path: "/app/present.js",
    name: "Present script",
    reg: null,
    must: [
      [/log_disposition/, "does not post log_disposition"],
      [/\/api\/closer-deck/, "does not call /api/closer-deck"]
    ],
    mustNot: []
  }
]);

/**
 * Two counts in one read.
 * n_saved: a closer disposition is on the client (or a closer call.completed
 *   event exists) and call_outcomes holds no row for that client at all. Present
 *   writes the call_outcomes row first and the client field second, so this only
 *   shows when the row was lost afterward.
 * n_deck: the closer deck was used on the client (soft pull, ebook, or letters
 *   sent), the two hour wait to log the call is over, and no call_outcomes row
 *   was logged from 12 hours before that send. This is the live shape of a
 *   disposition that never landed.
 * Demo clients are left out.
 */
export const DISPOSITION_SQL = `
  /* gap:closer-held-disposition */
  SELECT count(*) FILTER (WHERE x.saved_no_row)::int AS n_saved,
         count(*) FILTER (WHERE x.deck_no_outcome)::int AS n_deck
    FROM (
      SELECT (
               (
                 (
                   jsonb_typeof(c.custom_fields->'closer_deck_disposition') = 'object'
                   AND (
                     COALESCE(c.custom_fields->'closer_deck_disposition'->>'offer_key', '') <> ''
                     OR COALESCE(c.custom_fields->'closer_deck_disposition'->>'route', '') <> ''
                     OR COALESCE(c.custom_fields->'closer_deck_disposition'->>'at', '') <> ''
                   )
                 )
                 OR EXISTS (
                   SELECT 1
                     FROM events e
                    WHERE e.org_id = c.org_id
                      AND e.client_id = c.id
                      AND e.name = 'call.completed'
                      AND e.payload->>'disposition' = 'closer'
                 )
               )
               AND NOT EXISTS (
                 SELECT 1 FROM call_outcomes o
                  WHERE o.org_id = c.org_id AND o.client_id = c.id
               )
             ) AS saved_no_row,
             (
               d.deck_at IS NOT NULL
               AND d.deck_at >= $2::timestamptz
               AND d.deck_at <= $3::timestamptz
               AND NOT EXISTS (
                 SELECT 1 FROM call_outcomes o
                  WHERE o.org_id = c.org_id
                    AND o.client_id = c.id
                    AND o.logged_at >= d.deck_at - interval '12 hours'
               )
             ) AS deck_no_outcome
        FROM clients c
        CROSS JOIN LATERAL (
          SELECT GREATEST(
            CASE WHEN c.custom_fields->>'closer_deck_soft_pull_sent_at' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T'
                 THEN (c.custom_fields->>'closer_deck_soft_pull_sent_at')::timestamptz END,
            CASE WHEN c.custom_fields->>'closer_deck_ebook_sent_at' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T'
                 THEN (c.custom_fields->>'closer_deck_ebook_sent_at')::timestamptz END,
            CASE WHEN c.custom_fields->>'closer_deck_letters_at' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T'
                 THEN (c.custom_fields->>'closer_deck_letters_at')::timestamptz END
          ) AS deck_at
        ) d
       WHERE c.org_id = $1::uuid
         AND COALESCE(c.is_demo, false) = false
         AND COALESCE(c.custom_fields->>'synthetic', '') <> 'true'
    ) x
`;

function row(id, status, detail, suggestedFix = null) {
  return { id, status, detail, suggestedFix };
}

function clip(err) {
  return String(err?.message || err).replace(/\s+/g, " ").slice(0, 180);
}

function numOf(v) {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function plural(n, word) {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

async function openPage(fetchImpl, origin, page) {
  try {
    const opts = { method: "GET", headers: { accept: "text/html" } };
    // A hung page must not hold the whole lane until the step is cut.
    if (typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function") {
      opts.signal = AbortSignal.timeout(PAGE_TIMEOUT_MS);
    }
    const res = await fetchImpl(`${origin}${page.path}`, opts);
    const status = Number(res?.status);
    const text = typeof res?.text === "function" ? String(await res.text()) : "";
    return { page, status, text, error: null };
  } catch (err) {
    return { page, status: NaN, text: "", error: clip(err) };
  }
}

/**
 * The closer pages over HTTP. FAIL when a page answers 2xx and is the wrong page
 * (a redirect took the address, the script tag is gone, Present no longer posts
 * log_disposition), or when the Present script is down (no registry row watches it).
 * A html page that does not answer 2xx is the registry's red; this row says so and
 * skips unless another page is wrong.
 * @returns {{ wrong: string[], down: string[], read: number }}
 */
export async function closerDeskPageReport({ fetchImpl, baseUrl } = {}) {
  const origin = String(baseUrl || DEFAULT_BASE).replace(/\/+$/, "");
  const wrong = [];
  const down = [];
  let read = 0;
  const got = await Promise.all(PAGES.map((page) => openPage(fetchImpl, origin, page)));
  for (const one of got) {
    const { page } = one;
    if (!(one.status >= 200 && one.status < 300)) {
      const why = one.error ? `not opened (${one.error})` : `answered ${Number.isFinite(one.status) ? one.status : "no status"}`;
      if (page.reg) down.push(`${page.name} ${why}; ${page.reg} reports a page that is down`);
      else wrong.push(`${page.name} ${why}, so no disposition can be saved`);
      continue;
    }
    read += 1;
    for (const [re, why] of page.must) {
      if (!re.test(one.text)) wrong.push(`${page.name} ${why}`);
    }
    for (const [re, why] of page.mustNot) {
      if (re.test(one.text)) wrong.push(`${page.name} ${why}`);
    }
  }
  return { wrong, down, read };
}

async function checkPages({ fetchImpl, baseUrl }) {
  const id = CHECK_IDS[0];
  if (typeof fetchImpl !== "function") {
    return row(id, "skip", "no fetch in this run — Closer Dashboard and Present not opened");
  }
  const report = await closerDeskPageReport({ fetchImpl, baseUrl });
  if (report.wrong.length) {
    const also = report.down.length ? ` Also: ${report.down.join("; ")}.` : "";
    return row(id, "FAIL", `Closer Dashboard or Present is not wired: ${report.wrong.join("; ")}.${also}`, TRIP);
  }
  if (report.down.length) {
    return row(id, "skip", `${report.down.join("; ")}.`);
  }
  return row(id, "PASS", "Closer Dashboard, Present, and the Present script answer and are the right pages");
}

async function checkDispositions({ db, orgId, now }) {
  const id = CHECK_IDS[1];
  if (!db || !orgId) return row(id, "skip", "no database in this run — dispositions not read");
  try {
    const result = await db.query(DISPOSITION_SQL, [
      orgId,
      new Date(now.getTime() - LOOKBACK_MS).toISOString(),
      new Date(now.getTime() - LOG_GRACE_MS).toISOString()
    ]);
    const first = result?.rows?.[0] || {};
    const saved = numOf(first.n_saved);
    const deck = numOf(first.n_deck);
    if (saved === 0 && deck === 0) {
      return row(id, "PASS", "no closer disposition is missing its call_outcomes row, and no closer deck use is missing a logged call");
    }
    const parts = [];
    if (saved) {
      parts.push(`${plural(saved, "client")} saved a closer disposition and call_outcomes has no row, so fetchContext has no recent call`);
    }
    if (deck) {
      parts.push(`${plural(deck, "client")} had the closer deck used more than 2 hours ago and no call outcome was logged, so the disposition never landed`);
    }
    return row(id, "FAIL", `${parts.join("; ")}.`, TRIP);
  } catch (err) {
    return row(id, "FAIL", `could not read dispositions: ${clip(err)}`, TRIP);
  }
}

/**
 * Two read-only checks. ctx: { db, orgId, now, fetchImpl, baseUrl }.
 * The row is { id, status, detail, suggestedFix } with status PASS, FAIL, or skip.
 */
export async function gapChecks(ctx = {}) {
  const c = ctx || {};
  const db = c.db && typeof c.db.query === "function" ? c.db : null;
  const orgId = c.orgId || null;
  const now = c.now instanceof Date ? c.now : new Date();
  const fetchImpl = typeof c.fetchImpl === "function" ? c.fetchImpl : (typeof c.fetch === "function" ? c.fetch : null);
  return [
    await checkPages({ fetchImpl, baseUrl: c.baseUrl }),
    await checkDispositions({ db, orgId, now })
  ];
}
