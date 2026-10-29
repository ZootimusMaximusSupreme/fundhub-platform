// A/R: signed Commas webhook reference and session must identify ONE sale.
// Disposable CI PostgreSQL only, all synthetic writes rollback. No events,
// charges, live merchant traffic, emails, Supabase writes or customer sends.
import { describe, test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { pool, close } from "../db.mjs";
import { resolveDefaultOrg } from "../auth/org.mjs";
import { loadPaymentLink } from "./commas.mjs";

const SCRATCH = (() => {
  if (process.env.CI !== "true" || !process.env.DATABASE_URL) return false;
  try {
    const u = new URL(process.env.DATABASE_URL);
    return ["localhost", "127.0.0.1"].includes(u.hostname)
      && u.pathname === "/fundhub_ci";
  } catch { return false; }
})();

describe("Commas link-ref / session identity gate (real disposable Postgres)",
  { skip: SCRATCH ? false : "CI loopback fundhub_ci only" }, () => {
    let conn, orgId, clientA, clientB, linkA, linkB;

    before(async () => {
      conn = await pool().connect();
      await conn.query("BEGIN");
      orgId = await resolveDefaultOrg(conn);
      const buyer = async (label) => (await conn.query(
        `INSERT INTO clients (org_id, first_name, last_name, email)
         VALUES ($1,'AR','CommasIdentity',$2) RETURNING id`,
        [orgId, `ar-commas-identity+${label}-${randomUUID()}@example.invalid`]
      )).rows[0].id;
      clientA = await buyer("a");
      clientB = await buyer("b");
      const makeLink = async (clientId, tag) => {
        const ref = `ar-link-${tag}-${randomUUID()}`;
        const session = `ar-session-${tag}-${randomUUID()}`;
        const r = await conn.query(
          `INSERT INTO payment_links
             (org_id, client_id, purpose, amount_cents, provider,
              link_ref, commas_session_id, checkout_url)
           VALUES ($1,$2,'custom',10000,'commas',$3,$4,'https://example.invalid/synthetic')
           RETURNING id, org_id, client_id, link_ref, commas_session_id`,
          [orgId, clientId, ref, session]
        );
        return r.rows[0];
      };
      linkA = await makeLink(clientA, "a");
      linkB = await makeLink(clientB, "b");
    });

    after(async () => {
      if (conn) {
        await conn.query("ROLLBACK").catch(() => {});
        conn.release();
      }
      await close();
    });

    test("conflicting valid same-tenant session and reference fail closed before event creation", async () => {
      await assert.rejects(
        loadPaymentLink(conn, { linkRef: linkA.link_ref, sessionId: linkB.commas_session_id }),
        /conflicting checkout reference and session identity/
      );
      const events = await conn.query(
        `SELECT COUNT(*)::int n FROM events WHERE client_id = ANY($1::uuid[])`,
        [[clientA, clientB]]
      );
      assert.equal(events.rows[0].n, 0, "no synthetic money-in event was emitted");
    });

    test("matching link reference and session identify the same buyer", async () => {
      const found = await loadPaymentLink(conn, {
        linkRef: linkA.link_ref, sessionId: linkA.commas_session_id
      });
      assert.equal(String(found.id), String(linkA.id));
      assert.equal(String(found.client_id), String(clientA));
    });

    test("single valid locator still works for legacy or missing provider metadata", async () => {
      const byRef = await loadPaymentLink(conn, {
        linkRef: linkB.link_ref, sessionId: "provider-product-id-not-in-checkout-links"
      });
      assert.equal(String(byRef.id), String(linkB.id));
      const bySession = await loadPaymentLink(conn, {
        linkRef: "unknown-provider-ref", sessionId: linkB.commas_session_id
      });
      assert.equal(String(bySession.id), String(linkB.id));
      assert.equal(await loadPaymentLink(conn, { linkRef: "unknown", sessionId: "unknown" }), null);
    });
  });
