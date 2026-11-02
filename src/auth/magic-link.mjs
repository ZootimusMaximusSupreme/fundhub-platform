// Magic-link sign-in for the client portal.
//
// A client types their email, gets a link, clicks it, and is signed in. There
// is no password anywhere in this path — which is the point, because no screen
// in this repo has ever set a password on an `accounts` row, so the portal has
// had a working session mechanism (044_accounts.sql, account-session.mjs) and
// no way for a client to start one.
//
// IT REUSES THE SESSION PRIMITIVES RATHER THAN GROWING NEW ONES. Same
// newToken() (32 CSPRNG bytes), same hashToken() (sha256, stored instead of the
// token), same scrypt from hash.mjs, and the session it hands back is minted by
// createAccountSession() — the one that already exists. A second token format
// or a second session table is how one of them ends up weaker than the other.
//
// ── THE THREE PROPERTIES THIS FILE IS RESPONSIBLE FOR ──────────────────────
//
// 1. THE ANSWER IS THE SAME FOR AN ADDRESS WE KNOW AND ONE WE DO NOT.
//    requestMagicLink() returns { ok: true } for every well-formed address.
//    Not a different status, not a different message, not a different set of
//    fields. `outcome` is on the return value for the CALLER'S logs and the
//    endpoint does not put it in the response body — an HTTP handler that
//    forwards it turns this form into a membership oracle, which is the exact
//    thing loginAccount() already refuses to be.
//
//    It costs a row either way, too: an address that matches nothing still
//    writes a receipt. That is not bookkeeping, it is what makes the rate limit
//    apply to strangers as well as customers — see the limiter below.
//
// 2. A LINK WORKS ONCE. verifyMagicLink() claims the row with a single
//    UPDATE ... WHERE consumed_at IS NULL AND expires_at > now() ... RETURNING.
//    One statement, so two arrivals with the same token cannot both win: the
//    loser matches no row and gets the same null a forged token gets. A SELECT
//    followed by an UPDATE would let a link-scanning mail gateway and the human
//    who was sent the link both end up with a session.
//
// 3. REQUESTING A LINK CREATES NOTHING. The account is provisioned at
//    VERIFICATION, from the client record the link was bound to. If a request
//    could create an account, spraying addresses would populate `accounts`, and
//    a table of half-real customers is worse than the gap this closes.
//
// NOTHING HERE TRANSMITS. The email is handed to sendTemplated(), which writes
// a `messages` row with status='queued' and stops — dispatch is a separate,
// deliberately unscheduled act (CLAUDE.md §12, src/messaging/dispatch.mjs). So
// this module queues; it does not send, and it does not import a provider.

import { newToken, hashToken, normalizeIp } from "./session.mjs";
import { hashPassword } from "./hash.mjs";
import { resolveDefaultOrg } from "./org.mjs";
import { createAccountSession, verifyAccountSession } from "./account-session.mjs";
import { sendTemplated } from "../workflows/messaging.mjs";

/** How long a link is good for. Short because the whole point of a mailed
    credential is that it stops being one quickly; 15 minutes is long enough to
    switch to a phone and read the mail, short enough that a link sitting in an
    archived inbox is not a way in. */
export const LINK_TTL_MINUTES = 15;

/** Booking-confirm portal token. Owner 2026-08-23: a confirm email may be
    opened hours or days later, so that path uses 365 days. Still single-use.
    Self-service /api/auth/magic-link stays on LINK_TTL_MINUTES. */
export const BOOKING_CONFIRM_LINK_TTL_MINUTES = 365 * 24 * 60;

/** The template the email is written from. There IS a row for this key —
    db/seed/007_portal_magic_link_template.sql — because sendTemplated() is a
    silent no-op against a key with no row, and a sign-in email that quietly
    does not exist is indistinguishable, from the client's side, from a portal
    that is simply broken. */
export const MAGIC_LINK_TEMPLATE_KEY = "EMAIL-PORTAL-MAGIC-LINK";

