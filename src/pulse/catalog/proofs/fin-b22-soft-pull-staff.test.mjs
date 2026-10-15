// "Each saved company is a fundable file on the staff screen with name, state, address, EIN and an
// extra-owner warning." A practice test, end to end with stand-ins:
//
//   the soft-pull form's own rows
//     -> parseSoftPullBusinesses + replaceSoftPullBusinesses (what is saved, captured from the writer)
//     -> businessCredit (what the staff detail read hands the screen)
//     -> the Client Control Panel's Businesses card and the pipeline drawer's Businesses section
//        (two real pages in Chromium, fake /api answers)
//
// Nothing here is written by hand on the saved side: the saved rows are what the real writer produced.
import { test } from "node:test";
import assert from "node:assert/strict";

import { parseSoftPullBusinesses, replaceSoftPullBusinesses } from "../../../../api/soft-pull-approve.mjs";
import { businessCredit } from "../../../http/client-detail.mjs";
import { CLIENT_ID, json, startScreens } from "./s4-screen-harness.mjs";

const FORM_ROWS = [
  {
    name: "Acme Holdings LLC", address_line1: "500 Commerce Way", city: "Tempe", state: "az", postal_code: "85281",
    ein: "123456789", incorporated_date: "2023-08", extra_owner_name: "",
  },
  {
    name: "Beta Partners Inc", address_line1: "9 Main St", city: "Reno", state: "nv", postal_code: "89501",
    ein: "98-7654321", incorporated_date: "2020-01", extra_owner_name: "Pat Lee",
  },
];

/** What the writer really saves, then what the detail read really hands the screen. */
async function savedAndRead() {
  const saved = [];
  const writer = {
    async query(sql, params) {
      if (/INSERT INTO businesses/i.test(sql)) saved.push({ name: params[2], age_months: params[3], entity_data: JSON.parse(params[4]) });
      return { rows: [] };
    },
  };
  const parsed = parseSoftPullBusinesses(FORM_ROWS);
  await replaceSoftPullBusinesses(writer, { orgId: "org-1", clientId: CLIENT_ID, businesses: parsed });
  return { saved, credit: businessCredit({ businesses: saved }) };
}

const DETAIL = (credit) => ({
  ok: true,
  client: { id: CLIENT_ID, first_name: "Dana", last_name: "Whitfield", email: "dana@example.com", phone: "+15550100", custom_fields: {} },
  business_credit: credit,
  crs_results: [], messages: [], tasks: [],
});

test("what the form saved is what the staff read lists: name, state, address, EIN, age and the extra-owner flag", async () => {
  const { saved, credit } = await savedAndRead();
  assert.equal(saved.length, 2, "both companies were saved");
  assert.equal(credit.businesses.length, 2);
  const [acme, beta] = credit.businesses;
  assert.deepEqual(
    { name: acme.name, state: acme.state, ein: acme.ein, address: acme.address, extra: acme.extra_owners_warning, owner: acme.extra_owner_name },
    { name: "Acme Holdings LLC", state: "AZ", ein: "12-3456789", address: "500 Commerce Way Tempe, AZ 85281", extra: false, owner: null },
  );
  assert.deepEqual(
    { name: beta.name, state: beta.state, ein: beta.ein, address: beta.address, extra: beta.extra_owners_warning, owner: beta.extra_owner_name },
    { name: "Beta Partners Inc", state: "NV", ein: "98-7654321", address: "9 Main St Reno, NV 89501", extra: true, owner: "Pat Lee" },
  );
  assert.equal(acme.incorporated_date, "2023-08");
  assert.ok(Number.isInteger(acme.age_months) && acme.age_months > 0, "the age is saved");
});

