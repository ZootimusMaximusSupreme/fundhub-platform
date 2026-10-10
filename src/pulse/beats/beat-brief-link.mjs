// Beat: brief-link. Does the "Full report" link in the newest morning or evening text really open?
//
// WHY IT EXISTS. For days the text ended with a link to a page that was never built. It answered
// 404 and nothing noticed. This beat takes the link the newest text carried and follows it, the
// way Chris's thumb does, every hour.
//
// READ ONLY. One read of morning_briefs (the newest row) and two GETs to our own site. It sends
// nothing, saves nothing and calls no model.
//
//   link-saved     the newest SENT morning_briefs row (dry runs and failed sends do not count, default
//                  org only) is under 36 hours old, and its report_url has the
//                  tokened form: https, our own host, path /app/morning-brief.html, the same date
//                  as the row, the same kind as the row, and a k code of 32 letters, digits, - or _.
//                  A row older than 36 hours means the text did not go. (Texts go twice a day.)
//                  ONE EXCEPTION, the old link: a text sent before report links carried a code has the
//                  right host, path, date and kind but no k at all. Chris cannot fix that, and it clears
//                  by itself with the next text. So it is not red: link-saved passes, page-opens still
//                  checks the page is deployed, and report-loads is skipped with a plain reason.
//                  A link with NO address (secret missing) or a bad k is still red.
//   page-opens     GET of that exact saved link answers 200 and the body holds data-brief-page.
//   report-loads   GET /api/public/morning-brief with the same date, kind and k answers 200 JSON
//                  with ok:true and a brief for that date. The pulse probe keeps only the first 64 KB of
//                  a body and sets truncated:true. A real brief can be bigger (one was 200 KB), so a cut
//                  body is judged by its start (ok, date, kind, brief.date) and never JSON-parsed.
//
// THE CODE IS NEVER WRITTEN DOWN. The k code and the full link live in local variables only. Every
// word this beat writes (detail, evidence, step names) is built from fixed text, the fixed paths,
// the site's own host, and values this file checked against a strict shape first (a date, a kind,
// a status number, an age in hours). Nothing from the saved link, a page body or an answer is copied
// into a word. A thrown error from the URL parser is caught and never re-thrown, because its text can
// hold the address it choked on. beat-brief-link.test.mjs puts a code in every field and proves it.
//
// WHAT TODAY'S RED MEANS. If the deployed site does not have the new page or route yet, the first
// text with a code has not gone out either, so this beat is red at link-saved or page-opens. That
// is the beat doing its job, not a false alarm.
//
// Sources (read, not invented):
//   link form and code shape   src/ops/brief-link.mjs (briefUrl, BRIEF_PAGE_PATH, TOKEN)
//   the route's answers        api/public/morning-brief.mjs (200 { ok, date, kind, brief }, else 404)
//   the page marker            public/app/morning-brief.html (data-brief-page="1" on the root element)

import { BeatFail } from "./contract.mjs";

export const id = "brief-link";
export const title = "Report link in the morning text opens";
export const kind = "probe";
// Verified against surfaces() in src/pulse/tripwires.test.mjs: route:<ROUTES key> and desk:<file in public/app>.
export const covers = ["route:public/morning-brief", "desk:morning-brief.html"];
export const box = false;
export const reads = [{ host: "SITE", methods: ["GET"] }];
export const steps = ["link-saved", "page-opens", "report-loads"];
export const damp = 1;
export const deadlineMs = 9000;

export const PAGE_PATH = "/app/morning-brief.html";
export const DATA_PATH = "/api/public/morning-brief";
/** The newest text may be this old. Two texts a day, so a day and a half is a missed text. */
export const MAX_AGE_HOURS = 36;
export const MAX_AGE_MS = MAX_AGE_HOURS * 60 * 60 * 1000;

const CODE = /^[A-Za-z0-9_-]{32}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const KINDS = ["morning", "evening"];

/* The newest text that really went out (sent, not a dry run, default org: the same org the route
   reads). report_url holds the link with its code: it is read into a variable and
   never printed. */
export const NEWEST_SQL = `
  SELECT brief_date::text AS brief_date, kind, report_url, created_at
    FROM morning_briefs
   WHERE delivery_status = 'sent'
     AND dry_run = false
     AND org_id = (SELECT id FROM orgs WHERE is_default LIMIT 1)
   ORDER BY created_at DESC
   LIMIT 1
`;

