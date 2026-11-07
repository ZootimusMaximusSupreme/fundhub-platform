// The monthly report — one PDF a client downloads from FinanceOS: a designed
// cover, what changed this month, and what is next.
//
// Finance OS premium pass (unit PREM, 2026-11-07). Board:
// ops/workflows/finance-os-cfo-build-2026-11-06.txt. Served as a query on an
// existing read — GET /api/money/overview?report=monthly[&month=YYYY-MM] — so
// it has the overview's gate line for line and no new route.
//
// ONE SOURCE PER NUMBER. This file adds no money rule and no credit rule. It
// READS four reads FinanceOS already serves and only picks the first and last
// day of the month out of them:
//   * cash, debt and cards used by day, money in and out by month
//       → moneyTrends (src/finance/money-trends.mjs), the Trends chart's read
//   * each bureau's score at each saved pull
//       → creditOverview().credit_history (src/finance/credit-history.mjs)
//   * fundability (N of 6) and "Funding you qualify for"
//       → fundability() (src/finance/fundability.mjs); the dollars are its
//         `opportunity.personal`, the same UnderwriteIQ figure the Blueprint
//         path shows (src/waypoints/blueprint-path.mjs pathFunding)
//   * what is next → moneyTasks (src/finance/money-tasks.mjs), the Next steps tab
// UnderwriteIQ (src/underwrite/**, fundability.mjs) is only CALLED here.
//
// HARD RULES (CLAUDE.md §12, spec 4b): money is integer cents; unknown is null
// and prints "—", never $0; personal and business cash are their own rows and
// are never added; a month with no pull says so instead of a made-up score.
// READ ONLY. Every read carries org_id AND client_id.

import { PDFDocument, StandardFonts, rgb, LineCapStyle,
  pushGraphicsState, popGraphicsState, concatTransformationMatrix } from "pdf-lib";
import { WORDMARK } from "./fundhub-wordmark.mjs";

/** How far back a client may ask for a report: the Trends read's own cap. */
export const REPORT_MAX_MONTHS = 24;
/** How many next steps the report lists. */
export const NEXT_STEPS_MAX = 5;

const MONTHS = ["January", "February", "March", "April", "May", "June", "July",
  "August", "September", "October", "November", "December"];
const BUREAUS = [["experian", "Experian"], ["equifax", "Equifax"], ["transunion", "TransUnion"]];

const list = (v) => (Array.isArray(v) ? v : []);
const isNum = (v) => typeof v === "number" && Number.isFinite(v);
const text = (v) => (typeof v === "string" && v.trim() ? v.trim() : null);

/** "2026-11-07T…" or a Date → "2026-11-07" (UTC, the Trends read's day). */
export function isoDay(v) {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

/** "2026-03" minus n months → "2025-12". */
export function monthMinus(ym, n) {
  const y = Number(ym.slice(0, 4));
  const m = Number(ym.slice(5, 7)) - 1 - n;
  const yy = y + Math.floor(m / 12);
  const mm = ((m % 12) + 12) % 12;
  return `${yy}-${String(mm + 1).padStart(2, "0")}`;
}

/** Last calendar day of "2026-02" → "2026-02-28". */
export function lastDayOfMonth(ym) {
  const d = new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)), 0));
  return d.toISOString().slice(0, 10);
}

/** "2026-10" → "October 2026". */
export function monthTitle(ym) {
  return `${MONTHS[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`;
}

/** "2026-11-07" → "Nov 7, 2026". */
export function dayWords(day) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(day || ""));
  if (!m) return null;
  return `${MONTHS[Number(m[2]) - 1].slice(0, 3)} ${Number(m[3])}, ${m[1]}`;
}

/**
 * readReportMonth(value, asOf) — the `month` query. Empty is this month.
 * A future month, a month older than REPORT_MAX_MONTHS, or anything not
 * YYYY-MM is refused in plain words (the endpoint answers 400).
 */
export function readReportMonth(value, asOf = new Date()) {
  const current = isoDay(asOf).slice(0, 7);
  if (value === undefined || value === null || String(value).trim() === "") return { ok: true, month: current };
  const s = String(value).trim();
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(s)) return { ok: false, error: "month must be written YYYY-MM" };
  if (s > current) return { ok: false, error: "pick this month or an earlier one" };
  if (s < monthMinus(current, REPORT_MAX_MONTHS - 1)) return { ok: false, error: `pick a month in the last ${REPORT_MAX_MONTHS} months` };
  return { ok: true, month: s };
}

