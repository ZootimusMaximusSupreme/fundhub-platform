import test, { describe, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  ASKS_SQL,
  ASK_BODY_PREFIX,
  ASK_SOURCE,
  CHECK_IDS,
  DEFAULT_FUNNEL_URL,
  GRACE_DAYS,
  gapChecks,
  parseAskBody,
  readBookingBlock
} from "./gap-closer-setup.mjs";
import { GAP_FILES } from "./modules.mjs";
import { namespaceGapId, runGapLane } from "./run-slices.mjs";
import { db as pgDb, close as closePg } from "../../db.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = fs.readFileSync(path.join(HERE, "gap-closer-setup.mjs"), "utf8");

const ORG = "11111111-1111-4111-8111-111111111111";
const JUSTICE = "968bb01e-0079-4508-aded-8a361d54ecbb";
const SARAH = "6ccdca88-60af-4b7e-af15-28259ead4786";
const ASKED_JUSTICE = "2026-10-07T17:41:33.000Z";
const ASKED_SARAH = "2026-10-07T17:41:35.000Z";
const DUE_JUSTICE = "2026-10-10T17:41:33.000Z";
const DUE_SARAH = "2026-10-10T17:41:35.000Z";
const DAY = 24 * 3600e3;
// 6 a.m. Arizona, two days after the ask: day 3 of 3, not late.
const ON_DAY_3 = new Date("2026-10-10T13:00:00.000Z");
// 6 a.m. Arizona, the morning after the due time: late.
const LATE = new Date("2026-10-11T13:00:00.000Z");

/* COPIED FROM THE LIVE PAGE https://apply.fundhub.ai/funding-book-call on 2026-10-09 (one GET).
   The two state blocks and the two hidden fields are exact: same attribute order, same text.
   Only the style-guide animation block is trimmed (unrelated keys). */
const LIVE_FONTS_TAG = `<script id="cf-lander-serialized-custom-fonts" type="application/json">
      []
    </script>`;
const LIVE_STYLE_TAG = `<script id="cf-lander-serialized-style-guide-animation-node" type="application/json">
      {"id":"animation","type":"css","parentId":"style-guide","fractionalIndex":"a6"}
    </script>`;
const LIVE_STATE_1 = `<script type="application/json" data-liquid-replace="item" id="state-node-script-1">{ 
"showOnLoadDelay": null}
</script>`;
const LIVE_STATE_2 = `<script type="application/json" data-liquid-replace="item" id="state-node-script-2">{ 
"event_type": {"id":"14234","name":"Funding Strategy Meeting","avatar_type":"event_type","avatars":[{"url":"https://statics.myclickfunnels.com/workspace/edLgGE/image/23315031/file/aa39f3e3ec8aec314dc43d00350dcc8e.png"}],"selected_host":{"id":14784,"name":"Chris Stanbridge","pretty_location":"Google Meet","location_description":"","photo_url":"https://www.gravatar.com/avatar/14b5d16023d5886a2edb306b1328f952?s=200&d=https%3A%2F%2Fui-avatars.com%2Fapi%2F/Chris%20Stanbridge/200/65a7cc/ffffff"},"duration":30,"price":null,"meeting_type":"one","event_hosts":[{"id":14784,"name":"Chris Stanbridge","photo_url":"https://www.gravatar.com/avatar/14b5d16023d5886a2edb306b1328f952?s=200&d=https%3A%2F%2Fui-avatars.com%2Fapi%2F/Chris%20Stanbridge/200/65a7cc/ffffff","location_icon":"💻"}],"staff_selection":null,"booking_questions":[{"key":"phone","required":true,"type":"text_field","allow_multiple":false,"label":"Phone","options":null},{"key":"name","required":false,"type":"text_field","allow_multiple":false,"label":"Name","options":null},{"key":"email","required":false,"type":"text_field","allow_multiple":false,"label":"Email","options":null}]},"appointmentSchedulerTexts": {"duration":"Duration:","minutes":"minutes","navigateToNextMonth":"navigate to next month","navigateToPreviousMonth":"navigate to previous month","selectTime":"Select time","timeZone":"Time Zone","invalid":"is invalid","addAdditionalInfo":"+ Add Additional Info","addGuest":"+ Add Guest","bookAppointment":"Book Appointment","chooseATimezone":"Choose a timezone","comments":"Comments","firstAvailableSlot":"First Available Slot","fri":"Fri","guestEmails":"Guest Emails","lastAvailableSlot":"Last Available Slot","mon":"Mon","phoneNumber":"Phone Number","pleaseSelectAnOption":"Please Select an Option","profilePicture":"profile picture","remove":"remove","sat":"Sat","selectADateTime":"Select a Date & Time:","staffSelection":"Staff Selection","sun":"Sun","thu":"Thu","tue":"Tue","wed":"Wed","january":"January","february":"February","march":"March","april":"April","may":"May","june":"June","july":"July","august":"August","september":"September","october":"October","november":"November","december":"December"},"cronofyTextDefaults": {"en":{"duration":"Duration:","minutes":"minutes","navigateToNextMonth":"navigate to next month","navigateToPreviousMonth":"navigate to previous month","selectTime":"Select time","timeZone":"Time Zone"},"ja":{"duration":"期間:","minutes":"分","navigateToNextMonth":"次の月に移動","navigateToPreviousMonth":"前の月に移動","selectTime":"時間を選択","timeZone":"タイムゾーン"}},"__locale": "en"}
</script>`;
const LIVE_HOST_FIELD = `<input id="appointment_schedule_request_host_id" class="hidden appointment_schedule_request_field" name="appointment_schedule_request_host_id" value="14784"/>`;
const LIVE_EVENT_FIELD = `<input id="appointment_schedule_request_event_type_id" class="hidden appointment_schedule_request_field" name="appointment_schedule_request_event_type_id" value="14234"/>`;

