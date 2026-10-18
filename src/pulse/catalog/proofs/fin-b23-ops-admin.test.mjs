// Practice test (fake data, real page): the four server-backed panels on
// public/app/ops-admin.html that were only ever checked as extracted code.
//   - AR + Collections: exact invoice rows, money, overdue words, status, the
//     top 25 limit with the "N more" line, and the total line.
//   - Compliance Gate: the stopped messages, top 15 only, with client, channel,
//     reason and age; the empty and failed words. The page is fed by the REAL
//     read handler (api/read/messages.mjs, status=blocked) over a stand-in
//     database, and the rows the page gets carry exactly the columns that
//     handler's SELECT lists, so a field the live read never sends cannot be
//     invented by the fixture.
//   - Failed events tile: the returned count and its caption in the KPI grid.
//   - Staff Monitoring Consent: one row per returned person, Signed or
//     Not yet signed, and the hidden-people line.
// The page clock is held, so "5m ago" and the like are exact.

import { test } from "node:test";
import assert from "node:assert/strict";

import { run as readMessages } from "../../../../api/read/messages.mjs";
import { requireAuth } from "../../../http/middleware/requireAuth.mjs";
import { fakeDb, makeRes, ORG_ID, req, staffSession } from "../../../testing/handler-harness.mjs";
import { json, startPages } from "./fin-b23-browser-kit.mjs";

const NOW = 1_700_000_001_000;
const ago = (ms) => new Date(NOW - ms).toISOString();
const uuid = (n) => `${String(n).padStart(8, "0")}-aaaa-4aaa-8aaa-aaaaaaaaaaaa`;

async function openOps(open, handlers) {
  const seen = [];
  const wrapped = {};
  for (const [needle, body] of Object.entries(handlers)) {
    wrapped[needle] = async (route, { url }) => {
      seen.push({ needle, search: new URL(url).search });
      if (typeof body === "function") return body(route);
      return json(route, body);
    };
  }
  const opened = await open("/app/ops-admin.html", { handlers: wrapped, clock: true });
  return { ...opened, seen };
}

test("AR + Collections prints exact rows, money, overdue words and the total, top 25 only, with working sortable headers", { timeout: 60_000 }, async (t) => {
  const { open } = await startPages(t);
  const items = [
    { id: uuid(12345678), client_name: "Whitfield Freight", open_balance: "5000.00", days_overdue: 12, status: "sent" },
    { id: uuid(23456789), client_name: "Okafor Logistics", open_balance: "1250.5", days_overdue: 1, status: "partially_paid" },
    { id: uuid(34567890), client_name: null, client_code: "FH-000321", open_balance: "300", days_overdue: 0, status: "sent" },
    { id: uuid(45678901), client_name: "Reyes Tire", open_balance: null, days_overdue: null, status: "" },
  ];
  for (let i = 5; i <= 27; i += 1) items.push({ id: uuid(10000000 + i), client_name: `Client ${i}`, open_balance: "100", days_overdue: null, status: "sent" });
  const { page, seen } = await openOps(open, { "/api/read/invoices": { ok: true, items } });
  await page.waitForFunction(() => document.querySelectorAll("#ar-table tr").length > 2);

  const rows = await page.locator("#ar-table tr").evaluateAll((trs) => trs.map((tr) => [...tr.children].map((c) => c.textContent.trim())));
  const headers = await page.locator("#ar-table th").evaluateAll((ths) => ths.map((th) => {
    const label = th.cloneNode(true);
    label.querySelector(".sarrow")?.remove();
    return {
      label: label.textContent.trim(),
      arrow: th.querySelector(".sarrow")?.textContent.trim(),
      sort: th.getAttribute("aria-sort"),
      tabIndex: th.tabIndex,
    };
  }));
  assert.deepEqual(headers, [
    { label: "Client", arrow: "▲", sort: "none", tabIndex: 0 },
    { label: "Invoice", arrow: "▲", sort: "none", tabIndex: 0 },
    { label: "Amount owed", arrow: "▲", sort: "none", tabIndex: 0 },
    { label: "Overdue", arrow: "▲", sort: "descending", tabIndex: 0 },
    { label: "Status", arrow: "▲", sort: "none", tabIndex: 0 },
  ]);
  assert.deepEqual(rows[1], ["Whitfield Freight", "INV-12345678", "$5,000.00", "12 days", "Sent"]);
  assert.deepEqual(rows[2], ["Okafor Logistics", "INV-23456789", "$1,250.50", "1 day", "Partially paid"]);
  assert.deepEqual(rows[3], ["FH-000321", "INV-34567890", "$300.00", "Not due yet", "Sent"]);
  assert.deepEqual(rows[4], ["Reyes Tire", "INV-45678901", "Amount not recorded", "No due date set", "Status not recorded"]);
  assert.equal(rows.length, 1 + 25 + 1, "header, the top 25, then the more line");
  assert.deepEqual(rows.at(-1), ["2 more unpaid invoices are not shown here."]);
  // 5000 + 1250.50 + 300 + 23 x 100 = 8850.50 owed over 27 invoices, one without an amount.
  assert.equal(await page.locator("#ar-total").innerText(), "$8,850.50 owed · 27 invoices · 1 with no amount recorded");
  assert.deepEqual(seen.map((s) => s.search), ["?status=open&limit=50"]);

  const amountHeader = page.locator("#ar-table th").nth(2);
  await amountHeader.click();
  assert.equal(await amountHeader.getAttribute("aria-sort"), "ascending");
  let amounts = await page.locator("#ar-table tr[data-ar] td:nth-child(3)").allInnerTexts();
  assert.equal(amounts.slice(0, 21).every((amount) => amount === "$100.00"), true);
  assert.deepEqual(amounts.slice(-4), ["$300.00", "$1,250.50", "$5,000.00", "Amount not recorded"]);

  await amountHeader.press("Enter");
  assert.equal(await amountHeader.getAttribute("aria-sort"), "descending");
  amounts = await page.locator("#ar-table tr[data-ar] td:nth-child(3)").allInnerTexts();
  assert.deepEqual(amounts.slice(0, 3), ["$5,000.00", "$1,250.50", "$300.00"]);
  assert.equal(amounts.at(-1), "Amount not recorded");
  await page.close();
});

