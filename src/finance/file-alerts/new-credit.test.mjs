// Alert 4 — new credit. Pure: no database, no clock.
import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { planNewAccounts, diffCreditPulls, planNewPull } from "./new-credit.mjs";
import { TEMPLATES, NEW_ACCOUNT_BASELINE_MINUTES, NEW_CREDIT_LOOKBACK_DAYS } from "./common.mjs";

/* ------------------------------------------------------------------ *
 * (a) a new Plaid account on a linked login
 * ------------------------------------------------------------------ */

const NOW = new Date("2026-10-08T12:00:00.000Z");
const ITEM_AT = "2026-10-01T10:00:00.000Z";
const acct = (over = {}) => ({
  id: "a1", account_type: "credit", name: "Chase Freedom", mask: "4321", closed_at: null,
  plaid_item_id: "item-1", item_created_at: ITEM_AT, created_at: "2026-10-07T09:00:00.000Z", ...over
});

describe("planNewAccounts — a card or loan that appeared after the login was first read", () => {
  test("a new card: the text, the key, and the task for a Blueprint file", () => {
    const { alerts } = planNewAccounts([acct()], { now: NOW });
    assert.equal(alerts.length, 1);
    const a = alerts[0];
    assert.equal(a.kind, "new_credit");
    assert.equal(a.key, "fpa:new:acct:a1");
    assert.equal(a.templateKey, TEMPLATES.new_credit);
    assert.equal(a.bankAccountId, "a1");
    assert.equal(
      a.body,
      "Fundhub alert: a new card showed up on your linked accounts: Chase Freedom ending 4321. " +
      "New credit can push back your next funding sequence. If this is not yours, reply and tell us."
    );
    assert.doesNotMatch(a.body, /round two|round 2/i);
    assert.match(a.task.title, /New credit showed up/);
    assert.ok(a.task.body.startsWith("fpa:new:acct:a1\n"), "the task body leads with the key — that is its dedupe value");
    assert.deepEqual(a.detail.items, [{ source: "plaid_account", type: "card", name: "Chase Freedom", last4: "4321", account_id: "a1" }]);
  });

  test("a new loan reads 'loan'", () => {
    const { alerts } = planNewAccounts([acct({ account_type: "loan", name: "SBA Express", mask: null })], { now: NOW });
    assert.match(alerts[0].body, /a new loan showed up on your linked accounts: SBA Express\./);
  });

  test("the accounts the login's FIRST read brought in are the baseline, not new credit — even when they are brand new", () => {
    assert.equal(NEW_ACCOUNT_BASELINE_MINUTES, 60);
    // The client linked their bank yesterday morning: every account is recent, and none is new credit.
    const linked = "2026-10-07T09:00:00.000Z";
    const first = acct({ id: "a1", mask: "3333", item_created_at: linked, created_at: "2026-10-07T09:00:30.000Z" });
    const edge = acct({ id: "a2", mask: "1111", item_created_at: linked, created_at: "2026-10-07T10:00:00.000Z" }); // exactly 60 minutes
    const after = acct({ id: "a3", mask: "2222", item_created_at: linked, created_at: "2026-10-07T10:00:01.000Z" }); // one second past
    const r = planNewAccounts([first, edge, after], { now: NOW });
    assert.deepEqual(r.alerts.map((x) => x.bankAccountId), ["a3"]);
    assert.deepEqual(r.skipped.filter((s) => s.reason === "first_read_of_the_login").map((s) => s.accountId).sort(), ["a1", "a2"]);
  });

  test("an account on a login whose own date is unknown cannot be called new", () => {
    const r = planNewAccounts([acct({ item_created_at: null })], { now: NOW });
    assert.equal(r.alerts.length, 0);
    assert.deepEqual(r.skipped, [{ accountId: "a1", reason: "created_date_unknown" }]);
  });

  test("only a recent arrival alerts: a backlog from before this shipped stays quiet", () => {
    assert.equal(NEW_CREDIT_LOOKBACK_DAYS, 3);
    const old = acct({ created_at: "2026-10-04T09:00:00.000Z" }); // 4+ days old
    const r = planNewAccounts([old], { now: NOW });
    assert.equal(r.alerts.length, 0);
    assert.deepEqual(r.skipped, [{ accountId: "a1", reason: "too_old_to_alert" }]);
  });

  test("not a card or loan, closed, hand-typed or undated: no alert, and each says why", () => {
    const r = planNewAccounts([
      acct({ id: "dep", account_type: "depository" }),
      acct({ id: "closed", closed_at: "2026-10-07T00:00:00Z", mask: "1" }),
      acct({ id: "manual", plaid_item_id: null, item_created_at: null, mask: "2" }),
      acct({ id: "nodate", created_at: null, mask: "3" })
    ], { now: NOW });
    assert.equal(r.alerts.length, 0);
    assert.deepEqual(r.skipped.map((s) => `${s.accountId}:${s.reason}`).sort(), [
      "closed:closed", "manual:not_on_a_linked_login", "nodate:created_date_unknown"
    ]);
  });

  test("a login linked a second time brings the same cards back: not new", () => {
    const original = acct({ id: "orig", created_at: "2026-10-01T10:00:20.000Z", closed_at: "2026-10-07T08:00:00Z" });
    const relinked = acct({ id: "again", created_at: "2026-10-07T09:00:00.000Z" });
    const r = planNewAccounts([original, relinked], { now: NOW });
    assert.equal(r.alerts.length, 0);
    assert.ok(r.skipped.some((s) => s.accountId === "again" && s.reason === "same_account_linked_again"));
  });

  test("a card an earlier alert already named (from the credit pull) is not announced twice", () => {
    const r = planNewAccounts([acct()], { now: NOW, knownLast4: new Set(["4321"]) });
    assert.equal(r.alerts.length, 0);
    assert.deepEqual(r.skipped, [{ accountId: "a1", reason: "already_alerted" }]);
  });

  test("an account with no last four cannot be matched, so it is announced", () => {
    assert.equal(planNewAccounts([acct({ mask: null })], { now: NOW }).alerts.length, 1);
  });
});

