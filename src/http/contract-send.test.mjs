// Source tests for the shared send helper and where Send now lives.
//
// The contracts API is already covered by src/http/contracts-endpoints.pg.test.mjs.
// This file only proves the CRM screens call that API — they do not invent a
// second email path.

import { test, describe } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ROUTES } from "../../netlify/functions/api.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.resolve(HERE, "../../public");
const HELPER = fs.readFileSync(path.join(PUBLIC, "app/contract-send.js"), "utf8");
const CRM = fs.readFileSync(path.join(PUBLIC, "app/contracts.html"), "utf8");
const CLOSER = fs.readFileSync(path.join(PUBLIC, "app/closer-dashboard.html"), "utf8");
const PRESENT = fs.readFileSync(path.join(PUBLIC, "app/present.html"), "utf8");
const PRESENT_JS = fs.readFileSync(path.join(PUBLIC, "app/present.js"), "utf8");

describe("FHContractSend (public/app/contract-send.js)", () => {
  test("reuses the existing contracts write API — create_draft then send", () => {
    assert.ok(HELPER.includes('action: "create_draft"'));
    assert.ok(HELPER.includes('action: "send"'));
    assert.match(HELPER, /FHData\.write\("\/api\/contracts"/);
    assert.match(HELPER, /FHData\.read\("contracts"/);
  });

  test("does not invent a mail provider", () => {
    assert.equal(/\bmailgun\b|\bsendgrid\b|\bnodemailer\b|api\.mailgun/i.test(HELPER), false);
    assert.equal(/composeAndSend/.test(HELPER), false);
  });

  test("returns a copyable sign link", () => {
    assert.match(HELPER, /function linkUrl/);
    assert.match(HELPER, /function copyText/);
    assert.match(HELPER, /data\.links/);
  });

  test("the write path it calls is routed", () => {
    assert.ok(Object.prototype.hasOwnProperty.call(ROUTES, "contracts"));
    assert.ok(Object.prototype.hasOwnProperty.call(ROUTES, "read/contracts"));
  });
});

describe("where Send lives after the screen merge", () => {
  test("the wording page does not pick a client or send", () => {
    assert.equal(/id="selClient"/.test(CRM), false);
    assert.equal(/<h2>Send a contract<\/h2>/.test(CRM), false);
    assert.equal(/action: "create_draft"/.test(CRM), false);
  });

  test("Closer Dashboard and Present load the helper and offer Send", () => {
    assert.match(CLOSER, /src="contract-send\.js"/);
    assert.match(CLOSER, /id="fh-send-contract"/);
    assert.match(PRESENT, /src="contract-send\.js"/);
    assert.match(PRESENT_JS, /Send contract/);
    assert.match(PRESENT_JS, /FHContractSend\.sendToClient/);
  });
});

/* ───────────────────────────────────────────────────────────────────────────
   SENDING TAKES NO TYPED INPUT, AND ONE PRESS SENDS ONCE.

   Owner decision 2026-09-03 (F27): the "wording for this client" form comes out
   of the closer deck. Chris, verbatim: "it should already have that
   information. Just send it." The blanks are filled by defaultContractValues()
   in src/config/offers.mjs and applied server-side in src/contracts/send.mjs.

   The helper used to carry its own copy of those defaults, company_name among
   them — the blank a closer typed the CLIENT's own company into on 2026-09-03,
   which then rendered as the SELLER on a Fundhub agreement (F28). It carries
   none of them now, and the assertion that it carries none is a behaviour check
   rather than a grep: the test it replaces matched strings in the source, which
   is how a helper can keep a default nothing uses, or lose one something needs,
   with the test still green.
   ─────────────────────────────────────────────────────────────────────────── */

/** Evaluate contract-send.js against a stub window and hand back FHContractSend. */
function loadHelper(fhData) {
  const win = { navigator: {}, FHData: fhData || null };
  return new Function("window", `${HELPER}\nreturn window.FHContractSend;`)(win);
}

/** A stand-in for data.js that records what was posted.
 *  `gate`, when given, holds the create_draft answer open so a second press can
 *  be attempted while the first is genuinely still in the air. */
function stubData(calls, gate) {
  return {
    write(path, body) {
      calls.push({ path, body });
      const data = body.action === "create_draft"
        ? { contract: { id: "draft-1" } }
        : { links: [{ url: "https://fundhub.ai/sign/abc" }] };
      const answer = { ok: true, data };
      if (gate && body.action === "create_draft") {
        return new Promise((resolve) => { gate.release = () => resolve(answer); });
      }
      return Promise.resolve(answer);
    }
  };
}

describe("the send helper types nothing in", () => {
  test("it holds no contract defaults of its own", () => {
    const helper = loadHelper();
    for (const key of [
      "FUNDING-MASTERY-AGREEMENT", "FUNDING-AGREEMENT", "CREDIT-REPAIR-AGREEMENT",
      "SOFT-PULL-CONSENT", "CAPITAL-BLUEPRINT-AGREEMENT", null
    ]) {
      assert.deepEqual(
        helper.defaultBlankValues(key), {},
        `the browser is filling contract blanks again for ${key}. A second copy ` +
        `of the price list, or of the seller's name, is the seam F28 came out of.`
      );
    }
  });

  test("a send with nothing typed posts no values at all", async () => {
    const calls = [];
    const helper = loadHelper(stubData(calls));
    const out = await helper.sendToClient({ clientId: "cl-1", templateId: "tpl-1" });
    assert.equal(out.ok, true);
    assert.equal(out.link, "https://fundhub.ai/sign/abc");
    const draft = calls[0].body;
    assert.equal(draft.action, "create_draft");
    assert.equal(
      Object.prototype.hasOwnProperty.call(draft, "values"), false,
      "the helper still posts a values object when the screen has nothing typed"
    );
  });

  test("values a screen really has are still passed through", async () => {
    const calls = [];
    const helper = loadHelper(stubData(calls));
    await helper.sendToClient({
      clientId: "cl-1", templateId: "tpl-1", values: { scope: "typed by a closer" }
    });
    assert.deepEqual(calls[0].body.values, { scope: "typed by a closer" });
  });

  test("the selected Blueprint amount reaches both draft and send unchanged", async () => {
    const calls = [];
    const helper = loadHelper(stubData(calls));
    const out = await helper.sendToClient({ clientId: "cl-1", templateId: "tpl-1", amountCents: 1000000 });
    assert.equal(out.ok, true);
    assert.deepEqual(calls.map((call) => call.body.amount_cents), [1000000, 1000000]);
    assert.equal(Object.hasOwn(calls[0].body, "values"), false);
  });

  test("changing the price while draft creation is pending cannot change the send amount", async () => {
    const calls = [];
    const gate = {};
    const helper = loadHelper(stubData(calls, gate));
    const opts = { clientId: "cl-1", templateId: "tpl-1", amountCents: 750000 };
    const pending = helper.sendToClient(opts);
    opts.amountCents = 1000000;
    gate.release();
    assert.equal((await pending).ok, true);
    assert.deepEqual(calls.map((call) => call.body.amount_cents), [750000, 750000]);
  });
});

describe("one press sends once", () => {
  test("a second press while the first is in the air is refused", async () => {
    const calls = [];
    const gate = {};
    const helper = loadHelper(stubData(calls, gate));
    const first = helper.sendToClient({ clientId: "cl-1", templateId: "tpl-1" });
    assert.equal(helper.isSending({ clientId: "cl-1", templateId: "tpl-1" }), true);

    const second = await helper.sendToClient({ clientId: "cl-1", templateId: "tpl-1" });
    assert.equal(second.ok, false);
    assert.equal(second.pending, true);

    gate.release();
    assert.equal((await first).ok, true);
    /* One draft and one send, not two of each. F24 on the same walk produced two
       live pay links off two presses; a contract doing that hands the client two
       sign links for one sale with no way to tell which counts. */
    assert.equal(calls.length, 2);
  });

  test("a second press just after a successful send is refused too", async () => {
    const calls = [];
    const helper = loadHelper(stubData(calls));
    assert.ok(helper.SEND_COOLDOWN_MS > 0, "there is no cooldown at all");
    assert.equal((await helper.sendToClient({ clientId: "cl-1", templateId: "tpl-1" })).ok, true);
    const again = await helper.sendToClient({ clientId: "cl-1", templateId: "tpl-1" });
    assert.equal(again.ok, false);
    assert.equal(again.cooldown, true);
    assert.equal(calls.length, 2, "the second press reached the API anyway");
  });

  test("another client is never blocked by this one's send", async () => {
    const calls = [];
    const helper = loadHelper(stubData(calls));
    assert.equal((await helper.sendToClient({ clientId: "cl-1", templateId: "tpl-1" })).ok, true);
    assert.equal((await helper.sendToClient({ clientId: "cl-2", templateId: "tpl-1" })).ok, true);
    assert.equal(calls.length, 4);
  });

  test("a failed send can be retried straight away", async () => {
    // A cooldown after a failure would leave a closer staring at a dead button
    // with a client on the phone.
    const calls = [];
    const helper = loadHelper({
      write(path, body) {
        calls.push({ path, body });
        return Promise.resolve({ ok: false, error: "nope" });
      }
    });
    assert.equal((await helper.sendToClient({ clientId: "cl-1", templateId: "tpl-1" })).ok, false);
    const retry = await helper.sendToClient({ clientId: "cl-1", templateId: "tpl-1" });
    assert.equal(retry.ok, false);
    assert.equal(retry.cooldown, undefined, "a failure started a cooldown");
    assert.equal(calls.length, 2, "the retry never reached the API");
  });
});