function pageWith(stateBlocks, extra = "") {
  return [
    "<!doctype html><html><head><title>Funding Book Call</title>",
    LIVE_FONTS_TAG,
    LIVE_STYLE_TAG,
    "</head><body>",
    ...stateBlocks,
    extra,
    LIVE_HOST_FIELD,
    LIVE_EVENT_FIELD,
    "</body></html>"
  ].join("\n");
}

const LIVE_PAGE = pageWith([LIVE_STATE_1, LIVE_STATE_2]);

/* The live state block as data, so a test can change one fact and render it back
   in the same shape: attribute order and all. */
const LIVE_BLOCK = JSON.parse(LIVE_STATE_2.replace(/^<script[^>]*>/, "").replace(/<\/script>$/, ""));
function stateWith(edit) {
  const data = JSON.parse(JSON.stringify(LIVE_BLOCK));
  edit(data);
  return LIVE_STATE_2.replace(/>[\s\S]*<\/script>$/, `>\n${JSON.stringify(data)}\n</script>`);
}

function fetchOf(html, status = 200) {
  const fn = async (url, opts) => {
    fn.calls.push({ url, opts });
    return { status, async text() { return html; } };
  };
  fn.calls = [];
  return fn;
}

function ask(over = {}) {
  return {
    task_id: "task-1",
    body: `${ASK_BODY_PREFIX}${JUSTICE}:${ASKED_JUSTICE}`,
    due_at: DUE_JUSTICE,
    created_at: "2026-10-09T01:00:00.000Z",
    staff_id: JUSTICE,
    staff_name: "Justice Nikkel",
    staff_role: "closer",
    staff_status: "active",
    staff_active: true,
    ...over
  };
}

function sarahAsk(over = {}) {
  return ask({
    task_id: "task-2",
    body: `${ASK_BODY_PREFIX}${SARAH}:${ASKED_SARAH}`,
    due_at: DUE_SARAH,
    staff_id: SARAH,
    staff_name: "Sarah Blankstein",
    staff_role: "sales_manager",
    ...over
  });
}

/* A fake db that answers the one tagged read and keeps every call. */
function dbWith(rows = []) {
  const calls = [];
  return {
    calls,
    async query(sql, params) {
      calls.push({ text: String(sql), params });
      if (/gap-closer-setup:asks/.test(String(sql))) return { rows };
      return { rows: [] };
    }
  };
}

function index(rows) {
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((r) => r.id), CHECK_IDS);
  for (const row of rows) {
    assert.ok(["PASS", "FAIL", "skip"].includes(row.status), row.status);
    assert.equal(typeof row.detail, "string");
    assert.ok(row.detail.length > 0);
    assert.ok("suggestedFix" in row);
    if (row.status === "FAIL") {
      assert.equal(typeof row.suggestedFix, "string");
      assert.ok(row.suggestedFix.length > 0);
      assert.equal(typeof row.customerSees, "string");
    } else {
      assert.equal(row.suggestedFix, null);
    }
  }
  return { late: rows[0], host: rows[1] };
}

async function run(partial = {}) {
  const fetchImpl = "fetchImpl" in partial ? partial.fetchImpl : fetchOf(LIVE_PAGE);
  const db = "db" in partial ? partial.db : dbWith(partial.rows || []);
  const rows = await gapChecks({
    db,
    scope: partial.scope || null,
    orgId: "orgId" in partial ? partial.orgId : ORG,
    now: partial.now || ON_DAY_3,
    fetchImpl,
    env: partial.env || {},
    readTimeoutMs: partial.readTimeoutMs,
    pageTimeoutMs: partial.pageTimeoutMs
  });
  return { rows, ...index(rows), db, fetchImpl };
}

const PRONOUN = /\b(he|she|him|her|hers|his|they|them|their|theirs|it|its)\b/i;
const NAMES = /Justice|Nikkel|Sarah|Blankstein|Chris|Stanbridge/i;

// ── the shape ─────────────────────────────────────────────────────────────────

