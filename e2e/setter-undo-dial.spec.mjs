import { test, expect } from "@playwright/test";
import fs from "node:fs";
import { openScreen, json } from "./harness.mjs";

const clientId = "aaaaaaaa-1111-4111-8111-111111111111";
const staff = { ok: true, staff: {
  id: "staff-setter", name: "Alex Setter", email: "alex@fundhub.ai",
  role: "setter", org_id: "org-1", status: "active"
} };

test("Undo arrow beside CRM Search reverses one saved dial and survives refresh", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 800 });
  const item = {
    client_id: clientId, client_name: "Dana Whitfield", phone: "+15550100",
    lead_type: "opt_in", created_at: new Date().toISOString(), needs_work: true,
    setter_staff_id: "staff-setter", survey: [],
    setter_handoff: { call_attempts: 0 }
  };
  let latest = null;
  let logCalls = 0;
  let undoCalls = 0;
  let operationId = "";
  await openScreen(page, "/app/setter-dashboard.html", staff, {
    "/api/read/setter-dashboard": () => ({
      ok: true, count: 1, items: [item],
      numbers: { dials: item.setter_handoff.call_attempts },
      latest_undoable_dial: latest
    }),
    "/api/setter-dashboard": (route) => {
      const body = route.request().postDataJSON();
      if (body.action === "log_dial") {
        logCalls += 1;
        expect(body.operation_id).toMatch(/^[0-9a-f-]{36}$/i);
        expect(body).not.toHaveProperty("expected_call_attempts");
        if (operationId) expect(body.operation_id).toBe(operationId);
        operationId = body.operation_id;
        item.setter_handoff.call_attempts = 1;
        latest = { client_id: clientId, event_id: "dial-1", undo_until: new Date(Date.now() + 60_000).toISOString() };
        return { ok: true, item, dial_event: { event_id: latest.event_id, undo_until: latest.undo_until } };
      }
      if (body.action === "undo_dial") {
        undoCalls += 1;
        expect(body.client_id).toBe(clientId);
        expect(body.event_id).toBe("dial-1");
        item.setter_handoff.call_attempts = 0;
        latest = null;
        return { ok: true, item, dial_event: { event_id: "dial-1", undone: true } };
      }
      throw new Error(`Unexpected action ${body.action}`);
    }
  });

  const undo = page.locator("#setter-undo-dial");
  await expect(undo).toBeHidden();
  await page.getByRole("button", { name: /^Log dial/ }).dblclick();
  await expect(undo).toBeVisible();
  expect(logCalls).toBe(1);
  await expect(page.locator("#setter-number-dials")).toHaveText("1");
  const besideSearch = await page.evaluate(() => {
    const search = document.getElementById("fh-shell-search-btn");
    const button = document.getElementById("setter-undo-dial");
    return button.previousElementSibling === search;
  });
  expect(besideSearch).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);

  await page.reload();
  await expect(undo).toBeVisible();
  await expect(undo).toHaveAttribute("aria-label", /Dana Whitfield/);
  await undo.click();
  await expect(undo).toBeHidden();
  await expect(page.locator("#setter-number-dials")).toHaveText("0");
  expect(undoCalls).toBe(1);
});

test("eligible Undo stays in the header at desktop and phone widths and works by keyboard", async ({ page }) => {
  const until = new Date(Date.now() + 60_000).toISOString();
  let undone = false;
  await openScreen(page, "/app/setter-dashboard.html", staff, {
    "/api/read/setter-dashboard": () => ({
      ok: true, count: 1,
      items: [{ client_id: clientId, client_name: "Dana Whitfield", phone: "+15550100",
        lead_type: "opt_in", created_at: new Date().toISOString(), needs_work: true,
        setter_staff_id: "staff-setter", survey: [], setter_handoff: { call_attempts: undone ? 0 : 1 } }],
      numbers: { dials: undone ? 0 : 1 },
      latest_undoable_dial: undone ? null : { client_id: clientId, event_id: "dial-1", undo_until: until }
    }),
    "/api/setter-dashboard": (route) => {
      const body = route.request().postDataJSON();
      expect(body).toMatchObject({ action: "undo_dial", client_id: clientId, event_id: "dial-1" });
      undone = true;
      return { ok: true, dial_event: { event_id: "dial-1", undone: true } };
    }
  });
  const undo = page.locator("#setter-undo-dial");
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 844 });
    if (width === 390 && await page.locator("#side").evaluate((side) => side.classList.contains("open"))) {
      await page.keyboard.press("Escape");
    }
    if (width === 390) {
      await expect(page.locator("#side")).toBeHidden();
    }
    await expect(undo).toBeVisible();
    await expect(page.locator("#fh-shell-search-btn")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
    if (width === 390 && process.env.FH_UNDO_EVIDENCE) {
      await page.screenshot({ path: process.env.FH_UNDO_EVIDENCE });
      fs.writeFileSync(process.env.FH_UNDO_EVIDENCE + ".json", JSON.stringify(await undo.boundingBox()));
    }
  }
  await undo.focus();
  await page.keyboard.press("Enter");
  await expect(undo).toBeHidden();
  expect(undone).toBe(true);
});

