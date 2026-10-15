// Practice test (real page in Chromium, fake /api answers) for the Lenders desk controls in batch 14: the six
// list filters, Apply filters (list view and the view opened from a client), Export CSV, Import CSV, Cancel and
// Import now, the seven inline cells, the row Save button, Add bureau row, the seven bureau config fields, and
// the mismatch queue's Confirm and Corrected buttons.
//
// The expected requests and words are worked out in this file from the fake data, not copied from the
// page. It reads no live data. Each row is claimed only inside the callback that asserts it. A test whose
// name starts KNOWN BREAK pins what the page does today for a control that is left out of the catalog (see
// fin-b14-not-attachable.mjs); it goes red the moment the page is fixed, and says to attach the row.

import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import { bodyOf, json, OWNER, proofRows, sharedScreens, waitFor } from "./fin-b14-kit.mjs";

const proof = proofRows(import.meta.url);
const screens = sharedScreens();

const LENDER_ID = "bbbbbbbb-1111-4111-8111-111111111111";
const LENDER2_ID = "bbbbbbbb-2222-4222-8222-222222222222";
const CLIENT_ID = "aaaaaaaa-1111-4111-8111-111111111111";
const TABLES = ["OnlineBizCC", "InBranchBizCC", "BizLOC_Stated", "BizLOC_Documented", "PersonalCC", "PersonalLoans", "PersonalLOC"];
const LENDER = {
  id: LENDER_ID, name: "Mesa Community Bank", lender_table: "OnlineBizCC", bureaus_pulled: "EX",
  stated_requirements: "Two years in business", priority_tier: 1, active: true, eligible_states: "AZ",
  application_url: "https://bank.example/apply/mesa", last_updated_by: "Casey Reed", last_updated_date: "2026-10-01",
};
const LENDER2 = {
  id: LENDER2_ID, name: "Desert First Bank", lender_table: "PersonalCC", bureaus_pulled: "EQ/TU",
  stated_requirements: "Six months open", priority_tier: 2, active: false, eligible_states: "CA, NV",
  application_url: null, last_updated_by: "Casey Reed", last_updated_date: "2026-09-20",
};
// A lender with nothing filled in beyond its name and product table: what most of the legacy book looks like.
const BLANK_LENDER = {
  id: "bbbbbbbb-3333-4333-8333-333333333333", name: "Old Book Bank", lender_table: "PersonalLoans", bureaus_pulled: null,
  stated_requirements: null, priority_tier: null, active: null, eligible_states: null, application_url: null,
  last_updated_by: null, last_updated_date: null,
};
const CSV = "lender_table,name,priority_tier\nOnlineBizCC,Mesa Community Bank,2\n";

const OBS1 = {
  id: "cccccccc-1111-4111-8111-111111111111", lender_name: "Mesa Community Bank", lender_table: "OnlineBizCC",
  expected_bureaus_raw: "EX", observed_bureau: "TU", observation_source: "crs_pull", client_id: CLIENT_ID, notes: "Pulled TU on the call",
};
const OBS2 = {
  id: "cccccccc-2222-4222-8222-222222222222", lender_name: "Desert First Bank", lender_table: "PersonalCC",
  expected_bureaus_raw: "EQ/TU", observed_bureau: "EX", observation_source: "manual", client_id: null, notes: null,
};