test("AR + Collections says nothing is outstanding, and says when it could not load", { timeout: 60_000 }, async (t) => {
  const { open } = await startPages(t);
  const none = await openOps(open, { "/api/read/invoices": { ok: true, items: [] } });
  await none.page.waitForFunction(() => /Nothing outstanding/.test(document.querySelector("#ar-total").textContent));
  assert.match(await none.page.locator("#ar-table").innerText(), /No unpaid invoices\./);
  await none.page.close();

  const broken = await openOps(open, { "/api/read/invoices": (route) => json(route, { ok: false, error: "server_error" }, 500) });
  await broken.page.waitForFunction(() => /Could not load/.test(document.querySelector("#ar-total").textContent));
  assert.match(await broken.page.locator("#ar-table").innerText(), /We could not load unpaid invoices\. Reload the page\./);
  await broken.page.close();
});

/** The column names a SELECT returns: the alias after AS, else the name without its table prefix. */
function selectedColumns(sql) {
  const body = /SELECT\s+([\s\S]*?)\s+FROM\s+messages\s+m\b/i.exec(sql)[1];
  return body.split(",").map((part) => {
    const one = part.trim().replace(/\s+/g, " ");
    const alias = /\sAS\s+(\w+)$/i.exec(one);
    return alias ? alias[1] : one.replace(/^\w+\./, "");
  });
}

const CLIENT_NAMES = {};   // the live read joins no client name today; if it ever does, a name flows in from here
const message = (n, over) => ({
  id: uuid(500 + n), conversation_id: uuid(900 + n), client_id: uuid(700 + n), direction: "outbound", channel: "sms",
  rendered_body: "text we stopped", subject: null, status: "blocked", provider: null, blocked_reason: "stop word",
  last_error: null, scheduled_at: null, sender_staff_id: null, sender_name: null, created_at: ago(96 * 3_600_000 + n * 60_000), ...over,
});

/**
 * The real GET /api/read/messages handler, answering with the stand-in database.
 * `stored` is what the messages table holds (newest first, as the SQL orders it).
 * Only the columns the handler's own SELECT names reach the page.
 */
