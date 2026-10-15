// Practice test (real page in Chromium, fake /api answers) for thirteen Lenders desk controls in batch 14:
// the six list filters, Apply filters, Export CSV, Import CSV and Cancel, the seven inline cells, the row
// Save button, Add bureau row and the seven bureau config fields.
//
// The expected requests and words are worked out in this file from the fake data, not copied from the
// page. It reads no live data. Each row is claimed only inside the callback that asserts it.

import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import { bodyOf, json, OWNER, proofRows, sharedScreens, waitFor } from "./fin-b14-kit.mjs";

const proof = proofRows(import.meta.url);
const screens = sharedScreens();

const LENDER_ID = "bbbbbbbb-1111-4111-8111-111111111111";
const TABLES = ["OnlineBizCC", "InBranchBizCC", "BizLOC_Stated", "BizLOC_Documented", "PersonalCC", "PersonalLoans", "PersonalLOC"];
const LENDER = {
  id: LENDER_ID, name: "Mesa Community Bank", lender_table: "OnlineBizCC", bureaus_pulled: "EX",
  stated_requirements: "Two years in business", priority_tier: 1, active: true, eligible_states: "AZ",
  application_url: "https://bank.example/apply/mesa", last_updated_by: "Casey Reed", last_updated_date: "2026-10-01",
};
const CSV = "lender_table,name,priority_tier\nOnlineBizCC,Mesa Community Bank,2\n";

/** Open the Lenders desk with fake answers. Everything the page sends is logged on `seen`. */
async function openLenders({ lenders = [LENDER], bureau = [], saveAnswer = null, bureauAnswer = null } = {}) {
  const seen = { lists: [], exports: [], posts: [], bureauPosts: [], bureauReads: 0 };
  const handlers = {
    "/api/read/lenders": async (route, { url }) => {
      const u = new URL(url);
      if (u.searchParams.get("format") === "csv") {
        seen.exports.push(u.search);
        return route.fulfill({ status: 200, contentType: "text/csv; charset=utf-8", body: CSV });
      }
      seen.lists.push(u.search);
      const rows = typeof lenders === "function" ? lenders(Object.fromEntries(u.searchParams)) : lenders;
      return json(route, { ok: true, lenders: rows, meta: { count: rows.length } });
    },
    "/api/read/lender-observations": { ok: true, observations: [] },
    "/api/read/ai-bureau-config": async (route) => {
      seen.bureauReads += 1;
      return json(route, { ok: true, configs: bureau });
    },
    "/api/lenders": async (route) => {
      const body = bodyOf(route);
      seen.posts.push(body);
      return json(route, saveAnswer ? saveAnswer(body) : { ok: true, lender: { ...LENDER, ...(body.patch || {}), last_updated_by: "Jordan Blake", last_updated_date: "2026-10-14" } });
    },
    "/api/ai-bureau-config": async (route) => {
      seen.bureauPosts.push(bodyOf(route));
      return json(route, bureauAnswer ? bureauAnswer(seen.bureauPosts.at(-1)) : { ok: true });
    },
  };
  const { page, errors } = await screens.open("/app/lenders.html", { session: OWNER, handlers });
  await waitFor(() => seen.lists.length >= 1, "the first list read");
  await page.waitForSelector("#lenderBody tr, #lenderEmpty:not(.hide)");
  return { page, errors, seen };
}

const asObject = (search) => Object.fromEntries(new URLSearchParams(search));

/** Press Apply filters and return the query the page sent for it. */
async function applyFilters(page, seen) {
  const before = seen.lists.length;
  await page.locator("#btnFilter").click();
  await waitFor(() => seen.lists.length === before + 1, "the list read after Apply filters");
  return asObject(seen.lists.at(-1));
}

