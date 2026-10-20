import { test, expect } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import { openScreen, OWNER } from "./harness.mjs";

const EMPTY_COPY = "Write a post to preview its copy check.";
const PARTNER = "social-copy-fixture";
const CHANNEL = "social-copy-channel";
const fixture = {
  "/api/read/partners": { ok: true, items: [{ id: PARTNER, name: "Fictional copy review" }] },
  "/api/social/channels": {
    ok: true,
    items: [{
      id: CHANNEL, partner_id: PARTNER, channel: "facebook", handle: "@fictional-review",
      external_account_id: "fictional-account", connection_state: "active",
      has_access_token: false, has_refresh_token: false, timezone: "UTC",
      scopes: [], best_times: {}
    }]
  },
  "/api/social/settings": { ok: true, settings: { stored: true, approve_before_launch: false } },
  "/api/social/posts": { ok: true, items: [], tasks: [] },
  "/api/partner-marketing/usage": { ok: true, enabled: false, remaining: 0 }
};

async function expectEmpty(page) {
  await expect(page.locator("#vWhat")).toHaveText(EMPTY_COPY);
  await expect(page.locator("#vState")).toHaveText("—");
  await expect(page.locator("#vCount")).toHaveText("nothing checked yet");
  await expect(page.locator("#vReasons")).toBeEmpty();
  await expect(page.locator("#capCount")).toHaveText("0 letters");
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
}

async function markCopy(page, info, state) {
  await page.locator("#vWhat").scrollIntoViewIfNeeded();
  await page.locator("#vWhat").evaluate((element, caption) => {
    const r = element.getBoundingClientRect();
    const layer = document.createElement("div");
    layer.id = "social-copy-proof-mark";
    layer.style.cssText = "position:fixed;inset:0;pointer-events:none;z-index:2147483647";
    const box = document.createElement("div");
    box.style.cssText = `position:absolute;left:${r.left - 2}px;top:${r.top - 2}px;width:${r.width + 4}px;height:${r.height + 4}px;border:2px solid #c52b2b;box-sizing:border-box`;
    const label = document.createElement("div");
    label.textContent = `LOCAL · ${caption} · Fictional data; no sends`;
    label.style.cssText = "position:absolute;bottom:8px;left:8px;right:8px;background:white;color:#111;border:2px solid #c52b2b;padding:8px;font:13px/1.4 system-ui";
    layer.append(box, label);
    document.body.append(layer);
  }, `${page.viewportSize().width}px ${state}`);
  const file = info.outputPath(`${state}-MARKED.png`);
  await page.screenshot({ path: file });
  await info.attach(`${state}-marked`, { path: file, contentType: "image/png" });
  await page.locator("#social-copy-proof-mark").evaluate(element => element.remove());
}

for (const width of [1440, 390]) {
  for (const hasPartner of [false, true]) {
    test(`Social short empty copy survives load and Clear at ${width}, ${hasPartner ? "fictional partner" : "no partner (DP06)"}`, async ({ page, baseURL }, info) => {
      await page.setViewportSize({ width, height: 900 });
      const writes = [];
      const allowedStatic = [];
      const blockedExternal = [];
      page.on("request", request => {
        if (!["GET", "HEAD"].includes(request.method())) writes.push(`${request.method()} ${new URL(request.url()).pathname}`);
      });
      // openScreen installs later API handlers; every API response is fictional.
      // This outer route permits only local static reads to reach a server.
      await page.route("**/*", route => {
        const request = route.request();
        const url = new URL(request.url());
        if (url.origin !== new URL(baseURL).origin) {
          blockedExternal.push(`${request.method()} ${url.origin}${url.pathname}`);
          return route.abort();
        }
        if (!["GET", "HEAD"].includes(request.method()) || url.pathname.startsWith("/api/")) return route.abort();
        allowedStatic.push(url.pathname);
        return route.continue();
      });
      const errors = await openScreen(page, "/app/social-studio.html", OWNER, hasPartner ? fixture : {});
      await expect(page.locator("#partnerSel")).toHaveText(hasPartner ? "Fictional copy review" : "No partners on file");
      if (hasPartner) {
        await expect(page.locator("#cChannel")).toHaveValue(CHANNEL);
        await expect(page.locator("#approvalBody")).toContainText("saved setting");
        await expect(page.locator("#ssSuiteTxt")).toHaveText("Writing off · 0 left");
      }
      // The exact DP06 assertions, after asynchronous page initialization.
      await expect(page.locator("#ssSuiteMsg")).toHaveText("Brand-matched drafts. Review them below before sending.");
      const connection = await page.locator("#oauthConnectBox").evaluate(element =>
        Array.from(element.childNodes).filter(node => node.nodeType === Node.TEXT_NODE || node.nodeName === "B")
          .map(node => node.textContent).join(" ").replace(/\s+/g, " ").trim());
      expect(connection).toBe("Connect Facebook, Instagram or LinkedIn. Other networks are unavailable. Disabled buttons mean setup is needed. Sign-in keys stay private.");
      await expectEmpty(page);
      await page.locator("#runScreen").click();
      await expectEmpty(page);
      await markCopy(page, info, "settled-initial");

      // A populated verdict must still require a topic and apply the same rules.
      await page.locator("#cCaption").fill("Fictional copy review.");
      await expect(page.locator("#vState")).toHaveText("Refused");
      await expect(page.locator("#vReasons")).toContainText("Choose what this post is about first.");
      await page.locator("#cOffer").selectOption("funding");
      // An unread approval setting retains the page's existing safe default.
      await expect(page.locator("#vState")).toHaveText(hasPartner ? "Looks fine" : "Someone must approve it");
      await expect(page.locator("#vWhat")).toContainText(hasPartner ? "no send time" : "An owner or admin must approve it");
      await page.locator("#cWhen").fill("2030-01-02T09:15");
      const account = await page.locator("#cChannel").inputValue();
      await page.locator("#clearComposer").click();
      for (const id of ["cCaption", "cOffer", "cAsset", "cWhen"]) await expect(page.locator(`#${id}`)).toHaveValue("");
      await expect(page.locator("#cChannel")).toHaveValue(account);
      await expectEmpty(page);
      await page.locator("#runScreen").click();
      await expectEmpty(page);
      await expect(page.locator("#queueBtn")).toBeEnabled({ enabled: hasPartner });
      await expect(page.locator("#publishDueBtn")).toBeEnabled({ enabled: hasPartner });
      await expect(page.locator("#ssGenBtn")).toBeDisabled();
      await expect(page.locator("#cAsset")).toBeDisabled();
      await markCopy(page, info, "empty-reset");
      expect(errors).toEqual([]);
      expect(writes, "No API or other write was attempted").toEqual([]);
      expect(allowedStatic.some(path => path.startsWith("/api/"))).toBe(false);
      const receipt = info.outputPath("local-read-only-receipt.json");
      await writeFile(receipt, JSON.stringify({ width, hasPartner, text: await page.locator("#vWhat").innerText(), writes, errors, allowedStatic, blockedExternal }, null, 2));
      await info.attach("local-read-only-receipt", { path: receipt, contentType: "application/json" });
    });
  }
}
