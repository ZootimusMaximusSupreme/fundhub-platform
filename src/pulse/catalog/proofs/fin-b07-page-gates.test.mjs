// Practice test for two page-gate rows, run with fake answers and no database:
//   1. the Specialist desk (inquiry-remover.html) "Page gate" row: who gets the case and repair
//      queues and who is refused, on the real handlers and on the real page.
//   2. the partner home (partner-galaxy.html) "Open the page" row: who stays, who is sent to their
//      own home, and what the three tiles say.
//
// The role lists are written out here, by hand, from the row's own words. They are NOT read from
// the product, so a role slipped into (or out of) a list turns the test red.

import assert from "node:assert/strict";
import test from "node:test";

import inquiryCases from "../../../../api/read/inquiry-cases.mjs";
import repairCases from "../../../../api/read/repair-cases.mjs";
import { callShared } from "../../../testing/s3-handler-call.mjs";
import { accountSession, req, staffSession } from "../../../testing/handler-harness.mjs";
import { json, startScreens } from "./s4-screen-harness.mjs";

const DESK_ROLES = ["owner", "admin", "inquiry_specialist", "funding_advisor"];
const OTHER_ROLES = ["closer", "setter", "csm", "sales_manager"];
const LOGIN_ONLY = /live JOIN staff|account_sessions|FROM accounts WHERE id/;
const REFUSAL_SENTENCE = "This queue is for staff on this desk.";

const sessionFor = (role) => ({
  ok: true,
  staff: { id: "staff-1", name: `Test ${role}`, email: `${role}@fundhub.test`, role, org_id: "org-1", status: "active" },
});

for (const [name, handler] of [["read/inquiry-cases", inquiryCases], ["read/repair-cases", repairCases]]) {
  test(`${name}: only the four desk roles are let in, every other staff role and a client are refused before any read`, async () => {
    for (const role of DESK_ROLES) {
      const { res } = await callShared(handler, req("GET", {}), [staffSession({ role })]);
      assert.notEqual(res.statusCode, 403, `${role} is a desk role and must not be refused`);
      assert.notEqual(res.statusCode, 401, role);
    }
    for (const role of OTHER_ROLES) {
      const { res, fake } = await callShared(handler, req("GET", {}), [staffSession({ role })]);
      assert.equal(res.statusCode, 403, `${role} must be refused`);
      const looked = fake.calls.filter((c) => !LOGIN_ONLY.test(c.sql)).map((c) => c.sql.trim().slice(0, 60));
      assert.deepEqual(looked, [], `${role} was refused only after a read: ${looked.join(" | ")}`);
    }
    const { res, fake } = await callShared(handler, req("GET", {}), accountSession({ kind: "client", clientId: "c1000000-0000-4000-8000-000000000001" }));
    assert.ok([401, 403].includes(res.statusCode), `a client login got ${res.statusCode}`);
    assert.deepEqual(fake.calls.filter((c) => !LOGIN_ONLY.test(c.sql)), []);
  });
}

test("the Specialist page keeps a refused role on a plain refusal sentence, never the empty-queue words", async (t) => {
  const { open } = await startScreens(t);
  const refuse = (route) => json(route, { ok: false, error: "forbidden" }, 403);
  for (const role of OTHER_ROLES) {
    const { page } = await open("/app/inquiry-remover.html", {
      session: sessionFor(role),
      handlers: { "/api/read/inquiry-cases": refuse, "/api/read/repair-cases": refuse },
    });
    await page.waitForFunction((sentence) => document.body.innerText.includes(sentence), REFUSAL_SENTENCE, { timeout: 15000 });
    const text = await page.evaluate(() => document.body.innerText);
    assert.ok(text.includes(REFUSAL_SENTENCE), `${role} must be told this queue is for the desk`);
    assert.ok(!text.includes("No active cases."), `${role} must not be shown an empty queue as if it were theirs`);
    await page.close();
  }
  for (const role of DESK_ROLES) {
    const { page } = await open("/app/inquiry-remover.html", {
      session: sessionFor(role),
      handlers: {
        "/api/read/inquiry-cases": { ok: true, count: 0, limit: 500, offset: 0, hasMore: false, items: [], cases: [], total: 0 },
        "/api/read/repair-cases": { ok: true, files: [], total: 0, need_me: 0, ready: 0, waiting: 0, stalled: 0, trial_ending: 0 },
      },
    });
    await page.waitForFunction(() => document.body.innerText.includes("No active cases."), null, { timeout: 15000 });
    const text = await page.evaluate(() => document.body.innerText);
    assert.ok(!text.includes(REFUSAL_SENTENCE), `${role} is a desk role and must not be refused`);
    await page.close();
  }
});