test("the Client Control Panel draws one card per saved company with its facts and a warning only on the one with an extra owner", { timeout: 90_000 }, async (t) => {
  const { credit } = await savedAndRead();
  const { open } = await startScreens(t);
  const { page, errors } = await open(`/app/client-control-panel.html?client_id=${CLIENT_ID}`, {
    handlers: { "/api/dashboard/client": (route) => json(route, DETAIL(credit)) },
  });
  await page.waitForFunction(() => document.querySelectorAll("#ccp-biz-list .cp-sec").length === 2);

  const cards = await page.evaluate(() => [...document.querySelectorAll("#ccp-biz-list .cp-sec")].map((card) => ({
    title: card.querySelector(".cp-sec-title")?.textContent,
    facts: Object.fromEntries([...card.querySelectorAll(".kv")].map((kv) => [
      kv.querySelector(".kv-label")?.textContent, kv.querySelector(".kv-value")?.textContent,
    ])),
    warning: card.querySelector(".blocker-flag")?.textContent || null,
  })));
  assert.equal(cards[0].title, "Acme Holdings LLC");
  assert.equal(cards[0].facts.State, "AZ");
  assert.equal(cards[0].facts.EIN, "12-3456789");
  assert.equal(cards[0].facts.Address, "500 Commerce Way Tempe, AZ 85281");
  assert.equal(cards[0].facts["Extra owner"], "—");
  assert.equal(cards[0].warning, null, "no extra owner, no warning");
  assert.equal(cards[1].title, "Beta Partners Inc");
  assert.equal(cards[1].facts.State, "NV");
  assert.equal(cards[1].facts.EIN, "98-7654321");
  assert.equal(cards[1].facts.Address, "9 Main St Reno, NV 89501");
  assert.equal(cards[1].facts["Extra owner"], "Pat Lee");
  assert.equal(cards[1].warning, "Extra owners — funding is slower and harder");
  assert.deepEqual(errors, []);
  await page.close();
});

test("the pipeline drawer lists each saved company's name, state, EIN and address, and the extra-owner warning", { timeout: 90_000 }, async (t) => {
  const { credit } = await savedAndRead();
  const { open } = await startScreens(t);
  const board = {
    ok: true, pipeline: "sales", total: 1,
    stages: [{
      key: "new_lead", name: "New Lead", sort_order: 0, count: 1, amount: 3000,
      cards: [{
        id: "card-1", client_id: CLIENT_ID, name: "Dana Whitfield", owner: "Jordan Blake",
        entered_at: new Date(Date.now() - 3_600_000).toISOString(), outcome_tier: null, funded: false, amount: 3000,
        email: "dana@example.com", phone: "+15550100",
      }],
    }],
  };
  const { page, errors } = await open("/app/pipeline.html", {
    handlers: {
      "/api/dashboard/pipeline?key=": (route) => json(route, board),
      "/api/dashboard/client?id=": (route) => json(route, DETAIL(credit)),
      "/api/read/ad-attribution": (route) => json(route, { ok: true, resolved: null, registry: { known: true }, attribution: {} }),
    },
  });
  await page.waitForSelector(`.card[data-client-id="${CLIENT_ID}"]`);
  await page.locator(`.card[data-client-id="${CLIENT_ID}"] .c-name`).click();
  await page.waitForSelector("#fhDrawer.open");
  await page.waitForFunction(() => /Acme Holdings LLC/.test(document.querySelector("#fhDrawerBody").innerText));

  const rows = await page.evaluate(() => {
    const body = document.querySelector("#fhDrawerBody");
    const heads = [...body.querySelectorAll("*")].filter((n) => n.children.length === 0 && n.textContent.trim() === "Businesses");
    const section = heads[0] && heads[0].closest("section, div");
    return section ? section.innerText : body.innerText;
  });
  assert.match(rows, /Business 1\s+Acme Holdings LLC/);
  assert.match(rows, /State 1\s+AZ/);
  assert.match(rows, /EIN 1\s+12-3456789/);
  assert.match(rows, /Address 1\s+500 Commerce Way Tempe, AZ 85281/);
  assert.match(rows, /Business 2\s+Beta Partners Inc/);
  assert.match(rows, /State 2\s+NV/);
  assert.match(rows, /EIN 2\s+98-7654321/);
  assert.match(rows, /Address 2\s+9 Main St Reno, NV 89501/);
  assert.match(rows, /Extra owners 2\s+Yes — funding is slower and harder/);
  assert.doesNotMatch(rows, /Extra owners 1/, "the first company has no extra owner, so no warning");
  assert.deepEqual(errors, []);
  await page.close();
});
