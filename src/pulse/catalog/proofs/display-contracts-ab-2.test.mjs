import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { chromium } from "@playwright/test";

import {
  DISPLAY_CONTRACT_KEYS_AB_2,
  DISPLAY_CONTRACT_PROOF_AB_2,
  DISPLAY_CONTRACTS_AB_2,
} from "./display-contracts-ab-2.mjs";
import { DISPLAY_CONTRACT_KEYS_AB } from "./display-contracts-ab.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const PUBLIC = path.join(ROOT, "public");
const CATALOG = JSON.parse(fs.readFileSync(path.join(ROOT, "src/pulse/catalog/generated.json"), "utf8"));
const CLIENT_ID = "c2000000-0000-4000-8000-000000000002";
const FIXED_NOW = new Date("2026-10-12T09:00:00-07:00");

const TYPES = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".mjs", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
  [".woff2", "font/woff2"],
]);

function staticFile(pathname) {
  const clean = decodeURIComponent(pathname).replace(/^\/+/, "");
  const candidates = clean.endsWith("/")
    ? [path.join(PUBLIC, clean, "index.html")]
    : [path.join(PUBLIC, clean), path.join(PUBLIC, clean, "index.html")];
  return candidates.find((candidate) =>
    candidate.startsWith(`${PUBLIC}${path.sep}`) && fs.existsSync(candidate));
}

async function startServer() {
  const server = http.createServer((req, res) => {
    const file = staticFile(new URL(req.url, "http://127.0.0.1").pathname);
    if (!file) {
      res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      res.end("not found");
      return;
    }
    res.writeHead(200, {
      "content-type": TYPES.get(path.extname(file)) || "application/octet-stream",
    });
    fs.createReadStream(file).pipe(res);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { server, origin: `http://127.0.0.1:${server.address().port}` };
}

async function json(route, body, status = 200) {
  await route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
  return true;
}

function session(role = "owner") {
  return {
    ok: true,
    staff: {
      id: "staff-proof",
      name: "Casey Proof",
      email: "casey@example.test",
      role,
      org_id: "org-proof",
      status: "active",
    },
  };
}

async function proofPage(browser, api, role = "owner") {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await page.addInitScript((staffRole) => {
    localStorage.setItem("fh_token", "display-ab-2-proof-token");
    localStorage.setItem("fh_role", staffRole);
    localStorage.removeItem("fh_demo");
    window.__opened = [];
    window.open = (url, target, features) => {
      window.__opened.push({ url, target, features });
      return null;
    };
  }, role);
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    if (await api(route, url)) return;
    if (url.pathname === "/api/auth/session" || url.pathname === "/api/session") {
      return json(route, session(role));
    }
    if (url.pathname === "/api/demo/mode") return json(route, { ok: true, enabled: false });
    return json(route, { ok: true, items: [], tasks: [], count: 0, hasMore: false });
  });
  return page;
}

async function prove(t, exercised, rowKey, assertion) {
  assert.ok(DISPLAY_CONTRACT_KEYS_AB_2.includes(rowKey), `unknown proof row key ${rowKey}`);
  await t.test(rowKey, async () => {
    await assertion();
    assert.equal(exercised.has(rowKey), false, `row key exercised twice: ${rowKey}`);
    exercised.add(rowKey);
  });
}

async function visibleText(locator) {
  return (await locator.innerText()).replace(/\s+/g, " ").trim();
}

