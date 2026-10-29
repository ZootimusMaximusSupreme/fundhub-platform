// COMPLIANCE REVIEW REQUIRED — dispute logic. The double-mailing guard, at the
// unit level.
//
// The real proof is src/repair/send-double-mail.pg.test.mjs, which posts the
// same payload twice against a real Postgres and counts the mailings. These
// pin the DECISION the send loop makes on each answer the database can give,
// which is the part a fake db can honestly show:
//
//   an explicit stored letter ID requires a positive, owner-scoped claim
//   before any provider transmission. Missing or foreign IDs refuse safely.
//
// Untracked legacy ad-hoc letters are a distinct route: do not infer any
// mailing authorization from an unknown *explicit* ID.

import { test } from "node:test";
import assert from "node:assert/strict";
import { sendRepairLetters, isPreTransmissionRefusal, nothingWasTransmitted } from "./send.mjs";

const IDS = {
  orgId: "22222222-2222-4222-8222-222222222222",
  clientId: "33333333-3333-4333-8333-333333333333",
  staffId: "44444444-4444-4444-8444-444444444444",
  letterId: "55555555-5555-4555-8555-555555555555"
};

const FROM = {
  first_name: "Pat",
  last_name: "Client",
  address_line1: "12 Oak St",
  address_city: "Dallas",
  address_state: "TX",
  address_zip: "75201"
};

const isClaim = (sql) => /UPDATE dispute_letters d SET status = 'sending'/.test(
  String(sql).replace(/\s+/g, " ")
);

/** A db whose dispute_letters row answers however the test wants. */
function letterDb({ claimRows = [], row = null } = {}) {
  return {
    async query(sql) {
      const s = String(sql).replace(/\s+/g, " ");
      if (isClaim(s)) return { rows: claimRows };
      if (/SELECT status, mailed_at, send_claimed_at FROM dispute_letters/.test(s)) return { rows: row ? [row] : [] };
      return { rows: [] };
    }
  };
}

function send(db, mailSender) {
  return sendRepairLetters(db, {
    orgId: IDS.orgId,
    clientId: IDS.clientId,
    staffId: IDS.staffId,
    mail: true,
    from: FROM,
    letters: [{ bureau: "EX", html: "<html>x</html>", letterId: IDS.letterId }],
    mailSender
  });
}

test("a letter the database says is already mailed is not handed to the provider", async () => {
  let calls = 0;
  const db = letterDb({
    claimRows: [],
    row: { status: "sent", mailed_at: new Date(), send_claimed_at: new Date() }
  });
  const result = await send(db, async () => { calls += 1; return { ok: true, providerId: "x" }; });
  assert.equal(calls, 0, "the mailer must not be called");
  assert.equal(result.ok, false);
  assert.equal(result.results[0].error, "already_mailed");
});

test("a claim that is held but not mailed is named apart from a mailing", async () => {
  // The difference is not cosmetic. 'already_mailed' is final; a held claim has
  // a way out — a human clears it with clearStuckSendClaim and the letter goes.
  let calls = 0;
  const db = letterDb({
    claimRows: [],
    row: { status: "sending", mailed_at: null, send_claimed_at: new Date() }
  });
  const result = await send(db, async () => { calls += 1; return { ok: true, providerId: "x" }; });
  assert.equal(calls, 0, "it is still not handed to the provider");
  assert.equal(result.results[0].error, "send_claim_held");
});

test("the claim is taken BEFORE the provider is called, not after", async () => {
  const order = [];
  const db = {
    async query(sql) {
      if (isClaim(sql)) {
        order.push("claim");
        return { rows: [{ prior_status: "ready" }] };
      }
      return { rows: [] };
    }
  };
  await send(db, async () => { order.push("mail"); return { ok: true, providerId: "ltr_1" }; });
  assert.deepEqual(order.slice(0, 2), ["claim", "mail"],
    "claiming after the call would not close the window between two callers");
});

test("a unique violation on the mailing index refuses the send", async () => {
  let calls = 0;
  const db = {
    async query(sql) {
      if (isClaim(sql)) {
        const err = new Error("duplicate key value violates unique constraint");
        err.code = "23505";
        throw err;
      }
      return { rows: [] };
    }
  };
  const result = await send(db, async () => { calls += 1; return { ok: true, providerId: "x" }; });
  assert.equal(calls, 0);
  assert.equal(result.results[0].error, "already_mailed_duplicate_letter");
});

test("a database failure on the claim refuses the letter rather than mailing it", async () => {
  let calls = 0;
  const db = {
    async query(sql) {
      if (isClaim(sql)) throw new Error("connection terminated unexpectedly");
      return { rows: [] };
    }
  };
  const result = await send(db, async () => { calls += 1; return { ok: true, providerId: "x" }; });
  assert.equal(calls, 0, "if we cannot tell whether it is safe to send, we do not send");
  assert.equal(result.results[0].error, "claim_failed");
});

