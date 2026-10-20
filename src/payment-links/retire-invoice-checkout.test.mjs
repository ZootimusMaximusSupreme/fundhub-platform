import { test } from "node:test";
import assert from "node:assert/strict";
import {
  retireInvoiceCheckoutLink,
  retireInvoiceCheckoutLinksForInvoice
} from "./retire-invoice-checkout.mjs";

const env = { CORTANA_COMMAS_API_KEY: "test-only", ADAPTERS_DRY_RUN: "off" };
const invoice = { id: "inv-1", org_id: "org-1", client_id: "cl-1", source: "funding_success_fee" };
const link = (over = {}) => ({
  id: "link-1", org_id: "org-1", client_id: "cl-1", invoice_id: "inv-1",
  provider: "commas", status: "sent", amount_cents: 60000,
  commas_session_id: "NLxj6",
  checkout_url: "https://www.fanbasis.com/agency-checkout/fundhub-1/NLxj6",
  ...over
});

function fakeDb(links = [link()], linkedInvoice = invoice) {
  return {
    links,
    async query(sql, params = []) {
      if (/FROM payment_links pl[\s\S]*JOIN invoices i/.test(sql)) {
        const [id, orgId, invoiceId] = params;
        const hit = links.find((p) => p.id === id && p.org_id === orgId && p.invoice_id === invoiceId &&
          linkedInvoice.id === p.invoice_id && linkedInvoice.org_id === p.org_id && linkedInvoice.client_id === p.client_id &&
          linkedInvoice.source === "funding_success_fee");
        return { rows: hit ? [{ ...hit }] : [] };
      }
      if (/UPDATE payment_links\s+SET status = 'expired'/.test(sql)) {
        const [id, orgId, invoiceId] = params;
        const hit = links.find((p) => p.id === id && p.org_id === orgId && p.invoice_id === invoiceId &&
          ["created", "sent"].includes(p.status));
        if (hit) hit.status = "expired";
        return { rows: hit ? [{ ...hit }] : [] };
      }
      if (/UPDATE payment_links\s+SET provider_retire_verified_at = now\(\)/.test(sql)) {
        const [id, orgId, invoiceId] = params;
        const hit = links.find((p) => p.id === id && p.org_id === orgId && p.invoice_id === invoiceId && p.status === "expired");
        if (hit) hit.provider_retire_verified_at = new Date();
        return { rows: hit ? [{ id: hit.id }] : [] };
      }
      if (/UPDATE payment_links\s+SET status = 'void'/.test(sql)) {
        const [id, orgId, invoiceId] = params;
        const hit = links.find((p) => p.id === id && p.org_id === orgId && p.invoice_id === invoiceId &&
          p.status === "expired");
        if (hit) hit.status = "void";
        return { rows: hit ? [{ id: hit.id }] : [] };
      }
      if (/SELECT id FROM payment_links[\s\S]*status IN/.test(sql)) {
        const [orgId, invoiceId] = params;
        return { rows: links.filter((p) => p.org_id === orgId && p.invoice_id === invoiceId &&
          p.provider === "commas" &&
          ["created", "sent", "expired"].includes(p.status)).map((p) => ({ id: p.id })) };
      }
      throw new Error(`unexpected SQL: ${sql.slice(0, 80)}`);
    }
  };
}

function provider({ get = {}, del = {} } = {}) {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, method: options.method, key: options.headers["x-api-key"] });
    if (options.method === "GET") {
      if (get.httpStatus) return new Response(null, { status: get.httpStatus });
      return new Response(JSON.stringify({ status: "success", data: {
        amount_cents: 60000,
        metadata: { invoice_id: "inv-1", org_id: "org-1", client_id: "cl-1" },
        ...get
      } }), { status: 200 });
    }
    return new Response(JSON.stringify({ status: del.status || "success" }), { status: del.httpStatus || 200 });
  };
  return { calls, fetchImpl };
}

test("invoice checkout retirement GET-verifies then DELETEs the exact saved Commas session", async () => {
  const db = fakeDb();
  const api = provider();
  const out = await retireInvoiceCheckoutLink(db, {
    linkId: "link-1", orgId: "org-1", invoiceId: "inv-1", env, fetchImpl: api.fetchImpl
  });
  assert.equal(out.retired, true);
  assert.deepEqual(api.calls.map((c) => c.method), ["GET", "DELETE"]);
  assert.ok(api.calls.every((c) => c.url.endsWith("/checkout-sessions/NLxj6") && c.key === "test-only"));
  assert.equal(db.links[0].status, "void");
  const replay = await retireInvoiceCheckoutLink(db, {
    linkId: "link-1", orgId: "org-1", invoiceId: "inv-1", env, fetchImpl: api.fetchImpl
  });
  assert.equal(replay.alreadyRetired, true);
  assert.equal(api.calls.length, 2, "a replay must not DELETE twice");
});

