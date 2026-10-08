// Affiliate, white-label, and commission payout gaps for the morning pulse.
// Report only. Read-only SELECT. Never pays anyone. Never creates a partner.
//
// Slice 17 and slice 31 already watch the morning list and cron silence.
// This file does not repeat those rows. It looks for four breaks they miss:
// a referral link that matches nobody, commission the payout rules say is
// payable but is not, a partner login door that cannot open, and a payout
// run left in processing.
//
// Tripwire is existing Recon (AG-07). No second watchdog.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { ROUTES } from "../../../netlify/functions/api.mjs";
import { PAYOUT_DEFAULTS, previousMonth } from "../../affiliates/payouts.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const START_HTML = path.resolve(HERE, "../../../public/start.html");
const LOGIN_SRC = path.resolve(HERE, "../../../api/auth/login.mjs");

export const REFERRAL_CLICK_ROUTE = "public/affiliate-click";
export const PARTNER_LOGIN_ROUTE = "auth/login";

/** Unresolved referral clicks older than this are a dead link. */
export const DEAD_LINK_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

/** A payout left in processing longer than this is stuck. */
export const PAYOUT_STUCK_AFTER_MS = 7 * 24 * 60 * 60 * 1000;

const TRIPWIRE =
  "Tell Recon (AG-07). Do not build a second watchdog. Do not pay anyone. Do not create a partner.";

export const REFERRAL_LINK_SQL = `
  SELECT
    (SELECT count(*)::int
       FROM affiliate_link_clicks
      WHERE org_id = $1
        AND affiliate_id IS NULL
        AND occurred_at >= $2) AS unresolved,
    (SELECT count(*)::int
       FROM affiliates
      WHERE org_id = $1
        AND status = 'active'
        AND (tracking_id IS NULL OR btrim(tracking_id) = '')) AS blank_codes`;

/** Converted commission the payout rules say should be pending, and is not. */
export const COMMISSION_PAYABLE_SQL = `
  SELECT count(*)::int AS n
    FROM (
      SELECT r.affiliate_id
        FROM affiliate_referrals r
        JOIN affiliates a ON a.id = r.affiliate_id AND a.org_id = r.org_id
       WHERE r.org_id = $1
         AND r.status = 'converted'
         AND r.commission_due IS NOT NULL
         AND r.commission_due > 0
         AND r.converted_at < $2
         AND a.partner_license_signed_at IS NOT NULL
         AND a.tax_form_received_at IS NOT NULL
         AND NOT EXISTS (
               SELECT 1
                 FROM affiliate_payout_lines l
                 JOIN affiliate_payouts p ON p.id = l.payout_id
                WHERE l.referral_id = r.id
                  AND l.kind = 'commission'
                  AND p.status IN ('pending', 'processing', 'paid')
             )
       GROUP BY r.affiliate_id
      HAVING sum(r.commission_due) >= $3
    ) owed`;

export const PARTNER_LOGIN_SQL = `
  SELECT
    count(*) FILTER (WHERE p.status = 'active')::int AS active_partners,
    count(a.id) FILTER (
      WHERE p.status = 'active'
        AND a.status = 'active'
        AND a.password_hash IS NOT NULL
    )::int AS can_sign_in
    FROM partners p
    LEFT JOIN accounts a
      ON a.partner_id = p.id
     AND a.org_id = p.org_id
     AND a.kind = 'partner'
   WHERE p.org_id = $1`;

export const PAYOUT_STUCK_SQL = `
  SELECT
    (SELECT count(*)::int
       FROM affiliate_payouts
      WHERE org_id = $1
        AND status = 'processing'
        AND coalesce(initiated_at, created_at) < $2) AS affiliate_stuck,
    (SELECT count(*)::int
       FROM partner_payouts
      WHERE org_id = $1
        AND status = 'processing'
        AND coalesce(initiated_at, created_at) < $2) AS partner_stuck`;

function check(id, status, detail, suggestedFix = null) {
  return { id, status, detail, suggestedFix };
}

