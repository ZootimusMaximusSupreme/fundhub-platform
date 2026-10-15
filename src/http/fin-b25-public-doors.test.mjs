// Finish-the-853 batch 25, practice tests for five public doors, none of which has a sign-in:
// the phone-notification approve/reject tap (the token is the credential), the voluntary EEO
// self-ID form (read and submit), the published white-label partner page JSON, and the VSL watch
// beacon. Each test runs the REAL api/ handler over a stand-in database that answers by the SQL text
// the code sends. Fake data only. Nothing here sends a message, calls a vendor or opens a network.
import assert from "node:assert/strict";
import test from "node:test";

import adVideoApproveHandler from "../../api/public/ad-video-approve.mjs";
import { approveByToken, rejectByToken } from "../ad-videos/token.mjs";
import eeoSurveyHandler from "../../api/public/eeo-survey.mjs";
import partnerPageHandler from "../../api/public/partner-page.mjs";
import vslWatchHandler from "../../api/public/vsl-watch.mjs";
import { rowsWhere } from "../testing/s3-scoped-rows.mjs";
import {
  ORG_ID, assertOnlySent, assertSent, assertSqlHas, call, dataCalls, sentStatement, sqlCalls, updatedFields,
} from "../testing/fin-b25-kit.mjs";

const open = { anonymous: true, withSession: false };
const noWrites = (result) => assert.equal(dataCalls(result).every((c) => !/^\s*(INSERT|UPDATE|DELETE)\b/i.test(c.sql)), true, "a read writes nothing");
const NOW_MS = Date.now();

/* ── public/ad-video-approve ───────────────────────────────────────────────────────────────────────── */

const TOKEN = "ab".repeat(24);
const OTHER_TOKEN = "cd".repeat(24);

function approvalWorld(videos) {
  const seen = { scope: [], finds: [], updates: [] };
  const live = (sql, row) => !/approval_expires_at > now\(\)/.test(sql) || (row.approval_expires_at != null && new Date(row.approval_expires_at).getTime() > Date.now());
  const rules = [
    [/^\s*SELECT id, ad_id, take_no, status, video_kind, finished_url,\s+width, height, duration_seconds, resolution_ok\s+FROM ad_videos/, (sql, params) => {
      seen.finds.push({ sql, params });
      return rowsWhere(videos, sql, params).filter((row) => live(sql, row)).map(({ id, ad_id, take_no, status, video_kind, finished_url, width, height, duration_seconds, resolution_ok }) =>
        ({ id, ad_id, take_no, status, video_kind, finished_url, width, height, duration_seconds, resolution_ok }));
    }],
    [/^\s*UPDATE ad_videos\s+SET status\s+= 'approved'/, (sql, params) => {
      seen.updates.push({ kind: "approve", sql, params });
      const hit = rowsWhere(videos, sql, params).filter((row) => live(sql, row));
      // The row is what the statement says it sets, read from its text.
      for (const row of hit) Object.assign(row, updatedFields(sql, params, new Date(NOW_MS)));
      return hit.map(({ id, ad_id, take_no, status }) => ({ id, ad_id, take_no, status }));
    }],
    [/^\s*UPDATE ad_videos\s+SET status\s+= 'rejected'/, (sql, params) => {
      seen.updates.push({ kind: "reject", sql, params });
      const hit = rowsWhere(videos, sql, params).filter((row) => live(sql, row));
      for (const row of hit) Object.assign(row, updatedFields(sql, params, new Date(NOW_MS)));
      return hit.map(({ id, ad_id, take_no, status }) => ({ id, ad_id, take_no, status }));
    }],
  ];
  return { rules, seen, videos };
}

const videoRow = (over = {}) => ({
  id: "v0000000-0000-4000-8000-000000000001", ad_id: "91", take_no: 3, status: "awaiting_approval", video_kind: "ad", finished_url: "https://cdn.example.test/ad-91.mp4",
  width: 1080, height: 1920, duration_seconds: 42, resolution_ok: true, approval_token: TOKEN, approval_expires_at: new Date(NOW_MS + 3600e3).toISOString(),
  transcript: "should never be shown", storage_key: "private/key", ...over,
});