/** Letters, digits and . _ - only, cut short. Used on values already checked, as a second belt. */
const plain = (v) => String(v ?? "").replace(/[^a-z0-9._-]/gi, "").slice(0, 16) || "none";

/**
 * Judge one saved link. Pure. Returns { ok:true, url, date, kind, k } or { ok:false, why }.
 * `why` is fixed text only: nothing from the link is copied into it.
 */
export function parseSavedLink(saved, { siteHost, briefDate, briefKind } = {}) {
  const raw = typeof saved === "string" ? saved.trim() : "";
  if (!raw) return { ok: false, why: "is empty (no code could be made when the text was built)" };
  let u;
  try {
    u = new URL(raw);
  } catch {
    // The error text can hold the address it choked on, so it is dropped here.
    return { ok: false, why: "is not a web address" };
  }
  if (u.protocol !== "https:") return { ok: false, why: "is not an https address" };
  if (u.username || u.password) return { ok: false, why: "carries a user name or password" };
  if (!siteHost || u.host !== siteHost) return { ok: false, why: "points at a different site than this one" };
  if (u.pathname !== PAGE_PATH) return { ok: false, why: `does not point at ${PAGE_PATH}` };

  const codes = u.searchParams.getAll("k");
  const noCode = !u.searchParams.has("k");
  if (!noCode && (codes.length !== 1 || !CODE.test(codes[0]))) return { ok: false, why: "has no valid k code (it was saved without its secret code)" };

  const dates = u.searchParams.getAll("date");
  if (dates.length !== 1 || !DAY.test(dates[0]) || dates[0] !== briefDate) return { ok: false, why: "has a date that is not the day of the text" };

  const kinds = u.searchParams.getAll("kind");
  const wantKind = briefKind === "evening" ? "evening" : "morning";
  const gotKind = kinds.length === 0 ? "morning" : kinds.length === 1 ? kinds[0] : null;
  if (gotKind !== wantKind) return { ok: false, why: "has a kind that is not the kind of the text" };

  // The old link: right in every way except it has no k at all. See the header.
  if (noCode) return { ok: true, legacy: true, date: dates[0], kind: wantKind };
  return { ok: true, url: raw, date: dates[0], kind: wantKind, k: codes[0] };
}

/** A body cut at the probe's cap cannot be parsed. Judge its start: ok, date, kind, brief.date in the order the route writes them. */
export function cutBodyIsReport(body, { date, kind }) {
  if (!DAY.test(String(date)) || !KINDS.includes(kind)) return false;
  const start = new RegExp(`^\\s*\\{\\s*"ok"\\s*:\\s*true\\s*,\\s*"date"\\s*:\\s*"${date}"\\s*,\\s*"kind"\\s*:\\s*"${kind}"\\s*,\\s*"brief"\\s*:\\s*\\{\\s*"date"\\s*:\\s*"${date}"`);
  return start.test(String(body ?? "").slice(0, 400));
}

const bodyOf = (res) => String(res?.body ?? res?.bodySnippet ?? "");
const jsonOf = (res) => {
  try {
    const v = JSON.parse(bodyOf(res));
    return v && typeof v === "object" && !Array.isArray(v) ? v : null;
  } catch {
    return null;
  }
};

const NO_ANSWER = Object.freeze({ ok: false, status: 0, class: "none", body: "" });
const settle = (promise) => Promise.resolve(promise).then((r) => r || NO_ANSWER, () => ({ ...NO_ANSWER, class: "refused" }));

/** Words for an answer that is not the one wanted. Status number and class only. */
function wrongAnswer(label, res) {
  if (res.class === "blocked") return `${label} was not asked: the pulse's own web fence is holding its calls (ADAPTERS_DRY_RUN).`;
  if (!Number.isInteger(res.status) || res.status === 0) return `${label} got no answer (${plain(res.class)}).`;
  return null;
}

/* A read that fails. A database-down answer ("db: ...") passes through word for word so the
   runner folds it into its one database-down text. Any other failure names the table. */
const readFailed = (ctx, err) => {
  const msg = String((err && err.message) || err).slice(0, 120);
  return ctx.fail("link-saved", /^db:/i.test(msg.trim()) ? msg : `Could not read morning_briefs: ${msg}`);
};

