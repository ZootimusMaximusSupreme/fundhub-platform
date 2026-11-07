// Unit tests for the consent gate — the rules that hold before Postgres is
// involved at all.
//
// These run in every CI pass, with or without DATABASE_URL. The Postgres half
// (the CHECK constraints refusing an unattributed or blank-worded consent, the
// immutability trigger, and the validity predicate evaluated against the
// database's own clock) is in consent.pg.test.mjs.
//
// WHAT THIS FILE IS FOR. A gate is only worth having if every way of failing to
// answer the question lands on "no". So the largest block below is the one that
// enumerates the ways a caller can fail to supply an org, a client or a kind,
// and asserts each of them refuses — because a gate whose error path returns
// `true` is worse than no gate, and that failure mode is invisible in a happy-
// path test.

import { test, describe } from "node:test";
import assert from "node:assert";

import {
  hasValidConsent,
  consentStatus,
  captureConsent,
  revokeConsent,
  listConsents,
  normalizeConsentText,
  normalizeCaptureMethod,
  normalizeGranter,
  normalizeExpiry,
  boundedLimit,
  decorate,
  ConsentError,
  CONSENT_KINDS,
  CAPTURE_METHODS,
  CONSENT_REASONS
} from "./index.mjs";

import {
  disclosureFor,
  versionsFor,
  CURRENT_SOFT_PULL_VERSION,
  SOFT_PULL_DISCLOSURES,
  CURRENT_DISPUTE_AUTH_VERSION,
  DISPUTE_AUTH_DISCLOSURES
} from "./disclosures.mjs";
import { assertKnownSubtype, KINDS } from "../documents/kinds.mjs";

/* fakeDb — records every query and answers from a scripted queue. Same shape as
   the one in src/finance/soft-pulls.test.mjs, deliberately: the two modules are
   read together and a second fake with different ergonomics would make that
   harder than it needs to be. */
function fakeDb(rows = []) {
  const calls = [];
  const queue = [...rows];
  return {
    calls,
    query: async (text, params) => {
      calls.push({ text, params });
      return queue.length ? queue.shift() : { rows: [] };
    }
  };
}

const ORG = "11111111-1111-1111-1111-111111111111";
const CLIENT = "22222222-2222-2222-2222-222222222222";
const STAFF = "33333333-3333-3333-3333-333333333333";
const ACCOUNT = "44444444-4444-4444-4444-444444444444";
const CONSENT = "66666666-6666-6666-6666-666666666666";

const rowFor = (over = {}) => ({
  id: CONSENT, org_id: ORG, client_id: CLIENT, kind: "soft_pull_consent",
  consent_text: "I authorize Fundhub to obtain my consumer credit report through a soft inquiry.",
  consent_version: "soft-pull-v1",
  granted_by_kind: "client", granted_by_account_id: ACCOUNT, granted_by_staff_id: null,
  capture_method: "typed", granted_name: "Dana Client",
  captured_ip: null, captured_user_agent: null, document_id: null,
  granted_at: new Date(Date.now() - 60_000), expires_at: null,
  revoked_at: null, revoked_reason: null, revoked_by_kind: null,
  revoked_by_account_id: null, revoked_by_staff_id: null,
  created_at: new Date(), updated_at: new Date(),
  is_valid: true,
  ...over
});

const subject = { orgId: ORG, clientId: CLIENT, kind: "soft_pull_consent" };

// ── the gate fails closed, in every direction ──────────────────────────────

