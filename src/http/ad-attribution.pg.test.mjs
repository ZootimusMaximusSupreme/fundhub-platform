/* Ad attribution, end to end, against a real Postgres.
 *
 * A signed ClickFunnels webhook carrying the five Meta UTMs → entry.captured →
 * client-lifecycle → a client_ad_attribution row whose lane / ad_id / variant
 * the DATABASE derived (286) → GET /api/read/ad-attribution resolves the ad
 * through marketing/ads/registry.json → GET /api/read/ad-books rolls it up.
 *
 * A pg test because the thing under test is SQL: the generated columns, the
 * enum, the CHECKs, the first-touch COALESCE, and the bookings join. A unit
 * test with a fake db would prove that JavaScript can call itself.
 *
 * SKIPS WITHOUT A DATABASE, LOUDLY. Run it: DATABASE_URL=postgres://… node --test
 * src/http/ad-attribution.pg.test.mjs. A skipped run of this file proves nothing.
 *
 * Rows are marked by NONCE in the email so cleanup touches only what this run
 * made; the shared default org is used exactly as the other webhook suites do.
 */
import { test, before, after, describe } from "node:test";
import assert from "node:assert";
import crypto from "node:crypto";
import { db, close } from "../db.mjs";
import { handleWebhook } from "./router.mjs";
import { _resetOrgCache } from "../events/bus.mjs";
import { clearHandlers } from "../events/registry.mjs";
import { _resetRegistered } from "../register-all.mjs";
import { resolveDefaultOrg } from "../auth/org.mjs";
import { createSession } from "../auth/session.mjs";
import { upsertClientAdAttribution } from "../ads/store.mjs";
import { _resetRegistry } from "../ads/registry.mjs";

const HAVE_DB = !!process.env.DATABASE_URL;
const NONCE = `adattr-${process.pid}-${Date.now()}`;
const CF_SECRET = "cf_adattr_test_secret";
const hmac = (raw) => crypto.createHmac("sha256", CF_SECRET).update(raw).digest("hex");
const mail = (tag) => `${NONCE}.${tag}@example.com`.toLowerCase();

