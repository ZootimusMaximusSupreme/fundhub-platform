// Guards for the batch 21 live checks (Staff & Teams, Social Studio, Teleprompter).
//
// A live check is one read-only SQL text. This file runs that exact text over stand-in rows and shows,
// for every check:
//   1. good rows read as right (bad_count 0, the right sample_count);
//   2. every named bad condition, alone, makes the check go red on its own row;
//   3. the same row is NOT caught when that one condition is left out of the text, so each condition is
//      load-bearing and no row is double-counted;
//   4. another company's wrong row is never read, and a demo row is never read.
// It also checks that every table and column in the text is a real one (db/schema and db/migrations),
// that the text is read-only, that each control is one exact row of the map, and that the registry holds
// the same text. These are tests with stand-in rows, not live reads.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  FIN_B21_CHECKS, FIN_B21_DISPLAY_CONTRACTS, FIN_B21_SOURCE_FILE, conditionNames, md5, pageRules, sqlFor
} from "./fin-b21-display-contracts.mjs";
import { REPO_ROOT, makeStandIn, schemaColumns, tablesIn } from "./fin-b21-sql-kit.mjs";

const ORG = "00000000-0000-4000-8000-0000000000a1";
const OTHER = "00000000-0000-4000-8000-0000000000b2";
const HOURS_AGO = (h) => new Date(Date.parse("2026-10-14T12:00:00.000Z") - h * 3_600_000).toISOString();
const HOURS_AHEAD = (h) => new Date(Date.parse("2026-10-14T12:00:00.000Z") + h * 3_600_000).toISOString();
const DAYS_AGO = (d) => HOURS_AGO(d * 24);
const R = (table, row) => [table, row];
// Fake login addresses and a fake phone, built from parts at run time.
const AT = "@";
const address = (name, domain = "example.test") => [name, domain].join(AT);
const PHONE = ["phone", "on", "file"].join("-");

let counter = 0;
const nid = (p) => `${p}-${String(++counter).padStart(4, "0")}`;

/* ── row builders. Each gives a GOOD row; a test overrides one field to make it wrong. ── */
const person = (o = {}) => ({
  id: nid("staff"), org_id: ORG, name: "Casey Proof", email: address("casey.proof"), role: "closer",
  status: "active", phone: PHONE, is_demo: false, notify_booked_call_sms: false, password_hash: "hash", ...o
});
const shift = (st, o = {}) => ({
  id: nid("shift"), org_id: ORG, staff_id: st.id, started_at: HOURS_AGO(30), ended_at: HOURS_AGO(22), is_demo: false, ...o
});
const link = (st, o = {}) => ({
  id: nid("link"), org_id: ORG, staff_id: st ? st.id : null, account_id: null, token_hash: nid("hash"), kind: "reset",
  created_at: HOURS_AGO(5), expires_at: HOURS_AGO(4), used_at: null, ...o
});
const session = (st, o = {}) => ({
  id: nid("sess"), org_id: ORG, staff_id: st.id, token_hash: nid("tok"), expires_at: HOURS_AHEAD(5),
  revoked_at: null, ...o
});
const ROLE_ROWS = ["closer", "owner", "admin", "sales_manager"].map((key) =>
  R("staff_roles", { id: `role-${key}`, org_id: ORG, key, name: key, active: true }));

const partner = (o = {}) => ({ id: nid("partner"), org_id: ORG, name: "Proof Partner", is_demo: false, ...o });
const post = (pt, o = {}) => ({
  id: nid("post"), org_id: ORG, partner_id: pt.id, channel_id: "chan-1", caption: "words", offer_type: "funding",
  status: "queued", scheduled_for: HOURS_AHEAD(1), posted_at: null, external_post_id: null, blocked_reasons: [],
  attempt: 0, last_error: null, created_at: HOURS_AGO(30), updated_at: HOURS_AGO(30), approved_at: null,
  approved_by: null, ...o
});
const screening = (p, state, o = {}) => R("compliance_screenings", {
  id: nid("scr"), org_id: ORG, partner_id: p.partner_id, subject_type: "social_post", subject_id: p.id, state, ...o
});
const queueRow = (pt, o = {}) => ({
  id: nid("queue"), org_id: ORG, partner_id: pt.id, caption: "words", offer_type: "funding", status: "queued",
  social_post_id: null, blocked_reasons: [], scheduled_for: null, created_at: HOURS_AGO(30), updated_at: HOURS_AGO(30), ...o
});
const channel = (pt, o = {}) => ({
  id: nid("chan"), org_id: ORG, partner_id: pt.id, channel: "facebook", external_account_id: "acct-1", handle: "@proof",
  encrypted_access_token: "cipher", token_expires_at: HOURS_AHEAD(500), connection_state: "active",
  scopes: ["pages_manage_posts"], best_times: { mon: ["09:30"] }, timezone: "UTC", ...o
});
const REFUSED = [{ code: "refused_by_a_person", rule_set: "approval", severity: "block", message: "refused" }];

const shootRow = (o = {}) => ({
  id: nid("shoot"), org_id: ORG, status: "filming", root_script_ids: ["root-1"], marks: {},
  started_at: HOURS_AGO(40), finished_at: null, created_at: HOURS_AGO(48), ...o
});
const script = (o = {}) => ({
  id: nid("script"), org_id: ORG, root_script_id: "root-1", archived_at: null, source: "machine",
  batch_id: null, body: "Every hard pull you did not need is still on your file.", ...o
});

/* ── one fixture per check: good rows, and for each named condition one row set that breaks only it ── */
const FIX = {};