function fix(line) {
  return `${line} ${TRIPWIRE}`;
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function assertSelect(sql) {
  const s = String(sql).trim().toLowerCase();
  if (!s.startsWith("select")) throw new Error("gap-partners is read-only");
  if (/\b(insert|update|delete|drop|alter|truncate)\b/.test(s)) {
    throw new Error("gap-partners is read-only");
  }
}

async function readRow(db, sql, params) {
  assertSelect(sql);
  const r = await db.query(sql, params);
  return (r && r.rows && r.rows[0]) || {};
}

function clickDoorWired(ctx, routes) {
  if (!routes || !Object.prototype.hasOwnProperty.call(routes, REFERRAL_CLICK_ROUTE)) {
    return { ok: false, why: "the referral click door is not routed" };
  }
  let html = ctx.startHtml;
  if (html == null) {
    try {
      html = fs.readFileSync(START_HTML, "utf8");
    } catch {
      return { ok: false, why: "the referral start page is missing" };
    }
  }
  if (!String(html).includes("/api/public/affiliate-click")) {
    return { ok: false, why: "the referral start page no longer records the click" };
  }
  return { ok: true };
}

function partnerLoginWired(ctx, routes) {
  if (!routes || !Object.prototype.hasOwnProperty.call(routes, PARTNER_LOGIN_ROUTE)) {
    return { ok: false, why: "auth/login is not routed" };
  }
  if (ctx.loginHandlesPartners === false) {
    return { ok: false, why: "login no longer accepts a partner account" };
  }
  if (ctx.loginHandlesPartners === true) return { ok: true };
  let src = "";
  try {
    src = fs.readFileSync(LOGIN_SRC, "utf8");
  } catch {
    return { ok: false, why: "the login handler is missing" };
  }
  if (!src.includes("loginAccount(")) {
    return { ok: false, why: "login no longer accepts a partner account" };
  }
  return { ok: true };
}

async function referralLink(ctx, routes, db, orgId, now) {
  const id = "partners:referral-link";
  const door = clickDoorWired(ctx, routes);
  if (!door.ok) {
    return check(
      id,
      "FAIL",
      `Referral link is dead: ${door.why}.`,
      fix("Restore the referral start page and POST /api/public/affiliate-click. Do not edit the page from this check.")
    );
  }
  if (!db || !orgId) {
    return check(id, "skip", "no database in this run — referral clicks not read");
  }
  try {
    const since = new Date(now.getTime() - DEAD_LINK_WINDOW_MS);
    const row = await readRow(db, REFERRAL_LINK_SQL, [orgId, since]);
    const unresolved = num(row.unresolved);
    const blank = num(row.blank_codes);
    if (unresolved === 0 && blank === 0) {
      return check(id, "PASS", "referral clicks match an affiliate, and active affiliates have a code");
    }
    const parts = [];
    if (unresolved > 0) {
      parts.push(
        `${unresolved} referral click${unresolved === 1 ? "" : "s"} in the last 30 days matched no affiliate`
      );
    }
    if (blank > 0) {
      parts.push(
        `${blank} active affiliate${blank === 1 ? "" : "s"} ha${blank === 1 ? "s" : "ve"} no code`
      );
    }
    return check(
      id,
      "FAIL",
      `Referral link is dead: ${parts.join(". ")}.`,
      fix("Fix the code on the live affiliate link. Do not mint a new partner.")
    );
  } catch (err) {
    return check(
      id,
      "FAIL",
      `Could not read referral clicks: ${String((err && err.message) || err).slice(0, 160)}`,
      fix("Read affiliate_link_clicks. Do not write a click from this check.")
    );
  }
}

async function commissionPayable(ctx, db, orgId, now) {
  const id = "partners:commission-payable";
  if (!db || !orgId) {
    return check(id, "skip", "no database in this run — commission payable state not read");
  }
  const { periodEnd } = previousMonth(now);
  const minimum = PAYOUT_DEFAULTS.minimumUsd;
  try {
    const row = await readRow(db, COMMISSION_PAYABLE_SQL, [orgId, periodEnd, minimum]);
    const n = num(row.n);
    if (n === 0) {
      return check(
        id,
        "PASS",
        `no affiliate has earned commission the rules say is payable (license, tax form, at least $${minimum}) and is still not payable`
      );
    }
    return check(
      id,
      "FAIL",
      `${n} affiliate${n === 1 ? "" : "s"} earned commission the rules say is payable (signed license, tax form, at least $${minimum}, converted before ${periodEnd.toISOString().slice(0, 10)}) and it is not on a pending, processing, or paid run.`,
      fix("Look at those converted referrals. The monthly payout job should have written a pending row. Do not mark anyone paid.")
    );
  } catch (err) {
    return check(
      id,
      "FAIL",
      `Could not read commission payable state: ${String((err && err.message) || err).slice(0, 160)}`,
      fix("Read affiliate_referrals and affiliate_payouts. Do not mark anyone paid.")
    );
  }
}

async function partnerLogin(ctx, routes, db, orgId) {
  const id = "partners:login-door";
  const door = partnerLoginWired(ctx, routes);
  if (!door.ok) {
    return check(
      id,
      "FAIL",
      `Partner login door is dead: ${door.why}.`,
      fix("Restore POST /api/auth/login so a partner account can sign in. Do not mint a partner.")
    );
  }
  if (!db || !orgId) {
    return check(id, "skip", "no database in this run — partner accounts not read");
  }
  try {
    const row = await readRow(db, PARTNER_LOGIN_SQL, [orgId]);
    const active = num(row.active_partners);
    const can = num(row.can_sign_in);
    if (active === 0) {
      return check(id, "PASS", "partner login door is wired; no active partner is waiting to sign in");
    }
    if (can === 0) {
      return check(
        id,
        "FAIL",
        `Partner login door is dead: ${active} active partner${active === 1 ? "" : "s"} and none can sign in.`,
        fix("Open the existing partner account on auth/login. Do not mint a new partner.")
      );
    }
    return check(
      id,
      "PASS",
      `partner login door is wired; ${can} of ${active} active partner${active === 1 ? "" : "s"} can sign in`
    );
  } catch (err) {
    return check(
      id,
      "FAIL",
      `Could not read partner login accounts: ${String((err && err.message) || err).slice(0, 160)}`,
      fix("Read partners and accounts. Do not mint a partner.")
    );
  }
}

async function payoutStuck(db, orgId, now) {
  const id = "partners:payout-stuck";
  if (!db || !orgId) {
    return check(id, "skip", "no database in this run — payout runs not read");
  }
  const cutoff = new Date(now.getTime() - PAYOUT_STUCK_AFTER_MS);
  try {
    const row = await readRow(db, PAYOUT_STUCK_SQL, [orgId, cutoff]);
    const aff = num(row.affiliate_stuck);
    const partner = num(row.partner_stuck);
    if (aff === 0 && partner === 0) {
      return check(id, "PASS", "no affiliate or partner payout run has been processing for more than 7 days");
    }
    const parts = [];
    if (aff > 0) parts.push(`${aff} affiliate payout run${aff === 1 ? "" : "s"}`);
    if (partner > 0) parts.push(`${partner} partner payout run${partner === 1 ? "" : "s"}`);
    return check(
      id,
      "FAIL",
      `Payout run stuck: ${parts.join(" and ")} ha${aff + partner === 1 ? "s" : "ve"} been processing for more than 7 days.`,
      fix("Look at the processing run. Do not mark it paid.")
    );
  } catch (err) {
    return check(
      id,
      "FAIL",
      `Could not read payout runs: ${String((err && err.message) || err).slice(0, 160)}`,
      fix("Read affiliate_payouts and partner_payouts. Do not mark a run paid.")
    );
  }
}

/**
 * Four gap checks. ctx: { db, orgId, now, routes, startHtml, loginHandlesPartners }.
 * status is PASS, FAIL, or skip. Never writes.
 */
export async function gapChecks(ctx = {}) {
  const db = ctx.db || null;
  const orgId = ctx.orgId || null;
  const now = ctx.now instanceof Date ? ctx.now : new Date();
  const routes = ctx.routes || ROUTES;
  const [referral, commission, login, payout] = await Promise.all([
    referralLink(ctx, routes, db, orgId, now),
    commissionPayable(ctx, db, orgId, now),
    partnerLogin(ctx, routes, db, orgId),
    payoutStuck(db, orgId, now)
  ]);
  return [referral, commission, login, payout];
}
