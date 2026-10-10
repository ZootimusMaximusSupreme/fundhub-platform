// Consent capture — every way a client's yes is recorded, pressed for real.
//
// The soft-pull consent is the key to a paid credit pull; the dispute
// authorization lets letters be prepared. The method buttons, the name box,
// the signature pad and Withdraw were only checked as page text. This presses
// them: typed, ticked and signed each send the right capture method; a typed or
// signed consent with no name, or a signature with an empty pad, sends nothing;
// each kind is filed under its own name; Withdraw needs a reason.

import { test, expect } from "@playwright/test";
import { wireApi, withSession } from "./harness.mjs";

const CLIENT = "ac1ac964-e02b-468b-9cbe-7030e03dd13b";
const CONSENT = "c0c0c0c0-0000-4000-8000-000000000001";

function read(kind, { history = [], disclosure = true } = {}) {
  return {
    ok: true, kind,
    disclosure: disclosure ? { version: "2.1", text: `The ${kind} wording the client reads.` } : null,
    status: { valid: false, reason: "none_on_file" },
    history
  };
}

async function open(page, { kind = null, history = [], disclosure = true, postAnswer } = {}) {
  const posts = [];
  await withSession(page);
  await wireApi(page, {
    handlers: {
      "/api/consent/capture": async (route, { method, url }) => {
        if (method === "POST") {
          const body = route.request().postDataJSON();
          posts.push(body);
          const out = postAnswer ? postAnswer(body) : { status: 200, body: { ok: true } };
          return route.fulfill({ status: out.status, contentType: "application/json", body: JSON.stringify(out.body) });
        }
        const k = (/[?&]kind=([^&]+)/.exec(url) || [])[1] || "soft_pull_consent";
        return read(decodeURIComponent(k), { history, disclosure });
      }
    }
  });
  await page.goto(`/app/consent-capture.html?client_id=${CLIENT}${kind ? `&kind=${kind}` : ""}`);
  await expect(page.locator("#ccVersion")).toHaveText(disclosure ? "2.1" : "—");
  return { posts };
}

async function drawSignature(page) {
  const pad = page.locator("#ccSignPad");
  // The pad sits below the fold on a laptop screen; a pen can only draw on
  // what is on screen.
  await pad.scrollIntoViewIfNeeded();
  const box = await pad.boundingBox();
  await page.mouse.move(box.x + 30, box.y + 80);
  await page.mouse.down();
  for (let i = 1; i <= 12; i += 1) await page.mouse.move(box.x + 30 + i * 18, box.y + 80 + (i % 2 ? -25 : 25));
  await page.mouse.up();
}