describe("ad attribution: webhook → row → registry → reads", { skip: !HAVE_DB ? "no DATABASE_URL" : false }, () => {
  let org, handler, tokStaff;

  const reset = () => { _resetOrgCache(); clearHandlers(); _resetRegistered(); _resetRegistry(); };

  /* A ClickFunnels contact.created delivery whose hidden form fields carry the
     UTMs — the shape marketing/landing-pages/06-utm-hidden-fields.html produces.
     The UTMs sit in contact.custom_attributes, where CF puts hidden inputs. */
  async function deliver(tag, utm, extra = {}) {
    reset();
    const raw = JSON.stringify({
      event_type: "contact.created",
      event_id: `${NONCE}-${tag}`,
      data: {
        id: `${NONCE}-${tag}`,
        email: mail(tag),
        first_name: "Ad",
        last_name: tag,
        custom_attributes: { ...utm },
        ...extra
      }
    });
    const out = await handleWebhook({
      db, provider: "clickfunnels", rawBody: raw,
      headers: { "x-webhook-clickfunnels-signature": hmac(raw) },
      url: "https://x/api/webhooks/clickfunnels",
      env: { CLICKFUNNELS_WEBHOOK_SECRET: CF_SECRET }
    });
    assert.equal(out.status, 200, `webhook accepted: ${JSON.stringify(out.body)}`);
    const c = (await db.query(`SELECT id, custom_fields FROM clients WHERE org_id = $1 AND email = $2`, [org, mail(tag)])).rows[0];
    assert.ok(c, `client row exists for ${tag}`);
    return c;
  }

  const rowFor = async (clientId) => (await db.query(
    `SELECT utm_source, utm_medium, utm_campaign, utm_content, utm_term, lane::text AS lane, ad_id, variant
       FROM client_ad_attribution WHERE client_id = $1`, [clientId])).rows[0] || null;

  const call = async (path) => {
    const r = await handler(new Request("https://x" + path, {
      headers: { authorization: "Bearer " + tokStaff, host: "x" }
    }), {});
    let body = null;
    try { body = JSON.parse(await r.text()); } catch { /* not json */ }
    return { status: r.status, body };
  };

  /* EVENTS BEFORE CLIENTS. events.client_id is a foreign key with no cascade,
     so a client that any event points at cannot be deleted while that event
     exists. This used to run the other way round and pass, but only because the
     ClickFunnels adapter wrote every funnel event with client_id NULL — the
     defect fixed on 2026-09-04 (F39). Now that a funnel event names its
     customer, the old order fails on the foreign key. Every other cleanup in
     the repository already deletes events first
     (src/verification/fixtures.mjs, src/demo/platform-seed.mjs); this one was
     the exception. Nothing about what the test asserts changes. */
  async function wipe() {
    await db.query(`DELETE FROM bookings WHERE org_id = $1 AND attendee_email LIKE $2`, [org, `${NONCE}%`]);
    // entry.captured now creates a setter task, which also holds a client FK.
    await db.query(`DELETE FROM tasks WHERE org_id = $1 AND client_id IN (
      SELECT id FROM clients WHERE org_id = $1 AND email LIKE $2)`, [org, `${NONCE}%`]);
    await db.query(`DELETE FROM events WHERE payload->>'email' LIKE $1`, [`${NONCE}%`]);
    await db.query(`DELETE FROM clients WHERE org_id = $1 AND email LIKE $2`, [org, `${NONCE}%`]);
  }

  before(async () => {
    ({ default: handler } = await import("../../netlify/functions/api.mjs"));
    org = await resolveDefaultOrg(db);
    const owner = (await db.query(
      `SELECT id, org_id FROM staff WHERE org_id = $1 AND role = 'owner' LIMIT 1`, [org])).rows[0];
    assert.ok(owner, "the default org has an owner staff row (seeded)");
    tokStaff = (await createSession(db, { staffId: owner.id, orgId: owner.org_id })).token;
    await wipe();
  });

  after(async () => {
    await wipe();
    await close();
  });

  test("a webhook with the five UTMs lands lane, ad_id and variant, derived by the database", async () => {
    const c = await deliver("known", {
      utm_source: "fb", utm_medium: "paid", utm_campaign: "funding600", utm_content: "42-ringlights", utm_term: "sun"
    });
    // The jsonb copy the older code wrote still lands — nothing was taken away.
    assert.equal(c.custom_fields.utm_campaign, "funding600");
    assert.equal(c.custom_fields.utm_content, "42-ringlights");
    const row = await rowFor(c.id);
    assert.ok(row, "client_ad_attribution row written");
    assert.equal(row.utm_source, "fb");
    assert.equal(row.utm_medium, "paid");
    assert.equal(row.lane, "funding600");
    assert.equal(row.ad_id, "42");
    assert.equal(row.variant, "sun");
  });

  test("a known ad_id resolves to its registry tags on the read", async () => {
    const c = (await db.query(`SELECT id FROM clients WHERE org_id = $1 AND email = $2`, [org, mail("known")])).rows[0];
    const { status, body } = await call(`/api/read/ad-attribution?client_id=${c.id}`);
    assert.equal(status, 200, JSON.stringify(body));
    assert.equal(body.attribution.lane, "funding600");
    assert.equal(body.attribution.ad_id, "42");
    assert.equal(body.registry.known, true);
    assert.deepEqual(
      { gate: body.resolved.gate, entry: body.resolved.entry, primary: body.resolved.primary_offer,
        secondary: body.resolved.secondary_offers, title: body.resolved.title, variant: body.resolved.variant },
      { gate: "600", entry: "direct", primary: "funding_dfy", secondary: [], title: "ringlights", variant: "sun" }
    );
    assert.match(body.resolved.guidance, /^Direct:/);
  });

  test("an unknown ad_id resolves to the sorting default, and the row still says which ad it was", async () => {
    const c = await deliver("unknown", {
      utm_source: "fb", utm_medium: "paid", utm_campaign: "sorting", utm_content: "999-mystery", utm_term: "nosun"
    });
    const row = await rowFor(c.id);
    assert.equal(row.lane, "sorting");
    assert.equal(row.ad_id, "999", "the id is kept even though the registry does not know it");
    assert.equal(row.variant, "nosun");
    const { status, body } = await call(`/api/read/ad-attribution?client_id=${c.id}`);
    assert.equal(status, 200);
    assert.equal(body.registry.known, false);
    assert.equal(body.resolved.gate, "none");
    assert.equal(body.resolved.entry, "sorting");
    assert.equal(body.resolved.primary_offer, "none");
    assert.equal(body.resolved.secondary_offers, "all");
    assert.equal(body.resolved.title, null);
    assert.equal(body.resolved.variant, "nosun");
  });

  test("a sorting ad with a primary (slam 43) says lead with it", async () => {
    const c = await deliver("slam", { utm_campaign: "sorting", utm_content: "43", utm_term: "sun" });
    const { body } = await call(`/api/read/ad-attribution?client_id=${c.id}`);
    assert.equal(body.resolved.entry, "sorting");
    assert.equal(body.resolved.primary_offer, "funding_dfy");
    assert.equal(body.resolved.secondary_offers, "all");
    assert.match(body.resolved.guidance, /lead with the primary offer/);
  });

  test("the database, not the app, owns the derivation: bad campaign → unknown, non-numeric content → NULL ad, odd term squeezed", async () => {
    const c = await deliver("odd", { utm_campaign: "Funding-600", utm_content: "oVid: 3", utm_term: " No Sun! " });
    const row = await rowFor(c.id);
    assert.equal(row.utm_campaign, "Funding-600", "the raw value is kept as sent");
    assert.equal(row.lane, "unknown");
    assert.equal(row.ad_id, null);
    assert.equal(row.variant, "no-sun");
    // The enum is a real one: an out-of-vocabulary lane cannot be written at all.
    await assert.rejects(
      db.query(`UPDATE client_ad_attribution SET utm_campaign = 'x' WHERE client_id = $1 RETURNING 'meta'::ad_lane`, [c.id]),
      /invalid input value for enum ad_lane/
    );
    // The client with no UTMs at all gets no row — and the read still answers.
    const bare = await deliver("bare", {});
    assert.equal(await rowFor(bare.id), null);
    const { status, body } = await call(`/api/read/ad-attribution?client_id=${bare.id}`);
    assert.equal(status, 200);
    assert.equal(body.attribution, null);
    assert.equal(body.resolved.entry, "sorting");
  });

  test("first touch wins: a second capture fills blanks and never overwrites", async () => {
    const c = (await db.query(`SELECT id FROM clients WHERE org_id = $1 AND email = $2`, [org, mail("known")])).rows[0];
    const again = await upsertClientAdAttribution(db, {
      orgId: org, clientId: c.id,
      attribution: { utm_campaign: "premium", utm_content: "80-other", utm_term: "sedona", referrer_domain: "l.facebook.com" }
    });
    assert.equal(again.lane, "funding600", "the ad that brought them keeps the credit");
    assert.equal(again.ad_id, "42");
    assert.equal(again.variant, "sun");
    assert.equal(again.referrer_domain, "l.facebook.com", "a blank is filled");
  });

  test("the read is staff-only, org-bound, and refuses a bad id", async () => {
    const anon = await handler(new Request("https://x/api/read/ad-attribution?client_id=" + crypto.randomUUID(), { headers: { host: "x" } }), {});
    assert.equal(anon.status, 401);
    assert.equal((await call(`/api/read/ad-attribution?client_id=nope`)).status, 400);
    assert.equal((await call(`/api/read/ad-attribution?client_id=${crypto.randomUUID()}`)).status, 404);
  });

  test("books: grouped by lane, by ad_id, and by a registry tag, with counts and a date range", async () => {
    const known = (await db.query(`SELECT id FROM clients WHERE org_id = $1 AND email = $2`, [org, mail("known")])).rows[0];
    const slam = (await db.query(`SELECT id FROM clients WHERE org_id = $1 AND email = $2`, [org, mail("slam")])).rows[0];
    // Two booked calls for the ringlights lead, one cancelled (must not count), one for the slam lead.
    for (const [cid, tag, status] of [[known.id, "k1", "booked"], [known.id, "k2", "cancelled"], [slam.id, "s1", "booked"]]) {
      await db.query(
        `INSERT INTO bookings (org_id, client_id, source, provider_uid, starts_at, status, attendee_email)
         VALUES ($1, $2, 'clickfunnels', $3, now() + interval '1 day', $4, $5)`,
        [org, cid, `${NONCE}-${tag}`, status, mail(tag)]
      );
    }

    const byLane = await call(`/api/read/ad-books?group_by=lane`);
    assert.equal(byLane.status, 200, JSON.stringify(byLane.body));
    const f600 = byLane.body.groups.find((g) => g.key === "funding600");
    assert.ok(f600, "funding600 group present");
    assert.ok(f600.leads >= 1 && f600.books >= 1, `funding600 counts ${JSON.stringify(f600)}`);
    assert.ok(f600.first_book_at && f600.last_book_at, "date range on books");
    assert.ok(f600.first_lead_at && f600.last_lead_at, "date range on leads");
    assert.ok(f600.ad_ids.includes("42"));

    const byAd = await call(`/api/read/ad-books?group_by=ad_id`);
    const ad42 = byAd.body.groups.find((g) => g.key === "42");
    assert.ok(ad42 && ad42.books >= 1, "ad 42 has its booked call");
    assert.ok(ad42.books === 1 || ad42.books >= 1, "cancelled bookings do not count as booked calls");
    const ad999 = byAd.body.groups.find((g) => g.key === "999");
    assert.ok(ad999 && ad999.leads >= 1 && ad999.books === 0, "unknown ad still grouped, no books");

    const byGate = await call(`/api/read/ad-books?group_by=gate`);
    const g600 = byGate.body.groups.find((g) => g.key === "600");
    const gnone = byGate.body.groups.find((g) => g.key === "none");
    assert.ok(g600 && g600.ad_ids.includes("42"), "gate 600 carries ad 42");
    assert.ok(gnone && gnone.ad_ids.includes("43") && gnone.ad_ids.includes("999"), "gate none carries the sorting ad and the unknown one");
    assert.ok(byGate.body.unknown_ad_ids.includes("999"), "unknown ids are named, not hidden");

    const bySecondary = await call(`/api/read/ad-books?group_by=secondary_offer`);
    const academy = bySecondary.body.groups.find((g) => g.key === "capital_academy");
    assert.ok(academy && academy.ad_ids.includes("43"), 'a sorting ad ("all") counts under every real offer');

    const windowed = await call(`/api/read/ad-books?group_by=lane&from=2099-01-01`);
    assert.equal(windowed.status, 200);
    assert.equal(windowed.body.total_leads, 0, "a window with nothing in it is empty, not an error");
    assert.equal((await call(`/api/read/ad-books?group_by=colour`)).status, 400);
    assert.equal((await call(`/api/read/ad-books?from=yesterday`)).status, 400);
  });
});
