// Practice test for two buttons of the Specialist desk, run on the REAL page in a real browser with fake
// answers and no database:
//
//   * the case drawer's "Upload FTC or police report": it sends the chosen file for THIS case's client
//     under the fraud-documents subtype, and says so when no file was chosen
//   * the expanded repair row's "Clean personal info" button: owner and admin only, asks first, and
//     sends nothing until the person says yes (the erasure itself is held by
//     fin-b07-clean-personal.test.mjs)
//   * the letter drawer's "Send this one": mails exactly that one letter, for that client, with mail on
//   * the expanded row's "Send" (every sendable letter, mail on) and "Stage" (writes letters, mails none)

import assert from "node:assert/strict";
import test from "node:test";

import { startScreens } from "./s4-screen-harness.mjs";
import { CASES, NOTHING, SPECIALIST, json, repairHandlers, uuid } from "./fin-b07-desk-page-kit.mjs";

// ── Case drawer: Upload FTC or police report ─────────────────────────────────────────────────

test("the case drawer's upload sends the chosen file for this case's client as a fraud document, and sends nothing with no file", async (t) => {
  const posts = [];
  const { open } = await startScreens(t);
  const { page } = await open("/app/inquiry-remover.html", {
    session: SPECIALIST,
    handlers: {
      ...NOTHING,
      "/api/read/inquiry-cases": { ok: true, cases: [CASES[1]], total: 1 },
      "/api/documents-upload": (route) => {
        posts.push({ type: route.request().headers()["content-type"] || "", body: route.request().postData() || "" });
        return json(route, { ok: true, documents: [{ id: uuid(900) }] });
      },
    },
  });
  await page.waitForSelector("#caseQueueBody tr.case-main");
  await page.locator("#caseQueueBody tr.case-main").first().click();
  const button = page.locator('[data-act="upload-fraud"]');
  await button.waitFor();

  // no file chosen: the button says so and sends nothing
  await button.click();
  assert.equal((await button.innerText()).trim(), "choose file");
  assert.deepEqual(posts, []);

  await page.locator("input.fraud-file").setInputFiles({ name: "ftc-report.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4 stand-in file") });
  await page.locator('[data-act="upload-fraud"]').click();
  await page.waitForFunction(() => document.querySelector('[data-act="upload-fraud"]').textContent.trim() === "attached");
  assert.equal(posts.length, 1);
  assert.match(posts[0].type, /^multipart\/form-data/);
  assert.match(posts[0].body, new RegExp(`name="client_id"\\r\\n\\r\\n${CASES[1].client_id}`), "this case's client");
  assert.match(posts[0].body, /name="subtype"\r\n\r\nadditional_fraud_docs/, "filed as a fraud document");
  assert.match(posts[0].body, /filename="ftc-report\.pdf"/, "the chosen file");
  await page.close();
});

// ── Work queue: the row expands ──────────────────────────────────────────────────────────────

// ── Clean personal info: the button ──────────────────────────────────────────────────────────────

const asRole = (role) => ({ ok: true, staff: { id: "staff-9", name: "Test Person", email: "t@fundhub.test", role, org_id: "org-1", status: "active" } });

async function openFile(t, role, record) {
  const { open } = await startScreens(t);
  const { page } = await open("/app/inquiry-remover.html", {
    session: asRole(role),
    handlers: {
      ...repairHandlers(),
      "/api/privacy/erasure": (route) => {
        record.push(JSON.parse(route.request().postData() || "{}"));
        return json(route, { ok: true, erased: true });
      },
    },
  });
  await page.locator('.desk-tab[data-pane="repair"]').click();
  await page.waitForSelector("#repairBody tr.repair-row");
  await page.locator(`[data-repair-row="${uuid(32)}"]`).click();
  await page.locator("tr.repair-expand [data-act=repair-send]").waitFor();
  return page;
}

test("Clean personal info is on the expanded row for an owner and an admin only", async (t) => {
  for (const role of ["owner", "admin"]) {
    const page = await openFile(t, role, []);
    assert.equal(await page.locator("tr.repair-expand [data-act=repair-clean]").count(), 1, `${role} sees the button`);
    await page.close();
  }
  for (const role of ["inquiry_specialist", "funding_advisor", "closer"]) {
    const page = await openFile(t, role, []);
    assert.equal(await page.locator("tr.repair-expand [data-act=repair-clean]").count(), 0, `${role} must not see it`);
    await page.close();
  }
});

