// Credit soft-pull approve door. Report only. Never auto-fix.
// One GET of the approve screen. One GET of its read route, with no link token.
// One in-process GET of the same read, with a link signed for a real client, to
// see the database half answer. None of these GETs pulls credit or sends bureau
// mail. The handler is only ever asked to read.
// Recon (AG-07) is the one tripwire. Do not invent a second watchdog.
// Do not edit the approve page from this check.
//
// The plain up/down ping of both doors is reg:soft-pull-approve.html and
// reg:soft-pull-approve in the registry. What these add: the screen is really
// the approve screen, the unsigned answer has the right shape, and a signed
// read reaches the database and comes back with the words and the price.

//
// 2026-10-09 (Tier 1): three more rows read the credit-pull ledger itself, the
// part the doors above cannot see: did a pull fail or stall, did a paid buyer
// never get the pull form, did a paid and approved client never get a pull.
// They read the database only. They never pull credit, never send, never POST.

// ONE JUDGE, TWO CLOCKS (2026-10-20). The approve screen and read checks, the credit-pull ledger,
// their SQL and their judges live in src/pulse/beats/lib/soft-pull-truth.mjs, so this morning lane
// and the hourly beat soft-pull run the same code. The signed approve read stays here: it signs a
// link and runs the real handler in process, which a beat may not do.

import { secretFromEnv } from "../../documents/signed-url.mjs";
import { signSoftPullApproveUrl } from "../../consent/approve-token.mjs";
import * as truth from "../beats/lib/soft-pull-truth.mjs";
import {
  READ_FIX, READ_KIND, TRIPWIRE, UUID_RE, check, checkApproveClickNoPull, checkPaidFormNotFilled,
  checkRequestFailedOrStuck, clip
} from "../beats/lib/soft-pull-truth.mjs";

export * from "../beats/lib/soft-pull-truth.mjs";

/** The newest real client. Any client will do: the read is thrown away. */
export const CLIENT_PICK_SQL = `
/* gap:soft-pull-client */
SELECT c.id::text AS id
  FROM clients c
 WHERE c.org_id = $1::uuid
   AND c.is_demo IS NOT TRUE
 ORDER BY c.created_at DESC
 LIMIT 1
`.trim();

/** The approve screen, read with this run's fetch. */
export function checkApprovePage({ fetchImpl, baseUrl } = {}) {
  return truth.checkApprovePage({ web: fetchImpl, baseUrl });
}

/** The approve read door with no link, read with this run's fetch. */
export function checkApproveRead({ fetchImpl, baseUrl } = {}) {
  return truth.checkApproveRead({ web: fetchImpl, baseUrl });
}

function mockRes() {
  return {
    statusCode: 0,
    body: null,
    headers: {},
    setHeader(name, value) { this.headers[String(name).toLowerCase()] = value; },
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; }
  };
}

/** The word and the price the approve screen paints. Names and contact stay out. */
export function signedReadShape(status, body) {
  if (status !== 200 || !body || typeof body !== "object") return false;
  const text = body.disclosure && typeof body.disclosure === "object" ? body.disclosure.text : null;
  const base = body.pricing && typeof body.pricing === "object" ? Number(body.pricing.base_cents) : NaN;
  return body.ok === true
    && body.kind === READ_KIND
    && typeof text === "string" && text.trim().length > 0
    && Number.isFinite(base) && base > 0
    && body.consent != null && typeof body.consent === "object"
    && body.contact != null && typeof body.contact === "object";
}

/**
 * The approve read, with a link signed for a real client, run in-process.
 * A signed link without a client account must be refused. Then an in-process
 * matching client identity gets past that gate so the real handler can read
 * the words, price and consent state. This does not prove a live login.
 * GET only. The handler writes nothing on a GET.
 */