test("GET public/ad-video-approve shows the one take a live token names, with only the tap columns, writes nothing, and declares the token as its own scope", async () => {
  const videos = [videoRow(), videoRow({ id: "v0000000-0000-4000-8000-000000000002", ad_id: "92", approval_token: OTHER_TOKEN })];
  const world = approvalWorld(videos);
  const result = await call(adVideoApproveHandler, { ...open, query: { token: TOKEN }, rules: world.rules });
  assert.equal(result.status, 200);
  assert.deepEqual(result.body, {
    ok: true,
    video: {
      ad_id: "91", take_no: 3, status: "awaiting_approval", video_kind: "ad", folder_name: "091", finished_url: "https://cdn.example.test/ad-91.mp4",
      width: 1080, height: 1920, duration_seconds: 42, resolution_ok: true,
    },
  });
  assert.doesNotMatch(JSON.stringify(result.body), /transcript|storage_key|approval_token/);
  assert.deepEqual(world.seen.finds[0].params, [TOKEN]);
  assertSqlHas(world.seen.finds[0].sql, { token: "WHERE approval_token = $1", expiry: "AND approval_expires_at > now()" });
  assert.doesNotMatch(world.seen.finds[0].sql, /SELECT \*|transcript|storage_key/, "the columns are spelled out, not star");
  const scope = sqlCalls(result, /set_config\('fundhub\.ad_video_token'/)[0];
  assert.deepEqual(scope.params, [TOKEN], "one transaction, scoped to this one token");
  assert.equal(result.db.count("COMMIT"), 1);
  assert.equal(dataCalls(result).some((c) => /FROM live JOIN staff/.test(c.sql)), false, "no staff session is ever looked up");
  noWrites(result);
  // The token is declared for ONE transaction only (is_local true: a pooled connection never carries it to the
  // next request), and the one read names the token and its expiry in its own WHERE clause.
  assert.equal(sqlCalls(result, /set_config\('fundhub\.ad_video_token'/)[0].sql.includes(", true)"), true);
  assertOnlySent(result, "adv.find");
  assertSent(result, "adv.scope");

  const html = await call(adVideoApproveHandler, { ...open, query: { token: TOKEN }, headers: { accept: "text/html,application/xhtml+xml" }, rules: world.rules });
  assert.equal(html.status, 200);
  assert.match(html.headers["content-type"], /text\/html/);
  assert.match(html.headers["cache-control"], /no-store/);
  assert.equal(html.headers["referrer-policy"], "no-referrer");
  assert.match(html.headers["x-robots-tag"], /noindex/);
  assert.match(String(html.body), /Approve/);
  assert.match(String(html.body), /091|91/);
});

test("public/ad-video-approve answers every refusal the same way: unknown, malformed, expired and already-decided tokens are one 404 with no difference", async () => {
  const expired = videoRow({ approval_token: OTHER_TOKEN, approval_expires_at: new Date(NOW_MS - 3600e3).toISOString() });
  const decided = videoRow({ id: "v0000000-0000-4000-8000-000000000003", approval_token: "ef".repeat(24), status: "approved" });
  const world = approvalWorld([videoRow(), expired, decided]);
  const refusals = [];
  for (const token of ["12".repeat(24), "nope", OTHER_TOKEN, undefined]) {
    refusals.push(await call(adVideoApproveHandler, { ...open, query: token === undefined ? {} : { token }, rules: world.rules }));
  }
  for (const r of refusals) {
    assert.equal(r.status, 404);
    assert.deepEqual(r.body, { ok: false, error: "not_found" });
  }
  assert.equal(world.seen.finds.length, 2, "a malformed or missing token never reaches the database");
  const gone = await call(adVideoApproveHandler, { ...open, query: { token: "12".repeat(24) }, headers: { accept: "text/html" }, rules: world.rules });
  assert.equal(gone.status, 404);
  assert.match(String(gone.body), /no longer good/);
  const put = await call(adVideoApproveHandler, { ...open, method: "PUT", rules: world.rules });
  assert.equal(put.status, 405);
});

test("POST public/ad-video-approve approves or rejects one awaiting take, spends the token, names who tapped, and a second tap changes nothing", async () => {
  const videos = [videoRow(), videoRow({ id: "v0000000-0000-4000-8000-000000000002", ad_id: "92", approval_token: OTHER_TOKEN })];
  const world = approvalWorld(videos);
  const approved = await call(adVideoApproveHandler, { ...open, method: "POST", body: { token: TOKEN, decision: "approve", approved_by: "  Chris on the phone  " }, rules: world.rules });
  assert.equal(approved.status, 200);
  assert.deepEqual(approved.body, { ok: true, decision: "approve", ad_id: "91", take_no: 3, status: "approved" });
  assert.deepEqual(world.seen.updates[0].params, [TOKEN, "Chris on the phone"]);
  assertSqlHas(world.seen.updates[0].sql, {
    token: "WHERE approval_token = $1",
    expiry: "AND approval_expires_at > now()",
    onlyAwaiting: "AND status = 'awaiting_approval'",
    spent: "approval_token = NULL",
  });
  assert.equal(videos[0].status, "approved");
  assert.equal(videos[0].approval_token, null, "the link stops working");
  assert.equal(videos[0].approval_expires_at, null);
  assert.equal(videos[0].approved_by, "Chris on the phone");
  assert.ok(videos[0].approved_at instanceof Date, "the statement stamps the time of the approval");
  assert.equal(videos[1].status, "awaiting_approval", "only the take the token names");
  assertSent(approved, "adv.scope", "adv.approve");

  const again = await call(adVideoApproveHandler, { ...open, method: "POST", body: { token: TOKEN, decision: "approve" }, rules: world.rules });
  assert.equal(again.status, 404, "a double tap matches no row");
  assert.deepEqual(again.body, { ok: false, error: "not_found" });

  const defaultWho = await call(adVideoApproveHandler, { ...open, method: "POST", body: { token: OTHER_TOKEN, action: "approve" }, rules: world.rules });
  assert.equal(defaultWho.body.decision, "approve");
  assert.equal(world.seen.updates.at(-1).params[1], "chris");

  const world2 = approvalWorld([videoRow(), videoRow({ id: "v0000000-0000-4000-8000-000000000009", approval_token: OTHER_TOKEN })]);
  const withReason = await call(adVideoApproveHandler, { ...open, method: "POST", body: { token: TOKEN, decision: "reject", reason: "stumbled at 0:12" }, rules: world2.rules });
  assert.deepEqual(withReason.body, { ok: true, decision: "reject", ad_id: "91", take_no: 3, status: "rejected" });
  assert.deepEqual(world2.seen.updates[0].params, [TOKEN, "stumbled at 0:12"]);
  assertSent(withReason, "adv.scope", "adv.reject");
  assert.deepEqual(
    (({ status, rejected_reason, approval_token, approval_expires_at }) => ({ status, rejected_reason, approval_token, approval_expires_at }))(world2.videos[0]),
    { status: "rejected", rejected_reason: "stumbled at 0:12", approval_token: null, approval_expires_at: null },
    "a rejection keeps the words and spends the token",
  );
  const noReason = await call(adVideoApproveHandler, { ...open, method: "POST", body: { token: OTHER_TOKEN, decision: "reject" }, rules: world2.rules });
  assert.equal(noReason.status, 200);
  assert.equal(world2.seen.updates.at(-1).params[1], "rejected from the phone notification, no reason typed");
});

test("POST public/ad-video-approve refuses a bad decision, an expired token and bad JSON, and a failure answers one word with the real cause kept off the wire", async () => {
  const expired = videoRow({ approval_expires_at: new Date(NOW_MS - 1000).toISOString() });
  const world = approvalWorld([expired]);
  const badDecision = await call(adVideoApproveHandler, { ...open, method: "POST", body: { token: TOKEN, decision: "maybe" }, rules: world.rules });
  assert.equal(badDecision.status, 400);
  assert.deepEqual(badDecision.body, { ok: false, error: "bad_decision", allowed: ["approve", "reject"] });
  assert.equal(world.seen.updates.length, 0);

  const late = await call(adVideoApproveHandler, { ...open, method: "POST", body: { token: TOKEN, decision: "approve" }, rules: world.rules });
  assert.equal(late.status, 404, "the expiry is checked in the statement itself");
  assert.equal(expired.status, "awaiting_approval");

  const badJson = await call(adVideoApproveHandler, { ...open, method: "POST", rawBody: "{not json", rules: world.rules });
  assert.equal(badJson.status, 400);
  assert.equal(badJson.body.error, "invalid_json");

  const realError = console.error;
  console.error = () => {};
  try {
    const broken = await call(adVideoApproveHandler, { ...open, method: "POST", body: { token: TOKEN, decision: "approve" }, rules: [[/UPDATE ad_videos/, new Error("relation ad_videos is locked by 10.0.0.9")]] });
    assert.equal(broken.status, 500);
    assert.deepEqual(broken.body, { ok: false, error: "error" });
    assert.equal(broken.db.count("ROLLBACK"), 1, "nothing half-saved");
  } finally {
    console.error = realError;
  }
});

test("POST public/ad-video-approve will not reject or approve a take that is expired or already decided, and cuts a name and a reason to their lengths", async () => {
  const live = videoRow();
  const expired = videoRow({ id: "v0000000-0000-4000-8000-0000000000e1", ad_id: "92", approval_token: OTHER_TOKEN, approval_expires_at: new Date(NOW_MS - 1000).toISOString() });
  const approvedAlready = videoRow({ id: "v0000000-0000-4000-8000-0000000000e2", ad_id: "93", approval_token: "ef".repeat(24), status: "approved" });
  const rejectedAlready = videoRow({ id: "v0000000-0000-4000-8000-0000000000e3", ad_id: "94", approval_token: "12".repeat(24), status: "rejected" });
  const world = approvalWorld([live, expired, approvedAlready, rejectedAlready]);
  const post = (token, body) => call(adVideoApproveHandler, { ...open, method: "POST", body: { token, ...body }, rules: world.rules });

  const lateReject = await post(OTHER_TOKEN, { decision: "reject", reason: "too late" });
  assert.equal(lateReject.status, 404, "an expired token cannot reject");
  assert.equal(expired.status, "awaiting_approval");
  assert.equal(expired.rejected_reason, undefined);
  const rejectApproved = await post("ef".repeat(24), { decision: "reject", reason: "changed my mind" });
  assert.equal(rejectApproved.status, 404, "an approved take is not turned into a rejected one by a late tap");
  assert.equal(approvedAlready.status, "approved");
  const approveRejected = await post("12".repeat(24), { decision: "approve" });
  assert.equal(approveRejected.status, 404);
  assert.equal(rejectedAlready.status, "rejected");
  assert.equal(world.seen.updates.every((u) => u.kind), true);

  const longName = await post(TOKEN, { decision: "approve", approved_by: "n".repeat(300) });
  assert.equal(longName.status, 200);
  assert.equal(live.approved_by.length, 120, "the name is cut to 120 characters");

  const live2 = videoRow({ approval_token: "34".repeat(24), id: "v0000000-0000-4000-8000-0000000000e4" });
  const world2 = approvalWorld([live2]);
  const longReason = await call(adVideoApproveHandler, { ...open, method: "POST", body: { token: "34".repeat(24), decision: "reject", reason: "r".repeat(900) }, rules: world2.rules });
  assert.equal(longReason.status, 200);
  assert.equal(live2.rejected_reason.length, 500, "the reason is cut to 500 characters");
  const again = await call(adVideoApproveHandler, { ...open, method: "POST", body: { token: "34".repeat(24), decision: "reject", reason: "again" }, rules: world2.rules });
  assert.equal(again.status, 404, "the token is spent by a rejection");
  assert.equal(live2.rejected_reason.length, 500);
});

test("the approve and reject statements cut a name to 120 and a reason to 500 characters themselves, and fall back to a plain default, whoever calls them", async () => {
  const sent = [];
  const tx = { query: async (sql, params) => { sent.push({ sql, params }); return { rows: [{ id: "v", ad_id: "1", take_no: 1, status: "x" }] }; } };
  await approveByToken(tx, TOKEN, { approvedBy: "n".repeat(300) });
  await approveByToken(tx, TOKEN, { approvedBy: "" });
  await approveByToken(tx, TOKEN);
  await rejectByToken(tx, TOKEN, { reason: "r".repeat(900) });
  await rejectByToken(tx, TOKEN, { reason: "   " });
  await rejectByToken(tx, TOKEN);
  assert.equal(sent[0].params[1].length, 120);
  assert.equal(sent[1].params[1], "chris");
  assert.equal(sent[2].params[1], "chris");
  assert.equal(sent[3].params[1].length, 500);
  assert.equal(sent[4].params[1], "rejected from the phone notification, no reason typed");
  assert.equal(sent[5].params[1], "rejected from the phone notification, no reason typed");
  assert.equal(await approveByToken(tx, "not a token"), null, "a malformed token never reaches the database");
  assert.equal(await rejectByToken(tx, "nope"), null);
  assert.equal(sent.length, 6);
});

test("GET public/ad-video-approve page says what kind of video it is, the picture size, and warns only when a non-ad is not 4K", async () => {
  const html = (over) => call(adVideoApproveHandler, {
    ...open, query: { token: TOKEN }, headers: { accept: "text/html" }, rules: approvalWorld([videoRow(over)]).rules,
  });
  const fourK = await html({ width: 2160, height: 3840, video_kind: "not_ad", resolution_ok: true });
  assert.match(String(fourK.body), /Not an ad/);
  assert.match(String(fourK.body), /3840 \(4K\)|2160 by 3840 \(4K\)/);
  assert.doesNotMatch(String(fourK.body), /breaks the 4K rule/);
  const notFourK = await html({ video_kind: "not_ad", resolution_ok: false, width: 1080, height: 1920 });
  assert.match(String(notFourK.body), /This is not an ad and it is not 4K/);
  assert.match(String(notFourK.body), /\(1080p\)/);
  const ad = await html({ video_kind: "ad", resolution_ok: false });
  assert.match(String(ad.body), /Paid ad/, "an ad is labeled a paid ad");
  const unknown = await html({ resolution_ok: null, width: null, height: null, duration_seconds: null });
  assert.doesNotMatch(String(unknown.body), /breaks the 4K rule/, "an unmeasured picture is not flagged");
  assert.match(String(unknown.body), /not measured/);
});

/* ── public/eeo-survey ─────────────────────────────────────────────────────────────────────────────── */

const SURVEY_TOKEN = "t".repeat(43);

function eeoWorld({ invites = [], submit = null } = {}) {
  const seen = { reads: [], submits: [] };
  const rules = [
    [/FROM eeo_survey_invites i\s+LEFT JOIN eeo_responses r ON r\.invite_id = i\.id\s+WHERE i\.survey_token = \$1/, (sql, params) => {
      seen.reads.push({ sql, params });
      return rowsWhere(invites, sql, params).map(({ consumed, responded }) => ({ consumed, responded }));
    }],
    [/^\s*SELECT submit_eeo_response\(\$1, \$2, \$3, \$4, \$5\) AS id/, (sql, params) => {
      seen.submits.push({ sql, params });
      if (submit instanceof Error) return submit;
      return submit === null ? [{ id: "resp-1" }] : submit;
    }],
  ];
  return { rules, seen };
}

test("GET public/eeo-survey says whether this token's form is still open, with the field choices, never writes, and tells every bad token apart from nothing", async () => {
  const world = eeoWorld({ invites: [
    { survey_token: SURVEY_TOKEN, consumed: false, responded: false },
    { survey_token: "u".repeat(43), consumed: true, responded: false },
    { survey_token: "v".repeat(43), consumed: false, responded: true },
  ] });
  const fresh = await call(eeoSurveyHandler, { ...open, query: { token: SURVEY_TOKEN }, rules: world.rules });
  assert.equal(fresh.status, 200);
  assert.equal(fresh.body.ok, true);
  assert.equal(fresh.body.already_submitted, false);
  assert.equal(fresh.body.voluntary, true);
  assert.deepEqual(fresh.body.fields.gender.options, ["male", "female", "non_binary", "decline_to_state"]);
  assert.equal(fresh.body.fields.race_ethnicity.optional, true);
  assert.equal(fresh.headers["cache-control"], "no-store");
  assert.deepEqual(world.seen.reads[0].params, [SURVEY_TOKEN]);
  assertSqlHas(world.seen.reads[0].sql, { token: "WHERE i.survey_token = $1" });
  assert.doesNotMatch(world.seen.reads[0].sql, /application_id|candidate/, "the read never reaches the application");
  noWrites(fresh);
  // The flags come back as ready-made booleans, so the statement that makes them is pinned as sent: used means
  // the invite has a consumed time, answered means a response row joined to THIS invite.
  assertOnlySent(fresh, "eeo.status");
  assert.deepEqual(fresh.body.fields, {
    race_ethnicity: {
      label: "Race / ethnicity (EEO-1)", optional: true,
      options: ["hispanic_or_latino", "white", "black_or_african_american", "native_hawaiian_or_pacific_islander", "asian", "american_indian_or_alaska_native", "two_or_more_races", "decline_to_state"],
    },
    gender: { label: "Gender", optional: true, options: ["male", "female", "non_binary", "decline_to_state"] },
    veteran_status: { label: "Veteran status", optional: true, options: ["protected_veteran", "not_a_protected_veteran", "decline_to_state"] },
    disability_status: { label: "Disability status", optional: true, options: ["yes", "no", "decline_to_state"] },
  });

  const consumed = await call(eeoSurveyHandler, { ...open, query: { token: "u".repeat(43) }, rules: world.rules });
  assert.equal(consumed.body.already_submitted, true);
  assert.equal(consumed.body.voluntary, undefined);
  const responded = await call(eeoSurveyHandler, { ...open, query: { token: "v".repeat(43) }, rules: world.rules });
  assert.equal(responded.body.already_submitted, true);

  const unknown = await call(eeoSurveyHandler, { ...open, query: { token: "w".repeat(43) }, rules: world.rules });
  assert.equal(unknown.status, 400);
  assert.deepEqual(unknown.body, { ok: false, error: "invalid_token" });
  const reads = world.seen.reads.length;
  const short = await call(eeoSurveyHandler, { ...open, query: { token: "short" }, rules: world.rules });
  assert.equal(short.status, 400);
  assert.deepEqual(short.body, { ok: false, error: "invalid_token" });
  assert.equal(world.seen.reads.length, reads, "a token that is too short never reaches the database");
  const put = await call(eeoSurveyHandler, { ...open, method: "PUT", rules: world.rules });
  assert.equal(put.status, 405);
});

test("POST public/eeo-survey sends the answers to the one submit function and nothing else, answers the same words for a first or a repeat submit, and refuses a wrong value or an unknown token", async () => {
  const world = eeoWorld();
  const answers = { token: SURVEY_TOKEN, race_ethnicity: "decline_to_state", gender: "female", veteran_status: "not_a_protected_veteran", disability_status: "no" };
  const first = await call(eeoSurveyHandler, { ...open, method: "POST", body: answers, rules: world.rules });
  assert.equal(first.status, 200);
  assert.deepEqual(first.body, { ok: true, received: true });
  assert.deepEqual(world.seen.submits[0].params, [SURVEY_TOKEN, "decline_to_state", "female", "not_a_protected_veteran", "no"]);
  assert.deepEqual(dataCalls(first).map((c) => c.sql.replace(/\s+/g, " ").trim()), [
    "SELECT submit_eeo_response($1, $2, $3, $4, $5) AS id",
  ], "the one and only statement: the application link is severed inside the database function");
  assertOnlySent(first, "eeo.submit");

  const decline = await call(eeoSurveyHandler, {
    ...open, method: "POST",
    body: { token: SURVEY_TOKEN, race_ethnicity: "decline_to_state", gender: "decline_to_state", veteran_status: "decline_to_state", disability_status: "decline_to_state" },
    rules: world.rules,
  });
  assert.equal(decline.status, 200, "declining every question is a valid answer");
  assert.deepEqual(world.seen.submits[1].params, [SURVEY_TOKEN, "decline_to_state", "decline_to_state", "decline_to_state", "decline_to_state"]);

  const repeat = eeoWorld({ submit: [{ id: null }] });
  const second = await call(eeoSurveyHandler, { ...open, method: "POST", body: answers, rules: repeat.rules });
  assert.deepEqual(second.body, first.body, "no oracle: the same reply for a repeat");

  const noRow = eeoWorld({ submit: [] });
  const failed = await call(eeoSurveyHandler, { ...open, method: "POST", body: answers, rules: noRow.rules });
  assert.equal(failed.status, 400);
  assert.deepEqual(failed.body, { ok: false, error: "invalid_token" });
  const unknown = eeoWorld({ submit: new Error("unknown survey token") });
  const refused = await call(eeoSurveyHandler, { ...open, method: "POST", body: answers, rules: unknown.rules });
  assert.equal(refused.status, 400);
  assert.equal(refused.body.error, "invalid_token");
  const broken = eeoWorld({ submit: new Error("deadlock detected on 10.0.0.9") });
  const crashed = await call(eeoSurveyHandler, { ...open, method: "POST", body: answers, rules: broken.rules });
  assert.equal(crashed.status, 500);
  assert.doesNotMatch(JSON.stringify(crashed.body), /10\.0\.0\.9/);

  const calls = world.seen.submits.length;
  const wrongValue = await call(eeoSurveyHandler, { ...open, method: "POST", body: { ...answers, gender: "robot" }, rules: world.rules });
  assert.equal(wrongValue.status, 400);
  assert.deepEqual(wrongValue.body, { ok: false, error: "invalid_field", field: "gender" });
  const shortToken = await call(eeoSurveyHandler, { ...open, method: "POST", body: { ...answers, token: "short" }, rules: world.rules });
  assert.equal(shortToken.status, 400);
  assert.equal(shortToken.body.error, "invalid_token");
  const notJson = await call(eeoSurveyHandler, { ...open, method: "POST", rawBody: "{nope", rules: world.rules });
  assert.equal(notJson.status, 400);
  assert.equal(notJson.body.error, "invalid_json");
  assert.equal(world.seen.submits.length, calls, "a refused answer never reaches the database");
});

/* ── public/partner-page ───────────────────────────────────────────────────────────────────────────── */

const PARTNER = "b0000000-0000-4000-8000-000000000001";

function sitesWorld({ pages, brands }) {
  const seen = { byDomain: [], page: [], brand: [] };
  const rules = [
    [/FROM partner_brand b\s+JOIN partners p ON p\.id = b\.partner_id\s+WHERE b\.domain_verified = true\s+AND lower\(b\.domain\) = \$1/, (sql, params) => {
      seen.byDomain.push({ sql, params });
      return brands.filter((b) => b.domain_verified === true && String(b.domain).toLowerCase() === params[0]);
    }],
    [/^\s*SELECT \* FROM partner_pages\s+WHERE partner_id = \$1 AND slug = \$2 AND status = 'published'/, (sql, params) => {
      seen.page.push({ sql, params });
      return rowsWhere(pages, sql, params);
    }],
    [/^\s*SELECT \* FROM partner_brand WHERE partner_id = \$1/, (sql, params) => { seen.brand.push({ sql, params }); return rowsWhere(brands, sql, params); }],
  ];
  return { rules, seen };
}

test("GET public/partner-page answers a published page and only the public brand fields, by partner and slug or by a verified domain, and never a draft or private brand field", async () => {
  const pages = [
    { id: "p1", partner_id: PARTNER, slug: "apply", title: "Apply", funnel_key: "book_call", status: "published", body_json: { sections: [{ id: "hero" }] }, published_at: "2026-10-01T10:00:00.000Z" },
    { id: "p2", partner_id: PARTNER, slug: "draft", title: "Draft", funnel_key: null, status: "draft", body_json: {}, published_at: null },
  ];
  const brands = [{
    partner_id: PARTNER, ink: "#111111", paper: "#ffffff", display_face: "Fraunces", mono_face: "IBM Plex Mono", entity_name: "Acme Funding LLC",
    domain: "Apply.Acme.Test", domain_verified: true, support_email: "private-contact-line", entity_address: "1 Private Way", wordmark_url: "https://x.test/w.svg",
  }];
  const world = sitesWorld({ pages, brands });
  const byId = await call(partnerPageHandler, { ...open, query: { partner_id: PARTNER, slug: "APPLY" }, rules: world.rules });
  assert.equal(byId.status, 200);
  assert.deepEqual(byId.body, {
    ok: true,
    page: { id: "p1", title: "Apply", slug: "apply", funnel_key: "book_call", status: "published", body_json: { sections: [{ id: "hero" }] }, published_at: "2026-10-01T10:00:00.000Z" },
    brand: { ink: "#111111", paper: "#ffffff", display_face: "Fraunces", mono_face: "IBM Plex Mono", entity_name: "Acme Funding LLC", domain: "Apply.Acme.Test", domain_verified: true },
    live_path: `/sites/${PARTNER}/apply`,
  });
  assert.doesNotMatch(JSON.stringify(byId.body), /private-contact-line|Private Way|wordmark/, "private brand fields never leave");
  assert.deepEqual(world.seen.page[0].params, [PARTNER, "apply"], "the slug is lower-cased");
  assertSqlHas(world.seen.page[0].sql, { published: "AND status = 'published'", partner: "WHERE partner_id = $1" });
  noWrites(byId);

  const byDomain = await call(partnerPageHandler, { ...open, query: { domain: "APPLY.acme.test:443" }, rules: world.rules });
  assert.equal(byDomain.status, 200);
  assert.equal(byDomain.body.page.slug, "apply", "no slug on a domain means the apply page");
  assert.deepEqual(world.seen.byDomain[0].params, ["apply.acme.test"], "host lower-cased and port dropped");
  assertSqlHas(world.seen.byDomain[0].sql, { verified: "WHERE b.domain_verified = true" });

  const draft = await call(partnerPageHandler, { ...open, query: { partner_id: PARTNER, slug: "draft" }, rules: world.rules });
  assert.equal(draft.status, 404, "a page that is not published is not served");
  assert.deepEqual(draft.body, { ok: false, error: "not_found" });
});

test("GET public/partner-page refuses an unverified domain, a missing or bad address, a non-GET and a failure (one error word)", async () => {
  const world = sitesWorld({
    pages: [{ id: "p1", partner_id: PARTNER, slug: "apply", title: "Apply", funnel_key: null, status: "published", body_json: {}, published_at: null }],
    brands: [{ partner_id: PARTNER, domain: "pending.acme.test", domain_verified: false, ink: "#000" }],
  });
  const unverified = await call(partnerPageHandler, { ...open, query: { domain: "pending.acme.test" }, rules: world.rules });
  assert.equal(unverified.status, 404, "a domain nobody proved is not served");
  assert.equal(world.seen.page.length, 0);
  const none = await call(partnerPageHandler, { ...open, query: {}, rules: world.rules });
  assert.equal(none.status, 400);
  assert.equal(none.body.error, "partner_id_and_slug_or_domain_required");
  const badId = await call(partnerPageHandler, { ...open, query: { partner_id: "nope", slug: "apply" }, rules: world.rules });
  assert.equal(badId.status, 400);
  const post = await call(partnerPageHandler, { ...open, method: "POST", rules: world.rules });
  assert.equal(post.status, 405);
  const broken = await call(partnerPageHandler, { ...open, query: { partner_id: PARTNER, slug: "apply" }, rules: [[/FROM partner_pages/, new Error("could not connect to 10.0.0.9")]] });
  assert.equal(broken.status, 500);
  assert.doesNotMatch(JSON.stringify(broken.body), /10\.0\.0\.9/);
});

/* ── public/vsl-watch ──────────────────────────────────────────────────────────────────────────────── */

const VISITOR = "visitor-0123456789abcdef";
const SESSION = "session-0123456789abcdef";
const beacon = (over = {}) => ({
  v: "funnel/vsl.mp4", vid: VISITOR, sid: SESSION, dur: 207.215, pos: 91.4, pos_unmuted: 12, unmuted: true, finished: false, blocked: false,
  replays: 1, rewinds: 2, skips: 0, utm_content: "42-phase", page: "https://apply.fundhub.ai/watch", ref: "https://www.facebook.com/", device: "mobile",
  samples: [0, 5, 5.9, 10], n: 42, ...over,
});

function watchWorld({ recent = 0, known = false, siteRecent = 0 } = {}) {
  const seen = { rate: [], sessions: [], positions: [], scope: [] };
  const rules = [
    [/count\(\*\)::int FROM vsl_watch_sessions\s+WHERE visitor_id = \$1/, (sql, params) => { seen.rate.push({ sql, params }); return [{ recent, known, site_recent: siteRecent }]; }],
    [/^\s*INSERT INTO vsl_watch_sessions/, (sql, params) => { seen.sessions.push({ sql, params }); return [{ id: "sess-1" }]; }],
    [/^\s*INSERT INTO vsl_watch_positions/, (sql, params) => { seen.positions.push({ sql, params }); return []; }],
  ];
  return { rules, seen };
}
const watchDeps = (extra = {}) => ({ resolveDefaultOrg: async () => ORG_ID, ...extra });

test("POST public/vsl-watch stores one viewing under the visitor's own scope with the person-or-agent label decided by the server, and answers only { ok: true }", async () => {
  const world = watchWorld();
  const result = await call(vslWatchHandler, {
    ...open, method: "POST", body: beacon(), headers: { origin: "https://apply.fundhub.ai", "user-agent": "Mozilla/5.0 (iPhone)" }, rules: world.rules, deps: watchDeps(),
  });
  assert.equal(result.status, 200);
  assert.deepEqual(result.body, { ok: true }, "nothing about the row, not its id and not whether it was new");
  assert.equal(result.headers["access-control-allow-origin"], "https://apply.fundhub.ai");
  assert.deepEqual(sqlCalls(result, /set_config\('fundhub\.vsl_visitor'/)[0].params, [VISITOR], "scoped to this one visitor, never staff");
  assert.deepEqual(world.seen.rate[0].params, [VISITOR, SESSION, 60, 10]);
  assertSqlHas(world.seen.rate[0].sql, { site: "fundhub_vsl_recent_count($4::int)" });
  const [row] = world.seen.sessions;
  assert.deepEqual(row.params, [
    ORG_ID, "funnel/vsl.mp4", 207.215, VISITOR, SESSION, 91.4, 0.44109, 12, true, false, false, 1, 2, 0,
    "42-phase", "https://apply.fundhub.ai/watch", "https://www.facebook.com/", "mobile", "person", "browser",
  ]);
  assertSqlHas(row.sql, { oneRowPerViewing: "ON CONFLICT (visitor_id, session_key) DO UPDATE SET" });
  assert.deepEqual(world.seen.positions[0].params, ["sess-1", VISITOR, [0, 5, 10], 42], "whole seconds, each once, sorted");
  // The counts and the merge are done by the statements, so they are pinned as sent: the visitor's own rate
  // window, the site-wide count through the one function, an upsert that moves forward only, and a curve that
  // is merged and never replaced.
  assertOnlySent(result, "vsl.rate", "vsl.session", "vsl.positions");
  assertSent(result, "vsl.scope");
  assert.equal(sqlCalls(result, /set_config\('fundhub\.vsl_visitor'/)[0].sql.includes(", true)"), true, "the scope dies with the transaction");
  assert.equal(result.db.count("COMMIT"), 1);
  assert.equal(dataCalls(result).some((c) => /FROM live JOIN staff/.test(c.sql)), false);

  const robot = watchWorld();
  const agent = await call(vslWatchHandler, { ...open, method: "POST", body: beacon({ wd: false }), headers: { "user-agent": "Mozilla/5.0 HeadlessChrome/120" }, rules: robot.rules, deps: watchDeps() });
  assert.equal(agent.status, 200);
  assert.deepEqual(robot.seen.sessions[0].params.slice(-2), ["agent", "bot_browser"], "a headless browser is an agent even when the page script forgets to say so");
  const flagged = watchWorld();
  await call(vslWatchHandler, { ...open, method: "POST", body: beacon({ wd: true }), headers: { "user-agent": "Mozilla/5.0" }, rules: flagged.rules, deps: watchDeps() });
  assert.deepEqual(flagged.seen.sessions[0].params.slice(-2), ["agent", "automated_browser"]);
});

test("POST public/vsl-watch answers 429 with a wait when a visitor or the whole site is over the new-viewing ceiling, and never refuses a viewing that already exists", async () => {
  const visitorBurst = watchWorld({ recent: 40 });
  const burst = await call(vslWatchHandler, { ...open, method: "POST", body: beacon(), rules: visitorBurst.rules, deps: watchDeps() });
  assert.equal(burst.status, 429);
  assert.deepEqual(burst.body, { ok: false, error: "too_many_requests" });
  assert.equal(burst.headers["retry-after"], "3600");
  assert.equal(visitorBurst.seen.sessions.length, 0, "a refused beacon stores nothing");

  const flood = watchWorld({ siteRecent: 2000 });
  const site = await call(vslWatchHandler, { ...open, method: "POST", body: beacon(), rules: flood.rules, deps: watchDeps() });
  assert.equal(site.status, 429);
  assert.equal(site.headers["retry-after"], "600", "the site-wide guard has its own, shorter window");

  const existing = watchWorld({ recent: 500, siteRecent: 9999, known: true });
  const update = await call(vslWatchHandler, { ...open, method: "POST", body: beacon(), rules: existing.rules, deps: watchDeps() });
  assert.equal(update.status, 200, "a report for a viewing that already exists is an update, so it is never cut off");
  assert.equal(existing.seen.sessions.length, 1);

  const custom = watchWorld({ recent: 3 });
  const limited = await call(vslWatchHandler, {
    ...open, method: "POST", body: beacon(), rules: custom.rules, deps: watchDeps({ limits: { maxNewSessionsPerVisitor: 3, windowMinutes: 15 } }),
  });
  assert.equal(limited.status, 429);
  assert.equal(limited.headers["retry-after"], String(15 * 60), "the wait comes from the guard that fired");
});

test("POST public/vsl-watch lets the 40th new viewing through and stops the 41st, keeps the curve sorted and whole, and writes no curve when none was sent", async () => {
  const at39 = watchWorld({ recent: 39 });
  const ok = await call(vslWatchHandler, { ...open, method: "POST", body: beacon(), rules: at39.rules, deps: watchDeps() });
  assert.equal(ok.status, 200, "39 viewings in the window: one more is allowed");
  const at40 = watchWorld({ recent: 40 });
  const stopped = await call(vslWatchHandler, { ...open, method: "POST", body: beacon(), rules: at40.rules, deps: watchDeps() });
  assert.equal(stopped.status, 429, "40 in the window: that is the ceiling");
  const site1999 = watchWorld({ siteRecent: 1999 });
  const siteOk = await call(vslWatchHandler, { ...open, method: "POST", body: beacon(), rules: site1999.rules, deps: watchDeps() });
  assert.equal(siteOk.status, 200);
  const site2000 = watchWorld({ siteRecent: 2000 });
  const siteStop = await call(vslWatchHandler, { ...open, method: "POST", body: beacon(), rules: site2000.rules, deps: watchDeps() });
  assert.equal(siteStop.status, 429);
  assert.deepEqual(site2000.seen.rate[0].params, [VISITOR, SESSION, 60, 10], "the ceilings' own windows are asked for");

  const unsorted = watchWorld();
  await call(vslWatchHandler, { ...open, method: "POST", body: beacon({ samples: [10, 0, 5.4, 5.9, 0, 7], n: 6 }), rules: unsorted.rules, deps: watchDeps() });
  assert.deepEqual(unsorted.seen.positions[0].params[2], [0, 5, 7, 10], "each whole second once, in order, whatever order they arrived in");

  const noCurve = watchWorld();
  const none = await call(vslWatchHandler, { ...open, method: "POST", body: beacon({ samples: undefined, n: undefined }), rules: noCurve.rules, deps: watchDeps() });
  assert.equal(none.status, 200);
  assert.equal(noCurve.seen.sessions.length, 1, "the viewing is still saved");
  assert.equal(noCurve.seen.positions.length, 0, "no curve and no running total: no row that says 'we asked and got nothing'");
  const emptyCurve = watchWorld();
  await call(vslWatchHandler, { ...open, method: "POST", body: beacon({ samples: [], n: undefined }), rules: emptyCurve.rules, deps: watchDeps() });
  assert.equal(emptyCurve.seen.positions.length, 0, "an empty curve writes no row either");
  const totalOnly = watchWorld();
  await call(vslWatchHandler, { ...open, method: "POST", body: beacon({ samples: undefined, n: 12 }), rules: totalOnly.rules, deps: watchDeps() });
  assert.deepEqual(totalOnly.seen.positions[0].params, ["sess-1", VISITOR, null, 12], "a running total with no curve is saved as a total");
});

test("public/vsl-watch refuses junk with one word, answers the browser's permission question without writing, never opens CORS to another origin, and keeps failures to one word", async () => {
  const world = watchWorld();
  const junk = [
    beacon({ v: "../etc/passwd" }),
    beacon({ vid: "short" }),
    beacon({ dur: 0 }),
    beacon({ unmuted: "yes" }),
    beacon({ device: "toaster" }),
    beacon({ page: "javascript:alert(1)" }),
    beacon({ samples: Array.from({ length: 241 }, (_, i) => i) }),
  ];
  for (const body of junk) {
    const refused = await call(vslWatchHandler, { ...open, method: "POST", body, rules: world.rules, deps: watchDeps() });
    assert.equal(refused.status, 400);
    assert.deepEqual(refused.body, { ok: false, error: "invalid" }, "every reason is the same single word");
  }
  const notJson = await call(vslWatchHandler, { ...open, method: "POST", rawBody: "{nope", rules: world.rules, deps: watchDeps() });
  assert.equal(notJson.status, 400);
  const big = await call(vslWatchHandler, { ...open, method: "POST", body: beacon({ utm_content: "x".repeat(9000) }), rules: world.rules, deps: watchDeps() });
  assert.equal(big.status, 413);
  assert.deepEqual(big.body, { ok: false, error: "too_large" });
  assert.equal(world.seen.sessions.length, 0, "junk is refused, never stored");

  const preflight = await call(vslWatchHandler, { ...open, method: "OPTIONS", headers: { origin: "https://apply.fundhub.ai" }, rules: world.rules, deps: watchDeps() });
  assert.equal(preflight.status, 200);
  assert.equal(preflight.headers["access-control-allow-origin"], "https://apply.fundhub.ai");
  assert.equal(preflight.headers["access-control-allow-methods"], "POST, OPTIONS");
  assert.equal(dataCalls(preflight).length, 0, "the preflight reads and writes nothing");
  const stranger = await call(vslWatchHandler, { ...open, method: "OPTIONS", headers: { origin: "https://evil.example.test" }, rules: world.rules, deps: watchDeps() });
  assert.equal(stranger.headers["access-control-allow-origin"], undefined, "no wildcard and no echo for an origin not on the list");
  const get = await call(vslWatchHandler, { ...open, method: "GET", rules: world.rules, deps: watchDeps() });
  assert.equal(get.status, 405);

  const realError = console.error;
  console.error = () => {};
  try {
    const broken = await call(vslWatchHandler, {
      ...open, method: "POST", body: beacon(), rules: [[/INSERT INTO vsl_watch_sessions/, new Error("connection to 10.0.0.9 refused")]], deps: watchDeps(),
    });
    assert.equal(broken.status, 500);
    assert.deepEqual(broken.body, { ok: false, error: "error" });
  } finally {
    console.error = realError;
  }
});