test("exports: two fixed ids, the ask source, the body prefix and a 3 day wait", () => {
  assert.deepEqual([...CHECK_IDS], ["closer-setup:calendar-late", "closer-setup:booking-page-host"]);
  assert.equal(ASK_SOURCE, "closer-calendar-ask");
  assert.equal(ASK_BODY_PREFIX, "closer-calendar:");
  assert.equal(GRACE_DAYS, 3);
  assert.equal(DEFAULT_FUNNEL_URL, "https://apply.fundhub.ai");
  assert.equal(typeof gapChecks, "function");
});

test("both rows are emitted when there is no ctx at all, and each is a skip with a reason", async () => {
  for (const rows of [await gapChecks(), await gapChecks({}), await gapChecks(null)]) {
    const { late, host } = index(rows);
    assert.equal(late.status, "skip");
    assert.equal(host.status, "skip");
    assert.match(late.detail, /no company in this run/);
    assert.match(host.detail, /no web access in this run/);
  }
});

test("both rows are emitted with a dead database and a dead network, each a skip with the reason", async () => {
  const dead = { query: async () => { throw new Error("connection refused"); } };
  const { late, host } = await run({
    db: dead,
    fetchImpl: async () => { throw new Error("getaddrinfo ENOTFOUND apply.fundhub.ai"); }
  });
  assert.equal(late.status, "skip");
  assert.match(late.detail, /connection refused/);
  assert.equal(host.status, "skip");
  assert.match(host.detail, /ENOTFOUND/);
});

test("a skip says it is not a pass and where it shows", async () => {
  const { late, host } = await run({ db: null, fetchImpl: null });
  assert.match(late.detail, /not a pass/i);
  assert.match(late.detail, /audit:not-checked/);
  assert.match(host.detail, /audit:not-checked/);
});

test("the lane is on the named list, and the pulse runner emits both namespaced ids for it", async () => {
  assert.ok(GAP_FILES.some(([name]) => name === "gap-closer-setup.mjs"));
  for (const id of CHECK_IDS) assert.equal(namespaceGapId(id, "gap-closer-setup"), id);
  const rows = await runGapLane("gap-closer-setup", {
    db: dbWith([ask()]),
    scope: null,
    now: ON_DAY_3,
    orgId: ORG,
    fetchImpl: fetchOf(LIVE_PAGE),
    env: {}
  });
  assert.deepEqual(rows.map((r) => r.id), [...CHECK_IDS]);
  assert.deepEqual(rows.map((r) => r.status), ["PASS", "PASS"]);
  assert.ok(rows.every((r) => r.sliceId === "gap-closer-setup"));
});

// ── the page, copied from the live tag ────────────────────────────────────────

test("the live page: the event block is found even though a first state block has no event", () => {
  assert.equal(readBookingBlock(LIVE_STATE_1), null);
  const block = readBookingBlock(LIVE_PAGE);
  assert.equal(block.id, "14234");
  assert.equal(block.name, "Funding Strategy Meeting");
  assert.deepEqual(block.event_hosts.map((h) => h.name), ["Chris Stanbridge"]);
  assert.equal(block.selected_host.pretty_location, "Google Meet");
  assert.equal(block.staff_selection, null);
});

test("the block is found in any attribute order, with other attributes between, in either quote style", () => {
  const body = '{"event_type":{"id":"1","name":"E","event_hosts":[{"name":"A B"}]}}';
  const shapes = [
    `<script type="application/json" data-liquid-replace="item" id="x">${body}</script>`,
    `<script id="x" type="application/json">${body}</script>`,
    `<script id="x" data-a="1" type='application/json' data-b="2">${body}</script>`,
    `<SCRIPT ID="x" TYPE="application/json">${body}</SCRIPT>`,
    `<script\n  id="x"\n  type="application/json"\n>${body}</script>`
  ];
  for (const html of shapes) {
    assert.equal(readBookingBlock(html).event_hosts[0].name, "A B", html);
  }
});

test("scripts that are not JSON, or are broken JSON, are passed over; the first block with an event wins", () => {
  const html = [
    `<script>var event_type = {"id":"js"};</script>`,
    `<script type="application/json">{ not json</script>`,
    `<script type="application/json">{"event_type":"a string"}</script>`,
    `<script type="application/json">{"event_type":{"id":"first"}}</script>`,
    `<script type="application/json">{"event_type":{"id":"second"}}</script>`
  ].join("\n");
  assert.equal(readBookingBlock(html).id, "first");
  assert.equal(readBookingBlock("<html>nothing here</html>"), null);
  assert.equal(readBookingBlock(""), null);
  assert.equal(readBookingBlock(undefined), null);
});

// ── booking-page-host ─────────────────────────────────────────────────────────

test("booking-page-host: the live page is a PASS and the detail names the host whose place was read", async () => {
  const { host } = await run();
  assert.equal(host.status, "PASS");
  assert.match(host.detail, /lists 1 host/);
  assert.match(host.detail, /Funding Strategy Meeting/);
  assert.match(host.detail, /place shown for Chris Stanbridge: Google Meet/);
});