/* ------------------------------------------------------------------ *
 * (b) between two credit pulls
 * ------------------------------------------------------------------ */

const line = (over = {}) => ({
  accountType: "Revolving", creditorName: "Credit One Bank", accountIdentifier: "SIM-CRED1-3018",
  accountOpenedDate: "2022-09-14", ...over
});
const pull = (tradelines, inquiries = [], extra = {}) => ({ tradelines, inquiries, ...extra });
const PREV_ON = "2026-09-08";

describe("diffCreditPulls — new accounts", () => {
  const base = [line(), line({ creditorName: "Chase", accountIdentifier: "XX-7788", accountOpenedDate: "2020-01-05" })];

  test("an identical file is no news", () => {
    const d = diffCreditPulls(pull(base), pull(base), { prevOn: PREV_ON });
    assert.equal(d.comparable, true);
    assert.deepEqual([d.tradelines, d.inquiries, d.unknown], [[], [], 0]);
  });

  test("a card on the new file that was not on the old one", () => {
    const fresh = line({ creditorName: "Capital One", accountIdentifier: "CAP-5566", accountOpenedDate: "2026-09-20" });
    const d = diffCreditPulls(pull(base), pull([...base, fresh]), { prevOn: PREV_ON });
    assert.equal(d.tradelines.length, 1);
    assert.deepEqual(d.tradelines[0], {
      source: "credit_pull", type: "card", creditor: "Capital One", opened: "2026-09-20", last4: "5566", print: "o:2026-09-20|n:5566"
    });
  });

  test("A BUREAU RENAMING A CREDITOR IS NOT A NEW CARD (the 2026-09-06 measurement)", () => {
    const renamed = [line({ creditorName: "CREDIT ONE BANK N.A." }), base[1]];
    const d = diffCreditPulls(pull(base), pull(renamed), { prevOn: PREV_ON });
    assert.deepEqual(d.tradelines, []);
  });

  test("a card with no print — no opened date, or no four digits — is UNKNOWN, never new", () => {
    const noDate = line({ creditorName: "Mystery", accountIdentifier: "AAAA-1234", accountOpenedDate: null });
    const noDigits = line({ creditorName: "Other", accountIdentifier: "ABC", accountOpenedDate: "2026-09-20" });
    const d = diffCreditPulls(pull(base), pull([...base, noDate, noDigits]), { prevOn: PREV_ON });
    assert.deepEqual(d.tradelines, []);
    assert.equal(d.unknown, 2);
  });

  test("the same creditor opened the same day under a new account number is the same card", () => {
    const renumbered = [line({ accountIdentifier: "SIM-CRED1-9999" }), base[1]];
    assert.deepEqual(diffCreditPulls(pull(base), pull(renumbered), { prevOn: PREV_ON }).tradelines, []);
  });

  test("a tri-merge lists one card once per bureau; it is one new card", () => {
    const fresh = line({ creditorName: "Capital One", accountIdentifier: "CAP-5566", accountOpenedDate: "2026-09-20" });
    const d = diffCreditPulls(pull(base), pull([...base, fresh, { ...fresh }, { ...fresh }]), { prevOn: PREV_ON });
    assert.equal(d.tradelines.length, 1);
  });

  test("authorized-user lines are not the client's new credit", () => {
    const au = line({ creditorName: "Spouse Card", accountIdentifier: "SP-1212", accountOpenedDate: "2026-09-20", isAU: true });
    assert.deepEqual(diffCreditPulls(pull(base), pull([...base, au]), { prevOn: PREV_ON }).tradelines, []);
  });

  test("the normalized list is preferred over the top-level one, like the other readers", () => {
    const fresh = line({ creditorName: "Capital One", accountIdentifier: "CAP-5566", accountOpenedDate: "2026-09-20" });
    const latest = { tradelines: base, normalized: { tradelines: [...base, fresh] } };
    assert.equal(diffCreditPulls(pull(base), latest, { prevOn: PREV_ON }).tradelines.length, 1);
  });

  test("a loan reads as a loan, a mortgage as a mortgage", () => {
    const loan = line({ accountType: "Installment", creditorName: "Auto Bank", accountIdentifier: "AU-1010", accountOpenedDate: "2026-09-22" });
    const mort = line({ accountType: "Mortgage", creditorName: "Home Bank", accountIdentifier: "HM-2020", accountOpenedDate: "2026-09-23" });
    const d = diffCreditPulls(pull(base), pull([...base, loan, mort]), { prevOn: PREV_ON });
    assert.deepEqual(d.tradelines.map((t) => t.type).sort(), ["loan", "mortgage"]);
  });
});

