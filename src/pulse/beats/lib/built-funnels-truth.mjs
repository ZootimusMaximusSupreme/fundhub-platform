// Built funnels that are live: does every page still answer with its funnel tag? Read only.
//
// ONE JUDGE, TWO CLOCKS (2026-10-20). This check, its SQL and its helpers used to live in
// src/pulse/coverage/gap-built-funnels.mjs. They moved here unchanged so the morning lane (which
// imports them back) and the hourly beat built-funnels run the same SQL and the same verdict. A beat
// may import only from src/pulse/beats/lib, so two small facts are copies, held equal by a drift test
// in beat-built-funnels.test.mjs:
//   tagMeta(tag)   src/marketing/funnel-tracking.mjs (the meta line migration 425 makes every page carry)
//   FUNNEL_ROLES   src/marketing/funnel-paths.mjs (landing, booking, thank_you)
//
//   built-funnels:live-pages-answer   every live built funnel has its three pages on file, each with
//                                     a live address that answers 200 and carries its funnel tag
//
// A funnel the dashboard built (marketing_funnels.kind is set) goes live when the push-live job
// proves its three pages (X4F, 2026-10-06). The push proves them once. This looks again.
//
// `run` is a reader: run((tx) => tx.query(sql, params)). `web(url, init)` answers { status, text() }:
// the morning lane hands in its fetch, the hourly beat a GET through ctx.http. Every read is a SELECT,
// every web call a GET. No ClickFunnels API call: the pages are read the way a buyer reads them.

export const CHECK_IDS = Object.freeze(["built-funnels:live-pages-answer"]);
const ID = CHECK_IDS[0];

/** Copy of FUNNEL_ROLES in src/marketing/funnel-paths.mjs (drift test). */
export const FUNNEL_ROLES = Object.freeze(["landing", "booking", "thank_you"]);

/** Copy of tagMeta in src/marketing/funnel-tracking.mjs (drift test): the exact meta line the database checks for. */
export function tagMeta(tag) {
  return `<meta name="fh-funnel-tag" content="${String(tag)}">`;
}

/** Fewer live built funnels than this and there is nothing to judge. The audit uses the same number. */
export const MIN_LIVE_FUNNELS = 1;

/** One web call may wait this long. Netlify cuts the whole step at 26 seconds. */
export const TIMEOUT_MS = 8000;
/** Whole lane budget for the web reads. A page still waiting then is not read, and the row says so. */
export const DEADLINE_MS = 15000;
/** Pages read in one run. More than this and the rest are named as not read, never passed. */
export const MAX_PAGES = 60;

/** The cache-busting query the push proof uses (clickfunnels-pages.mjs fetchLivePage). */
export const CACHE_BUST_PARAM = "fh_cb";

/** Live built funnels with their pages. One row per page; a funnel with no page row is one row with a null role. */
export const LIVE_SQL = `
  /* gap:built-funnels-live */
  SELECT f.id::text AS funnel_id, f.key, f.tag,
         p.role, p.path AS page_path, p.live_url
    FROM marketing_funnels f
    LEFT JOIN marketing_funnel_pages p
           ON p.funnel_id = f.id AND p.org_id = f.org_id
   WHERE f.kind IS NOT NULL
     AND f.status = 'live'
     AND ($1::uuid IS NULL OR f.org_id = $1::uuid)
   ORDER BY f.key, p.position
`;

/** Every funnel row the read can see. Zero here means the read is blind, not that none is live. */
export const SEEN_SQL = `
  /* gap:built-funnels-seen */
  SELECT count(*)::int AS n
    FROM marketing_funnels
   WHERE ($1::uuid IS NULL OR org_id = $1::uuid)
`;

export const FIX =
  "Open the page the detail names. Read the ClickFunnels funnel made for it by API (its name carries the " +
  "funnel tag): the funnel's domain must be apply.fundhub.ai and its three steps must be landing, booking, " +
  "thank-you. An agent fixes it by API; Chris never logs in. The pulse only reports. Do not auto-fix.";

export function row(status, detail, suggestedFix = null) {
  return { id: ID, status, detail, suggestedFix };
}

/** "Nothing to judge today": status na plus the code the audit re-checks. */
export function naRow(orgId) {
  const args = { check: ID, what: "live built funnels", count: 0, min: MIN_LIVE_FUNNELS };
  if (orgId) args.orgId = String(orgId);
  return {
    id: ID,
    status: "na",
    detail: "No funnel built in the dashboard is live yet, so there is no live page to judge. Judged the day one goes live.",
    suggestedFix: null,
    na: { code: "low-traffic", args }
  };
}

export function clip(err, n = 160) {
  return String((err && err.message) || err).replace(/\s+/g, " ").trim().slice(0, n);
}

export async function rowsOf(run, sql, params) {
  const out = await run((tx) => tx.query(sql, params));
  return (out && Array.isArray(out.rows) && out.rows) || [];
}

export function distinctFunnels(rows) {
  return new Set(rows.map((r) => String(r.funnel_id)));
}

/** The address with a cache-busting query on it. Null when it is not an https address. */
export function bustedUrl(liveUrl, now) {
  let u;
  try {
    u = new URL(String(liveUrl));
  } catch {
    return null;
  }
  if (u.protocol !== "https:") return null;
  u.searchParams.set(CACHE_BUST_PARAM, String(now.getTime()));
  return u.toString();
}