test("Clean personal info asks first: saying no sends nothing, saying yes sends this client with the confirmation and a reason", async (t) => {
  const record = [];
  const page = await openFile(t, "owner", record);
  const button = page.locator("tr.repair-expand [data-act=repair-clean]");

  let asked = "";
  page.once("dialog", (dialog) => { asked = dialog.message(); dialog.dismiss(); });
  await button.click();
  await page.waitForTimeout(300);
  assert.match(asked, /Clean personal info for this client\?.*cannot be undone/);
  assert.deepEqual(record, [], "no request is made until the person says yes");

  page.once("dialog", (dialog) => dialog.accept());
  await button.click();
  await page.waitForFunction(() => /Personal info cleaned/.test(document.querySelector("tr.repair-expand [data-send-msg]")?.textContent || ""));
  assert.equal(record.length, 1);
  assert.equal(record[0].client_id, uuid(32));
  assert.equal(record[0].confirm_client_id, uuid(32), "the confirmation names the same client");
  assert.ok(String(record[0].reason || "").length >= 10, "the request carries a reason the erasure will accept");
  await page.close();
});

// ── Letters: the drawer's Send this one, the row's Send and Stage ─────────────────────────────────────

async function until(check, what, ms = 8000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  assert.fail(`timed out waiting for ${what}`);
}

async function openLetters(t, record) {
  const { open } = await startScreens(t);
  const { page } = await open("/app/inquiry-remover.html", {
    session: SPECIALIST,
    handlers: {
      ...repairHandlers(),
      "/api/repair/send": (route) => {
        record.send.push(JSON.parse(route.request().postData() || "{}"));
        return json(route, { ok: true, results: [] });
      },
      "/api/repair/generate": (route) => {
        record.generate.push(JSON.parse(route.request().postData() || "{}"));
        return json(route, { ok: true });
      },
    },
  });
  await page.locator('.desk-tab[data-pane="repair"]').click();
  await page.waitForSelector("#repairBody tr.repair-row");
  await page.locator(`[data-repair-row="${uuid(32)}"]`).click();
  await page.locator("tr.repair-expand [data-act=repair-send]").waitFor();
  return page;
}

test("the letter drawer's Send this one mails exactly that one letter for that client, with mail on, and never offers a letter already mailed", async (t) => {
  const record = { send: [], generate: [] };
  const page = await openLetters(t, record);

  // A letter already mailed cannot be offered for sending again.
  await page.locator('tr.repair-expand [data-letter-idx="2"]').click();
  await page.waitForFunction(() => /TransUnion/.test(document.getElementById("repairLetterTitle").textContent));
  assert.equal(await page.locator("#repairLetterSendOne").isDisabled(), true);
  await page.locator("#repairLetterDrawer .pane [data-repair-close-letter]").first().click();
  assert.equal(record.send.length, 0, "opening it sends nothing");

  await page.locator('tr.repair-expand [data-letter-idx="1"]').click();
  await page.waitForFunction(() => /Equifax/.test(document.getElementById("repairLetterTitle").textContent));
  assert.match(await page.locator("#repairLetterTitle").innerText(), /Equifax · R1/);
  assert.match(await page.locator("#repairLetterMeta").innerText(), /target: furnisher.*status ready/);
  assert.equal(await page.locator("#repairLetterSendOne").isDisabled(), false);

  await page.locator("#repairLetterSendOne").click();
  await until(() => record.send.length === 1, "the send request");
  assert.equal(record.send[0].mail, true);
  assert.equal(record.send[0].client_id, uuid(32));
  assert.deepEqual(record.send[0].letters, [{ bureau: "EQ", html: "<p>Round 1 furnisher</p>", letter_id: uuid(42) }], "one letter, the one opened");
  assert.deepEqual(record.generate, []);
  await page.close();
});

test("the row's Send mails every sendable letter with mail on, and Stage only asks for letters to be written", async (t) => {
  const record = { send: [], generate: [] };
  const page = await openLetters(t, record);

  await page.locator("tr.repair-expand [data-act=repair-stage]").click();
  await until(() => record.generate.length === 1, "the stage request");
  assert.deepEqual(record.generate, [{ client_id: uuid(32) }]);
  assert.deepEqual(record.send, [], "Stage mails nothing");

  // Staging reloads the queue and folds the row, so open it again.
  await page.locator(`[data-repair-row="${uuid(32)}"]`).click();
  await page.locator("tr.repair-expand [data-act=repair-send]").waitFor();
  await page.locator("tr.repair-expand [data-act=repair-send]").click();
  await until(() => record.send.length === 1, "the send request");
  assert.equal(record.send.length, 1);
  assert.equal(record.send[0].mail, true, "the page never sends a letter without mail on");
  assert.equal(record.send[0].client_id, uuid(32));
  assert.deepEqual(record.send[0].letters.map((l) => [l.bureau, l.letter_id]), [["EX", uuid(41)], ["EQ", uuid(42)]], "every sendable letter, no other");
  await page.close();
});