function liveMessagesRoute(stored, record) {
  return async (route, { url }) => {
    const query = Object.fromEntries(new URL(url).searchParams);
    const fake = fakeDb([
      staffSession(),
      [/FROM messages m/, (sql, params) => {
        const columns = selectedColumns(sql);
        record.queries.push({ sql, params, columns });
        return stored.slice(params[1], params[1] + params[0]).map((row) => Object.fromEntries(columns.map((c) => [
          c, c in row ? row[c] : (c === "client_name" ? (CLIENT_NAMES[row.client_id] ?? null) : null),
        ])));
      }],
    ]);
    const res = makeRes();
    await readMessages(req("GET", { query }), res, { db: fake, requireAuth });
    record.responses.push({ status: res.statusCode, body: res.body });
    return json(route, res.body, res.statusCode);
  };
}

test("Compliance Gate prints the stopped messages from the live read: client, channel, reason and age, top 15 only", { timeout: 60_000 }, async (t) => {
  const { open } = await startPages(t);
  const stored = [
    message(1, { client_id: uuid(7001), channel: "sms", blocked_reason: "quiet hours", created_at: ago(5 * 60_000) }),
    message(2, { client_id: uuid(7002), channel: "email", blocked_reason: null, status: "blocked", created_at: ago(3 * 3_600_000) }),
    message(3, { client_id: uuid(7003), channel: "sms", blocked_reason: "no consent", created_at: ago(72 * 3_600_000) }),
    message(4, { client_id: null, channel: null, blocked_reason: "stop word" }),
  ];
  for (let i = 5; i <= 17; i += 1) stored.push(message(i));
  const record = { queries: [], responses: [] };
  const { page } = await open("/app/ops-admin.html", { handlers: { "/api/read/messages": liveMessagesRoute(stored, record) }, clock: true });
  await page.waitForFunction(() => document.querySelectorAll("#compliance-blocked-table tr").length > 2);

  // The page asked the live read for stopped messages, and the read asked the database for this company's blocked rows, newest first.
  assert.equal(record.queries.length, 1);
  const [asked] = record.queries;
  assert.match(asked.sql, /WHERE\s+m\.org_id = \$3::uuid\s+AND m\.status = \$4/);
  assert.match(asked.sql, /ORDER BY m\.created_at DESC/);
  assert.deepEqual([asked.params[0], asked.params[1], asked.params[2], asked.params[3]], [31, 0, ORG_ID, "blocked"], "limit 30 plus one, from the start, this company, blocked");
  // The rows the page was handed are exactly what that SELECT lists.
  const served = record.responses[0].body.items;
  assert.equal(record.responses[0].status, 200);
  assert.equal(served.length, 17);
  assert.deepEqual(Object.keys(served[0]).sort(), [...asked.columns].sort());
  assert.ok(asked.columns.includes("client_id") && asked.columns.includes("channel") && asked.columns.includes("blocked_reason") && asked.columns.includes("created_at"));
  t.diagnostic(`the live read returns ${asked.columns.includes("client_name") ? "a client_name" : "no client name, only client_id"}`);

  const rows = await page.locator("#compliance-blocked-table tr").evaluateAll((trs) => trs.map((tr) => [...tr.children].map((c) => c.textContent.trim())));
  assert.deepEqual(rows[0], ["Client", "Channel", "Reason", "When"]);
  assert.equal(rows.length, 1 + 15, "the header and the top 15; the 16th and 17th are not shown");
  // What the page must print for each row it was given: the client by name if the read sent one, else by id; the
  // channel; the gate's reason, else the status word; and how long ago. Rows 4 on are four days old.
  const clientOf = (item) => item.client_name || item.client_id || "\u2014";
  const expected = served.slice(0, 15).map((item, i) => [
    clientOf(item), item.channel || "\u2014", item.blocked_reason || item.status || "blocked",
    ["5m ago", "3h ago", "3d ago"][i] || "4d ago",
  ]);
  assert.deepEqual(rows.slice(1), expected);
  // Spot checks that cannot be satisfied by a page that prints the wrong field:
  assert.deepEqual(rows[1], [CLIENT_NAMES[uuid(7001)] || uuid(7001), "sms", "quiet hours", "5m ago"]);
  assert.deepEqual(rows[2].slice(1), ["email", "blocked", "3h ago"], "no gate reason: the status word is shown");
  assert.deepEqual(rows[4], ["\u2014", "\u2014", "stop word", "4d ago"], "a stopped message with no client and no channel prints dashes, not blanks");
  assert.equal(rows.some((r) => r[0] === ""), false, "no empty client cell");
  await page.close();

  const empty = await openOps(open, { "/api/read/messages": { ok: true, items: [] } });
  await empty.page.waitForFunction(() => /No messages stopped by the compliance gate/.test(document.querySelector("#compliance-blocked-table").innerText));
  await empty.page.close();
  const broken = await openOps(open, { "/api/read/messages": (route) => json(route, { ok: false, error: "server_error" }, 500) });
  await broken.page.waitForFunction(() => /Could not load stopped messages\./.test(document.querySelector("#compliance-blocked-table").innerText));
  await broken.page.close();
});

