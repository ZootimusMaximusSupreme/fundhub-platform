// Client control panel: the three bureau Pull buttons and the Declines "Save
// outcome" button (finish-the-853, batch 01).
//
//   Pull Equifax / Experian / TransUnion -> POST /api/finance/crs-pull with this
//     client and that bureau's code, only while consent is on file; every
//     refusal is said in words and the pull never claims it finished when it did not.
//   Declines: Save outcome -> POST /api/blueprint/declines action "outcome" with
//     the chosen outcome, the amount, the re-apply day and the notes.
//
// NO BACKEND: page.route() answers /api/**. No bureau is asked.
import { test, expect } from "@playwright/test";
import { openScreen, json, OWNER, CLIENT_ID } from "./harness.mjs";

// These run on a Mac that is often busy with other browser runs: give each test room.
test.describe.configure({ timeout: 60_000 });

const CONSENT_OK = { ok: true, status: { valid: true }, identity: { on_file: true }, approval_link: null };

async function openPulls(page, { consent = CONSENT_OK, consentStatus = 200, pull, query = `?client_id=${CLIENT_ID}` } = {}) {
  const pulls = [];
  let consentReads = 0;
  await openScreen(page, `/app/client-control-panel.html${query}`, OWNER, {
    "/api/consent/capture": (route) => {
      consentReads += 1;
      return json(route, consent, consentStatus);
    },
    "/api/finance/crs-pull": async (route) => {
      pulls.push(JSON.parse(route.request().postData() || "{}"));
      return pull ? pull(route, pulls.length) : json(route, { ok: true, stored: true });
    },
  });
  return { pulls, consentReads: () => consentReads };
}

const BUTTONS = [
  ["Pull TransUnion", "#ccp-pull-tu", "TU", "TransUnion"],
  ["Pull Experian", "#ccp-pull-ex", "EX", "Experian"],
  ["Pull Equifax", "#ccp-pull-eq", "EQ", "Equifax"],
];

test.describe("client control panel: bureau pull buttons", () => {
  for (const [name, selector, code, label] of BUTTONS) {
    test(`${name} sends this client and bureau ${code}, once, and says it finished`, async ({ page }) => {
      const { pulls } = await openPulls(page);
      await expect(page.locator("#ccp-consent-state")).toHaveText("Consent is on file. A bureau pull can go ahead.");
      await expect(page.locator(selector)).toBeEnabled();
      await page.locator(selector).click();
      await expect.poll(() => pulls.length).toBe(1);
      expect(pulls[0]).toEqual({ client_id: CLIENT_ID, bureau: code });
      await expect(page.locator("#ccp-pull-status")).toHaveText(`${label} pull finished. Refresh the file to see the stored report.`);
      await expect(page.locator(selector)).toBeEnabled();
    });
  }

  test("each button is for its own bureau: pressing Experian never sends the other two codes", async ({ page }) => {
    const { pulls } = await openPulls(page);
    await page.locator("#ccp-pull-ex").click();
    await expect.poll(() => pulls.length).toBe(1);
    await page.locator("#ccp-pull-tu").click();
    await expect.poll(() => pulls.length).toBe(2);
    expect(pulls.map((p) => p.bureau)).toEqual(["EX", "TU"]);
  });

  test("a missing identity is said in words with its code, and the pull is not reported as finished", async ({ page }) => {
    const { pulls } = await openPulls(page, {
      pull: (route) => json(route, { ok: false, code: "identity_required", error: "identity_required" }, 422),
    });
    await page.locator("#ccp-pull-eq").click();
    await expect.poll(() => pulls.length).toBe(1);
    const status = page.locator("#ccp-pull-status");
    await expect(status).toContainText("No identity on file for this client");
    await expect(status).toContainText("[identity_required]");
    await expect(status).not.toContainText("pull finished");
    await expect(page.locator("#ccp-pull-eq")).toBeEnabled();
  });

  test("a refused consent shows the bank's reason and reads consent again", async ({ page }) => {
    const { pulls, consentReads } = await openPulls(page, {
      pull: (route) => json(route, { ok: false, code: "consent_required", error: "this client took their permission back." }, 403),
    });
    const before = consentReads();
    await page.locator("#ccp-pull-ex").click();
    await expect.poll(() => pulls.length).toBe(1);
    await expect(page.locator("#ccp-pull-status")).toContainText("No consent — this client took their permission back.");
    await expect.poll(() => consentReads()).toBeGreaterThan(before);
  });

  test("a pull that came back with nothing stored is never shown as a finished pull", async ({ page }) => {
    await openPulls(page, {
      pull: (route) => json(route, { ok: false, code: "no_reports", error: "no_reports" }, 502),
    });
    await page.locator("#ccp-pull-tu").click();
    await expect(page.locator("#ccp-pull-status")).toContainText("The bureau was asked and sent nothing back.");
    await expect(page.locator("#ccp-pull-status")).not.toContainText("pull finished");
  });

  test("with no consent on file the three buttons are off with the reason on them, and a press sends nothing", async ({ page }) => {
    const { pulls } = await openPulls(page, {
      consent: { ok: true, status: { valid: false, reason: "revoked" }, identity: { on_file: true }, approval_link: null },
    });
    await expect(page.locator("#ccp-consent-state")).toContainText("This client took their permission back. Do not pull.");
    for (const [, selector] of BUTTONS) {
      await expect(page.locator(selector)).toBeDisabled();
      await expect(page.locator(selector)).toHaveAttribute("title", /took their permission back/);
    }
    await page.locator("#ccp-pull-eq").click({ force: true });
    expect(pulls).toEqual([]);
  });

  test("when consent cannot be checked the buttons stay on and say so", async ({ page }) => {
    await openPulls(page, { consent: { ok: false, error: "boom" }, consentStatus: 500 });
    await expect(page.locator("#ccp-consent-state")).toContainText("Could not check consent from this screen.");
    for (const [, selector] of BUTTONS) await expect(page.locator(selector)).toBeEnabled();
  });

  test("with no client open the buttons are off and nothing is sent", async ({ page }) => {
    const { pulls } = await openPulls(page, { query: "" });
    for (const [, selector] of BUTTONS) await expect(page.locator(selector)).toBeDisabled();
    expect(pulls).toEqual([]);
  });
});

