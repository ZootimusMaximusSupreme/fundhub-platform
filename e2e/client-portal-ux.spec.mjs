// Client portal — go-live UX gates (funding suppress, pay honesty, real states, included tile).
import { test, expect } from "@playwright/test";
import { CLIENT_ID, json } from "./harness.mjs";

const FB_WINS = "https://www.facebook.com/groups/1713376659872201";

const CLIENT_SESSION = {
  ok: true,
  staff: {
    id: CLIENT_ID,
    name: "Dana Whitfield",
    email: "dana@example.com",
    role: "client",
    org_id: "org-1",
    status: "active"
  }
};

const OWNER_SESSION = {
  ok: true,
  staff: {
    id: "staff-1",
    name: "Jordan Blake",
    email: "jordan@fundhub.ai",
    role: "owner",
    org_id: "org-1",
    status: "active"
  }
};

async function openPortal(page, session, entitlements, { settleMs = 600, portalSummary } = {}) {
  const calls = { staffDocuments: 0 };
  await page.addInitScript((s) => {
    localStorage.setItem("fh_token", "e2e-token");
    localStorage.setItem("fh_role", (s.staff && s.staff.role) || "owner");
    localStorage.removeItem("fh_demo");
  }, session);

  await page.route("**/api/**", async (route) => {
    const url = route.request().url();
    if (url.includes("/api/auth/session") || /\/api\/session\b/.test(url)) {
      return json(route, session);
    }
    if (url.includes("/api/read/documents")) {
      calls.staffDocuments += 1;
      return json(route, { ok: false, error: "forbidden" }, 403);
    }
    if (url.includes("/api/read/portal-summary")) {
      return json(route, {
        ok: true, prequal_amount: null, prequal_display: null, soft_pull_complete: false,
        scores: { experian: null, equifax: null, transunion: null, experian_business: null },
        documents: [{
          id: "doc-1", document_key: "bank-statement", title: "Client bank statement",
          mime_type: "application/pdf", created_at: "2026-08-20T12:00:00Z"
        }],
        ...(portalSummary || {})
      });
    }
    if (url.includes("entitlement")) {
      return json(route, { ok: true, items: entitlements });
    }
    return json(route, { ok: true, items: [] });
  });

  await page.goto(`/app/client-portal.html?id=${CLIENT_ID}`);
  await page.waitForLoadState("domcontentloaded");
  if (settleMs > 0) await page.waitForTimeout(settleMs);
  return calls;
}