test("an explicit unknown letter ID refuses before any provider transmission", async () => {
  let calls = 0;
  const db = letterDb({ claimRows: [], row: null });
  const result = await send(db, async () => { calls += 1; return { ok: true, providerId: "ltr_1" }; });
  assert.equal(calls, 0, "a missing owner-scoped claim never authorizes physical mail");
  assert.equal(result.ok, false);
  assert.equal(result.results[0].error, "letter_not_found_or_not_owned");
});

test("only a provably pre-transmission refusal is treated as one", () => {
  assert.equal(isPreTransmissionRefusal("POSTGRID_API_KEY unset — letter not sent"), true);
  assert.equal(isPreTransmissionRefusal("destination_address_missing"), true);
  assert.equal(isPreTransmissionRefusal("return_address_required — consumer address only"), true);
  assert.equal(isPreTransmissionRefusal("bureau_mail_address_incomplete"), true);
  assert.equal(isPreTransmissionRefusal("private_carrier_forbidden_for_po_box"), true);
  assert.equal(isPreTransmissionRefusal("postgrid_http_502"), false,
    "an HTTP error may have mailed the letter, so the claim must be kept");
  assert.equal(isPreTransmissionRefusal("mail_failed"), false);
  assert.equal(isPreTransmissionRefusal(undefined), false);
});

test("the string list still catches the chokepoint's own refusals", () => {
  // These reach send.mjs with no preTransmission flag whenever a caller rebuilds
  // the mailer's result — api/repair/send.mjs does exactly that. Every one is
  // returned above the fetch call in src/lib/outbound-fetch.mjs.
  assert.equal(isPreTransmissionRefusal(
    "MESSAGING_DRY_RUN is not set. The dry-run fence defaults to BLOCKED, so nothing transmits until it is set to an explicit off value (0, false, no, or off). (postgrid letter)"
  ), true);
  assert.equal(isPreTransmissionRefusal(
    'MESSAGING_DRY_RUN is set to "maybe", which is not an explicit off value (0, false, no, off). Treating it as fence UP and holding.'
  ), true);
  assert.equal(isPreTransmissionRefusal("no fetch implementation available"), true);
  assert.equal(isPreTransmissionRefusal("outbound transmit refused: no fence declared"), true);
  // Not a fence hold. A timeout means the call went out.
  assert.equal(isPreTransmissionRefusal("timed out after 10000ms"), false);
});

test("a fact from the mailer beats the string list, in both directions", () => {
  // Says nothing -> fall back to the strings.
  assert.equal(nothingWasTransmitted({ ok: false }, "postgrid_http_502"), false);
  assert.equal(nothingWasTransmitted({ ok: false }, "pdf_or_html_required"), true);
  assert.equal(nothingWasTransmitted(null, "pdf_or_html_required"), true);

  // States a fact -> believe it, whatever the message reads like.
  assert.equal(
    nothingWasTransmitted({ ok: false, preTransmission: true }, "postgrid_http_500"), true,
    "a refusal the list has never heard of still releases when the mailer proves nothing went"
  );
  assert.equal(
    nothingWasTransmitted({ ok: false, preTransmission: false }, "pdf_or_html_required"), false,
    "and a call that was made keeps the claim even if the text happens to match"
  );
});

test("a send the outbound fence held gives the letter back", async () => {
  // The exact shape src/messaging/providers/mail-letter.mjs now returns when
  // src/lib/outbound-fetch.mjs reports transmitted:false. Under the old
  // string-only test this kept the claim and the letter could never be mailed.
  const statements = [];
  const db = {
    async query(sql) {
      statements.push(String(sql).replace(/\s+/g, " "));
      if (isClaim(sql)) return { rows: [{ prior_status: "ready" }] };
      return { rows: [] };
    }
  };
  const result = await send(db, async () => ({
    ok: false,
    preTransmission: true,
    error: "MESSAGING_DRY_RUN is not set. The dry-run fence defaults to BLOCKED, so nothing transmits until it is set to an explicit off value (0, false, no, or off). (postgrid letter)"
  }));
  assert.equal(result.ok, false, "the send failed, which is correct");
  assert.ok(
    statements.some((s) => /SET status = COALESCE\(\$4, 'ready'\), send_claimed_at = NULL/.test(s)),
    "and the claim was released, so the letter is sendable again"
  );
});

test("a call that was made keeps the claim", async () => {
  const statements = [];
  const db = {
    async query(sql) {
      statements.push(String(sql).replace(/\s+/g, " "));
      if (isClaim(sql)) return { rows: [{ prior_status: "ready" }] };
      return { rows: [] };
    }
  };
  await send(db, async () => ({ ok: false, preTransmission: false, error: "postgrid_http_502" }));
  assert.equal(
    statements.some((s) => /send_claimed_at = NULL/.test(s)), false,
    "nobody can say whether the letter went, so nothing is released automatically"
  );
});