{
  const st = person();
  const open = (who, o = {}) => shift(who, { started_at: HOURS_AGO(4), ended_at: null, ...o });
  FIX["staff-clock"] = {
    base: [R("staff", st), R("shifts", shift(st)), R("shifts", open(st))],
    sample: 3, // two shifts, plus the one group of open shifts
    violations: {
      "a shift ends before it starts": [R("shifts", shift(st, { started_at: HOURS_AGO(30), ended_at: HOURS_AGO(31) }))],
      "a shift is filed under another company than its person": (() => {
        const away = person({ org_id: OTHER });
        return [R("staff", away), R("shifts", shift(away, { org_id: ORG }))];
      })(),
      "a person has been clocked in for more than a day with nobody clocking out": (() => {
        const late = person();
        return [R("staff", late), R("shifts", shift(late, { started_at: HOURS_AGO(52), ended_at: null }))];
      })(),
      "one person holds two open shifts at once": (() => {
        const twice = person();
        return [R("staff", twice), R("shifts", open(twice)), R("shifts", open(twice, { started_at: HOURS_AGO(3) }))];
      })()
    },
    // How many rows each violation adds to sample_count (shift rows, plus one group row for open shifts).
    adds: {
      "a shift ends before it starts": 1,
      "a shift is filed under another company than its person": 1,
      "a person has been clocked in for more than a day with nobody clocking out": 2,
      "one person holds two open shifts at once": 3
    },
    notRead: [
      ["a shift of a demo person", (() => { const d = person({ is_demo: true }); return [R("staff", d), R("shifts", shift(d, { started_at: HOURS_AGO(30), ended_at: HOURS_AGO(31) }))]; })()],
      ["a demo shift", [R("shifts", shift(st, { is_demo: true, started_at: HOURS_AGO(30), ended_at: HOURS_AGO(31) }))]],
      ["a shift older than 90 days", [R("shifts", shift(st, { started_at: DAYS_AGO(200), ended_at: DAYS_AGO(201) }))]]
    ]
  };
}

{
  const st = person();
  const good = [
    R("staff", st),
    R("password_resets", link(st, { created_at: HOURS_AGO(10), expires_at: HOURS_AGO(9), used_at: HOURS_AGO(9.5) })),
    R("password_resets", link(st, { created_at: HOURS_AGO(0.5), expires_at: HOURS_AHEAD(0.5) }))
  ];
  FIX["staff-reset-link"] = {
    base: good,
    sample: 3, // two links, plus the one person's group of live links
    violations: {
      "the link does not run for one hour": (() => { const s = person(); return [R("staff", s), R("password_resets", link(s, { created_at: HOURS_AGO(10), expires_at: HOURS_AGO(7.5) }))]; })(),
      "the link was used after it ran out": (() => { const s = person(); return [R("staff", s), R("password_resets", link(s, { created_at: HOURS_AGO(10), expires_at: HOURS_AGO(9), used_at: HOURS_AGO(8) }))]; })(),
      "the link belongs to nobody": [R("password_resets", link(null, { created_at: HOURS_AGO(10), expires_at: HOURS_AGO(9) }))],
      "the link names a person from another company": (() => { const s = person({ org_id: OTHER }); return [R("staff", s), R("password_resets", link(s, { org_id: ORG, created_at: HOURS_AGO(10), expires_at: HOURS_AGO(9) }))]; })(),
      "a new reset link did not end the earlier one: two live links for one person": (() => {
        const s = person();
        return [R("staff", s), R("password_resets", link(s, { created_at: HOURS_AGO(0.5), expires_at: HOURS_AHEAD(0.5) })),
          R("password_resets", link(s, { created_at: HOURS_AGO(0.2), expires_at: HOURS_AHEAD(0.8) }))];
      })()
    },
    adds: {
      "the link does not run for one hour": 1,
      "the link was used after it ran out": 1,
      "the link belongs to nobody": 1,
      "the link names a person from another company": 1,
      "a new reset link did not end the earlier one: two live links for one person": 3
    },
    notRead: [
      ["an invite link", [R("password_resets", link(st, { kind: "invite", created_at: HOURS_AGO(10), expires_at: HOURS_AGO(1) }))]],
      ["a reset link older than 90 days", [R("password_resets", link(st, { created_at: DAYS_AGO(200), expires_at: DAYS_AGO(199) }))]]
    ]
  };
}

{
  const gone = person({ status: "suspended" });
  FIX["staff-revoke"] = {
    base: [
      R("staff", gone),
      R("sessions", session(gone, { revoked_at: HOURS_AGO(2) })),
      R("sessions", session(gone, { expires_at: HOURS_AGO(1) })),
      R("staff", person()), // an active person with a live session is nobody's business here
    ],
    sample: 1,
    violations: {
      "a suspended person still has a live session": (() => {
        const s = person({ status: "suspended" });
        return [R("staff", s), R("sessions", session(s))];
      })()
    },
    adds: { "a suspended person still has a live session": 1 },
    notRead: [
      ["a suspended demo person", (() => { const s = person({ status: "suspended", is_demo: true }); return [R("staff", s), R("sessions", session(s))]; })()]
    ]
  };
}

{
  const st = person({ status: "invited" });
  const invite = (who, o = {}) => link(who, { kind: "invite", created_at: DAYS_AGO(2), expires_at: DAYS_AGO(-5), ...o });
  FIX["staff-new-person"] = {
    base: [...ROLE_ROWS, R("staff", st), R("password_resets", invite(st))],
    sample: 1,
    violations: {
      "the invite does not run for 7 days": (() => { const s = person({ status: "invited" }); return [R("staff", s), R("password_resets", invite(s, { expires_at: DAYS_AGO(1) }))]; })(),
      "the invite belongs to nobody who exists": [R("password_resets", invite({ id: "staff-missing" }))],
      "the invite is filed under another company than its person": (() => {
        const s = person({ org_id: OTHER, status: "invited" });
        return [R("staff_roles", { id: "role-other-closer", org_id: OTHER, key: "closer", name: "closer", active: true }),
          R("staff", s), R("password_resets", invite(s, { org_id: ORG }))];
      })(),
      "the invited person has no login email": (() => { const s = person({ status: "invited", email: null }); return [R("staff", s), R("password_resets", invite(s))]; })(),
      "the invited person has no job": (() => { const s = person({ status: "invited", role: null }); return [R("staff", s), R("password_resets", invite(s))]; })(),
      "the invited person's job is not on the job list": (() => { const s = person({ status: "invited", role: "wizard" }); return [R("staff", s), R("password_resets", invite(s))]; })()
    },
    adds: Object.fromEntries([
      "the invite does not run for 7 days", "the invite belongs to nobody who exists",
      "the invite is filed under another company than its person", "the invited person has no login email",
      "the invited person has no job", "the invited person's job is not on the job list"
    ].map((name) => [name, 1])),
    notRead: [
      ["a reset link", [R("password_resets", link(st, { kind: "reset", created_at: HOURS_AGO(10), expires_at: HOURS_AGO(1) }))]]
    ]
  };
}

