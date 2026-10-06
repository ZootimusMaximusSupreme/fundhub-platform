// The client portal, driven in a real browser for the five ROUND 2 rows
// (14-18 / walk findings F35, F33, F34, F37, F36).
//
// WHY A BROWSER AND NOT ANOTHER FILE SCAN. src/http/client-portal-walk-fixes.test.mjs
// reads the shipped HTML and proves the wrong copy is gone. It cannot prove the
// screen a client actually sees, and every one of these five findings was
// something a person read off a screen. So this loads the real page, answers
// /api/** the way the real endpoints answer, and looks at the rendered words.
//
// NO BACKEND, ON PURPOSE. e2e/static-server.mjs serves public/ and page.route()
// answers the API. The four states below — a course buyer, a funding buyer, a
// repair buyer, and the walk's own pulled-called-and-signed client — are states
// a live database makes slow to reach and this file reaches in a second each.
//
// IT ALSO WRITES THE EVIDENCE. Every scenario screenshots the page and records
// the bounding box of the exact element under discussion into shot-marks.json,
// which ops/workflows/w4b-proof-2026-09-03/_apply-marks.py burns into a red box
// with a number and a legend (CLAUDE.md §8 — an unmarked screenshot is not
// evidence). Set W4B_PHASE=before to capture the pre-fix screen.
//
// IT WRITES TO A SCRATCH DIRECTORY, NOT INTO THE REPOSITORY. Running the browser
// suite used to overwrite the committed PNGs in the working tree, so anybody who
// ran it — for an unrelated reason, on an unrelated branch — silently changed
// seven files of evidence. Output goes under the system temp directory unless
// W4B_PROOF_OUT names somewhere else, and copying it into
// ops/workflows/w4b-proof-2026-09-03/ is a deliberate second step.
//
// AND THE BOXES ARE CHECKED AGAINST THE PICTURE BEFORE IT IS KEPT. The first run
// of this file measured elements sitting inside the portal's own inner scroll
// container without scrolling them into view, so four of seven red boxes were
// drawn at coordinates outside the image and _apply-marks.py clamped them onto
// the bottom status bar. The caption then described something that was not in
// the frame at all. shot() now scrolls each marked element into view first and
// FAILS THE TEST if any box still falls outside the screenshot — an annotation
// pointing at empty space is worse evidence than no picture.

import { test, expect } from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CLIENT_ID, json } from "./harness.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PHASE = process.env.W4B_PHASE === "before" ? "before" : "after";
const OUT_ROOT = process.env.W4B_PROOF_OUT
  ? path.resolve(process.env.W4B_PROOF_OUT)
  : path.join(os.tmpdir(), "w4b-proof-2026-09-03");
const RAW = path.join(OUT_ROOT, `shots-${PHASE}`, "_raw");
const MANIFEST = path.join(OUT_ROOT, `shots-${PHASE}`, "shot-marks.json");

fs.mkdirSync(RAW, { recursive: true });

const CLIENT_SESSION = {
  ok: true,
  staff: {
    id: CLIENT_ID, name: "Sim Five-Academy", email: "sim.five@example.com",
    role: "client", org_id: "org-1", status: "active"
  }
};

/* The walk's own client, fact for fact: the pull landed, the call happened, a
   $5,000 agreement is signed, no payment posted (F26 blocked the sim payment).
   These are the fields api/read/portal-summary.mjs really returns. */
const WALK_STAGE = {
  key: "agreement_signed",
  before_call: false,
  contract_signed_at: "2026-09-03T18:51:07Z",
  soft_pull_complete: true,
  call_held: true,
  agreement_signed: true,
  payment_posted: false
};

const BOOKED_STAGE = {
  key: "booked",
  before_call: true,
  contract_signed_at: null,
  soft_pull_complete: false,
  call_held: false,
  agreement_signed: false,
  payment_posted: false
};

