// The dry-run fence, proved at the dispatcher and at the adapters.
//
// THE ASSERTION THAT MATTERS IS `f.calls.length === 0`. Everything else in here
// is bookkeeping. A message marked "held" that still hit the network is not
// held, and the outcome code would happily lie about it — so every test below
// checks the transport spy, not the status field.
//
// The old fence had no test at all. It was set to the wrong string in
// production for an unknown length of time and nothing failed, because nothing
// ever asked. That is the gap this file closes.

import { test, describe, beforeEach } from "node:test";
import assert from "node:assert";

import { dispatchOne, OUTCOME } from "./dispatch.mjs";
import { clearRuleCache } from "../compliance/screen.mjs";
import { submitApplication } from "../adapters/lendflow.mjs";
import { findOrCreateCrmContact } from "./crm-contacts.mjs";

const ORG = "00000000-0000-4000-8000-000000000001";
const CLIENT = "00000000-0000-4000-8000-000000000003";
const MSG = "00000000-0000-4000-8000-000000000004";

// Midday Arizona, so nothing lands inside quiet hours and defers for the wrong
// reason — a deferral would also show zero calls and prove nothing.
const MIDDAY = () => new Date("2026-08-01T16:00:00Z");

const claimed = (over = {}) => ({
  id: MSG, org_id: ORG, client_id: CLIENT, channel: "email",
  rendered_body: "Your documents were received.",
  template_key: "E-01", provider_ref: "workflow:E-01:evt1", attempts: 1,
  ...over
});

function fakeDb({
  routing = { email: { provider: "mailgun", enabled: true }, sms: { provider: "ghl_relay", enabled: true } },
  client = { email: "person@example.com", ghl_contact_id: "crmContact123", phone: "+15551234567" }
} = {}) {
  const updates = [];
  return {
    updates,
    query: async (sql, params) => {
      if (sql.includes("FROM opt_outs")) return { rows: [] };
      if (sql.includes("FROM compliance_rules")) return { rows: [] };
      if (sql.includes("FROM message_channel_routing")) {
        const r = routing[params[1]];
        return { rows: r ? [r] : [] };
      }
      if (sql.includes("FROM message_templates")) return { rows: [{ subject: "Your file" }] };
      if (sql.includes("SELECT custom_fields FROM clients")) return { rows: [{ custom_fields: null }] };
      /* The dispatcher asks whether an authorized representative should get the
         message instead (src/auth/authorized-rep.mjs destinationAddress, added
         2026-09-27 in 73da2679c). No rep on file here, so the client's own
         address is used. Without this answer the fake threw, the dispatcher
         retried, and the fence-DOWN tests saw zero sends for the wrong reason. */
      if (sql.includes("FROM client_authorized_reps")) return { rows: [] };
      if (sql.includes("FROM clients")) {
        const col = /SELECT (\w+) AS address/.exec(sql)?.[1];
        return { rows: [{ address: client[col] ?? null }] };
      }
      if (sql.includes("FROM tasks")) return { rows: [] };
      if (sql.includes("INSERT INTO tasks")) return { rows: [{ id: "t1" }] };
      if (sql.startsWith("UPDATE messages m")) return { rows: [] };
      if (sql.includes("UPDATE messages")) { updates.push({ sql, params }); return { rows: [] }; }
      throw new Error(`unexpected query: ${sql.slice(0, 70)}`);
    }
  };
}

/** The transport spy. Zero calls is the proof. */
function spy() {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return { ok: true, status: 200, text: async () => JSON.stringify({ id: "prov1" }) };
  };
  fetchImpl.calls = calls;
  return fetchImpl;
}

const CREDS = {
  MAILGUN_SEND_API_KEY: "key-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  MAILGUN_SEND_DOMAIN: "mg.example.com",
  MAILGUN_SEND_FROM: "Fundhub <no-reply@mg.example.com>",
  GHL_RELAY_API_KEY: "crm-token",
  // Twilio is the live SMS path (the CRM stubbed off, owner 2026-08-14). Fence
  // tests that prove SMS bookkeeping need a transmitting provider.
  TWILIO_SEND_ACCOUNT_SID: "ACaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  TWILIO_SEND_AUTH_TOKEN: "twilio-auth-token-value",
  TWILIO_SEND_FROM: "+15550001111"
};