describe("the gate has no failure mode that produces true", () => {
  /* Each of these is a way of asking the question badly. Every one of them must
     answer "no". This is the block that matters most in the file: a gate that
     throws on bad input is safe (the caller 500s and no pull happens), and a
     gate that returns false is safe, but a gate that returns true because a
     WHERE clause quietly lost a term is a silent authorisation. */
  const unanswerable = [
    ["no arguments at all", undefined],
    ["an empty object", {}],
    ["no org", { clientId: CLIENT, kind: "soft_pull_consent" }],
    ["a null org", { ...subject, orgId: null }],
    ["a blank org", { ...subject, orgId: "   " }],
    ["an empty-string org", { ...subject, orgId: "" }],
    ["no client", { orgId: ORG, kind: "soft_pull_consent" }],
    ["a null client", { ...subject, clientId: null }],
    ["a blank client", { ...subject, clientId: "  \t " }],
    ["no kind", { orgId: ORG, clientId: CLIENT }],
    ["an unknown kind", { ...subject, kind: "vibes" }],
    ["a kind that is nearly right", { ...subject, kind: "soft_pull_consents" }],
    ["a near-miss of dispute_authorization", { ...subject, kind: "dispute_authorizations" }],
    ["a null kind", { ...subject, kind: null }],
    ["a numeric kind", { ...subject, kind: 1 }]
  ];

  for (const [label, args] of unanswerable) {
    test(`${label} → false, and no query is issued`, async () => {
      const db = fakeDb([{ rows: [rowFor()] }]);   // a VALID consent is waiting
      assert.equal(await hasValidConsent(db, args), false,
        `${label} opened the gate`);
      // The queued valid row proves the point: the refusal is not "the query
      // found nothing", it is "the question was never asked".
      assert.deepEqual(db.calls, [],
        `${label} reached the database — an unscoped query is the bug this guards`);
    });
  }

  test("a missing org is reported as a scope failure, not as 'none on file'", async () => {
    // Different facts and different fixes. "None on file" sends somebody to the
    // capture screen; a scope failure is ours and no amount of capturing helps.
    const s = await consentStatus(fakeDb(), { clientId: CLIENT, kind: "soft_pull_consent" });
    assert.equal(s.valid, false);
    assert.equal(s.reason, CONSENT_REASONS.NO_ORG);
    assert.equal(s.consent, null);
  });
});

// ── the query the gate actually issues ─────────────────────────────────────

describe("the gate's query", () => {
  test("is scoped by org, client AND kind — all three, always", async () => {
    const db = fakeDb([{ rows: [rowFor()] }]);
    await hasValidConsent(db, subject);
    assert.equal(db.calls.length, 1);
    const q = db.calls[0];
    assert.match(q.text, /FROM client_consents/i);
    assert.match(q.text, /org_id = \$1/, "the gate query lost its org scope");
    assert.match(q.text, /client_id = \$2/);
    assert.match(q.text, /kind = \$3/);
    assert.deepEqual(q.params, [ORG, CLIENT, "soft_pull_consent"]);
  });

  test("evaluates expiry against the DATABASE clock, not the web server's", async () => {
    // Two clocks in a compliance decision is one too many, and the one that
    // drifts is the one nobody monitors. now() must appear in the SQL.
    const db = fakeDb([{ rows: [rowFor()] }]);
    await hasValidConsent(db, subject);
    const q = db.calls[0].text;
    assert.match(q, /expires_at IS NULL OR expires_at > now\(\)/,
      "expiry is not evaluated in SQL — a JS Date comparison would use a second clock");
    assert.match(q, /revoked_at IS NULL/);
    assert.match(q, /granted_at <= now\(\)/);
  });

  test("asks for one row and ranks valid consents first", async () => {
    // Many consents per client is the designed state (099 has no unique index).
    // "The current consent is the newest valid one" is this ORDER BY.
    const db = fakeDb([{ rows: [rowFor()] }]);
    await hasValidConsent(db, subject);
    const q = db.calls[0].text;
    assert.match(q, /ORDER BY .*DESC, granted_at DESC, id DESC/s);
    assert.match(q, /LIMIT 1/);
  });
});

// ── what the verdict says ──────────────────────────────────────────────────