test("list filters: each box sends its own name and only its own, trimmed; empty boxes send nothing", { timeout: 90_000 }, async () => {
  const { page, seen, errors } = await openLenders();
  assert.equal(seen.lists[0], "", "the first read has no filter at all");

  await proof.check(/^List filter: Product table select/, async () => {
    const options = await page.locator("#fTable option").evaluateAll((list) => list.map((o) => o.value));
    assert.deepEqual(options, ["", ...TABLES], "All, then the seven product tables, in order");
    await page.locator("#fTable").selectOption("BizLOC_Stated");
    assert.deepEqual(await applyFilters(page, seen), { lender_table: "BizLOC_Stated" });
    await page.locator("#fTable").selectOption("");
    assert.deepEqual(await applyFilters(page, seen), {});
  });

  await proof.check(/^List filter: Bureau pulled input/, async () => {
    assert.equal(await page.locator("#fBureau").getAttribute("placeholder"), "EX / EQ / TU");
    const hints = await page.locator("#bureauHints option").evaluateAll((list) => list.map((o) => o.value));
    assert.deepEqual(hints, ["EX", "EQ", "TU"]);
    await page.locator("#fBureau").fill("  TU  ");
    assert.deepEqual(await applyFilters(page, seen), { bureau: "TU" });
    await page.locator("#fBureau").fill("");
    assert.deepEqual(await applyFilters(page, seen), {});
  });

  await proof.check(/^List filter: Priority tier select/, async () => {
    const options = await page.locator("#fTier option").evaluateAll((list) => list.map((o) => o.value || o.textContent));
    assert.deepEqual(options, ["All", "1", "2", "3"]);
    await page.locator("#fTier").selectOption("2");
    assert.deepEqual(await applyFilters(page, seen), { priority_tier: "2" });
    await page.locator("#fTier").selectOption({ label: "All" });
    assert.deepEqual(await applyFilters(page, seen), {});
  });

  await proof.check(/^List filter: Status select/, async () => {
    const options = await page.locator("#fActive option").evaluateAll((list) => list.map((o) => [o.value, o.textContent]));
    assert.deepEqual(options, [["", "All"], ["true", "Active"], ["false", "Inactive"]]);
    await page.locator("#fActive").selectOption("false");
    assert.deepEqual(await applyFilters(page, seen), { active: "false" });
    await page.locator("#fActive").selectOption("true");
    assert.deepEqual(await applyFilters(page, seen), { active: "true" });
    await page.locator("#fActive").selectOption("");
    assert.deepEqual(await applyFilters(page, seen), {});
  });

  await proof.check(/^List filter: Eligible state input/, async () => {
    assert.equal(await page.locator("#fState").getAttribute("maxlength"), "40");
    await page.locator("#fState").fill(" NV ");
    assert.deepEqual(await applyFilters(page, seen), { state: "NV" });
    await page.locator("#fState").fill("");
    assert.deepEqual(await applyFilters(page, seen), {});
  });

  await proof.check(/^List filter: Name search input/, async () => {
    await page.locator("#fQ").fill("  Community ");
    assert.deepEqual(await applyFilters(page, seen), { q: "Community" });
    await page.locator("#fQ").fill("");
    assert.deepEqual(await applyFilters(page, seen), {});
  });
  assert.deepEqual(errors, []);
  await page.close();
});

test("Apply filters: one read with every box, and the table is drawn again from the answer", { timeout: 60_000 }, async () => {
  const { page, seen, errors } = await openLenders({
    lenders: (query) => (query.q === "Nothing" ? [] : [LENDER, { ...LENDER, id: "bbbbbbbb-2222-4222-8222-222222222222", name: "Desert First Bank" }]),
  });
  await proof.check("Apply filters button", async () => {
    assert.equal(await page.locator("#lenderBody tr").count(), 2);
    assert.equal(await page.locator("#listMeta").textContent(), "2 lenders");
    await page.locator("#fTable").selectOption("PersonalCC");
    await page.locator("#fBureau").fill("EQ");
    await page.locator("#fTier").selectOption("3");
    await page.locator("#fActive").selectOption("true");
    await page.locator("#fState").fill("AZ");
    await page.locator("#fQ").fill("Mesa");
    const before = seen.lists.length;
    const sent = await applyFilters(page, seen);
    assert.equal(seen.lists.length, before + 1, "exactly one read for one press");
    assert.deepEqual(sent, { lender_table: "PersonalCC", bureau: "EQ", priority_tier: "3", active: "true", state: "AZ", q: "Mesa" });
    assert.equal(await page.locator("#lenderBody tr").count(), 2, "the rows come from the answer");

    // An answer with nothing in it: the empty words and the empty banner show.
    await page.locator("#fQ").fill("Nothing");
    await applyFilters(page, seen);
    await waitFor(async () => (await page.locator("#lenderBody tr").count()) === 0, "the table emptied");
    assert.equal(await page.locator("#listMeta").textContent(), "Empty — import from the spreadsheet");
    assert.equal(await page.locator("#lenderEmpty").isVisible(), true);
    assert.equal(await page.locator("#emptyBanner").isVisible(), true);
  });
  assert.deepEqual(errors, []);
  await page.close();
});