/** The days a month's report covers: the 1st to the last day, or to today. */
export function monthWindow(month, asOf = new Date()) {
  const from = `${month}-01`;
  const last = lastDayOfMonth(month);
  const today = isoDay(asOf);
  const to = last < today ? last : today;
  return { from, to, last, partial: to < last };
}

/* The first and last known value in a daily line. A null is a day with no
   save, skipped — never read as 0. `floor` marks a total with holes in it. */
function firstLast(values, floors) {
  const v = list(values);
  const f = list(floors);
  let s = -1;
  let e = -1;
  for (let i = 0; i < v.length; i++) if (isNum(v[i])) { if (s < 0) s = i; e = i; }
  if (s < 0) return { start: null, end: null, startFloor: false, endFloor: false };
  return { start: v[s], end: v[e], startFloor: f[s] === true, endFloor: f[e] === true, same: s === e };
}

/* Each bureau: the newest score before the month, and the newest score up to
   the month's last day. No pull in the month says so; no pull at all is one row. */
function creditRows(personal, win) {
  const pulls = list(personal && personal.pulls).map((p) => isoDay(p && p.pulled_at)).filter(Boolean);
  const pulledThisMonth = pulls.some((d) => d >= win.from && d <= win.to);
  const rows = [];
  for (const [key, label] of BUREAUS) {
    const series = list(personal && personal.series).find((s) => s && s.bureau === key);
    const points = list(series && series.points)
      .map((p) => ({ day: isoDay(p && p.pulled_at), score: p && isNum(p.score) ? p.score : null }))
      .filter((p) => p.day && p.score !== null)
      .sort((a, b) => a.day.localeCompare(b.day));
    const before = points.filter((p) => p.day < win.from).pop() || null;
    const upTo = points.filter((p) => p.day <= win.to).pop() || null;
    if (!upTo) continue;
    const newThisMonth = upTo.day >= win.from;
    rows.push({
      key: `score_${key}`, label: `${label} score`, kind: "score", better: "up",
      start: before ? before.score : null,
      end: upTo.score,
      note: !pulledThisMonth ? "No new pull this month" : (newThisMonth && !before ? "First pull" : null)
    });
  }
  if (!rows.length) {
    rows.push({ key: "score_none", label: "Credit scores", kind: "words", start: null, end: null, note: "No credit pull yet" });
  }
  return rows;
}

/* The money side, from the Trends read: cards used, each kind of cash on its
   own row, and debt. A row with no value in the month is left out. Cash has no
   "good way": less cash can be the plan working (it paid a card down). */
function moneyRows(trends) {
  const daily = (trends && trends.daily) || {};
  const cash = daily.cash || {};
  const debt = daily.debt || {};
  const defs = [
    { key: "cards_used", label: "Cards used", kind: "pct", better: "down", line: firstLast(daily.cards_used_pct) },
    { key: "cash_personal", label: "Personal cash", kind: "money", better: null, line: firstLast(cash.personal && cash.personal.cents, cash.personal && cash.personal.floor) },
    { key: "cash_business", label: "Business cash", kind: "money", better: null, line: firstLast(cash.business && cash.business.cents, cash.business && cash.business.floor) },
    { key: "debt", label: "Debt", kind: "money", better: "down", line: firstLast(debt.total && debt.total.cents, debt.total && debt.total.floor) }
  ];
  return defs.filter((d) => d.line.end !== null).map((d) => ({
    key: d.key, label: d.label, kind: d.kind, better: d.better,
    start: d.line.same ? null : d.line.start, end: d.line.end,
    startFloor: d.line.startFloor, endFloor: d.line.endFloor,
    note: d.line.same ? "One day saved this month" : null
  }));
}

/* Money in and out for the month, personal and business apart. */
function flowRows(trends, month) {
  const m = (trends && trends.monthly) || {};
  const i = list(m.months).indexOf(month);
  if (i < 0 || m.has_transactions !== true) return [];
  const out = [];
  for (const [kind, word] of [["personal", "Personal"], ["business", "Business"]]) {
    const b = m[kind] || {};
    const inC = list(b.in_cents)[i];
    const outC = list(b.out_cents)[i];
    if (isNum(inC)) out.push({ key: `${kind}_in`, label: `${word} money in`, kind: "money", value: inC });
    if (isNum(outC)) out.push({ key: `${kind}_out`, label: `${word} money out`, kind: "money", value: outC });
  }
  return out;
}