describe("the verdict and its reason", () => {
  test("a live consent is valid", async () => {
    const s = await consentStatus(fakeDb([{ rows: [rowFor()] }]), subject);
    assert.equal(s.valid, true);
    assert.equal(s.reason, CONSENT_REASONS.OK);
    assert.equal(s.consent.id, CONSENT);
  });

  test("nothing on file is 'none', and carries no consent object to misread", async () => {
    const s = await consentStatus(fakeDb([{ rows: [] }]), subject);
    assert.equal(s.valid, false);
    assert.equal(s.reason, CONSENT_REASONS.NONE);
    assert.equal(s.consent, null);
  });

  test("a revoked consent is invalid, and the row comes back so a screen can say when", async () => {
    const when = new Date(Date.now() - 5000);
    const s = await consentStatus(fakeDb([{ rows: [rowFor({
      is_valid: false, revoked_at: when, revoked_reason: "client withdrew",
      revoked_by_kind: "client", revoked_by_account_id: ACCOUNT
    })] }]), subject);
    assert.equal(s.valid, false);
    assert.equal(s.reason, CONSENT_REASONS.REVOKED);
    assert.equal(s.consent.revoked_reason, "client withdrew");
  });

  test("an expired consent is invalid", async () => {
    const s = await consentStatus(fakeDb([{ rows: [rowFor({
      is_valid: false, expires_at: new Date(Date.now() - 1000)
    })] }]), subject);
    assert.equal(s.valid, false);
    assert.equal(s.reason, CONSENT_REASONS.EXPIRED);
  });

  test("a consent revoked AND expired reports REVOKED — the fact the person acted on", async () => {
    const s = await consentStatus(fakeDb([{ rows: [rowFor({
      is_valid: false,
      expires_at: new Date(Date.now() - 2000),
      revoked_at: new Date(Date.now() - 1000), revoked_reason: "withdrew",
      revoked_by_kind: "client", revoked_by_account_id: ACCOUNT
    })] }]), subject);
    assert.equal(s.reason, CONSENT_REASONS.REVOKED,
      "an expiry masked a withdrawal — the consumer is told the wrong thing");
  });

  test("decorate drops the raw is_valid so no caller can read two answers from one object", () => {
    const d = decorate(rowFor({ is_valid: true }));
    assert.equal(d.valid, true);
    assert.equal("is_valid" in d, false);
    assert.equal(decorate(rowFor({ is_valid: false })).valid, false);
    assert.equal(decorate(null), null);
  });
});

// ── capture: an unattributed or wordless consent is not a consent ──────────