test("Export CSV: asks for the csv of the boxes as they are now (no Apply needed) and saves lenders.csv", { timeout: 60_000 }, async () => {
  const { page, seen, errors } = await openLenders();
  await proof.check(/^Export CSV button/, async () => {
    await page.locator("#fTier").selectOption("2");
    await page.locator("#fQ").fill(" Mesa ");
    const listReads = seen.lists.length;
    const [download] = await Promise.all([page.waitForEvent("download"), page.locator("#btnExport").click()]);
    assert.equal(download.suggestedFilename(), "lenders.csv");
    assert.equal(fs.readFileSync(await download.path(), "utf8"), CSV, "the file is exactly the csv the server sent");
    assert.equal(seen.exports.length, 1);
    assert.deepEqual(asObject(seen.exports[0]), { priority_tier: "2", q: "Mesa", format: "csv" });
    assert.equal(seen.lists.length, listReads, "exporting does not redraw the table");
  });
  assert.deepEqual(errors, []);
  await page.close();
});

test("Import CSV opens the paste box, Cancel puts it away and sends nothing", { timeout: 60_000 }, async () => {
  const { page, seen, errors } = await openLenders();
  await proof.check(/^Import CSV button \(opens paste box\) and Cancel button/, async () => {
    const box = page.locator("#importBox");
    assert.equal(await box.isVisible(), false, "the paste box starts closed");
    await page.locator("#btnImportToggle").click();
    assert.equal(await box.isVisible(), true);
    assert.equal(await page.locator("#importCsv").isVisible(), true);
    assert.equal(await page.locator("#btnImportRun").isVisible(), true);
    // The same button closes it again.
    await page.locator("#btnImportToggle").click();
    assert.equal(await box.isVisible(), false);
    await page.locator("#btnImportToggle").click();
    await page.locator("#importCsv").fill("lender_table,name\nOnlineBizCC,Test Bank");
    await page.locator("#btnImportCancel").click();
    assert.equal(await box.isVisible(), false);
    assert.equal(seen.posts.length, 0, "opening and cancelling send nothing");
  });
  assert.deepEqual(errors, []);
  await page.close();
});

test("a lender row: seven cells that mark themselves changed, and Save sends exactly those seven", { timeout: 60_000 }, async () => {
  const { page, seen, errors } = await openLenders();
  const row = page.locator("#lenderBody tr").first();
  const fields = ["name", "lender_table", "bureaus_pulled", "stated_requirements", "priority_tier", "active", "eligible_states"];

  await proof.check(/^Lender row inline cells/, async () => {
    const present = await row.locator("[data-f]").evaluateAll((list) => list.map((el) => el.getAttribute("data-f")));
    assert.deepEqual(present, fields, "the seven editable cells, in this order");
    assert.equal(await row.locator('[data-f="name"]').inputValue(), "Mesa Community Bank");
    assert.equal(await row.locator('[data-f="lender_table"]').inputValue(), "OnlineBizCC");
    assert.equal(await row.locator('[data-f="bureaus_pulled"]').inputValue(), "EX");
    assert.equal(await row.locator('[data-f="stated_requirements"]').inputValue(), "Two years in business");
    assert.equal(await row.locator('[data-f="priority_tier"]').inputValue(), "1");
    assert.equal(await row.locator('[data-f="active"]').inputValue(), "true");
    assert.equal(await row.locator('[data-f="eligible_states"]').inputValue(), "AZ");
    assert.equal(await row.locator("[data-f].dirty").count(), 0, "nothing is marked until it is touched");
    await row.locator('[data-f="name"]').fill("Mesa Community Bank 2");
    await row.locator('[data-f="lender_table"]').selectOption("PersonalCC");
    await row.locator('[data-f="bureaus_pulled"]').fill("EX/TU");
    await row.locator('[data-f="stated_requirements"]').fill("");
    await row.locator('[data-f="priority_tier"]').selectOption("3");
    await row.locator('[data-f="active"]').selectOption("false");
    await row.locator('[data-f="eligible_states"]').fill("AZ, NV");
    const dirty = await row.locator("[data-f].dirty").evaluateAll((list) => list.map((el) => el.getAttribute("data-f")));
    assert.deepEqual(dirty, fields, "all seven cells show as changed");
    assert.equal(seen.posts.length, 0, "typing in a cell sends nothing until Save");
  });

  await proof.check(/^Lender row Save button/, async () => {
    await row.locator(".save-btn").click();
    await waitFor(() => seen.posts.length === 1, "the save request");
    assert.deepEqual(seen.posts[0], {
      action: "save",
      id: LENDER_ID,
      patch: {
        name: "Mesa Community Bank 2", lender_table: "PersonalCC", bureaus_pulled: "EX/TU", stated_requirements: null,
        priority_tier: 3, active: false, eligible_states: "AZ, NV",
      },
    });
    await waitFor(async () => (await page.locator("#toast").textContent()) === "Saved", "the Saved toast");
    // The row is drawn again from the saved row the server sent back, with who and when.
    const updated = page.locator("#lenderBody tr").first();
    await waitFor(async () => (await updated.locator('[data-f="name"]').inputValue()) === "Mesa Community Bank 2", "the saved name");
    assert.match(await updated.locator("td").nth(8).innerText(), /Jordan Blake\s+2026-10-14/);
    assert.equal(await updated.locator("[data-f].dirty").count(), 0, "a saved row is no longer marked changed");
  });
  assert.deepEqual(errors, []);
  await page.close();

  // A refused save says why and leaves the typed cells where they are.
  const refused = await openLenders({ saveAnswer: () => ({ ok: false, error: "name_required", message: "Name is required." }) });
  const cell = refused.page.locator('#lenderBody tr [data-f="name"]').first();
  await cell.fill("Typed Name");
  await refused.page.locator("#lenderBody .save-btn").first().click();
  await waitFor(async () => (await refused.page.locator("#toast").textContent()) === "Name is required.", "the refusal words");
  assert.equal(await cell.inputValue(), "Typed Name");
  assert.equal(await cell.evaluate((el) => el.classList.contains("dirty")), true);
  await refused.page.close();
});

