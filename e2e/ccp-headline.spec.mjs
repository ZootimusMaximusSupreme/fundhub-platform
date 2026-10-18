// Playwright — the client control panel's headline, and the round's three moves.
//
// WHAT THIS SCREEN IS FOR. A funding advisor applies to many banks for one
// client in a wave, waits days, then phones each client to ask "did they
// approve you, and for how much". The only step in that loop that is countable,
// that rots when nobody looks, and that gates the fee is: a bank said yes and
// we still do not know how much. That count is now the top-left of the screen.
//
// WHAT THESE PROVE, in a real browser:
//   1. the count is real — it is the rows, not a constant, and it changes when
//      an approval is priced or marked as not counting
//   2. a FAILED read says "could not check" rather than showing an all-clear.
//      This is the one that matters: the screen used to leave the previous
//      sentence exactly as it was when the read failed, so a network hiccup was
//      indistinguishable from a file with nothing waiting
//   3. the tile that used to say "Total Approved" never shows the funded amount
//      and never falls back to the pre-approval guess
//   4. the three round moves post to /api/pipeline-cards — the board's own
//      endpoint — and a refusal is shown in the server's own words
//
// NO BACKEND — /api/** is answered by page.route() via harness.mjs.

import { test, expect } from "@playwright/test";
import { openScreen, json, OWNER, CLIENT_ID, CLIENT_ROW } from "./harness.mjs";

const LENDER_A = "bbbbbbbb-1111-4111-8111-111111111111";
const LENDER_B = "bbbbbbbb-2222-4222-8222-222222222222";

const MATCHES = {
  ok: true,
  match_count: 2,
  summary: { lender_count: 2 },
  matches: [
    { id: LENDER_A, name: "Mesa Community Bank", bureaus_pulled: "EX", application_url: "https://bank.example/a" },
    { id: LENDER_B, name: "Papago Savings", bureaus_pulled: "EQ", application_url: "https://bank.example/b" }
  ]
};

const applications = (rows) => ({
  "/api/applications": (route, ctx) => {
    const method = ctx && ctx.method ? ctx.method : route.request().method();
    if (method !== "GET") return json(route, { ok: true });
    return json(route, { ok: true, decisions: [], applications: rows });
  }
});

/* A read that fails the way a real one does: the endpoint answers 500. That is
   what data.js classifies as source "server", and what the headline has to
   report as "could not check". */
const applicationsDown = {
  "/api/applications": (route) => json(route, { ok: false, error: "boom" }, 500)
};

async function open(page, extra) {
  return openScreen(page, `/app/client-control-panel.html?client_id=${CLIENT_ID}`, OWNER, {
    "/api/read/lender-matches": MATCHES,
    ...extra
  });
}

const app = (over) => Object.assign({
  id: "app-1", lender_id: LENDER_A, status: "Approved",
  approved_amount: null, approval_excluded_at: null
}, over);