const withFence = (value) =>
  (value === undefined ? { ...CREDS } : { ...CREDS, MESSAGING_DRY_RUN: value });

beforeEach(() => clearRuleCache());

describe("MESSAGING_DRY_RUN: nothing reaches the sender", () => {
  /* Every value here is one somebody could plausibly set, including the two
     that actually mattered: unset (a deploy that forgot) and "true" (what was
     really in production while the code compared against "1"). */
  for (const value of [undefined, "1", "true", "TRUE", "yes", "on", "", "maybe"]) {
    const label = value === undefined ? "unset" : JSON.stringify(value);

    test(`fence up with ${label} — the transport is never called`, async () => {
      const f = spy();
      const db = fakeDb();
      const res = await dispatchOne(db, claimed(), {
        fetchImpl: f, env: withFence(value), now: MIDDAY
      });

      assert.strictEqual(f.calls.length, 0,
        `A MESSAGE WAS TRANSMITTED WITH THE FENCE AT ${label}`);
      assert.strictEqual(res.outcome, OUTCOME.DRY_RUN);
    });
  }

  test("an explicit off value is the one thing that lets it through", async () => {
    const f = spy();
    const db = fakeDb();
    const res = await dispatchOne(db, claimed(), {
      fetchImpl: f, env: withFence("0"), now: MIDDAY
    });

    assert.strictEqual(f.calls.length, 1, "the fence was down but nothing was sent");
    assert.strictEqual(res.outcome, OUTCOME.SENT);
    assert.match(f.calls[0].url, /mailgun|api\.mailgun/);
  });

  test("every off spelling works, so nobody has to guess", async () => {
    for (const off of ["0", "false", "no", "off", "FALSE"]) {
      const f = spy();
      const res = await dispatchOne(fakeDb(), claimed(), {
        fetchImpl: f, env: withFence(off), now: MIDDAY
      });
      assert.strictEqual(f.calls.length, 1, `${off} should have permitted the send`);
      assert.strictEqual(res.outcome, OUTCOME.SENT);
    }
  });

  test("the SMS path is fenced too, not just email", async () => {
    // CRM relay is stubbed (TRANSMITS=false) — the dry-run fence only gates
    // transmitting providers. Prove SMS bookkeeping via Twilio, the live path.
    const f = spy();
    const db = fakeDb({
      routing: {
        email: { provider: "mailgun", enabled: true },
        sms: { provider: "twilio", enabled: true }
      }
    });
    const res = await dispatchOne(db, claimed({ channel: "sms" }), {
      fetchImpl: f, env: withFence("1"), now: MIDDAY
    });

    assert.strictEqual(f.calls.length, 0, "AN SMS WAS TRANSMITTED THROUGH TWILIO");
    assert.strictEqual(res.outcome, OUTCOME.DRY_RUN);
  });

  test("a held message goes back on the queue and keeps its attempt", async () => {
    // The fence is a property of the deployment, not of the message. Turning it
    // off has to release the backlog — if these were recorded as failures, a day
    // of safe testing would quietly destroy a day of queued mail.
    const db = fakeDb();
    await dispatchOne(db, claimed(), { fetchImpl: spy(), env: withFence("1"), now: MIDDAY });

    const write = db.updates.at(-1);
    assert.ok(write, "nothing was written for the held message");
    assert.match(write.sql, /status = 'queued'/);
    assert.match(write.sql, /attempts = GREATEST\(attempts - 1, 0\)/);
  });

  test("the reason recorded names the variable, so an operator can fix it", async () => {
    const db = fakeDb();
    const res = await dispatchOne(db, claimed(), {
      fetchImpl: spy(), env: withFence(undefined), now: MIDDAY
    });
    assert.match(res.detail, /MESSAGING_DRY_RUN/);
  });
});