describe("diffCreditPulls — guards against a false alarm", () => {
  const base = [line()];

  test("an older pull with no accounts is a failed or partial pull — nothing is compared", () => {
    const d = diffCreditPulls(pull([]), pull(base), { prevOn: PREV_ON });
    assert.equal(d.comparable, false);
    assert.equal(d.reason, "previous_pull_has_no_accounts");
    assert.deepEqual(d.tradelines, []);
  });

  test("a bureau that was not on the older pull (a freeze lifted) would make its whole file look new — nothing is compared", () => {
    const d = diffCreditPulls(
      pull(base, [], { bureausPulled: ["TU", "EX"] }),
      pull([...base, line({ creditorName: "EQ Only", accountIdentifier: "EQ-3434", accountOpenedDate: "2019-02-02" })], [], { bureausPulled: ["TU", "EX", "EQ"] }),
      { prevOn: PREV_ON }
    );
    assert.equal(d.comparable, false);
    assert.equal(d.reason, "bureau_set_changed");
  });

  test("the same bureaus on both pulls compare normally; a bureau that DROPPED out is fine", () => {
    const fresh = line({ creditorName: "Capital One", accountIdentifier: "CAP-5566", accountOpenedDate: "2026-09-20" });
    const same = diffCreditPulls(pull(base, [], { bureausPulled: ["TU", "EX", "EQ"] }), pull([...base, fresh], [], { bureausPulled: ["TU", "EX", "EQ"] }), { prevOn: PREV_ON });
    assert.equal(same.tradelines.length, 1);
    const dropped = diffCreditPulls(pull(base, [], { bureausPulled: ["TU", "EX", "EQ"] }), pull([...base, fresh], [], { bureausPulled: ["TU"] }), { prevOn: PREV_ON });
    assert.equal(dropped.comparable, true);
  });
});

