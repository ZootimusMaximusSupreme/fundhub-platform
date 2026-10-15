// Practice test (real page, fake /api answers) for seven Client Portal controls in batch 10:
// the Account drawer tabs, the two course tiles, What You Own's Open course button, the Facebook wins
// card, the "See exactly where your file stands" link, the signature pad's Clear button, and the staff
// "Open this client in Documents" link.
// The expected words are worked out in this file from the fake data, not copied from the page.
// It reads no live data and it never follows the Facebook link. Each row is claimed only inside the
// callback that asserts it.

import assert from "node:assert/strict";
import test from "node:test";

import { bodyOf, json, proofRows, sharedScreens, waitFor } from "./fin-b10-kit.mjs";

const proof = proofRows(import.meta.url);
const screens = sharedScreens();

const CLIENT = "aaaaaaaa-1111-4111-8111-111111111111";
const FB_WINS = "https://www.facebook.com/groups/1713376659872201";

const session = (role) => ({ ok: true, staff: { id: role === "client" ? CLIENT : `staff-${role}`, name: "Dana Whitfield", email: "dana@example.com", role, org_id: "org-1", status: "active" } });
const CLIENT_SESSION = session("client");
const OWNER_SESSION = session("owner");

const SUMMARY = {
  ok: true, prequal_amount: null, prequal_display: null, soft_pull_complete: false,
  scores: { experian: null, equifax: null, transunion: null, experian_business: null },
  documents: [{ id: "doc-1", document_key: "bank-statement", title: "Client bank statement", mime_type: "application/pdf", created_at: "2026-08-20T12:00:00Z" }],
};

async function openPortal({ who = CLIENT_SESSION, entitlements = [], query = `?id=${CLIENT}`, summary = {}, extra = {} } = {}) {
  const seen = { consent: [], staffDocuments: 0 };
  const handlers = {
    "/api/read/portal-summary": { ...SUMMARY, ...summary },
    "/api/read/documents": async (route) => { seen.staffDocuments += 1; return json(route, { ok: false, error: "forbidden" }, 403); },
    "/api/consent/capture": async (route, { method }) => {
      if (method === "POST") {
        seen.consent.push(bodyOf(route));
        return json(route, { ok: true });
      }
      return json(route, { ok: true, disclosure: { text: "I authorize Fundhub to prepare dispute letters.", version: "v3" }, status: { valid: false } });
    },
    entitlement: { ok: true, items: entitlements },
    ...extra,
  };
  const { page, errors } = await screens.open(`/app/client-portal.html${query}`, { session: who, handlers });
  await page.waitForLoadState("networkidle");
  return { page, errors, seen };
}

const FUNDING_MASTERY = { entitlement_code: "funding-mastery-course", active: true, entitlement_name: "Capital Academy" };
const DELIVERABLES = { entitlement_code: "credit-optimization-roadmap", active: true };

test("Account drawer tabs: each tab shows only its own list and says which tab is selected", async () => {
  await proof.check(/^Account drawer tabs/, async () => {
    const { page, errors } = await openPortal();
    // The drawer is closed at first and opens on its summary.
    assert.equal(await page.locator("#acct").getAttribute("open"), null);
    await page.locator("#acct > summary").click();

    const tabs = await page.$$eval("#acct-tabs .tab", (els) => els.map((e) => [e.dataset.tab, e.textContent.trim(), e.getAttribute("aria-controls")]));
    assert.deepEqual(tabs, [
      ["pay", "Payments", "tp-pay"], ["agree", "Agreements", "tp-agree"], ["docs", "Documents", "tp-docs"],
      ["act", "Activity", "tp-act"], ["msg", "Messages", "tp-msg"],
    ]);
    // Payments is the tab shown first.
    assert.deepEqual(await page.$$eval("#acct-tabs .tab.on", (els) => els.map((e) => e.dataset.tab)), ["pay"]);

    for (const [tab, , pane] of tabs) {
      await page.locator(`#acct-tabs .tab[data-tab="${tab}"]`).click();
      assert.deepEqual(await page.$$eval("#acct-tabs .tab.on", (els) => els.map((e) => e.dataset.tab)), [tab], `${tab} is the only tab on`);
      assert.deepEqual(await page.$$eval("#acct-tabs .tab", (els) => els.map((e) => e.getAttribute("aria-selected"))),
        tabs.map(([t]) => String(t === tab)), `${tab} aria-selected`);
      assert.deepEqual(await page.$$eval("#acct .tabpane.on", (els) => els.map((e) => e.id)), [pane], `${tab} pane`);
      // Every other list is out of sight, and this one is in sight.
      for (const [, , other] of tabs) {
        assert.equal(await page.locator(`#${other}`).isVisible(), other === pane, `${tab}: ${other} visible`);
      }
    }
    // The client's own file shows in Documents, from the client-safe summary and not from the staff list.
    await page.locator('#acct-tabs .tab[data-tab="docs"]').click();
    assert.match(await page.locator("#tp-docs").innerText(), /Client bank statement/);
    assert.deepEqual(errors, []);
    await page.close();
  });
});