/* ── Declines: Save outcome ─────────────────────────────────────────────── */

const DECLINE = {
  id: "dec0001", bank: "Chase", product: "Ink Business", declined_on: "2026-09-20", bureaus_pulled: ["experian"],
  source: "staff", recorded_by: "Jordan", looks_like_words: "A denial for too many inquiries",
  outcome: "open", outcome_words: "Still working it", outcome_approved_amount: null, reapply_on: null,
  reasons: [], steps: [], timing: {}, letter_phones: [], book: null, rm_on_file: false, recon_on: null,
  letter_text: null, letter_document_id: null, needs_person: false, unknown_parts: [],
};

async function openDeclines(page, { answer, loadAfter, declines = [DECLINE] } = {}) {
  const posts = [];
  let reads = 0;
  await openScreen(page, `/app/client-control-panel.html?client_id=${CLIENT_ID}`, OWNER, {
    "/api/consent/capture": CONSENT_OK,
    "/api/blueprint/declines": async (route, { method }) => {
      if (method === "POST") {
        posts.push(JSON.parse(route.request().postData() || "{}"));
        return answer ? answer(route, posts.length) : json(route, { ok: true, outcome: "approved_on_recon", outcome_words: "Approved on reconsideration", application_status: "Approved" });
      }
      reads += 1;
      const list = reads > 1 && loadAfter ? [loadAfter, ...declines.slice(1)] : declines;
      return json(route, { ok: true, staff: { eligible: true, declines: list, applications: [], bank_emails: [], next_sequence_notes: [] } });
    },
  });
  await page.locator("#bp-group .group-title.tog").click();
  await expect(page.locator(".dec-item")).toHaveCount(declines.length);
  await expect(page.locator(".dec-item").first()).toHaveAttribute("open", "");
  return { posts, reads: () => reads };
}

const item = (page) => page.locator('.dec-item[data-decline="dec0001"]');
const save = (page) => item(page).locator('[data-act="outcome"]');