test("an older Refresh queue response cannot hide Undo after Log dial saves", async ({ page }) => {
  const item = {
    client_id: clientId, client_name: "Dana Whitfield", phone: "+15550100",
    lead_type: "opt_in", created_at: new Date().toISOString(), needs_work: true,
    setter_staff_id: "staff-setter", survey: [], setter_handoff: { call_attempts: 0 }
  };
  let readCalls = 0;
  let releaseOldRead;
  let finishOldRead;
  const oldReadGate = new Promise((resolve) => { releaseOldRead = resolve; });
  const oldReadFinished = new Promise((resolve) => { finishOldRead = resolve; });
  let latest = null;
  await openScreen(page, "/app/setter-dashboard.html", staff, {
    "/api/read/setter-dashboard": async (route) => {
      readCalls += 1;
      if (readCalls === 2) {
        const oldBody = { ok: true, count: 1, items: [structuredClone(item)],
          numbers: { dials: 0 }, latest_undoable_dial: null };
        await oldReadGate;
        await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(oldBody) });
        finishOldRead();
        return;
      }
      return { ok: true, count: 1, items: [item],
        numbers: { dials: item.setter_handoff.call_attempts }, latest_undoable_dial: latest };
    },
    "/api/setter-dashboard": (route) => {
      const body = route.request().postDataJSON();
      expect(body.action).toBe("log_dial");
      item.setter_handoff.call_attempts = 1;
      latest = { client_id: clientId, event_id: "dial-2", undo_until: new Date(Date.now() + 60_000).toISOString() };
      return { ok: true, item, dial_event: { event_id: latest.event_id, undo_until: latest.undo_until } };
    }
  });

  await page.getByRole("button", { name: "Refresh queue" }).click();
  await expect.poll(() => readCalls).toBe(2);
  await page.getByRole("button", { name: /^Log dial/ }).click();
  await expect(page.locator("#setter-undo-dial")).toBeVisible();
  await expect(page.locator("#setter-number-dials")).toHaveText("1");
  releaseOldRead();
  await oldReadFinished;
  await page.waitForTimeout(100);
  await expect(page.locator("#setter-undo-dial")).toBeVisible();
  await expect(page.locator("#setter-number-dials")).toHaveText("1");
});

test("Save sends the server-loaded dial count alongside an edited checklist", async ({ page }) => {
  const item = {
    client_id: clientId, client_name: "Dana Whitfield", phone: "+15550100",
    lead_type: "opt_in", created_at: new Date().toISOString(), needs_work: true,
    setter_staff_id: "staff-setter", survey: [], setter_handoff: { call_attempts: 1 }
  };
  let saved = null;
  await openScreen(page, "/app/setter-dashboard.html", staff, {
    "/api/read/setter-dashboard": { ok: true, count: 1, items: [item], numbers: { dials: 1 } },
    "/api/setter-dashboard": (route) => {
      saved = route.request().postDataJSON();
      return { ok: true, item: { ...item, setter_handoff: saved.handoff } };
    }
  });
  await page.locator("#setter-problem").fill("Needs a call tomorrow");
  await page.getByRole("button", { name: "Save checklist" }).click();
  await expect.poll(() => saved && saved.action).toBe("save");
  expect(saved.handoff.call_attempts).toBe(1);
  expect(saved.handoff.problem).toBe("Needs a call tomorrow");
  expect(saved.expected_call_attempts).toBe(1);
});

test("a dial-count conflict keeps checklist edits and refreshes the count for retry", async ({ page }) => {
  const item = {
    client_id: clientId, client_name: "Dana Whitfield", phone: "+15550100",
    lead_type: "opt_in", created_at: new Date().toISOString(), needs_work: true,
    setter_staff_id: "staff-setter", survey: [], setter_handoff: { call_attempts: 1 }
  };
  let serverAttempts = 1;
  const saves = [];
  await openScreen(page, "/app/setter-dashboard.html", staff, {
    "/api/read/setter-dashboard": () => ({
      ok: true, count: 1,
      items: [{ ...item, setter_handoff: { ...item.setter_handoff, call_attempts: serverAttempts } }],
      numbers: { dials: serverAttempts }
    }),
    "/api/setter-dashboard": (route) => {
      const body = route.request().postDataJSON();
      saves.push(body);
      if (saves.length === 1) {
        serverAttempts = 2;
        return json(route, { ok: false, error: "handoff_dial_count_changed" }, 409);
      }
      return { ok: true, item: { ...item, setter_handoff: body.handoff } };
    }
  });
  await page.locator("#setter-problem").fill("Needs a call tomorrow");
  await page.getByRole("button", { name: "Save checklist" }).click();
  await expect(page.locator("#setter-status")).toContainText("The dial count changed. Your edits are still here. Save again.");
  await expect(page.locator("#setter-attempts")).toHaveValue("2");
  await expect(page.locator("#setter-problem")).toHaveValue("Needs a call tomorrow");
  await page.getByRole("button", { name: "Save checklist" }).click();
  await expect.poll(() => saves.length).toBe(2);
  expect(saves[0].expected_call_attempts).toBe(1);
  expect(saves[1].expected_call_attempts).toBe(2);
  expect(saves[1].handoff.call_attempts).toBe(2);
  expect(saves[1].handoff.problem).toBe("Needs a call tomorrow");
});

