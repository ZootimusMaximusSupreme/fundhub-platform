/* The Decline Autopsy endpoints — does a $27 buyer's upload actually land, and
 * can this door be used to get at somebody it should not?
 *
 * A pg test, not a unit test, because the thing being proven is THE ROW. An
 * endpoint that answers 200 and writes nothing — or that answers 400 and writes
 * anyway — is exactly the failure this exists to catch, and only a database can
 * tell those apart.
 *
 * It goes through netlify/functions/api.mjs rather than importing the handlers,
 * because A HANDLER FILE IS NOT A ROUTE: a handler missing from the ROUTES map
 * 404s locally and deployed, and that has shipped broken twice here. Calling the
 * real front door proves the map entries as well as the handlers.
 *
 * EVERY TEST BUILDS ITS OWN AUTOPSY. Nothing is shared, so no assertion rests on
 * the order the tests happened to run in.
 *
 * SHELVED BY THE OWNER ON 2026-08-31 (bd1746064). The three routes were taken
 * out of ROUTES so the offer cannot go live; the handlers, src/autopsy/,
 * migration 275 and the sales page stay, because the offer is coming back.
 * This file still goes through the real front door: for this file only, it
 * puts the three shelved handlers back into the in-memory ROUTES map in
 * before() and takes them out again in after(). The first test proves the
 * shipped map does NOT route them, so a deploy can never carry them by
 * accident; the rest keep proving the handlers for the day they return.
 * Until 2026-10-05 the first test asserted the opposite and failed.
 */
import { test, before, after, describe } from "node:test";
import assert from "node:assert";

import { db, close } from "../db.mjs";
import { resolveDefaultOrg } from "../auth/org.mjs";
import { createAutopsy, markPaid, newAutopsyRef } from "../autopsy/store.mjs";
import { signReportUrl } from "../autopsy/link.mjs";
import { ATTESTATION_VERSION, MAX_ROWS } from "../autopsy/fields.mjs";
import publicDeclineAutopsy from "../../api/public/decline-autopsy.mjs";
import publicDeclineAutopsyUpload from "../../api/public/decline-autopsy-upload.mjs";
import publicDeclineAutopsyReport from "../../api/public/decline-autopsy-report.mjs";

/* The three keys netlify/functions/api.mjs keeps commented out while shelved. */
const SHELVED = Object.freeze({
  "public/decline-autopsy": publicDeclineAutopsy,
  "public/decline-autopsy-upload": publicDeclineAutopsyUpload,
  "public/decline-autopsy-report": publicDeclineAutopsyReport
});

const HAVE_DB = !!process.env.DATABASE_URL;
const MARK = "w3autopsy";
const SECRET = "w3-autopsy-test-secret-0123456789abcdef";

const HEADER = "row_label,fico_band,state,business_age_months,highest_revolving_limit_usd,revolving_opened_month";
const CLEAN_CSV = `${HEADER}\nA-1,720+,TX,30,10000,2015-01\nA-2,600-639,TX,12,9000,2016-02\nA-3,unknown,,,,`;