test("AI bureau config: Add bureau row adds one empty editable row; its seven fields go out as typed", { timeout: 60_000 }, async () => {
  const existing = {
    id: "dddddddd-1111-4111-8111-111111111111", bureau_code: "EX", bureau_name: "Experian", service_number: "+18885551212",
    ivr_version: "v2", menu_path: "1,3,2", expected_hold_minutes: 12, active: true,
  };
  const { page, seen, errors } = await openLenders({ bureau: [existing] });
  await page.locator('[data-tab="bureau"]').click();
  await page.waitForSelector("#bureauBody tr");
  const fields = ["bureau_code", "bureau_name", "service_number", "ivr_version", "menu_path", "expected_hold_minutes", "active"];

  await proof.check(/^AI bureau config: Add bureau row button/, async () => {
    assert.equal(await page.locator("#bureauBody tr").count(), 1);
    await page.locator("#btnAddBureau").click();
    assert.equal(await page.locator("#bureauBody tr").count(), 2, "one more row, not two");
    const added = page.locator("#bureauBody tr").last();
    for (const field of fields.slice(0, -1)) assert.equal(await added.locator(`[data-f="${field}"]`).inputValue(), "", `${field} starts empty`);
    assert.equal(await added.locator('[data-f="active"]').inputValue(), "true", "a new row starts Active");
    assert.equal(await page.locator("#bureauEmpty").isVisible(), false);
    assert.equal(seen.bureauPosts.length, 0, "adding a row sends nothing");
    assert.equal(seen.bureauReads, 1, "adding a row does not read the config again");
  });

  await proof.check(/^AI bureau config row: 7 fields/, async () => {
    const added = page.locator("#bureauBody tr").last();
    const present = await added.locator("[data-f]").evaluateAll((list) => list.map((el) => el.getAttribute("data-f")));
    assert.deepEqual(present, fields);
    assert.equal(await added.locator('[data-f="bureau_code"]').getAttribute("maxlength"), "8");
    await added.locator('[data-f="bureau_code"]').fill("EQ");
    await added.locator('[data-f="bureau_name"]').fill("Equifax");
    await added.locator('[data-f="service_number"]').fill("+18005550100");
    await added.locator('[data-f="ivr_version"]').fill("v5");
    await added.locator('[data-f="menu_path"]').fill("2,1,4");
    await added.locator('[data-f="expected_hold_minutes"]').fill("25");
    await added.locator('[data-f="active"]').selectOption("false");
    await added.locator(".save-bureau").click();
    await waitFor(() => seen.bureauPosts.length === 1, "the bureau save request");
    assert.deepEqual(seen.bureauPosts[0], {
      action: "upsert", bureau_code: "EQ", bureau_name: "Equifax", service_number: "+18005550100", ivr_version: "v5",
      menu_path: "2,1,4", expected_hold_minutes: 25, active: false,
    });
    // A saved row is read again; a blank box goes out as null, never as "" or 0.
    await waitFor(() => seen.bureauReads === 2, "the config read again after Save");
    const first = page.locator("#bureauBody tr").first();
    await first.locator('[data-f="menu_path"]').fill("");
    await first.locator('[data-f="expected_hold_minutes"]').fill("");
    await first.locator(".save-bureau").click();
    await waitFor(() => seen.bureauPosts.length === 2, "the second bureau save request");
    assert.deepEqual(seen.bureauPosts[1], {
      action: "save", id: existing.id,
      patch: {
        bureau_code: "EX", bureau_name: "Experian", service_number: "+18885551212", ivr_version: "v2", menu_path: null,
        expected_hold_minutes: null, active: true,
      },
    });
  });
  assert.deepEqual(errors, []);
  await page.close();
});

test("every listed row was exercised", () => {
  proof.assertAllClaimed();
});
