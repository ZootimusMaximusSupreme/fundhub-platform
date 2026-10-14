// Proves the closer's client deck (public/app/present.html): it reads the file
// for the contact in the link, saves each business's incorporation month and
// re-reads the deck, stages and sends repair letters, and carries the repair
// referral tick with the disposition.

import { test } from "node:test";
import assert from "node:assert/strict";

import { OWNER, bodyOf, json, proofRows, startScreens } from "./s4-screen-harness.mjs";
import { waitFor } from "./s4-money-harness.mjs";

const proof = proofRows(import.meta.url);
const CLIENT = "aaaaaaaa-1111-4111-8111-111111111111";
const CLOSER = { ok: true, staff: { ...OWNER.staff, role: "closer" } };
const LETTER = (bureau) => ({ bureau, itemCount: 3, body_text: `Dear ${bureau}, please remove these items.`, letter_id: `L-${bureau}` });

const DECK = {
  ok: true,
  survey: { name: "Dana Whitfield" },
  businesses: [{ id: "biz-1", name: "Whitfield Freight LLC", age_months: null, incorporated_date: null }],
  income_estimates: {},
  engine: { available: true, tier: "REPAIR_ONLY", fico: { experian: 640, equifax: 632, transunion: 651 }, reasons: [], total: 0 },
  offers: [
    { key: "REPAIR_DFY", name: "Repair done for you", priceCents: 150000, priceDisplay: "$1,500", letters: false },
    { key: "FUNDING_DFY", name: "Funding done for you", priceCents: 500000, priceDisplay: "$5,000", letters: false },
  ],
  soft_pull: null,
};

async function openDeck(open, { query = `?contact=${CLIENT}` } = {}) {
  const calls = { deck: [], stamp: [], enroll: [], generate: [], send: [], deckPost: [] };
  const handlers = {
    "/api/read/closer-deck": async (route, { url }) => {
      calls.deck.push(new URL(url).searchParams.get("contact"));
      // once the date is saved the server's own answer carries it, and the age that prices the stack
      const dated = calls.stamp.length ? [{ id: "biz-1", name: "Whitfield Freight LLC", age_months: 66, incorporated_date: "2021-03-01" }] : DECK.businesses;
      return json(route, { ...DECK, businesses: dated });
    },
    "/api/soft-pull-approve": async (route) => {
      calls.stamp.push(bodyOf(route));
      return json(route, { ok: true, business: { name: "Whitfield Freight LLC", incorporated_date: "2021-03", age_months: 66 } });
    },
    "/api/repair/enroll": async (route) => { calls.enroll.push(bodyOf(route)); return json(route, { ok: true }); },
    "/api/repair/generate": async (route) => {
      calls.generate.push(bodyOf(route));
      return json(route, { ok: true, letters: [LETTER("Experian"), LETTER("Equifax")] });
    },
    "/api/repair/send": async (route) => { calls.send.push(bodyOf(route)); return json(route, { ok: true }); },
    "/api/closer-deck": async (route) => { calls.deckPost.push(bodyOf(route)); return json(route, { ok: true }); },
  };
  const opened = await open(`/app/present.html${query}`, { session: CLOSER, handlers });
  return { ...opened, calls };
}

test("the deck reads the file for the contact in the link, under any of the four names", { timeout: 60_000 }, async (t) => {
  const { open } = await startScreens(t);
  await proof.check(/^Open the deck: reads the client file for \?contact=/, async () => {
    for (const name of ["contact", "client_id", "id", "client"]) {
      const { page, calls, errors } = await openDeck(open, { query: `?${name}=${CLIENT}` });
      await waitFor(() => calls.deck.length === 1);
      assert.deepEqual(calls.deck, [CLIENT], `?${name}= reads the same file`);
      await page.waitForSelector("[data-act]");
      assert.deepEqual(errors, []);
      await page.close();
    }
    const none = await openDeck(open, { query: "" });
    await none.page.waitForFunction(() => /Pick a client first/.test(document.body.innerText));
    assert.deepEqual(none.calls.deck, [], "no contact means no read");
    await none.page.close();
  });
});