test.describe("client control panel: Declines, Save outcome", () => {
  test("Save outcome sends the chosen outcome, the amount, the re-apply day and the notes for that decline", async ({ page }) => {
    const { posts } = await openDeclines(page);
    await item(page).locator('[data-field="outcome"]').selectOption("approved_on_recon");
    await item(page).locator('[data-field="amount"]').fill("25,000");
    await item(page).locator('[data-field="notes"]').fill("Banker said yes on the phone");
    await save(page).click();
    await expect.poll(() => posts.length).toBe(1);
    expect(posts[0]).toEqual({
      action: "outcome", client_id: CLIENT_ID, decline_id: "dec0001",
      outcome: "approved_on_recon", approved_amount: "25,000", reapply_on: null, notes: "Banker said yes on the phone",
    });
    await expect(page.locator("#bp-declines-root")).toContainText("Outcome saved: Approved on reconsideration. The application now says Approved.");
  });

  test("the file is read again after the save and paints what the server now holds", async ({ page }) => {
    const { reads } = await openDeclines(page, {
      loadAfter: { ...DECLINE, outcome: "approved_on_recon", outcome_words: "Approved on reconsideration", outcome_approved_amount: 25000 },
    });
    await item(page).locator('[data-field="outcome"]').selectOption("approved_on_recon");
    await item(page).locator('[data-field="amount"]').fill("25000");
    await save(page).click();
    await expect.poll(() => reads()).toBe(2);
    await expect(item(page).locator(".consent-state")).toHaveText("Approved on reconsideration — $25,000");
  });

  test("blank amount, day and notes are sent as null, never as empty strings", async ({ page }) => {
    const { posts } = await openDeclines(page);
    await item(page).locator('[data-field="outcome"]').selectOption("still_declined");
    await save(page).click();
    await expect.poll(() => posts.length).toBe(1);
    expect(posts[0].approved_amount).toBe(null);
    expect(posts[0].reapply_on).toBe(null);
    expect(posts[0].notes).toBe(null);
    expect(posts[0].outcome).toBe("still_declined");
  });

  test("Re-apply later with no day typed asks for the day and sends nothing", async ({ page }) => {
    const { posts } = await openDeclines(page);
    await item(page).locator('[data-field="outcome"]').selectOption("reapply_later");
    await save(page).click();
    await expect(item(page).locator('[data-slot="status"]')).toHaveText("Pick the day to apply again.");
    expect(posts).toEqual([]);
  });

  test("Re-apply later with a day sends that day", async ({ page }) => {
    const { posts } = await openDeclines(page);
    await item(page).locator('[data-field="outcome"]').selectOption("reapply_later");
    await item(page).locator('[data-field="reapply"]').fill("2027-01-15");
    await save(page).click();
    await expect.poll(() => posts.length).toBe(1);
    expect(posts[0].outcome).toBe("reapply_later");
    expect(posts[0].reapply_on).toBe("2027-01-15");
  });

  test("a client who did not buy the Blueprint is told so, and the button comes back", async ({ page }) => {
    await openDeclines(page, { answer: (route) => json(route, { ok: false, error: "not_blueprint_buyer" }, 403) });
    await item(page).locator('[data-field="outcome"]').selectOption("still_declined");
    await save(page).click();
    await expect(item(page).locator('[data-slot="status"]')).toContainText("This client has not paid for the Capital Blueprint");
    await expect(save(page)).toBeEnabled();
    await expect(save(page)).toContainText("Save outcome");
  });

  test("a refusal with its own sentence shows that sentence", async ({ page }) => {
    await openDeclines(page, { answer: (route) => json(route, { ok: false, error: "bad", message: "That amount is not a number." }, 400) });
    await item(page).locator('[data-field="outcome"]').selectOption("approved_on_recon");
    await item(page).locator('[data-field="amount"]').fill("abc");
    await save(page).click();
    await expect(item(page).locator('[data-slot="status"]')).toHaveText("That amount is not a number.");
  });
});

/* ── Repair cycle 1: the holes an independent checker found ───────────────── */

const DECLINE_2 = { ...DECLINE, id: "dec0002", bank: "Capital One", product: "Spark Business", declined_on: "2026-09-25", outcome: "open" };
const itemOf = (page, id) => page.locator(`.dec-item[data-decline="${id}"]`);