/** One page, one GET. Never throws. Answers { ok, why }. */
export async function readPage(web, page, now) {
  const url = bustedUrl(page.live_url, now);
  if (!url) return { ok: false, why: `${page.live_url} is not an https address` };
  const init = {
    method: "GET",
    redirect: "follow",
    headers: { accept: "text/html", "cache-control": "no-cache", pragma: "no-cache" }
  };
  if (typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function") {
    init.signal = AbortSignal.timeout(TIMEOUT_MS);
  }
  let res;
  let text = "";
  try {
    res = await web(url, init);
    text = typeof res.text === "function" ? String((await res.text()) || "") : "";
  } catch (err) {
    return { ok: false, why: `${page.live_url} could not be reached (${clip(err, 80)})` };
  }
  const status = Number(res && res.status);
  if (status !== 200) return { ok: false, why: `${page.live_url} answered ${Number.isFinite(status) ? status : "no status"}` };
  if (!text.includes(tagMeta(page.tag))) {
    return { ok: false, why: `${page.live_url} answered 200 but does not carry the funnel tag ${page.tag}` };
  }
  return { ok: true, why: "" };
}

/** What is wrong with the rows themselves, before any page is read. */
export function problemsOnFile(funnelRows) {
  const byFunnel = new Map();
  for (const r of funnelRows) {
    const id = String(r.funnel_id);
    if (!byFunnel.has(id)) byFunnel.set(id, { key: r.key, tag: r.tag, pages: [] });
    if (r.role) byFunnel.get(id).pages.push(r);
  }
  const problems = [];
  const toRead = [];
  for (const f of byFunnel.values()) {
    const have = new Set(f.pages.map((p) => p.role));
    const missing = FUNNEL_ROLES.filter((role) => !have.has(role));
    if (missing.length) {
      problems.push(`${f.key} is live but has no ${missing.join(" or ")} page on file`);
    }
    for (const p of f.pages) {
      if (!p.live_url) {
        problems.push(`${f.key} ${p.role} page (${p.page_path}) has no live address`);
      } else {
        toRead.push({ key: f.key, tag: f.tag, role: p.role, live_url: p.live_url });
      }
    }
  }
  return { problems, toRead, funnels: byFunnel.size };
}

function plural(n, one, many) {
  return n === 1 ? one : many;
}

function listProblems(items, max = 4) {
  const shown = items.slice(0, max).join("; ");
  return items.length > max ? `${shown}; and ${items.length - max} more` : shown;
}

/**
 * The verdict, once there is a reader. `web` may be null (no web client in this run).
 * @param {{ run: Function, web: Function|null, orgId?: string|null, now?: Date, deadlineMs?: number }} io
 * @returns {Promise<Array<object>>} one row: PASS, FAIL, skip, or na (with na: { code, args })
 */
export async function checkLiveFunnels({ run, web, orgId = null, now, deadlineMs } = {}) {
  const at = now instanceof Date ? now : new Date();
  let live;
  try {
    live = await rowsOf(run, LIVE_SQL, [orgId]);
  } catch (err) {
    return [row("skip", `could not read the live built funnels: ${clip(err)}`)];
  }

  if (live.length === 0) {
    let seen;
    try {
      seen = await rowsOf(run, SEEN_SQL, [orgId]);
    } catch (err) {
      return [row("skip", `could not read the funnel table to see if any built funnel is live: ${clip(err)}`)];
    }
    const n = Number(seen[0] && seen[0].n);
    if (!Number.isFinite(n)) return [row("skip", "the funnel count was not a number, so no live built funnel could be ruled out")];
    // A table that reads as empty is a blind read (no rows visible to this role), not "none live".
    if (n <= 0) {
      return [row("skip", "no funnel row was visible at all, so this read cannot say that none is live")];
    }
    return [naRow(orgId)];
  }

  const { problems, toRead, funnels } = problemsOnFile(live);
  const wanted = toRead.slice(0, MAX_PAGES);
  const notRead = toRead.length - wanted.length;
  const results = new Array(wanted.length).fill(null);
  let late = 0;

  if (wanted.length && typeof web === "function") {
    const deadline = Number.isFinite(deadlineMs) ? deadlineMs : DEADLINE_MS;
    let timer;
    const timedOut = new Promise((resolve) => {
      timer = setTimeout(resolve, deadline);
    });
    try {
      await Promise.race([
        Promise.all(wanted.map((page, i) =>
          readPage(web, page, at).then((r) => { results[i] = r; })
        )),
        timedOut
      ]);
    } finally {
      clearTimeout(timer);
    }
    late = results.filter((r) => r === null).length;
  } else if (wanted.length) {
    late = wanted.length;
  }

  const wrong = results.filter((r) => r && !r.ok).map((r) => r.why);
  const all = [...problems, ...wrong];
  const total = toRead.length;
  const noun = plural(funnels, "live built funnel", "live built funnels");

  if (all.length) {
    return [
      row(
        "FAIL",
        `${all.length} ${plural(all.length, "problem", "problems")} on ${funnels} ${noun}: ${listProblems(all)}`,
        FIX
      )
    ];
  }
  const unread = late + notRead;
  if (unread > 0) {
    const why = typeof web === "function"
      ? `${late} ${plural(late, "page", "pages")} did not answer in time${notRead ? ` and ${notRead} were over the ${MAX_PAGES} page limit` : ""}`
      : "no fetch in this run";
    return [row("skip", `${funnels} ${noun}, ${total} pages: ${why}, so they were not all read`)];
  }
  return [
    row(
      "PASS",
      `${funnels} ${noun}, ${total} ${plural(total, "page", "pages")}: each answered 200 and carries its funnel tag`
    )
  ];
}