test("booking-page-host: two hosts and a place on the picked one is a PASS that lists both", async () => {
  const html = pageWith([
    LIVE_STATE_1,
    stateWith((d) => {
      d.event_type.event_hosts.push({ id: 99, name: "Justice Nikkel", location_icon: "x" });
    })
  ]);
  const { host } = await run({ fetchImpl: fetchOf(html) });
  assert.equal(host.status, "PASS");
  assert.match(host.detail, /lists 2 hosts/);
  assert.match(host.detail, /Chris Stanbridge, Justice Nikkel/);
});

test("booking-page-host: no host listed is a FAIL, and the words say a dropped block shows as not checked", async () => {
  const html = pageWith([
    LIVE_STATE_1,
    stateWith((d) => {
      d.event_type.event_hosts = [];
      d.event_type.selected_host = null;
    })
  ]);
  const { host } = await run({ fetchImpl: fetchOf(html) });
  assert.equal(host.status, "FAIL");
  assert.match(host.detail, /lists no host/);
  assert.match(host.detail, /not checked, not red/);
  assert.match(host.suggestedFix, /not checked, not red/);
  assert.match(host.customerSees, /cannot book a call/);
});

test("booking-page-host: a host with no place shown is a FAIL that names the host", async () => {
  const html = pageWith([
    LIVE_STATE_1,
    stateWith((d) => {
      d.event_type.selected_host.pretty_location = "";
      d.event_type.selected_host.location_description = "";
    })
  ]);
  const { host } = await run({ fetchImpl: fetchOf(html) });
  assert.equal(host.status, "FAIL");
  assert.match(host.detail, /no place shown for Chris Stanbridge/);
  assert.match(host.customerSees, /no place/);
  assert.match(host.suggestedFix, /Set the place on the booking event/);
  assert.doesNotMatch(host.suggestedFix, /not checked/);
});

test("booking-page-host: a place given only as location_description still counts as a place", async () => {
  const html = pageWith([
    LIVE_STATE_1,
    stateWith((d) => {
      d.event_type.selected_host.pretty_location = "";
      d.event_type.selected_host.location_description = "Phone call";
    })
  ]);
  const { host } = await run({ fetchImpl: fetchOf(html) });
  assert.equal(host.status, "PASS");
  assert.match(host.detail, /place shown for Chris Stanbridge: Phone call/);
});

test("booking-page-host: hosts listed with no picked host is a PASS that says no place is read", async () => {
  const html = pageWith([LIVE_STATE_1, stateWith((d) => { d.event_type.selected_host = null; })]);
  const { host } = await run({ fetchImpl: fetchOf(html) });
  assert.equal(host.status, "PASS");
  assert.match(host.detail, /no host is picked yet, so no place is read/);
});

test("booking-page-host: a page with no event block, or no host list, is a skip, never a FAIL and never a PASS", async () => {
  const noBlock = await run({ fetchImpl: fetchOf(pageWith([LIVE_STATE_1])) });
  assert.equal(noBlock.host.status, "skip");
  assert.match(noBlock.host.detail, /booking block is not in it/);

  const noList = await run({
    fetchImpl: fetchOf(pageWith([LIVE_STATE_1, stateWith((d) => { delete d.event_type.event_hosts; })]))
  });
  assert.equal(noList.host.status, "skip");
  assert.match(noList.host.detail, /no host list/);
});

test("booking-page-host: a page that answers 404 or 503, or a fetch that throws, is a skip with the reason", async () => {
  const s404 = await run({ fetchImpl: fetchOf("missing", 404) });
  assert.equal(s404.host.status, "skip");
  assert.match(s404.host.detail, /answered 404/);

  const s503 = await run({ fetchImpl: fetchOf("down", 503) });
  assert.match(s503.host.detail, /answered 503/);

  const boom = await run({ fetchImpl: async () => { throw new Error("socket hang up"); } });
  assert.equal(boom.host.status, "skip");
  assert.match(boom.host.detail, /socket hang up/);

  const noStatus = await run({ fetchImpl: async () => ({ async text() { return LIVE_PAGE; } }) });
  assert.equal(noStatus.host.status, "skip");
  assert.match(noStatus.host.detail, /no status/);
});

test("the GET has a 10 second timeout: a page that never answers is a skip and the request is aborted", async () => {
  let aborted = false;
  const hang = (url, opts) => new Promise((_, reject) => {
    opts.signal.addEventListener("abort", () => { aborted = true; reject(new Error("aborted")); });
  });
  const started = Date.now();
  const { host } = await run({ fetchImpl: hang, pageTimeoutMs: 40 });
  assert.ok(Date.now() - started < 2000);
  assert.equal(host.status, "skip");
  assert.match(host.detail, /did not answer/);
  assert.equal(aborted, true);
  // The default is the 10 seconds the design names.
  assert.match(SRC, /PAGE_TIMEOUT_MS = 10000/);
});

// ── calendar-late ─────────────────────────────────────────────────────────────

test("calendar-late: no open ask is a PASS", async () => {
  const { late } = await run({ rows: [] });
  assert.equal(late.status, "PASS");
  assert.match(late.detail, /no open ask on file/);
});