/** "Funding you qualify for" and the fundability count, from fundability(). */
export function heroOf(fund) {
  const personal = (fund && fund.opportunity && fund.opportunity.personal) || {};
  const now = (fund && fund.now) || {};
  const cents = (v) => (Number.isSafeInteger(v) && v >= 0 ? v : null);
  const score = Number.isSafeInteger(now.score) ? now.score : null;
  const max = Number.isSafeInteger(now.score_max) ? now.score_max : null;
  return {
    funding_cents: cents(personal.currentCents),
    projected_cents: cents(personal.projectedCents),
    as_of: isoDay(fund && fund.opportunity && fund.opportunity.source && fund.opportunity.source.asOf),
    fundability: score !== null && max ? { score, max, tier: now.tier === "fundable" ? "fundable" : "not_fundable_yet" } : null
  };
}

/** The next steps, as the Next steps tab lists them. */
function nextSteps(tasks) {
  return list(tasks && tasks.tasks).slice(0, NEXT_STEPS_MAX).map((t) => ({
    title: text(t && t.title) || "A step on your plan",
    due_on: isoDay(t && t.due_on),
    late_days: Number.isSafeInteger(t && t.late_days) && t.late_days > 0 ? t.late_days : null
  }));
}

/**
 * buildMonthlyReport — pure. The report's words and numbers, ready to draw.
 * Every input may be null (that read failed or the file has nothing yet); the
 * report then says so in place of the number.
 */
export function buildMonthlyReport({ month, asOf = new Date(), client = null, trends = null, credit = null, fund = null, tasks = null } = {}) {
  const win = monthWindow(month, asOf);
  const name = text(client && client.name) ||
    text(trends && trends.client && trends.client.name) ||
    text(credit && credit.client && credit.client.name) ||
    text(fund && fund.client && fund.client.name);
  const hero = heroOf(fund);
  const personal = credit && credit.credit_history && credit.credit_history.personal;
  const changed = [...creditRows(personal, win), ...moneyRows(trends)];
  const flows = flowRows(trends, month);
  const next = nextSteps(tasks);
  const notes = [];
  if (!moneyRows(trends).length) notes.push("Connect a bank to track cash and debt here.");
  return {
    ok: true,
    month,
    title: monthTitle(month),
    through: win.partial ? dayWords(win.to) : null,
    window: { from: win.from, to: win.to },
    client: { name: name || null },
    generated_on: isoDay(asOf),
    hero,
    changed,
    flows,
    fundability: hero.fundability,
    next,
    notes
  };
}

/* ── words for numbers ─────────────────────────────────────────────────── */

/** cents → "$93,600" (whole dollars) or "$1,234.56". null → "—". */
export function usd(cents, { whole = false } = {}) {
  if (!isNum(cents)) return "—";
  const neg = cents < 0;
  const abs = Math.abs(cents);
  const dollars = whole ? Math.round(abs / 100) : Math.floor(abs / 100);
  const body = `$${String(dollars).replace(/\B(?=(\d{3})+(?!\d))/g, ",")}${whole ? "" : `.${String(Math.round(abs % 100)).padStart(2, "0")}`}`;
  return neg ? `-${body}` : body;
}

/** One value of a row, in words. */
export function valueWords(kind, v, floor = false, whole = false) {
  if (kind === "words") return "—";
  if (!isNum(v)) return "—";
  if (kind === "pct") return `${Math.round(v * 10) / 10}%`;
  if (kind === "score") return String(Math.round(v));
  return (floor ? "at least " : "") + usd(v, { whole });
}

/** The change between start and end, in words, or "" when there is none to say. */
export function changeWords(row) {
  if (!row || !isNum(row.start) || !isNum(row.end)) return "";
  const d = row.end - row.start;
  if (d === 0) return "No change";
  const sign = d > 0 ? "+" : "-";
  if (row.kind === "pct") return `${sign}${Math.round(Math.abs(d) * 10) / 10} pts`;
  if (row.kind === "score") return `${sign}${Math.round(Math.abs(d))}`;
  return `${sign}${usd(Math.abs(d))}`;
}

/** true when the change went the good way for that row. null when unknown or none. */
export function changeIsGood(row) {
  if (!row || !isNum(row.start) || !isNum(row.end) || row.end === row.start || !row.better) return null;
  return row.better === "up" ? row.end > row.start : row.end < row.start;
}

/* ── the read ──────────────────────────────────────────────────────────── */

/* What a part of the report is called when its read failed. */
const PART_WORDS = { trends: "Cash and debt", credit: "Credit scores", fund: "Funding and fundability", tasks: "Next steps" };