async function openPortal(page, { entitlements = [], summary = {} } = {}) {
  await page.addInitScript(() => {
    localStorage.setItem("fh_token", "e2e-token");
    localStorage.setItem("fh_role", "client");
    localStorage.removeItem("fh_demo");
  });

  await page.route("**/api/**", async (route) => {
    const url = route.request().url();
    if (url.includes("/api/auth/session") || /\/api\/session\b/.test(url)) {
      return json(route, CLIENT_SESSION);
    }
    if (url.includes("/api/read/portal-summary")) {
      return json(route, {
        ok: true,
        prequal_amount: null, prequal_display: null,
        scores: { experian: null, equifax: null, transunion: null, experian_business: null },
        documents: [],
        inquiry_open: false,
        soft_pull_complete: false,
        repair_path: false,
        dispute_consent: false,
        advisor: null,
        stage: BOOKED_STAGE,
        ...summary
      });
    }
    if (url.includes("entitlement")) {
      return json(route, { ok: true, items: entitlements });
    }
    return json(route, { ok: true, items: [] });
  });

  await page.goto(`/app/client-portal.html?id=${CLIENT_ID}`);
  await page.waitForLoadState("domcontentloaded");
  // The reads land one after another and each repaints. Give them room: a shot
  // taken too early photographs the page's own starting copy and reads exactly
  // like a real stale answer.
  await page.waitForTimeout(900);
}

/* shot — one screenshot plus the boxes that make it evidence.
   `marks` is [{ selector, caption }]; the box comes from the live element, so a
   moved element cannot leave the red box pointing at empty space. */
/* The manifest is MERGED with whatever is already on disk, not rebuilt. A
   Playwright worker restarts after a failing test, which reloads this module and
   empties an in-memory object — and the whole point of the `before` run is that
   one test fails, so the naive version silently dropped the two shots taken
   before the failure. */
function readManifest() {
  try { return JSON.parse(fs.readFileSync(MANIFEST, "utf8")); } catch { return {}; }
}
/* measure — every mark's live box at the CURRENT scroll position. A selector that
   matches nothing gives null, which is a legitimate answer for a `before` shot of
   something that does not exist yet. */
async function measure(page, marks) {
  const out = [];
  for (const m of marks) {
    let box = null;
    try { box = await page.locator(m.selector).first().boundingBox({ timeout: 2000 }); } catch { box = null; }
    out.push(box);
  }
  return out;
}

/* bringIntoFrame — scroll until every marked element is inside the viewport.
   `fullPage: true` would not help: the portal scrolls in its own inner container,
   and a full-page capture only grows with the DOCUMENT's scroll height, so the
   container's hidden rows are still off the picture. Scrolling the real element
   is the only thing that puts it in front of the camera. */
async function bringIntoFrame(page, marks) {
  const vp = page.viewportSize();
  for (let attempt = 0; attempt < 4; attempt++) {
    const boxes = await measure(page, marks);
    const seen = boxes.filter(Boolean);
    if (!seen.length) return boxes;
    const top = Math.min(...seen.map((b) => b.y));
    const bottom = Math.max(...seen.map((b) => b.y + b.height));
    if (top >= 0 && bottom <= vp.height) return boxes;
    // Anchor on whichever marked element sits highest, so a group is pulled in
    // together rather than each one chasing the last out of frame.
    const i = boxes.findIndex((b) => b && b.y === top);
    try { await page.locator(marks[i].selector).first().scrollIntoViewIfNeeded({ timeout: 2000 }); } catch { /* keep the last position */ }
    await page.waitForTimeout(200);
  }
  return measure(page, marks);
}