/** Open the Lenders desk with fake answers. Everything the page sends is logged on `seen`. */
async function openLenders({
  lenders = [LENDER], bureau = [], saveAnswer = null, bureauAnswer = null, listAnswer = null, matches = [LENDER],
  observations = [], reviewAnswer = null, importAnswer = null, exportAnswer = null, search = "",
} = {}) {
  const seen = { lists: [], exports: [], posts: [], bureauPosts: [], bureauReads: 0, matches: [], queue: [], reviews: [], pending: [...observations] };
  const answer = (route, out) => route.fulfill({ status: out.status || 200, contentType: out.contentType || "application/json", body: typeof out.body === "string" ? out.body : JSON.stringify(out.body) });
  const handlers = {
    "/api/read/lenders": async (route, { url }) => {
      const u = new URL(url);
      if (u.searchParams.get("format") === "csv") {
        seen.exports.push(u.search);
        if (exportAnswer) return answer(route, await exportAnswer());
        return route.fulfill({ status: 200, contentType: "text/csv; charset=utf-8", body: CSV });
      }
      seen.lists.push(u.search);
      const query = Object.fromEntries(u.searchParams);
      if (listAnswer) {
        const out = await listAnswer(query, seen.lists.length);
        if (out === "abort") return route.abort();
        if (out) return answer(route, out);
      }
      const rows = typeof lenders === "function" ? lenders(query) : lenders;
      return json(route, { ok: true, lenders: rows, meta: { count: rows.length } });
    },
    "/api/read/lender-matches": async (route, { url }) => {
      seen.matches.push(new URL(url).search);
      return json(route, { ok: true, client_id: CLIENT_ID, match_count: matches.length, matches });
    },
    "/api/read/lender-observations": async (route, { url }) => {
      seen.queue.push(new URL(url).search);
      return json(route, { ok: true, observations: seen.pending });
    },
    "/api/lender-observations": async (route) => {
      const body = bodyOf(route);
      seen.reviews.push(body);
      const out = reviewAnswer ? await reviewAnswer(body) : { ok: true, observation: { id: body.id, review_status: body.review_status } };
      if (out.ok !== false) seen.pending = seen.pending.filter((o) => o.id !== body.id);
      return json(route, out);
    },
    "/api/read/ai-bureau-config": async (route) => {
      seen.bureauReads += 1;
      return json(route, { ok: true, configs: bureau });
    },
    "/api/lenders": async (route) => {
      const body = bodyOf(route);
      seen.posts.push(body);
      if (body.action === "import" && importAnswer) return answer(route, await importAnswer(body));
      if (saveAnswer) return json(route, saveAnswer(body));
      return json(route, { ok: true, lender: { ...LENDER, ...(body.patch || {}), id: body.id || LENDER_ID, last_updated_by: "Jordan Blake", last_updated_date: "2026-10-14" } });
    },
    "/api/ai-bureau-config": async (route) => {
      seen.bureauPosts.push(bodyOf(route));
      return json(route, bureauAnswer ? bureauAnswer(seen.bureauPosts.at(-1)) : { ok: true });
    },
  };
  const { page, errors } = await screens.open(`/app/lenders.html${search}`, { session: OWNER, handlers });
  await waitFor(() => (search ? seen.matches.length : seen.lists.length) >= 1, "the first list read");
  await page.waitForSelector("#lenderBody tr, #lenderEmpty:not(.hide)");
  return { page, errors, seen };
}

const asObject = (search) => Object.fromEntries(new URLSearchParams(search));
const toastOf = (page) => page.locator("#toast").textContent();

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

test("Apply filters: one read with every box, the table is drawn again from the answer, and a bad answer is said in words", { timeout: 90_000 }, async () => {
  const { page, seen, errors } = await openLenders({
    lenders: (query) => (query.q === "Nothing" ? [] : query.q === "One" ? [LENDER] : [LENDER, LENDER2]),
    listAnswer: async (query) => {
      if (query.q === "Refused") return { status: 403, body: { ok: false, error: "forbidden", message: "Only the owner, an admin or a funding advisor can see lenders." } };
      if (query.q === "Dropped") return "abort";
      return null;
    },
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

    // One lender is "1 lender", not "1 lenders".
    await page.locator("#fQ").fill("One");
    await applyFilters(page, seen);
    await waitFor(async () => (await page.locator("#lenderBody tr").count()) === 1, "one row");
    assert.equal(await page.locator("#listMeta").textContent(), "1 lender");

    // An answer with nothing in it: the empty words and the empty banner show.
    await page.locator("#fQ").fill("Nothing");
    await applyFilters(page, seen);
    await waitFor(async () => (await page.locator("#lenderBody tr").count()) === 0, "the table emptied");
    assert.equal(await page.locator("#listMeta").textContent(), "Empty — import from the spreadsheet");
    assert.equal(await page.locator("#lenderEmpty").isVisible(), true);
    assert.equal(await page.locator("#emptyBanner").isVisible(), true);

    // A refused read says why and leaves no stale rows behind.
    await page.locator("#fQ").fill("");
    await applyFilters(page, seen);
    await waitFor(async () => (await page.locator("#lenderBody tr").count()) === 2, "two rows back");
    await page.locator("#fQ").fill("Refused");
    await applyFilters(page, seen);
    await waitFor(async () => (await toastOf(page)) === "Only the owner, an admin or a funding advisor can see lenders.", "the refusal words");
    assert.equal(await page.locator("#lenderBody tr").count(), 0, "the old rows are not left on screen");
    // A read that never arrives says so in the same place.
    await page.locator("#fQ").fill("Dropped");
    await page.locator("#btnFilter").click();
    await waitFor(async () => (await page.locator("#listMeta").textContent()) === "Could not load (sign in?)", "the could-not-load words");
    assert.equal(await page.locator("#lenderBody tr").count(), 0);
  });
  assert.deepEqual(errors.filter((e) => !/Failed to fetch|NetworkError|net::/i.test(e)), []);
  await page.close();
});

