// GET/POST /api/public/funnel-checkout — the self-serve till for the /partner/
// funnel pages, driven for real.
//
// COMPLIANCE REVIEW REQUIRED. These assertions are the compliance surface of a
// public page that asks a stranger for money: the prices it states, the fact
// that it states no earnings figure, and the fact that it refuses to charge for
// the one offer that is sold on a review call.
//
// PURE UNIT TEST, NO DATABASE. Every dependency that would touch Postgres or
// the network is injected, so this runs in every CI pass rather than only the
// ones with DATABASE_URL set. It lives under src/http/ because npm test's glob
// is src/** and scripts/** ONLY — this file placed next to the handler under
// api/ would never run, which is trap #1 in CLAUDE.md §12.

import { test } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import handler, {
  BOARD_RENEWAL_STATE,
  SUBSCRIPTION_CHECKOUT_ERROR,
  FUNNEL_SLUGS,
  PARTNER_APPLY_URL,
  WINNERS_BOARD_PRICE_CENTS,
  WINNERS_BOARD_PRODUCT_CODE,
  boardPriceCents,
  entryPriceCents,
  funnelCatalogue,
  getFunnelItem,
  parseFunnelCheckoutBody,
  priceLabel,
  runFunnelCheckout,
  trialPriceCents
} from "../../api/public/funnel-checkout.mjs";
import { getOffer, getPartnerAddOn } from "../config/offers.mjs";
import { COMMAS_FREQUENCY_DAYS } from "../subscriptions/billing.mjs";
import { AUTOPSY_PRICE_CENTS } from "../autopsy/fields.mjs";
import { LIVE_TRIAL_PRICE_CENTS, PARTNER_ENTRY_PRICE_CENTS } from "../trials/constants.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..", "..");

/* A live checkout env, and a bare one. Nothing here reaches a network: every
   mint is injected. */
const LIVE_ENV = { FANBASIS_CHECKOUT_API_KEY: "test-key" };
const FALLBACK_ENV = { COMMAS_CHECKOUT_BASE_URL: "https://pay.example.com/checkout" };
const DEAD_ENV = {};

function fakeRes() {
  const res = {
    statusCode: null, body: null, headers: {},
    setHeader(k, v) { this.headers[String(k).toLowerCase()] = v; return this; },
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; }
  };
  return res;
}

/** A db double. Nothing in the happy path queries it — emit is injected — so a
 *  call here is a real failure, not a fixture gap. */
const noDb = { query() { throw new Error("the funnel till must not query the database directly"); } };

/* ───────────────────────────────────────────────────────────────────────────
   THE PRICES
   ─────────────────────────────────────────────────────────────────────────── */

test("the catalogue states the four owner-set prices, in integer cents", () => {
  const cat = funnelCatalogue(LIVE_ENV);
  const bySlug = Object.fromEntries(cat.items.map((i) => [i.slug, i]));

  assert.equal(bySlug.autopsy.priceCents, 2700, "Decline Autopsy is $27");
  assert.equal(bySlug.board.priceCents, 4700, "Winner's Board is $47");
  assert.equal(bySlug.trial.priceCents, 29700, "Live Trial is $297");
  assert.equal(bySlug.partner.priceCents, 3000000, "partner entry is $30,000, once (owner-set 2026-11-07)");

  for (const item of cat.items) {
    assert.ok(Number.isInteger(item.priceCents), `${item.slug}: money is integer cents, never dollars`);
    assert.ok(item.priceCents > 0, `${item.slug}: a zero price is not a price`);
  }
});

test("prices are rendered, never invented: display and label are composed from the one number", () => {
  const cat = funnelCatalogue(LIVE_ENV);
  const bySlug = Object.fromEntries(cat.items.map((i) => [i.slug, i]));

  assert.equal(bySlug.autopsy.priceDisplay, "$27");
  assert.equal(bySlug.autopsy.priceLabel, "$27 once");
  assert.equal(bySlug.board.priceDisplay, "$47");
  assert.equal(bySlug.board.priceLabel, "$47/month", "the board is the only recurring one");
  assert.equal(bySlug.trial.priceLabel, "$297 once");
  assert.equal(bySlug.partner.priceLabel, "$30,000 once");

  // NULL MEANS UNKNOWN AND MUST SURVIVE — it never becomes $0.
  assert.equal(priceLabel(null, "one_time"), null);
  assert.equal(priceLabel(undefined, "monthly"), null);
});