/* How many requests an address, and a source address, may make.

   COUNTED FROM account_magic_links, NOT auth_attempts. The obvious reuse is
   checkRateLimit() in login.mjs, and it is the wrong tool twice over: it counts
   FAILED attempts, and asking for a link is not a failed anything — and worse,
   writing magic-link rows into auth_attempts would spend a real customer's
   password-login budget on requests they made successfully, locking them out of
   the other sign-in path by using this one. Separate counter, separate table. */
export const LINK_LIMITS = {
  windowMinutes: 15,
  maxPerEmail: 3,   // somebody hammering "resend" — or an inbox being flooded
  maxPerIp: 15      // one source working through a list of addresses
};

export const normalizeEmail = (email) =>
  typeof email === "string" ? email.trim().toLowerCase() : "";

const truncate = (s, n) => (s == null ? null : String(s).slice(0, n));

/* A deliberately loose shape check. It exists to reject "  " and "hello" before
   they cost a database round trip, not to decide what a valid address is —
   every real-world attempt to do the latter in a regex rejects somebody's
   actual mailbox. Anything that gets past this is answered identically to an
   address we know, so being generous here leaks nothing. */
const LOOKS_LIKE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** magicLinkUrl — where the emailed link points.

    It lands on the PAGE, not on the verification endpoint, and the token rides
    in the query of a static asset that the browser then POSTs and strips. The
    alternative — mailing the API endpoint directly — hands the single use to
    whatever opens the link first, and for a great many mailboxes that is a
    security scanner following every URL in the message. The client then clicks
    a link that has already been spent and is told their sign-in failed.

    PORTAL_BASE_URL names the site. Netlify sets URL on a production build and
    DEPLOY_PRIME_URL on a preview, so a deploy that sets neither of ours still
    mails a link to itself rather than to the wrong host. */
export function magicLinkUrl(token, env = process.env, { bookingClaim = false } = {}) {
  return `${portalBase(env)}/portal-login.html?t=${encodeURIComponent(token)}` +
    (bookingClaim ? "&booking_claim=1" : "");
}

/** portalLoginUrl — the same page with NO token on it.

    THIS IS THE FALLBACK, AND IT EXISTS BECAUSE THE ALTERNATIVE IS A BLANK LINK.
    renderTemplate() replaces an absent {{magic_link.url}} with the empty string
    (src/lib/render-template.mjs), so a template that says "here is your link"
    and is handed no link renders `<a href=""></a>` — a sentence promising a
    door followed by nothing. Walk finding F2, 2026-09-03.

    A tokenless link is not as good as a token: the client has to type their
    address and wait for a second mail. It is enormously better than nothing,
    because portal-login.html's whole job is to mail them a working one. Any
    caller that cannot mint a token sends this instead of sending a hole. */
export function portalLoginUrl(env = process.env) {
  return `${portalBase(env)}/portal-login.html`;
}

/* PORTAL_BASE_URL names the site. Netlify sets URL on a production build and
   DEPLOY_PRIME_URL on a preview, so a deploy that sets neither of ours still
   points at itself rather than at the wrong host. */
export function portalBase(env = process.env) {
  return String(
    env.PORTAL_BASE_URL || env.DEPLOY_PRIME_URL || env.URL || "https://fundhub.ai"
  ).replace(/\/+$/, "");
}

/* ── REQUEST ────────────────────────────────────────────────────────────── */

/** requestMagicLink — an address in, a uniform answer out.

    Always { ok: true, outcome, limited: false } for a well-formed address, or
    { ok: true, limited: true } when the limiter says stop. `outcome` is for the
    caller's own logs and MUST NOT reach the response body.

    { ok: false, error: "email_required" } is the one refusal, and it is safe:
    it says the field was empty or malformed, which the caller already knows. */