export async function run(ctx) {
  if (!/^https:\/\/[^/]+$/.test(String(ctx.siteUrl || ""))) {
    throw ctx.fail("link-saved", "the site address (URL) is not set for this run, so the link cannot be followed");
  }
  const siteHost = new URL(ctx.siteUrl).host;
  let link = null;
  let evidence = null;

  await ctx.step("link-saved", async () => {
    let row;
    try {
      row = (await ctx.read(NEWEST_SQL)).rows[0];
    } catch (err) {
      if (err instanceof BeatFail) throw err;
      throw readFailed(ctx, err);
    }
    if (!row) throw ctx.fail("link-saved", "morning_briefs has no rows for a text that was sent. No morning or evening text has gone out, so there is no link to follow.");

    const briefDate = DAY.test(String(row.brief_date ?? "")) ? String(row.brief_date) : null;
    const briefKind = KINDS.includes(row.kind) ? row.kind : null;
    const made = new Date(row.created_at).getTime();
    if (!Number.isFinite(made)) throw ctx.fail("link-saved", "The newest sent text has a time that cannot be read.");
    const ageMs = ctx.now.getTime() - made;
    const ageHours = Math.max(0, Math.floor(ageMs / 3600000));
    if (ageMs > MAX_AGE_MS) {
      throw ctx.fail("link-saved", `The newest sent text is ${ageHours} hours old (limit ${MAX_AGE_HOURS}). The morning or evening text did not go out.`, { ageHours });
    }
    if (!briefDate || !briefKind) {
      throw ctx.fail("link-saved", "The newest sent text has a date or kind that cannot be read.", { ageHours });
    }

    const parsed = parseSavedLink(row.report_url, { siteHost, briefDate, briefKind });
    if (!parsed.ok) {
      throw ctx.fail("link-saved", `The report link saved with the ${briefKind} text of ${briefDate} ${parsed.why}. Chris would tap a dead link.`, { briefDate, kind: briefKind, ageHours });
    }
    link = parsed;
    evidence = { briefDate, kind: briefKind, ageHours, host: siteHost, pagePath: PAGE_PATH, dataPath: DATA_PATH };
    if (parsed.legacy) evidence.legacyLink = true;
  });

  // Both GETs start together. Neither wait is on the other. An old link (no code) has nothing to
  // send to the route, so only the bare page is checked.
  const dataUrl = link.legacy ? null : `${ctx.siteUrl}${DATA_PATH}?date=${link.date}&kind=${link.kind}&k=${link.k}`;
  const pageCall = settle(ctx.http.get(link.legacy ? `${ctx.siteUrl}${PAGE_PATH}` : link.url));
  const dataCall = dataUrl ? settle(ctx.http.get(dataUrl)) : null;

  await ctx.step("page-opens", async () => {
    const res = await pageCall;
    const label = `GET ${PAGE_PATH}`;
    const bad = wrongAnswer(label, res);
    if (bad) throw ctx.fail("page-opens", bad, evidence);
    if (res.status === 404) throw ctx.fail("page-opens", `${label} answered 404. The report page is not in the deployed site, so the text link is dead.`, evidence);
    if (res.status !== 200) throw ctx.fail("page-opens", `${label} answered ${res.status}, wanted 200.`, evidence);
    if (!/data-brief-page/.test(bodyOf(res))) {
      throw ctx.fail("page-opens", `${label} answered 200 but it is not the report page (its data-brief-page marker is missing).`, evidence);
    }
    evidence = { ...evidence, pageStatus: res.status };
  });

  if (link.legacy) {
    ctx.skipStep("report-loads", "the newest text was sent before links carried a code, so there is nothing to send to the route; the next text brings one");
    return ctx.done(
      `The newest ${link.kind} text (${link.date}, ${evidence.ageHours} h old) was sent before report links carried a code. ${PAGE_PATH} shows the page. The code check starts with the next text.`,
      evidence
    );
  }

  await ctx.step("report-loads", async () => {
    const res = await dataCall;
    const label = `GET ${DATA_PATH}`;
    const bad = wrongAnswer(label, res);
    if (bad) throw ctx.fail("report-loads", bad, evidence);
    if (res.status === 404) {
      throw ctx.fail("report-loads", `${label} answered 404 for the saved link. The route is not deployed, the code no longer matches BRIEF_LINK_SECRET, or the brief row is gone.`, evidence);
    }
    if (res.status !== 200) throw ctx.fail("report-loads", `${label} answered ${res.status}, wanted 200.`, evidence);
    if (res.truncated === true) {
      // The probe cut the body at 64 KB. A real brief can be bigger, so judge the start only.
      if (!cutBodyIsReport(bodyOf(res), link)) {
        throw ctx.fail("report-loads", `${label} answered 200 but the start of the body is not the report answer.`, evidence);
      }
      evidence = { ...evidence, dataStatus: res.status, dataCut: true };
      return;
    }
    const j = jsonOf(res);
    if (!j) throw ctx.fail("report-loads", `${label} answered 200 but the body is not the report answer.`, evidence);
    if (j.ok !== true) throw ctx.fail("report-loads", `${label} answered 200 but did not say ok.`, evidence);
    if (!j.brief || typeof j.brief !== "object" || Array.isArray(j.brief)) {
      throw ctx.fail("report-loads", `${label} answered ok but sent no brief.`, evidence);
    }
    if (j.brief.date !== link.date) {
      throw ctx.fail("report-loads", `${label} answered ok but the brief is for a different day than the link.`, evidence);
    }
    evidence = { ...evidence, dataStatus: res.status };
  });

  return ctx.done(
    `The report link in the newest ${link.kind} text (${link.date}, ${evidence.ageHours} h old) opens: ${PAGE_PATH} shows the page and ${DATA_PATH} returns the report.`,
    evidence
  );
}