test("Apply filters: the Loading words show while the read is on its way", { timeout: 60_000 }, async () => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const { page, seen, errors } = await openLenders({ listAnswer: async (query, n) => { if (n > 1) await gate; return null; } });
  await proof.check("Apply filters button", async () => {
    assert.equal(await page.locator("#listMeta").textContent(), "1 lender");
    await page.locator("#btnFilter").click();
    await waitFor(() => seen.lists.length === 2, "the second read");
    assert.equal(await page.locator("#listMeta").textContent(), "Loading…");
    release();
    await waitFor(async () => (await page.locator("#listMeta").textContent()) === "1 lender", "the answer");
  });
  assert.deepEqual(errors, []);
  await page.close();
});

test("Apply filters on the desk opened from a client: it reads that client's matches with the product table, and says how many fit", { timeout: 60_000 }, async () => {
  const noUrl = { ...LENDER, application_url: null };
  const { page, seen, errors } = await openLenders({ search: `?client_id=${CLIENT_ID}`, matches: [noUrl, { ...LENDER2, application_url: null }] });
  await proof.check("Apply filters button", async () => {
    assert.deepEqual(asObject(seen.matches[0]), { client_id: CLIENT_ID }, "the first read is this client's matches");
    assert.equal(seen.lists.length, 0, "the plain list is not read at all");
    assert.equal(await page.locator("#lenderBody tr").count(), 2);
    assert.equal(await page.locator("#listMeta").textContent(), "2 fit");
    assert.equal(await page.locator("#applyClientBanner").count(), 1);

    await page.locator("#fTable").selectOption("PersonalCC");
    const before = seen.matches.length;
    await page.locator("#btnFilter").click();
    await waitFor(() => seen.matches.length === before + 1, "the matches read after Apply filters");
    const sent = asObject(seen.matches.at(-1));
    assert.equal(sent.client_id, CLIENT_ID, "still this client");
    assert.equal(sent.lender_table, "PersonalCC", "and the product table that was chosen");
    assert.equal(seen.lists.length, 0);
  });
  assert.deepEqual(errors, []);
  await page.close();

  const none = await openLenders({ search: `?client_id=${CLIENT_ID}`, matches: [] });
  assert.equal(await none.page.locator("#listMeta").textContent(), "No lenders fit this file");
  await none.page.close();
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

test("KNOWN BREAK (the reason Export CSV is left out, fin-b14-not-attachable.mjs): a refused export is saved as lenders.csv", { timeout: 60_000 }, async () => {
  const refusal = { status: 403, contentType: "application/json", body: { ok: false, error: "forbidden" } };
  const { page, errors } = await openLenders({ exportAnswer: () => refusal });
  await proof.check(/^Export CSV button/, async () => {
    const [download] = await Promise.all([page.waitForEvent("download"), page.locator("#btnExport").click()]);
    assert.equal(download.suggestedFilename(), "lenders.csv", "BREAK: a file is saved even though the server said no");
    assert.deepEqual(JSON.parse(fs.readFileSync(await download.path(), "utf8")), { ok: false, error: "forbidden" }, "BREAK: and what is in it is the error, not a list");
    assert.equal(await toastOf(page), "", "BREAK: and no words are shown on the page");
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

test("Import now sends the pasted csv exactly, says what came in and what was skipped, and reads the list again", { timeout: 60_000 }, async () => {
  const issues = Array.from({ length: 10 }, (_, i) => `Bank ${i + 1}: invalid lender_table "Nowhere"`);
  const { page, seen, errors } = await openLenders({
    importAnswer: () => ({ body: { ok: true, imported: 2, updated: 1, errors: issues, parsed: 13, skipped_tips: 1 } }),
  });
  await proof.check("Import now button (paste CSV, creates and updates lender rows)", async () => {
    const pasted = "lender_table,name,bureaus_pulled,priority_tier\nOnlineBizCC,Mesa Community Bank,EX,1\nPersonalCC,Desert First Bank,EQ/TU,2\n";
    await page.locator("#btnImportToggle").click();
    await page.locator("#importCsv").fill(pasted);
    const reads = seen.lists.length;
    await page.locator("#btnImportRun").click();
    await waitFor(() => seen.posts.length === 1, "the import request");
    assert.deepEqual(seen.posts[0], { action: "import", csv: pasted }, "the whole paste goes, as typed, and nothing else");
    await waitFor(async () => (await page.locator("#importResult").textContent()).startsWith("Imported 2, updated 1"), "the result words");
    const lines = (await page.locator("#importResult").textContent()).split("\n");
    assert.equal(lines[0], "Imported 2, updated 1 · 10 issues");
    assert.deepEqual(lines.slice(1), issues.slice(0, 8), "the first eight issues are listed, no more");
    assert.equal(await toastOf(page), "Import done");
    await waitFor(() => seen.lists.length === reads + 1, "the list read again");
  });

  await proof.check("Import now button (paste CSV, creates and updates lender rows)", async () => {
    // An empty box is sent as it is; the server's refusal words are shown and the list is not read again.
    const refusedDesk = await openLenders({
      importAnswer: () => ({ status: 400, body: { ok: false, error: "csv_required", message: "Paste or upload a CSV with lender_table and name columns." } }),
    });
    await refusedDesk.page.locator("#btnImportToggle").click();
    const reads = refusedDesk.seen.lists.length;
    await refusedDesk.page.locator("#btnImportRun").click();
    await waitFor(() => refusedDesk.seen.posts.length === 1, "the import request");
    assert.deepEqual(refusedDesk.seen.posts[0], { action: "import", csv: "" });
    await waitFor(async () => (await refusedDesk.page.locator("#importResult").textContent()) === "Paste or upload a CSV with lender_table and name columns.", "the refusal words");
    assert.equal(refusedDesk.seen.lists.length, reads, "a refused import does not redraw the list");
    await refusedDesk.page.close();
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
    await waitFor(async () => (await toastOf(page)) === "Saved", "the Saved toast");
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
  await waitFor(async () => (await toastOf(refused.page)) === "Name is required.", "the refusal words");
  assert.equal(await cell.inputValue(), "Typed Name");
  assert.equal(await cell.evaluate((el) => el.classList.contains("dirty")), true);
  await refused.page.close();
});

test("lender cells with nothing in them stay empty, are never the word null, and are saved back as nothing", { timeout: 60_000 }, async () => {
  const { page, seen, errors } = await openLenders({ lenders: [BLANK_LENDER] });
  const row = page.locator("#lenderBody tr").first();
  await proof.check(/^Lender row inline cells/, async () => {
    for (const field of ["bureaus_pulled", "stated_requirements", "eligible_states"]) {
      assert.equal(await row.locator(`[data-f="${field}"]`).inputValue(), "", `${field} is empty, not the word null`);
    }
    assert.equal(await row.locator('[data-f="priority_tier"]').inputValue(), "", "no tier is no tier, not tier 1");
    assert.equal(await row.locator('[data-f="priority_tier"] option:checked').textContent(), "—");
    assert.equal(await row.locator('[data-f="active"]').inputValue(), "true", "a lender with no status is shown Active");
    assert.equal(await row.locator("td").nth(8).innerText().then((t) => t.replace(/\s+/g, " ").trim()), "—", "no updater and no date show a dash");
    await row.locator(".save-btn").click();
    await waitFor(() => seen.posts.length === 1, "the save request");
    assert.deepEqual(seen.posts[0].patch, {
      name: "Old Book Bank", lender_table: "PersonalLoans", bureaus_pulled: null, stated_requirements: null,
      priority_tier: null, active: true, eligible_states: null,
    }, "empty cells go out as nothing: not the word null, not tier 1, not an empty string");
  });
  assert.deepEqual(errors, []);
  await page.close();
});

test("with several lenders, Save sends the row that was pressed and redraws that row from its own answer", { timeout: 60_000 }, async () => {
  const { page, seen, errors } = await openLenders({
    lenders: [LENDER, LENDER2],
    saveAnswer: (body) => ({
      ok: true,
      lender: { ...(body.id === LENDER2_ID ? LENDER2 : LENDER), ...body.patch, id: body.id, last_updated_by: "Jordan Blake", last_updated_date: "2026-10-14" },
    }),
  });
  await proof.check(/^Lender row Save button/, async () => {
    const second = page.locator("#lenderBody tr").nth(1);
    assert.equal(await second.locator('[data-f="name"]').inputValue(), "Desert First Bank");
    await second.locator('[data-f="name"]').fill("Desert First Bank of Arizona");
    await second.locator(".save-btn").click();
    await waitFor(() => seen.posts.length === 1, "the save request");
    assert.equal(seen.posts[0].id, LENDER2_ID, "the second row's id, not the first's");
    assert.equal(seen.posts[0].patch.name, "Desert First Bank of Arizona");
    assert.equal(seen.posts[0].patch.active, false, "its own status");
    await waitFor(async () => (await page.locator("#lenderBody tr").nth(1).locator('[data-f="name"]').inputValue()) === "Desert First Bank of Arizona", "the second row redrawn");
    assert.equal(await page.locator("#lenderBody tr").first().locator('[data-f="name"]').inputValue(), "Mesa Community Bank", "the first row is untouched");
    assert.equal(await page.locator("#lenderBody tr").count(), 2);
    assert.equal(await page.locator("#lenderBody tr").nth(1).locator('[data-f="active"]').inputValue(), "false");
  });
  assert.deepEqual(errors, []);
  await page.close();
});

test("KNOWN BREAK (the reason the row Save button is left out, fin-b14-not-attachable.mjs): an emptied Name box is sent as null", { timeout: 60_000 }, async () => {
  const { page, seen, errors } = await openLenders();
  await proof.check(/^Lender row Save button/, async () => {
    const row = page.locator("#lenderBody tr").first();
    await row.locator('[data-f="name"]').fill("");
    await row.locator(".save-btn").click();
    await waitFor(() => seen.posts.length === 1, "the save request");
    assert.equal(seen.posts[0].patch.name, null, "BREAK: the page sends null, which the handler's blank-name check does not read as blank");
  });
  assert.deepEqual(errors, []);
  await page.close();
});

// ── AI bureau config ──────────────────────────────────────────────────────────────────────────────────────

const EXISTING = {
  id: "dddddddd-1111-4111-8111-111111111111", bureau_code: "EX", bureau_name: "Experian", service_number: "+18885551212",
  ivr_version: "v2", menu_path: "1,3,2", expected_hold_minutes: 12, active: true,
};
const INACTIVE = {
  id: "dddddddd-2222-4222-8222-222222222222", bureau_code: "TU", bureau_name: "TransUnion", service_number: "+18667775555",
  ivr_version: "v1", menu_path: "2,2", expected_hold_minutes: 8, active: false,
};
const BUREAU_FIELDS = ["bureau_code", "bureau_name", "service_number", "ivr_version", "menu_path", "expected_hold_minutes", "active"];

test("AI bureau config: a saved row opens with all seven values, an inactive one stays inactive, and Save sends them back as they were", { timeout: 60_000 }, async () => {
  const { page, seen, errors } = await openLenders({ bureau: [EXISTING, INACTIVE] });
  await page.locator('[data-tab="bureau"]').click();
  await page.waitForSelector("#bureauBody tr");
  await proof.check(/^AI bureau config row: 7 fields/, async () => {
    const value = async (n, field) => page.locator("#bureauBody tr").nth(n).locator(`[data-f="${field}"]`).inputValue();
    for (const [n, saved] of [[0, EXISTING], [1, INACTIVE]]) {
      assert.deepEqual(
        await page.locator("#bureauBody tr").nth(n).locator("[data-f]").evaluateAll((list) => list.map((el) => el.getAttribute("data-f"))),
        BUREAU_FIELDS,
      );
      assert.equal(await value(n, "bureau_code"), saved.bureau_code);
      assert.equal(await value(n, "bureau_name"), saved.bureau_name);
      assert.equal(await value(n, "service_number"), saved.service_number);
      assert.equal(await value(n, "ivr_version"), saved.ivr_version);
      assert.equal(await value(n, "menu_path"), saved.menu_path, "the saved menu path is in the box");
      assert.equal(await value(n, "expected_hold_minutes"), String(saved.expected_hold_minutes), "the saved hold minutes are in the box");
      assert.equal(await value(n, "active"), String(saved.active), "the saved Active / No is the one selected");
    }
    // Saving an untouched row sends exactly what it holds: an inactive row is not turned back on, and the saved
    // numbers and paths are not wiped.
    await page.locator("#bureauBody tr").nth(1).locator(".save-bureau").click();
    await waitFor(() => seen.bureauPosts.length === 1, "the bureau save request");
    assert.deepEqual(seen.bureauPosts[0], {
      action: "save", id: INACTIVE.id,
      patch: { bureau_code: "TU", bureau_name: "TransUnion", service_number: "+18667775555", ivr_version: "v1", menu_path: "2,2", expected_hold_minutes: 8, active: false },
    });
    await waitFor(async () => (await toastOf(page)) === "Saved", "the Saved toast");
  });
  assert.deepEqual(errors, []);
  await page.close();

  // A refused save says why, does not say Saved, and does not read the config again.
  const refused = await openLenders({
    bureau: [EXISTING],
    bureauAnswer: () => ({ ok: false, error: "bureau_code_required", message: "Say which bureau this row is for." }),
  });
  await refused.page.locator('[data-tab="bureau"]').click();
  await refused.page.waitForSelector("#bureauBody tr");
  await proof.check(/^AI bureau config row: 7 fields/, async () => {
    await refused.page.locator("#bureauBody tr").first().locator('[data-f="menu_path"]').fill("9,9");
    await refused.page.locator("#bureauBody tr").first().locator(".save-bureau").click();
    await waitFor(() => refused.seen.bureauPosts.length === 1, "the bureau save request");
    await waitFor(async () => (await toastOf(refused.page)) === "Say which bureau this row is for.", "the refusal words");
    assert.equal(refused.seen.bureauReads, 1, "a refused save does not read the config again");
    assert.equal(await refused.page.locator("#bureauBody tr").first().locator('[data-f="menu_path"]').inputValue(), "9,9", "what was typed is still there");
  });
  await refused.page.close();
});

test("AI bureau config: Add bureau row adds one empty editable row; its seven fields go out as typed", { timeout: 60_000 }, async () => {
  const { page, seen, errors } = await openLenders({ bureau: [EXISTING] });
  await page.locator('[data-tab="bureau"]').click();
  await page.waitForSelector("#bureauBody tr");

  await proof.check(/^AI bureau config: Add bureau row button/, async () => {
    assert.equal(await page.locator("#bureauBody tr").count(), 1);
    await page.locator("#btnAddBureau").click();
    assert.equal(await page.locator("#bureauBody tr").count(), 2, "one more row, not two");
    const added = page.locator("#bureauBody tr").last();
    for (const field of BUREAU_FIELDS.slice(0, -1)) assert.equal(await added.locator(`[data-f="${field}"]`).inputValue(), "", `${field} starts empty`);
    assert.equal(await added.locator('[data-f="active"]').inputValue(), "true", "a new row starts Active");
    assert.equal(await page.locator("#bureauEmpty").isVisible(), false);
    assert.equal(seen.bureauPosts.length, 0, "adding a row sends nothing");
    assert.equal(seen.bureauReads, 1, "adding a row does not read the config again");
  });

  await proof.check(/^AI bureau config row: 7 fields/, async () => {
    const added = page.locator("#bureauBody tr").last();
    const present = await added.locator("[data-f]").evaluateAll((list) => list.map((el) => el.getAttribute("data-f")));
    assert.deepEqual(present, BUREAU_FIELDS);
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
      action: "save", id: EXISTING.id,
      patch: {
        bureau_code: "EX", bureau_name: "Experian", service_number: "+18885551212", ivr_version: "v2", menu_path: null,
        expected_hold_minutes: null, active: true,
      },
    });
  });
  assert.deepEqual(errors, []);
  await page.close();
});

test("KNOWN BREAK (the reason Add bureau row is left out, fin-b14-not-attachable.mjs): adding a row throws away text typed in the other rows", { timeout: 60_000 }, async () => {
  const { page, errors } = await openLenders({ bureau: [EXISTING] });
  await page.locator('[data-tab="bureau"]').click();
  await page.waitForSelector("#bureauBody tr");
  await proof.check(/^AI bureau config: Add bureau row button/, async () => {
    const first = page.locator("#bureauBody tr").first();
    await first.locator('[data-f="menu_path"]').fill("typed-by-hand 9,9");
    await page.locator("#btnAddBureau").click();
    assert.equal(await page.locator("#bureauBody tr").count(), 2);
    assert.equal(await page.locator("#bureauBody tr").first().locator('[data-f="menu_path"]').inputValue(), "1,3,2", "BREAK: the typed words are gone, the saved ones are back");
  });
  assert.deepEqual(errors, []);
  await page.close();
});

// ── Mismatch queue ────────────────────────────────────────────────────────────────────────────────────────

test("Mismatch queue: Confirm and Corrected send their own word for their own row, say Updated, and read the queue again", { timeout: 60_000 }, async () => {
  const { page, seen, errors } = await openLenders({ observations: [OBS1, OBS2] });
  await page.locator('[data-tab="review"]').click();
  await page.waitForSelector("#reviewBody tr");
  await proof.check("Mismatch queue row: Confirm button", async () => {
    // The queue is the open mismatches, asked for by name.
    assert.deepEqual(asObject(seen.queue[0]), { mismatch_only: "true", review_status: "pending" });
    assert.equal(await page.locator("#mismatchCount").textContent(), "(2)");
    assert.equal(await page.locator("#reviewMeta").textContent(), "2 open");
    const cells = await page.locator("#reviewBody tr").first().locator("td").evaluateAll((tds) => tds.slice(0, 7).map((td) => td.textContent));
    assert.deepEqual(cells, ["Mesa Community Bank", "OnlineBizCC", "EX", "TU", "crs_pull", CLIENT_ID, "Pulled TU on the call"]);
    assert.deepEqual(
      await page.locator("#reviewBody tr").first().locator("button").allTextContents(),
      ["Confirm", "Corrected", "Dismiss"],
    );
  });

  // Corrected is pressed on the SECOND row first, so the row that is sent is the row that was pressed.
  await proof.check("Mismatch queue row: Corrected button", async () => {
    const reads = seen.queue.length;
    await page.locator("#reviewBody tr").nth(1).locator('button[data-act="corrected"]').click();
    await waitFor(() => seen.reviews.length === 1, "the review request");
    assert.deepEqual(seen.reviews[0], { action: "review", id: OBS2.id, review_status: "corrected" }, "the second row's id and the word corrected");
    await waitFor(async () => (await toastOf(page)) === "Updated", "the Updated toast");
    await waitFor(() => seen.queue.length === reads + 1, "the queue read again");
    await waitFor(async () => (await page.locator("#reviewBody tr").count()) === 1, "one row left");
    assert.equal(await page.locator("#reviewMeta").textContent(), "1 open");
    assert.equal(await page.locator("#reviewBody tr").first().locator("td").first().textContent(), "Mesa Community Bank", "the other row is still there");
  });

  await proof.check("Mismatch queue row: Confirm button", async () => {
    const reads = seen.queue.length;
    await page.locator("#reviewBody tr").first().locator('button[data-act="confirmed"]').click();
    await waitFor(() => seen.reviews.length === 2, "the second review request");
    assert.deepEqual(seen.reviews[1], { action: "review", id: OBS1.id, review_status: "confirmed" }, "this row's id and the word confirmed, nothing else");
    await waitFor(() => seen.queue.length === reads + 1, "the queue read again");
    await waitFor(async () => (await page.locator("#reviewBody tr").count()) === 0, "the queue is empty");
    assert.equal(await page.locator("#reviewEmpty").isVisible(), true);
    assert.equal(await page.locator("#reviewMeta").textContent(), "0 open");
    assert.equal(await page.locator("#mismatchCount").textContent(), "");
  });
  assert.deepEqual(errors, []);
  await page.close();

  // Dismiss is its own word, and a refusal is said in words and leaves the row where it was.
  const refusing = await openLenders({
    observations: [OBS1],
    reviewAnswer: () => ({ ok: false, error: "invalid_review_status" }),
  });
  await refusing.page.locator('[data-tab="review"]').click();
  await refusing.page.waitForSelector("#reviewBody tr");
  await proof.check("Mismatch queue row: Confirm button", async () => {
    const reads = refusing.seen.queue.length;
    await refusing.page.locator("#reviewBody tr").first().locator('button[data-act="confirmed"]').click();
    await waitFor(() => refusing.seen.reviews.length === 1, "the review request");
    await waitFor(async () => (await toastOf(refusing.page)) === "invalid_review_status", "the refusal words");
    assert.equal(refusing.seen.queue.length, reads, "a refused review does not read the queue again");
    assert.equal(await refusing.page.locator("#reviewBody tr").count(), 1, "the row is still in the queue");
  });
  await refusing.page.close();
});

test("every listed row was exercised", () => {
  proof.assertAllClaimed();
});
