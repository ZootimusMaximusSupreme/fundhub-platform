// Proves the consent capture screen (public/app/consent-capture.html): the
// wording, version and status come from the server; the three ways to agree,
// the name and expiry boxes and the signature pad send the right capture method
// and refuse what is missing before anything is sent.

import { test } from "node:test";
import assert from "node:assert/strict";

import { OWNER, bodyOf, json, proofRows, startScreens } from "./s4-screen-harness.mjs";
import { waitFor } from "./s4-money-harness.mjs";

const proof = proofRows(import.meta.url);
const CLIENT = "ac1ac964-e02b-468b-9cbe-7030e03dd13b";

const read = (kind, { status = { valid: false, reason: "none_on_file" }, disclosure = true, history = [] } = {}) => ({
  ok: true, kind, status, history,
  disclosure: disclosure ? { version: "2.1", text: `The ${kind} wording the client reads.` } : null,
});

async function openScreen(open, { kind = "", status, disclosure, history } = {}) {
  const posts = [];
  const handlers = {
    "/api/consent/capture": async (route, { method, url }) => {
      if (method === "POST") {
        posts.push(bodyOf(route));
        return json(route, { ok: true });
      }
      const asked = new URL(url).searchParams.get("kind") || "soft_pull_consent";
      return json(route, read(asked, { status, disclosure, history }));
    },
  };
  const opened = await open(`/app/consent-capture.html?client_id=${CLIENT}${kind ? `&kind=${kind}` : ""}`, { session: OWNER, handlers });
  await opened.page.waitForFunction(() => document.querySelector("#ccVersion")?.textContent !== "—" || /do not record/i.test(document.querySelector("#ccDisclosure")?.textContent || ""));
  return { ...opened, posts };
}

async function drawSignature(page) {
  const pad = page.locator("#ccSignPad");
  await pad.scrollIntoViewIfNeeded();
  const box = await pad.boundingBox();
  await page.mouse.move(box.x + 30, box.y + 80);
  await page.mouse.down();
  for (let i = 1; i <= 12; i += 1) await page.mouse.move(box.x + 30 + i * 18, box.y + 80 + (i % 2 ? -25 : 25));
  await page.mouse.up();
}

test("the wording, the version and the status come from the server, never from the page", { timeout: 60_000 }, async (t) => {
  const { open } = await startScreens(t);
  await proof.check(/^Consent wording, version badge and current status banner/, async () => {
    const none = await openScreen(open);
    assert.equal(await none.page.locator("#ccVersion").innerText(), "2.1");
    assert.equal(await none.page.locator("#ccDisclosure").innerText(), "The soft_pull_consent wording the client reads.");
    assert.match(await none.page.locator("#ccStatus").innerText(), /No consent on file/);
    await none.page.close();

    const valid = await openScreen(open, { status: { valid: true, reason: "valid", consent: { expires_at: "2027-10-10T00:00:00Z" } } });
    assert.match(await valid.page.locator("#ccStatus").innerText(), /expires on/i);
    assert.equal(await valid.page.locator("#ccStatus").getAttribute("class"), "cc-status is-valid");
    await valid.page.close();

    const withdrawn = await openScreen(open, { status: { valid: false, reason: "revoked", consent: { revoked_at: "2026-10-05T12:00:00Z", revoked_reason: "asked to stop" } } });
    assert.match(await withdrawn.page.locator("#ccStatus").innerText(), /Consent was withdrawn[\s\S]*Withdrawn on [A-Z][a-z]{2} \d{1,2}, 2026\. Reason given: asked to stop\./);
    await withdrawn.page.close();

    const noWords = await openScreen(open, { disclosure: false });
    assert.equal(await noWords.page.locator("#ccVersion").innerText(), "—");
    assert.match(await noWords.page.locator("#ccDisclosure").innerText(), /do not record a consent/i);
    assert.equal(await noWords.page.locator("#ccSubmit").isDisabled(), true, "with no server wording nothing can be recorded");
    await noWords.page.close();
  });
});

test("the three ways to agree and the name and expiry boxes send the right method", { timeout: 60_000 }, async (t) => {
  const { open } = await startScreens(t);
  const { page, posts } = await openScreen(open);

  await proof.check(/^Name box, Expires date box/, async () => {
    await page.locator("#ccSubmit").click();
    assert.match(await page.locator("#ccMsg").innerText(), /Type the name exactly as the client gave it\./);
    assert.deepEqual(posts, [], "a typed consent with no name sends nothing");
    await page.locator("#ccName").fill("  Dana Whitfield ");
    await page.locator("#ccExpires").fill("2027-10-10");
    await page.locator("#ccSubmit").click();
    await waitFor(() => posts.length === 1);
    assert.deepEqual(posts[0], {
      client_id: CLIENT, kind: "soft_pull_consent", action: "grant", capture_method: "typed",
      granted_name: "Dana Whitfield", consent_version: "2.1", expires_at: "2027-10-10",
    });
    await page.waitForFunction(() => document.querySelector("#ccName").value === "");
    assert.match(await page.locator("#ccMsg").innerText(), /Consent recorded\./);
  });

  await proof.check(/^How did they agree: 'They typed their name'/, async () => {
    posts.length = 0;
    await page.locator('.cc-method[data-method="checkbox"]').click();
    assert.equal(await page.locator("#ccNameField").isHidden(), true, "a ticked box needs no name");
    await page.locator("#ccSubmit").click();
    await waitFor(() => posts.length === 1);
    assert.equal(posts[0].capture_method, "checkbox");
    assert.equal(posts[0].granted_name, null);
    await page.locator('.cc-method[data-method="signature"]').click();
    assert.equal(await page.locator("#ccSignField").isVisible(), true);
    await page.locator("#ccName").fill("Dana Whitfield");
    await drawSignature(page);
    await page.locator("#ccSubmit").click();
    await waitFor(() => posts.length === 2);
    assert.equal(posts[1].capture_method, "signature");
    assert.equal(posts[1].granted_name, "Dana Whitfield");
    await page.locator('.cc-method[data-method="typed"]').click();
    assert.equal(await page.locator("#ccNameField").isVisible(), true, "They typed their name brings the name box back");
  });
  await page.close();
});

test("an empty signature pad is refused; Clear empties it again", { timeout: 60_000 }, async (t) => {
  const { open } = await startScreens(t);
  const { page, posts } = await openScreen(open);
  await proof.check(/^Signature pad \(draw\) and its Clear button; empty pad refused/, async () => {
    await page.locator('.cc-method[data-method="signature"]').click();
    await page.locator("#ccName").fill("Dana Whitfield");
    await page.locator("#ccSubmit").click();
    assert.match(await page.locator("#ccMsg").innerText(), /Draw your signature in the box\. An empty box does not count\./);
    assert.deepEqual(posts, []);
    await drawSignature(page);
    await page.locator("#ccSignClear").click();
    await page.locator("#ccSubmit").click();
    assert.match(await page.locator("#ccMsg").innerText(), /Draw your signature in the box/);
    assert.deepEqual(posts, [], "a cleared pad is empty again");
    await drawSignature(page);
    await page.locator("#ccSubmit").click();
    await waitFor(() => posts.length === 1);
    assert.equal(posts[0].capture_method, "signature");
  });
  await page.close();
});

test("every listed row was exercised", () => {
  proof.assertAllClaimed();
});