test("calendar-late: two asks inside their 3 days stay green and say which day it is", async () => {
  const { late } = await run({
    rows: [ask(), sarahAsk()],
    now: new Date("2026-10-09T13:00:00.000Z")
  });
  assert.equal(late.status, "PASS");
  assert.match(late.detail, /Justice Nikkel is on day 2 of 3/);
  assert.match(late.detail, /Sarah Blankstein is on day 2 of 3/);
  assert.match(late.detail, /due Oct 10/);
});

test("calendar-late: day 1 of 3, then day 2 of 3, then day 3 of 3 on the 6 a.m. runs after the ask", async () => {
  const day1 = await run({ rows: [ask()], now: new Date("2026-10-08T13:00:00.000Z") });
  assert.match(day1.late.detail, /day 1 of 3/);
  const day2 = await run({ rows: [ask()], now: new Date("2026-10-09T13:00:00.000Z") });
  assert.match(day2.late.detail, /day 2 of 3/);
  const day3 = await run({ rows: [ask()], now: ON_DAY_3 });
  assert.match(day3.late.detail, /day 3 of 3/);
  assert.equal(day3.late.status, "PASS");
});

test("calendar-late: the morning after the due time is a FAIL that names who, when asked, days since, the due day and the hosts", async () => {
  const { late } = await run({ rows: [ask(), sarahAsk()], now: LATE });
  assert.equal(late.status, "FAIL");
  assert.match(late.detail, /2 people are past due to join the booking page/);
  assert.match(late.detail, /Justice Nikkel \(closer\)/);
  assert.match(late.detail, /Sarah Blankstein \(sales manager\)/);
  assert.match(late.detail, /asked Oct 7/);
  assert.match(late.detail, /3 days ago/);
  assert.match(late.detail, /due Oct 10/);
  assert.match(late.detail, /Hosts on the page now: Chris Stanbridge\./);
});

test("calendar-late: one person late and one still waiting is a FAIL naming only the late one", async () => {
  const { late } = await run({
    rows: [ask(), sarahAsk({ due_at: "2026-10-14T17:41:35.000Z" })],
    now: LATE
  });
  assert.equal(late.status, "FAIL");
  assert.match(late.detail, /1 person is past due/);
  assert.match(late.detail, /Justice Nikkel/);
  assert.doesNotMatch(late.detail, /Sarah Blankstein/);
});

test("calendar-late: the red is on the Oct 11 morning run and not before it", async () => {
  const before = await run({ rows: [ask()], now: new Date("2026-10-10T13:00:00.000Z") });
  assert.equal(before.late.status, "PASS");
  const first = await run({ rows: [ask()], now: new Date("2026-10-11T13:00:00.000Z") });
  assert.equal(first.late.status, "FAIL");
});

test("calendar-late: the FAIL words hold no staff name and no pronoun in customerSees or fix line 1", async () => {
  const { late } = await run({ rows: [ask(), sarahAsk()], now: LATE });
  const line1 = late.suggestedFix.split("\n")[0];
  assert.doesNotMatch(late.customerSees, NAMES);
  assert.doesNotMatch(late.customerSees, PRONOUN);
  assert.doesNotMatch(line1, NAMES);
  assert.doesNotMatch(line1, PRONOUN);
  assert.equal(
    line1,
    "A closer is past due to join the booking page. Send the ClickFunnels invite, nudge, give more days, or drop the ask."
  );
  assert.match(late.customerSees, /No buyer is hurt yet/);
  const line2 = late.suggestedFix.split("\n")[1];
  assert.equal(
    line2,
    "Only a ClickFunnels team admin can send the invite and add a host. The API cannot. The pulse sends nothing."
  );
});

test("calendar-late: the host row's words hold no staff name and no pronoun in customerSees or fix line 1 either", async () => {
  const html = pageWith([LIVE_STATE_1, stateWith((d) => { d.event_type.event_hosts = []; })]);
  const { host } = await run({ fetchImpl: fetchOf(html) });
  assert.equal(host.status, "FAIL");
  for (const text of [host.customerSees, host.suggestedFix.split("\n")[0]]) {
    assert.doesNotMatch(text, NAMES);
    assert.doesNotMatch(text, PRONOUN);
  }
});

test("calendar-late: a person who shows as a host is green even past the due time, and the ask can be closed", async () => {
  const html = pageWith([
    LIVE_STATE_1,
    stateWith((d) => { d.event_type.event_hosts.push({ id: 7, name: "justice  NIKKEL" }); })
  ]);
  const { late } = await run({ rows: [ask()], now: LATE, fetchImpl: fetchOf(html) });
  assert.equal(late.status, "PASS");
  assert.match(late.detail, /On the booking page now, so the ask can be closed: Justice Nikkel/);
});