test("the Failed events tile shows the returned count and its words in the KPI grid", { timeout: 60_000 }, async (t) => {
  const { open } = await startPages(t);
  const three = await openOps(open, { "/api/read/failed-events": { ok: true, items: [
    { event_name: "client.created", handler_name: "welcome" }, { event_name: "pay.posted", handler_name: "commission" }, { event_name: "x", handler_name: "y" },
  ] } });
  await three.page.waitForSelector("#kpi-dlq");
  assert.equal(await three.page.locator("#kpi-dlq .kpi-value").innerText(), "3");
  assert.equal(await three.page.locator("#kpi-dlq .kpi-label").textContent(), "failed events awaiting retry");
  assert.equal(await three.page.locator("#kpi-grid #kpi-dlq").count(), 1, "the tile sits in the KPI grid, once");
  assert.equal(await three.page.locator("#kpi-grid > *").last().getAttribute("id"), "kpi-dlq");
  assert.deepEqual(three.seen.map((s) => s.search), ["?status=pending&limit=200"]);
  await three.page.close();

  const none = await openOps(open, { "/api/read/failed-events": { ok: true, items: [] } });
  await none.page.waitForSelector("#kpi-dlq");
  assert.equal(await none.page.locator("#kpi-dlq .kpi-value").innerText(), "0");
  assert.equal(await none.page.locator("#kpi-dlq .kpi-label").textContent(), "no failed events");
  await none.page.close();

  const broken = await openOps(open, { "/api/read/failed-events": (route) => json(route, { ok: false, error: "server_error" }, 500) });
  await broken.page.waitForTimeout(500);
  assert.equal(await broken.page.locator("#kpi-dlq").count(), 0, "a failed read draws no count");
  await broken.page.close();
});

test("Staff Monitoring Consent shows one row per returned person, signed or not yet signed", { timeout: 60_000 }, async (t) => {
  const { open } = await startPages(t);
  const { page, seen } = await openOps(open, { "/api/read/staff": { ok: true, hiddenCount: 2, items: [
    { id: "s1", name: "Ava Closer", email: "ava@example.test", role: "closer", monitoring_consent_at: "2026-10-01T10:00:00Z" },
    { id: "s2", name: "Ben Setter", email: "ben@example.test", role: "setter", monitoring_consent_at: null },
    { id: "s3", name: "", email: "cy@example.test", role: "csm" },
  ] } });
  await page.waitForFunction(() => document.querySelectorAll("#staff-consent-body tr").length === 3);
  const rows = await page.locator("#staff-consent-body tr").evaluateAll((trs) => trs.map((tr) => ({ cells: [...tr.children].map((c) => c.textContent.trim()), warn: tr.classList.contains("warn") })));
  assert.deepEqual(rows, [
    { cells: ["AC Ava Closer", "Signed"], warn: false },
    { cells: ["BS Ben Setter", "Not yet signed"], warn: true },
    { cells: ["C cy@example.test", "Not yet signed"], warn: true },
  ]);
  assert.equal(await page.locator("#staffHiddenLine").innerText(), "2 people are hidden from this list (owner and seeded test logins).");
  assert.deepEqual(seen.map((s) => s.search), ["?limit=200"]);
  await page.close();

  const hiddenOnly = await openOps(open, { "/api/read/staff": { ok: true, hiddenCount: 1, items: [] } });
  await hiddenOnly.page.waitForFunction(() => /1 person is hidden from this list/.test(document.querySelector("#staff-consent-body").innerText));
  assert.equal(await hiddenOnly.page.locator("#staff-consent-body tr").count(), 1);
  await hiddenOnly.page.close();
});
