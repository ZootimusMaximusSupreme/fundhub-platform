// Proves the public forms that take a person's details: the partner and
// enrollment applications, the homepage survey, the sign-in form, the roadmap
// intake, the soft-pull identity form and the CRM entry link. Each is a real
// page in Chromium; the server answers are fakes and every request is checked
// for the exact fields, and for what is refused before anything is sent.

import { test } from "node:test";
import assert from "node:assert/strict";

import { bodyOf, json, proofRows, startScreens } from "./s4-screen-harness.mjs";
import { waitFor } from "./s4-money-harness.mjs";

const proof = proofRows(import.meta.url);
const PERSON = "Dana Whitfield";
const MAIL = "dana@example.com";

// A stand-in for "the server": records POST bodies for one path, answers `answer`.
function recorder(path, answer) {
  const posts = [];
  return {
    posts,
    handlers: {
      [path]: async (route, { method }) => {
        if (method !== "POST") return json(route, { ok: true });
        posts.push(bodyOf(route));
        const out = typeof answer === "function" ? answer(posts.at(-1)) : answer;
        return json(route, out.body, out.status || 200);
      },
    },
  };
}

test("partner application: required boxes, a real email, then the exact application", { timeout: 60_000 }, async (t) => {
  const { open } = await startScreens(t);
  await proof.check(/^Partner application form/, async () => {
    const api = recorder("/api/public/partner-apply", { body: { ok: true, kind: "affiliate", email: MAIL, password: null, referral_url: "https://fundhub.ai/r/dana" } });
    const { page } = await open("/affiliates/", { handlers: api.handlers });
    const alerts = [];
    page.on("dialog", (dialog) => { alerts.push(dialog.message()); dialog.accept(); });
    await page.locator('#pform button[type="submit"]').click();
    await waitFor(() => alerts.length === 1);
    assert.match(alerts[0], /We need this one to continue/);
    await page.locator("#p-name").fill(PERSON);
    await page.locator("#p-email").fill("not-an-address");
    await page.locator("#p-track").selectOption("white_label");
    await page.locator("#p-aud").fill("A podcast list");
    await page.locator('#pform button[type="submit"]').click();
    await waitFor(() => alerts.length === 2);
    assert.match(alerts[1], /doesn't look complete/);
    assert.deepEqual(api.posts, [], "nothing is sent until the form is right");
    await page.locator("#p-email").fill(MAIL);
    await page.locator("#p-phone").fill("602-555-0100");
    await page.locator("#p-co").fill("Whitfield Media");
    await page.locator("#p-sms").check();
    await page.locator('#pform button[type="submit"]').click();
    await waitFor(() => api.posts.length === 1);
    assert.deepEqual(api.posts[0], {
      name: PERSON, email: MAIL, phone: "602-555-0100", company: "Whitfield Media",
      track: "white_label", audience: "A podcast list", sms_consent: true,
    });
    await page.waitForFunction(() => getComputedStyle(document.querySelector("#success")).display === "block");
    await page.close();
  });
});

test("enrollment application: program, name and a real email, then the exact request", { timeout: 60_000 }, async (t) => {
  const { open } = await startScreens(t);
  await proof.check(/^Enrollment application: program, name, email, phone, SMS consent/, async () => {
    const api = recorder("/api/public/education-enroll", { body: { ok: true } });
    const { page } = await open("/education/enroll/?program=credit-mastery", { handlers: api.handlers });
    assert.equal(await page.locator("#program").inputValue(), "credit-mastery", "the program in the link is picked");
    await page.locator("#submit-btn").click();
    assert.deepEqual(api.posts, [], "no name and no email sends nothing");
    await page.locator("#name").fill(PERSON);
    await page.locator("#email").fill(MAIL);
    await page.locator("#phone").fill("602-555-0100");
    await page.locator("#sms").check();
    await page.locator("#submit-btn").click();
    await waitFor(() => api.posts.length === 1);
    const sent = api.posts[0];
    assert.deepEqual({ program: sent.program, full_name: sent.full_name, email: sent.email, phone: sent.phone, sms_consent: sent.sms_consent },
      { program: "credit-mastery", full_name: PERSON, email: MAIL, phone: "602-555-0100", sms_consent: true });
    assert.match(sent.page_url, /\/education\/enroll\/\?program=credit-mastery$/);
    await page.waitForFunction(() => getComputedStyle(document.querySelector("#success")).display === "block");
    assert.match(await page.locator("#success").innerText(), /You have not been charged/);
    await page.close();

    // a refusal is a problem box and a button to try again, never a success panel
    const refuse = recorder("/api/public/education-enroll", { status: 500, body: { ok: false } });
    const bad = await open("/education/enroll/", { handlers: refuse.handlers });
    await bad.page.locator("#program").selectOption({ index: 1 });
    await bad.page.locator("#name").fill(PERSON);
    await bad.page.locator("#email").fill(MAIL);
    await bad.page.locator("#submit-btn").click();
    await bad.page.waitForFunction(() => getComputedStyle(document.querySelector("#submit-problem")).display === "block");
    assert.equal(await bad.page.locator("#success").isHidden(), true);
    await bad.page.close();
  });
});

test("homepage survey: each answer is kept, the contact step is last, the answers are sent, then it goes where the server says", { timeout: 90_000 }, async (t) => {
  const { open } = await startScreens(t);
  await proof.check(/^Homepage survey: a multi-step form/, async () => {
    const api = recorder("/api/public/survey-submit", { body: { ok: true, redirect: "/roadmap/?thanks=1" } });
    const { page } = await open("/", { handlers: api.handlers });
    await page.waitForSelector("#appform .sv-opt");
    const answerNext = async (option) => {
      await page.locator("#appform .sv-opt", { hasText: option }).first().click();
      await page.locator('#appform [data-act="next"]').click();
    };
    await page.locator('#appform [data-act="next"]').click();
    assert.match(await page.locator("#appform .sv-err").innerText(), /We need this one to continue/);
    await answerNext("$100k - $200k");
    await answerNext("Growth (marketing, inventory, hiring)");
    await page.locator("#appform .sv-opt", { hasText: "Stability" }).click();
    await page.locator('#appform [data-act="next"]').click();
    await answerNext("650-699");
    await answerNext("No");
    await answerNext("Yes, 1-2 years");
    await answerNext("$250k - $499k");
    await answerNext("Yes, bank statements");
    await answerNext("$5k - $25k");
    await page.locator("#sv-name").fill(PERSON);
    await page.locator("#sv-email").fill("bad");
    await page.locator('#appform [data-act="submit"]').click();
    assert.match(await page.locator("#appform .sv-err").innerText(), /doesn't look complete/);
    assert.deepEqual(api.posts, []);
    await page.locator("#sv-email").fill(MAIL);
    await page.locator("#sv-phone").fill("602-555-0100");
    await page.locator("#sv-sms").check();
    await page.locator('#appform [data-act="submit"]').click();
    await waitFor(() => api.posts.length === 1);
    const sent = api.posts[0];
    assert.equal(sent.name, PERSON);
    assert.equal(sent.email, MAIL);
    assert.equal(sent.phone, "602-555-0100");
    assert.equal(sent.sms_consent, true);
    assert.equal(sent.source, "website:home");
    assert.deepEqual(sent.answers, {
      cf_svy_funding_target_amount: "$100k - $200k", cf_svy_planned_use: "Growth (marketing, inventory, hiring)",
      cf_svy_money_change_now: ["Stability (cover bills / buffer slow weeks)"], cf_svy_self_reported_fico: "650-699",
      cf_svy_has_negatives: "No", cf_svy_has_business: "Yes, 1-2 years", cf_svy_business_revenue: "$250k - $499k",
      cf_svy_revenue_verifiable: "Yes, bank statements", cf_svy_available_capital: "$5k - $25k",
    });
    await page.waitForURL(/\/roadmap\/\?thanks=1$/);
    await page.close();
  });
});

test("sign-in: email and password go to the server; a refusal is said; a good answer stores the session and goes on", { timeout: 60_000 }, async (t) => {
  const { open } = await startScreens(t);
  await proof.check(/^Staff and demo sign-in: email and password/, async () => {
    const testWord = `pw-${Date.now()}`;
    const bad = recorder("/api/auth/login", { status: 401, body: { ok: false, error: "invalid_credentials" } });
    const first = await open("/login.html?next=/app/messaging.html", { session: null, handlers: { ...bad.handlers } });
    await first.page.locator("#email").fill("jordan@fundhub.ai");
    await first.page.locator("#pw").fill(testWord);
    await first.page.locator("#go").click();
    await waitFor(() => bad.posts.length === 1);
    assert.deepEqual(bad.posts[0], { email: "jordan@fundhub.ai", password: testWord });
    await first.page.waitForFunction(() => /Wrong email or password\./.test(document.querySelector("#err")?.innerText || ""));
    assert.equal(await first.page.evaluate(() => localStorage.getItem("fh_token")), null, "a refusal stores no session");
    await first.page.close();

    const good = recorder("/api/auth/login", { body: { ok: true, token: "session-token-for-test", staff: { id: "s1", name: "Jordan Blake", role: "Owner" } } });
    // the page it goes to is blank, so nothing rewrites the stored session before it is read
    const blank = (page) => page.route((url) => url.pathname === "/app/messaging.html", (route) => route.fulfill({ contentType: "text/html", body: "<!doctype html><title>next</title>" }));
    const second = await open("/login.html?next=/app/messaging.html", { session: null, handlers: { ...good.handlers }, before: blank });
    await second.page.locator("#email").fill("jordan@fundhub.ai");
    await second.page.locator("#pw").fill(testWord);
    await second.page.locator("#go").click();
    await second.page.waitForURL(/\/app\/messaging\.html$/);
    await second.page.waitForFunction(() => localStorage.getItem("fh_token") === "session-token-for-test");
    await second.page.waitForFunction(() => localStorage.getItem("fh_role") === "owner");
    await second.page.close();
  });
});

test("roadmap intake: a first name is required, then the roadmap is read and drawn with the goal", { timeout: 60_000 }, async (t) => {
  const { open } = await startScreens(t);
  await proof.check(/^Roadmap intake: first name, last name, email, goal/, async () => {
    const reads = [];
    const handlers = {
      "/api/public/optimize": async (route, { url }) => {
        reads.push(new URL(url).search);
        return json(route, { ok: true, source: "sample", bookUrl: "https://example.test/book", accounts: [], findings: [], rounds: [] });
      },
    };
    const { page, errors } = await open("/optimize-plan.html", { handlers });
    await page.waitForSelector("#intake");
    await page.locator("#build").click();
    assert.match(await page.locator("#err").innerText(), /put in your first name/);
    assert.equal(reads.filter((r) => r.includes("view=roadmap")).length, 0, "no roadmap is asked for without a name");
    await page.locator("#first").fill("Dana");
    await page.locator("#last").fill("Whitfield");
    await page.locator("#email").fill(MAIL);
    await page.locator("#goal").selectOption("Get funding for my business");
    await page.locator("#build").click();
    await page.waitForFunction(() => document.querySelector("#plantitle")?.textContent === "Dana's Plan");
    assert.equal(await page.locator("#plangoal").innerText(), "What you told us you want: get funding for my business.");
    assert.equal(await page.locator("#sample").isVisible(), true, "an example file says it is an example");
    assert.deepEqual(reads.filter((r) => r.includes("view=roadmap")), ["?view=roadmap"], "the roadmap read carries no personal details");
    assert.deepEqual(errors, []);
    await page.close();
  });
});

test("soft-pull identity form: every box and the consent are required, the order link is required, SSN goes in the body only", { timeout: 60_000 }, async (t) => {
  const { open } = await startScreens(t);
  await proof.check(/^Pull form after paying: name, date of birth, SSN/, async () => {
    const api = recorder("/api/public/slo-pull", { body: { ok: true } });
    const handlers = { ...api.handlers, "/api/public/slo-checkout": { ok: true, priceDisplay: "$32" } };
    const { page } = await open("/roadmap/pull.html?ref=order-77&client_id=c-1", { handlers });
    await page.locator("#submitBtn").click();
    assert.match(await page.locator("#formErr").innerText(), /Please fill in your legal first name/);
    const fill = async () => {
      await page.locator("#first").fill("Dana");
      await page.locator("#last").fill("Whitfield");
      await page.locator("#dob").fill("1985-04-12");
      await page.locator("#ssn").fill("123-45-6789");
      await page.locator("#addr").fill("12 Main St");
      await page.locator("#city").fill("Phoenix");
      await page.locator("#state").fill("AZ");
      await page.locator("#zip").fill("85004");
    };
    await fill();
    await page.locator("#submitBtn").click();
    assert.match(await page.locator("#formErr").innerText(), /check the box to authorize the soft pull/);
    await page.locator("#consent").check();
    await page.locator("#submitBtn").click();
    await waitFor(() => api.posts.length === 1);
    assert.deepEqual(api.posts[0], {
      ref: "order-77", client_id: "c-1", first_name: "Dana", last_name: "Whitfield", dob: "1985-04-12", ssn: "123-45-6789",
      address: "12 Main St", city: "Phoenix", state: "AZ", zip: "85004", consent: true,
    });
    assert.equal(await page.locator("#ssn").inputValue(), "", "the number is cleared once sent");
    assert.doesNotMatch(page.url(), /ssn|123-45/, "the number is never in the address bar");
    await page.close();

    // opened without the order link: refused on the page, nothing sent
    const noLink = await open("/roadmap/pull.html", { handlers });
    for (const [id, value] of [["first", "Dana"], ["last", "Whitfield"], ["dob", "1985-04-12"], ["ssn", "123-45-6789"], ["addr", "12 Main St"], ["city", "Phoenix"], ["state", "AZ"], ["zip", "85004"]]) {
      await noLink.page.locator(`#${id}`).fill(value);
    }
    await noLink.page.locator("#consent").check();
    await noLink.page.locator("#submitBtn").click();
    assert.match(await noLink.page.locator("#formErr").innerText(), /Open this page from your order link/);
    assert.equal(api.posts.length, 1, "no second request without the order link");
    await noLink.page.close();
  });
});

test("the old CRM address sends people on to the app and clears the demo flags", { timeout: 60_000 }, async (t) => {
  const { open } = await startScreens(t);
  await proof.check(/^Link 'Continue to Fundhub' to \/app\//, async () => {
    const blank = (page) => page.route((url) => url.pathname === "/app/", (route) => route.fulfill({ contentType: "text/html", body: "<!doctype html><title>app</title>" }));
    const { page } = await open("/crm.html", { session: null, init: () => { if (!sessionStorage.getItem("seeded")) { localStorage.setItem("fh_demo", "1"); sessionStorage.setItem("seeded", "1"); } }, before: blank });
    await page.waitForURL(/\/app\/$/);
    await page.waitForFunction(() => localStorage.getItem("fh_demo") === null);
    await page.close();
  });
});

test("every listed row was exercised", () => {
  proof.assertAllClaimed();
});
