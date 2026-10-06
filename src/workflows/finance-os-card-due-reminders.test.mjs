// Finance OS card due reminders — the daily sweep. Stubbed db, Plaid sync,
// reminder store and send; nothing is queued for real and nothing transmits.
import { test, describe } from "node:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";

import { sweep, remindClient, SWEEP_CRON } from "./finance-os-card-due-reminders.mjs";
import { renderTemplate } from "../lib/render-template.mjs";
import { TEMPLATE_KEY } from "../banking/card-due-reminders.mjs";

const ORG = "org-1", CLIENT = "client-1";
const NOW = new Date("2026-10-18T16:00:00.000Z");

const CARD = {
  cycle_id: "cy-1", bank_account_id: "ba-1", name: "Business Amex", mask: "4404",
  minimum_payment_cents: "13500", last_statement_balance_cents: "540000",
  last_statement_date: "2026-09-26",
  raw: { next_payment_due_date: "2026-10-21", last_payment_date: "2026-09-20" }
};
const PAID = { ...CARD, cycle_id: "cy-2", bank_account_id: "ba-2", name: "Chase Ink",
  raw: { next_payment_due_date: "2026-10-20", last_payment_date: "2026-10-02" } };

function stubDb({ entitled = [{ org_id: ORG, client_id: CLIENT }], cycles = [CARD, PAID] } = {}) {
  const seen = [];
  return {
    seen,
    async query(sql, params) {
      seen.push(sql);
      if (/FROM subscriptions/.test(sql)) return { rows: entitled };
      if (/FROM account_statement_cycles/.test(sql)) {
        assert.match(sql, /c\.source = 'provider'/);
        assert.deepEqual(params, [ORG, CLIENT]);
        return { rows: cycles };
      }
      throw new Error(`unexpected sql: ${sql}`);
    }
  };
}

/* Stand-ins that keep the same keys the real ones dedupe on. */
function stubStore() {
  const reminders = new Map();
  const queued = new Map();
  return {
    reminders, queued,
    createReminder: async (_db, r) => {
      const key = [r.orgId, r.clientId, r.subjectKind, r.subjectId, r.reminderKind, r.surfaceAt].join("|");
      if (reminders.has(key)) return { reminder: reminders.get(key), created: false };
      reminders.set(key, r);
      return { reminder: r, created: true };
    },
    send: async (_db, s) => {
      const ref = `workflow:${s.templateKey}:${s.eventId}`;
      if (!queued.has(ref)) queued.set(ref, s);
      return { sent: true };
    }
  };
}

const okSync = async () => ({ ok: true, written: 2, items: [{ itemRowId: "i1", ok: true }] });