test("Course tiles: Open expands the modules in place, a module opens, Close shuts them, and a locked tile does not open", async () => {
  await proof.check(/^Course tiles/, async () => {
    const { page, errors } = await openPortal({ entitlements: [FUNDING_MASTERY, DELIVERABLES] });
    for (const [key, modules, label] of [["FUNDING_MASTERY", 10, /funding mastery/i], ["UWIQ_DELIVERABLES", 5, /how to use this/i]]) {
      const tile = page.locator(`[data-tile="${key}"]`);
      const toggle = tile.locator(`[data-course-toggle="${key}"]`);
      assert.equal((await toggle.textContent()).trim(), "Open", `${key} starts on Open`);
      assert.equal(await tile.locator(".tile-course").isHidden(), true, `${key} modules start hidden`);
      assert.equal(await tile.locator("details.tc-mod").count(), modules, `${key} module count`);

      await toggle.click();
      assert.match(await tile.getAttribute("class"), /\bis-open\b/);
      assert.equal(await tile.locator(".tile-course").isVisible(), true, `${key} modules show`);
      assert.match(await tile.locator(".tc-label").innerText(), label);
      assert.equal((await toggle.textContent()).trim(), "Close");

      // A module opens on its summary, and only that one.
      await tile.locator("details.tc-mod > summary").nth(1).click();
      assert.deepEqual(await tile.locator("details.tc-mod").evaluateAll((els) => els.map((e) => e.open)),
        Array.from({ length: modules }, (_, i) => i === 1), `${key} second module open`);

      // Close puts the modules away, and the opened module is shut for next time.
      await toggle.click();
      assert.doesNotMatch(await tile.getAttribute("class"), /\bis-open\b/);
      assert.equal(await tile.locator(".tile-course").isHidden(), true);
      assert.equal((await toggle.textContent()).trim(), "Open");
      assert.deepEqual(await tile.locator("details.tc-mod").evaluateAll((els) => els.map((e) => e.open)),
        Array.from({ length: modules }, () => false));
    }

    // A tap on the tile body opens it too, and a tap on a module summary does not toggle the tile.
    const tile = page.locator('[data-tile="FUNDING_MASTERY"]');
    await tile.locator(".tt").click();
    assert.match(await tile.getAttribute("class"), /\bis-open\b/);
    await tile.locator("details.tc-mod > summary").first().click();
    assert.match(await tile.getAttribute("class"), /\bis-open\b/, "pressing a module leaves the tile open");
    assert.deepEqual(errors, []);
    await page.close();

    // A tile the client does not own stays locked: no Open button, and a tap on it opens nothing.
    const locked = await openPortal({ entitlements: [] });
    const lockedTile = locked.page.locator('[data-tile="FUNDING_MASTERY"]');
    assert.match(await lockedTile.getAttribute("class"), /\blocked\b/);
    assert.equal(await lockedTile.locator("[data-course-toggle]").count(), 0);
    await lockedTile.locator(".tt").click();
    assert.doesNotMatch(await lockedTile.getAttribute("class"), /\bis-open\b/);
    assert.equal(await lockedTile.locator(".tile-course").isHidden(), true);
    await locked.page.close();
  });
});