describe("capturing a consent", () => {
  const goodCapture = {
    orgId: ORG, clientId: CLIENT, kind: "soft_pull_consent",
    consentText: "I authorize the soft pull.",
    grantedBy: { kind: "client", id: ACCOUNT },
    captureMethod: "typed", grantedName: "Dana Client"
  };

  for (const [label, over, status] of [
    ["no org", { orgId: null }, 400],
    ["a blank org", { orgId: "  " }, 400],
    ["no client", { clientId: null }, 400],
    ["an unknown kind", { kind: "vibes" }, 400],
    ["no granter", { grantedBy: null }, 401],
    ["a granter with no subject", { grantedBy: { kind: "client" } }, 401],
    ["a granter kind the table refuses", { grantedBy: { kind: "robot", id: STAFF } }, 400],
    ["no consent text", { consentText: null }, 400],
    ["whitespace-only consent text", { consentText: " \t\n " }, 400],
    ["a non-string consent text", { consentText: 42 }, 400],
    ["no capture method", { captureMethod: null }, 400],
    ["an invented capture method", { captureMethod: "verbal" }, 400],
    ["a typed consent with no name", { captureMethod: "typed", grantedName: null }, 400],
    ["a signed consent with a blank name", { captureMethod: "signature", grantedName: "   " }, 400],
    ["an unreadable expiry", { expiresAt: "next Tuesday" }, 400]
  ]) {
    test(`${label} is refused before anything is written`, async () => {
      const db = fakeDb();
      await assert.rejects(
        () => captureConsent(db, { ...goodCapture, ...over }),
        (e) => {
          assert.ok(e instanceof ConsentError, `threw ${e.name}, not ConsentError`);
          assert.equal(e.status, status, `${label} produced ${e.status}, not ${status}`);
          return true;
        }
      );
      assert.deepEqual(db.calls, [], `${label} reached the database`);
    });
  }

  test("a checkbox consent needs no name — a ticked box carries none", async () => {
    const db = fakeDb([{ rows: [rowFor({ capture_method: "checkbox", granted_name: null })] }]);
    const c = await captureConsent(db, {
      ...goodCapture, captureMethod: "checkbox", grantedName: null
    });
    assert.equal(c.capture_method, "checkbox");
  });

  test("the words are stored verbatim, trimmed only at the ends", async () => {
    const db = fakeDb([{ rows: [rowFor()] }]);
    await captureConsent(db, { ...goodCapture, consentText: "  line one\n\nline two  " });
    const insert = db.calls[0];
    assert.match(insert.text, /INSERT INTO client_consents/i);
    assert.equal(insert.params[3], "line one\n\nline two",
      "the interior of the consent text was altered — it is evidence, not copy");
  });

  test("the insert carries the attribution in the columns 099 checks", async () => {
    const db = fakeDb([{ rows: [rowFor()] }]);
    await captureConsent(db, { ...goodCapture, grantedBy: { kind: "staff", id: STAFF } });
    const p = db.calls[0].params;
    // [orgId, clientId, kind, text, version, granterKind, accountId, staffId, ...]
    assert.equal(p[5], "staff");
    assert.equal(p[6], null, "a staff capture named an account");
    assert.equal(p[7], STAFF);
  });

  test("a blank optional field is stored as NULL, not as an empty string", async () => {
    const db = fakeDb([{ rows: [rowFor()] }]);
    await captureConsent(db, {
      ...goodCapture, consentVersion: "   ", capturedIp: "", capturedUserAgent: "  "
    });
    const p = db.calls[0].params;
    assert.equal(p[4], null, "a blank version was stored as a value");
    assert.equal(p[10], null, "a blank ip was stored as a value");
    assert.equal(p[11], null, "a blank user agent was stored as a value");
  });

  test("capture issues database queries and nothing else", async () => {
    // Same structural guard as soft-pulls: an outbound call would not be a
    // db.query, and a fake db cannot answer one.
    const db = fakeDb([{ rows: [rowFor()] }]);
    await captureConsent(db, goodCapture);
    assert.ok(db.calls.length > 0);
    for (const c of db.calls) assert.equal(typeof c.text, "string");
  });
});

// ── revocation is real, one-way, and org-scoped ────────────────────────────

describe("revoking a consent", () => {
  const goodRevoke = {
    orgId: ORG, consentId: CONSENT, reason: "client withdrew on a call",
    revokedBy: { kind: "client", id: ACCOUNT }
  };

  for (const [label, over, status] of [
    ["no org", { orgId: null }, 400],
    ["no consent id", { consentId: null }, 400],
    ["no reason", { reason: null }, 400],
    ["a whitespace-only reason", { reason: "  \t " }, 400],
    ["no revoker", { revokedBy: null }, 401],
    ["a revoker with no subject", { revokedBy: { kind: "staff" } }, 401]
  ]) {
    test(`${label} is refused before anything is written`, async () => {
      const db = fakeDb();
      await assert.rejects(
        () => revokeConsent(db, { ...goodRevoke, ...over }),
        (e) => e instanceof ConsentError && e.status === status);
      assert.deepEqual(db.calls, [], `${label} reached the database`);
    });
  }

  test("the UPDATE is scoped by org AND guarded on revoked_at IS NULL", async () => {
    const db = fakeDb([{ rows: [rowFor({ revoked_at: new Date(), revoked_reason: "x" })] }]);
    await revokeConsent(db, goodRevoke);
    const q = db.calls[0].text;
    assert.match(q, /UPDATE client_consents/i);
    assert.match(q, /org_id = \$2/,
      "a revoke scoped only by id lets one org withdraw another org's consent by guessing a uuid");
    assert.match(q, /revoked_at IS NULL/,
      "a second revoke would overwrite the first one's timestamp and reason");
  });

  test("revoking something already revoked, or in another org, is a 409 and not a success", async () => {
    // The UPDATE matched nothing. All three causes — no such row, wrong org,
    // already revoked — look identical to the caller on purpose: the difference
    // is only useful to somebody probing for which uuids are real.
    const db = fakeDb([{ rows: [] }]);
    await assert.rejects(() => revokeConsent(db, goodRevoke),
      (e) => e instanceof ConsentError && e.status === 409);
  });

  test("the module exposes no way to un-revoke", () => {
    // Granting permission again is a new capture, never an edit. 099's trigger
    // refuses it at the table too; this asserts the module never grew a helper
    // that would try.
    const api = Object.keys({
      hasValidConsent, consentStatus, captureConsent, revokeConsent, listConsents
    });
    assert.ok(!api.some((k) => /unrevoke|restore|reinstate|undo/i.test(k)),
      `an un-revoke path appeared: ${api.join(", ")}`);
  });
});