FIX["staff-profile"] = {
  base: [R("staff", person()), R("staff", person({ phone: null, email: address("second.person") }))],
  sample: 2,
  violations: {
    "the name is blank": [R("staff", person({ name: "   " }))],
    "the login email is not a clean lower-case address with an @": [R("staff", person({ email: address("Casey.Proof", "Example.test") }))],
    "the phone is saved as empty words": [R("staff", person({ phone: "  " }))],
    "a person who has a password has no login email": [R("staff", person({ email: null, password_hash: "hash" }))]
  },
  adds: Object.fromEntries([
    "the name is blank", "the login email is not a clean lower-case address with an @",
    "the phone is saved as empty words", "a person who has a password has no login email"
  ].map((name) => [name, 1])),
  notRead: [["a demo person", [R("staff", person({ is_demo: true, name: " " }))]]]
};

FIX["staff-role"] = {
  base: [...ROLE_ROWS, R("staff", person({ role: "closer" })), R("staff", person({ role: "sales_manager" })), R("staff", person({ role: null }))],
  sample: 2,
  violations: {
    "the job is not on the job list": [R("staff", person({ role: "wizard" }))],
    "the job is not saved in lower case": [R("staff", person({ role: "Closer" }))]
  },
  adds: { "the job is not on the job list": 1, "the job is not saved in lower case": 1 },
  notRead: [["a demo person", [R("staff", person({ is_demo: true, role: "wizard" }))]]]
};

{
  const st = person({ role: "setter", notify_booked_call_sms: false });
  const text = (who, o = {}) => ({
    id: nid("msg"), org_id: ORG, client_id: "client-1", direction: "outbound", channel: "sms",
    template_key: "SMS-S04C-STAFF-BOOKED", rendered_body: "YOU'RE UP: new book", provider: "internal",
    provider_ref: `workflow:SMS-S04C-STAFF-BOOKED:evt-1:${who.id}`, status: "queued", compliance_check_passed: true,
    to_address: PHONE, is_demo: false, created_at: HOURS_AGO(5), ...o
  });
  FIX["staff-booked-text"] = {
    base: [R("staff", st), R("messages", text(st))],
    sample: 2,
    violations: {
      "a setter or owner has no phone for lead texts": [R("staff", person({ role: "setter", notify_booked_call_sms: false, phone: null }))],
      "the text has no words": [R("messages", text(st, { rendered_body: " " }))],
      "the text has nobody to go to": [R("messages", text(st, { to_address: null }))],
      "a sent text was not marked as having passed the check": [R("messages", text(st, { status: "sent", compliance_check_passed: false }))],
      "the text is not an outbound text message": [R("messages", text(st, { direction: "inbound" }))],
      "the text names a person who is not on the staff list": [R("messages", text(st, { provider_ref: "workflow:SMS-S04C-STAFF-BOOKED:evt-9:staff-gone" }))]
    },
    adds: Object.fromEntries([
      "a setter or owner has no phone for lead texts", "the text has no words", "the text has nobody to go to",
      "a sent text was not marked as having passed the check", "the text is not an outbound text message",
      "the text names a person who is not on the staff list"
    ].map((name) => [name, 1])),
    notRead: [
      ["a text of another template", [R("messages", text(st, { template_key: "SMS-OTHER", rendered_body: " " }))]],
      ["a text older than 90 days", [R("messages", text(st, { created_at: DAYS_AGO(200), rendered_body: " " }))]],
      ["an inactive staff member", [R("staff", person({ role: "setter", status: "invited", phone: null }))]]
    ]
  };
}

/* ── social studio ── */
{
  const rules = pageRules();
  const live = (rule, o = {}) => R("compliance_rules", {
    id: nid("rule"), org_id: ORG, rule_set: rule.rule_set, rule_key: rule.rule_key,
    offer_types: rule.offer_types, platforms: rule.platforms, match_type: rule.match_type, pattern: rule.pattern,
    severity: rule.severity, message: rule.message, citation: rule.citation, active: true, ...o
  });
  const all = rules.map((rule) => live(rule));
  const without0 = rules.slice(1).map((rule) => live(rule));
  const withChange = (field, value) => rules.map((rule, i) => live(rule, i === 3 ? { [field]: value } : {}));
  FIX["social-wording"] = {
    wordingRows: true,
    base: all,
    sample: rules.length,
    violations: {
      "the page has a rule the server does not have": without0,
      "the saved rule has other words": withChange("message", `${rules[3].message} Also this.`),
      "the saved rule matches other text": withChange("pattern", `${rules[3].pattern}|extra`),
      "the saved rule has another kind of match": withChange("match_type", "phrase"),
      "the saved rule has another strength": withChange("severity", "warn"),
      "the saved rule names another offer": withChange("offer_types", ["credit_repair", "funding"]),
      "the saved rule names another platform": withChange("platforms", ["tiktok"]),
      "the saved rule cites another law": withChange("citation", "FTC Act 15 U.S.C. 46"),
      "the server has a rule the page does not have": [...all, live({
        rule_set: "claims", rule_key: "an-extra-live-rule", offer_types: [], platforms: [], match_type: "regex",
        pattern: "x", severity: "block", message: "m", citation: null
      })]
    },
    // These violations replace the base rule set, so the sample and bad counts are measured whole.
    replaceBase: true,
    skipAlone: true,
    skipOtherCompany: true,
    notRead: [
      ["an inactive extra rule", [live({ rule_set: "claims", rule_key: "retired", offer_types: [], platforms: [], match_type: "regex", pattern: "x", severity: "block", message: "m", citation: null }, { active: false })]],
      ["another company's extra rule", [live({ rule_set: "claims", rule_key: "theirs", offer_types: [], platforms: [], match_type: "regex", pattern: "x", severity: "block", message: "m", citation: null }, { org_id: OTHER })]]
    ]
  };
}