test("Display AB 2 exports only disjoint exact freshly compiled rows", () => {
  assert.equal(DISPLAY_CONTRACT_PROOF_AB_2.strictProvedCount, 25);
  assert.equal(new Set(DISPLAY_CONTRACT_KEYS_AB_2).size, DISPLAY_CONTRACT_KEYS_AB_2.length);
  assert.deepEqual(DISPLAY_CONTRACT_PROOF_AB_2.sourceFiles, ["desks-a.json", "desks-b.json"]);

  const oldKeys = new Set(DISPLAY_CONTRACT_KEYS_AB);
  const byId = new Map(CATALOG.items.map((row) => [row.id, row]));

  for (const proof of DISPLAY_CONTRACTS_AB_2) {
    const row = byId.get(proof.rowKey);
    assert.ok(row, `catalog row is missing: ${proof.rowKey}`);
    assert.equal(row.sourceFile, proof.sourceFile);
    assert.equal(row.surface, proof.surface);
    assert.equal(row.family, proof.family);
    assert.equal(row.expected, proof.expected);
    assert.equal(row.proofVerdict, undefined, `${proof.rowKey} stayed red after its executable proof compiled`);
    assert.equal(row.proofDepth, proof.proof.depth);
    assert.ok(row.proof.tests.includes(proof.proof.file), `${proof.rowKey} lost its executable proof file`);
    assert.equal(oldKeys.has(proof.rowKey), false, `${proof.rowKey} is in Display AB 1`);
    assert.equal(proof.proof.runner, "rendered-chromium-local-fake-routes");
    assert.equal(proof.proof.file, "src/pulse/catalog/proofs/display-contracts-ab-2.test.mjs");
    assert.ok(proof.proof.assertion.length > 30);
  }
});

