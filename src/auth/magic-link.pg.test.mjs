// Magic link, against a real Postgres. Skipped without DATABASE_URL.
//
// This is where the properties that matter are actually proved, because every
// one of them is a property of the DATABASE and not of the JavaScript: single
// use is an UPDATE ... WHERE consumed_at IS NULL, expiry is a WHERE clause, the
// rate limit is a count of rows, and auto-provisioning is an INSERT that has to
// survive a unique index. A mocked db object would let all four pass while the
// real thing was broken.

import { test, before, beforeEach, after, describe } from "node:test";
import assert from "node:assert/strict";
import { db, close } from "../db.mjs";
import {
  requestMagicLink, verifyMagicLink, checkLinkRate,
  LINK_LIMITS, LINK_TTL_MINUTES, BOOKING_CONFIRM_LINK_TTL_MINUTES,
  MAGIC_LINK_TEMPLATE_KEY
} from "./magic-link.mjs";
import { createAccount, verifyAccountSession } from "./account-session.mjs";
import { resolvePrincipal } from "../http/middleware/requirePrincipal.mjs";

const HAVE_DB = !!process.env.DATABASE_URL;
const TAG = "magiclink-test";
const PW = "magic-link-password-for-tests";

/* Distinct source addresses per test, because the limiter counts by IP as well
   as by email and a shared fixture IP would make unrelated tests throttle each
   other in whatever order the runner happened to pick. */
const IP = { a: "203.0.113.10", b: "203.0.113.11", c: "203.0.113.12" };

