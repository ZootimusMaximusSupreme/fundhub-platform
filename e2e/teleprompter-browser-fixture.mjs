import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test as base, expect } from "@playwright/test";

/* Media-file tests need regular WebKit storage, not its ephemeral/private
 * data store. The installed ephemeral build cannot persist even a four-byte
 * Blob. Use an empty, isolated profile; never the owner's Safari profile.
 * Chromium continues using the standard Playwright fixtures unchanged. */
export const test = process.env.FHTP_WEBKIT_FILES === "1" ? base.extend({
  context: async ({ playwright, browserName, contextOptions, baseURL, viewport, userAgent, isMobile, hasTouch }, use) => {
    if (browserName !== "webkit") throw new Error("FHTP_WEBKIT_FILES requires the WebKit project");
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), "fundhub-webkit-files-"));
    const context = await playwright.webkit.launchPersistentContext(profile, {
      ...contextOptions, baseURL, viewport, userAgent, isMobile, hasTouch, headless: true
    });
    try { await use(context); }
    finally { await context.close(); fs.rmSync(profile, { recursive: true, force: true }); }
  }
}) : base;
export { expect };