test("offers.mjs wins the moment it carries one of these, and drift is a failure", () => {
  /* Each resolver reads src/config/offers.mjs FIRST. offers.mjs is owned by
     another workflow; the day a WINNERS_BOARD / LIVE_TRIAL / PARTNER_ENTRY
     entry lands there it becomes the single source with no code change. This
     test is the seam that stops the two numbers disagreeing quietly — the same
     job src/trials/offer-drift.test.mjs does for the trial constants. */
  const board = getOffer("WINNERS_BOARD")?.priceCents ?? getPartnerAddOn("WINNERS_BOARD")?.priceCents;
  if (board != null) {
    assert.equal(board, WINNERS_BOARD_PRICE_CENTS,
      "offers.mjs and the Winner's Board constant disagree — delete the constant, do not edit it");
  } else {
    assert.equal(boardPriceCents(), WINNERS_BOARD_PRICE_CENTS);
  }

  const trial = getOffer("LIVE_TRIAL")?.priceCents;
  if (trial != null) assert.equal(trial, LIVE_TRIAL_PRICE_CENTS, "the Live Trial price forked");
  else assert.equal(trialPriceCents(), LIVE_TRIAL_PRICE_CENTS);

  const entry = getOffer("PARTNER_ENTRY")?.priceCents;
  if (entry != null) assert.equal(entry, PARTNER_ENTRY_PRICE_CENTS, "the entry fee forked");
  else assert.equal(entryPriceCents(), PARTNER_ENTRY_PRICE_CENTS);

  assert.equal(getFunnelItem("autopsy").price(), AUTOPSY_PRICE_CENTS);
});

/* ───────────────────────────────────────────────────────────────────────────
   NO EARNINGS CLAIMS. Zero measured paid closes exist, so nothing public may
   state, imply or model income. The catalogue is prices only.
   ─────────────────────────────────────────────────────────────────────────── */

test("the catalogue carries no earnings figure of any kind", () => {
  const text = JSON.stringify(funnelCatalogue(LIVE_ENV)).toLowerCase();
  const banned = [
    "earn", "income", "roi", "roas", "profit", "revenue you", "make $", "per month you",
    "average", "typical", "expect to", "up to $", "results", "close rate"
  ];
  for (const word of banned) {
    assert.ok(!text.includes(word), `the public catalogue must not say "${word}"`);
  }

  /* And the only numbers in it are prices. A key nobody vetted is how a
     modelled figure gets onto a public page by accident. */
  const allowed = new Set([
    "slug", "key", "name", "productCode", "billing", "selfServe", "page",
    "priceCents", "priceDisplay", "priceLabel", "available", "applyUrl", "renewal",
    /* VETTED 2026-08-31: the billing cadence in days, the same number the
       Commas subscription session is minted with. It is fee timing — how often
       the buyer is charged — and it is not, and can never become, a figure
       describing what they might earn. */
    "frequencyDays"
  ]);
  for (const item of funnelCatalogue(LIVE_ENV).items) {
    for (const k of Object.keys(item)) assert.ok(allowed.has(k), `unvetted public field "${k}"`);
  }
});

/* ───────────────────────────────────────────────────────────────────────────
   THE $10,000 IS NOT SELF-SERVE, AND THAT IS THE POINT
   ─────────────────────────────────────────────────────────────────────────── */

test("three of the four take money on the page; the entry fee does not", () => {
  const cat = funnelCatalogue(LIVE_ENV);
  const bySlug = Object.fromEntries(cat.items.map((i) => [i.slug, i]));

  assert.deepEqual(FUNNEL_SLUGS, ["autopsy", "board", "trial", "partner"]);
  for (const slug of ["autopsy", "board", "trial"]) {
    assert.equal(bySlug[slug].selfServe, true, `${slug} is an impulse buy and must sell itself`);
    assert.equal(bySlug[slug].applyUrl, null, `${slug} must NOT route through the application form`);
  }
  assert.equal(bySlug.partner.selfServe, false, "the entry fee is invite-only, decided on a review call");
  assert.equal(bySlug.partner.applyUrl, PARTNER_APPLY_URL);
  assert.equal(cat.applyUrl, PARTNER_APPLY_URL);
});

test("POST partner is refused with 409 and the apply URL — it never mints a link", async () => {
  const res = fakeRes();
  await handler(
    { method: "POST", body: { item: "partner", email: "buyer@example.com" } },
    res,
    { db: noDb, env: LIVE_ENV, emit: () => { throw new Error("nothing is recorded for a refused ask"); } }
  );
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.ok, false);
  assert.equal(res.body.error, "not_self_serve");
  assert.equal(res.body.applyUrl, PARTNER_APPLY_URL);
  assert.ok(!res.body.checkoutUrl, "a refused ask must not carry a payable URL");
});