/**
 * monthlyReport(db, { orgId, clientId, month, asOf }) → the report, or null
 * when the client is not in that org. A read that fails on its own leaves its
 * part as "—" and the report names it ("Credit scores could not be read
 * today."), so a gap is never silent. A database outage (isDbDown) still
 * throws, so the endpoint answers 503 db:"down" like every money read.
 */
export async function monthlyReport(db, { orgId, clientId, month, asOf = new Date(), reads = {} } = {}) {
  const win = monthWindow(month, asOf);
  const load = async (name, path) => (reads[name] ? reads[name] : (await import(path))[name]);
  const [moneyTrends, creditOverview, fundability, moneyTasks, isDbDown] = await Promise.all([
    load("moneyTrends", "./money-trends.mjs"),
    load("creditOverview", "./credit-overview.mjs"),
    load("fundability", "./fundability.mjs"),
    load("moneyTasks", "./money-tasks.mjs"),
    load("isDbDown", "../http/db-down.mjs")
  ]);
  const clientRes = await db.query(
    `SELECT id, first_name, last_name FROM clients WHERE id = $1 AND org_id = $2`, [clientId, orgId]);
  const c = clientRes.rows[0];
  if (!c) return null;
  const failed = [];
  const part = (key, p) => Promise.resolve().then(() => p()).catch((e) => {
    if (isDbDown(e)) throw e;
    failed.push(key);
    return null;
  });
  const [trends, credit, fund, tasks] = await Promise.all([
    part("trends", () => moneyTrends(db, { orgId, clientId, from: win.from, to: win.to, asOf })),
    part("credit", () => creditOverview(db, { orgId, clientId, asOf })),
    part("fund", () => fundability(db, { orgId, clientId, asOf })),
    part("tasks", () => moneyTasks(db, { orgId, clientId, asOf }))
  ]);
  const name = [text(c.first_name), text(c.last_name)].filter(Boolean).join(" ") || null;
  const report = buildMonthlyReport({ month, asOf, client: { name }, trends, credit, fund, tasks });
  for (const key of failed) report.notes.push(`${PART_WORDS[key]} could not be read today.`);
  report.failed = failed;
  return report;
}

/* ── the PDF ───────────────────────────────────────────────────────────── */

const PAGE = { w: 612, h: 792, m: 54 };
const hex = (h) => rgb(parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255);
const C = {
  ink: hex("#0D1113"), ink2: hex("#252A2D"), gray: hex("#626968"), gray2: hex("#858C89"),
  line: hex("#E3E5E0"), soft: hex("#F0F1ED"), paper: hex("#F8F8F6"), white: hex("#FFFFFF"),
  okInk: hex("#245C30"), alertInk: hex("#7E2C21"), accent: hex("#C4B3E5"), accInk: hex("#4F3C85"),
  spectrum: ["#F2A69B", "#F5CE8F", "#F2E39B", "#A8D8B0", "#A9C6E8", "#C4B3E5"].map(hex)
};

/* Helvetica is WinAnsi. Anything it cannot draw is swapped for plain words
   instead of throwing (the same care src/finance/crs-full-report.mjs takes). */
export function pdfText(v) {
  return String(v == null ? "" : v)
    .replace(/[→⟶]/g, "to").replace(/[≥]/g, ">=").replace(/[≤]/g, "<=")
    .replace(/[‐-‒]/g, "-").replace(/ /g, " ")
    .replace(/[^\x20-\x7E¡-ÿ–—‘’“”•…€]/g, "");
}

function drawWordmark(page, { x, top, width }) {
  const s = width / WORDMARK.width;
  const t = WORDMARK.transform;
  for (const d of WORDMARK.paths) {
    page.pushOperators(pushGraphicsState(), concatTransformationMatrix(s * t.sx, 0, 0, s * t.sy, x + s * t.tx, top - s * t.ty));
    page.drawSvgPath(d, { x: 0, y: 0, color: C.ink });
    page.pushOperators(popGraphicsState());
  }
  return width * (WORDMARK.height / WORDMARK.width);
}

function roundRect(page, { x, y, w, h, r = 10, fill = C.white, border = C.line }) {
  const p = `M${r} 0 H${w - r} A${r} ${r} 0 0 1 ${w} ${r} V${h - r} A${r} ${r} 0 0 1 ${w - r} ${h} H${r} A${r} ${r} 0 0 1 0 ${h - r} V${r} A${r} ${r} 0 0 1 ${r} 0 Z`;
  page.drawSvgPath(p, border
    ? { x, y: y + h, color: fill, borderColor: border, borderWidth: 0.8 }
    : { x, y: y + h, color: fill });
}