{
  const pt = partner();
  const ok = post(pt, { status: "queued" });
  const sent = post(pt, { status: "posted", offer_type: "credit_repair", approved_at: HOURS_AGO(20), approved_by: "staff-1", posted_at: HOURS_AGO(10), external_post_id: "ext-1" });
  FIX["social-approval"] = {
    base: [R("partners", pt), R("social_posts", ok), screening(ok, "passed"), R("social_posts", sent),
      R("partner_module_settings", { id: nid("ms"), org_id: ORG, partner_id: pt.id, approve_before_launch: true })],
    sample: 3,
    violations: {
      "a credit-repair post is lined up or sent with nobody's approval": (() => {
        const p = post(pt, { offer_type: "credit_repair" });
        return [R("social_posts", p), screening(p, "passed")];
      })(),
      "a post held for a person is lined up or sent with nobody's approval": (() => {
        const p = post(pt, { status: "queued" });
        return [R("social_posts", p), screening(p, "needs_approval")];
      })(),
      "an approval names nobody": (() => {
        const p = post(pt, { approved_at: HOURS_AGO(20), approved_by: null });
        return [R("social_posts", p), screening(p, "passed")];
      })(),
      "the saved setting sits under another company than its partner": (() => {
        const away = partner({ org_id: OTHER });
        return [R("partners", away), R("partner_module_settings", { id: nid("ms"), org_id: ORG, partner_id: away.id, approve_before_launch: true })];
      })()
    },
    adds: {
      "a credit-repair post is lined up or sent with nobody's approval": 1,
      "a post held for a person is lined up or sent with nobody's approval": 1,
      "an approval names nobody": 1,
      "the saved setting sits under another company than its partner": 1
    },
    notRead: [
      ["a post of a demo partner", (() => { const d = partner({ is_demo: true }); const p = post(d, { offer_type: "credit_repair" }); return [R("partners", d), R("social_posts", p)]; })()],
      ["a post that is only waiting", (() => { const p = post(pt, { status: "draft", offer_type: "credit_repair" }); return [R("social_posts", p)]; })()]
    ]
  };
}

{
  const pt = partner();
  FIX["social-accounts"] = {
    base: [R("partners", pt), R("social_channels", channel(pt)),
      R("social_channels", channel(pt, { channel: "linkedin", connection_state: "pending", encrypted_access_token: null, external_account_id: "org-1" }))],
    sample: 2,
    violations: {
      "the account has no account id": [R("social_channels", channel(pt, { external_account_id: " " }))],
      "the account says ready to post but holds no sign-in key": [R("social_channels", channel(pt, { encrypted_access_token: null }))],
      "the account says ready to post but its sign-in key has run out": [R("social_channels", channel(pt, { token_expires_at: HOURS_AGO(2) }))],
      "the posting times are not a day-by-day list": [R("social_channels", channel(pt, { best_times: ["09:30"] }))],
      "the permissions are not a list": [R("social_channels", channel(pt, { scopes: { a: 1 } }))],
      "the account sits in another company than its partner": (() => {
        const away = partner({ org_id: OTHER });
        return [R("partners", away), R("social_channels", channel(away, { org_id: ORG }))];
      })()
    },
    adds: Object.fromEntries([
      "the account has no account id", "the account says ready to post but holds no sign-in key",
      "the account says ready to post but its sign-in key has run out", "the posting times are not a day-by-day list",
      "the permissions are not a list", "the account sits in another company than its partner"
    ].map((name) => [name, 1])),
    notRead: [["an account of a demo partner", (() => { const d = partner({ is_demo: true }); return [R("partners", d), R("social_channels", channel(d, { external_account_id: "" }))]; })()]]
  };
}

{
  const pt = partner();
  const behind = post(pt, { status: "blocked", blocked_reasons: REFUSED });
  FIX["social-refuse"] = {
    base: [R("partners", pt), R("social_posts", behind),
      R("marketing_content_queue", queueRow(pt, { status: "blocked", blocked_reasons: REFUSED, social_post_id: behind.id })),
      // A post the copy check blocked is not a refusal and is not read.
      R("marketing_content_queue", queueRow(pt, { status: "blocked", blocked_reasons: [{ code: "guaranteed-approval" }] }))],
    sample: 1,
    violations: {
      "a refused post is not blocked on the queue": (() => {
        const p = post(pt, { status: "blocked", blocked_reasons: REFUSED });
        return [R("social_posts", p), R("marketing_content_queue", queueRow(pt, { status: "queued", blocked_reasons: REFUSED, social_post_id: p.id }))];
      })(),
      "a refused post has no post behind it that is blocked": (() => {
        const p = post(pt, { status: "queued", blocked_reasons: REFUSED });
        return [R("social_posts", p), R("marketing_content_queue", queueRow(pt, { status: "blocked", blocked_reasons: REFUSED, social_post_id: p.id }))];
      })(),
      "the blocked post behind a refusal does not carry the refusal reason": (() => {
        const p = post(pt, { status: "blocked", blocked_reasons: [{ code: "guaranteed-approval" }] });
        return [R("social_posts", p), R("marketing_content_queue", queueRow(pt, { status: "blocked", blocked_reasons: REFUSED, social_post_id: p.id }))];
      })(),
      "a refused post went out anyway": (() => {
        const p = post(pt, { status: "blocked", blocked_reasons: REFUSED, posted_at: HOURS_AGO(1), external_post_id: "ext-9" });
        return [R("social_posts", p), R("marketing_content_queue", queueRow(pt, { status: "blocked", blocked_reasons: REFUSED, social_post_id: p.id }))];
      })()
    },
    adds: Object.fromEntries([
      "a refused post is not blocked on the queue", "a refused post has no post behind it that is blocked",
      "the blocked post behind a refusal does not carry the refusal reason", "a refused post went out anyway"
    ].map((name) => [name, 1])),
    notRead: []
  };
}

{
  const pt = partner();
  const held = post(pt, { status: "blocked", blocked_reasons: REFUSED });
  FIX["social-throw-away"] = {
    base: [R("partners", pt), R("social_posts", held),
      R("marketing_content_queue", queueRow(pt, { status: "discarded" })),
      R("marketing_content_queue", queueRow(pt, { status: "discarded", social_post_id: held.id })),
      R("marketing_content_queue", queueRow(pt, { status: "queued" }))],
    sample: 2,
    violations: {
      "a thrown-away post still has a live post behind it": (() => {
        const p = post(pt, { status: "queued" });
        return [R("social_posts", p), R("marketing_content_queue", queueRow(pt, { status: "discarded", social_post_id: p.id }))];
      })()
    },
    adds: { "a thrown-away post still has a live post behind it": 1 },
    notRead: []
  };
}