test.describe("client portal go-live UX", () => {
  test("letter-only client does not see funding approval dollars", async ({ page }) => {
    await openPortal(page, CLIENT_SESSION, [
      { entitlement_code: "metro2-letter-pack", active: true }
    ]);

    await expect(page.locator("body")).toHaveClass(/no-funding/);
    await expect(page.locator(".prog-card.funding-only")).toBeHidden();
    await expect(page.locator(".prog-card.precall-only")).toBeVisible();
    await expect(page.locator(".video-card")).toBeVisible();
    await expect(page.locator("#video-title")).toHaveText(/Welcome to the Fundhub portal/i);
    await expect(page.locator("#greeting-sub")).toBeHidden();
    await expect(page.locator("#greeting-sub-pre")).toBeVisible();
    await expect(page.locator(".promo")).toBeHidden();
    await expect(page.locator(".statesw")).toBeHidden();
    await expect(page.locator(".prog-card.funding-only .sb-main")).toBeHidden();
    await expect(page.locator("#own-list")).toContainText(/Metro 2 Dispute Letter Pack/i);
    await expect(page.locator("#own-list")).not.toContainText(/Funding Snapshot/i);
  });

  test("credit scores stay hidden when none are on file", async ({ page }) => {
    await openPortal(page, CLIENT_SESSION, []);
    await expect(page.locator("#sb-scores-card")).toBeHidden();
  });

  test("portal paints 3-bureau and Experian business scores", async ({ page }) => {
    await openPortal(page, CLIENT_SESSION, [], {
      portalSummary: {
        scores: { experian: 720, equifax: 710, transunion: 705, experian_business: 72 }
      }
    });
    await expect(page.locator("#sb-scores-card")).toBeVisible();
    await expect(page.locator("#sb-score-ex")).toHaveText("720");
    await expect(page.locator("#sb-score-eq")).toHaveText("710");
    await expect(page.locator("#sb-score-tu")).toHaveText("705");
    await expect(page.locator("#sb-score-ex-biz")).toHaveText("72");
  });

  test("facebook wins group is on the portal before the call", async ({ page }) => {
    await openPortal(page, CLIENT_SESSION, []);
    const link = page.locator("#fb-wins");
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute("href", FB_WINS);
    await expect(link).toHaveAttribute("target", "_blank");
    await expect(page.locator("#own-empty")).toBeVisible();
    await expect(page.locator(".action-card")).toBeHidden();
  });

  test("client files come from the client-safe portal summary", async ({ page }) => {
    const calls = await openPortal(page, CLIENT_SESSION, []);
    await expect(page.locator("#tp-docs")).toContainText("Client bank statement");
    expect(calls.staffDocuments).toBe(0);
    await expect(page.locator("#tp-docs")).not.toContainText("Open this client in Documents");
  });

  test("unlock tiles hide list prices except the $32 soft pull", async ({ page }) => {
    await openPortal(page, CLIENT_SESSION, []);
    await expect(page.locator('[data-tile="SOFT_PULL"] .tp')).toHaveText("$32");
    await expect(page.locator('[data-tile="FUNDING_DFY"] .tp')).toHaveText("On your call");
    await expect(page.locator('[data-tile="REPAIR_DFY"] .tp')).toHaveText("On your call");
    await expect(page.locator('[data-tile="REPAIR_TRIAL"] .tp')).toHaveText("On your call");
    await expect(page.locator('[data-tile="UWIQ_DELIVERABLES"] .tp')).toHaveText("On your call");
    await expect(page.locator('[data-tile="FUNDING_MASTERY"] .tp')).toHaveText("On your call");
    await expect(page.locator("#promo .promo-price")).toContainText("On your call");
    await expect(page.locator("#tiles")).not.toContainText("$3,000");
    await expect(page.locator("#tiles")).not.toContainText("$1,000");
    await expect(page.locator("#tiles")).not.toContainText("$200");
    await expect(page.locator("#tiles")).not.toContainText("$5,000");
    await expect(page.locator('[data-tile="FUNDING_DFY"] .tt')).toHaveText(/Funding, done-for-you/i);
    await expect(page.locator('[data-tile="metro2"]')).toHaveCount(0);
    await expect(page.locator('[data-tile="consulting"]')).toHaveCount(0);
  });

  test("funding client still sees funding progress", async ({ page }) => {
    await openPortal(page, CLIENT_SESSION, [
      { entitlement_code: "funding-snapshot", active: true }
    ]);

    await expect(page.locator("body")).not.toHaveClass(/no-funding/);
    await expect(page.locator(".prog-card.funding-only")).toBeVisible();
    await expect(page.locator(".video-card")).toBeVisible();
    await expect(page.locator(".prog-card.funding-only .sb-main")).toHaveText(/funding file is open/i);
  });

  test("staff do not get the removed designer state switcher", async ({ page }) => {
    await openPortal(page, OWNER_SESSION, [
      { entitlement_code: "funding-snapshot", active: true }
    ]);
    await expect(page.locator(".statesw")).toHaveCount(0);
    await expect(page.locator("#st-precall")).toHaveCount(0);
  });

  test("included letter pack shows View status, not Unlock", async ({ page }) => {
    await openPortal(page, CLIENT_SESSION, [
      { entitlement_code: "metro2-letter-pack", active: true }
    ]);

    const tile = page.locator('[data-tile="REPAIR_DFY"]');
    await expect(tile.locator(".lockrow")).toHaveText(/Included/i);
    await expect(tile.locator("[data-status='REPAIR_DFY']")).toHaveText(/View status/i);
    await expect(tile.locator("[data-unlock]")).toHaveCount(0);

    await tile.locator("[data-status='REPAIR_DFY']").click();
    await expect(page.locator("#unlock-modal")).toHaveClass(/on/);
    await expect(page.locator("#um-price")).toHaveText(/Included/i);
    await expect(page.locator("#um-go")).toHaveText(/Close/i);
  });

  test("unlocked deliverables tile opens course modules in place", async ({ page }) => {
    await openPortal(page, CLIENT_SESSION, [
      { entitlement_code: "credit-optimization-roadmap", active: true }
    ]);

    const tile = page.locator('[data-tile="UWIQ_DELIVERABLES"]');
    await expect(tile.locator(".lockrow")).toHaveText(/Unlocked/i);
    await expect(tile.locator("[data-course-toggle='UWIQ_DELIVERABLES']")).toHaveText(/Open/i);
    await expect(tile.locator("[data-status]")).toHaveCount(0);
    await expect(tile.locator(".tile-course")).toBeHidden();

    await tile.locator("[data-course-toggle='UWIQ_DELIVERABLES']").click();
    await expect(tile).toHaveClass(/is-open/);
    await expect(tile.locator(".tile-course")).toBeVisible();
    await expect(tile.locator(".tile-course")).toContainText(/How To Use This/i);
    await expect(tile.locator("[data-course-toggle='UWIQ_DELIVERABLES']")).toHaveText(/Close/i);
    await expect(page.locator("#unlock-modal")).not.toHaveClass(/on/);

    await tile.locator(".tc-mod summary").first().click();
    await expect(tile.locator(".tc-mod").first()).toHaveAttribute("open", "");
    await expect(tile.locator(".tc-empty").first()).toContainText(/Coming soon/i);
  });

  test("unlocked Funding Mastery tile expands the same way", async ({ page }) => {
    await openPortal(page, CLIENT_SESSION, [
      { entitlement_code: "funding-mastery-course", active: true }
    ]);

    const tile = page.locator('[data-tile="FUNDING_MASTERY"]');
    await expect(tile.locator(".lockrow")).toHaveText(/Unlocked/i);
    await expect(tile.locator("[data-course-toggle='FUNDING_MASTERY']")).toHaveText(/Open/i);

    await tile.click({ position: { x: 24, y: 24 } });
    await expect(tile).toHaveClass(/is-open/);
    await expect(tile.locator(".tile-course")).toBeVisible();
    await expect(tile.locator(".tile-course")).toContainText(/Funding Mastery/i);
  });

  test("What You Own lists an owned course and Open course opens its card (hole 11)", async ({ page }) => {
    await openPortal(page, CLIENT_SESSION, [
      { entitlement_code: "funding-mastery-course", entitlement_name: "Funding Mastery course (A to Z)", active: true }
    ]);

    await expect(page.locator("#own-empty")).toBeHidden();
    const row = page.locator("#own-list .own", { hasText: "Funding Mastery course (A to Z)" });
    await expect(row).toBeVisible();
    await expect(row).toContainText(/It is a course, not a file/);

    const tile = page.locator('[data-tile="FUNDING_MASTERY"]');
    await expect(tile).not.toHaveClass(/is-open/);
    await row.getByRole("button", { name: "Open course" }).click();
    await expect(tile).toHaveClass(/is-open/);
    await expect(tile.locator(".tile-course")).toBeVisible();
    await expect(tile.locator(".tile-course")).toContainText(/Funding Mastery/i);
  });

  test("pay stays hidden when no checkout exists", async ({ page }) => {
    await openPortal(page, CLIENT_SESSION, []);

    await expect(page.locator('[data-tile="FUNDING_MASTERY"] [data-unlock="FUNDING_MASTERY"]')).toBeHidden();
    await expect(page.locator("#unlock-modal")).not.toHaveClass(/on/);
  });

  test("chat opens before the call and asks for questions", async ({ page }) => {
    await openPortal(page, {
      ...CLIENT_SESSION,
      had_call: false,
      staff: { ...CLIENT_SESSION.staff, had_call: false }
    }, [], { settleMs: 0 });
    // Widget mounts closed, then pops ~1.4s after login. Unit test covers the
    // closed-first beat; here we prove the live greeting lands after that.
    await expect(page.locator("#fh-chat-fab")).toBeVisible({ timeout: 8000 });
    await expect(page.locator("#fh-chat-panel")).toHaveClass(/open/, { timeout: 8000 });
    await expect(page.locator("#fh-chat-body")).toContainText(/before we talk/i);
  });

  test("chat stays closed after a logged call", async ({ page }) => {
    await openPortal(page, {
      ...CLIENT_SESSION,
      had_call: true,
      staff: { ...CLIENT_SESSION.staff, had_call: true }
    }, []);
    await expect(page.locator("#fh-chat-fab")).toBeVisible({ timeout: 8000 });
    await expect(page.locator("#fh-chat-panel")).not.toHaveClass(/open/);
  });

  /* HOLE 17 — an inquiry client held no entitlement, so every upload door was
     hidden and the whole "Send a file" card with them. The file said
     inquiry:docs_needed and DOC-01 had already asked for an ID, proof of
     address and an authorization; there was nowhere to put them. */
  test("an open inquiry case opens the inquiry door with no entitlements", async ({ page }) => {
    await openPortal(page, CLIENT_SESSION, [], { portalSummary: { inquiry_open: true } });

    await expect(page.locator(".action-card")).toBeVisible();
    await expect(page.locator("#upload-doors")).toBeVisible();
    await expect(page.locator(".door-inquiry")).toBeVisible();
    await expect(page.locator(".door-inquiry .upload-btn")).toHaveText(/Upload inquiry docs/i);
    /* Only the door they actually have. The funding and bureau lanes are paid
       lanes and stay shut. */
    await expect(page.locator(".door-funding")).toBeHidden();
    await expect(page.locator(".door-bureau")).toBeHidden();
  });

  test("no entitlements and no inquiry case keeps every door shut", async ({ page }) => {
    await openPortal(page, CLIENT_SESSION, [], { portalSummary: { inquiry_open: false } });
    await expect(page.locator(".action-card")).toBeHidden();
    await expect(page.locator(".door-inquiry")).toBeHidden();
  });

  test("Send through the inquiry door posts an inquiry_doc for this client", async ({ page }) => {
    await openPortal(page, CLIENT_SESSION, [], { portalSummary: { inquiry_open: true } });

    const posted = [];
    await page.route("**/api/documents-upload", async (route) => {
      posted.push(route.request().postData() || "");
      return json(route, { ok: true, documents: [{ id: "doc-new" }] });
    });

    const door = page.locator(".door-inquiry");
    await door.locator("input[type=file]").setInputFiles({
      name: "ftc-report.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from("%PDF-1.4 hole 17 proof")
    });
    await expect(door.locator(".upload-btn")).toHaveText(/Send 1 file/i);

    await door.locator(".upload-btn").click();
    await expect(door.locator(".upload-btn")).toHaveText(/^Sent$/, { timeout: 15_000 });

    expect(posted).toHaveLength(1);
    expect(posted[0]).toContain("inquiry_doc");
    expect(posted[0]).toContain(CLIENT_ID);
    expect(posted[0]).toContain("ftc-report.pdf");
  });

  /* CP-06 — a file the server refuses must say why, under the button, and must
     not leave the client re-sending the same file. The body below is what
     api/documents-upload.mjs answers for a HEIC (400, code + message). */
  test("a refused file shows the server's reason and lets the client pick another", async ({ page }) => {
    await openPortal(page, CLIENT_SESSION, [], { portalSummary: { inquiry_open: true } });

    const reason = "only jpg, png and pdf are accepted (declared type: image/heic)";
    let posts = 0;
    await page.route("**/api/documents-upload", async (route) => {
      posts += 1;
      return json(route, { ok: false, error: "invalid_file_type", message: reason, filename: "photo.heic" }, 400);
    });

    const door = page.locator(".door-inquiry");
    /* The picker no longer offers what the server refuses. */
    await expect(door.locator("input[type=file]")).not.toHaveAttribute("accept", /heic/i);

    await door.locator("input[type=file]").setInputFiles({
      name: "photo.heic",
      mimeType: "image/heic",
      buffer: Buffer.from("not really a heic")
    });
    await door.locator(".upload-btn").click();

    await expect(door.locator("[data-door-msg]")).toBeVisible({ timeout: 15_000 });
    await expect(door.locator("[data-door-msg]")).toContainText(reason);
    await expect(door.locator(".upload-btn")).not.toHaveText(/^Try again$/);
    expect(posts).toBe(1);
  });

});