function spectrumBar(page, y, h = 6) {
  const w = PAGE.w / C.spectrum.length;
  C.spectrum.forEach((c, i) => page.drawRectangle({ x: i * w, y, width: w + 0.5, height: h, color: c }));
}

/* Text that never runs past `max` points: shrinks to `min` size, then trims. */
function fit(font, words, size, max, min = size) {
  let s = size;
  const t = pdfText(words);
  while (s > min && font.widthOfTextAtSize(t, s) > max) s -= 0.5;
  if (font.widthOfTextAtSize(t, s) <= max) return { t, s };
  let cut = t;
  while (cut.length > 1 && font.widthOfTextAtSize(`${cut}…`, s) > max) cut = cut.slice(0, -1);
  return { t: `${cut.trimEnd()}…`, s };
}

function wrap(font, words, size, max) {
  const out = [];
  let line = "";
  for (const w of pdfText(words).split(/\s+/).filter(Boolean)) {
    const tryLine = line ? `${line} ${w}` : w;
    if (font.widthOfTextAtSize(tryLine, size) <= max) line = tryLine;
    else { if (line) out.push(line); line = w; }
  }
  if (line) out.push(line);
  return out;
}

function ring(page, { cx, cy, r, score, max, fonts }) {
  page.drawCircle({ x: cx, y: cy, size: r, borderColor: C.soft, borderWidth: 9 });
  const frac = max ? Math.max(0, Math.min(1, score / max)) : 0;
  if (frac >= 1) page.drawCircle({ x: cx, y: cy, size: r, borderColor: C.accInk, borderWidth: 9 });
  else if (frac > 0) {
    const a = frac * Math.PI * 2;
    const ex = (r * Math.sin(a)).toFixed(2);
    const ey = (-r * Math.cos(a)).toFixed(2);
    page.drawSvgPath(`M0 ${-r} A${r} ${r} 0 ${frac > 0.5 ? 1 : 0} 1 ${ex} ${ey}`,
      { x: cx, y: cy, borderColor: C.accInk, borderWidth: 9, borderLineCap: LineCapStyle.Round });
  }
  const big = `${score}`;
  const small = `/${max}`;
  const bw = fonts.bold.widthOfTextAtSize(big, 24);
  const sw = fonts.regular.widthOfTextAtSize(small, 13);
  page.drawText(big, { x: cx - (bw + sw) / 2, y: cy - 8, size: 24, font: fonts.bold, color: C.ink });
  page.drawText(small, { x: cx - (bw + sw) / 2 + bw, y: cy - 8, size: 13, font: fonts.regular, color: C.gray });
}

function footer(page, report, n, fonts) {
  const words = pdfText(`Fundhub · Monthly report · ${report.title} · Page ${n}`);
  page.drawLine({ start: { x: PAGE.m, y: 44 }, end: { x: PAGE.w - PAGE.m, y: 44 }, thickness: 0.6, color: C.line });
  page.drawText(words, { x: PAGE.m, y: 28, size: 9, font: fonts.regular, color: C.gray });
  const site = "fundhub.ai";
  page.drawText(site, { x: PAGE.w - PAGE.m - fonts.regular.widthOfTextAtSize(site, 9), y: 28, size: 9, font: fonts.regular, color: C.gray });
}

function statBox(page, { x, y, w, h, label, value, sub, fonts }) {
  roundRect(page, { x, y, w, h, r: 10, fill: C.white, border: C.line });
  page.drawText(pdfText(label), { x: x + 14, y: y + h - 22, size: 10, font: fonts.regular, color: C.gray });
  const v = fit(fonts.bold, value, 20, w - 28, 12);
  page.drawText(v.t, { x: x + 14, y: y + h - 48, size: v.s, font: fonts.bold, color: C.ink });
  if (sub) {
    const s = fit(fonts.regular, sub, 9.5, w - 28, 8);
    page.drawText(s.t, { x: x + 14, y: y + 14, size: s.s, font: fonts.regular, color: C.gray });
  }
}