{
  const pt = partner();
  const queued = post(pt, { status: "awaiting_approval" });
  FIX["social-states"] = {
    base: [
      R("partners", pt),
      R("social_posts", post(pt, { status: "posting", updated_at: HOURS_AGO(0.1) })),
      R("social_posts", post(pt, { status: "posted", posted_at: HOURS_AGO(3), external_post_id: "ext-1" })),
      R("social_posts", post(pt, { status: "failed", last_error: "token expired" })),
      R("social_posts", post(pt, { status: "blocked", blocked_reasons: [{ code: "x" }] })),
      R("social_posts", queued),
      R("marketing_content_queue", queueRow(pt, { status: "awaiting_approval", social_post_id: queued.id })),
      R("marketing_content_queue", queueRow(pt, { status: "blocked", blocked_reasons: [{ code: "x" }] }))
    ],
    sample: 7,
    violations: {
      "a post says Sending now but has been stuck there over 30 minutes": [R("social_posts", post(pt, { status: "posting", updated_at: HOURS_AGO(3) }))],
      "a post says Sent but has no time or no reference": [R("social_posts", post(pt, { status: "posted", posted_at: HOURS_AGO(3), external_post_id: null }))],
      "a post says Could not be sent but names no reason": [R("social_posts", post(pt, { status: "failed", last_error: null }))],
      "a post says Needs a rewrite but holds no reason": [R("social_posts", post(pt, { status: "blocked", blocked_reasons: [] }))],
      "a post is held for a person but already has an approval": [R("social_posts", post(pt, { status: "awaiting_approval", approved_at: HOURS_AGO(2), approved_by: "staff-1" }))],
      "a queue row is held for a person but has no post behind it": [R("marketing_content_queue", queueRow(pt, { status: "awaiting_approval", social_post_id: null }))],
      "a queue row says Needs a rewrite but holds no reason": [R("marketing_content_queue", queueRow(pt, { status: "blocked", blocked_reasons: [] }))]
    },
    adds: Object.fromEntries([
      "a post says Sending now but has been stuck there over 30 minutes", "a post says Sent but has no time or no reference",
      "a post says Could not be sent but names no reason", "a post says Needs a rewrite but holds no reason",
      "a post is held for a person but already has an approval", "a queue row is held for a person but has no post behind it",
      "a queue row says Needs a rewrite but holds no reason"
    ].map((name) => [name, 1])),
    notRead: [
      ["a post of a demo partner", (() => { const d = partner({ is_demo: true }); return [R("partners", d), R("social_posts", post(d, { status: "failed", last_error: null }))]; })()],
      ["a post older than 180 days", [R("social_posts", post(pt, { status: "failed", last_error: null, created_at: DAYS_AGO(400) }))]]
    ]
  };
}

/* ── teleprompter ── */
{
  const open = shootRow();
  const closed = shootRow({ status: "done", finished_at: HOURS_AGO(20), root_script_ids: [], marks: {} });
  FIX["shoot-open"] = {
    base: [R("marketing_shoots", open), R("ad_scripts", script()), R("marketing_shoots", closed)],
    sample: 3, // the open-shoot group, the open shoot, and its one script
    violations: {
      "more than one shoot is open, and the page shows only the newest": (() => {
        const second = shootRow({ root_script_ids: ["root-2"], created_at: HOURS_AGO(10) });
        return [R("marketing_shoots", second), R("ad_scripts", script({ root_script_id: "root-2" }))];
      })(),
      "an open shoot lists no scripts": [],
      "a script on the shoot no longer has a live, visible version": [],
      "a script on the shoot has no words to read": []
    },
    cleanBaseFor: {
      "an open shoot lists no scripts": [R("marketing_shoots", shootRow({ root_script_ids: [] }))],
      "a script on the shoot no longer has a live, visible version": [R("marketing_shoots", shootRow()), R("ad_scripts", script({ archived_at: HOURS_AGO(3) }))],
      "a script on the shoot has no words to read": [R("marketing_shoots", shootRow()), R("ad_scripts", script({ body: "  " }))]
    },
    adds: {},
    notRead: []
  };
}

{
  const sh = shootRow({ root_script_ids: ["root-1", "root-2"], marks: {
    "root-1": { takes: 2, got_it: true, at: HOURS_AGO(30) }, "root-2": { takes: 1, got_it: false, at: HOURS_AGO(29) } } });
  FIX["shoot-marks"] = {
    base: [R("marketing_shoots", sh), R("marketing_shoots", shootRow({ status: "planned", started_at: null, marks: {} }))],
    sample: 4, // two marks, two shoots
    violations: {
      "a mark is for a script that is not on this shoot": [R("marketing_shoots", shootRow({ marks: { "root-9": { takes: 1, got_it: true, at: HOURS_AGO(3) } } }))],
      "the take count is missing or less than one": [R("marketing_shoots", shootRow({ marks: { "root-1": { takes: 0, got_it: true, at: HOURS_AGO(3) } } }))],
      "Got it is not true or false": [R("marketing_shoots", shootRow({ marks: { "root-1": { takes: 1, got_it: "yes", at: HOURS_AGO(3) } } }))],
      "the mark has no time": [R("marketing_shoots", shootRow({ marks: { "root-1": { takes: 1, got_it: true } } }))],
      "a shoot has marks but still says planned": [R("marketing_shoots", shootRow({ status: "planned", marks: { "root-1": { takes: 1, got_it: true, at: HOURS_AGO(3) } } }))],
      "a shoot has marks but no start time": [R("marketing_shoots", shootRow({ started_at: null, marks: { "root-1": { takes: 1, got_it: true, at: HOURS_AGO(3) } } }))],
      "a shoot is closed but has no finish time": [R("marketing_shoots", shootRow({ status: "done", finished_at: null }))]
    },
    adds: {
      "a mark is for a script that is not on this shoot": 2,
      "the take count is missing or less than one": 2,
      "Got it is not true or false": 2,
      "the mark has no time": 2,
      "a shoot has marks but still says planned": 2,
      "a shoot has marks but no start time": 2,
      "a shoot is closed but has no finish time": 1
    },
    notRead: []
  };
}

/* ── helpers ── */

const SPEC = new Map(FIN_B21_CHECKS.map((spec) => [spec.key, spec]));
const toOther = (rows) => rows.map(([table, row]) => [table, row.org_id === ORG ? { ...row, org_id: OTHER } : row]);