async function shot(page, file, legend, marks) {
  const vp = page.viewportSize();
  const boxes = await bringIntoFrame(page, marks);
  await page.screenshot({ path: path.join(RAW, file), fullPage: false });

  /* THE BOX HAS TO BE ON THE PICTURE. _apply-marks.py clamps an out-of-range box
     to the edge of the image, which is how four captions ended up describing
     something that was not in the frame. Failing here is the point: a red box
     that lands on the status bar is worse than no screenshot at all. */
  const strays = [];
  boxes.forEach((b, i) => {
    if (!b) return;
    if (b.x < 0 || b.y < 0 || b.x + b.width > vp.width || b.y + b.height > vp.height) {
      strays.push(`${marks[i].selector} at ${JSON.stringify(b)}`);
    }
  });
  if (strays.length) {
    throw new Error(
      `${file}: ${strays.length} red box(es) fall outside the ${vp.width}x${vp.height} screenshot, ` +
      `so the caption would point at empty space — ${strays.join("; ")}`
    );
  }

  const out = marks.map((m, i) => ({
    n: String(i + 1),
    caption: m.caption,
    box: boxes[i]
      ? { x: Math.round(boxes[i].x), y: Math.round(boxes[i].y), w: Math.round(boxes[i].width), h: Math.round(boxes[i].height) }
      : null
  }));

  const manifest = readManifest();
  manifest[file] = { legend, viewport: { w: vp.width, h: vp.height }, marks: out };
  fs.writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2));
}