test.describe("client control panel — the top-left is the number the job chases", () => {

  test("the count is the rows, at metric size, with the confirmed total beside it", async ({ page }) => {
    await open(page, applications([
      app({ id: "1", lender_id: LENDER_A, approved_amount: null }),
      app({ id: "2", lender_id: LENDER_B, approved_amount: "45000.00" })
    ]));
    const count = page.locator("#ccp-waiting-count");
    await expect(count).toHaveText("1", { timeout: 10_000 });
    await expect(page.locator("#ccp-waiting-what")).toHaveText(/bank answer needs a dollar amount/);
    await expect(page.locator("#ccp-waiting-compare")).toHaveText(/\$45,000 confirmed across 1 bank yes/);

    // --fs-metric is 32px. A number that leads a screen has to actually lead it.
    const size = await count.evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
    expect(size).toBeGreaterThanOrEqual(28);
  });

  test("the reference tiles are NOT at metric size any more", async ({ page }) => {
    await open(page, applications([]));
    // Eight facts at 32px above the next action is eight things at no size.
    const tile = page.locator("#ccp-prequal");
    const size = await tile.evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
    expect(size).toBeLessThan(28);
  });

  test("a real zero is said in words, never as a bare 0 in a box", async ({ page }) => {
    await open(page, applications([app({ approved_amount: "45000.00" })]));
    await expect(page.locator("#ccp-waiting-what")).toHaveText("Nothing waiting on this file.", { timeout: 10_000 });
    await expect(page.locator("#ccp-waiting-count")).toBeHidden();
  });

  test("an approval marked as not counting drops out of the count", async ({ page }) => {
    await open(page, applications([
      app({ id: "1", lender_id: LENDER_A, approved_amount: null }),
      app({ id: "2", lender_id: LENDER_B, approved_amount: null, approval_excluded_at: "2026-08-30T00:00:00Z" })
    ]));
    await expect(page.locator("#ccp-waiting-count")).toHaveText("1", { timeout: 10_000 });
  });

  test("a recorded zero still counts as waiting — a zero cannot be invoiced", async ({ page }) => {
    await open(page, applications([app({ approved_amount: "0.00" })]));
    await expect(page.locator("#ccp-waiting-count")).toHaveText("1", { timeout: 10_000 });
    await expect(page.locator("#ccp-approved")).toHaveText("not recorded");
  });

  /* THE ONE THAT MATTERS. */
  test("a failed read says COULD NOT CHECK — it never shows an all-clear", async ({ page }) => {
    await open(page, applicationsDown);
    await expect(page.locator("#ccp-waiting-what"))
      .toHaveText("Could not check what is waiting.", { timeout: 10_000 });
    await expect(page.locator("#ccp-waiting-count")).toBeHidden();
    await expect(page.locator("#ccp-waiting-compare")).toHaveText(/could not be read/);
    await expect(page.locator("#ccp-approved")).toHaveText("could not check");
  });

  test("with no client open it asks for one rather than claiming nothing is waiting", async ({ page }) => {
    await openScreen(page, "/app/client-control-panel.html", OWNER, {});
    await expect(page.locator("#ccp-waiting-what"))
      .toHaveText("Pick a client to see what is waiting on you.", { timeout: 10_000 });
  });

  test("the caveat about unrecorded applications is on the screen", async ({ page }) => {
    await open(page, applications([]));
    // Nothing writes an application row at the moment somebody applies, so the
    // count can only ever cover answers we have been told about.
    await expect(page.locator(".headline-caveat"))
      .toContainText("Applications still out with a bank are not recorded anywhere");
  });
});

test.describe("client control panel — the Approved tile stopped lying", () => {

  test("it shows the confirmed approvals total, not the funded amount", async ({ page }) => {
    /* The client record carries a funded amount AND a pre-approval guess. The
       tile used to show the first, and the second when the first was missing.
       It must show neither. */
    await open(page, {
      "/api/dashboard/client": {
        ok: true,
        client: Object.assign({}, CLIENT_ROW, {
          funded: true,
          funded_amount: "99999.00",
          custom_fields: { analyzer_prequal_amount: 80000 }
        }),
        transactions: [], crs_results: [], messages: [], tasks: []
      },
      ...applications([
        app({ id: "1", lender_id: LENDER_A, approved_amount: "45000.00" }),
        app({ id: "2", lender_id: LENDER_B, approved_amount: "2500.50" })
      ])
    });
    const tile = page.locator("#ccp-approved");
    await expect(tile).toHaveText("$47,501", { timeout: 10_000 });
    await expect(tile).not.toHaveText("$99,999");
    await expect(tile).not.toHaveText("$80,000");
    // The label has to match the number.
    await expect(page.locator("#ccp-facts-group")).toContainText("Approved · confirmed");
    // And the funded amount is still on the screen, where it is what it says.
    await expect(page.locator("#ccp-facts-funded")).toHaveText("Yes · $99,999");
  });

  test("nothing confirmed reads 'not recorded', never $0 and never the guess", async ({ page }) => {
    await open(page, {
      "/api/dashboard/client": {
        ok: true,
        client: Object.assign({}, CLIENT_ROW, {
          custom_fields: { analyzer_prequal_amount: 80000 }
        }),
        transactions: [], crs_results: [], messages: [], tasks: []
      },
      ...applications([app({ approved_amount: null })])
    });
    await expect(page.locator("#ccp-approved")).toHaveText("not recorded", { timeout: 10_000 });
    // The guess is still on the screen under its own honest label.
    await expect(page.locator("#ccp-prequal")).toHaveText("$80,000");
  });
});