test.describe("consent capture: recording a yes", () => {
  test("typed: the name and the expiry are recorded as a typed soft-pull consent", async ({ page }) => {
    const { posts } = await open(page);
    await page.locator("#ccName").fill("  Dana Whitfield ");
    await page.locator("#ccExpires").fill("2027-10-10");
    await page.locator("#ccSubmit").click();
    await expect.poll(() => posts.length).toBe(1);
    expect(posts[0]).toEqual({
      client_id: CLIENT, kind: "soft_pull_consent", action: "grant", capture_method: "typed",
      granted_name: "Dana Whitfield", consent_version: "2.1", expires_at: "2027-10-10"
    });
    await expect(page.locator("#ccMsg")).toHaveText("Consent recorded. A soft pull may now be requested for this client.");
    await expect(page.locator("#ccName")).toHaveValue("");
  });

  test("typed with no name: refused on the page, nothing sent", async ({ page }) => {
    const { posts } = await open(page);
    await page.locator("#ccSubmit").click();
    await expect(page.locator("#ccMsg")).toContainText("Type the name exactly as the client gave it.");
    expect(posts).toEqual([]);
  });

  test("ticked a box: no name box, recorded as checkbox with no name", async ({ page }) => {
    const { posts } = await open(page);
    await page.locator('.cc-method[data-method="checkbox"]').click();
    await expect(page.locator("#ccNameField")).toBeHidden();
    await page.locator("#ccSubmit").click();
    await expect.poll(() => posts.length).toBe(1);
    expect(posts[0].capture_method).toBe("checkbox");
    expect(posts[0].granted_name).toBe(null);
  });

  test("signed: an empty pad is refused; after drawing it records a signature; Clear empties it again", async ({ page }) => {
    const { posts } = await open(page);
    await page.locator('.cc-method[data-method="signature"]').click();
    await expect(page.locator("#ccSignField")).toBeVisible();
    await page.locator("#ccName").fill("Dana Whitfield");
    await page.locator("#ccSubmit").click();
    await expect(page.locator("#ccMsg")).toHaveText("Draw your signature in the box. An empty box does not count.");
    expect(posts).toEqual([]);

    await drawSignature(page);
    await page.locator("#ccSignClear").click();
    await page.locator("#ccSubmit").click();
    await expect(page.locator("#ccMsg")).toHaveText("Draw your signature in the box. An empty box does not count.");
    expect(posts).toEqual([]);

    await drawSignature(page);
    await page.locator("#ccSubmit").click();
    await expect.poll(() => posts.length).toBe(1);
    expect(posts[0]).toMatchObject({ kind: "soft_pull_consent", capture_method: "signature", granted_name: "Dana Whitfield" });
  });

  test("dispute authorization opens on Signed and is filed as dispute_authorization", async ({ page }) => {
    const { posts } = await open(page, { kind: "dispute_authorization" });
    await expect(page.locator("#ccTitle")).toHaveText("Authorize dispute letters");
    await expect(page.locator('.cc-method[data-method="signature"]')).toHaveClass(/on/);
    await page.locator("#ccName").fill("Dana Whitfield");
    await drawSignature(page);
    await page.locator("#ccSubmit").click();
    await expect.poll(() => posts.length).toBe(1);
    expect(posts[0]).toMatchObject({ kind: "dispute_authorization", capture_method: "signature" });
    await expect(page.locator("#ccMsg")).toHaveText("Signature recorded. We can prepare dispute letters. This is not a credit pull.");
  });

  for (const kind of ["call_recording", "marketing_use"]) {
    test(`${kind} is recorded under its own name, never as a soft-pull consent`, async ({ page }) => {
      const { posts } = await open(page, { kind });
      await page.locator("#ccName").fill("Dana Whitfield");
      await page.locator("#ccSubmit").click();
      await expect.poll(() => posts.length).toBe(1);
      expect(posts[0].kind).toBe(kind);
    });
  }

  test("a refusal from the server is said in its own words; the button comes back", async ({ page }) => {
    const { posts } = await open(page, {
      postAnswer: () => ({ status: 403, body: { ok: false, error: "forbidden", message: "Only staff on this client's company can record consent." } })
    });
    await page.locator("#ccName").fill("Dana Whitfield");
    await page.locator("#ccSubmit").click();
    await expect.poll(() => posts.length).toBe(1);
    await expect(page.locator("#ccMsg")).toHaveText("Only staff on this client's company can record consent.");
    await expect(page.locator("#ccSubmit")).toBeEnabled();
  });

  test("with no consent wording from the server, Record consent is switched off", async ({ page }) => {
    await open(page, { disclosure: false });
    await expect(page.locator("#ccDisclosure")).toContainText("do not record a consent");
    await expect(page.locator("#ccSubmit")).toBeDisabled();
  });
});

test.describe("consent capture: Withdraw", () => {
  const LIVE = [{ id: CONSENT, valid: true, granted_at: "2026-10-01T15:00:00Z", capture_method: "typed", granted_name: "Dana Whitfield", granted_by_kind: "staff", expires_at: null }];

  test("Withdraw asks for a reason and sends it with that consent's id", async ({ page }) => {
    const { posts } = await open(page, { history: LIVE });
    page.once("dialog", (d) => d.accept("Client asked us to stop"));
    await page.locator(`[data-revoke="${CONSENT}"]`).click();
    await expect.poll(() => posts.length).toBe(1);
    expect(posts[0]).toEqual({ client_id: CLIENT, action: "revoke", consent_id: CONSENT, reason: "Client asked us to stop" });
  });

  test("Withdraw with no reason, or cancelled, sends nothing", async ({ page }) => {
    const { posts } = await open(page, { history: LIVE });
    page.once("dialog", (d) => d.accept("   "));
    await page.locator(`[data-revoke="${CONSENT}"]`).click();
    await expect(page.locator("#ccMsg")).toHaveText("A reason is required to withdraw a consent.");
    page.once("dialog", (d) => d.dismiss());
    await page.locator(`[data-revoke="${CONSENT}"]`).click();
    await page.waitForTimeout(200);
    expect(posts).toEqual([]);
  });

  test("a consent that is not live has no Withdraw button", async ({ page }) => {
    await open(page, { history: [{ ...LIVE[0], valid: false, revoked_at: "2026-10-05T12:00:00Z", revoked_reason: "asked" }] });
    await expect(page.locator("[data-revoke]")).toHaveCount(0);
    await expect(page.locator("#ccHistory")).toContainText("not live");
  });
});