describe("portal magic-link sign-in", { skip: !HAVE_DB ? "no DATABASE_URL" : false }, () => {
  let org;

  before(async () => {
    org = (await db.query(`SELECT id FROM orgs WHERE is_default LIMIT 1`)).rows[0].id;

    /* THE TEMPLATE IS ENSURED HERE, NOT ASSUMED. db/seed/007 installs it, but
       src/messaging/seed/seed.pg.test.mjs begins by DELETEing every template
       row for this org before re-seeding from the source docs — so whether this
       row exists when these tests run depends on file order, which is not a
       thing to depend on. The INSERT is the seed file's own, and it is a no-op
       when the row is already there. */
    await db.query(
      `INSERT INTO message_templates (org_id, template_key, channel, subject, body, compliance_passed)
       VALUES ($1, $2, 'email', 'Your Fundhub sign-in link',
               'Hi {{contact.first_name}}, sign in: {{magic_link.url}} (expires in {{magic_link.expires_minutes}} minutes)',
               true)
       ON CONFLICT (org_id, template_key) DO NOTHING`,
      [org, MAGIC_LINK_TEMPLATE_KEY]);
  });

  /* CLEAN UP AT THE END, NOT JUST AT THE START.
     beforeEach(wipe) keeps these tests honest with each other, but it leaves the
     LAST test's rows behind — and one of those rows is a `messages` row with
     status='queued'. src/messaging/cutover-acceptance.pg.test.mjs calls
     dispatchDue(), which claims every due message in the ORG, not just its own
     client's, so a stray queued row from this file makes that file's send count
     come out one too high and fails a test that has nothing to do with sign-in.
     Tests share one database; leaving a queued message in it is leaving a
     landmine for whichever file runs next. */
  after(async () => {
    if (!HAVE_DB) return;
    await wipe();
    await close();
  });

  async function wipe() {
    await db.query(`DELETE FROM account_magic_links WHERE email LIKE $1`, [`${TAG}%`]);
    await db.query(`DELETE FROM messages WHERE template_key = $1 AND client_id IN
                     (SELECT id FROM clients WHERE first_name = $2)`, [MAGIC_LINK_TEMPLATE_KEY, TAG]);
    await db.query(`DELETE FROM account_sessions WHERE account_id IN
                     (SELECT id FROM accounts WHERE email LIKE $1)`, [`${TAG}%`]);
    await db.query(`DELETE FROM accounts WHERE email LIKE $1`, [`${TAG}%`]);
    await db.query(`DELETE FROM events WHERE client_id IN
                     (SELECT id FROM clients WHERE first_name = $1)`, [TAG]);
    await db.query(`DELETE FROM messages WHERE client_id IN
                     (SELECT id FROM clients WHERE first_name = $1)`, [TAG]);
    await db.query(`DELETE FROM clients WHERE first_name = $1`, [TAG]);
  }

  const mkClient = async (email, first = TAG, last = "Portal") => (await db.query(
    `INSERT INTO clients (org_id, first_name, last_name, email) VALUES ($1,$2,$3,$4) RETURNING id`,
    [org, first, last, email])).rows[0].id;

  beforeEach(wipe);

  /* ── ISSUING ──────────────────────────────────────────────────────────── */

  describe("asking for a link", () => {
    test("a known client gets a token, a hashed row, and a queued email", async () => {
      const email = `${TAG}-known@x.io`;
      const clientId = await mkClient(email);

      const out = await requestMagicLink(db, { email, ip: IP.a, userAgent: "probe/1" });
      assert.equal(out.ok, true);
      assert.equal(out.outcome, "issued");
      assert.equal(out.sent, true, "the email was not queued — is the template row missing?");
      assert.ok(out.token, "no token was minted");

      const row = (await db.query(
        `SELECT * FROM account_magic_links WHERE id = $1`, [out.linkId])).rows[0];
      assert.equal(row.email, email);
      assert.equal(row.client_id, clientId);
      assert.equal(row.outcome, "issued");
      assert.equal(row.consumed_at, null);
      assert.equal(row.requested_ip, IP.a);

      // THE TOKEN IS NOT IN THE DATABASE. Only its sha256 is — the same
      // discipline sessions and account_sessions keep, and the reason a leaked
      // backup yields no usable links.
      assert.ok(row.token_hash);
      assert.notEqual(row.token_hash, out.token);
      assert.ok(!JSON.stringify(row).includes(out.token), "the cleartext token was stored");

      // Expiry is 12 months away (owner-set 2026-11-07: 12 months, one use), not 15 minutes.
      const minutes = (new Date(row.expires_at) - Date.now()) / 60000;
      assert.ok(minutes > LINK_TTL_MINUTES - 2 && minutes <= LINK_TTL_MINUTES + 1,
        `expiry is ${minutes} minutes away`);
    });

    test("the queued message is real, addressed, and carries the working link", async () => {
      // This is the "message row is created with a real template" half of the
      // definition of done. sendTemplated is a SILENT no-op against a key with
      // no row, so a passing token test proves nothing about the email.
      const email = `${TAG}-mail@x.io`;
      await mkClient(email, TAG, "Reader");

      const out = await requestMagicLink(db, { email, ip: IP.b });
      const msg = (await db.query(
        `SELECT * FROM messages WHERE template_key = $1 AND to_address = $2
          ORDER BY created_at DESC LIMIT 1`, [MAGIC_LINK_TEMPLATE_KEY, email])).rows[0];

      assert.ok(msg, "no message row was written");
      assert.equal(msg.channel, "email");
      assert.equal(msg.direction, "outbound");
      assert.equal(msg.status, "queued");
      assert.equal(msg.to_address, email);
      assert.ok(msg.subject, "the email has no subject line");

      // The merge tags actually resolved — no braces survived into the copy.
      assert.ok(msg.rendered_body.includes(out.token), "the link in the email is not this token");
      assert.ok(msg.rendered_body.includes("/portal-login.html?t="), "the link does not point at the page");
      assert.ok(!msg.rendered_body.includes("{{"), `an unrendered merge tag shipped: ${msg.rendered_body}`);
      assert.ok(msg.rendered_body.includes(String(LINK_TTL_MINUTES)), "the expiry is not stated in the email");
    });

    test("booking-confirm TTL is 365 days and does not queue EMAIL-PORTAL-MAGIC-LINK", async () => {
      const email = `${TAG}-book365@x.io`;
      await mkClient(email);
      const out = await requestMagicLink(db, {
        email, ip: IP.a,
        ttlMinutes: BOOKING_CONFIRM_LINK_TTL_MINUTES,
        queueEmail: false
      });
      assert.equal(out.ok, true);
      assert.equal(out.outcome, "issued");
      assert.equal(out.sent, false);
      assert.ok(out.token);

      const row = (await db.query(
        `SELECT expires_at FROM account_magic_links WHERE id = $1`, [out.linkId])).rows[0];
      const minutes = (new Date(row.expires_at) - Date.now()) / 60000;
      assert.ok(
        minutes > BOOKING_CONFIRM_LINK_TTL_MINUTES - 30
          && minutes <= BOOKING_CONFIRM_LINK_TTL_MINUTES + 1,
        `expiry is ${minutes} minutes away`
      );

      const { rows } = await db.query(
        `SELECT count(*)::int AS n FROM messages WHERE template_key = $1 AND to_address = $2`,
        [MAGIC_LINK_TEMPLATE_KEY, email]);
      assert.equal(rows[0].n, 0);
    });

    test("QUEUED, NOT SENT — nothing in this path transmits", async () => {
      // CLAUDE.md §12: the dispatcher is deliberately unscheduled and this unit
      // does not change that. If a future edit hands the row to a provider, the
      // status stops being 'queued' and this fails, which is the point.
      const email = `${TAG}-noxmit@x.io`;
      await mkClient(email);
      await requestMagicLink(db, { email, ip: IP.c });
      const { rows } = await db.query(
        `SELECT status, provider FROM messages WHERE template_key = $1 AND to_address = $2`,
        [MAGIC_LINK_TEMPLATE_KEY, email]);
      assert.equal(rows.length, 1);
      assert.equal(rows[0].status, "queued");
      assert.equal(rows[0].provider, "internal");
    });

    test("two requests queue two emails rather than deduping into one", async () => {
      // sendTemplated dedupes on provider_ref, which is synthesised from the
      // eventId we pass. Passing anything constant would mean the second link a
      // client asks for is minted and never mailed — the worst kind of failure,
      // because the token exists and the client never receives it.
      const email = `${TAG}-twice@x.io`;
      await mkClient(email);
      await requestMagicLink(db, { email, ip: IP.a });
      await requestMagicLink(db, { email, ip: IP.a });
      const { rows } = await db.query(
        `SELECT count(*)::int AS n FROM messages WHERE template_key = $1 AND to_address = $2`,
        [MAGIC_LINK_TEMPLATE_KEY, email]);
      assert.equal(rows[0].n, 2);
    });
  });

  /* ── NO ACCOUNT ENUMERATION ───────────────────────────────────────────── */

  describe("an address we do not know", () => {
    test("gets the same answer shape as one we do", async () => {
      const known = `${TAG}-e-known@x.io`;
      await mkClient(known);

      const hit = await requestMagicLink(db, { email: known, ip: IP.a });
      const miss = await requestMagicLink(db, { email: `${TAG}-e-nobody@x.io`, ip: IP.b });

      // Same ok, same limited, same absence of any field naming the difference.
      assert.equal(hit.ok, true);
      assert.equal(miss.ok, true);
      assert.equal(hit.limited, false);
      assert.equal(miss.limited, false);
      assert.equal(miss.token, undefined, "a token was minted for an unknown address");

      // `outcome` DOES differ — it is the caller's log line. The guarantee is
      // that api/auth/magic-link.mjs never puts it in a response, which
      // src/http/magic-link-endpoints.pg.test.mjs proves against the handler.
      assert.equal(hit.outcome, "issued");
      assert.equal(miss.outcome, "no_account");
    });

    test("still writes a row, so the limiter applies to strangers too", async () => {
      // Without this, only real customers could ever be throttled — and
      // "throttled or not" would itself answer "is this address a client?".
      const email = `${TAG}-e-receipt@x.io`;
      await requestMagicLink(db, { email, ip: IP.c });

      const row = (await db.query(
        `SELECT * FROM account_magic_links WHERE email = $1`, [email])).rows[0];
      assert.ok(row, "no receipt row was written for an unknown address");
      assert.equal(row.outcome, "no_account");
      // A receipt carries no secret, because none was minted.
      assert.equal(row.token_hash, null);
      assert.equal(row.expires_at, null);
      assert.equal(row.account_id, null);
      assert.equal(row.client_id, null);
    });

    test("no message is queued to an address with no portal", async () => {
      const email = `${TAG}-e-nomail@x.io`;
      await requestMagicLink(db, { email, ip: IP.a });
      const { rows } = await db.query(
        `SELECT count(*)::int AS n FROM messages WHERE to_address = $1`, [email]);
      assert.equal(rows[0].n, 0);
    });

    test("an affiliate account is refused silently, not mailed a client link", async () => {
      const email = `${TAG}-e-aff@x.io`;
      const affId = (await db.query(
        `INSERT INTO affiliates (org_id,name,status) VALUES ($1,$2,'active') RETURNING id`,
        [org, `${TAG}-aff`])).rows[0].id;
      await createAccount(db, { orgId: org, kind: "affiliate", email, password: PW, affiliateId: affId });

      const out = await requestMagicLink(db, { email, ip: IP.b });
      assert.equal(out.ok, true);              // same answer as everybody else
      assert.equal(out.outcome, "not_eligible");
      assert.equal(out.token, undefined);

      await db.query(`DELETE FROM accounts WHERE email = $1`, [email]);
      await db.query(`DELETE FROM affiliates WHERE id = $1`, [affId]);
    });
  });

  /* ── RATE LIMITING ────────────────────────────────────────────────────── */

  describe("rate limiting", () => {
    test("an address is cut off after LINK_LIMITS.maxPerEmail requests", async () => {
      const email = `${TAG}-rl@x.io`;
      await mkClient(email);
      for (let i = 0; i < LINK_LIMITS.maxPerEmail; i++) {
        const out = await requestMagicLink(db, { email, ip: `198.51.100.${i + 1}` });
        assert.equal(out.limited, false, `request ${i + 1} was throttled early`);
      }
      const blocked = await requestMagicLink(db, { email, ip: "198.51.100.200" });
      assert.equal(blocked.limited, true);
      assert.equal(blocked.ok, true, "a throttled caller must still get ok:true — see the endpoint");
      assert.ok(blocked.retryAfterMinutes > 0);
    });

    test("a throttled request mints nothing and mails nothing", async () => {
      const email = `${TAG}-rl2@x.io`;
      await mkClient(email);
      for (let i = 0; i < LINK_LIMITS.maxPerEmail; i++) {
        await requestMagicLink(db, { email, ip: `198.51.100.${i + 1}` });
      }
      const before = (await db.query(
        `SELECT count(*)::int AS n FROM account_magic_links WHERE email = $1`, [email])).rows[0].n;
      await requestMagicLink(db, { email, ip: "198.51.100.201" });
      const after = (await db.query(
        `SELECT count(*)::int AS n FROM account_magic_links WHERE email = $1`, [email])).rows[0].n;
      assert.equal(after, before, "a throttled request still wrote a row");
    });

    test("one source spraying many addresses is cut off by the IP limit", async () => {
      const sprayIp = "198.51.100.77";
      for (let i = 0; i < LINK_LIMITS.maxPerIp; i++) {
        await requestMagicLink(db, { email: `${TAG}-spray${i}@x.io`, ip: sprayIp });
      }
      const blocked = await requestMagicLink(db, { email: `${TAG}-spray-last@x.io`, ip: sprayIp });
      assert.equal(blocked.limited, true);
    });

    test("the counter counts unknown addresses, not just real ones", async () => {
      // The property that makes the throttle useless as an oracle.
      const email = `${TAG}-rl-unknown@x.io`;
      for (let i = 0; i < LINK_LIMITS.maxPerEmail; i++) {
        await requestMagicLink(db, { email, ip: `198.51.100.${100 + i}` });
      }
      const rate = await checkLinkRate(db, { orgId: org, email, ip: null });
      assert.equal(rate.limited, true);
      assert.equal(rate.emailCount, LINK_LIMITS.maxPerEmail);
    });
  });

  /* ── VERIFYING ────────────────────────────────────────────────────────── */

  describe("clicking the link", () => {
    test("a valid link becomes a working account session", async () => {
      const email = `${TAG}-v-ok@x.io`;
      const clientId = await mkClient(email, TAG, "Verified");
      const acct = await createAccount(db, {
        orgId: org, kind: "client", email, password: PW, clientId });

      const issued = await requestMagicLink(db, { email, ip: IP.a });
      const out = await verifyMagicLink(db, issued.token, { ip: IP.a, userAgent: "probe/1" });

      assert.equal(out.ok, true);
      assert.equal(out.principal.kind, "client");
      assert.equal(out.principal.accountId, acct.id);
      assert.equal(out.principal.clientId, clientId);

      // The session it hands back is a REAL one — the same verifier every gated
      // endpoint uses accepts it, which is the whole point of reusing
      // createAccountSession rather than inventing a second session shape.
      const seen = await verifyAccountSession(db, out.token, {});
      assert.ok(seen, "the session token does not verify");
      assert.equal(seen.principal.accountId, acct.id);

      // And the request middleware resolves it as a client principal, which is
      // what /api/auth/session projects for the portal shell to gate on.
      const who = await resolvePrincipal(
        { headers: { authorization: `Bearer ${out.token}` } }, { db });
      assert.equal(who.kind, "client");
      assert.equal(who.clientId, clientId);

      // last_login_at is stamped, same as the password path does.
      const a = (await db.query(`SELECT last_login_at FROM accounts WHERE id = $1`, [acct.id])).rows[0];
      assert.ok(a.last_login_at, "last_login_at was not stamped");
    });

    test("SINGLE USE — the second exchange of the same link fails", async () => {
      const email = `${TAG}-v-once@x.io`;
      const clientId = await mkClient(email);
      await createAccount(db, { orgId: org, kind: "client", email, password: PW, clientId });

      const issued = await requestMagicLink(db, { email, ip: IP.b });
      const first = await verifyMagicLink(db, issued.token, { ip: IP.b });
      assert.equal(first.ok, true);

      const second = await verifyMagicLink(db, issued.token, { ip: IP.b });
      assert.equal(second.ok, false);
      assert.equal(second.status, 401);
      assert.equal(second.error, "invalid_link");

      // Exactly one session came out of one link.
      const n = (await db.query(
        `SELECT count(*)::int AS n FROM account_sessions WHERE account_id IN
          (SELECT id FROM accounts WHERE email = $1)`, [email])).rows[0].n;
      assert.equal(n, 1);
    });

    test("SINGLE USE holds when two exchanges race", async () => {
      // The property the one-statement claim exists for. A SELECT-then-UPDATE
      // would let both of these win.
      const email = `${TAG}-v-race@x.io`;
      const clientId = await mkClient(email);
      await createAccount(db, { orgId: org, kind: "client", email, password: PW, clientId });

      const issued = await requestMagicLink(db, { email, ip: IP.c });
      const both = await Promise.all([
        verifyMagicLink(db, issued.token, { ip: IP.c }),
        verifyMagicLink(db, issued.token, { ip: IP.c })
      ]);
      assert.equal(both.filter((r) => r.ok).length, 1, "both racers got a session");
    });

    test("EXPIRY — a link past its deadline is refused", async () => {
      const email = `${TAG}-v-exp@x.io`;
      const clientId = await mkClient(email);
      await createAccount(db, { orgId: org, kind: "client", email, password: PW, clientId });

      const issued = await requestMagicLink(db, { email, ip: IP.a });
      // Age it in the database rather than sleeping: the deadline is enforced by
      // a WHERE clause against now(), so moving the row is the honest test.
      await db.query(
        `UPDATE account_magic_links SET expires_at = now() - interval '1 second' WHERE id = $1`,
        [issued.linkId]);

      const out = await verifyMagicLink(db, issued.token, { ip: IP.a });
      assert.equal(out.ok, false);
      assert.equal(out.error, "invalid_link");

      // An expired link is NOT marked consumed — it was never used. The row
      // still reads as "issued, never clicked", which is what happened.
      const row = (await db.query(
        `SELECT consumed_at FROM account_magic_links WHERE id = $1`, [issued.linkId])).rows[0];
      assert.equal(row.consumed_at, null);
    });

    test("12 MONTHS — a link clicked on day 364 works once; on day 366 it is refused", async () => {
      // owner-set 2026-11-07: 12 months, one use. Moving the link 364 or 366
      // days back in the database is the same as clicking it that many days
      // after it was sent, because the deadline is a WHERE clause against now().
      const aged = async (tag, days) => {
        const email = `${TAG}-v-${tag}@x.io`;
        const clientId = await mkClient(email);
        await createAccount(db, { orgId: org, kind: "client", email, password: PW, clientId });
        const issued = await requestMagicLink(db, { email, ip: IP.c });
        await db.query(
          `UPDATE account_magic_links
              SET created_at = created_at - make_interval(days => $2::int),
                  expires_at = expires_at - make_interval(days => $2::int)
            WHERE id = $1`,
          [issued.linkId, days]);
        return issued;
      };

      const day364 = await aged("d364", 364);
      const first = await verifyMagicLink(db, day364.token, { ip: IP.c });
      assert.equal(first.ok, true, "a 364-day-old link signs in");
      const again = await verifyMagicLink(db, day364.token, { ip: IP.c });
      assert.equal(again.ok, false, "a used link is refused");
      assert.equal(again.error, "invalid_link");

      const day366 = await aged("d366", 366);
      const late = await verifyMagicLink(db, day366.token, { ip: IP.c });
      assert.equal(late.ok, false, "a 366-day-old link is refused");
      assert.equal(late.error, "invalid_link");
    });

    test("a forged token is refused, and looks exactly like an expired one", async () => {
      const out = await verifyMagicLink(db, "not-a-real-token-at-all", { ip: IP.b });
      assert.equal(out.ok, false);
      assert.equal(out.status, 401);
      assert.equal(out.error, "invalid_link");
    });

    test("a suspended account cannot be signed in by a link issued earlier", async () => {
      const email = `${TAG}-v-susp@x.io`;
      const clientId = await mkClient(email);
      const acct = await createAccount(db, {
        orgId: org, kind: "client", email, password: PW, clientId });

      const issued = await requestMagicLink(db, { email, ip: IP.c });
      await db.query(`UPDATE accounts SET status = 'suspended' WHERE id = $1`, [acct.id]);

      const out = await verifyMagicLink(db, issued.token, { ip: IP.c });
      assert.equal(out.ok, false);
      assert.equal(out.error, "invalid_link");
    });

    test("consuming a link records who consumed it", async () => {
      const email = `${TAG}-v-audit@x.io`;
      const clientId = await mkClient(email);
      await createAccount(db, { orgId: org, kind: "client", email, password: PW, clientId });

      const issued = await requestMagicLink(db, { email, ip: IP.a, userAgent: "asked/1" });
      await verifyMagicLink(db, issued.token, { ip: IP.b, userAgent: "clicked/2" });

      const row = (await db.query(
        `SELECT * FROM account_magic_links WHERE id = $1`, [issued.linkId])).rows[0];
      assert.ok(row.consumed_at);
      assert.equal(row.requested_ip, IP.a);
      assert.equal(row.consumed_ip, IP.b);
      assert.equal(row.requested_user_agent, "asked/1");
      assert.equal(row.consumed_user_agent, "clicked/2");
    });
  });

  /* ── AUTO-PROVISIONING ────────────────────────────────────────────────── */

  describe("a client with no account yet", () => {
    test("gets one created on first verification, and can sign in", async () => {
      const email = `${TAG}-p-new@x.io`;
      const clientId = await mkClient(email, TAG, "Fresh");

      const none = (await db.query(
        `SELECT count(*)::int AS n FROM accounts WHERE client_id = $1`, [clientId])).rows[0].n;
      assert.equal(none, 0, "the fixture already had an account");

      const issued = await requestMagicLink(db, { email, ip: IP.a });
      assert.equal(issued.outcome, "issued");

      const out = await verifyMagicLink(db, issued.token, { ip: IP.a });
      assert.equal(out.ok, true);
      assert.equal(out.principal.kind, "client");
      assert.equal(out.principal.clientId, clientId);

      const a = (await db.query(
        `SELECT * FROM accounts WHERE client_id = $1`, [clientId])).rows[0];
      assert.ok(a, "no account was provisioned");
      assert.equal(a.status, "active");
      assert.equal(a.email, email);
      assert.equal(a.name, `${TAG} Fresh`, "the client's name was not carried across");
      assert.ok(a.activated_at);

      // It holds a real scrypt hash that nobody has a copy of. That is what
      // satisfies 044's accounts_active_needs_hash honestly instead of dropping
      // it — see the note in db/migrations/117_account_magic_links.sql.
      assert.ok(a.password_hash && a.password_hash.startsWith("$scrypt$"),
        "the provisioned account has no credential");

      const seen = await verifyAccountSession(db, out.token, {});
      assert.ok(seen, "the provisioned account's session does not verify");
    });

    test("REQUESTING a link provisions nothing — only verifying does", async () => {
      // If asking could create an account, spraying addresses would populate
      // the accounts table with half-real customers.
      const email = `${TAG}-p-noask@x.io`;
      const clientId = await mkClient(email);
      await requestMagicLink(db, { email, ip: IP.b });
      const n = (await db.query(
        `SELECT count(*)::int AS n FROM accounts WHERE client_id = $1`, [clientId])).rows[0].n;
      assert.equal(n, 0);
    });

    test("a second link does not create a second account", async () => {
      const email = `${TAG}-p-twice@x.io`;
      const clientId = await mkClient(email);

      const one = await requestMagicLink(db, { email, ip: IP.a });
      await verifyMagicLink(db, one.token, { ip: IP.a });
      const two = await requestMagicLink(db, { email, ip: IP.b });
      const out = await verifyMagicLink(db, two.token, { ip: IP.b });

      assert.equal(out.ok, true);
      const n = (await db.query(
        `SELECT count(*)::int AS n FROM accounts WHERE client_id = $1`, [clientId])).rows[0].n;
      assert.equal(n, 1);
    });

    test("two links verified at once still yield exactly one account", async () => {
      // accounts_client_uniq makes the loser of this race raise; the
      // ON CONFLICT DO NOTHING plus re-read is what turns that into "both got
      // the same account" instead of a 500 on a perfectly valid link.
      const email = `${TAG}-p-race@x.io`;
      const clientId = await mkClient(email);
      const one = await requestMagicLink(db, { email, ip: IP.a });
      const two = await requestMagicLink(db, { email, ip: IP.b });

      const both = await Promise.all([
        verifyMagicLink(db, one.token, { ip: IP.a }),
        verifyMagicLink(db, two.token, { ip: IP.b })
      ]);
      assert.equal(both.filter((r) => r.ok).length, 2, "a valid link was refused");
      const n = (await db.query(
        `SELECT count(*)::int AS n FROM accounts WHERE client_id = $1`, [clientId])).rows[0].n;
      assert.equal(n, 1);
    });

    test("an 'invited' account is activated by clicking its link", async () => {
      // createAccount with no password writes status='invited'. Before this
      // unit nothing could ever move it to 'active', because nothing set a
      // password on an account row.
      const email = `${TAG}-p-inv@x.io`;
      const clientId = await mkClient(email);
      const staffId = (await db.query(
        `INSERT INTO staff (org_id,email,name,role,status)
         VALUES ($1,$2,'Inviter','admin','active') RETURNING id`,
        [org, `${TAG}-inviter@x.io`])).rows[0].id;
      const acct = await createAccount(db, {
        orgId: org, kind: "client", email, clientId, invitedBy: staffId });
      assert.equal(acct.status, "invited");

      const issued = await requestMagicLink(db, { email, ip: IP.c });
      const out = await verifyMagicLink(db, issued.token, { ip: IP.c });
      assert.equal(out.ok, true);

      const a = (await db.query(`SELECT status, password_hash, activated_at
                                   FROM accounts WHERE id = $1`, [acct.id])).rows[0];
      assert.equal(a.status, "active");
      assert.ok(a.password_hash, "activated without satisfying accounts_active_needs_hash");
      assert.ok(a.activated_at);

      await db.query(`DELETE FROM staff WHERE id = $1`, [staffId]);
    });
  });
});