describe("ADAPTERS_DRY_RUN: nothing reaches a vendor", () => {
  const LENDFLOW = {
    LENDFLOW_API_KEY: "lf-key",
    LENDFLOW_BASE_URL: "https://api.lendflow.test"
  };

  /* A payload complete enough to pass validation. It has to be: a submission
     rejected for a missing field also shows zero calls, and would prove nothing
     about the fence. */
  const application = () => ({
    client: {
      id: CLIENT, first_name: "A", last_name: "B",
      email: "a@b.com", phone: "+15551234567", business_name: "B LLC"
    },
    round: { id: "r1", round_number: 1, submitted_amount: 50000 },
    business: { name: "B LLC", ein: "12-3456789", state: "TX", annual_revenue: 250000 }
  });

  test("a funding application is not submitted with the fence up", async () => {
    const f = spy();
    const res = await submitApplication({ ...application(), env: { ...LENDFLOW }, fetchImpl: f });

    assert.strictEqual(f.calls.length, 0, "AN APPLICATION WAS SUBMITTED TO A REAL LENDER");
    assert.strictEqual(res.ok, false);
    assert.match(res.reason, /dry_run_blocked/,
      "blocked for some other reason — this test is no longer proving the fence");
  });

  test("the same application does go out when the fence is explicitly off", async () => {
    // The mirror of the test above. Without it, a submission broken for an
    // unrelated reason would still look like a working fence.
    const f = spy();
    await submitApplication({
      ...application(),
      env: { ...LENDFLOW, ADAPTERS_DRY_RUN: "0" },
      fetchImpl: f
    });
    assert.strictEqual(f.calls.length, 1, "the fence was down but nothing was submitted");
  });

  test("a CRM contact is not created with the fence up", async () => {
    const f = spy();
    const res = await findOrCreateCrmContact(
      { email: "person@example.com", firstName: "A", lastName: "B" },
      { fetchImpl: f, env: { GHL_API_KEY: "crm-token" } }
    );

    assert.strictEqual(f.calls.length, 0, "A REAL PERSON WAS WRITTEN INTO THE CRM");
    assert.strictEqual(res.ok, false);
    assert.strictEqual(res.reason, "dry_run_blocked");
  });

  test("the two fences are independent — messaging off does not open adapters", async () => {
    const f = spy();
    const res = await findOrCreateCrmContact(
      { email: "person@example.com" },
      { fetchImpl: f, env: { GHL_API_KEY: "t", MESSAGING_DRY_RUN: "0" } }
    );

    assert.strictEqual(f.calls.length, 0,
      "TURNING OFF THE MESSAGING FENCE ALSO OPENED THE ADAPTER FENCE");
    assert.strictEqual(res.reason, "dry_run_blocked");
  });
});

describe("the fence cannot be reached around", () => {
  test("supplying a fake transport does not imply permission", async () => {
    // An injected fetchImpl used to read as "this is a test, let it through".
    // It must not: the same injection is how production code passes its own
    // client, and a transport-shaped bypass is a bypass.
    const f = spy();
    await dispatchOne(fakeDb(), claimed(), {
      fetchImpl: f, env: withFence("1"), now: MIDDAY
    });
    assert.strictEqual(f.calls.length, 0, "an injected transport bypassed the fence");
  });

  test("an undeclared fence is refused rather than allowed", async () => {
    const { transmit } = await import("../lib/outbound-fetch.mjs");
    const f = spy();
    const res = await transmit("https://example.test/x", { method: "POST" },
      { fetchImpl: f, env: { MESSAGING_DRY_RUN: "0", ADAPTERS_DRY_RUN: "0" } });

    assert.strictEqual(f.calls.length, 0, "a call with no declared fence went out");
    assert.strictEqual(res.blocked, true);
    assert.match(res.error, /no fence declared/);
  });
});