test("Save month / year posts the date for that business, re-reads the deck and says what is left", { timeout: 60_000 }, async (t) => {
  const { open } = await startScreens(t);
  await proof.check(/^Discovery: 'Save month \/ year' per business/, async () => {
    const { page, calls } = await openDeck(open);
    await page.waitForSelector('[data-act="phase:02"]');
    await page.locator('[data-act="phase:02"]').click();
    await page.waitForSelector("#fh-inc-0");
    await page.locator('[data-act="stamp-inc:0"]').click();
    await page.waitForFunction(() => /Enter the month and year for Whitfield Freight LLC\./.test(document.body.innerText));
    assert.deepEqual(calls.stamp, [], "an empty month sends nothing");
    await page.locator("#fh-inc-0").fill("2021-03");
    await page.locator('[data-act="stamp-inc:0"]').click();
    await waitFor(() => calls.stamp.length === 1);
    assert.deepEqual(calls.stamp[0], { action: "stamp_incorporated", client_id: CLIENT, business_name: "Whitfield Freight LLC", incorporated_date: "2021-03" });
    await waitFor(() => calls.deck.length === 2);
    await page.waitForFunction(() => /Saved Whitfield Freight LLC\. Every company on the file has a date now\./.test(document.body.innerText));
    await page.close();
  });
});

test("Stage letters enrolls then stages round one; Send letters now mails exactly the staged letters", { timeout: 60_000 }, async (t) => {
  const { open } = await startScreens(t);
  const { page, calls } = await openDeck(open);
  await page.waitForSelector('[data-act="phase:07"]');
  await page.locator('[data-act="phase:07"]').click();
  await page.waitForSelector('[data-act="stage-letters"]');

  await proof.check(/^Repair offers: 'Stage letters'/, async () => {
    assert.equal(await page.locator('[data-act="send-letters"]').isDisabled(), true, "nothing to send before letters are staged");
    await page.locator("#fh-repair-paid").fill("500");
    await page.locator('[data-act="stage-letters"]').click();
    await waitFor(() => calls.generate.length === 1);
    assert.deepEqual(calls.enroll, [{ client_id: CLIENT, program: "full", price_total: 1500, amount_paid: 500 }]);
    assert.deepEqual(calls.generate, [{ client_id: CLIENT, round: "R1" }]);
    await page.waitForFunction(() => /Staged 2 letter\(s\)\. Review, then Send now\./.test(document.body.innerText));
  });

  await proof.check(/^Repair offers: 'Send letters now'/, async () => {
    await page.locator('[data-act="send-letters"]').click();
    await waitFor(() => calls.send.length === 1);
    assert.deepEqual(calls.send[0], {
      mail: true, client_id: CLIENT,
      letters: [
        { bureau: "Experian", html: "Dear Experian, please remove these items.", letter_id: "L-Experian" },
        { bureau: "Equifax", html: "Dear Equifax, please remove these items.", letter_id: "L-Equifax" },
      ],
    });
    await page.waitForFunction(() => /Sent\. Letters are in the mail queue\./.test(document.body.innerText));
  });
  await page.close();
});

test("the repair referral tick is kept in the deck and sent with the disposition", { timeout: 60_000 }, async (t) => {
  const { open } = await startScreens(t);
  await proof.check(/^'Repair referral' checkbox/, async () => {
    const { page, calls } = await openDeck(open);
    await page.waitForSelector('[data-act="phase:07"]');
    await page.locator('[data-act="phase:07"]').click();
    await page.locator('[data-act="more"]').click();
    await page.locator("#fh-repair-referral").check();
    // closing and reopening the panel does not lose the tick
    await page.locator('[data-act="more"]').click();
    await page.locator('[data-act="more"]').click();
    assert.equal(await page.locator("#fh-repair-referral").isChecked(), true);
    await page.locator('[data-act="disp"]').click();
    await waitFor(() => calls.deckPost.length === 1);
    assert.equal(calls.deckPost[0].action, "log_disposition");
    assert.equal(calls.deckPost[0].client_id, CLIENT);
    assert.equal(calls.deckPost[0].repair_referral, true);
    await page.close();
  });
});

test("every listed row was exercised", () => {
  proof.assertAllClaimed();
});