/* ───────────────────────────────────────────────────────────────────────────
   PARSING
   ─────────────────────────────────────────────────────────────────────────── */

test("the body is parsed strictly, and each refusal is named", () => {
  assert.equal(parseFunnelCheckoutBody(null).error, "invalid_json");
  assert.equal(parseFunnelCheckoutBody({ email: "a@b.co" }).error, "unknown_item");
  assert.equal(parseFunnelCheckoutBody({ item: "nope", email: "a@b.co" }).error, "unknown_item");
  assert.equal(parseFunnelCheckoutBody({ item: "board" }).error, "email_required");
  assert.equal(parseFunnelCheckoutBody({ item: "board", email: "not-an-email" }).error, "email_required");

  const ok = parseFunnelCheckoutBody({
    item: " BOARD ", email: "  Buyer@Example.COM ", first_name: " Dana ", last_name: "Kowal"
  });
  assert.equal(ok.ok, true);
  assert.equal(ok.item.slug, "board", "the slug is matched case- and whitespace-insensitively");
  assert.equal(ok.email, "buyer@example.com");
  assert.equal(ok.name, "Dana Kowal");
});

test("attribution survives, and arrives sanitised", () => {
  const parsed = parseFunnelCheckoutBody({
    item: "trial", email: "a@b.co",
    track: "board", a1: "DKOWAL-000123", a2: "  UPLINE_9 "
  });
  assert.equal(parsed.track, "board");
  assert.equal(parsed.a1, "DKOWAL-000123", "the longest vanity code still fits");
  assert.equal(parsed.a2, "UPLINE_9");

  /* ?ref= and ?code= mean the same thing as ?a1= — all three are on links in
     the wild and api/public/affiliate-click.mjs accepts all three. */
  assert.equal(parseFunnelCheckoutBody({ item: "trial", email: "a@b.co", ref: "REFONLY" }).a1, "REFONLY");
  assert.equal(parseFunnelCheckoutBody({ item: "trial", email: "a@b.co", code: "CODEONLY" }).a1, "CODEONLY");

  /* A query-string value is not trusted. Anything that is not a code character
     is stripped rather than stored. */
  const dirty = parseFunnelCheckoutBody({
    item: "trial", email: "a@b.co", a1: "<script>x</script>", track: "a b\"c"
  });
  assert.equal(dirty.a1, "scriptxscript");
  assert.equal(dirty.track, "abc");
});

/* ───────────────────────────────────────────────────────────────────────────
   THE CHECKOUT
   ─────────────────────────────────────────────────────────────────────────── */

test("board: records the ask BEFORE minting, and carries attribution onto both", async () => {
  const order = [];
  const events = [];
  const minted = [];

  const out = await runFunnelCheckout(
    parseFunnelCheckoutBody({
      item: "board", email: "dana@example.com", first_name: "Dana",
      track: "board", a1: "DKOWAL", a2: "UPLINE"
    }),
    {
      db: noDb, env: LIVE_ENV, orgId: "org-1", ref: "fn_test",
      emit: (_db, name, payload, opts) => {
        order.push("record");
        events.push({ name, payload, opts });
        return { id: "evt-1", deduped: false };
      },
      createCheckoutSession: (opts) => {
        order.push("mint");
        minted.push(opts);
        return { ok: true, paymentLink: "https://pay.example.com/s/abc" };
      }
    }
  );

  assert.deepEqual(order, ["record", "mint"],
    "recording first means a crash cannot leave a payable URL this system never heard of");

  assert.equal(out.ok, true);
  assert.equal(out.checkoutUrl, "https://pay.example.com/s/abc");
  assert.equal(out.ref, "fn_test");
  assert.equal(out.priceCents, 4700);

  const evt = events[0];
  assert.equal(evt.name, "funnel.checkout_started");
  assert.equal(evt.opts.allowNonCanonical, true, "the name is not canonical and says so out loud");
  assert.equal(evt.opts.idempotencyKey, "funnel-checkout:fn_test", "a replayed submit is one record");
  assert.equal(evt.payload.amount_cents, 4700);
  assert.equal(evt.payload.product_code, WINNERS_BOARD_PRODUCT_CODE);
  assert.equal(evt.payload.a1, "DKOWAL");
  assert.equal(evt.payload.a2, "UPLINE");
  assert.equal(evt.payload.track, "board");

  const meta = minted[0].metadata;
  assert.equal(minted[0].amountCents, 4700, "integer cents, never dollars");
  assert.equal(meta.link_ref, "fn_test");
  assert.equal(meta.a1, "DKOWAL");
  assert.equal(meta.a2, "UPLINE");
  assert.equal(meta.track, "board");
  assert.equal(meta.item, "board");

  /* Commas only ever sees a keep catalog title. No credit or finance wording,
     and no title invented here. */
  assert.equal(minted[0].productTitle, "Consulting Services Package");

  /* THE FIX THIS ENDPOINT SHIPPED. The board is $47 a MONTH and used to mint a
     one-time session, so it charged month one and stopped. */
  assert.equal(minted[0].type, "subscription",
    "a monthly price must mint a subscription, or the page overstates what the buyer bought");
  assert.equal(minted[0].frequencyDays, COMMAS_FREQUENCY_DAYS);
  assert.equal(evt.payload.frequency_days, COMMAS_FREQUENCY_DAYS,
    "the cadence is recorded with the ask — it is how the renewal webhook finds this purchase again");
});