export async function requestMagicLink(db, {
  email, ip, userAgent, orgId, env = process.env,
  ttlMinutes = LINK_TTL_MINUTES,
  queueEmail = true,
  bookingClaim = false,
  /* Optional stable id for sendTemplated's provider_ref. Pay / webhook
     callers pass one so a replayed event cannot queue a second mail.
     Self-service leave this unset — each request is its own send. */
  eventId = null
} = {}) {
  const mail = normalizeEmail(email);
  if (!mail || !LOOKS_LIKE_EMAIL.test(mail)) {
    return { ok: false, status: 400, error: "email_required" };
  }

  const org = orgId || (await resolveDefaultOrg(db));
  const addr = normalizeIp(ip);

  /* THE LIMIT IS CHECKED BEFORE THE ADDRESS IS LOOKED UP, on purpose. Doing it
     after would make a throttled response possible only for addresses that
     resolve to something, and "this address can be rate limited" is precisely
     the fact the uniform 200 is hiding. */
  const limit = await checkLinkRate(db, { orgId: org, email: mail, ip: addr });
  if (limit.limited) {
    return { ok: true, limited: true, retryAfterMinutes: limit.retryAfterMinutes };
  }

  const subject = await resolveLinkSubject(db, org, mail);

  // Nothing to sign in as. A receipt row, no token, and the same answer.
  if (subject.outcome !== "issued") {
    await db.query(
      `INSERT INTO account_magic_links
         (org_id, email, account_id, client_id, outcome, requested_ip, requested_user_agent)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [org, mail, subject.accountId, subject.clientId, subject.outcome,
       addr, truncate(userAgent, 512)]
    );
    return { ok: true, limited: false, outcome: subject.outcome, sent: false };
  }

  const token = newToken();
  const ttl = Number(ttlMinutes);
  const minutes = Number.isFinite(ttl) && ttl > 0 ? ttl : LINK_TTL_MINUTES;
  const expiresAt = new Date(Date.now() + minutes * 60 * 1000);
  const ins = await db.query(
    `INSERT INTO account_magic_links
       (org_id, email, account_id, client_id, token_hash, expires_at, outcome,
        requested_ip, requested_user_agent)
     VALUES ($1,$2,$3,$4,$5,$6,'issued',$7,$8)
     RETURNING id`,
    [org, mail, subject.accountId, subject.clientId, hashToken(token), expiresAt,
     addr, truncate(userAgent, 512)]
  );

  /* THE EMAIL IS QUEUED, NOT SENT — see the header. eventId is the link row's
     id, which makes the provider_ref sendTemplated synthesises unique per
     request, so two links asked for a minute apart queue two messages rather
     than the second deduping into the first and never arriving.

     The rendered body carries the URL, and therefore the cleartext token. That
     is what an email is; it is the one place the token is written down, and it
     is why the link expires in minutes and dies on first use. */
  const url = magicLinkUrl(token, env, { bookingClaim });
  let sent = false;
  if (queueEmail) {
    const queued = await sendTemplated(db, {
      orgId: org,
      clientId: subject.clientId,
      channel: "email",
      templateKey: MAGIC_LINK_TEMPLATE_KEY,
      eventId: eventId || `magic-link:${ins.rows[0].id}`,
      context: {
        magic_link: {
          url,
          expires_minutes: String(minutes)
        }
      }
    });
    sent = queued.sent === true;
  }

  return {
    ok: true,
    limited: false,
    outcome: "issued",
    sent,
    // For tests and for a caller that has to relay a link by hand. No endpoint
    // puts this in a response body; api/auth/magic-link.mjs does not read it.
    token,
    linkId: ins.rows[0].id,
    expiresAt
  };
}

/** issuePortalLinkForClient — a sign-in link for a client WE already know.

    requestMagicLink() is written for a stranger typing an address into a form,
    so it answers everybody identically and never says whether the address
    matched. That is right there and wrong here: both callers of this function
    are holding a `clients` row already, and "did the client get a link?" is a
    question they are entitled to an answer to.

      · api/soft-pull-approve.mjs — the account is created at purchase, and
        before this nothing ever handed the client a credential for it. Walk
        finding F31, 2026-09-03: every buyer got an active portal account they
        could never sign into.
      · the owner/admin "send portal sign-in link" action, because the reset
        screen tells clients to ask an admin for one.

    NO NEW ISSUING MACHINERY. It looks the address up and calls
    requestMagicLink, so the TTL, the single use, the hash-only storage, the
    rate limit and the queued email are all the ones already proven — a second
    path that mints its own tokens is how one of them ends up weaker.

    THE RATE LIMIT STILL APPLIES, and that is deliberate: an admin leaning on
    the button is exactly the flood the limit is for. `limited` comes back true
    so the caller can say so rather than reporting a send that did not happen.

      → { ok: true, sent, outcome, url, expiresAt }   a link exists
      → { ok: true, sent: false, limited: true }      asked too often, just now
      → { ok: false, reason }                         no client, or no address */
export async function issuePortalLinkForClient(db, {
  orgId, clientId, ttlMinutes = LINK_TTL_MINUTES, queueEmail = true,
  ip, userAgent, env = process.env, eventId = null
} = {}) {
  if (!clientId) return { ok: false, reason: "client_required" };

  const org = orgId || (await resolveDefaultOrg(db));
  const r = await db.query(
    `SELECT email FROM clients WHERE id = $1 AND org_id = $2`, [clientId, org]);
  const email = r.rows[0]?.email || null;
  if (!email) return { ok: false, reason: "no_email_on_file" };

  const out = await requestMagicLink(db, {
    email, orgId: org, ip, userAgent, env, ttlMinutes, queueEmail, eventId
  });
  if (!out.ok) return { ok: false, reason: out.error || "request_failed" };
  if (out.limited) return { ok: true, sent: false, limited: true, retryAfterMinutes: out.retryAfterMinutes };
  if (!out.token) return { ok: true, sent: false, outcome: out.outcome || "no_account" };

  return {
    ok: true,
    sent: out.sent === true,
    outcome: "issued",
    url: magicLinkUrl(out.token, env),
    expiresAt: out.expiresAt
  };
}

/* checkLinkRate — how many requests recently, by address and by source.

   Counts rows in account_magic_links, which is every request including the ones
   that matched nothing. Exported so an endpoint can set Retry-After. */
export async function checkLinkRate(db, { orgId, email, ip, limits = LINK_LIMITS } = {}) {
  const r = await db.query(
    `SELECT
       (SELECT count(*) FROM account_magic_links m
         WHERE m.org_id = $1 AND m.email = $2
           AND m.created_at > now() - ($4::int * interval '1 minute'))::int AS email_count,
       (SELECT count(*) FROM account_magic_links m
         WHERE m.org_id = $1
           AND $3::inet IS NOT NULL AND m.requested_ip = $3::inet
           AND m.created_at > now() - ($4::int * interval '1 minute'))::int AS ip_count`,
    [orgId, normalizeEmail(email), normalizeIp(ip), limits.windowMinutes]
  );
  const emailCount = Number(r.rows[0].email_count);
  const ipCount = Number(r.rows[0].ip_count);
  return {
    limited: emailCount >= limits.maxPerEmail || ipCount >= limits.maxPerIp,
    emailCount,
    ipCount,
    retryAfterMinutes: limits.windowMinutes
  };
}

/* resolveLinkSubject — what, if anything, this address may sign in as.

   THREE ANSWERS, and the middle one is the auto-provisioning case:

     an account exists       → issue against it
     no account, but a       → issue against the CLIENT. The account is created
     `clients` row matches      at verification, not now.
     neither                 → no_account, no token, same reply

   CLIENT PRINCIPALS ONLY. An affiliate or partner account is refused here
   (not_eligible) rather than mailed a link. Both are commercial relationships
   that arrive by invitation — 044's signup policy makes 'partner' invite-only
   at the table level for exactly that reason — and a portal sign-in path that
   also opens the partner book is a bigger decision than this unit. They sign in
   with a password today, which still works, and nothing here removes it. */
async function resolveLinkSubject(db, orgId, email) {
  const acct = await db.query(
    `SELECT id, kind, client_id, status FROM accounts
      WHERE org_id = $1 AND lower(email) = $2 LIMIT 1`, [orgId, email]);

  if (acct.rows[0]) {
    const a = acct.rows[0];
    // A suspended account is refused, and refused SILENTLY — the caller still
    // gets the uniform reply. Telling somebody their account is suspended is
    // telling them it exists.
    if (a.status === "suspended" || (a.kind !== "client" && a.kind !== "authorized_rep")) {
      return { outcome: "not_eligible", accountId: a.id, clientId: a.client_id };
    }
    if (a.kind === "authorized_rep") {
      const file = await db.query(
        `SELECT client_id FROM client_authorized_reps
          WHERE account_id = $1 AND removed_at IS NULL
          ORDER BY created_at ASC, client_id ASC
          LIMIT 1`,
        [a.id]
      );
      if (!file.rows[0]) {
        return { outcome: "not_eligible", accountId: a.id, clientId: null };
      }
      return { outcome: "issued", accountId: a.id, clientId: file.rows[0].client_id };
    }
    return { outcome: "issued", accountId: a.id, clientId: a.client_id };
  }

  /* No account. Is there a client record with this address? LIMIT 1 with a
     deterministic order because `clients` has no unique index on email and two
     rows can share one; the oldest is the one a person would call the real
     record, and picking it the same way every time means a second request
     resolves to the same subject as the first. */
  const cli = await db.query(
    `SELECT id FROM clients
      WHERE org_id = $1 AND lower(email) = $2
      ORDER BY created_at ASC, id ASC LIMIT 1`, [orgId, email]);

  if (cli.rows[0]) {
    return { outcome: "issued", accountId: null, clientId: cli.rows[0].id };
  }
  return { outcome: "no_account", accountId: null, clientId: null };
}

/* ── VERIFY ─────────────────────────────────────────────────────────────── */

/** verifyMagicLink — a token in, an account session out.

    → { ok: true, token, expiresAt, principal }   the session token, once
    → { ok: false, status: 400|401, error }        anything else

    EVERY FAILURE IS THE SAME FAILURE. A forged token, an expired one, one
    already used, and one whose account was suspended after the link was sent
    all answer 401 invalid_link. Distinguishing them tells whoever is holding a
    token something about it that they did not already know. */
export async function verifyMagicLink(db, token, {
  ip, userAgent, env = process.env
} = {}) {
  if (!token || typeof token !== "string") {
    return { ok: false, status: 400, error: "token_required" };
  }

  /* THE CLAIM. One statement, so single use is a database guarantee rather than
     a promise about how fast this function runs. Expiry and prior consumption
     are both in the WHERE, so an expired link and a spent link are the same
     empty result — and the row is stamped consumed even though the account may
     not exist yet, because a link that has been presented is spent whatever
     happens next. */
  const claim = await db.query(
    `UPDATE account_magic_links
        SET consumed_at = now(), consumed_ip = $2, consumed_user_agent = $3
      WHERE token_hash = $1
        AND consumed_at IS NULL
        AND expires_at > now()
      RETURNING id, org_id, email, account_id, client_id`,
    [hashToken(token), normalizeIp(ip), truncate(userAgent, 512)]
  );
  const link = claim.rows[0];
  if (!link) return { ok: false, status: 401, error: "invalid_link" };

  const accountId = link.account_id
    ? await existingActiveAccount(db, link.account_id)
    : await provisionClientAccount(db, link);

  if (!accountId) return { ok: false, status: 401, error: "invalid_link" };

  const session = await createAccountSession(db, {
    accountId, orgId: link.org_id, ip, userAgent, env
  });
  await db.query(`UPDATE accounts SET last_login_at = now() WHERE id = $1`, [accountId]);
  const verified = await verifyAccountSession(db, session.token, { env });
  if (!verified) return { ok: false, status: 401, error: "invalid_link" };

  return {
    ok: true,
    token: session.token,
    expiresAt: session.expiresAt,
    principal: verified.principal
  };
}

/* The link named an account. It still has to be one that may sign in RIGHT NOW
   — suspension between the mail going out and the link being clicked is exactly
   the window this re-read closes. Returning null lands on invalid_link. */
async function existingActiveAccount(db, accountId) {
  const r = await db.query(
    `SELECT id FROM accounts
      WHERE id = $1 AND status = 'active' AND kind IN ('client', 'authorized_rep')`,
    [accountId]);
  if (r.rows[0]) return r.rows[0].id;

  /* An 'invited' client account is ACTIVATED by clicking the link, and that is
     the honest reading of an invite: the address has now been proven to reach
     the person. It needs a password_hash to be active (044's
     accounts_active_needs_hash) and it does not have one, so it gets the same
     unguessable one a provisioned account gets — see provisionClientAccount. */
  const inv = await db.query(
    `SELECT id FROM accounts
      WHERE id = $1 AND status = 'invited' AND kind IN ('client', 'authorized_rep')`,
    [accountId]);
  if (!inv.rows[0]) return null;

  const act = await db.query(
    `UPDATE accounts
        SET status = 'active',
            password_hash = COALESCE(password_hash, $2),
            activated_at = COALESCE(activated_at, now())
      WHERE id = $1 AND status = 'invited'
      RETURNING id`,
    [accountId, await unguessableHash()]);
  return act.rows[0] ? act.rows[0].id : null;
}

/* AUTO-PROVISIONING. The address matched a client record and no account, so the
   account is created here — at verification, once the link has proved the
   address reaches whoever asked.

   'client' self-signs-up under 044's policy table, so no inviter is needed and
   the 044 trigger is satisfied. The INSERT is written to lose gracefully: two
   links verified at the same instant would both try to create the account, and
   accounts_client_uniq means the second raises. ON CONFLICT DO NOTHING plus the
   re-read turns that race into "both got the same account", which is the right
   answer, instead of a 500 on a valid link.

   NO CONFLICT TARGET, deliberately. Two unique indexes can catch this insert —
   accounts_client_uniq and accounts_email_uniq — and naming one of them leaves
   the other raising. An untargeted DO NOTHING covers both, and the re-read
   below is what decides the outcome either way. */
async function provisionClientAccount(db, link) {
  if (!link.client_id) return null;

  const cli = await db.query(
    `SELECT first_name, last_name FROM clients WHERE id = $1`, [link.client_id]);
  const c = cli.rows[0];
  if (!c) return null;
  const name = [c.first_name, c.last_name].filter(Boolean).join(" ") || null;

  await db.query(
    `INSERT INTO accounts
       (org_id, kind, email, name, password_hash, status, client_id, activated_at)
     VALUES ($1,'client',$2,$3,$4,'active',$5, now())
     ON CONFLICT DO NOTHING`,
    [link.org_id, link.email, name, await unguessableHash(), link.client_id]);

  const r = await db.query(
    `SELECT id FROM accounts WHERE client_id = $1 AND status = 'active'`,
    [link.client_id]);
  return r.rows[0] ? r.rows[0].id : null;
}

/* A password_hash nobody holds.

   044's accounts_active_needs_hash requires one on an active account, and it is
   right to: it means "an active row is authenticatable", and that sentence is
   worth keeping. This satisfies it truthfully rather than by dropping the
   check. The cleartext is 32 CSPRNG bytes, it is used once as an argument, and
   it is unreachable the moment this function returns — so the row really does
   hold a credential, and password sign-in against it is a 2^-256 event rather
   than a rule somebody has to remember to enforce.

   It is not a lockout: a client who wants a password gets one the ordinary way. */
async function unguessableHash() {
  return hashPassword(newToken());
}