test("What You Own Open course button: opens that course's own card, and a course not owned has no button", async () => {
  await proof.check(/^What You Own: Open course button/, async () => {
    const { page, errors } = await openPortal({ entitlements: [FUNDING_MASTERY] });
    const button = page.locator('#own-list [data-own-course="FUNDING_MASTERY"]');
    assert.equal(await button.count(), 1);
    assert.equal((await button.textContent()).trim(), "Open course");
    assert.match(await page.locator("#own-list").innerText(), /Capital Academy[\s\S]*It is a course, not a file/);
    const tile = page.locator('[data-tile="FUNDING_MASTERY"]');
    assert.doesNotMatch(await tile.getAttribute("class"), /\bis-open\b/);
    assert.equal(await tile.locator(".tile-course").isHidden(), true);

    await button.click();
    assert.match(await tile.getAttribute("class"), /\bis-open\b/, "the course card opens");
    assert.equal(await tile.locator(".tile-course").isVisible(), true);
    assert.equal(await tile.locator("details.tc-mod").count(), 10);
    // Pressing it again leaves the card open: it opens, it does not toggle.
    await button.click();
    assert.match(await tile.getAttribute("class"), /\bis-open\b/);
    // The other course card is not touched.
    assert.doesNotMatch(await page.locator('[data-tile="UWIQ_DELIVERABLES"]').getAttribute("class"), /\bis-open\b/);
    assert.deepEqual(errors, []);
    await page.close();

    // Without the course there is no button.
    const none = await openPortal({ entitlements: [DELIVERABLES] });
    assert.equal(await none.page.locator("#own-list [data-own-course]").count(), 0);
    await none.page.close();
  });
});

test("Facebook wins group card: shows before any purchase, opens the group in a new tab, and is a real link", async () => {
  await proof.check(/^Facebook wins group card/, async () => {
    const { page, errors } = await openPortal({ entitlements: [] });
    const card = page.locator("#fb-wins");
    assert.equal(await card.isVisible(), true);
    assert.equal(await card.evaluate((el) => el.tagName), "A");
    assert.equal(await card.getAttribute("href"), FB_WINS);
    assert.equal(await card.getAttribute("target"), "_blank");
    assert.match(await card.getAttribute("rel"), /noopener/);
    assert.match(await card.innerText(), /Join the Fundhub wins group[\s\S]*Join on Facebook/);
    // A press would land on it: nothing covers it and nothing disables it. (A trial click checks that and
    // does not follow the link, so the test never leaves this machine.)
    await card.click({ trial: true });
    // The page's own click handlers do not cancel the press.
    const prevented = await page.evaluate(() => new Promise((resolve) => {
      const el = document.getElementById("fb-wins");
      el.addEventListener("click", (e) => { resolve(e.defaultPrevented); e.preventDefault(); }, { once: true });
      el.click();
    }));
    assert.equal(prevented, false);
    assert.deepEqual(errors, []);
    await page.close();
  });
});

test("See exactly where your file stands link: goes to the progress page, and carries the client for staff only", async () => {
  await proof.check(/^See exactly where your file stands link/, async () => {
    // A client's link is left as it ships, and pressing it opens the progress page.
    const client = await openPortal();
    const link = client.page.locator("#prog-link a");
    assert.equal(await link.isVisible(), true);
    assert.match(await link.innerText(), /See exactly where your file stands/);
    assert.equal(await link.getAttribute("href"), "/progress.html");
    await link.click();
    await client.page.waitForURL(/\/progress\.html$/);
    assert.deepEqual(client.errors, []);
    await client.page.close();

    // Staff looking at a client's portal get the client id on the link, so the progress page knows whose file.
    const staff = await openPortal({ who: OWNER_SESSION });
    const staffLink = staff.page.locator("#prog-link a");
    assert.equal(await staffLink.getAttribute("href"), `/progress.html?client_id=${CLIENT}`);
    await staffLink.click();
    await staff.page.waitForURL(new RegExp(`/progress\\.html\\?client_id=${CLIENT}$`));
    await staff.page.close();
  });
});