test.describe("client control panel: Declines, Save outcome on a file with two declines", () => {
  async function openTwo(page, opts = {}) {
    const ctx = await openDeclines(page, { ...opts, declines: [DECLINE, DECLINE_2] });
    // The first decline is open; open the second one too.
    await itemOf(page, "dec0002").locator("summary").click();
    await expect(itemOf(page, "dec0002")).toHaveAttribute("open", "");
    return ctx;
  }

  test("Save outcome on the second decline sends the second decline's id and the values typed in the second", async ({ page }) => {
    const { posts } = await openTwo(page);
    await itemOf(page, "dec0001").locator('[data-field="outcome"]').selectOption("still_declined");
    await itemOf(page, "dec0001").locator('[data-field="amount"]').fill("111");
    await itemOf(page, "dec0001").locator('[data-field="notes"]').fill("first bank note");
    await itemOf(page, "dec0002").locator('[data-field="outcome"]').selectOption("approved_on_recon");
    await itemOf(page, "dec0002").locator('[data-field="amount"]').fill("25,000");
    await itemOf(page, "dec0002").locator('[data-field="notes"]').fill("second bank note");
    await itemOf(page, "dec0002").locator('[data-act="outcome"]').click();
    await expect.poll(() => posts.length).toBe(1);
    expect(posts[0]).toEqual({
      action: "outcome", client_id: CLIENT_ID, decline_id: "dec0002",
      outcome: "approved_on_recon", approved_amount: "25,000", reapply_on: null, notes: "second bank note",
    });
  });

  test("Save outcome on the first decline sends the first decline's id and its own values, whatever is typed in the second", async ({ page }) => {
    const { posts } = await openTwo(page);
    await itemOf(page, "dec0002").locator('[data-field="outcome"]').selectOption("approved_on_recon");
    await itemOf(page, "dec0002").locator('[data-field="amount"]').fill("99,000");
    await itemOf(page, "dec0001").locator('[data-field="outcome"]').selectOption("still_declined");
    await itemOf(page, "dec0001").locator('[data-field="notes"]').fill("first bank note");
    await itemOf(page, "dec0001").locator('[data-act="outcome"]').click();
    await expect.poll(() => posts.length).toBe(1);
    expect(posts[0].decline_id).toBe("dec0001");
    expect(posts[0].outcome).toBe("still_declined");
    expect(posts[0].approved_amount).toBe(null);
    expect(posts[0].notes).toBe("first bank note");
  });
});

test.describe("client control panel: Declines, Save outcome is one write and trusts only an ok answer", () => {
  test("a second press while it is saving sends nothing: one write, the button off and saying Saving", async ({ page }) => {
    let release;
    const held = new Promise((resolve) => { release = resolve; });
    const { posts } = await openDeclines(page, {
      answer: async (route) => { await held; return json(route, { ok: true, outcome: "still_declined", outcome_words: "Still declined", application_status: null }); },
    });
    await item(page).locator('[data-field="outcome"]').selectOption("still_declined");
    await save(page).click();
    await expect.poll(() => posts.length).toBe(1);
    await expect(save(page)).toBeDisabled();
    await expect(save(page)).toContainText("Saving…");
    await save(page).click({ force: true });
    await page.waitForTimeout(250);
    expect(posts).toHaveLength(1);
    release();
    await expect(page.locator("#bp-declines-root")).toContainText("Outcome saved: Still declined.");
    expect(posts).toHaveLength(1);
  });

  test("the amount and the notes are trimmed before they are sent", async ({ page }) => {
    const { posts } = await openDeclines(page);
    await item(page).locator('[data-field="outcome"]').selectOption("approved_on_recon");
    await item(page).locator('[data-field="amount"]').fill("   25,000   ");
    await item(page).locator('[data-field="notes"]').fill("   said yes   ");
    await save(page).click();
    await expect.poll(() => posts.length).toBe(1);
    expect(posts[0].approved_amount).toBe("25,000");
    expect(posts[0].notes).toBe("said yes");
  });

  test("an amount of spaces only is sent as null, never as an empty string", async ({ page }) => {
    const { posts } = await openDeclines(page);
    await item(page).locator('[data-field="outcome"]').selectOption("still_declined");
    await item(page).locator('[data-field="amount"]').fill("     ");
    await save(page).click();
    await expect.poll(() => posts.length).toBe(1);
    expect(posts[0].approved_amount).toBe(null);
  });

  test("an answer with a good status but no ok is a refusal: it is said, and never shown as Outcome saved", async ({ page }) => {
    await openDeclines(page, { answer: (route) => json(route, { ok: false, error: "not_saved", message: "The outcome was not written." }, 200) });
    await item(page).locator('[data-field="outcome"]').selectOption("approved_on_recon");
    await save(page).click();
    await expect(item(page).locator('[data-slot="status"]')).toHaveText("The outcome was not written.");
    await expect(page.locator("#bp-declines-root")).not.toContainText("Outcome saved");
    await expect(save(page)).toBeEnabled();
  });

  test("an answer with a good status and an empty body is a refusal too, in plain words", async ({ page }) => {
    await openDeclines(page, { answer: (route) => json(route, {}, 200) });
    await item(page).locator('[data-field="outcome"]').selectOption("approved_on_recon");
    await save(page).click();
    await expect(item(page).locator('[data-slot="status"]')).toHaveText("That did not work. Try again in a moment.");
    await expect(page.locator("#bp-declines-root")).not.toContainText("Outcome saved");
  });
});

/* ── the three bureau buttons, each pressed for its own bureau ────────────── */

