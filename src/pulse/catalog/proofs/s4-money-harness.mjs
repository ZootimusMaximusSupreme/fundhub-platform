// Helpers for the FinanceOS money screens: the standalone page (money-banks.html)
// and the same section inside the one-page frame (financeos.html#banks). Both
// call GET and POST on /api/money/<resource>; the test answers both.

import fs from "node:fs";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { OWNER, bodyOf, json } from "./s4-screen-harness.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");

/** One of the sample answers the money screens are already tested against. */
export function sampleAnswer(name) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, "src/http/fixtures", name), "utf8"));
}

export const STAFF = { ok: true, staff: { ...OWNER.staff, role: "funding_advisor" } };
export const CLIENT = { ok: true, staff: { ...OWNER.staff, role: "client" } };
export const CLIENT_ID = "c1000000-0000-4000-8000-000000000001";

/**
 * A fake /api/money/<resource> (or a full path such as /api/blueprint/declines). GET answers `read()`; POST records the body and
 * answers `write(body)` (default: ok; it may be async). Both are logged in order on `log`.
 */
export function moneyResource(resource, { read, readStatus = 200, write = () => ({ status: 200, body: { ok: true } }) }) {
  const log = { reads: [], posts: [] };
  const handler = async (route, { url, method }) => {
    if (method === "POST") {
      const body = bodyOf(route);
      log.posts.push(body);
      const out = await write(body);
      return route.fulfill({ status: out.status, contentType: "application/json", body: JSON.stringify(out.body) });
    }
    log.reads.push(new URL(url).search);
    return json(route, typeof read === "function" ? read() : read, readStatus);
  };
  const path = resource.startsWith("/") ? resource : `/api/money/${resource}`;
  return { log, handlers: { [path]: handler } };
}

/** Where a money section opens: the standalone page, or its tab in the frame. */
export function entryUrl(entry, { file, tab, clientId }) {
  const query = clientId ? `?client_id=${clientId}` : "";
  return entry === "frame" ? `/app/financeos.html${query}#${tab}` : `/app/${file}${query}`;
}

// Generous, because the focused proof run starts every test file at once.
export async function waitFor(done, ms = 20_000) {
  const end = Date.now() + ms;
  while (!done() && Date.now() < end) await new Promise((resolve) => setTimeout(resolve, 25));
  if (!done()) throw new Error("timed out waiting for the page");
}

/**
 * The fake "Connect a bank" flow the Overview and Accounts screens share:
 * email verification, authenticator and consent, then Link token and exchange.
 * Every code and grant is fake, and the bank's window finishes by itself.
 */
export function bankLink() {
  const posts = [];
  const mfaPosts = [];
  let emailVerified = false;
  const grantToken = "fake-plaid-grant-token";
  const mfa = async (route) => {
    const body = bodyOf(route);
    mfaPosts.push(body);
    if (body.action === "setup") return json(route, emailVerified
      ? { ok: true, enrolled: false, secret: "FAKE-SETUP-KEY", consent_text: "I agree to connect my bank.", privacy_url: "/privacy/" }
      : { ok: true, enrolled: false, email_verification_required: true });
    if (body.action === "verify_email") {
      if (body.email_code !== "123456") return json(route, { ok: false, error: "invalid_email_code" }, 400);
      emailVerified = true;
      return json(route, { ok: true });
    }
    if (body.action === "authorize") {
      if (!emailVerified || body.code !== "654321") return json(route, { ok: false, error: "invalid_mfa_code" }, 400);
      if (body.consent !== true) return json(route, { ok: false, error: "consent_required" }, 400);
      return json(route, { ok: true, grant_token: grantToken });
    }
    return json(route, { ok: false, error: "action_required" }, 400);
  };
  const answer = (name) => async (route) => {
    const body = bodyOf(route);
    posts.push({ path: name, body });
    if (body.plaid_grant_token !== grantToken || !emailVerified || !mfaPosts.some((p) => p.action === "authorize" && p.consent === true)) {
      return json(route, { ok: false, error: "mfa_required" }, 403);
    }
    return json(route, name === "link-token" ? { ok: true, link_token: "fake-link-token" } : { ok: true });
  };
  return {
    posts,
    mfaPosts,
    handlers: { "/api/auth/plaid-mfa": mfa, "/api/banking/link-token": answer("link-token"), "/api/banking/link-exchange": answer("link-exchange") },
    completeStepUp: async (page) => {
      const dialog = page.locator("dialog.fh-plaid-stepup");
      await dialog.getByRole("heading", { name: "Check your email" }).waitFor();
      assert.deepEqual(posts, [], "Link has not started before email verification");
      await dialog.locator('[name="email_code"]').fill("123456");
      await dialog.getByRole("button", { name: "Verify email" }).click();
      await dialog.getByRole("heading", { name: "Verify before connecting your bank" }).waitFor();
      assert.equal(await dialog.locator(".fh-plaid-stepup-secret").innerText(), "FAKE-SETUP-KEY");
      assert.match(await dialog.locator(".fh-plaid-stepup-consent").innerText(), /agree to connect my bank/);
      await dialog.locator('[name="code"]').fill("654321");
      await dialog.locator('[name="consent"]').check();
      assert.deepEqual(posts, [], "Link has not started before authenticator code and consent");
      await dialog.getByRole("button", { name: "Verify and connect" }).click();
    },
    expectedMfa: () => [
      { action: "setup", target_kind: "client_bank" },
      { action: "verify_email", target_kind: "client_bank", email_code: "123456" },
      { action: "setup", target_kind: "client_bank" },
      { action: "authorize", target_kind: "client_bank", code: "654321", consent: true },
    ],
    stubBankWindow: (page) => page.route("https://cdn.plaid.com/**", (route) => route.fulfill({
      contentType: "text/javascript",
      body: "window.Plaid={create:function(c){return{open:function(){setTimeout(function(){c.onSuccess('fake-public-token',{institution:{institution_id:'ins_sample',name:'Sample Bank'}})},0)}}}};",
    })),
    // What the page must have sent, in order, for one finished connect.
    expected: (clientId) => [
      { path: "link-token", body: { ...(clientId ? { client_id: clientId } : {}), plaid_grant_token: grantToken } },
      { path: "link-exchange", body: { public_token: "fake-public-token", institution: { institution_id: "ins_sample", name: "Sample Bank" }, plaid_grant_token: grantToken, ...(clientId ? { client_id: clientId } : {}) } },
    ],
  };
}