test("calendar-late: only the person who joined turns green; the other stays red", async () => {
  const html = pageWith([
    LIVE_STATE_1,
    stateWith((d) => { d.event_type.event_hosts.push({ id: 7, name: "Justice Nikkel" }); })
  ]);
  const { late } = await run({ rows: [ask(), sarahAsk()], now: LATE, fetchImpl: fetchOf(html) });
  assert.equal(late.status, "FAIL");
  assert.match(late.detail, /1 person is past due/);
  assert.match(late.detail, /Sarah Blankstein/);
  assert.doesNotMatch(late.detail, /Justice Nikkel \(/);
});

test("calendar-late: the ask time comes from the body, not from the day the row was saved", async () => {
  const row = ask({ created_at: "2026-10-09T01:00:00.000Z" });
  const { late } = await run({ rows: [row], now: LATE });
  assert.match(late.detail, /asked Oct 7/);
  assert.doesNotMatch(late.detail, /Oct 9/);
  assert.deepEqual(
    parseAskBody(row.body),
    { staffId: JUSTICE, askedAt: new Date(ASKED_JUSTICE) }
  );
});

test("calendar-late: a body whose time cannot be read falls back to the saved day and says so", async () => {
  const row = ask({ body: `${ASK_BODY_PREFIX}${JUSTICE}:not-a-time`, created_at: "2026-10-07T17:00:00.000Z" });
  const { late } = await run({ rows: [row], now: LATE });
  assert.equal(late.status, "FAIL");
  assert.match(late.detail, /ask saved Oct 7/);
  assert.equal(parseAskBody(row.body).askedAt, null);
});

test("calendar-late: the red-after time is due_at, so more days given turns it green again", async () => {
  const snoozed = ask({ due_at: "2026-10-14T17:41:33.000Z" });
  const { late } = await run({ rows: [snoozed], now: LATE });
  assert.equal(late.status, "PASS");
  assert.match(late.detail, /day 4 of 7/);
});

test("calendar-late: with no due_at the red-after time is the ask plus 3 days", async () => {
  const row = ask({ due_at: null });
  const green = await run({ rows: [row], now: new Date("2026-10-10T17:00:00.000Z") });
  assert.equal(green.late.status, "PASS");
  const red = await run({ rows: [row], now: new Date("2026-10-10T18:00:00.000Z") });
  assert.equal(red.late.status, "FAIL");
});

test("calendar-late: a staff row that is no longer active is said in the detail", async () => {
  const { late } = await run({ rows: [ask({ staff_status: "suspended", staff_active: false })], now: LATE });
  assert.equal(late.status, "FAIL");
  assert.match(late.detail, /the staff row is suspended/);
});

test("calendar-late: an ask whose staff row is gone is not lost; it turns red when due and says so", async () => {
  const gone = ask({ staff_id: null, staff_name: null, staff_role: null, staff_status: null, staff_active: null });
  const { late } = await run({ rows: [gone], now: LATE });
  assert.equal(late.status, "FAIL");
  assert.match(late.detail, /no staff row is on file/);
  assert.match(late.detail, /staff 968bb01e/);
});

test("calendar-late: due and the page cannot be read is a skip; not due yet is still a PASS", async () => {
  const dead = async () => { throw new Error("socket hang up"); };
  const due = await run({ rows: [ask()], now: LATE, fetchImpl: dead });
  assert.equal(due.late.status, "skip");
  assert.match(due.late.detail, /Justice Nikkel is past due/);
  assert.match(due.late.detail, /booking page was not read/);
  assert.match(due.late.detail, /socket hang up/);

  const waiting = await run({ rows: [ask()], now: ON_DAY_3, fetchImpl: dead });
  assert.equal(waiting.late.status, "PASS");
  assert.match(waiting.late.detail, /day 3 of 3/);
});

test("calendar-late: a failed ask read is a skip with the reason, never a PASS", async () => {
  const bad = { query: async () => { throw new Error("canceling statement due to statement timeout"); } };
  const { late } = await run({ db: bad });
  assert.equal(late.status, "skip");
  assert.match(late.detail, /statement timeout/);
  assert.match(late.detail, /open asks not read/);
});

test("calendar-late: a read that hangs is cut and becomes a skip", async () => {
  const hang = { query: () => new Promise(() => {}) };
  const started = Date.now();
  const { late } = await run({ db: hang, readTimeoutMs: 40 });
  assert.ok(Date.now() - started < 2000);
  assert.equal(late.status, "skip");
  assert.match(late.detail, /took too long/);
});

test("calendar-late: no company in the run is a skip", async () => {
  const { late } = await run({ orgId: null });
  assert.equal(late.status, "skip");
  assert.match(late.detail, /no company in this run/);
});

test("calendar-late: a row with no usable date is left out and counted, not a crash", async () => {
  const junk = ask({ body: "closer-calendar:junk", created_at: null, due_at: null });
  const { late } = await run({ rows: [junk] });
  assert.equal(late.status, "PASS");
  assert.match(late.detail, /1 ask row has no usable date/);
});

// ── how it reads ──────────────────────────────────────────────────────────────

test("one SELECT and one GET run side by side: both start before either one finishes", async () => {
  const order = [];
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const maybeRelease = () => { if (order.length === 2) release(); };
  const db = {
    async query() {
      order.push("select-start");
      maybeRelease();
      await gate;
      order.push("select-end");
      return { rows: [] };
    }
  };
  const fetchImpl = async () => {
    order.push("get-start");
    maybeRelease();
    await gate;
    order.push("get-end");
    return { status: 200, async text() { return LIVE_PAGE; } };
  };
  const rows = await gapChecks({ db, orgId: ORG, now: ON_DAY_3, fetchImpl, env: {} });
  assert.equal(rows.length, 2);
  assert.deepEqual(order.slice(0, 2).sort(), ["get-start", "select-start"]);
});

test("the SELECT goes through ctx.scope when it is given, else ctx.db", async () => {
  const viaDb = dbWith([ask()]);
  const scoped = [];
  const scope = async (fn) => fn({
    async query(sql, params) {
      scoped.push({ text: String(sql), params });
      return { rows: [ask()] };
    }
  });
  const a = await run({ db: viaDb, scope });
  assert.equal(scoped.length, 1);
  assert.equal(viaDb.calls.length, 0);
  assert.equal(a.late.status, "PASS");

  const onlyDb = dbWith([ask()]);
  const b = await run({ db: onlyDb });
  assert.equal(onlyDb.calls.length, 1);
  assert.equal(b.late.status, "PASS");

  const onlyScope = await run({ db: null, scope });
  assert.equal(onlyScope.late.status, "PASS");
});

test("the one SELECT is tagged, bound, this company and this source only, and open and real rows only", async () => {
  const { db } = await run({ rows: [] });
  assert.equal(db.calls.length, 1);
  const { text, params } = db.calls[0];
  assert.deepEqual(params, [ORG, ASK_SOURCE, ASK_BODY_PREFIX]);
  assert.equal(text, ASKS_SQL);
  assert.match(text, /gap-closer-setup:asks/);
  assert.match(text, /FROM tasks t/);
  assert.match(text, /LEFT JOIN staff s/);
  assert.match(text, /t\.org_id = \$1::uuid/);
  assert.match(text, /t\.source_workflow = \$2::text/);
  assert.match(text, /t\.done = false/);
  assert.match(text, /t\.is_demo = false/);
  assert.doesNotMatch(text, /closer-calendar/, "the source and prefix are bound, not pasted");
});

test("the GET: plain GET, the funnel address from FUNNEL_URL when it is a real address, else apply.fundhub.ai; one call", async () => {
  const plain = await run();
  assert.equal(plain.fetchImpl.calls.length, 1);
  assert.equal(plain.fetchImpl.calls[0].url, "https://apply.fundhub.ai/funding-book-call");
  assert.equal(plain.fetchImpl.calls[0].opts.method, "GET");

  const own = await run({ env: { FUNNEL_URL: "https://go.example.com/" } });
  assert.equal(own.fetchImpl.calls[0].url, "https://go.example.com/funding-book-call");

  const masked = await run({ env: { FUNNEL_URL: "****************abcd" } });
  assert.equal(masked.fetchImpl.calls[0].url, "https://apply.fundhub.ai/funding-book-call");

  const junk = await run({ env: { FUNNEL_URL: "not a url" } });
  assert.equal(junk.fetchImpl.calls[0].url, "https://apply.fundhub.ai/funding-book-call");
});

test("ctx.fetch is used when ctx.fetchImpl is absent", async () => {
  const fetch = fetchOf(LIVE_PAGE);
  const rows = await gapChecks({ db: dbWith([]), orgId: ORG, now: ON_DAY_3, fetch, env: {} });
  assert.equal(index(rows).host.status, "PASS");
  assert.equal(fetch.calls[0].opts.method, "GET");
});

test("a whole-lane time check: both reads are bounded so the lane stays well under 20 seconds", () => {
  assert.match(SRC, /PAGE_TIMEOUT_MS = 10000/);
  assert.match(SRC, /READ_TIMEOUT_MS = 8000/);
});

// ── the source ────────────────────────────────────────────────────────────────

/* Whole-line comments and block comments are dropped before the scan, so the
   prose that explains the rules does not trip the rules. */
function code(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => !line.trim().startsWith("//"))
    .join("\n");
}

