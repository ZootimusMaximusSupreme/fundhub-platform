import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

// Local review only. The same invented partner and read-only fixtures are used
// for both copies. Every API request is intercepted; no account is connected.
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const PUBLIC = path.join(ROOT, "public");
const EVIDENCE = path.join(ROOT, "ops/workflows/dashboard-ux-polish/evidence");
const BEFORE = execFileSync("git", ["show", "842ebfc6e:public/app/social-studio.html"], { cwd: ROOT, encoding: "utf8" });
const AFTER = fs.readFileSync(path.join(PUBLIC, "app/social-studio.html"), "utf8");
const TYPES = { ".css": "text/css", ".html": "text/html", ".js": "text/javascript", ".svg": "image/svg+xml", ".png": "image/png", ".webp": "image/webp" };
const server = http.createServer((req, res) => {
  const file = path.resolve(PUBLIC, "." + new URL(req.url, "http://127.0.0.1").pathname);
  if (!file.startsWith(PUBLIC + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    res.writeHead(404).end("not found");
    return;
  }
  res.writeHead(200, { "content-type": TYPES[path.extname(file)] || "application/octet-stream" });
  fs.createReadStream(file).pipe(res);
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true });
fs.mkdirSync(EVIDENCE, { recursive: true });
let writeRequests = 0;

try {
  for (const width of [1440, 390]) {
    for (const [version, html] of [["before", BEFORE], ["after", AFTER]]) {
      const context = await browser.newContext({ viewport: { width, height: 1000 }, timezoneId: "America/Phoenix" });
      const page = await context.newPage();
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.clock.setFixedTime(new Date("2026-10-19T19:00:00Z"));
      await page.addInitScript(() => {
        localStorage.setItem("fh_token", "local-review-fixture");
        localStorage.setItem("fh_role", "owner");
      });
      await page.route("**/*", async (route) => {
        const request = route.request();
        const url = new URL(request.url());
        if (url.origin !== origin) return route.abort();
        if (url.pathname === "/app/social-studio.html") return route.fulfill({ contentType: "text/html", body: html });
        if (!url.pathname.startsWith("/api/")) return route.continue();
        if (request.method() !== "GET") {
          writeRequests++;
          return route.fulfill({ status: 405, contentType: "application/json", body: JSON.stringify({ ok: false, error: "review_only" }) });
        }
        let result = { ok: true, items: [] };
        if (url.pathname === "/api/auth/session") result = { ok: true, principal: "staff", staff: { id: "review-owner", email: "review@example.test", role: "owner" } };
        if (url.pathname === "/api/read/partners") result = { ok: true, items: [{ id: "review-partner", name: "Review workspace" }] };
        if (url.pathname === "/api/social/settings") result = { ok: true, settings: { stored: true, approve_before_launch: true, weekly_asset_target: 4, max_concurrent_jobs: 2, autopilot_enabled: false, launch_enabled: false } };
        if (url.pathname === "/api/partner-marketing/usage") result = { ok: true, enabled: true, remaining: 7 };
        if (url.pathname === "/api/social/oauth") result = { ok: false, error: "not_configured" };
        if (url.pathname === "/api/social/posts") result = { ok: true, items: [{ id: "review-draft", partner_id: "review-partner", caption: "Review draft. No live social account is connected.", offer_type: "funding", status: "draft", scheduled_for: null, created_at: "2026-10-19T18:00:00Z", attempt: 0 }], tasks: [] };
        return route.fulfill({ contentType: "application/json", body: JSON.stringify(result) });
      });
      await page.goto(`${origin}/app/social-studio.html?partner_id=review-partner`);
      await page.locator("#ssSuiteTxt").filter({ hasText: "Writing on" }).waitFor();
      await page.locator("#chGrid").filter({ hasText: "No social accounts are connected yet" }).waitFor();
      await page.locator("#tblQueued").filter({ hasText: "Review draft" }).waitFor();
      await page.evaluate((version) => {
        const markColor = version === "after" ? "#15803d" : "#dc2626";
        const title = document.createElement("p");
        title.textContent = `${version.toUpperCase()} · Social Studio copy · Safe review data`;
        title.style.cssText = `color:${markColor};font:600 13px sans-serif;background:#fff;padding:8px;border:2px solid ${markColor};margin-bottom:16px`;
        document.querySelector(".content").prepend(title);
        const marks = [
          ["#ssSuiteMsg", "Draft help"],
          ["#oauthConnectBox", "Connection setup"],
          ["#vWhat", "Copy-check guidance"],
          ["#approvalBody", "Approval instructions"],
        ];
        for (const [selector, caption] of marks) {
          const element = document.querySelector(selector);
          if (!element) continue;
          element.style.boxShadow = `inset 0 0 0 2px ${markColor}`;
          const label = document.createElement("div");
          label.textContent = caption;
          label.style.cssText = `color:${markColor};font:600 12px sans-serif;padding:4px 0;margin-top:8px`;
          element.insertAdjacentElement("beforebegin", label);
        }
      }, version);
      const file = path.join(EVIDENCE, `social-copy-${version}-${width}-review.webp`);
      await page.screenshot({ path: file, fullPage: true, type: "webp", quality: 78 });
      console.log(JSON.stringify({ version, width, file, bytes: fs.statSync(file).size, pageErrors: errors }));
      if (version === "after" && width === 1440) {
        await page.setViewportSize({ width: 1440, height: 900 });
        const topFile = path.join(EVIDENCE, "social-copy-after-1440-top-review.webp");
        await page.screenshot({ path: topFile, type: "webp", quality: 78 });
        console.log(JSON.stringify({ version, width, height: 900, file: topFile, bytes: fs.statSync(topFile).size }));
      }
      if (errors.length) throw new Error(errors.join("; "));
      await context.close();
    }
  }
  if (writeRequests) throw new Error(`Unexpected write attempts: ${writeRequests}`);
  console.log("Review captured with zero API writes and zero live connections.");
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
