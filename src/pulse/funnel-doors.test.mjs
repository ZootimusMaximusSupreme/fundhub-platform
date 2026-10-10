import { test } from "node:test";
import assert from "node:assert/strict";
import { checkFunnelRoadmapSales } from "./funnel-doors.mjs";

test("funnel roadmap PASS when checkout anchor and offer copy present", async () => {
  const fetchImpl = async () => ({
    status: 200,
    text: async () => '<section id="fh-order">Get My Roadmap — Funding Roadmap</section>'
  });
  const row = await checkFunnelRoadmapSales({ fetchImpl, baseUrl: "https://apply.fundhub.ai" });
  assert.equal(row.status, "PASS");
  assert.equal(row.id, "funnel:roadmap-sales");
});

test("funnel roadmap FAIL when copy missing", async () => {
  const fetchImpl = async () => ({ status: 200, text: async () => "<html>empty</html>" });
  const row = await checkFunnelRoadmapSales({ fetchImpl });
  assert.equal(row.status, "FAIL");
});