export async function checkApproveSignedRead(ctx = {}) {
  const id = "soft-pull:approve-signed-read";
  const db = ctx.db;
  const orgId = typeof ctx.orgId === "string" ? ctx.orgId.trim() : "";
  if (!db || typeof db.query !== "function") {
    return check(id, "skip", "no database in this run — signed approve read not opened");
  }
  if (!UUID_RE.test(orgId)) {
    return check(id, "skip", "no company in this run — signed approve read not opened");
  }
  const env = ctx.env && typeof ctx.env === "object" ? ctx.env : process.env;

  let secret;
  try {
    secret = secretFromEnv(env);
  } catch {
    return check(
      id,
      "FAIL",
      "approval links cannot be signed: DOCUMENT_URL_SECRET is missing or too short",
      `Set DOCUMENT_URL_SECRET (32 or more characters) on Netlify. ${TRIPWIRE}`
    );
  }

  let clientId;
  try {
    const found = await db.query(CLIENT_PICK_SQL, [orgId]);
    clientId = found && found.rows && found.rows[0] ? found.rows[0].id : null;
  } catch (err) {
    return check(id, "FAIL", `could not pick a client to read: ${clip(err && err.message)}`, READ_FIX);
  }
  if (!clientId) return check(id, "skip", "no real client on file — signed approve read not opened");

  try {
    const handler = typeof ctx.approveHandler === "function"
      ? ctx.approveHandler
      : (await import("../../../api/soft-pull-approve.mjs")).default;
    const signed = signSoftPullApproveUrl({ orgId, clientId, ttlSeconds: 300, secret });
    const query = Object.fromEntries(new URL(signed.path, "https://link.invalid").searchParams);
    const req = { method: "GET", headers: {}, query, body: null };
    const signedOut = mockRes();
    await handler(req, signedOut, { db, env, secret, resolvePrincipal: async () => null });
    if (signedOut.statusCode !== 401 || signedOut.body?.error !== "account_required") {
      const code = signedOut.body && typeof signedOut.body.error === "string"
        ? ` (${clip(signedOut.body.error, 60)})` : "";
      return check(
        id,
        "FAIL",
        `signed-out approval read answered ${signedOut.statusCode || "nothing"}${code}, expected account_required`,
        READ_FIX
      );
    }
    // The live Pulse run has no buyer session. A matching identity supplied by
    // this background process would only prove the handler in isolation, not
    // that the buyer can open the page. Keep the live verdict unverified.
    if (typeof ctx.approveHandler !== "function") {
      return check(id, "skip",
        "signed consent page requires a real client login; background GET cannot verify buyer access — NEEDS LIVE RECEIPT");
    }
    const res = mockRes();
    await handler(req, res, {
      db, env, secret,
      resolvePrincipal: async () => ({ kind: "client", orgId, clientId, accountId: "pulse-read-only" })
    });
    const status = Number(res.statusCode) || 0;
    // Portal account claim now gates the signed credit-consent page. A Pulse
    // background GET deliberately has NO buyer session. A legitimate
    // account_required refusal is NOT a broken link and cannot become PASS
    // through a fabricated principal: user-visible consent needs a separate
    // authorized, real account receipt. Other 401 errors remain failures.
    if (status === 401 && res.body?.error === "account_required") {
      return check(id, "skip",
        "signed consent page requires a real client login; background GET cannot verify buyer access — NEEDS LIVE RECEIPT");
    }
    if (signedReadShape(status, res.body)) {
      return check(id, "PASS", "signed-out link refused; in-process client read answered 200 with the words, the price and the consent state");
    }
    const code = res.body && typeof res.body.error === "string" ? ` (${clip(res.body.error, 60)})` : "";
    return check(
      id,
      "FAIL",
      `signed approve read answered ${status || "nothing"}${code} and not the approval read shape`,
      READ_FIX
    );
  } catch (err) {
    return check(id, "FAIL", `signed approve read threw: ${clip(err && err.message)}`, READ_FIX);
  }
}

/**
 * Soft-pull lane: the approve door (three rows), then the credit-pull ledger
 * (three rows). Everything runs at once, so the lane is as slow as its slowest
 * read, not the sum.
 * @param {{ fetchImpl?: Function, fetch?: Function, baseUrl?: string, db?: object, scope?: Function, orgId?: string, env?: object, now?: Date }} [ctx]
 * @returns {Promise<Array<{ id: string, status: string, detail: string, suggestedFix: string|null }>>}
 */
export async function gapChecks(ctx = {}) {
  const fetchImpl = ctx.fetchImpl || ctx.fetch;
  const baseUrl = ctx.baseUrl;
  const [page, read, signed, ledger, paidForm, noPull] = await Promise.all([
    checkApprovePage({ fetchImpl, baseUrl }),
    checkApproveRead({ fetchImpl, baseUrl }),
    checkApproveSignedRead(ctx),
    checkRequestFailedOrStuck(ctx),
    checkPaidFormNotFilled(ctx),
    checkApproveClickNoPull(ctx)
  ]);
  return [page, read, signed, ledger, paidForm, noPull];
}
