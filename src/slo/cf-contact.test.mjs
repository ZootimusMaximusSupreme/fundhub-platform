import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSloCfContact, syncSloClickfunnelsContact } from "./cf-contact.mjs";

const PERSON = {
  email: "buyer@example.com",
  firstName: "Ada",
  lastName: "Buyer",
  phone: "+16615550100",
  ssn: "123-45-6789",
  dob: "1990-01-02",
  address: {
    addressLine1: "100 Main St",
    addressLine2: "Apt 2",
    city: "Denton",
    state: "TX",
    postalCode: "76205"
  },
  businesses: [{ name: "Ada Hauling", ein: "12-3456789" }]
};

test("contact payload has name, phone, address, and business — never SSN, DOB, or EIN", () => {
  const contact = buildSloCfContact(PERSON);
  const raw = JSON.stringify(contact);
  assert.equal(contact.email_address, "buyer@example.com");
  assert.equal(contact.first_name, "Ada");
  assert.equal(contact.last_name, "Buyer");
  assert.equal(contact.phone_number, "+16615550100");
  assert.equal(contact.custom_attributes.address, "100 Main St, Apt 2");
  assert.equal(contact.custom_attributes.city, "Denton");
  assert.equal(contact.custom_attributes.state, "TX");
  assert.equal(contact.custom_attributes.zip, "76205");
  assert.equal(contact.custom_attributes.business_name, "Ada Hauling");
  assert.equal(raw.includes("123-45-6789"), false);
  assert.equal(raw.includes("1990-01-02"), false);
  assert.equal(raw.includes("12-3456789"), false);
  assert.equal(raw.includes("ssn"), false);
  assert.equal(raw.includes("ein"), false);
});

test("prequal dollars ride along when the pull has finished", () => {
  const contact = buildSloCfContact({ email: "buyer@example.com", prequal: 212000 });
  assert.equal(contact.custom_attributes.prequal_amount, "212000");
  assert.equal(contact.first_name, undefined);
});

test("no email means no contact", () => {
  assert.equal(buildSloCfContact({ firstName: "Ada" }), null);
});

test("missing API key skips the call", async () => {
  let called = false;
  const out = await syncSloClickfunnelsContact(PERSON, {
    env: {},
    fetchImpl: async () => { called = true; return { ok: true, status: 200, text: async () => "{}" }; }
  });
  assert.equal(out.skipped, true);
  assert.equal(called, false);
});

test("upsert posts the safe contact and keeps the pull alive when ClickFunnels refuses", async () => {
  const calls = [];
  const ok = await syncSloClickfunnelsContact(PERSON, {
    env: {
      CLICKFUNNELS_API_KEY: "test-key",
      CLICKFUNNELS_SUBDOMAIN: "myworkspace",
      CLICKFUNNELS_WORKSPACE_ID: "42",
      ADAPTERS_DRY_RUN: "0"
    },
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ id: 99, email_address: "buyer@example.com" }),
        headers: { get: () => null }
      };
    }
  });
  assert.equal(ok.id, 99);
  assert.match(calls[0].url, /\/workspaces\/42\/contacts\/upsert$/);
  const sent = JSON.parse(calls[0].init.body);
  assert.equal(JSON.stringify(sent).includes("123-45-6789"), false);

  const refused = await syncSloClickfunnelsContact(PERSON, {
    env: {
      CLICKFUNNELS_API_KEY: "test-key",
      CLICKFUNNELS_SUBDOMAIN: "myworkspace",
      CLICKFUNNELS_WORKSPACE_ID: "42",
      ADAPTERS_DRY_RUN: "0"
    },
    fetchImpl: async () => ({
      ok: false,
      status: 422,
      text: async () => JSON.stringify({ error: "nope" }),
      headers: { get: () => null }
    })
  });
  assert.equal(refused.ok, false);
  assert.equal(refused.error, "clickfunnels_refused");
});

/* THE DRY-RUN SWITCH HOLDS THIS WRITE (2026-10-05). The upsert sends a
   person's details to a vendor, so it goes through the ADAPTERS fence like
   every other vendor write. Unset or "1" holds it: nothing reaches the
   network, and the result says "held", not "refused". Before this, the
   upsert's fetch went out no matter what ADAPTERS_DRY_RUN said. */