describe("diffCreditPulls — new inquiries", () => {
  const base = [line()];
  const inq = (creditorName, date, source = "TU") => ({ creditorName, date, source });

  test("an inquiry dated after the older pull is new; one already on the older pull is not", () => {
    const d = diffCreditPulls(
      pull(base, [inq("Chase Bank", "2026-08-30")]),
      pull(base, [inq("Chase Bank", "2026-08-30"), inq("American Express", "2026-10-03", "EX")]),
      { prevOn: PREV_ON }
    );
    assert.deepEqual(d.inquiries, [{ source: "credit_pull", type: "inquiry", creditor: "American Express", date: "2026-10-03", bureau: "EX" }]);
  });

  test("an inquiry dated BEFORE the older pull was taken was already there to be seen — not new", () => {
    const d = diffCreditPulls(pull(base), pull(base, [inq("Old Lender", "2026-07-01")]), { prevOn: PREV_ON });
    assert.deepEqual(d.inquiries, []);
  });

  test("two days of reporting lag are allowed", () => {
    const d = diffCreditPulls(pull(base), pull(base, [inq("Lagged Lender", "2026-09-06")]), { prevOn: PREV_ON });
    assert.equal(d.inquiries.length, 1);
    const tooOld = diffCreditPulls(pull(base), pull(base, [inq("Lagged Lender", "2026-09-05")]), { prevOn: PREV_ON });
    assert.equal(tooOld.inquiries.length, 0);
  });

  test("one lender pulling all three bureaus is one inquiry", () => {
    const d = diffCreditPulls(pull(base), pull(base, [inq("Chase", "2026-10-03", "TU"), inq("Chase", "2026-10-03", "EX"), inq("Chase", "2026-10-03", "EQ")]), { prevOn: PREV_ON });
    assert.equal(d.inquiries.length, 1);
  });

  test("an inquiry with no date or no lender cannot be called new", () => {
    const d = diffCreditPulls(pull(base), pull(base, [inq("Nobody", null), inq("", "2026-10-03")]), { prevOn: PREV_ON });
    assert.deepEqual(d.inquiries, []);
  });
});

describe("planNewPull — one alert per pull", () => {
  const diff = (tradelines, inquiries) => ({ comparable: true, reason: null, tradelines, inquiries, unknown: 0 });
  const card = { source: "credit_pull", type: "card", creditor: "Capital One", opened: "2026-09-20", last4: "5566", print: "o:2026-09-20|n:5566" };
  const inquiry = { source: "credit_pull", type: "inquiry", creditor: "American Express", date: "2026-10-03", bureau: "EX" };

  test("an inquiry and the card it was for are one piece of news", () => {
    const p = planNewPull(diff([card], [inquiry]), { pullId: "pull-9" });
    assert.equal(p.key, "fpa:new:pull:pull-9");
    assert.equal(p.templateKey, TEMPLATES.new_credit);
    assert.equal(
      p.body,
      "Fundhub alert: your latest credit pull shows 1 new account (Capital One, opened Sep 20) and 1 new inquiry (American Express, Oct 3). " +
      "New credit can push back your next funding sequence. If this is not yours, reply and tell us."
    );
    assert.equal(p.detail.items.length, 2);
    assert.ok(p.task.body.startsWith("fpa:new:pull:pull-9\n"));
  });

  test("plural wording, and a long list is cut to three names and a count", () => {
    const many = ["A", "B", "C", "D", "E"].map((n, i) => ({ ...card, creditor: `Lender ${n}`, last4: `000${i}`, opened: "2026-09-20" }));
    const p = planNewPull(diff(many, []), { pullId: "p" });
    assert.match(p.body, /5 new accounts \(Lender A, opened Sep 20; Lender B, opened Sep 20; Lender C, opened Sep 20; and 2 more\)/);
  });

  test("a card the Plaid alert already named is left out; if nothing is left there is no alert", () => {
    const known = new Set(["5566"]);
    assert.equal(planNewPull(diff([card], []), { pullId: "p", knownLast4: known }), null);
    const p = planNewPull(diff([card], [inquiry]), { pullId: "p", knownLast4: known });
    assert.doesNotMatch(p.body, /new account/);
    assert.match(p.body, /1 new inquiry \(American Express, Oct 3\)/);
  });

  test("nothing new, an uncomparable diff or no pull id: no alert", () => {
    assert.equal(planNewPull(diff([], []), { pullId: "p" }), null);
    assert.equal(planNewPull({ comparable: false, reason: "bureau_set_changed", tradelines: [], inquiries: [] }, { pullId: "p" }), null);
    assert.equal(planNewPull(diff([card], []), {}), null);
    assert.equal(planNewPull(null, { pullId: "p" }), null);
  });
});