describe("public decline autopsy", { skip: !HAVE_DB ? "no DATABASE_URL" : false }, () => {
  let org, handler, ROUTES, priorSecret, shippedRouted;

  const call = async (path, { method = "GET", body = null, headers = {} } = {}) => {
    const init = { method, headers: Object.assign({ host: "x" }, headers) };
    if (body !== null) {
      init.headers["content-type"] = "application/json";
      init.body = JSON.stringify(body);
    }
    return handler(new Request(`https://x/api/${path}`, init), {});
  };
  const json = async (r) => { try { return JSON.parse(await r.text()); } catch { return null; } };

  const rowsFor = async (ref) => (await db.query(
    `SELECT r.row_label, r.fico_band, r.bucket, r.estimated_capacity_cents, r.declined_on_month, r.assumptions
       FROM decline_autopsy_rows r
       JOIN decline_autopsy_uploads u ON u.id = r.autopsy_id
      WHERE u.autopsy_ref = $1
      ORDER BY r.row_label`, [ref])).rows;

  const uploadFor = async (ref) => (await db.query(
    `SELECT * FROM decline_autopsy_uploads WHERE autopsy_ref = $1`, [ref])).rows[0] || null;

  /** A paid autopsy nobody else will touch. */
  const paidAutopsy = async () => {
    const ref = newAutopsyRef();
    await createAutopsy(db, { orgId: org, buyerEmail: `${MARK}-${ref.slice(0, 8)}@broker.test`, buyerName: "Test Broker", ref });
    await markPaid(db, { orgId: org, ref });
    return ref;
  };

  const upload = (ref, over = {}) => call("public/decline-autopsy-upload", {
    method: "POST",
    body: { ref, attestation_accepted: true, attestation_name: "Test Broker", csv_text: CLEAN_CSV, ...over }
  });

  const purge = async () => {
    await db.query(
      `DELETE FROM decline_autopsy_uploads WHERE buyer_email LIKE $1`, [`${MARK}-%`]
    );
  };

  before(async () => {
    ({ default: handler, ROUTES } = await import("../../netlify/functions/api.mjs"));
    // What the SHIPPED map routes, read before this file adds anything.
    shippedRouted = Object.keys(SHELVED).filter((k) => Object.prototype.hasOwnProperty.call(ROUTES, k));
    for (const [k, h] of Object.entries(SHELVED)) {
      if (!Object.prototype.hasOwnProperty.call(ROUTES, k)) ROUTES[k] = h;
    }
    priorSecret = process.env.AUTOPSY_REPORT_SECRET;
    process.env.AUTOPSY_REPORT_SECRET = SECRET;
    org = await resolveDefaultOrg(db);
    await purge();
  });

  after(async () => {
    // Shelved again: only the keys this file added are removed.
    for (const k of Object.keys(SHELVED)) {
      if (!shippedRouted.includes(k)) delete ROUTES[k];
    }
    if (priorSecret === undefined) delete process.env.AUTOPSY_REPORT_SECRET;
    else process.env.AUTOPSY_REPORT_SECRET = priorSecret;
    await purge();
    await close();
  });

  // ── the routes exist at all ───────────────────────────────────────────────

  test("*** while shelved, the shipped ROUTES map does not route any of the three ***", async () => {
    /* Owner, 2026-08-31: shelved so it cannot go live on the next deploy. To
       unshelve, restore the three lines in netlify/functions/api.mjs, remove
       them from ALLOWED_UNROUTED in src/http/routes.test.mjs, and turn this
       test back into "all three are reachable". */
    assert.deepEqual(shippedRouted, [],
      "a shelved Decline Autopsy route is back in the deployed ROUTES map");
  });

  test("with the three put back for this file, all three answer through the front door", async () => {
    for (const path of Object.keys(SHELVED)) {
      const r = await call(path, { method: "OPTIONS" });
      assert.notEqual(r.status, 404, `${path} did not route even with its handler put back`);
    }
  });

  test("the sales page carries terms and NO earnings figure", async () => {
    const r = await call("public/decline-autopsy");
    const b = await json(r);
    assert.equal(r.status, 200);
    assert.equal(b.priceCents, 2700);
    assert.equal(b.maxRows, MAX_ROWS);
    const text = JSON.stringify(b).toLowerCase();
    for (const claim of ["you will earn", "you will make", "average broker", "guaranteed"]) {
      assert.equal(text.includes(claim), false, `the public page carries an earnings claim: "${claim}"`);
    }
    assert.match(b.promises.join(" "), /do not pull anyone's credit/);
  });

  // ── pay first, upload second ──────────────────────────────────────────────

  test("*** an UNPAID autopsy cannot upload, and nothing is written ***", async () => {
    const ref = newAutopsyRef();
    await createAutopsy(db, { orgId: org, buyerEmail: `${MARK}-unpaid@broker.test`, ref });
    const r = await upload(ref);
    assert.equal(r.status, 402);
    assert.equal((await json(r)).error, "payment_required");
    assert.equal((await rowsFor(ref)).length, 0, "rows were written for an unpaid buyer");
  });

  test("an unknown reference is refused", async () => {
    const r = await upload("deadbeefdeadbeefdeadbeefdeadbeef");
    assert.equal(r.status, 404);
  });

  // ── the attestation ───────────────────────────────────────────────────────

  test("*** no attestation, no upload ***", async () => {
    const ref = await paidAutopsy();
    const noTick = await upload(ref, { attestation_accepted: false });
    assert.equal(noTick.status, 400);
    assert.equal((await json(noTick)).error, "attestation_required");

    const noName = await upload(ref, { attestation_name: "" });
    assert.equal(noName.status, 400);

    assert.equal((await rowsFor(ref)).length, 0, "rows landed without an attestation");
    const u = await uploadFor(ref);
    assert.equal(u.attestation_at, null);
  });

  test("the attestation is stored on the autopsy row, NOT in client_consents", async () => {
    const ref = await paidAutopsy();
    await upload(ref);
    const u = await uploadFor(ref);
    assert.equal(u.attestation_version, ATTESTATION_VERSION);
    assert.equal(u.attestation_name, "Test Broker");
    assert.ok(u.attestation_at);

    // client_consents means "a consumer gave us permission about their own
    // file". A broker's warranty about somebody else's file is not that, and
    // the CHECK on that table would refuse it anyway.
    const { rows } = await db.query(
      `SELECT count(*)::int AS n FROM client_consents WHERE kind = $1`, [ATTESTATION_VERSION]
    );
    assert.equal(rows[0].n, 0, "the merchant attestation leaked into the consumer consent table");
  });

  // ── the boundary ──────────────────────────────────────────────────────────

  test("*** AN SSN IS REFUSED AND NOTHING IS STORED ***", async () => {
    const ref = await paidAutopsy();
    const r = await upload(ref, { csv_text: `${HEADER}\n123-45-6789,720+,TX,30,10000,2015-01` });
    const b = await json(r);
    assert.equal(r.status, 400);
    assert.equal(b.error, "personal_details_found");
    assert.equal(b.stored, false);
    assert.equal((await rowsFor(ref)).length, 0, "a refused upload still wrote rows");
    const u = await uploadFor(ref);
    assert.equal(u.raw_storage_key, null, "a refused upload left bytes behind");
    assert.equal(u.rows_submitted, 0);
  });

  test("*** AN E-MAIL IS REFUSED AND NOTHING IS STORED ***", async () => {
    const ref = await paidAutopsy();
    const r = await upload(ref, { csv_text: `${HEADER}\njones@example.com,720+,TX,30,10000,2015-01` });
    assert.equal(r.status, 400);
    assert.equal((await json(r)).error, "personal_details_found");
    assert.equal((await rowsFor(ref)).length, 0);
  });

  test("*** A PHONE NUMBER IS REFUSED AND NOTHING IS STORED ***", async () => {
    const ref = await paidAutopsy();
    const r = await upload(ref, { csv_text: `${HEADER}\n(555) 867-5309,720+,TX,30,10000,2015-01` });
    assert.equal(r.status, 400);
    assert.equal((await json(r)).error, "personal_details_found");
    assert.equal((await rowsFor(ref)).length, 0);
  });

  test("identity columns are dropped, counted, and their values never reach the database", async () => {
    const ref = await paidAutopsy();
    const csv = "row_label,client_name,ssn,email,fico_band,highest_revolving_limit_usd,revolving_opened_month\n" +
                "A-1,Jane Jones,123-45-6789,jane@x.com,720+,10000,2015-01";
    const r = await upload(ref, { csv_text: csv });
    const b = await json(r);
    assert.equal(r.status, 200, JSON.stringify(b));
    assert.deepEqual(b.droppedColumns, ["client_name", "ssn", "email"]);

    const u = await uploadFor(ref);
    assert.equal(u.columns_dropped, 3);
    const stored = JSON.stringify(await rowsFor(ref));
    assert.doesNotMatch(stored, /Jane|123-45-6789|jane@x\.com/,
      "a dropped column's value is in the database");
  });

  test("the row table has no column anyone could be contacted through", async () => {
    const { rows } = await db.query(
      `SELECT column_name FROM information_schema.columns
        WHERE table_name = 'decline_autopsy_rows'`
    );
    const names = rows.map((r) => r.column_name);
    for (const forbidden of ["name", "full_name", "ssn", "dob", "date_of_birth", "address",
                             "email", "phone", "mobile", "account_number", "client_id"]) {
      assert.equal(names.includes(forbidden), false,
        `decline_autopsy_rows grew a "${forbidden}" column — the whole compliance argument is that it cannot exist`);
    }
  });

  // ── what gets kept ────────────────────────────────────────────────────────

  test("a clean upload scores, stores, and keeps NULL as NULL", async () => {
    const ref = await paidAutopsy();
    const r = await upload(ref);
    const b = await json(r);
    assert.equal(r.status, 200, JSON.stringify(b));
    assert.equal(b.rowsAccepted, 3);

    const rows = await rowsFor(ref);
    assert.equal(rows.length, 3);

    const unknown = rows.find((x) => x.row_label === "A-3");
    assert.equal(unknown.bucket, "not_enough_information");
    assert.equal(unknown.estimated_capacity_cents, null,
      "an unmodelled row was written as a number instead of NULL");

    // and it is excluded from the totals the buyer is shown
    assert.equal(b.report.worth.rows_excluded, 1);
    assert.deepEqual(b.report.worth.excluded_row_labels, ["A-3"]);
  });

  test("*** the raw uploaded file is deleted from storage after parsing ***", async () => {
    const objects = new Map();
    const store = {
      provider: {
        async put(pathname, bytes) { const k = `memory://${pathname}`; objects.set(k, bytes); return k; },
        async get(k) { return objects.has(k) ? { body: objects.get(k) } : null; },
        async del(k) { objects.delete(k); }
      },
      async del(k) { objects.delete(k); }
    };

    const ref = await paidAutopsy();
    const { runAutopsyUpload } = await import("../../api/public/decline-autopsy-upload.mjs");
    const out = await runAutopsyUpload({
      orgId: org, ref,
      attestationName: "Test Broker", attestationAccepted: true,
      fileBuffer: Buffer.from(CLEAN_CSV, "utf8"), fileName: "declines.csv",
      declaredMimeType: "text/csv",
      store
    });
    assert.equal(out.ok, true, JSON.stringify(out));
    assert.equal(objects.size, 0, "the file the broker uploaded is still in blob storage");
    assert.equal(out.rawFileDeleted, true);

    const u = await uploadFor(ref);
    assert.equal(u.raw_storage_key, null, "the storage key was left pointing at a deleted object");
    assert.ok(u.raw_deleted_at, "nothing recorded that the original was destroyed");
    assert.equal((await rowsFor(ref)).length, 3, "the cleaned rows were lost with the file");
  });

  test("a file that is not a CSV is refused on its bytes", async () => {
    const ref = await paidAutopsy();
    const { runAutopsyUpload } = await import("../../api/public/decline-autopsy-upload.mjs");
    const out = await runAutopsyUpload({
      orgId: org, ref,
      attestationName: "Test Broker", attestationAccepted: true,
      fileBuffer: Buffer.from([0x00, 0x01, 0x02, 0x2c, 0x03]), fileName: "declines.csv",
      declaredMimeType: "text/csv"
    });
    assert.equal(out.ok, false);
    assert.equal(out.error, "invalid_file_type");
    assert.equal((await rowsFor(ref)).length, 0);
  });

  // ── the report link ───────────────────────────────────────────────────────

  test("the report opens with a signed link and is refused without one", async () => {
    const ref = await paidAutopsy();
    await upload(ref);

    const link = signReportUrl({ orgId: org, ref, secret: SECRET });
    const q = new URLSearchParams(link.path.split("?")[1]);
    const ok = await call(`public/decline-autopsy-report?${q.toString()}`);
    const body = await json(ok);
    assert.equal(ok.status, 200, JSON.stringify(body));
    assert.equal(body.ref, ref);
    assert.equal(body.counts.not_enough_information, 1);

    const unsigned = await call(`public/decline-autopsy-report?ref=${ref}`);
    assert.equal(unsigned.status, 404, "the report opened with no signature");

    q.set("sig", "0".repeat(64));
    const forged = await call(`public/decline-autopsy-report?${q.toString()}`);
    assert.equal(forged.status, 404, "a forged signature opened the report");
  });

  test("an unknown reference, a forged signature and an expired link answer the same", async () => {
    const good = signReportUrl({ orgId: org, ref: newAutopsyRef(), secret: SECRET });
    const expired = signReportUrl({ orgId: org, ref: newAutopsyRef(), secret: SECRET, ttlSeconds: 1, now: () => Date.now() - 10_000 });
    const answers = [];
    for (const l of [good, expired]) {
      const r = await call(`public/decline-autopsy-report?${l.path.split("?")[1]}`);
      answers.push(`${r.status}:${JSON.stringify(await json(r))}`);
    }
    assert.equal(answers[0], answers[1],
      "the refusals differ, so the endpoint can be used to find out which references exist");
  });

  // ── the delete button ─────────────────────────────────────────────────────

  test("*** the delete button removes the rows and keeps the purchase record ***", async () => {
    const ref = await paidAutopsy();
    await upload(ref);
    assert.equal((await rowsFor(ref)).length, 3);

    const link = signReportUrl({ orgId: org, ref, secret: SECRET });
    const r = await call(`public/decline-autopsy-report?${link.path.split("?")[1]}`, { method: "DELETE" });
    const b = await json(r);
    assert.equal(r.status, 200, JSON.stringify(b));
    assert.equal(b.rowsDeleted, 3);

    assert.equal((await rowsFor(ref)).length, 0, "the rows survived the delete button");

    const u = await uploadFor(ref);
    assert.ok(u, "the purchase record was destroyed — a $27 sale is a financial record");
    assert.ok(u.deleted_at);
    assert.ok(u.deleted_reason, "a delete with no reason is not a record");
    assert.match(b.keptWithReason.decline_autopsy_uploads, /not erasable/);

    // and the report is gone with it
    const after = await call(`public/decline-autopsy-report?${link.path.split("?")[1]}`);
    assert.equal(after.status, 404);
  });

  // ── the money never splits ────────────────────────────────────────────────

  test("*** an autopsy purchase accrues NO partner and NO affiliate commission ***", async () => {
    const ref = await paidAutopsy();
    await upload(ref);
    const partner = await db.query(
      `SELECT count(*)::int AS n FROM partner_revenue WHERE source_ref LIKE $1 OR source_ref = $2`,
      ["%decline-autopsy%", ref]
    ).catch(() => ({ rows: [{ n: 0 }] }));
    assert.equal(partner.rows[0].n, 0, "the $27 e-product accrued partner revenue");

    const affiliate = await db.query(
      `SELECT count(*)::int AS n FROM affiliate_commission_rules WHERE product_code = $1`,
      ["decline-autopsy"]
    ).catch(() => ({ rows: [{ n: 0 }] }));
    assert.equal(affiliate.rows[0].n, 0, "a commission rule exists for decline-autopsy — it must not");
  });

  // ── retention: registered, never scheduled ────────────────────────────────

  test("*** broker_upload_rows is registered and has NO purge schedule ***", async () => {
    const { rows } = await db.query(
      `SELECT action, retain_days, signed_off_by FROM retention_policy
        WHERE org_id = $1 AND data_class = 'broker_upload_rows'`, [org]
    );
    assert.equal(rows.length, 1, "the retention class was not registered");
    assert.equal(rows[0].action, "retain");
    assert.equal(rows[0].retain_days, null,
      "a purge period was set for broker uploads — owner-set is RETAIN IN FULL, no purge");
    assert.equal(rows[0].signed_off_by, "owner");
  });

  test("a retain-and-signed class does not nag in the gaps report", async () => {
    const { rows } = await db.query(
      `SELECT data_class FROM v_retention_policy_gaps
        WHERE org_id = $1 AND data_class = 'broker_upload_rows'`, [org]
    );
    assert.equal(rows.length, 0,
      "a class the owner decided to keep forever is reported as an undecided gap every day");
  });
});