test.describe(`client portal — W4B ROUND 2 rows 14-18 (${PHASE})`, () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 1000 });
  });

  /* ── ROW 14 / F35 ─────────────────────────────────────────────────────────
     Owner-set 2026-09-03: the dispute-consent block shows ONLY for repair and
     for the funding offer. Courses and e-products never sign. */

  test("14a · a course buyer is never asked to authorize dispute letters", async ({ page }) => {
    await openPortal(page, {
      entitlements: [{ entitlement_code: "funding-mastery-course", active: true }],
      summary: { stage: WALK_STAGE, repair_path: false, dispute_consent: false }
    });
    await shot(page, "14a-course-buyer.png",
      "F35 — a course buyer is not asked", [
        { selector: '[data-tile="FUNDING_MASTERY"]', caption: "Capital Academy — all this client bought" }
      ]);
    await expect(page.locator("#dispute-auth-card")).toBeHidden();
  });

  test("14b · the funding-offer buyer IS asked", async ({ page }) => {
    await openPortal(page, {
      entitlements: [{ entitlement_code: "funding-snapshot", active: true }],
      summary: { stage: WALK_STAGE, repair_path: false, dispute_consent: true }
    });
    await shot(page, "14b-funding-buyer.png",
      PHASE === "before"
        ? "F35 BEFORE — funding buyer not asked"
        : "F35 AFTER — funding buyer is asked",
      PHASE === "before"
        ? [{ selector: "#fb-wins", caption: "Nothing above this card. No sign block." }]
        : [{ selector: "#dispute-auth-card", caption: "Sign to authorize dispute letters — shown" }]);
    await expect(page.locator("#dispute-auth-card")).toBeVisible();
  });

  test("14c · the repair buyer IS asked", async ({ page }) => {
    await openPortal(page, {
      entitlements: [{ entitlement_code: "metro2-letter-pack", active: true }],
      summary: { stage: WALK_STAGE, repair_path: true, dispute_consent: true }
    });
    await expect(page.locator("#dispute-auth-card")).toBeVisible();
  });

  test("14d · an endpoint that answers with neither field keeps the block shut", async ({ page }) => {
    // An older deploy of portal-summary carries no dispute_consent at all. A
    // missing answer must not open a consent form.
    await openPortal(page, { entitlements: [], summary: { stage: WALK_STAGE } });
    await expect(page.locator("#dispute-auth-card")).toBeHidden();
  });

  /* ── ROW 15 / F33 ─────────────────────────────────────────────────────── */

  test("15 · after the pull, the call and a signed agreement the screen says so", async ({ page }) => {
    await openPortal(page, {
      entitlements: [{ entitlement_code: "funding-mastery-course", active: true }],
      summary: { stage: WALK_STAGE, repair_path: false, dispute_consent: false }
    });
    await shot(page, "15-stage-after-signing.png",
      "F33 — stage after pull, call, signature", [
        { selector: "#greeting-sub-pre", caption: "Greeting: no longer 'Your call is next'" },
        { selector: "#sb-pre-eyebrow", caption: "Banner: now reads 'After your call'" },
        { selector: "#own-empty-note", caption: "Reports note: 'not run those yet' is gone" }
      ]);
    await expect(page.locator("#greeting-sub-pre")).not.toContainText("Your call is next");
    await expect(page.locator("#sb-pre-eyebrow")).toHaveText("After your call");
    await expect(page.locator("#own-empty-note")).not.toContainText("we have not run those yet");
  });

  test("15b · a client who has only booked still reads before-the-call copy", async ({ page }) => {
    await openPortal(page, { entitlements: [], summary: { stage: BOOKED_STAGE } });
    await expect(page.locator("#greeting-sub-pre")).toContainText("Your call is next");
    await expect(page.locator("#sb-pre-eyebrow")).toHaveText("Before your call");
  });

  /* ── ROW 16 / F34 ─────────────────────────────────────────────────────── */

  test("16a · an assigned advisor is named", async ({ page }) => {
    await openPortal(page, {
      entitlements: [],
      summary: {
        stage: WALK_STAGE,
        advisor: { name: "Marcus Hale", role: "funding_advisor", source: "staff_link" }
      }
    });
    await shot(page, "16a-advisor-named.png",
      "F34 — the advisor is named", [
        { selector: "#adv-name", caption: "Your Funding Advisor: the assigned name" }
      ]);
    await expect(page.locator("#adv-name")).toHaveText("Marcus Hale");
  });

  test("16b · nobody assigned reads as an answer, not a blank", async ({ page }) => {
    await openPortal(page, { entitlements: [], summary: { stage: WALK_STAGE, advisor: null } });
    await shot(page, "16b-advisor-empty.png",
      "F34 — nobody assigned yet", [
        { selector: "#adv-name", caption: "'Not assigned yet' — never a made-up name" }
      ]);
    await expect(page.locator("#adv-name")).toHaveText("Not assigned yet");
    await expect(page.locator("#adv-name")).not.toHaveText("—");
  });

  /* ── ROW 17 / F37 ─────────────────────────────────────────────────────── */

  test("17 · an owned offer is not priced as a locked upsell", async ({ page }) => {
    await openPortal(page, {
      entitlements: [{ entitlement_code: "funding-mastery-course", active: true }],
      summary: { stage: WALK_STAGE }
    });
    await shot(page, "17-owned-offer.png",
      "F37 — an owned offer is not an upsell", [
        { selector: '[data-tile="FUNDING_MASTERY"] .tp', caption: "Owned: 'Included — you own this'" },
        { selector: '[data-tile="FUNDING_DFY"] .tp', caption: "Not owned: still 'On your call'" }
      ]);
    await expect(page.locator('[data-tile="FUNDING_MASTERY"] .tp')).toHaveText("Included — you own this");
    await expect(page.locator('[data-tile="FUNDING_MASTERY"]')).not.toHaveClass(/locked/);
    await expect(page.locator('[data-tile="FUNDING_DFY"] .tp')).toHaveText("On your call");
  });

  /* ── ROW 18 / F36 ─────────────────────────────────────────────────────── */

  test("18 · the Messages tab shows exactly one empty state", async ({ page }) => {
    await openPortal(page, { entitlements: [], summary: { stage: WALK_STAGE } });
    await page.locator("#acct > summary").click();
    await page.locator('[data-tab="msg"]').click();
    await page.waitForTimeout(200);
    await shot(page, "18-messages-one-empty.png",
      "F36 — one empty row, not two", [
        { selector: "#tp-msg", caption: "one empty row, and it makes no false claim" }
      ]);
    /* Walkthrough-4 defect 18: a client gets no messages read, so the pane
       must not tell them "No messages yet." — it says where messages go. */
    const empties = page.locator("#tp-msg #msg-empty");
    await expect(empties).toHaveCount(1);
    await expect(empties).toContainText("arrive on your phone and in your inbox");
    await expect(page.locator("#tp-msg .timeline-item", { hasText: "No messages yet." })).toHaveCount(0);
  });
});
