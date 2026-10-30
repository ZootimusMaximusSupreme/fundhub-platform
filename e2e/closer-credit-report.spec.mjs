import { test, expect } from "@playwright/test";
import { CLIENT_ID, CLOSER, openScreen } from "./harness.mjs";

const REPORT = "dddddddd-1111-4111-8111-111111111111";
const handlers = {
  "/api/read/closer-now": { ok: true, current: null, next: null },
  "/api/read/closer-call": {
    ok: true, staff: { id: "staff-2", name: "Casey Reed" },
    client: { id: CLIENT_ID, name: "Dana Whitfield", pipeline: { stage_key: "closing", stage_name: "Closing" } },
    credit: { available: true, scores: { experian: 700 } },
    underwrite: { totals: {}, lenders: [], applications: [] }, deal: {}, precall: {},
    current_call: null, next_call: null, up_next: [], offers: []
  },
  "/api/read/tradelines": { ok: true, data: [], client_id: CLIENT_ID },
  "/api/read/lender-matches": { ok: true, matches: [] },
  "/api/read/deal-math": { ok: true },
  "/api/read/agent-context": { ok: true, context: {} }
};

test("closer opens a fresh signed link to the selected client's complete report", async ({ page }) => {
  await page.addInitScript(() => { window.open = (url) => { window.__openedReport = url; }; });
  await openScreen(page, `/app/closer-dashboard.html?client_id=${CLIENT_ID}`, CLOSER, {
    ...handlers,
    "/api/read/documents": { ok: true, items: [
      { id: "other", client_id: CLIENT_ID, kind: "deliverable", subtype: "credit_analysis_report" },
      { id: REPORT, client_id: CLIENT_ID, kind: "deliverable", subtype: "crs_full_credit_report" }
    ] },
    "/api/documents-download": { ok: true, document: { download: { url: "https://fundhub.ai/api/documents/signed-report" } } }
  });
  await expect(page.locator("#fh-credit-report")).toBeVisible();
  await page.locator("#fh-credit-report").click();
  await expect.poll(() => page.evaluate(() => window.__openedReport)).toBe("https://fundhub.ai/api/documents/signed-report");
});

test("closer sees an honest empty report state before a real pull", async ({ page }) => {
  await openScreen(page, `/app/closer-dashboard.html?client_id=${CLIENT_ID}`, CLOSER, {
    ...handlers,
    "/api/read/documents": { ok: true, items: [] }
  });
  await expect(page.locator("#fh-credit-report")).toBeHidden();
  await expect(page.locator("#fh-credit-report-state")).toHaveText("No credit report on file yet.");
});