function coverPage(pdf, report, fonts) {
  const page = pdf.addPage([PAGE.w, PAGE.h]);
  page.drawRectangle({ x: 0, y: 0, width: PAGE.w, height: PAGE.h, color: C.paper });
  spectrumBar(page, PAGE.h - 8, 8);
  drawWordmark(page, { x: PAGE.m, top: PAGE.h - 54, width: 118 });

  let y = PAGE.h - 128;
  page.drawText("Monthly report", { x: PAGE.m, y, size: 13, font: fonts.bold, color: C.accInk });
  y -= 46;
  const title = fit(fonts.bold, report.title, 46, PAGE.w - 2 * PAGE.m, 28);
  page.drawText(title.t, { x: PAGE.m, y, size: title.s, font: fonts.bold, color: C.ink });
  y -= 28;
  const who = [report.client.name, report.through ? `Through ${report.through}` : null].filter(Boolean).join(" · ");
  if (who) {
    const w = fit(fonts.regular, who, 15, PAGE.w - 2 * PAGE.m, 10);
    page.drawText(w.t, { x: PAGE.m, y, size: w.s, font: fonts.regular, color: C.gray });
  }

  /* The hero: "Funding you qualify for", with the fundability ring. */
  const hx = PAGE.m;
  const hw = PAGE.w - 2 * PAGE.m;
  const hh = 168;
  const hy = y - 30 - hh;
  roundRect(page, { x: hx, y: hy, w: hw, h: hh, r: 14, fill: C.white, border: C.line });
  page.drawText("Funding you qualify for", { x: hx + 24, y: hy + hh - 34, size: 12, font: fonts.regular, color: C.gray });
  const hero = report.hero || {};
  const amount = hero.funding_cents !== null && hero.funding_cents !== undefined ? usd(hero.funding_cents, { whole: true }) : "Not ready yet";
  const a = fit(fonts.bold, amount, 48, hw - 220, 26);
  page.drawText(a.t, { x: hx + 24, y: hy + hh - 88, size: a.s, font: fonts.bold, color: C.ink });
  let line = hy + hh - 114;
  if (isNum(hero.projected_cents) && isNum(hero.funding_cents) && hero.projected_cents > hero.funding_cents) {
    page.drawText(pdfText(`With your plan: ${usd(hero.projected_cents, { whole: true })}`), { x: hx + 24, y: line, size: 12.5, font: fonts.bold, color: C.okInk });
    line -= 20;
  }
  const est = hero.funding_cents === null || hero.funding_cents === undefined
    ? "Shows after your credit report is read."
    : `Estimate from UnderwriteIQ${hero.as_of ? ` · ${dayWords(hero.as_of)}` : ""}`;
  page.drawText(pdfText(est), { x: hx + 24, y: line, size: 10.5, font: fonts.regular, color: C.gray });
  if (hero.fundability) {
    const cx = hx + hw - 92;
    const cy = hy + hh / 2 + 12;
    ring(page, { cx, cy, r: 42, score: hero.fundability.score, max: hero.fundability.max, fonts });
    const tier = hero.fundability.tier === "fundable" ? "Fundable" : "Not fundable yet";
    const tw = fonts.bold.widthOfTextAtSize(tier, 10.5);
    page.drawText("Fundability", { x: cx - fonts.regular.widthOfTextAtSize("Fundability", 9.5) / 2, y: cy - 60, size: 9.5, font: fonts.regular, color: C.gray });
    page.drawText(tier, { x: cx - tw / 2, y: cy - 74, size: 10.5, font: fonts.bold, color: hero.fundability.tier === "fundable" ? C.okInk : C.ink2 });
  }

  /* Three numbers from the month: the ones a client checks first. */
  const pick = (key) => (report.changed || []).find((r) => r.key === key) || null;
  const stats = [
    ["Cards used", pick("cards_used")],
    ["Personal cash", pick("cash_personal")],
    ["Debt", pick("debt")]
  ];
  const gap = 12;
  const sw = (hw - 2 * gap) / 3;
  const sh = 84;
  const sy = hy - 18 - sh;
  stats.forEach(([label, row], i) => {
    const value = row ? valueWords(row.kind, row.end, row.endFloor, true) : "—";
    const sub = row && isNum(row.start) ? `From ${valueWords(row.kind, row.start, row.startFloor, true)}` : (row ? "This month" : "Not connected");
    statBox(page, { x: hx + i * (sw + gap), y: sy, w: sw, h: sh, label, value, sub, fonts });
  });

  /* Each bureau's score, with its change since last month. */
  const scores = (report.changed || []).filter((r) => r.kind === "score");
  let ly = sy - 28;
  page.drawText("Your credit scores", { x: PAGE.m, y: ly, size: 12, font: fonts.bold, color: C.ink });
  ly -= 10;
  if (!scores.length) {
    ly -= 16;
    page.drawText("No credit pull yet.", { x: PAGE.m, y: ly, size: 11, font: fonts.regular, color: C.gray });
  } else {
    const cw = (hw - 2 * gap) / 3;
    const ch = 54;
    ly -= ch;
    scores.slice(0, 3).forEach((row, i) => {
      const x = hx + i * (cw + gap);
      roundRect(page, { x, y: ly, w: cw, h: ch, r: 10, fill: C.white, border: C.line });
      page.drawText(pdfText(row.label.replace(/ score$/, "")), { x: x + 14, y: ly + ch - 20, size: 10, font: fonts.regular, color: C.gray });
      const v = valueWords(row.kind, row.end);
      page.drawText(v, { x: x + 14, y: ly + 14, size: 20, font: fonts.bold, color: C.ink });
      const c = changeWords(row);
      if (c && c !== "No change") {
        const good = changeIsGood(row);
        page.drawText(pdfText(c), { x: x + 22 + fonts.bold.widthOfTextAtSize(v, 20), y: ly + 16, size: 11, font: fonts.bold, color: good === true ? C.okInk : good === false ? C.alertInk : C.gray });
      }
    });
    const note = scores.find((r) => r.note);
    if (note) {
      ly -= 16;
      page.drawText(pdfText(note.note), { x: PAGE.m, y: ly, size: 9.5, font: fonts.regular, color: C.gray });
    }
  }

  /* The first next step, so the cover says what to do. */
  const first = (report.next || [])[0];
  if (first) {
    const nh = 58;
    const ny = ly - 18 - nh;
    roundRect(page, { x: hx, y: ny, w: hw, h: nh, r: 12, fill: C.ink, border: null });
    page.drawText("Your next step", { x: hx + 20, y: ny + nh - 21, size: 10, font: fonts.regular, color: C.line });
    const t = fit(fonts.bold, first.title, 14, hw - 40, 10);
    page.drawText(t.t, { x: hx + 20, y: ny + 14, size: t.s, font: fonts.bold, color: C.white });
  }

  const made = pdfText(`Made ${dayWords(report.generated_on) || ""} for ${report.client.name || "you"}.`);
  page.drawText(made, { x: PAGE.m, y: 62, size: 9.5, font: fonts.regular, color: C.gray });
  footer(page, report, 1, fonts);
}

