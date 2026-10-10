// Morning pulse reads the last live Playwright sweep (both fundhub.ai + apply.fundhub.ai).
// The sweep runs on a machine with browsers (node scripts/live-playwright-sweep.mjs), not in Netlify.

export const LIVE_PLAYWRIGHT_AGENT = "live-playwright-sweep";
/** Red when no successful sweep in this window. */
export const LIVE_PLAYWRIGHT_MAX_AGE_MS = 26 * 60 * 60 * 1000;

export function scoreFromPlaywrightJson(report) {
  if (!report || typeof report !== "object") {
    return { passed: 0, failed: 0, total: 0, score: 0 };
  }
  let passed = 0;
  let failed = 0;
  let skipped = 0;
  function walk(suite) {
    if (!suite || typeof suite !== "object") return;
    for (const spec of suite.specs || []) {
      for (const test of spec.tests || []) {
        for (const result of test.results || []) {
          if (result.status === "passed") passed += 1;
          else if (result.status === "skipped") skipped += 1;
          else failed += 1;
        }
      }
    }
    for (const child of suite.suites || []) walk(child);
  }
  for (const suite of report.suites || []) walk(suite);
  const total = passed + failed;
  const score = total ? Math.round((passed / total) * 100) : 0;
  return { passed, failed, skipped, total, score };
}

export function parseSweepDetail(detail) {
  const raw = String(detail || "").trim();
  if (!raw) return null;
  const jsonStart = raw.indexOf("{");
  if (jsonStart < 0) return null;
  try {
    return JSON.parse(raw.slice(jsonStart));
  } catch {
    return null;
  }
}

export async function loadLatestLivePlaywrightRun(db) {
  if (!db || typeof db.query !== "function") return null;
  const { rows } = await db.query(
    `SELECT outcome, detail, created_at
       FROM agent_runs
      WHERE agent_code = $1
      ORDER BY created_at DESC
      LIMIT 1`,
    [LIVE_PLAYWRIGHT_AGENT]
  );
  return rows[0] || null;
}

function check(id, status, detail, suggestedFix = null) {
  return { id, status, detail, suggestedFix };
}

export async function checkLivePlaywright({ db, now = new Date() }) {
  const row = await loadLatestLivePlaywrightRun(db);
  if (!row) {
    return check(
      "live-playwright:desks",
      "FAIL",
      "No live Playwright sweep on file. Both sites (fundhub.ai + apply.fundhub.ai) are unchecked.",
      "Run: node scripts/live-playwright-sweep.mjs (needs STAFF_E2E_PASSWORD in .env). Schedule it nightly on the Mac."
    );
  }
  const ageMs = now.getTime() - new Date(row.created_at).getTime();
  const payload = parseSweepDetail(row.detail);
  const fromReport = scoreFromPlaywrightJson(payload?.report);
  const score = Number(payload?.score ?? fromReport.score ?? 0);
  const passed = Number(payload?.passed ?? fromReport.passed ?? 0);
  const failed = Number(payload?.failed ?? fromReport.failed ?? 0);
  const total = Number(payload?.total ?? fromReport.total ?? passed + failed);
  const ageHours = (ageMs / 3600000).toFixed(1);

  if (ageMs > LIVE_PLAYWRIGHT_MAX_AGE_MS) {
    return check(
      "live-playwright:desks",
      "FAIL",
      `Last desk sweep was ${ageHours}h ago (score ${score}/100, ${passed}/${total} passed). Too old.`,
      "Run node scripts/live-playwright-sweep.mjs on the Mac and wire a nightly launchd/cron."
    );
  }
  if (row.outcome === "fail" || failed > 0 || score < 100) {
    const fails = Array.isArray(payload?.failedTitles) ? payload.failedTitles.slice(0, 5).join("; ") : "";
    return check(
      "live-playwright:desks",
      "FAIL",
      `Desk sweep ${ageHours}h ago: ${score}/100 (${passed}/${total} passed).${fails ? ` Fails: ${fails}` : ""}`,
      "Fix the failing live Playwright specs, then re-run scripts/live-playwright-sweep.mjs."
    );
  }
  return check(
    "live-playwright:desks",
    "PASS",
    `Desk sweep ${ageHours}h ago: 100/100 (${passed}/${total} live tests on CRM + funnel).`
  );
}