test("a one-time item is still a one-time session — no cadence smuggled onto it", async () => {
  const minted = [];
  for (const item of ["trial"]) {
    await runFunnelCheckout(
      parseFunnelCheckoutBody({ item, email: "a@b.co" }),
      {
        db: noDb, env: LIVE_ENV, orgId: "o", emit: () => ({}),
        createCheckoutSession: (opts) => { minted.push(opts); return { ok: true, paymentLink: "https://x/y" }; }
      }
    );
  }
  assert.equal(minted[0].type, undefined, "the default one-time type is left alone");
  assert.equal(minted[0].frequencyDays, undefined);
});

/* ───────────────────────────────────────────────────────────────────────────
   A MONTHLY ITEM CANNOT BE SOLD THROUGH THE QUERY-LINK DOOR
   COMPLIANCE: fee timing. buildCommasCheckoutUrl() puts an amount on a URL and
   has no way to say "and again in 30 days". Selling the board through it would
   take one $47 payment against a page promising a subscription.
   ─────────────────────────────────────────────────────────────────────────── */

test("board: the fallback door is refused, not used to take one payment", async () => {
  let minted = 0;
  const out = await runFunnelCheckout(
    parseFunnelCheckoutBody({ item: "board", email: "a@b.co" }),
    {
      db: noDb, env: FALLBACK_ENV, orgId: "o",
      emit: () => { throw new Error("nothing may be recorded — the ask was refused first"); },
      buildCommasCheckoutUrl: () => { minted += 1; return "https://pay.example.com/checkout?amount=47.00"; }
    }
  );
  assert.equal(out.ok, false);
  assert.equal(out.error, SUBSCRIPTION_CHECKOUT_ERROR);
  assert.equal(minted, 0, "no payable URL exists for a subscription we cannot actually mint");

  /* And the catalogue says so, so the page renders a disabled button rather
     than a live one that 503s. The one-time items are unaffected. */
  const bySlug = Object.fromEntries(funnelCatalogue(FALLBACK_ENV).items.map((i) => [i.slug, i]));
  assert.equal(bySlug.board.available, false);
  assert.equal(bySlug.trial.available, true, "the fallback still sells a one-time item");
  assert.equal(bySlug.autopsy.available, true);
});

test("board: the cadence on the catalogue is the cadence that is minted", async () => {
  const bySlug = Object.fromEntries(funnelCatalogue(LIVE_ENV).items.map((i) => [i.slug, i]));
  assert.equal(bySlug.board.frequencyDays, COMMAS_FREQUENCY_DAYS);
  assert.equal(bySlug.trial.frequencyDays, null, "a one-time buy has no cadence to state");
  assert.equal(bySlug.autopsy.frequencyDays, null);
  assert.equal(bySlug.board.priceLabel, "$47/month");
});