// ── history includes what was taken back ───────────────────────────────────

describe("listing consents", () => {
  test("fails closed with no org, returning nothing rather than everything", async () => {
    const db = fakeDb([{ rows: [rowFor(), rowFor()] }]);
    assert.deepEqual(await listConsents(db, { clientId: CLIENT }), []);
    assert.deepEqual(db.calls, [], "an unscoped history read reached the database");
  });

  test("does not filter out revoked rows — a history that hides withdrawals is not one", async () => {
    const db = fakeDb([{ rows: [rowFor({ is_valid: false, revoked_at: new Date() }), rowFor()] }]);
    const rows = await listConsents(db, { orgId: ORG, clientId: CLIENT });
    assert.equal(rows.length, 2);
    assert.equal(rows[0].valid, false, "a revoked row came back marked valid");

    /* Assert on the WHERE CLAUSE ONLY. `revoked_at IS NULL` legitimately appears
       in the SELECT list, where it is part of the computed is_valid column — so
       a naive search of the whole statement matches the wrong thing and fails a
       correct query. The claim under test is narrower: revocation must not be a
       FILTER here. */
    const where = /WHERE([\s\S]*?)ORDER BY/i.exec(db.calls[0].text)[1];
    assert.ok(!/revoked_at/i.test(where),
      `the history query filtered out revocations — WHERE was:${where}`);
    assert.match(where, /org_id = \$1/, "the history read lost its org scope");
  });

  test("a bad limit falls back to the default rather than reaching Postgres", async () => {
    // Same trap as soft-pulls' boundedLimit: parseInt("-1") is truthy, so the
    // common idiom lets a negative through and 500s with raw driver text.
    assert.equal(boundedLimit("-1"), 50);
    assert.equal(boundedLimit("0"), 50);
    assert.equal(boundedLimit("abc"), 50);
    assert.equal(boundedLimit("10"), 10);
    assert.equal(boundedLimit("9999"), 200);
  });

  test("an unknown kind filter is refused rather than ignored", async () => {
    // Ignoring it would widen the query to every kind, which is the opposite of
    // what the caller asked for.
    await assert.rejects(
      () => listConsents(fakeDb(), { orgId: ORG, clientId: CLIENT, kind: "vibes" }),
      (e) => e instanceof ConsentError);
  });
});

// ── the normalizers ────────────────────────────────────────────────────────