test("source is read only: no write, no transaction control, no web write, no files, no send, no task creation", () => {
  const body = code(SRC);
  assert.ok(body.length > 2000, "the scan found the code");
  assert.doesNotMatch(body, /\b(INSERT|UPDATE|DELETE|BEGIN|COMMIT|ROLLBACK|SET|POST|PUT|PATCH)\b/);
  assert.doesNotMatch(ASKS_SQL, /\b(insert|update|delete|begin|commit|rollback|set|alter|drop|create|grant)\b/i);
  assert.doesNotMatch(body, /^import /m, "no imports: nothing here can write, send or read a file");
  assert.doesNotMatch(body, /createTask|create-task|textChris|sendSms|notify|messaging|readFileSync|writeFileSync|node:fs/);
  assert.doesNotMatch(body, /method:\s*["'](?!GET)/);
  assert.match(body, /method: "GET"/);
});

/* ------------------------------------------------------------------------
   The SQL, run for real. tasks and staff are replaced for one query by fixture
   rows (a CTE with the table's name), so the file's own SQL runs on the Postgres
   engine over rows we choose. SELECT only, nothing is stored.
   Skipped without DATABASE_URL, like every *.pg.test.mjs.
   ------------------------------------------------------------------------ */
const HAVE_DB = !!process.env.DATABASE_URL;
const COLS = {
  tasks: [["id", "uuid"], ["org_id", "uuid"], ["body", "text"], ["due_at", "timestamptz"], ["created_at", "timestamptz"], ["source_workflow", "text"], ["done", "boolean"], ["is_demo", "boolean"]],
  staff: [["id", "uuid"], ["org_id", "uuid"], ["name", "text"], ["role", "text"], ["status", "text"], ["active", "boolean"]]
};

function fixtureDb(rows = {}) {
  const ctes = Object.entries(COLS).map(([name, cols]) => {
    const json = JSON.stringify(rows[name] || []).replace(/'/g, "''");
    return `${name} AS (SELECT * FROM jsonb_to_recordset('${json}'::jsonb) AS x(${cols.map(([c, t]) => `"${c}" ${t}`).join(", ")}))`;
  });
  return {
    async query(sql, params) {
      const t = String(sql).replace(/^\s*(\/\*[\s\S]*?\*\/\s*)+/, "");
      return pgDb.query(`WITH ${ctes.join(", ")} ${t}`, params);
    }
  };
}

describe("gap-closer-setup SQL on the Postgres engine, over fixture rows", { skip: HAVE_DB ? false : "no DATABASE_URL" }, () => {
  after(async () => { await closePg(); });
  const org = "22222222-2222-4222-8222-222222222222";
  const other = "33333333-3333-4333-8333-333333333333";
  const staffRows = [
    { id: JUSTICE, org_id: org, name: "Justice Nikkel", role: "closer", status: "active", active: true },
    { id: SARAH, org_id: other, name: "Sarah Blankstein", role: "sales_manager", status: "active", active: true }
  ];
  const task = (o = {}) => ({
    id: "00000000-0000-4000-8000-000000000001",
    org_id: org,
    body: `${ASK_BODY_PREFIX}${JUSTICE}:${ASKED_JUSTICE}`,
    due_at: DUE_JUSTICE,
    created_at: "2026-10-09T01:00:00.000Z",
    source_workflow: ASK_SOURCE,
    done: false,
    is_demo: false,
    ...o
  });

  test("an open ask is joined to its staff row by the id inside the body", async () => {
    const res = await fixtureDb({ tasks: [task()], staff: staffRows }).query(ASKS_SQL, [org, ASK_SOURCE, ASK_BODY_PREFIX]);
    assert.equal(res.rows.length, 1);
    assert.equal(res.rows[0].staff_name, "Justice Nikkel");
    assert.equal(res.rows[0].staff_id, JUSTICE);
    assert.equal(res.rows[0].staff_role, "closer");
  });

  test("a done ask, a demo ask, another source, another company and another prefix are left out", async () => {
    const tasks = [
      task({ id: "00000000-0000-4000-8000-000000000002", done: true }),
      task({ id: "00000000-0000-4000-8000-000000000003", is_demo: true }),
      task({ id: "00000000-0000-4000-8000-000000000004", source_workflow: "ops-coo" }),
      task({ id: "00000000-0000-4000-8000-000000000005", org_id: other }),
      task({ id: "00000000-0000-4000-8000-000000000006", body: `diagnose:${JUSTICE}:${ASKED_JUSTICE}` })
    ];
    const res = await fixtureDb({ tasks, staff: staffRows }).query(ASKS_SQL, [org, ASK_SOURCE, ASK_BODY_PREFIX]);
    assert.equal(res.rows.length, 0);
  });

  test("an ask whose staff row is gone, or whose body holds no id, still comes back with empty staff fields", async () => {
    const tasks = [
      task({ id: "00000000-0000-4000-8000-000000000007", body: `${ASK_BODY_PREFIX}${SARAH}:${ASKED_SARAH}` }),
      task({ id: "00000000-0000-4000-8000-000000000008", body: `${ASK_BODY_PREFIX}junk` })
    ];
    const res = await fixtureDb({ tasks, staff: staffRows }).query(ASKS_SQL, [org, ASK_SOURCE, ASK_BODY_PREFIX]);
    assert.equal(res.rows.length, 2);
    assert.ok(res.rows.every((r) => r.staff_id === null && r.staff_name === null));
  });

  test("the oldest due time comes first", async () => {
    const tasks = [
      task({ id: "00000000-0000-4000-8000-000000000009", due_at: "2026-10-12T00:00:00.000Z" }),
      task({ id: "00000000-0000-4000-8000-00000000000a", due_at: "2026-10-10T00:00:00.000Z" })
    ];
    const res = await fixtureDb({ tasks, staff: staffRows }).query(ASKS_SQL, [org, ASK_SOURCE, ASK_BODY_PREFIX]);
    assert.deepEqual(res.rows.map((r) => r.task_id.slice(-1)), ["a", "9"]);
  });
});
