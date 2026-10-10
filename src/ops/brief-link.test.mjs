import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";

import {
  BRIEF_PAGE_PATH,
  BRIEF_TOKEN_LENGTH,
  BRIEF_LINK_MAX_AGE_DAYS,
  signBriefToken,
  verifyBriefToken,
  briefUrl,
  briefLinkConfigured,
  briefDateInWindow,
  briefRequestPlausible
} from "./brief-link.mjs";

const SECRET = "a1".repeat(32);
const ENV = { BRIEF_LINK_SECRET: SECRET };
const ORG = "fb789b0b-8d8d-4cdc-8a24-ee6b6659e0b6";
const OTHER_ORG = "00000000-0000-4000-8000-000000000001";
// 2026-10-09 06:00 in Phoenix (UTC-7).
const NOW = new Date("2026-10-09T13:00:00Z");
const DATE = "2026-10-09";

function flip(ch) {
  return ch === "A" ? "B" : "A";
}

test("the page path is the one the text links to", () => {
  assert.equal(BRIEF_PAGE_PATH, "/app/morning-brief.html");
});

test("the code is the first 32 characters of base64url HMAC-SHA256 over brief-v1|org|kind|date", () => {
  const token = signBriefToken({ orgId: ORG, kind: "morning", date: DATE, env: ENV });
  const expected = createHmac("sha256", SECRET)
    .update(`brief-v1|${ORG}|morning|${DATE}`)
    .digest("base64url")
    .slice(0, 32);
  assert.equal(token, expected);
  assert.equal(token.length, BRIEF_TOKEN_LENGTH);
  assert.match(token, /^[A-Za-z0-9_-]{32}$/, "base64url alphabet only: no + / or =");
});

test("a missing kind signs as morning", () => {
  assert.equal(
    signBriefToken({ orgId: ORG, date: DATE, env: ENV }),
    signBriefToken({ orgId: ORG, kind: "morning", date: DATE, env: ENV })
  );
});

test("the base64url alphabet holds across many codes", () => {
  for (let i = 1; i <= 28; i++) {
    const date = `2026-02-${String(i).padStart(2, "0")}`;
    for (const kind of ["morning", "evening"]) {
      const t = signBriefToken({ orgId: ORG, kind, date, env: ENV });
      assert.match(t, /^[A-Za-z0-9_-]{32}$/);
    }
  }
});

test("sign then verify passes for the same org, kind and day", () => {
  for (const kind of ["morning", "evening"]) {
    const token = signBriefToken({ orgId: ORG, kind, date: DATE, env: ENV });
    assert.equal(verifyBriefToken({ orgId: ORG, kind, date: DATE, token, env: ENV, now: NOW }), true);
  }
});

test("a code for one org, kind or day does not open another", () => {
  const token = signBriefToken({ orgId: ORG, kind: "morning", date: DATE, env: ENV });
  assert.equal(verifyBriefToken({ orgId: OTHER_ORG, kind: "morning", date: DATE, token, env: ENV, now: NOW }), false);
  assert.equal(verifyBriefToken({ orgId: ORG, kind: "evening", date: DATE, token, env: ENV, now: NOW }), false);
  assert.equal(verifyBriefToken({ orgId: ORG, kind: "morning", date: "2026-10-08", token, env: ENV, now: NOW }), false);
  assert.equal(verifyBriefToken({ orgId: ORG, kind: "weekly", date: DATE, token, env: ENV, now: NOW }), false);
  assert.equal(verifyBriefToken({ orgId: null, kind: "morning", date: DATE, token, env: ENV, now: NOW }), false);
});

test("a code made with another secret does not pass", () => {
  const token = signBriefToken({ orgId: ORG, kind: "morning", date: DATE, env: { BRIEF_LINK_SECRET: "b2".repeat(32) } });
  assert.equal(verifyBriefToken({ orgId: ORG, kind: "morning", date: DATE, token, env: ENV, now: NOW }), false);
});

test("a tampered, cut, padded, empty or non-string code does not pass", () => {
  const token = signBriefToken({ orgId: ORG, kind: "morning", date: DATE, env: ENV });
  const bad = [
    token.slice(0, -1) + flip(token.slice(-1)),
    flip(token[0]) + token.slice(1),
    token.slice(0, 31),
    token.slice(0, 16),
    token + "A",
    token + "=",
    token.replace(/./, "+"),
    "",
    " ".repeat(32),
    null,
    undefined,
    12345,
    { token },
    [token],
    Buffer.from(token)
  ];
  for (const t of bad) {
    assert.equal(
      verifyBriefToken({ orgId: ORG, kind: "morning", date: DATE, token: t, env: ENV, now: NOW }),
      false,
      `should refuse ${typeof t}`
    );
  }
});