const CONSENT_SENTENCES = {
  none_on_file: "No consent on file. This client has to agree before a bureau can be asked.",
  expired: "The consent on file has run out. Record a new one before pulling.",
  not_yet_effective: "The consent on file starts at a later date, so a pull is not allowed yet.",
};

test.describe("client control panel: bureau pull buttons, failures, double press, every consent state", () => {
  for (const [name, selector, code, label] of BUTTONS) {
    test(`${name}: a failure that carries no code is said as could not pull, never as finished`, async ({ page }) => {
      const { pulls } = await openPulls(page, { pull: (route) => json(route, { ok: false, error: "upstream_error" }, 502) });
      await page.locator(selector).click();
      await expect.poll(() => pulls.length).toBe(1);
      expect(pulls[0]).toEqual({ client_id: CLIENT_ID, bureau: code });
      await expect(page.locator("#ccp-pull-status")).toHaveText(`Could not pull ${label}.`);
      await expect(page.locator("#ccp-pull-status")).not.toContainText("pull finished");
      await expect(page.locator(selector)).toBeEnabled();
    });

    test(`${name}: a second press while it is pulling sends nothing, so a paid pull is never ordered twice`, async ({ page }) => {
      let release;
      const held = new Promise((resolve) => { release = resolve; });
      const { pulls } = await openPulls(page, {
        pull: async (route) => { await held; return json(route, { ok: true, stored: true }); },
      });
      await page.locator(selector).click();
      await expect.poll(() => pulls.length).toBe(1);
      await expect(page.locator(selector)).toBeDisabled();
      await expect(page.locator("#ccp-pull-status")).toHaveText(`Pulling ${label}…`);
      await page.locator(selector).click({ force: true });
      await page.waitForTimeout(250);
      expect(pulls).toHaveLength(1);
      release();
      await expect(page.locator("#ccp-pull-status")).toHaveText(`${label} pull finished. Refresh the file to see the stored report.`);
      await expect(page.locator(selector)).toBeEnabled();
      expect(pulls).toHaveLength(1);
    });

    test(`${name}: when the pull service cannot be reached it says so and the button comes back`, async ({ page }) => {
      await openPulls(page, { pull: (route) => route.abort("connectionreset") });
      await page.locator(selector).click();
      await expect(page.locator("#ccp-pull-status")).toHaveText("Could not reach the pull service.");
      await expect(page.locator(selector)).toBeEnabled();
    });

    test(`${name}: a refusal for a missing identity is said with its code, and the pull is not finished`, async ({ page }) => {
      const { pulls } = await openPulls(page, {
        pull: (route) => json(route, { ok: false, code: "identity_required", error: "identity_required" }, 422),
      });
      await page.locator(selector).click();
      await expect.poll(() => pulls.length).toBe(1);
      expect(pulls[0].bureau).toBe(code);
      await expect(page.locator("#ccp-pull-status")).toContainText("No identity on file for this client");
      await expect(page.locator("#ccp-pull-status")).toContainText("[identity_required]");
      await expect(page.locator("#ccp-pull-status")).not.toContainText("pull finished");
      await expect(page.locator(selector)).toBeEnabled();
    });
  }

  for (const [reason, sentence] of Object.entries(CONSENT_SENTENCES)) {
    test(`with consent state ${reason} the three buttons are off with that sentence on them, and a press sends nothing`, async ({ page }) => {
      const { pulls } = await openPulls(page, {
        consent: { ok: true, status: { valid: false, reason }, identity: { on_file: true }, approval_link: null },
      });
      await expect(page.locator("#ccp-consent-state")).toHaveText(sentence);
      await expect(page.locator("#ccp-consent-state")).not.toContainText("Consent is on file");
      for (const [, selector] of BUTTONS) {
        await expect(page.locator(selector)).toBeDisabled();
        await expect(page.locator(selector)).toHaveAttribute("title", sentence);
      }
      for (const [, selector] of BUTTONS) await page.locator(selector).click({ force: true });
      expect(pulls).toEqual([]);
    });
  }

  test("a reason the page does not know still turns the three buttons off, with a plain sentence", async ({ page }) => {
    const { pulls } = await openPulls(page, {
      consent: { ok: true, status: { valid: false, reason: "something_new" }, identity: { on_file: true }, approval_link: null },
    });
    await expect(page.locator("#ccp-consent-state")).toHaveText("There is no usable consent on file for this client.");
    for (const [, selector] of BUTTONS) await expect(page.locator(selector)).toBeDisabled();
    expect(pulls).toEqual([]);
  });
});