test("board: renewal is Commas', and the page is given the words", async () => {
  const out = await runFunnelCheckout(
    parseFunnelCheckoutBody({ item: "board", email: "a@b.co" }),
    { db: noDb, env: LIVE_ENV, orgId: "o", emit: () => ({}), createCheckoutSession: () => ({ ok: true, paymentLink: "https://x/y" }) }
  );
  assert.equal(out.renewal, BOARD_RENEWAL_STATE);
  assert.equal(BOARD_RENEWAL_STATE, "commas_subscription");

  const notice = funnelCatalogue(LIVE_ENV).notices.board_renewal;
  assert.match(notice, /first month/i, "the buyer must be told what today's charge covers");
  assert.match(notice, /renews/i);
  assert.match(notice, /cancel/i, "fee timing includes how it stops");
  assert.match(notice, new RegExp(`${COMMAS_FREQUENCY_DAYS} days`),
    "the cadence on the page is the cadence the session is minted with");

  /* A one-time item must not claim a renewal state at all. */
  const trial = await runFunnelCheckout(
    parseFunnelCheckoutBody({ item: "trial", email: "a@b.co" }),
    { db: noDb, env: LIVE_ENV, orgId: "o", emit: () => ({}), createCheckoutSession: () => ({ ok: true, paymentLink: "https://x/y" }) }
  );
  assert.equal(trial.renewal, null);
  assert.equal(trial.priceCents, 29700);
});

test("autopsy is delegated to the till that already exists — no second door on the $27", async () => {
  let seen = null;
  const out = await runFunnelCheckout(
    parseFunnelCheckoutBody({ item: "autopsy", email: "broker@example.com", first_name: "Sam", last_name: "Vale" }),
    {
      db: noDb, env: LIVE_ENV,
      emit: () => { throw new Error("the autopsy path writes its own record — do not double-record"); },
      createCheckoutSession: () => { throw new Error("the autopsy must not be minted twice"); },
      runAutopsyCheckout: (parsed) => {
        seen = parsed;
        return { ok: true, checkoutUrl: "https://pay.example.com/autopsy", ref: "ap_1", priceCents: 2700 };
      }
    }
  );
  assert.equal(seen.email, "broker@example.com");
  assert.equal(seen.name, "Sam Vale");
  assert.equal(out.ok, true);
  assert.equal(out.ref, "ap_1", "the autopsy's own ref travels — the upload page reads it");
  assert.equal(out.priceCents, 2700);
});

test("no Commas configured: 503, a named reason, and no invented link", async () => {
  const res = fakeRes();
  await handler(
    { method: "POST", body: { item: "trial", email: "a@b.co" } },
    res,
    { db: noDb, env: DEAD_ENV, emit: () => { throw new Error("nothing is recorded when nothing can be charged"); } }
  );
  assert.equal(res.statusCode, 503);
  assert.equal(res.body.error, "checkout_not_configured");
  assert.ok(!res.body.checkoutUrl);

  assert.equal(funnelCatalogue(DEAD_ENV).checkout.ready, false);
  for (const item of funnelCatalogue(DEAD_ENV).items) {
    if (item.selfServe) assert.equal(item.available, false, "a page that cannot charge must not offer a button");
  }
});

test("the query-link fallback is the same one createPaymentLink falls back to", async () => {
  const out = await runFunnelCheckout(
    parseFunnelCheckoutBody({ item: "trial", email: "a@b.co" }),
    { db: noDb, env: FALLBACK_ENV, orgId: "o", ref: "fn_fb", emit: () => ({}) }
  );
  assert.equal(out.ok, true);
  const url = new URL(out.checkoutUrl);
  assert.equal(url.origin + url.pathname, "https://pay.example.com/checkout");
  assert.equal(url.searchParams.get("amount"), "297.00");
  assert.equal(url.searchParams.get("ref"), "fn_fb", "the ref round-trips so the webhook can find this ask");
  assert.equal(funnelCatalogue(FALLBACK_ENV).checkout.ready, true);
});

test("a failed mint is a named failure, never a half-answer with a URL", async () => {
  const res = fakeRes();
  await handler(
    { method: "POST", body: { item: "board", email: "a@b.co" } },
    res,
    {
      db: noDb, env: LIVE_ENV, orgId: "o", emit: () => ({}),
      createCheckoutSession: () => ({ ok: false, reason: "checkout_http_500" })
    }
  );
  assert.equal(res.statusCode, 502);
  assert.equal(res.body.error, "checkout_failed");
  assert.ok(!res.body.checkoutUrl);
});

test("GET answers the catalogue; anything but GET/POST is 405 with an allow header", async () => {
  const get = fakeRes();
  await handler({ method: "GET" }, get, { env: LIVE_ENV });
  assert.equal(get.statusCode, 200);
  assert.equal(get.body.ok, true);
  assert.equal(get.body.items.length, 4);
  assert.equal(get.headers["cache-control"], "no-store");

  const del = fakeRes();
  await handler({ method: "DELETE" }, del, { env: LIVE_ENV });
  assert.equal(del.statusCode, 405);
  assert.equal(del.headers.allow, "GET, POST");
});