describe("finance-os-card-due-reminders sweep", () => {
  test("daily cron at 16:00 UTC", () => {
    assert.equal(SWEEP_CRON, "0 16 * * *");
  });

  test("syncs, then reminds the unpaid card due in 3 days — and not the paid one", async () => {
    const store = stubStore();
    let synced;
    const tally = await sweep(stubDb(), {
      now: NOW, env: {}, ...store,
      sync: async (_db, args) => { synced = args; return okSync(); }
    });
    assert.equal(synced.orgId, ORG);
    assert.equal(synced.asOf, NOW.toISOString());
    assert.equal(tally.checked, 1);
    assert.equal(tally.synced, 2);
    assert.equal(tally.reminded, 1);
    assert.equal(tally.queued, 1);
    assert.equal(store.reminders.size, 1);
    const [r] = [...store.reminders.values()];
    assert.equal(r.subjectKind, "card_liability");
    assert.equal(r.subjectId, "ba-1");
    assert.equal(r.reminderKind, "payment_due");
    assert.equal(r.body, "Fundhub reminder: your Business Amex payment of $135.00 is due Oct 21.");
    const [s] = [...store.queued.values()];
    assert.equal(s.channel, "sms");
    assert.equal(s.templateKey, TEMPLATE_KEY);
    assert.equal(s.clientId, CLIENT);
  });

  test("never more than one reminder or text per card per due date across daily passes", async () => {
    const store = stubStore();
    for (const day of ["2026-10-18", "2026-10-19", "2026-10-20", "2026-10-21"]) {
      await sweep(stubDb(), { now: new Date(`${day}T16:00:00.000Z`), env: {}, ...store, sync: okSync });
    }
    assert.equal(store.reminders.size, 1);
    assert.equal(store.queued.size, 1);
  });

  test("claims the reminder BEFORE queueing the text", async () => {
    const order = [];
    await remindClient(stubDb({ cycles: [CARD] }), {
      orgId: ORG, clientId: CLIENT, todayIso: "2026-10-18",
      createReminder: async () => { order.push("claim"); return { created: true }; },
      send: async () => { order.push("queue"); return { sent: true }; }
    });
    assert.deepEqual(order, ["claim", "queue"]);
  });

  test("an opted-out client: sendTemplated's refusal is reported, not retried", async () => {
    const r = await remindClient(stubDb({ cycles: [CARD] }), {
      orgId: ORG, clientId: CLIENT, todayIso: "2026-10-18",
      createReminder: async () => ({ created: true }),
      send: async () => ({ sent: false, reason: "opted_out" })
    });
    assert.equal(r.queued, 0);
    assert.deepEqual(r.notQueued, [{ bankAccountId: "ba-1", reason: "opted_out" }]);
  });

  test("not entitled → nothing read, nothing sent", async () => {
    const store = stubStore();
    const tally = await sweep(stubDb({ entitled: [] }), {
      now: NOW, env: {}, ...store, sync: async () => assert.fail("must not sync")
    });
    assert.equal(tally.checked, 0);
    assert.equal(store.queued.size, 0);
  });

  test("a Plaid failure for one client is tallied; stored cards still get reminded", async () => {
    const store = stubStore();
    const tally = await sweep(stubDb({ cycles: [CARD] }), {
      now: NOW, env: {}, ...store,
      sync: async () => ({ ok: true, written: 0, items: [{ itemRowId: "i1", ok: false, errorCode: "PRODUCTS_NOT_SUPPORTED" }] })
    });
    assert.deepEqual(tally.syncErrors, [{ clientId: CLIENT, itemRowId: "i1", errorCode: "PRODUCTS_NOT_SUPPORTED" }]);
    assert.equal(tally.queued, 1);
  });

  test("one client throwing does not stop the pass", async () => {
    const db = stubDb({ entitled: [{ org_id: ORG, client_id: "boom" }, { org_id: ORG, client_id: CLIENT }] });
    const store = stubStore();
    const tally = await sweep(db, {
      now: NOW, env: {}, ...store,
      sync: async (_db, { clientId }) => { if (clientId === "boom") throw new Error("db down"); return okSync(); }
    });
    assert.equal(tally.errored.length, 1);
    assert.equal(tally.errored[0].clientId, "boom");
  });
});

describe("migration 433 template", () => {
  const sql = readFileSync(new URL("../../db/migrations/433_finance_os_card_due_template.sql", import.meta.url), "utf8");
  const body = sql.match(/\$c\$([\s\S]*?)\$c\$/)[1];

  test("seeds the key the workflow sends, as an approved sms template", () => {
    assert.ok(sql.includes(`'${TEMPLATE_KEY}'`));
    assert.match(sql, /'sms'/);
    assert.match(sql, /ON CONFLICT \(org_id, template_key\) DO NOTHING/);
  });

  test("renders to the owner's wording, spelled Fundhub, with the opt-out line", () => {
    const out = renderTemplate(body, { card: { name: "Business Amex", amount_phrase: " of $135.00", due_phrase: "Oct 21" } });
    assert.equal(out, "Fundhub reminder: your Business Amex payment of $135.00 is due Oct 21. Reply STOP to opt out.");
    assert.equal(/FundHub/.test(body), false);
  });
});