test("the 14-day window: today and 14 days back pass; 15 days back and tomorrow do not", () => {
  const sign = (date) => signBriefToken({ orgId: ORG, kind: "morning", date, env: ENV });
  const ok = (date) => verifyBriefToken({ orgId: ORG, kind: "morning", date, token: sign(date), env: ENV, now: NOW });
  assert.equal(BRIEF_LINK_MAX_AGE_DAYS, 14);
  assert.equal(ok("2026-10-09"), true, "today");
  assert.equal(ok("2026-10-01"), true, "8 days old");
  assert.equal(ok("2026-09-25"), true, "14 days old, the last good day");
  assert.equal(ok("2026-09-24"), false, "15 days old");
  assert.equal(ok("2026-10-10"), false, "tomorrow");
  assert.equal(ok("2027-10-09"), false, "next year");
});

test("the window uses the Phoenix date, not the UTC date", () => {
  // 2026-10-10 03:00 UTC is still 2026-10-09 20:00 in Phoenix.
  const late = new Date("2026-10-10T03:00:00Z");
  assert.equal(briefDateInWindow("2026-10-10", late), false, "tomorrow in Phoenix");
  assert.equal(briefDateInWindow("2026-10-09", late), true);
  // 2026-10-24 06:59 UTC is still 2026-10-23 in Phoenix: 14 days after 10-09.
  assert.equal(briefDateInWindow("2026-10-09", new Date("2026-10-24T06:59:00Z")), true);
  assert.equal(briefDateInWindow("2026-10-09", new Date("2026-10-24T07:00:00Z")), false);
});

test("a bad date never passes", () => {
  for (const date of ["2026-02-30", "2026-13-01", "20261009", "2026-10-9", "", null, undefined, "2026-10-09T00:00:00Z"]) {
    assert.equal(briefDateInWindow(date, NOW), false);
    assert.equal(signBriefToken({ orgId: ORG, kind: "morning", date, env: ENV }), null);
  }
});

test("a missing, short or masked secret makes no code and passes none", () => {
  const good = signBriefToken({ orgId: ORG, kind: "morning", date: DATE, env: ENV });
  const badEnvs = [
    {},
    { BRIEF_LINK_SECRET: "" },
    { BRIEF_LINK_SECRET: "x".repeat(31) },
    { BRIEF_LINK_SECRET: "****************" + "x".repeat(20) },
    { BRIEF_LINK_SECRET: "*".repeat(64) },
    null,
    undefined
  ];
  for (const env of badEnvs) {
    assert.equal(briefLinkConfigured(env), false);
    assert.equal(signBriefToken({ orgId: ORG, kind: "morning", date: DATE, env }), null);
    assert.equal(verifyBriefToken({ orgId: ORG, kind: "morning", date: DATE, token: good, env, now: NOW }), false);
    assert.equal(briefUrl({ orgId: ORG, kind: "morning", date: DATE, env }), null);
  }
  assert.equal(briefLinkConfigured(ENV), true);
  assert.equal(briefLinkConfigured({ BRIEF_LINK_SECRET: "x".repeat(32) }), true, "32 is enough");
});

test("the plausibility check needs no org and refuses junk before any database read", () => {
  const token = signBriefToken({ orgId: ORG, kind: "morning", date: DATE, env: ENV });
  assert.equal(briefRequestPlausible({ kind: "morning", date: DATE, token, env: ENV, now: NOW }), true);
  assert.equal(briefRequestPlausible({ kind: "morning", date: DATE, token: "short", env: ENV, now: NOW }), false);
  assert.equal(briefRequestPlausible({ kind: "noon", date: DATE, token, env: ENV, now: NOW }), false);
  assert.equal(briefRequestPlausible({ kind: "morning", date: "2026-01-01", token, env: ENV, now: NOW }), false);
  assert.equal(briefRequestPlausible({ kind: "morning", date: DATE, token, env: {}, now: NOW }), false);
});

test("briefUrl builds the tokened link the text sends", () => {
  const morning = briefUrl({ orgId: ORG, kind: "morning", date: DATE, env: ENV });
  const token = signBriefToken({ orgId: ORG, kind: "morning", date: DATE, env: ENV });
  assert.equal(morning, `https://fundhub.ai/app/morning-brief.html?date=${DATE}&k=${token}`);

  const evening = briefUrl({ orgId: ORG, kind: "evening", date: DATE, env: ENV, baseUrl: "https://fundhub.ai/" });
  const u = new URL(evening);
  assert.equal(u.origin + u.pathname, "https://fundhub.ai/app/morning-brief.html");
  assert.equal(u.searchParams.get("date"), DATE);
  assert.equal(u.searchParams.get("kind"), "evening");
  assert.equal(verifyBriefToken({ orgId: ORG, kind: "evening", date: DATE, token: u.searchParams.get("k"), env: ENV, now: NOW }), true);

  assert.equal(
    briefUrl({ orgId: ORG, kind: "morning", date: DATE, env: { ...ENV, APP_BASE_URL: "https://example.test/" } }).startsWith("https://example.test/app/morning-brief.html?"),
    true
  );
  assert.equal(briefUrl({ orgId: "not-a-uuid", kind: "morning", date: DATE, env: ENV }), null);
  assert.equal(briefUrl({ orgId: ORG, kind: "weekly", date: DATE, env: ENV }), null);
});