/* ───────────────────────────────────────────────────────────────────────────
   THE PAGES
   ─────────────────────────────────────────────────────────────────────────── */

const PAGES = [
  "public/partner/index.html",
  "public/partner/autopsy/index.html",
  "public/partner/board/index.html",
  "public/partner/trial/index.html",
  "public/partner/menu/index.html"
];

const read = (rel) => fs.readFileSync(path.join(REPO, rel), "utf8");

test("not one funnel price is typed into the markup", () => {
  /* A price in HTML is a second copy of a number, and the second copy is the
     one that is wrong after somebody changes the first. src/config/offers.mjs
     opens with "Do not hardcode them in HTML/JS"; this is that rule, enforced.

     THE ONE EXCEPTION, NAMED RATHER THAN GLOBBED: the $2,000 partner recruit
     bonus (docs/specs/W0-decisions.md, "Recruit bonus"). It is money FundHub
     PAYS a partner, not a price anything charges, and it has no catalogue
     entry anywhere in the repo to read it from. Left as written and reported
     as a gap rather than invented into this endpoint's catalogue. */
  const EXCEPTIONS = [/\$2,000/g];
  for (const rel of PAGES) {
    let text = read(rel);
    for (const ex of EXCEPTIONS) text = text.replace(ex, "");
    const hits = text.match(/\$\s?[0-9][0-9,]*/g) || [];
    assert.deepEqual(hits, [], `${rel} hardcodes a price: ${hits.join(", ")}`);
  }
});

test("every page reads its prices from this endpoint and can take money where it should", () => {
  for (const rel of PAGES) {
    const text = read(rel);
    assert.match(text, /src="\/partner\/funnel\.js"/, `${rel} does not load the price/checkout script`);
    assert.match(text, /data-price(-label)?=/, `${rel} has no price slot to fill`);
  }

  /* The bug this unit exists to fix: a self-serve impulse buy sent to the
     partner APPLICATION form. */
  for (const rel of ["public/partner/autopsy/index.html", "public/partner/board/index.html", "public/partner/trial/index.html"]) {
    const text = read(rel);
    const slug = rel.split("/")[2];
    assert.match(text, new RegExp(`<form[^>]*data-checkout="${slug}"`), `${rel} has no checkout form`);
    assert.match(text, /<button type="submit"/, `${rel} has no buy button`);
    assert.ok(!/\/affiliates\/\?track=(autopsy|board|trial)/.test(text),
      `${rel} still routes a self-serve purchase through the partner application form`);
  }

  /* And the offer that IS sold on a review call keeps its application link. */
  const partner = read("public/partner/index.html");
  assert.match(partner, /\/affiliates\/\?track=white_label/, "the $10,000 entry must still point at the application");
  assert.ok(!/data-checkout="partner"/.test(partner), "the entry fee must not be sold self-serve");
});

test("no page makes an earnings claim", () => {
  /* Zero measured paid closes exist. Nothing public may state, imply or model
     what a buyer will make. Split shares and referral percentages are
     commercial TERMS, not projections, and every page carrying one already
     says so in its own disclosure — which this checks is still there. */
  const banned = [
    /\bearn(?:ings?|ed)?\s+\$/i,
    /\bmake\s+\$[0-9]/i,
    /\bup to\s+\$[0-9]/i,
    /\b(?:average|typical|expected)\s+(?:income|earnings|revenue|result)/i,
    /\bper (?:month|year|week)\s+in (?:income|revenue|profit)/i,
    /\bguaranteed?\s+(?:income|earnings|profit|return)/i,
    /\breplace your (?:income|salary|job)/i,
    /\bsix[- ]figure/i
  ];
  for (const rel of PAGES) {
    const text = read(rel);
    for (const rx of banned) {
      assert.ok(!rx.test(text), `${rel} carries an earnings claim matching ${rx}`);
    }
    assert.match(text, /not a bank or a lender/i, `${rel} lost its disclosure`);
  }
  assert.match(read("public/partner/index.html"), /No earnings claim/i);
});

test("the handler is reachable — a handler file is not a route", async () => {
  const { ROUTES } = await import("../../netlify/functions/api.mjs");
  assert.equal(typeof ROUTES["public/funnel-checkout"], "function",
    "add it to the ROUTES map in netlify/functions/api.mjs or it 404s everywhere");
});