function sectionTitle(page, words, y, fonts) {
  page.drawText(pdfText(words), { x: PAGE.m, y, size: 17, font: fonts.bold, color: C.ink });
  return y - 12;
}

function detailPage(pdf, report, fonts) {
  const page = pdf.addPage([PAGE.w, PAGE.h]);
  spectrumBar(page, PAGE.h - 4, 4);
  drawWordmark(page, { x: PAGE.m, top: PAGE.h - 34, width: 72 });
  const head = fit(fonts.regular, [report.title, report.client.name].filter(Boolean).join(" · "), 10, 300, 8);
  page.drawText(head.t, { x: PAGE.w - PAGE.m - fonts.regular.widthOfTextAtSize(head.t, head.s), y: PAGE.h - 46, size: head.s, font: fonts.regular, color: C.gray });

  const W = PAGE.w - 2 * PAGE.m;
  const col = { label: PAGE.m, start: PAGE.m + W * 0.46, end: PAGE.m + W * 0.64, change: PAGE.m + W * 0.82 };
  let y = PAGE.h - 104;
  y = sectionTitle(page, "What changed", y, fonts);
  y -= 16;
  for (const [x, words] of [[col.label, ""], [col.start, "Start"], [col.end, "Now"], [col.change, "Change"]]) {
    if (words) page.drawText(words, { x, y, size: 9.5, font: fonts.bold, color: C.gray });
  }
  y -= 8;
  for (const row of report.changed || []) {
    page.drawLine({ start: { x: PAGE.m, y }, end: { x: PAGE.w - PAGE.m, y }, thickness: 0.6, color: C.line });
    y -= 18;
    const label = fit(fonts.regular, row.label, 11, col.start - col.label - 12, 9);
    page.drawText(label.t, { x: col.label, y, size: label.s, font: fonts.regular, color: C.ink });
    if (row.kind === "words") {
      page.drawText(pdfText(row.note || "—"), { x: col.start, y, size: 10.5, font: fonts.regular, color: C.gray });
    } else {
      page.drawText(pdfText(valueWords(row.kind, row.start, row.startFloor)), { x: col.start, y, size: 11, font: fonts.regular, color: C.gray });
      const now = fit(fonts.bold, valueWords(row.kind, row.end, row.endFloor), 11, col.change - col.end - 8, 8);
      page.drawText(now.t, { x: col.end, y, size: now.s, font: fonts.bold, color: C.ink });
      const ch = changeWords(row);
      const good = changeIsGood(row);
      if (ch) page.drawText(pdfText(ch), { x: col.change, y, size: 11, font: fonts.bold, color: good === true ? C.okInk : good === false ? C.alertInk : C.gray });
      if (row.note) {
        y -= 13;
        page.drawText(pdfText(row.note), { x: col.label, y, size: 9, font: fonts.regular, color: C.gray });
      }
    }
    y -= 10;
  }
  page.drawLine({ start: { x: PAGE.m, y }, end: { x: PAGE.w - PAGE.m, y }, thickness: 0.6, color: C.line });
  for (const n of report.notes || []) {
    y -= 18;
    page.drawText(pdfText(n), { x: PAGE.m, y, size: 10, font: fonts.regular, color: C.gray });
  }

  const flows = report.flows || [];
  if (flows.length || report.fundability) {
    y -= 34;
    y = sectionTitle(page, "This month", y, fonts);
    y -= 6;
    const items = flows.map((f) => [f.label, usd(f.value)]);
    if (report.fundability) items.push(["Fundability today", `${report.fundability.score} of ${report.fundability.max} · ${report.fundability.tier === "fundable" ? "Fundable" : "Not fundable yet"}`]);
    for (const [label, value] of items) {
      y -= 18;
      page.drawText(pdfText(label), { x: PAGE.m, y, size: 11, font: fonts.regular, color: C.ink });
      const v = pdfText(value);
      page.drawText(v, { x: PAGE.w - PAGE.m - fonts.bold.widthOfTextAtSize(v, 11), y, size: 11, font: fonts.bold, color: C.ink });
      y -= 7;
      page.drawLine({ start: { x: PAGE.m, y }, end: { x: PAGE.w - PAGE.m, y }, thickness: 0.6, color: C.line });
    }
  }

  y -= 38;
  y = sectionTitle(page, "What's next", y, fonts);
  const next = report.next || [];
  if (!next.length) {
    y -= 22;
    page.drawText("No open steps right now.", { x: PAGE.m, y, size: 11, font: fonts.regular, color: C.gray });
  }
  next.forEach((step, i) => {
    if (y < 110) return;
    y -= 26;
    page.drawCircle({ x: PAGE.m + 9, y: y + 4, size: 9, color: C.ink });
    const num = String(i + 1);
    page.drawText(num, { x: PAGE.m + 9 - fonts.bold.widthOfTextAtSize(num, 9.5) / 2, y: y + 0.6, size: 9.5, font: fonts.bold, color: C.white });
    const lines = wrap(fonts.bold, step.title, 11.5, W - 30).slice(0, 2);
    lines.forEach((l, k) => page.drawText(l, { x: PAGE.m + 26, y: y - k * 15, size: 11.5, font: fonts.bold, color: C.ink }));
    const when = step.late_days ? `${step.late_days} days late` : step.due_on ? `By ${dayWords(step.due_on)}` : null;
    if (when) {
      y -= 15 * lines.length;
      page.drawText(pdfText(when), { x: PAGE.m + 26, y, size: 9.5, font: fonts.regular, color: step.late_days ? C.alertInk : C.gray });
    } else if (lines.length > 1) y -= 15;
  });
  footer(page, report, 2, fonts);
}

/** renderMonthlyReportPdf(report) → PDF bytes (Uint8Array): cover + details. */
export async function renderMonthlyReportPdf(report) {
  const pdf = await PDFDocument.create();
  pdf.setTitle(pdfText(`Fundhub monthly report · ${report.title}`));
  pdf.setAuthor("Fundhub");
  pdf.setSubject("What changed and what's next");
  pdf.setCreator("Fundhub FinanceOS");
  const fonts = {
    regular: await pdf.embedFont(StandardFonts.Helvetica),
    bold: await pdf.embedFont(StandardFonts.HelveticaBold)
  };
  coverPage(pdf, report, fonts);
  detailPage(pdf, report, fonts);
  return pdf.save();
}

/** The file name a browser saves: fundhub-report-2026-10.pdf */
export function reportFileName(month) {
  return `fundhub-report-${month}.pdf`;
}

export default { readReportMonth, monthWindow, buildMonthlyReport, monthlyReport, renderMonthlyReportPdf, reportFileName };