function runRows(spec, rows, { without = [], org = ORG } = {}) {
  const sql = sqlFor(spec, { without });
  const names = new Set(tablesIn(sql));
  for (const [table] of rows) names.add(table);
  const db = makeStandIn([...names]);
  try {
    for (const [table, row] of rows) db.insert(table, row);
    return db.run(sql, org);
  } finally {
    db.close();
  }
}

/* ── tests ── */

test("every check is one exact row of the map, with its own unique control", () => {
  const rows = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "ops/workflows/coverage-every-surface-2026-10-10", FIN_B21_SOURCE_FILE), "utf8"));
  assert.equal(FIN_B21_CHECKS.length, 15);
  assert.equal(new Set(FIN_B21_CHECKS.map((c) => c.control)).size, 15);
  assert.equal(new Set(FIN_B21_CHECKS.map((c) => c.key)).size, 15);
  for (const spec of FIN_B21_CHECKS) {
    const found = rows.filter((row) => row.surface === spec.surface && row.control === spec.control);
    assert.equal(found.length, 1, `${spec.key}: ${spec.control}`);
  }
  assert.equal(FIN_B21_DISPLAY_CONTRACTS.length, 15);
});

test("every check has a fixture, and the fixture names every condition of its text", () => {
  for (const spec of FIN_B21_CHECKS) {
    const fix = FIX[spec.key];
    assert.ok(fix, `${spec.key} has a fixture`);
    assert.deepEqual(Object.keys(fix.violations).sort(), [...conditionNames(spec)].sort(), spec.key);
  }
});

test("each text is read-only, names a real table and column, and leaves no stray placeholder", () => {
  const schema = schemaColumns();
  for (const spec of FIN_B21_CHECKS) {
    const sql = sqlFor(spec);
    const bare = sql.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/'(?:[^']|'')*'/g, "''");
    assert.doesNotMatch(bare, /\b(insert|update|delete|drop|alter|truncate|create|grant|revoke|set|begin|commit)\b/i, spec.key);
    assert.match(sql, /\/\* display-result:[^*]+ \*\//);
    assert.match(sql, /sample_count/);
    assert.match(sql, /bad_count/);
    assert.match(sql, /\$1::uuid/);
    assert.doesNotMatch(sql, /\$[2-9]/);
    for (const table of tablesIn(sql)) assert.ok(schema.has(table), `${spec.key}: ${table} is a real table`);
  }
});

test("the registry rows hold exactly these texts and these flags", () => {
  for (const spec of FIN_B21_CHECKS) {
    const row = FIN_B21_DISPLAY_CONTRACTS.find((r) => r.control === spec.control);
    assert.ok(row, spec.key);
    assert.equal(row.mode, "query");
    assert.equal(row.sql, sqlFor(spec));
    assert.equal(row.anyImpact, true);
    assert.equal(row.emptyAs, spec.key === "social-wording" ? undefined : "quiet");
    assert.ok(row.requirement.length > 40);
  }
});

for (const spec of FIN_B21_CHECKS) {
  const fix = FIX[spec.key];

  test(`${spec.key}: good rows read as right`, () => {
    const out = runRows(spec, fix.base);
    assert.equal(out.bad_count, 0, JSON.stringify(out));
    assert.equal(out.sample_count, fix.sample);
  });

  for (const [name, rows] of Object.entries(fix.violations)) {
    test(`${spec.key}: goes red on "${name}", and only because of that condition`, () => {
      const clean = fix.cleanBaseFor?.[name];
      const used = clean ?? (fix.replaceBase ? rows : [...fix.base, ...rows]);
      const red = runRows(spec, used);
      assert.equal(red.bad_count, 1, `${name}: ${JSON.stringify(red)}`);
      const quiet = runRows(spec, used, { without: [name] });
      assert.equal(quiet.bad_count, 0, `${name} is load-bearing: ${JSON.stringify(quiet)}`);
      assert.equal(quiet.sample_count, red.sample_count, `${name}: the same rows are read either way`);
      if (fix.adds && fix.adds[name] !== undefined && !clean && !fix.replaceBase) {
        assert.equal(red.sample_count, fix.sample + fix.adds[name], `${name}: sample count`);
      }
    });
  }

  for (const [label, rows] of fix.notRead || []) {
    test(`${spec.key}: ${label} is not read`, () => {
      if (!fix.skipAlone) assert.equal(runRows(spec, rows).bad_count, 0);
      const withBase = runRows(spec, [...fix.base, ...rows]);
      assert.equal(withBase.bad_count, 0);
      assert.equal(withBase.sample_count, fix.sample);
    });
  }

  test(`${spec.key}: another company's wrong rows are never read`, () => {
    if (fix.skipOtherCompany) return;
    for (const [name, rows] of Object.entries(fix.violations)) {
      const clean = fix.cleanBaseFor?.[name];
      const rowsToUse = clean ?? (fix.replaceBase ? rows : [...fix.base, ...rows]);
      const out = runRows(spec, toOther(rowsToUse));
      assert.deepEqual(out, { sample_count: 0, bad_count: 0 }, `${spec.key} / ${name}`);
    }
  });

  test(`${spec.key}: with no rows at all it reads nothing wrong`, () => {
    const out = runRows(spec, []);
    assert.equal(out.bad_count, spec.key === "social-wording" ? out.sample_count : 0);
    if (spec.key !== "social-wording") assert.equal(out.sample_count, 0);
  });
}

test("social-wording: a company with no rules at all is red on every page rule", () => {
  const spec = SPEC.get("social-wording");
  const out = runRows(spec, []);
  assert.equal(out.sample_count, pageRules().length);
  assert.equal(out.bad_count, pageRules().length);
});