test("a replayed dial shows it was already logged", async ({ page }) => {
  const item = {
    client_id: clientId, client_name: "Dana Whitfield", phone: "+15550100",
    lead_type: "opt_in", created_at: new Date().toISOString(), needs_work: true,
    setter_staff_id: "staff-setter", survey: [], setter_handoff: { call_attempts: 0 }
  };
  let attempts = 0;
  await openScreen(page, "/app/setter-dashboard.html", staff, {
    "/api/read/setter-dashboard": () => ({
      ok: true, count: 1, items: [{ ...item, setter_handoff: { call_attempts: attempts } }], numbers: { dials: attempts }
    }),
    "/api/setter-dashboard": () => {
      attempts = 1;
      return {
        ok: true,
        item: { ...item, setter_handoff: { call_attempts: 1 } },
        dial_event: { event_id: "dial-1", undo_until: new Date(Date.now() + 60_000).toISOString(), replayed: true }
      };
    }
  });
  await page.getByRole("button", { name: /^Log dial/ }).click();
  await expect(page.locator("#setter-status")).toHaveText("That dial was already logged.");
  await expect(page.locator("#setter-attempts")).toHaveValue("1");
});

test("a replayed dial that was already undone never offers Undo", async ({ page }) => {
  const item = {
    client_id: clientId, client_name: "Dana Whitfield", phone: "+15550100",
    lead_type: "opt_in", created_at: new Date().toISOString(), needs_work: true,
    setter_staff_id: "staff-setter", survey: [], setter_handoff: { call_attempts: 0 }
  };
  let reads = 0;
  let releaseRead;
  await openScreen(page, "/app/setter-dashboard.html", staff, {
    "/api/read/setter-dashboard": (route) => {
      reads += 1;
      const body = { ok: true, count: 1, items: [item], numbers: { dials: 0 }, latest_undoable_dial: null };
      if (reads === 1) return body;
      return new Promise((resolve) => {
        releaseRead = () => json(route, body).then(resolve);
      });
    },
    "/api/setter-dashboard": () => ({
      ok: true, item,
      dial_event: { event_id: "dial-1", undo_until: new Date(Date.now() + 60_000).toISOString(), undone: true, replayed: true }
    })
  });
  await page.getByRole("button", { name: /^Log dial/ }).click();
  await expect.poll(() => reads).toBe(2);
  await expect(page.locator("#setter-undo-dial")).toBeHidden();
  await releaseRead();
});

for (const [reason, savedFields] of [
  ["completed handoff", { complete_at: new Date().toISOString() }],
  ["No answer", { disposition: "no_answer" }]
]) {
  test(`saving ${reason} hides Undo immediately`, async ({ page }) => {
    const item = {
      client_id: clientId, client_name: "Dana Whitfield", phone: "+15550100",
      lead_type: "opt_in", created_at: new Date().toISOString(), needs_work: true,
      setter_staff_id: "staff-setter", survey: [], setter_handoff: { call_attempts: 1 }
    };
    const latest = { client_id: clientId, event_id: "dial-1", undo_until: new Date(Date.now() + 60_000).toISOString() };
    await openScreen(page, "/app/setter-dashboard.html", staff, {
      "/api/read/setter-dashboard": { ok: true, count: 1, items: [item], numbers: { dials: 1 }, latest_undoable_dial: latest },
      "/api/setter-dashboard": (route) => {
        const body = route.request().postDataJSON();
        expect(body.action).toBe("save");
        return { ok: true, item: { ...item, setter_handoff: { ...body.handoff, ...savedFields } } };
      }
    });
    const undo = page.locator("#setter-undo-dial");
    await expect(undo).toBeVisible();
    await page.locator("#setter-problem").fill("Call notes");
    await page.getByRole("button", { name: "Save checklist" }).click();
    await expect(page.locator("#setter-status")).toHaveText("Checklist saved.");
    await expect(undo).toBeHidden();
  });
}