test.describe("client control panel — the round's three moves", () => {

  function moves(writes, reply) {
    return {
      "/api/pipeline-cards": (route, ctx) => {
        const method = ctx && ctx.method ? ctx.method : route.request().method();
        if (method !== "POST") return json(route, { ok: false, error: "method_not_allowed" }, 405);
        writes.push(JSON.parse(route.request().postData() || "{}"));
        return json(route, reply.body, reply.status || 200);
      }
    };
  }

  const OK_MOVE = { body: { ok: true, action: "move", created: false } };

  test("Mark round submitted posts the board's own move", async ({ page }) => {
    const writes = [];
    await open(page, Object.assign({}, applications([]), moves(writes, OK_MOVE)));
    await page.locator("#ccp-round-submit").click();
    await expect.poll(() => writes.length, { timeout: 10_000 }).toBe(1);
    expect(writes[0]).toMatchObject({
      action: "move", client_id: CLIENT_ID,
      pipeline_key: "funding_card_stacking", stage_key: "round_submitted"
    });
    await expect(page.locator("#ccp-round-note")).toHaveText(/Saved/);
  });

  test("Close round posts the closed stage", async ({ page }) => {
    const writes = [];
    await open(page, Object.assign({}, applications([]), moves(writes, OK_MOVE)));
    await page.locator("#ccp-round-close").click();
    await expect.poll(() => writes.length, { timeout: 10_000 }).toBe(1);
    expect(writes[0].stage_key).toBe("closed");
  });

  test("Mark funded opens a box on the page, not a browser prompt", async ({ page }) => {
    const writes = [];
    // A dialog would fail the test rather than hang it: nothing here may prompt.
    page.on("dialog", (d) => { throw new Error("the screen opened a browser dialog: " + d.message()); });
    await open(page, Object.assign({}, applications([]), moves(writes, OK_MOVE)));
    await expect(page.locator("#ccp-round-amount-box")).toBeHidden();
    await page.locator("#ccp-round-fund").click();
    await expect(page.locator("#ccp-round-amount-box")).toBeVisible();
    await page.locator("#ccp-round-funded").fill("$45,000.50");
    await page.locator("#ccp-round-fund-go").click();
    await expect.poll(() => writes.length, { timeout: 10_000 }).toBe(1);
    expect(writes[0].stage_key).toBe("funded");
    expect(writes[0].funded_amount).toBe("45000.50");
  });

  test("A BLANK BOX SENDS NOTHING — empty is not zero", async ({ page }) => {
    const writes = [];
    await open(page, Object.assign({}, applications([]), moves(writes, OK_MOVE)));
    await page.locator("#ccp-round-fund").click();
    await page.locator("#ccp-round-fund-go").click();
    await expect(page.locator("#ccp-round-note")).toHaveText(/not the same as zero/, { timeout: 10_000 });
    expect(writes).toEqual([]);
  });

  test("junk is refused on the screen, before any request", async ({ page }) => {
    const writes = [];
    await open(page, Object.assign({}, applications([]), moves(writes, OK_MOVE)));
    await page.locator("#ccp-round-fund").click();
    await page.locator("#ccp-round-funded").fill("about forty five");
    await page.locator("#ccp-round-fund-go").click();
    await expect(page.locator("#ccp-round-note")).toHaveText(/not an amount/, { timeout: 10_000 });
    expect(writes).toEqual([]);
  });

  test("a refusal is shown in the server's own words, naming the banks", async ({ page }) => {
    /* This is the refusal an advisor will actually meet, and it is the same
       fact the count at the top of the screen is about: a bank yes with no
       dollar amount could never be invoiced, so the round cannot be funded. */
    const writes = [];
    await open(page, Object.assign({}, applications([app({ approved_amount: null })]), moves(writes, {
      status: 400,
      body: {
        ok: false,
        error: "approval_amounts_missing",
        message: "Cannot move to funded: Mesa Community Bank has no dollar amount on its approval.",
        missing_approval_banks: ["Mesa Community Bank"]
      }
    })));
    await page.locator("#ccp-round-fund").click();
    await page.locator("#ccp-round-funded").fill("45000");
    await page.locator("#ccp-round-fund-go").click();
    await expect(page.locator("#ccp-round-note"))
      .toContainText("Mesa Community Bank has no dollar amount", { timeout: 10_000 });
  });

  test("a move that creates a card on a board this client was not on says so", async ({ page }) => {
    const writes = [];
    await open(page, Object.assign({}, applications([]), moves(writes, {
      body: { ok: true, action: "move", created: true }
    })));
    await page.locator("#ccp-round-submit").click();
    await expect(page.locator("#ccp-round-note"))
      .toContainText("had no card on the Card Stacking board", { timeout: 10_000 });
  });

  test("with no client open the three buttons refuse rather than guess", async ({ page }) => {
    await openScreen(page, "/app/client-control-panel.html", OWNER, {});
    await expect(page.locator("#ccp-round-submit")).toBeDisabled();
    await expect(page.locator("#ccp-round-fund")).toBeDisabled();
    await expect(page.locator("#ccp-round-close")).toBeDisabled();
    await expect(page.locator("#ccp-round-note")).toHaveText(/Open a client file/);
  });
});