// Where each staff role is sent when it asks for the partner home. Written out from the row's words
// (owner reaches it, admin is bounced) and from each role's own home screen.
const SENT_HOME = {
  admin: "/app/pipeline.html",
  sales_manager: "/app/sales-floor.html",
  closer: "/app/closer-dashboard.html",
  funding_advisor: "/app/client-control-panel.html",
  inquiry_specialist: "/app/inquiry-remover.html",
  csm: "/app/csm-queue.html",
  setter: "/app/pipeline.html",
};

test("the partner home: the owner and a partner stay, every other staff role is sent to its own home", async (t) => {
  const { open } = await startScreens(t);
  const stays = {
    owner: sessionFor("owner"),
    partner: { ok: true, staff: { id: "staff-p", name: "Pat Partner", email: "pat@partner.test", role: "partner", org_id: "org-1", status: "active", partner_id: "pppppppp-1111-4111-8111-111111111111" } },
  };
  for (const [role, session] of Object.entries(stays)) {
    const { page } = await open("/app/partner-galaxy.html", { session });
    // Let every read the page makes finish, then give a late redirect time to fire before judging.
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(1200);
    assert.equal(new URL(page.url()).pathname, "/app/partner-galaxy.html", `${role} must stay on the partner home`);
    await page.close();
  }
  for (const [role, home] of Object.entries(SENT_HOME)) {
    const { page } = await open("/app/partner-galaxy.html", { session: sessionFor(role) });
    await page.waitForFunction((want) => location.pathname === want, home, { timeout: 15000 }).catch(() => {});
    assert.equal(new URL(page.url()).pathname, home, `${role} must be sent to ${home}`);
    await page.close();
  }
});

test("the partner home paints the three tiles from the read: a real zero stays a zero and an unknown says not known", async (t) => {
  const { open } = await startScreens(t);
  const partner = { ok: true, staff: { id: "staff-p", name: "Pat Partner", email: "pat@partner.test", role: "partner", org_id: "org-1", status: "active", partner_id: "pppppppp-1111-4111-8111-111111111111" } };
  const tiles = {
    ok: true,
    cash_collected_today_cents: 125000,
    cash_collected_yesterday_cents: 0,
    funded_today: 0,
    funded_yesterday: 2,
    ad_spend_today_cents: 40000,
    cost_per_funded_client_cents: null,
  };
  const { page } = await open("/app/partner-galaxy.html", { session: partner, handlers: { "/api/read/partner-home-tiles": tiles } });
  await page.waitForFunction(() => {
    const v = document.getElementById("tile-value-cash-collected-today");
    return v && !v.classList.contains("skeleton");
  }, null, { timeout: 15000 });
  const read = (id) => page.evaluate((i) => ({
    value: document.getElementById(`tile-value-${i}`).textContent,
    compare: document.getElementById(`tile-compare-${i}`).textContent,
  }), id);
  assert.deepEqual(await read("cash-collected-today"), { value: "$1,250", compare: "$0 yesterday" });
  assert.deepEqual(await read("funded-today"), { value: "0", compare: "2 yesterday" });
  assert.deepEqual(await read("cost-per-funded-client"), { value: "not known", compare: "no funded clients yet" });
  await page.close();
});