test("ADAPTERS_DRY_RUN holds the upsert — nothing is sent, and it says held", async () => {
  for (const dry of [undefined, "1", "true"]) {
    const calls = [];
    const env = { CLICKFUNNELS_API_KEY: "test-key", CLICKFUNNELS_SUBDOMAIN: "myworkspace", CLICKFUNNELS_WORKSPACE_ID: "42" };
    if (dry !== undefined) env.ADAPTERS_DRY_RUN = dry;
    const out = await syncSloClickfunnelsContact(PERSON, {
      env,
      fetchImpl: async (url, init) => { calls.push({ url, init }); return { ok: true, status: 200, text: async () => "{}" }; }
    });
    assert.equal(calls.length, 0, `a ClickFunnels write went out with ADAPTERS_DRY_RUN=${dry}`);
    assert.deepEqual(out, { ok: false, held: true, error: "held_by_dry_run" });
  }
});

test("a skip says why, so the step-1 save can record it", async () => {
  const noEmail = await syncSloClickfunnelsContact({ firstName: "Ada" }, { env: {} });
  assert.deepEqual(noEmail, { ok: false, skipped: true, reason: "no_email" });
  const noKey = await syncSloClickfunnelsContact(PERSON, { env: { CLICKFUNNELS_SUBDOMAIN: "x" } });
  assert.deepEqual(noKey, { ok: false, skipped: true, reason: "no_credentials" });
});

test("a refusal carries ClickFunnels' own words and status, never the key", async () => {
  const out = await syncSloClickfunnelsContact(PERSON, {
    env: { CLICKFUNNELS_API_KEY: "secret-key-123", CLICKFUNNELS_SUBDOMAIN: "myworkspace", CLICKFUNNELS_WORKSPACE_ID: "42", ADAPTERS_DRY_RUN: "0" },
    fetchImpl: async () => ({
      ok: false,
      status: 401,
      text: async () => JSON.stringify({ error: "Bad token secret-key-123" }),
      headers: { get: () => null }
    })
  });
  assert.equal(out.ok, false);
  assert.equal(out.error, "clickfunnels_refused");
  assert.equal(out.status, 401);
  assert.match(out.message, /Bad token/);
  assert.equal(JSON.stringify(out).includes("secret-key-123"), false);
});

/* ClickFunnels' upsert, as its docs describe it: "Creates or updates a
   Contact, matching on the email address", and an empty value never clears a
   field. https://developers.myclickfunnels.com/reference/upsertcontacts */
function upsertingClickfunnels() {
  const contacts = new Map();
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, method: init.method, body: JSON.parse(init.body) });
    const c = JSON.parse(init.body).contact;
    const prev = contacts.get(c.email_address) || { id: 500 + contacts.size };
    const next = { ...prev };
    for (const [k, v] of Object.entries(c)) {
      if (v == null || v === "") continue;
      next[k] = k === "custom_attributes" ? { ...(prev.custom_attributes || {}), ...v } : v;
    }
    contacts.set(c.email_address, next);
    return { ok: true, status: 200, text: async () => JSON.stringify(next), headers: { get: () => null } };
  };
  return { contacts, calls, fetchImpl };
}

test("step 1 (email, then phone) and step 3 land on one ClickFunnels contact", async () => {
  const cf = upsertingClickfunnels();
  const opts = {
    env: { CLICKFUNNELS_API_KEY: "k", CLICKFUNNELS_SUBDOMAIN: "myworkspace", CLICKFUNNELS_WORKSPACE_ID: "42", ADAPTERS_DRY_RUN: "0" },
    fetchImpl: cf.fetchImpl
  };
  // Step 1, email alone (api/public/slo-interest.mjs lower-cases it).
  const a = await syncSloClickfunnelsContact({ email: "ada@gmail.com", firstName: null, lastName: null, phone: null }, opts);
  // Step 1, phone and name typed a moment later.
  const b = await syncSloClickfunnelsContact({ email: "ada@gmail.com", firstName: "Ada", lastName: "Buyer", phone: "+16615550100" }, opts);
  // Step 3, the shape src/slo/pull.mjs sends (email from the client row, lower case).
  const c = await syncSloClickfunnelsContact({ ...PERSON, email: "ada@gmail.com" }, opts);

  assert.equal(a.id, 500);
  assert.equal(b.id, 500);
  assert.equal(c.id, 500);
  assert.equal(cf.contacts.size, 1, "one contact, not three");
  assert.ok(cf.calls.every((x) => x.method === "POST" && /\/workspaces\/42\/contacts\/upsert$/.test(x.url)),
    "every write is the email-matched upsert, never a create");
  assert.deepEqual(cf.calls[0].body, { contact: { email_address: "ada@gmail.com" } });
  const final = cf.contacts.get("ada@gmail.com");
  assert.equal(final.first_name, "Ada");
  assert.equal(final.phone_number, "+16615550100");
  assert.equal(final.custom_attributes.business_name, "Ada Hauling");
  assert.equal(JSON.stringify(cf.calls).includes("123-45-6789"), false);
});