/* ── THE CONSENT LINK ACTUALLY HIDES ────────────────────────────────────────
   Same trap as the funded-amount box, one section up the page and worse.
   .link-btn is laid out with `display:flex`, and an author `display` beats the
   browser's own [hidden]{display:none}. #ccp-consent-link is the only .link-btn
   the code ever hides, and FOUR branches of checkConsent() set hidden = true on
   it. All four were dead: "Record consent for this client" was on screen in
   every state, carrying no information, including the one state the code's own
   comment forbids — consent revoked means stop, so do not offer a shortcut to
   re-collect it.

   These run the states rather than reading the CSS, so the guard cannot be
   deleted without a red test. The last case is the point of the control: when
   consent has genuinely run out, the link is still there. A rule that painted
   nothing would pass the first four and fail that one. */
const consent = (body, status = 200) => ({
  "/api/consent/capture": (route) => route.fulfill({
    status, contentType: "application/json", body: JSON.stringify(body)
  })
});

async function openCredit(page, extra) {
  const result = await open(page, extra);
  await page.getByRole("tab", { name: "Credit & inquiries", exact: true }).click();
  return result;
}

test.describe("client control panel — a consent link that can be hidden", () => {

  test("consent already valid — no link, because there is nothing to collect", async ({ page }) => {
    await openCredit(page, Object.assign({}, applications([]), consent({ ok: true, status: { valid: true } })));
    await expect(page.locator("#ccp-consent-link")).toBeHidden();
  });

  test("REVOKED — the screen does not offer a shortcut to re-collect it", async ({ page }) => {
    await openCredit(page, Object.assign({}, applications([]),
      consent({ ok: true, status: { valid: false, reason: "revoked" } })));
    await expect(page.locator("#ccp-consent-state")).toContainText("took their permission back");
    await expect(page.locator("#ccp-consent-link")).toBeHidden();
  });

  test("the consent read FAILED — unknown is not a reason to offer a link", async ({ page }) => {
    await openCredit(page, Object.assign({}, applications([]), consent({ ok: false, error: "boom" }, 500)));
    await expect(page.locator("#ccp-consent-state")).toContainText("Could not check consent");
    await expect(page.locator("#ccp-consent-link")).toBeHidden();
  });

  test("an answer with no status at all is treated the same way", async ({ page }) => {
    await openCredit(page, Object.assign({}, applications([]), consent({ ok: true, capture: {} })));
    await expect(page.locator("#ccp-consent-link")).toBeHidden();
  });

  test("EXPIRED — the one state that needs the link still shows it", async ({ page }) => {
    await openCredit(page, Object.assign({}, applications([]),
      consent({ ok: true, status: { valid: false, reason: "expired" } })));
    await expect(page.locator("#ccp-consent-state")).toContainText("run out");
    const link = page.locator("#ccp-consent-link");
    await expect(link).toBeVisible();
    // A guard that painted nothing would hide this one too. Prove it has a box.
    const box = await link.boundingBox();
    expect(box.height).toBeGreaterThan(0);
    expect(box.width).toBeGreaterThan(0);
  });

  /* THE SWEEP, IN MORE THAN ONE STATE — and that is the whole point.
     The first version of this ran once, on the default read, and passed while
     #ccp-approve-row leaked at 641x40 with a live-looking "Copy link" on it.
     It could not see it: that row carries no `hidden` in the markup, so it only
     ever gets one from renderHandoff(), in a state the single run never
     reached. A sweep with no exemption list still has an implicit exemption for
     every element it never puts in the hidden state. Each entry below is a real
     answer /api/consent/capture gives — the no-link ones are what it returns
     when the signing key is absent. */
  const SWEEP_STATES = {
    "the default read": applications([]),
    "consent expired and no link could be signed": Object.assign({}, applications([]),
      consent({ ok: true, status: { valid: false, reason: "expired" },
                approval_link: { url: null, unavailable_reason: "missing the signing key" } })),
    "no consent on file and no link could be signed": Object.assign({}, applications([]),
      consent({ ok: true, status: { valid: false, reason: "none_on_file" } })),
    "consent revoked": Object.assign({}, applications([]),
      consent({ ok: true, status: { valid: false, reason: "revoked" } })),
    "the consent read failed": Object.assign({}, applications([]),
      consent({ ok: false, error: "boom" }, 500))
  };

  for (const [state, routes] of Object.entries(SWEEP_STATES)) {
    test(`NOTHING ON THE SCREEN LEAKS THROUGH [hidden] — ${state}`, async ({ page }) => {
      await openCredit(page, routes);
      const leaking = await page.evaluate(() =>
        Array.from(document.querySelectorAll("[hidden]"))
          .filter((el) => getComputedStyle(el).display !== "none")
          .map((el) => el.id || el.className || el.tagName));
      expect(leaking).toEqual([]);
    });
  }

  test("the copy control goes away and the reason takes its place", async ({ page }) => {
    /* Not the sweep's job. The sweep proves nothing is laid out; this proves
       the screen still says WHY, so the row is replaced rather than deleted. */
    await openCredit(page, Object.assign({}, applications([]),
      consent({ ok: true, status: { valid: false, reason: "expired" },
                approval_link: { url: null, unavailable_reason: "No signing key on this environment." } })));
    await expect(page.locator("#ccp-approve-nolink")).toHaveText("No signing key on this environment.");
    await expect(page.locator("#ccp-approve-row")).toBeHidden();
  });

  test("with a real link the copy row is still a laid-out box", async ({ page }) => {
    /* A rule that painted nothing would pass every sweep above and be wrong. */
    await openCredit(page, Object.assign({}, applications([]),
      consent({ ok: true, status: { valid: false, reason: "expired" },
                approval_link: { url: "https://approve.example/abc", expires_at: "2026-09-01T17:00:00Z" } })));
    const row = page.locator("#ccp-approve-row");
    await expect(row).toBeVisible();
    const box = await row.boundingBox();
    expect(box.width).toBeGreaterThan(0);
    expect(box.height).toBeGreaterThan(0);
    await expect(page.locator("#ccp-approve-url")).toHaveValue("https://approve.example/abc");
  });
});

test.describe("client control panel — the chase list got the room", () => {

  test("the lender rows are in the main column, not the 320px rail", async ({ page }) => {
    await open(page, applications([]));
    const inMain = await page.evaluate(() => {
      const list = document.getElementById("fh-funding-apply");
      return !!(list && list.closest(".main-col"));
    });
    expect(inMain).toBe(true);
  });

  test("40 lenders draw 25 rows and the rest are named, not silently dropped", async ({ page }) => {
    const many = [];
    for (let i = 0; i < 40; i++) {
      many.push({
        id: "cccccccc-" + String(1000 + i) + "-4111-8111-111111111111",
        name: "Bank " + i, bureaus_pulled: "EX", application_url: "https://bank.example/" + i
      });
    }
    await openScreen(page, `/app/client-control-panel.html?client_id=${CLIENT_ID}`, OWNER, {
      "/api/read/lender-matches": { ok: true, match_count: 40, summary: { lender_count: 40 }, matches: many },
      ...applications([])
    });
    await expect.poll(
      () => page.locator("#fh-funding-apply-list input[data-amount-lender-id]").count(),
      { timeout: 10_000 }
    ).toBe(25);
    await expect(page.locator("#fh-funding-apply-more")).toContainText("15 more lenders fit");
  });
});