export const fixGuide = [
  "Open the newest morning text link by hand; if it fails ship main again.",
  "",
  "Likely causes:",
  "- page-opens 404: public/app/morning-brief.html is not in the deployed site. The deploy is older than the page, or the file was removed.",
  "- report-loads 404: the morning-brief public route is missing from netlify/functions/api.mjs, or the deploy is older than the route. A code that no longer matches also answers 404, on purpose.",
  "- link-saved with a link that has no code: BRIEF_LINK_SECRET is missing, shorter than 32 characters or masked on Netlify, so the text went out saying the report is not available.",
  "- BRIEF_LINK_SECRET was changed after the text went out: the old link is dead by design and the next text carries a good one.",
  "- link-saved older than 36 hours: no sent morning or evening text in 36 hours. That is the daily-pulse job, not this link.",
  "Steps:",
  "- Open the newest Full report link on a phone. Read what it says, then run node scripts/pulse/run-beat.mjs brief-link. It prints the step that stopped and the status, never the code.",
  "- If the page or the route is missing, ship main with npm run ship, then run the beat again.",
  "- If the secret is the cause, set BRIEF_LINK_SECRET on Netlify production, 32 characters or more, WITHOUT --secret. Never delete or overwrite an old value. Then ship once. The next text carries a working link.",
  "- If the text itself did not go, read the daily-pulse job heartbeat first.",
  "Files: src/ops/brief-link.mjs, src/ops/morning-brief.mjs, api/public/morning-brief.mjs, public/app/morning-brief.html, netlify/functions/api.mjs"
].join("\n");

/* ---------------- self test: no network, no database ---------------- */

const SITE = "https://fundhub.ai";
/** A made-up code for the self test only. It is not a real code for any link. */
const SELFTEST_CODE = "AbCdEfGhIjKlMnOpQrStUvWxYz012345";
const SELFTEST_DATE = "2026-10-09";
const SELFTEST_PAGE = `${SITE}${PAGE_PATH}?date=${SELFTEST_DATE}&k=${SELFTEST_CODE}`;
const SELFTEST_DATA = `${SITE}${DATA_PATH}?date=${SELFTEST_DATE}&kind=morning&k=${SELFTEST_CODE}`;

const newestRow = (over = {}) => ({
  match: /FROM morning_briefs/,
  rows: [{ brief_date: SELFTEST_DATE, kind: "morning", report_url: SELFTEST_PAGE, created_at: new Date("2026-10-09T13:00:30.000Z"), ...over }]
});
const PAGE_OK = { status: 200, body: '<!DOCTYPE html><html lang="en" data-brief-page="1"><head></head><body></body></html>' };
const DATA_OK = { status: 200, body: JSON.stringify({ ok: true, date: SELFTEST_DATE, kind: "morning", brief: { date: SELFTEST_DATE, kind: "morning" } }) };

export const selfTest = {
  pass: () => ({
    read: [newestRow()],
    http: { [`GET ${SELFTEST_PAGE}`]: PAGE_OK, [`GET ${SELFTEST_DATA}`]: DATA_OK }
  }),
  // The page is not on the deployed site (the real state before the first ship): red at page-opens.
  fail: () => ({
    read: [newestRow()],
    http: {
      [`GET ${SELFTEST_PAGE}`]: { status: 404, body: "<html>Not found</html>" },
      [`GET ${SELFTEST_DATA}`]: DATA_OK
    }
  })
};