describe("normalizers", () => {
  test("consent text refuses blanks the way 099's regex does", () => {
    for (const bad of [undefined, null, "", "   ", "\t", "\n", " \t\n ", 42, {}, []]) {
      assert.throws(() => normalizeConsentText(bad), ConsentError,
        `${JSON.stringify(bad)} was accepted as the words somebody agreed to`);
    }
    assert.equal(normalizeConsentText("  I agree.  "), "I agree.");
  });

  test("capture method is the closed set of three, case-insensitively", () => {
    assert.deepEqual([...CAPTURE_METHODS], ["typed", "checkbox", "signature"]);
    assert.equal(normalizeCaptureMethod("TYPED"), "typed");
    assert.equal(normalizeCaptureMethod("  Signature "), "signature");
    for (const bad of ["verbal", "inferred", "imported", "", null, undefined, "click"]) {
      assert.throws(() => normalizeCaptureMethod(bad), ConsentError,
        `"${bad}" was accepted as a capture method`);
    }
  });

  test("granter accepts both natural principal shapes and refuses the rest", () => {
    assert.deepEqual(normalizeGranter({ kind: "client", accountId: ACCOUNT }),
      { kind: "client", accountId: ACCOUNT, staffId: null });
    assert.deepEqual(normalizeGranter({ kind: "STAFF", id: STAFF }),
      { kind: "staff", accountId: null, staffId: STAFF });
    assert.throws(() => normalizeGranter({ kind: "affiliate", id: ACCOUNT }), ConsentError);
    assert.throws(() => normalizeGranter({ kind: "client", staffId: STAFF }), ConsentError);
  });

  test("an unreadable expiry is refused, never dropped to 'never expires'", () => {
    // Failing this open would extend a consent indefinitely because somebody
    // typed the wrong thing into a form.
    for (const bad of ["next Tuesday", "2026-13-45", "soon", {}]) {
      assert.throws(() => normalizeExpiry(bad), ConsentError,
        `${JSON.stringify(bad)} was silently treated as "does not expire"`);
    }
    assert.equal(normalizeExpiry(null), null);
    assert.equal(normalizeExpiry(""), null);
    assert.equal(normalizeExpiry(undefined), null);
    assert.ok(normalizeExpiry("2027-01-01T00:00:00Z") instanceof Date);
  });
});

// ── the disclosure is server-owned ─────────────────────────────────────────

describe("the words come from the server", () => {
  test("the kind vocabulary matches what 099/167 and kinds.mjs name", () => {
    // call_recording and marketing_use added 2026-09-05 with the CSM role;
    // db/migrations/291 widens the matching CHECK. This list and that
    // constraint must stay in step or a valid kind is refused by Postgres.
    // property_report_consent added 2026-11-06: the client's own permission for a
    // CRS/PitchPoint property report, ticked on the soft-pull authorization form.
    // db/migrations/571 widens the CHECK.
    assert.deepEqual([...CONSENT_KINDS],
      ["soft_pull_consent", "property_report_consent", "dispute_authorization", "call_recording", "marketing_use"]);
  });

  test("a known version returns its exact stored text", () => {
    const d = disclosureFor("soft_pull_consent", CURRENT_SOFT_PULL_VERSION);
    assert.equal(d.version, CURRENT_SOFT_PULL_VERSION);
    assert.ok(d.text.length > 0);
    assert.equal(d.text, SOFT_PULL_DISCLOSURES[CURRENT_SOFT_PULL_VERSION].text);
  });

  test("an unknown version returns null and is NOT silently upgraded to the current one", () => {
    // Substituting the current wording would record somebody as agreeing to a
    // paragraph they did not read.
    assert.equal(disclosureFor("soft_pull_consent", "soft-pull-v99"), null);
    assert.equal(disclosureFor("soft_pull_consent", "made-up"), null);
    assert.equal(disclosureFor("vibes"), null);
  });

  test("omitting the version gets the current one — the only defaulting allowed", () => {
    assert.equal(disclosureFor("soft_pull_consent").version, CURRENT_SOFT_PULL_VERSION);
    assert.equal(disclosureFor("soft_pull_consent", null).version, CURRENT_SOFT_PULL_VERSION);
  });

  test("the disclosure map and every entry in it are frozen", () => {
    // Append-only is enforced by review, but freezing stops an accidental
    // in-process mutation from changing what the next capture stores.
    assert.ok(Object.isFrozen(SOFT_PULL_DISCLOSURES));
    for (const v of versionsFor("soft_pull_consent")) {
      assert.ok(Object.isFrozen(SOFT_PULL_DISCLOSURES[v]), `${v} is not frozen`);
    }
  });

  test("the wording makes no claim about credit outcomes", () => {
    // CLAUDE.md §7: never draft customer-facing claims about credit outcomes. A
    // consent form is the likeliest place for one to creep in, so it is pinned.
    const text = SOFT_PULL_DISCLOSURES[CURRENT_SOFT_PULL_VERSION].text.toLowerCase();
    for (const claim of [
      "improve", "increase your score", "raise your score", "boost",
      "guarantee", "guaranteed", "approved", "approval", "qualify you",
      "we will get you", "funding is"
    ]) {
      assert.ok(!text.includes(claim),
        `the consent wording contains an outcome claim: "${claim}"`);
    }
  });
});