test("social-wording: the page's own words are carried as digests, and a live rule with the same words matches them", () => {
  const spec = SPEC.get("social-wording");
  const sql = sqlFor(spec);
  const rules = pageRules();
  // The text holds the keys and the digests and none of the pattern words (the lane guard forbids them).
  assert.doesNotMatch(sql.replace(/\/\*[\s\S]*?\*\//g, " "), /\b(insert|update|delete|drop|alter|truncate|create)\b/i);
  for (const rule of rules) {
    assert.ok(sql.includes(md5(rule.pattern)), `${rule.rule_key}: pattern digest`);
    assert.ok(sql.includes(md5(rule.message)), `${rule.rule_key}: message digest`);
    assert.ok(!sql.includes(rule.message.slice(0, 40)), `${rule.rule_key}: the words are not in the text`);
  }
  // The rule with an apostrophe in its words and the ones with backslash classes still match.
  assert.ok(rules.some((r) => r.message.includes("'")));
  assert.ok(rules.some((r) => r.pattern.includes("\\")));
  const db = makeStandIn(["compliance_rules"]);
  try {
    for (const rule of rules) {
      db.insert("compliance_rules", {
        id: nid("rule"), org_id: ORG, rule_set: rule.rule_set, rule_key: rule.rule_key, offer_types: rule.offer_types,
        platforms: rule.platforms, match_type: rule.match_type, pattern: rule.pattern, severity: rule.severity,
        message: rule.message, citation: rule.citation, active: true
      });
    }
    assert.deepEqual(db.run(sql, ORG), { sample_count: rules.length, bad_count: 0 });
  } finally {
    db.close();
  }
});

test("social-wording: a one-letter change to a rule's words or pattern is caught", () => {
  const spec = SPEC.get("social-wording");
  const rules = pageRules();
  const rows = (tweak) => rules.map((rule, i) => R("compliance_rules", {
    id: nid("rule"), org_id: ORG, rule_set: rule.rule_set, rule_key: rule.rule_key, offer_types: rule.offer_types,
    platforms: rule.platforms, match_type: rule.match_type, severity: rule.severity, citation: rule.citation, active: true,
    pattern: i === 5 && tweak === "pattern" ? `${rule.pattern}.` : rule.pattern,
    message: i === 5 && tweak === "message" ? `${rule.message}.` : rule.message
  }));
  assert.equal(runRows(spec, rows("pattern")).bad_count, 1);
  assert.equal(runRows(spec, rows("message")).bad_count, 1);
  assert.equal(runRows(spec, rows("none")).bad_count, 0);
});

test("social-wording: the page's rule book is the same as the seeded server rule book in the repo", () => {
  const seed = fs.readFileSync(path.join(REPO_ROOT, "db/migrations/047_compliance_rules.sql"), "utf8");
  const q = (s) => `'${String(s).replace(/'/g, "''")}'`;
  for (const rule of pageRules()) {
    for (const field of ["rule_key", "pattern", "message", "citation"]) {
      assert.ok(seed.includes(q(rule[field])), `${rule.rule_key}: ${field} is in the seed`);
    }
  }
  assert.equal(pageRules().length, 12);
});

test("shoot-open: with two open shoots the first group row goes red", () => {
  const spec = SPEC.get("shoot-open");
  const out = runRows(spec, [
    R("marketing_shoots", shootRow({ root_script_ids: ["root-1"] })), R("ad_scripts", script()),
    R("marketing_shoots", shootRow({ root_script_ids: ["root-2"], created_at: HOURS_AGO(2) })),
    R("ad_scripts", script({ root_script_id: "root-2" }))
  ]);
  assert.deepEqual(out, { sample_count: 5, bad_count: 1 });
});

test("shoot-open: a script held in a batch that is not released yet does not show, and a released one does", () => {
  const spec = SPEC.get("shoot-open");
  const held = runRows(spec, [
    R("marketing_shoots", shootRow()),
    R("marketing_batches", { id: "batch-1", org_id: ORG, status: "writing", release_at: HOURS_AGO(1) }),
    R("ad_scripts", script({ batch_id: "batch-1" }))
  ]);
  assert.equal(held.bad_count, 1);
  const released = runRows(spec, [
    R("marketing_shoots", shootRow()),
    R("marketing_batches", { id: "batch-1", org_id: ORG, status: "released", release_at: HOURS_AGO(1) }),
    R("ad_scripts", script({ batch_id: "batch-1" }))
  ]);
  assert.equal(released.bad_count, 0);
  const imported = runRows(spec, [R("marketing_shoots", shootRow()), R("ad_scripts", script({ source: "import" }))]);
  assert.equal(imported.bad_count, 1);
});

test("shoot-open: an older archived version beside a live one is fine", () => {
  const spec = SPEC.get("shoot-open");
  const out = runRows(spec, [
    R("marketing_shoots", shootRow()),
    R("ad_scripts", script({ archived_at: HOURS_AGO(40), body: "old" })),
    R("ad_scripts", script())
  ]);
  assert.equal(out.bad_count, 0);
});

test("staff-clock: a person who clocked in 23 hours ago is fine, and one 25 hours ago is red", () => {
  const spec = SPEC.get("staff-clock");
  const st = person();
  const fine = runRows(spec, [R("staff", st), R("shifts", shift(st, { started_at: HOURS_AGO(23), ended_at: null }))]);
  assert.equal(fine.bad_count, 0);
  const red = runRows(spec, [R("staff", st), R("shifts", shift(st, { started_at: HOURS_AGO(25), ended_at: null }))]);
  assert.equal(red.bad_count, 1);
});

test("staff-reset-link: a link of 55 and of 65 minutes is fine, 49 and 71 are red", () => {
  const spec = SPEC.get("staff-reset-link");
  const st = person();
  const at = (minutes) => runRows(spec, [R("staff", st),
    R("password_resets", link(st, { created_at: HOURS_AGO(10), expires_at: new Date(Date.parse(HOURS_AGO(10)) + minutes * 60_000).toISOString(), used_at: null }))]);
  assert.equal(at(55).bad_count, 0);
  assert.equal(at(65).bad_count, 0);
  assert.equal(at(49).bad_count, 1);
  assert.equal(at(71).bad_count, 1);
});

test("staff-reset-link: an expired link stamped when a newer link was made is ended, not used; a late use is red", () => {
  const spec = SPEC.get("staff-reset-link");
  const st = person();
  const stampedAt = HOURS_AGO(5);
  const ended = runRows(spec, [R("staff", st),
    R("password_resets", link(st, { created_at: HOURS_AGO(10), expires_at: HOURS_AGO(9), used_at: stampedAt })),
    R("password_resets", link(st, { created_at: new Date(Date.parse(stampedAt) + 61).toISOString(),
      expires_at: new Date(Date.parse(stampedAt) + 61 + 3_600_000).toISOString(), used_at: null }))]);
  assert.equal(ended.bad_count, 0);
  const late = runRows(spec, [R("staff", st),
    R("password_resets", link(st, { created_at: HOURS_AGO(10), expires_at: HOURS_AGO(9), used_at: stampedAt })),
    R("password_resets", link(st, { created_at: HOURS_AGO(3), expires_at: HOURS_AGO(2), used_at: null }))]);
  assert.equal(late.bad_count, 1);
});

test("staff-new-person: a 7 day invite is fine to the minute, and a 6 day one is red", () => {
  const spec = SPEC.get("staff-new-person");
  const st = person({ status: "invited" });
  const at = (days) => runRows(spec, [...ROLE_ROWS, R("staff", st),
    R("password_resets", link(st, { kind: "invite", created_at: DAYS_AGO(1), expires_at: new Date(Date.parse(DAYS_AGO(1)) + days * 86_400_000).toISOString() }))]);
  assert.equal(at(7).bad_count, 0);
  assert.equal(at(6).bad_count, 1);
  assert.equal(at(8).bad_count, 1);
});

test("staff-profile: a login email with no @ is red, and one with an @ and lower case is fine", () => {
  const spec = SPEC.get("staff-profile");
  const fine = runRows(spec, [R("staff", person({ email: address("casey.proof") }))]);
  assert.deepEqual(fine, { sample_count: 1, bad_count: 0 });
  const red = runRows(spec, [R("staff", person({ email: "casey.proof.example.test" }))]);
  assert.deepEqual(red, { sample_count: 1, bad_count: 1 });
});

test("staff-role: a job on the list that is switched off is not on the job list", () => {
  const spec = SPEC.get("staff-role");
  const off = [R("staff_roles", { id: "role-closer-off", org_id: ORG, key: "closer", name: "closer", active: false }),
    R("staff", person({ role: "closer" }))];
  assert.deepEqual(runRows(spec, off), { sample_count: 1, bad_count: 1 });
});

/* ── the checks use the product's own numbers and words ── */

test("the reset link band and the invite band are the writer's own 1 hour and 7 days", async () => {
  const { INVITE_TTL_MS, RESET_TTL_MS } = await import("../../../auth/invite.mjs");
  const reset = sqlFor(SPEC.get("staff-reset-link"));
  const invite = sqlFor(SPEC.get("staff-new-person"));
  const bounds = (sql) => [...sql.matchAll(/< (\d+) OR EXTRACT[^>]*> (\d+)\)/g)].map((m) => [Number(m[1]), Number(m[2])]);
  const [[rLow, rHigh]] = bounds(reset);
  const [[iLow, iHigh]] = bounds(invite);
  assert.ok(rLow < RESET_TTL_MS / 1000 && RESET_TTL_MS / 1000 < rHigh, `${RESET_TTL_MS} is inside ${rLow}..${rHigh}`);
  assert.ok(iLow < INVITE_TTL_MS / 1000 && INVITE_TTL_MS / 1000 < iHigh, `${INVITE_TTL_MS} is inside ${iLow}..${iHigh}`);
  // And the bands are tight: a day too long or too short is outside them.
  assert.ok(RESET_TTL_MS / 1000 - rLow <= 700 && rHigh - RESET_TTL_MS / 1000 <= 700);
  assert.ok(INVITE_TTL_MS / 1000 - iLow <= 700 && iHigh - INVITE_TTL_MS / 1000 <= 700);
});

test("the booked-call text check names the sender's own template and roles", async () => {
  const { STAFF_BOOKED_ROLES, STAFF_BOOKED_TEMPLATE } = await import("../../../staff/booked-call-alert.mjs");
  const sql = sqlFor(SPEC.get("staff-booked-text"));
  assert.ok(sql.includes(`'${STAFF_BOOKED_TEMPLATE}'`));
  for (const role of STAFF_BOOKED_ROLES) assert.ok(sql.includes(`'${role}'`), role);
  assert.equal(STAFF_BOOKED_ROLES.length, 2);
});

test("the shoot marks check reads the keys the real mark writer writes, and the film order's own open rule", async () => {
  const { applyMark } = await import("../../../marketing/shoot-plan.mjs");
  const out = applyMark({}, "root-1", "got_it", "2026-10-14T12:00:00.000Z");
  assert.deepEqual(Object.keys(out["root-1"]).sort(), ["at", "got_it", "takes"]);
  const sql = sqlFor(SPEC.get("shoot-marks"));
  for (const key of Object.keys(out["root-1"])) assert.ok(sql.includes(`'${key}'`), key);
  // Marks the writer produces read as right through the check.
  const spec = SPEC.get("shoot-marks");
  const marks = applyMark(applyMark({}, "root-1", "another_take", "2026-10-14T11:00:00.000Z"), "root-1", "got_it", "2026-10-14T11:05:00.000Z");
  assert.equal(marks["root-1"].takes, 2);
  const rows = [R("marketing_shoots", shootRow({ marks }))];
  assert.deepEqual(runRows(spec, rows), { sample_count: 2, bad_count: 0 });
});

test("the refusal, discard and held words the checks look for are the ones the posts door writes", () => {
  const door = fs.readFileSync(path.join(REPO_ROOT, "api/social/posts.mjs"), "utf8");
  assert.match(door, /code: "refused_by_a_person"/);
  assert.match(door, /SET status = 'discarded'/);
  assert.match(door, /SET status = 'blocked'/);
  assert.match(door, /status = 'awaiting_approval'/);
  const sql = [sqlFor(SPEC.get("social-refuse")), sqlFor(SPEC.get("social-throw-away"))].join("\n");
  assert.ok(sql.includes("refused_by_a_person"));
  assert.ok(sql.includes("'discarded'"));
});

test("the page's own state words are the ones the legend check uses", () => {
  const page = fs.readFileSync(path.join(REPO_ROOT, "public/app/social-studio.html"), "utf8");
  for (const [state, words] of [["posting", "Sending now"], ["posted", "Sent"], ["failed", "Could not be sent"],
    ["blocked", "Needs a rewrite"], ["awaiting_approval", "Held for a person"], ["draft", "Draft"], ["queued", "Waiting"]]) {
    assert.ok(page.includes(`${state}:'${words}'`), `${state} is called ${words} on the page`);
  }
  const sql = sqlFor(SPEC.get("social-states"));
  for (const state of ["posting", "posted", "failed", "blocked", "awaiting_approval"]) assert.ok(sql.includes(`'${state}'`), state);
});