test("wrong invoice, Commas ID, or provider metadata cannot delete a checkout", async () => {
  const db = fakeDb();
  const api = provider();
  await assert.rejects(retireInvoiceCheckoutLink(db, {
    linkId: "link-1", orgId: "org-1", invoiceId: "inv-other", env, fetchImpl: api.fetchImpl
  }), /not linked/);
  assert.equal(api.calls.length, 0);

  const badId = fakeDb([link({ commas_session_id: "other" })]);
  await assert.rejects(retireInvoiceCheckoutLink(badId, {
    linkId: "link-1", orgId: "org-1", invoiceId: "inv-1", env, fetchImpl: api.fetchImpl
  }), /does not match its URL/);
  assert.equal(api.calls.length, 0);

  const badProvider = provider({ get: { metadata: { invoice_id: "inv-other" } } });
  await assert.rejects(retireInvoiceCheckoutLink(db, {
    linkId: "link-1", orgId: "org-1", invoiceId: "inv-1", env, fetchImpl: badProvider.fetchImpl
  }), /invoice_id does not match/);
  assert.deepEqual(badProvider.calls.map((c) => c.method), ["GET"]);
  assert.equal(db.links[0].status, "expired", "the unsafe link stays hidden and retryable");
});

test("failed provider deletion stays expired and a later retry can finish", async () => {
  const db = fakeDb();
  const failing = provider({ del: { httpStatus: 503 } });
  await assert.rejects(retireInvoiceCheckoutLink(db, {
    linkId: "link-1", orgId: "org-1", invoiceId: "inv-1", env, fetchImpl: failing.fetchImpl
  }), /deletion failed \(503\)/);
  assert.equal(db.links[0].status, "expired");
  const healthy = provider();
  await retireInvoiceCheckoutLinksForInvoice(db, { orgId: "org-1", invoiceId: "inv-1", env, fetchImpl: healthy.fetchImpl });
  assert.equal(db.links[0].status, "void");
});

test("DELETE 404 after verified GET is an idempotent retirement", async () => {
  const db = fakeDb();
  const api = provider({ del: { httpStatus: 404 } });
  await retireInvoiceCheckoutLink(db, {
    linkId: "link-1", orgId: "org-1", invoiceId: "inv-1", env, fetchImpl: api.fetchImpl
  });
  assert.equal(db.links[0].status, "void");
  assert.ok(db.links[0].provider_retire_verified_at);
});

test("GET 404 only closes a link when an earlier provider GET was durably verified", async () => {
  const db = fakeDb();
  const missing = provider({ get: { httpStatus: 404 } });
  await assert.rejects(retireInvoiceCheckoutLink(db, {
    linkId: "link-1", orgId: "org-1", invoiceId: "inv-1", env, fetchImpl: missing.fetchImpl
  }), /404 without prior verification/);
  assert.equal(db.links[0].status, "expired");
  assert.deepEqual(missing.calls.map((c) => c.method), ["GET"]);

  db.links[0].provider_retire_verified_at = new Date();
  await retireInvoiceCheckoutLink(db, {
    linkId: "link-1", orgId: "org-1", invoiceId: "inv-1", env, fetchImpl: missing.fetchImpl
  });
  assert.equal(db.links[0].status, "void");
  assert.deepEqual(missing.calls.map((c) => c.method), ["GET", "GET"]);
});

test("an up adapter fence keeps the hosted checkout untouched and the local link retryable", async () => {
  const db = fakeDb();
  const api = provider();
  await assert.rejects(retireInvoiceCheckoutLink(db, {
    linkId: "link-1", orgId: "org-1", invoiceId: "inv-1",
    env: { ...env, ADAPTERS_DRY_RUN: "on" }, fetchImpl: api.fetchImpl
  }), /lookup held/);
  assert.deepEqual(api.calls, [], "the fence must stop both provider GET and DELETE");
  assert.equal(db.links[0].status, "expired", "local status stays hidden and retryable");
});

test("non-fee and Whop links never call the Commas API", async () => {
  const api = provider();
  const otherInvoice = fakeDb([link()], { ...invoice, source: "deposit" });
  await assert.rejects(retireInvoiceCheckoutLink(otherInvoice, {
    linkId: "link-1", orgId: "org-1", invoiceId: "inv-1", env, fetchImpl: api.fetchImpl
  }), /not linked/);
  const whop = fakeDb([link({ provider: "whop" })]);
  await assert.rejects(retireInvoiceCheckoutLink(whop, {
    linkId: "link-1", orgId: "org-1", invoiceId: "inv-1", env, fetchImpl: api.fetchImpl
  }), /not an open Commas/);
  assert.equal(api.calls.length, 0);
});

test("closing an invoice skips another provider's link and retires its Commas checkout", async () => {
  const whop = link({ id: "link-whop", provider: "whop", commas_session_id: null });
  const commas = link();
  const db = fakeDb([whop, commas]);
  const api = provider();
  const out = await retireInvoiceCheckoutLinksForInvoice(db, {
    orgId: "org-1", invoiceId: "inv-1", env, fetchImpl: api.fetchImpl
  });
  assert.equal(out.retired, 1);
  assert.equal(whop.status, "sent");
  assert.equal(commas.status, "void");
  assert.deepEqual(api.calls.map((call) => call.method), ["GET", "DELETE"]);
});