describe("dispute_authorization consent kind", () => {
  test("disclosureFor returns dispute-auth-v1", () => {
    const d = disclosureFor("dispute_authorization");
    assert.equal(d.version, CURRENT_DISPUTE_AUTH_VERSION);
    assert.equal(d.title, "Dispute letter authorization");
    assert.equal(d.text, DISPUTE_AUTH_DISCLOSURES[CURRENT_DISPUTE_AUTH_VERSION].text);
  });

  test("disclosureFor unknown kind fails closed", () => {
    assert.equal(disclosureFor("vibes"), null);
    assert.equal(disclosureFor("dispute_authorizations"), null);
    assert.equal(disclosureFor("dispute_authorization", "dispute-auth-v99"), null);
  });

  test("soft-pull-v1 text is untouched", () => {
    assert.equal(
      disclosureFor("soft_pull_consent", CURRENT_SOFT_PULL_VERSION).text,
      SOFT_PULL_DISCLOSURES[CURRENT_SOFT_PULL_VERSION].text
    );
  });

  test("assertKnownSubtype accepts dispute_authorization", () => {
    assert.equal(
      assertKnownSubtype(KINDS.AUTHORIZATION, "dispute_authorization"),
      "dispute_authorization"
    );
  });

  test("captureConsent with this kind works in a unit fake", async () => {
    const db = fakeDb([{ rows: [rowFor({
      kind: "dispute_authorization",
      consent_version: CURRENT_DISPUTE_AUTH_VERSION,
      capture_method: "signature"
    })] }]);
    const c = await captureConsent(db, {
      orgId: ORG, clientId: CLIENT, kind: "dispute_authorization",
      consentText: DISPUTE_AUTH_DISCLOSURES[CURRENT_DISPUTE_AUTH_VERSION].text,
      consentVersion: CURRENT_DISPUTE_AUTH_VERSION,
      grantedBy: { kind: "client", id: ACCOUNT },
      captureMethod: "signature", grantedName: "Dana Client"
    });
    assert.equal(db.calls[0].params[2], "dispute_authorization");
    assert.equal(c.kind, "dispute_authorization");
    assert.equal(c.capture_method, "signature");
  });

  test("the wording makes no claim about credit outcomes", () => {
    const text = DISPUTE_AUTH_DISCLOSURES[CURRENT_DISPUTE_AUTH_VERSION].text.toLowerCase();
    for (const claim of [
      "improve", "increase your score", "raise your score", "boost",
      "guarantee", "guaranteed", "approved", "approval", "qualify you",
      "we will get you", "funding is", "will be deleted", "will remove"
    ]) {
      assert.ok(!text.includes(claim),
        `the dispute-auth wording contains an outcome claim: "${claim}"`);
    }
    assert.match(text, /prepare credit dispute letters and complaint drafts/);
    assert.match(text, /not mailed or filed/);
    assert.match(text, /sign cfpb and state ag complaints myself/);
    assert.match(text, /withdraw/);
    assert.match(text, /does not undo letters already prepared/);
    assert.match(text, /no promise about deletions, scores, funding, or legal outcomes/);
  });

  test("the dispute-auth disclosure map is frozen", () => {
    assert.ok(Object.isFrozen(DISPUTE_AUTH_DISCLOSURES));
    for (const v of versionsFor("dispute_authorization")) {
      assert.ok(Object.isFrozen(DISPUTE_AUTH_DISCLOSURES[v]), `${v} is not frozen`);
    }
  });
});