// ═══════════════════════════════════════════════════════════════════════════
// THE PROVIDER TOOK IT — THAT IS THE MAILING, ID OR NO ID
//
// The gate here used to be `if (letterId && providerId)`. PostGrid answering
// 200 with a body carrying no id returns { ok: true, providerId: null }, so the
// letter was posted and the whole write-back was skipped: mailed_at NULL,
// postgrid_letter_id NULL, claim held. That row then reads as "stuck" and a
// staff member could release it, and it went out again.

test("a mailer that says ok with no provider id still records the mailing", async () => {
  const statements = [];
  const params = [];
  const db = {
    async query(sql, args) {
      statements.push(String(sql).replace(/\s+/g, " "));
      params.push(args);
      if (isClaim(sql)) return { rows: [{ prior_status: "ready" }] };
      return { rows: [] };
    }
  };
  const result = await send(db, async () => ({ ok: true, outcome: "sent" }));

  assert.equal(result.ok, true);
  assert.equal(result.results[0].providerId, null, "there genuinely is no id");
  const write = statements.findIndex((s) => /mailed_at = COALESCE\(mailed_at, now\(\)\)/.test(s));
  assert.ok(write >= 0, "the mailing is written down anyway");
  assert.equal(
    params[write][1], null,
    "and the id stays NULL — unknown, not invented (CLAUDE.md §12)"
  );
  assert.match(
    statements[write],
    /postgrid_letter_id = COALESCE\(\$2::text, postgrid_letter_id\)/,
    "a NULL id must never wipe an id an earlier write already got"
  );
});

test("a mailer that answers neither yes nor no is not counted as a mailing", async () => {
  const statements = [];
  const db = {
    async query(sql) {
      statements.push(String(sql).replace(/\s+/g, " "));
      if (isClaim(sql)) return { rows: [{ prior_status: "ready" }] };
      return { rows: [] };
    }
  };
  // No ok, no id. Inventing a mailed_at here would kill the letter for ever.
  const result = await send(db, async () => ({ outcome: "who knows" }));

  assert.equal(result.results[0].ok, false);
  assert.equal(result.results[0].error, "mailer_no_answer");
  assert.equal(
    statements.some((s) => /mailed_at = COALESCE\(mailed_at, now\(\)\)/.test(s)), false,
    "nothing is stamped"
  );
  assert.equal(
    statements.some((s) => /send_claimed_at = NULL/.test(s)), false,
    "and the claim is kept, because a retry is the one action that can mail twice"
  );
});

// ═══════════════════════════════════════════════════════════════════════════
// THE WRITE THAT PREVENTS THE SECOND ENVELOPE IS NOT ALLOWED TO FAIL QUIETLY
//
// It used to end in `.catch(() => {})`. A momentary database error produced the
// same unrecorded mailing as the missing id did, and nobody was told.

test("a database failure on the mailing write-back is retried, then surfaced", async () => {
  let writeAttempts = 0;
  const db = {
    async query(sql) {
      if (isClaim(sql)) return { rows: [{ prior_status: "ready" }] };
      if (/mailed_at = COALESCE\(mailed_at, now\(\)\)/.test(String(sql).replace(/\s+/g, " "))) {
        writeAttempts += 1;
        throw new Error("connection terminated unexpectedly");
      }
      return { rows: [] };
    }
  };
  const errs = [];
  const realError = console.error;
  console.error = (...a) => errs.push(a.join(" "));
  let result;
  try {
    result = await send(db, async () => ({ ok: true, providerId: "ltr_yes", outcome: "sent" }));
  } finally {
    console.error = realError;
  }

  assert.equal(writeAttempts, 2, "tried twice before giving up");
  assert.equal(result.results[0].ok, true, "the letter DID go out — that is still true");
  assert.equal(result.results[0].mailingRecorded, false);
  assert.match(result.results[0].mailingRecordError, /connection terminated/);
  assert.equal(result.unrecordedMailings.length, 1, "and the send as a whole carries it up");
  assert.equal(result.unrecordedMailings[0].letterId, IDS.letterId);
  assert.equal(result.unrecordedMailings[0].providerId, "ltr_yes");
  assert.ok(
    errs.some((e) => /MAILING NOT RECORDED/.test(e) && /DO NOT RE-SEND IT/.test(e)),
    "and it is logged in words a person can act on"
  );
});

test("a send whose mailing WAS recorded says nothing about it", async () => {
  const db = {
    async query(sql) {
      if (isClaim(sql)) return { rows: [{ prior_status: "ready" }] };
      return { rows: [] };
    }
  };
  const result = await send(db, async () => ({ ok: true, providerId: "ltr_ok", outcome: "sent" }));
  assert.equal("mailingRecorded" in result.results[0], false);
  assert.equal("unrecordedMailings" in result, false, "the normal case is silent");
});