test("Signature Clear button: wipes the drawing, so signing then needs a new one, and a new drawing goes through", async () => {
  await proof.check(/^Sign to authorize dispute letters: Clear button/, async () => {
    // The card shows only when the summary says this client is on the repair path.
    const hidden = await openPortal();
    assert.equal(await hidden.page.locator("#dispute-auth-card").isVisible(), false);
    await hidden.page.close();

    const { page, seen, errors } = await openPortal({ summary: { dispute_consent: true } });
    await page.waitForFunction(() => /I authorize Fundhub/.test(document.querySelector("#cpDisclosure").textContent));
    const draw = async () => {
      const box = await page.locator("#cpSignPad").boundingBox();
      await page.mouse.move(box.x + 30, box.y + 40);
      await page.mouse.down();
      await page.mouse.move(box.x + 120, box.y + 90, { steps: 8 });
      await page.mouse.move(box.x + 220, box.y + 50, { steps: 8 });
      await page.mouse.up();
    };
    const sign = async (name) => {
      await page.locator("#cpSignName").fill(name);
      await page.locator("#cpSignSubmit").click();
    };

    // Nothing drawn: the sentence, and no request.
    await sign("Dana Whitfield");
    assert.equal(await page.locator("#cpSignMsg").textContent(), "Draw your signature in the box. An empty box does not count.");
    assert.deepEqual(seen.consent, []);

    // Drawn, then cleared: the box counts as empty again.
    await draw();
    await page.locator("#cpSignClear").click();
    await sign("Dana Whitfield");
    assert.equal(await page.locator("#cpSignMsg").textContent(), "Draw your signature in the box. An empty box does not count.");
    assert.deepEqual(seen.consent, [], "a cleared pad sends nothing");

    // Drawn again: it goes through, with the typed name and the wording's version.
    await draw();
    await sign("Dana Whitfield");
    await waitFor(() => seen.consent.length === 1, "the signature request");
    assert.deepEqual(seen.consent[0], {
      client_id: CLIENT, kind: "dispute_authorization", action: "grant", capture_method: "signature",
      granted_name: "Dana Whitfield", consent_version: "v3",
    });
    assert.deepEqual(errors, []);
    await page.close();
  });
});

test("Staff view Open this client in Documents link: shows for staff with this client's id, and never for the client", async () => {
  await proof.check(/^Staff view: Open this client in Documents link/, async () => {
    const staff = await openPortal({ who: OWNER_SESSION });
    await staff.page.locator("#acct > summary").click();
    await staff.page.locator('#acct-tabs .tab[data-tab="docs"]').click();
    const link = staff.page.locator("#tp-docs a");
    await waitFor(async () => (await link.count()) === 1, "the staff link");
    assert.equal((await link.textContent()).trim(), "Open this client in Documents");
    assert.equal(await link.getAttribute("href"), `documents.html?client_id=${CLIENT}`);
    assert.match(await staff.page.locator("#tp-docs").innerText(), /Staff documents live in Documents/);
    assert.equal(staff.seen.staffDocuments, 0, "the staff document list is not read for this");
    await link.click();
    await staff.page.waitForURL(new RegExp(`/app/documents\\.html\\?client_id=${CLIENT}$`));
    await staff.page.close();

    // The client sees their own files, and no link into the staff Documents screen.
    const client = await openPortal();
    await client.page.locator("#acct > summary").click();
    await client.page.locator('#acct-tabs .tab[data-tab="docs"]').click();
    assert.equal(await client.page.locator("#tp-docs a").count(), 0);
    assert.doesNotMatch(await client.page.locator("#tp-docs").innerText(), /Open this client in Documents/);
    await client.page.close();
  });
});

test("every listed row was exercised", () => {
  proof.assertAllClaimed();
});