test("Display AB 2 proves every exported result in real rendered Chromium pages", async (t) => {
  const { server, origin } = await startServer();
  const browser = await chromium.launch({ headless: true });
  const exercised = new Set();
  t.after(async () => {
    await browser.close();
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  });

  const taskWrites = [];
  const taskState = [
    {
      id: "task-one", client_id: CLIENT_ID, client_name: "Alpha Client",
      title: "First call", body: "Review the first file",
      due_at: "2026-10-12T10:00:00-07:00", meeting_url: "https://meet.example.test/alpha",
      done: false, assignee_staff_id: null, assignee_name: null,
    },
    {
      id: "task-two", client_id: "c3000000-0000-4000-8000-000000000003", client_name: "Beta Client",
      title: "Second call", body: "Review the second file",
      due_at: "2026-10-12T11:00:00-07:00", meeting_url: "https://meet.example.test/beta",
      done: false, assignee_staff_id: null, assignee_name: null,
    },
    {
      id: "task-tomorrow", client_id: "c4000000-0000-4000-8000-000000000004", client_name: "Tomorrow Client",
      title: "Tomorrow review", body: "Review tomorrow's file",
      due_at: "2026-10-13T10:00:00-07:00", meeting_url: "https://meet.example.test/tomorrow",
      done: false, assignee_staff_id: null, assignee_name: null,
    },
    {
      id: "task-undated", client_id: CLIENT_ID, client_name: "No Date Client",
      title: "Undated follow-up", body: "Needs a date", due_at: null,
      done: false, assignee_staff_id: null, assignee_name: null,
    },
  ];
  const calendar = await proofPage(browser, async (route, url) => {
    if (url.pathname !== "/api/tasks") return false;
    if (route.request().method() === "PATCH") {
      const body = route.request().postDataJSON();
      taskWrites.push(body);
      const task = taskState.find((item) => item.id === body.id);
      if (body.claim) {
        task.assignee_staff_id = "staff-proof";
        task.assignee_name = "Casey Proof";
      }
      if (body.done) task.done = true;
      return json(route, { ok: true, task });
    }
    const done = url.searchParams.get("done") === "true";
    return json(route, { ok: true, tasks: taskState.filter((item) => Boolean(item.done) === done) });
  });
  await calendar.clock.setFixedTime(FIXED_NOW);
  await calendar.goto(`${origin}/app/calendar.html`, { waitUntil: "domcontentloaded" });
  await calendar.waitForFunction(() => document.querySelectorAll(".evt").length === 2);

  await prove(t, exercised, "4d12368cea0a78aa0c1c", async () => {
    await calendar.locator('#seg [data-v="week"]').click();
    assert.equal(await calendar.locator('#seg [data-v="week"]').getAttribute("class"), "active");
    assert.equal(await calendar.locator("body").getAttribute("class").then((v) => v.includes("week-view")), true);
    assert.match(await calendar.locator(".datelabel").textContent(), /^Week of /);
    await calendar.locator('#seg [data-v="day"]').click();
    assert.equal(await calendar.locator('#seg [data-v="day"]').getAttribute("class"), "active");
    assert.equal(await calendar.locator("body").getAttribute("class").then((v) => v.includes("week-view")), false);
    assert.equal(await calendar.locator(".datelabel").textContent(), "Monday, October 12");
  });
  await prove(t, exercised, "e0c696df527234ed4445", async () => {
    await calendar.locator(".navbtn").nth(0).click();
    assert.equal(await calendar.locator(".datelabel").textContent(), "Sunday, October 11");
  });
  await prove(t, exercised, "fb3288400b58afe9a2a7", async () => {
    await calendar.locator(".navbtn").nth(1).click();
    assert.equal(await calendar.locator(".datelabel").textContent(), "Monday, October 12");
  });
  await prove(t, exercised, "afcbad154a518b996956", async () => {
    await calendar.locator(".navbtn").nth(1).click();
    assert.equal(await calendar.locator(".datelabel").textContent(), "Tuesday, October 13");
    await calendar.locator(".today-btn").click();
    assert.equal(await calendar.locator(".datelabel").textContent(), "Monday, October 12");
  });
  await prove(t, exercised, "9db73c95f6ef74d1056f", async () => {
    await calendar.locator('.ws-day[data-ymd="2026-10-13"]').click();
    assert.equal(await calendar.locator(".datelabel").textContent(), "Tuesday, October 13");
    await calendar.locator('.ws-day[data-ymd="2026-10-14"]').press("Enter");
    assert.equal(await calendar.locator(".datelabel").textContent(), "Wednesday, October 14");
    await calendar.locator(".today-btn").click();
  });
  await prove(t, exercised, "eb892327ba6a36cb6095", async () => {
    await calendar.locator('.evt[data-task-id="task-two"]').click();
    assert.equal(await calendar.locator("#unClient").textContent(), "Beta Client");
    assert.equal(await calendar.locator("#unBody").textContent(), "Second call");
  });
  await prove(t, exercised, "c43aad9d556ea0cdf41d", async () => {
    await calendar.locator("#unJoin").click();
    assert.deepEqual(await calendar.evaluate(() => window.__opened), [{
      url: "https://meet.example.test/beta", target: "_blank", features: "noopener",
    }]);
  });
  await prove(t, exercised, "02b958d5557d989d6909", async () => {
    await calendar.locator('.then-row[data-task-id="task-tomorrow"]').click();
    assert.equal(await calendar.locator("#unClient").textContent(), "Tomorrow Client");
    assert.equal(await calendar.locator("#unBody").textContent(), "Tomorrow review");
  });
  await prove(t, exercised, "929e0d15e8773d927beb", async () => {
    const row = calendar.locator(".nodate-row", { hasText: "Undated follow-up" });
    await row.locator('[data-act="claim"]').click();
    await calendar.waitForFunction(() => document.querySelector('.nodate-row [data-act="claim"]') === null);
    assert.deepEqual(taskWrites.at(-1), { id: "task-undated", claim: true });
    assert.match(await visibleText(row), /Casey Proof/);
  });
  await prove(t, exercised, "51fe3c0c37adc391a629", async () => {
    const row = calendar.locator(".nodate-row", { hasText: "Undated follow-up" });
    await row.locator('[data-act="done"]').click();
    await calendar.waitForFunction(() => !document.body.textContent.includes("Undated follow-up"));
    assert.deepEqual(taskWrites.at(-1), { id: "task-undated", done: true });
  });
  await prove(t, exercised, "16cef6d737cc3240b14e", async () => {
    await calendar.locator(".today-btn").click();
    await calendar.locator('.evt[data-task-id="task-two"]').click();
    await calendar.locator("#unFile").click();
    assert.equal(calendar.url(), `${origin}/app/client-control-panel.html?client_id=c3000000-0000-4000-8000-000000000003`);
  });

  const consentWrites = [];
  async function consentPage(kind) {
    const page = await proofPage(browser, async (route, url) => {
      if (url.pathname !== "/api/consent/capture") return false;
      if (route.request().method() === "POST") {
        consentWrites.push(route.request().postDataJSON());
        return json(route, { ok: true });
      }
      return json(route, {
        ok: true,
        disclosure: { version: "consent-v9", text: `Exact ${kind} disclosure.` },
        status: { valid: false, reason: "none_on_file", consent: null },
        history: [{
          id: "consent-old", valid: false, granted_at: "2026-09-01T12:00:00Z",
          capture_method: "typed", granted_name: "Old Client", granted_by_kind: "client",
          expires_at: null, revoked_at: "2026-09-02T12:00:00Z", revoked_reason: "Changed mind",
        }],
      });
    });
    await page.goto(`${origin}/app/consent-capture.html?client_id=${CLIENT_ID}&kind=${kind}`, {
      waitUntil: "domcontentloaded",
    });
    await page.waitForFunction(() => document.querySelector("#ccDisclosure")?.textContent?.startsWith("Exact"));
    return page;
  }
  const softConsent = await consentPage("soft_pull_consent");
  const disputeConsent = await consentPage("dispute_authorization");

  await prove(t, exercised, "e35991c7648a732cdf41", async () => {
    assert.equal(await softConsent.locator("#ccPageTitle").textContent(), "Soft Pull Consent");
    assert.equal(await softConsent.locator("#ccDisclosure").textContent(), "Exact soft_pull_consent disclosure.");
    assert.equal(await softConsent.locator("#ccStatusLede").textContent(), "No consent on file");
    assert.match(await visibleText(softConsent.locator("#ccHistory")), /Old Client.*Changed mind/);
    assert.equal(await disputeConsent.locator("#ccPageTitle").textContent(), "Authorize dispute letters");
    assert.equal(await disputeConsent.locator("#ccDisclosure").textContent(), "Exact dispute_authorization disclosure.");
  });
  await prove(t, exercised, "4f5d8c3f202e9cd9ac0b", async () => {
    await softConsent.locator("#ccName").fill("Avery Client");
    await softConsent.locator("#ccSubmit").click();
    await softConsent.locator("#ccMsg").waitFor({ state: "visible" });
    assert.equal(await softConsent.locator("#ccMsg").textContent(),
      "Consent recorded. A soft pull may now be requested for this client.");
    assert.deepEqual(consentWrites.at(-1), {
      client_id: CLIENT_ID,
      kind: "soft_pull_consent",
      action: "grant",
      capture_method: "typed",
      granted_name: "Avery Client",
      consent_version: "consent-v9",
    });
  });
  await prove(t, exercised, "b73d673411ce85020d1f", async () => {
    await disputeConsent.locator("#ccName").fill("Avery Client");
    const pad = disputeConsent.locator("#ccSignPad");
    const box = await pad.boundingBox();
    assert.ok(box);
    await disputeConsent.mouse.move(box.x + 30, box.y + 50);
    await disputeConsent.mouse.down();
    await disputeConsent.mouse.move(box.x + 160, box.y + 90, { steps: 8 });
    await disputeConsent.mouse.up();
    await disputeConsent.locator("#ccSubmit").click();
    await disputeConsent.locator("#ccMsg").waitFor({ state: "visible" });
    assert.equal(await disputeConsent.locator("#ccMsg").textContent(),
      "Signature recorded. We can prepare dispute letters. This is not a credit pull.");
    const saved = consentWrites.at(-1);
    assert.deepEqual(saved, {
      client_id: CLIENT_ID,
      kind: "dispute_authorization",
      action: "grant",
      capture_method: "signature",
      granted_name: "Avery Client",
      consent_version: "consent-v9",
    });
  });

  const csmWrites = [];
  let csmShift = null;
  let csmClaimed = false;
  const csmRow = {
    task_id: "csm-task-1",
    client_id: CLIENT_ID,
    client_name: "Jordan Client",
    client_code: "FH-JORDAN",
    title: "Halfway check-in",
    due_at: "2026-10-10T09:00:00-07:00",
    balance_due: "497.00",
    open_invoices: 1,
    bill_days_overdue: 2,
    owned_codes: ["Capital Blueprint"],
    source_workflow: "customer-insights-mid",
    assignee_staff_id: null,
    meeting_url: "https://meet.example.test/csm-proof",
  };
  const csm = await proofPage(browser, async (route, url) => {
    if (url.pathname === "/api/read/csm-queue") {
      return json(route, { ok: true, items: [{
        ...csmRow,
        assignee_staff_id: csmClaimed ? "staff-proof" : null,
      }] });
    }
    if (url.pathname === "/api/read/customer-insights") {
      return json(route, {
        ok: true,
        items: [],
        questions: { mid: [{ id: "wins", prompt: "What changed?" }], post: [] },
      });
    }
    if (url.pathname === "/api/shifts") {
      if (route.request().method() === "POST") {
        const body = route.request().postDataJSON();
        csmWrites.push({ path: url.pathname, body });
        csmShift = body.action === "clock_in"
          ? { id: "shift-1", staff_id: "staff-proof", started_at: "2026-10-12T15:00:00Z" }
          : null;
        return json(route, { ok: true, shift: csmShift });
      }
      return json(route, { ok: true, shift: csmShift });
    }
    if (url.pathname === "/api/tasks" && route.request().method() === "PATCH") {
      const body = route.request().postDataJSON();
      csmWrites.push({ path: url.pathname, body });
      csmClaimed = true;
      return json(route, { ok: true, task: { id: body.id, assignee_staff_id: "staff-proof" } });
    }
    return false;
  }, "client_success");
  await csm.clock.setFixedTime(FIXED_NOW);
  await csm.goto(`${origin}/app/csm-queue.html`, { waitUntil: "domcontentloaded" });
  await csm.waitForFunction(() => document.querySelectorAll("#qList .card[data-row]").length === 1);

  await prove(t, exercised, "4d92dce676f2ef993d12", async () => {
    assert.equal(await csm.locator("h1").textContent(), "My queue");
    assert.equal(await csm.locator(".crumb").textContent(), "Client success");
  });
  await prove(t, exercised, "003ed51f8fa7b5b11f91", async () => {
    const card = csm.locator('[data-row="csm-task-1"]');
    const text = await visibleText(card);
    assert.match(text, /Jordan Client/);
    assert.match(text, /Halfway check-in/);
    assert.match(text, /Call 2 days late/i);
    assert.match(text, /Owes \$497\.00 · 1 invoice · bill 2 days late/i);
    assert.match(text, /Has Capital Blueprint/i);
  });
  await prove(t, exercised, "7b7aeae221ad2f85b0b0", async () => {
    assert.equal(await csm.locator("#qCount").textContent(), "1");
    assert.equal(await csm.locator("#qCountLabel").textContent(), "call waiting");
    assert.equal(await csm.locator("#qOverdue").textContent(), "1 call past due");
  });
  await prove(t, exercised, "2ead117ce3b553db2e51", async () => {
    assert.equal(await csm.locator("#qClock").textContent(), "Start shift");
    await csm.locator("#qClock").click();
    await csm.waitForFunction(() => document.querySelector("#qClock")?.textContent === "End shift");
    assert.deepEqual(csmWrites.at(-1), { path: "/api/shifts", body: { action: "clock_in" } });
    assert.equal(await csm.locator("#qShiftWho").textContent(), "You are on shift");
    await csm.locator("#qClock").click();
    await csm.waitForFunction(() => document.querySelector("#qClock")?.textContent === "Start shift");
    assert.deepEqual(csmWrites.at(-1), { path: "/api/shifts", body: { action: "clock_out" } });
    assert.equal(await csm.locator("#qShiftWho").textContent(), "You are not clocked in");
  });
  await prove(t, exercised, "adf17b6aacab0676adcf", async () => {
    await csm.locator('[data-row="csm-task-1"] [data-claim]').click();
    await csm.waitForFunction(() => !document.querySelector('[data-row="csm-task-1"] [data-claim]'));
    assert.deepEqual(csmWrites.at(-1), {
      path: "/api/tasks", body: { id: "csm-task-1", claim: true },
    });
    assert.match(await visibleText(csm.locator('[data-row="csm-task-1"]')), /Claimed by you/i);
  });
  await prove(t, exercised, "461d319d0017e27d6de8", async () => {
    const card = csm.locator('[data-row="csm-task-1"]');
    await card.locator("[data-open]").click();
    assert.equal(await card.locator('label[for="qa-wins"]').textContent(), "What changed?");
    assert.equal(await card.locator("[data-open]").textContent(), "Hide answers");
    await card.locator("[data-open]").click();
    assert.equal(await card.locator(".q-form").count(), 0);
    assert.equal(await card.locator("[data-open]").textContent(), "Write down their answers");
  });
  await prove(t, exercised, "0f2ec7314a4b905f1a1d", async () => {
    assert.equal(await csm.locator('[data-row="csm-task-1"] .q-name').getAttribute("href"),
      `client-control-panel.html?client_id=${CLIENT_ID}`);
    const empty = await proofPage(browser, async (route, url) => {
      if (url.pathname === "/api/read/csm-queue") return json(route, { ok: true, items: [] });
      if (url.pathname === "/api/read/customer-insights") {
        return json(route, { ok: true, items: [], questions: { mid: [], post: [] } });
      }
      if (url.pathname === "/api/shifts") return json(route, { ok: true, shift: null });
      return false;
    }, "client_success");
    await empty.goto(`${origin}/app/csm-queue.html`, { waitUntil: "domcontentloaded" });
    await empty.waitForFunction(() => document.querySelector("#qCount")?.textContent === "0");
    assert.equal(await empty.locator("#qList a").getAttribute("href"), "client-control-panel.html");
    await empty.close();
  });
  await prove(t, exercised, "3c1d183c7bb4a2d992d2", async () => {
    const link = csm.locator('[data-row="csm-task-1"] a', { hasText: "Booking link" });
    assert.equal(await link.getAttribute("href"), "https://meet.example.test/csm-proof");
    assert.equal(await link.getAttribute("target"), "_blank");
    assert.equal(await link.getAttribute("rel"), "noopener");
  });

  const content = await proofPage(browser, async (route, url) => {
    if (url.pathname !== "/api/content/tiles") return false;
    return json(route, {
      ok: true,
      videos: [
        { id: "video-card", title: "Card Welcome", duration_label: "2:10", uploaded_at: "2026-10-11T12:00:00Z" },
        { id: "video-default", title: "Default Welcome", duration_label: "1:05", uploaded_at: "2026-10-10T12:00:00Z" },
      ],
      map: { "card-stacking": "video-card", default: "video-default" },
      products: [
        { id: "card-stacking", name: "Card Stacking", note: "cards" },
        { id: "funding", name: "Funding", note: "funding" },
      ],
      tiles: [{ code: "repair", name: "Credit Repair", copy: "Fix the report first.", price_cents: 49700, on: true }],
    });
  });
  await content.goto(`${origin}/app/content-admin.html`, { waitUntil: "domcontentloaded" });
  await content.waitForFunction(() => document.querySelector("#kVideos")?.textContent === "2");

  await prove(t, exercised, "92b75621fe986f1fcbcf", async () => {
    assert.match(await visibleText(content.locator("#vlist")), /Card Welcome.*Default Welcome/);
    assert.match(await visibleText(content.locator("#tierRows")), /Card Stacking.*Funding.*Default/);
    assert.match(await visibleText(content.locator("#tileEditors")), /repair.*Credit Repair/i);
    assert.equal(await content.locator('#tileEditors [data-f="copy"]').inputValue(), "Fix the report first.");
    assert.equal(await content.locator('#tileEditors [data-f="price"]').inputValue(), "497");
  });
  await prove(t, exercised, "8d0c57563986749bfda1", async () => {
    assert.equal(await content.locator("#kVideos").textContent(), "2");
    assert.equal(await content.locator("#kTiers").textContent(), "1/2");
    assert.equal(await content.locator("#kTiles").textContent(), "1");
    assert.equal(await content.locator("#kLast").textContent(), "Oct 11");
  });
  await prove(t, exercised, "f9480d08240a1cd71fa2", async () => {
    await content.locator('#pvSwitch [data-pt="card-stacking"]').click();
    assert.equal(await content.locator("#pvVidTitle").textContent(), "Card Welcome");
    assert.equal(await content.locator("#pvVidTier").textContent(), "Card Stacking");
    assert.equal(await content.locator("#pvNote").textContent(), "preview · not live");
    assert.match(await visibleText(content.locator("#pvTiles")), /Credit Repair.*Fix the report first.*\$497/);
    await content.locator('#pvSwitch [data-pt="funding"]').click();
    assert.equal(await content.locator("#pvVidTitle").textContent(), "Default Welcome");
    assert.equal(await content.locator("#pvVidTier").textContent(), "Funding");
    assert.equal(await content.locator("#pvNote").textContent(),
      "preview · falling through to the default video");
  });

  assert.equal(exercised.size, DISPLAY_CONTRACT_KEYS_AB_2.length);
  assert.deepEqual([...exercised].sort(), [...DISPLAY_CONTRACT_KEYS_AB_2].sort());
});
