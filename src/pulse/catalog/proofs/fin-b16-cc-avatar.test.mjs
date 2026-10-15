// Batch 16 practice tests: "Build the avatar" on the flywheel's step-1 row of the Today tab
// (public/app/marketing-avatar-row.js inside marketing-command-center.html), in a real Chromium with fake
// /api answers. No live data, nothing started, no spend.
//
// This is the SCREEN half of the live check "Build the avatar" (the live check reads the saved run:
// fin-b16-display-contracts.mjs avatarSql). The row's own words name the parts pressed here: the cost line and
// the cost sheet before the tap, the run, the live step words while it goes, and Retry after a stop.

import { test } from "node:test";
import assert from "node:assert/strict";

import { bodyOf, json, proofRows, sharedScreens, OWNER, waitFor } from "./fin-b16-kit.mjs";
import { NOW, today } from "./fin-b16-cc-today-kit.mjs";

const proof = proofRows(import.meta.url);
const screens = sharedScreens();

const ROW = /^Today: 'Build the avatar' button on step 1/;
const ACT = 'li.row[data-stage="avatar"] [data-avatar-act]';
const COST_LINE = "Cost: unknown, not measured yet. This run stops by itself at $20 (the cap is in Settings). $12.50 of $300 used this month. Web searches cost 1 cent each (Anthropic: $10 per 1,000). This run makes at most 184 searches, so at most $1.84 of it is search.";
const NEWER_COST_LINE = "Cost: about $0.67 for the last run. This run stops by itself at $20 (the cap is in Settings).";
const RUN_ID = "aaaaaaaa-0000-4000-8000-000000000001";
const RUNNING = { id: RUN_ID, status: "queued", step: "foundation", sentence: "Running: step 1 of 10, writing down the business facts. $0 spent so far, 0 searches." };
const STEP_3 = "Running: step 3 of 10, searching the web for buyer quotes, round 1. 0 new quotes so far. $0.06 spent so far, 15 searches.";
const DONE = { id: RUN_ID, status: "done", sentence: "Done. 133 quotes. Approved." };
const STOPPED_AT_CAP = { id: "bbbbbbbb-0000-4000-8000-000000000002", status: "failed", stopped_at_cap: { cap: "run" },
  sentence: "Stopped at the $20 run cap after step 6. What it found so far is saved. Raise the cap in Settings and tap Retry to finish." };
const STOPPED_PLAIN = { id: "cccccccc-0000-4000-8000-000000000003", status: "failed", sentence: "Stopped at step 4. The search service did not answer." };

const flywheel = (run) => ({
  ok: true, campaign: "partner", campaign_words: "Partner offer",
  service_description_default: "The Fundhub $10,000 white-label partnership: brokers run a funding company under their own brand.",
  owner_notes_stage_1: "2026-08-31 | stage 1 | the avatar is assumed on purpose.",
  stages: [{ n: 1, key: "avatar", label_words: "Who we sell to", sentence: "Done. 133 quotes. Approved.", run }],
  advice: null,
});

/** The five answers the row reads and writes. `current` is the run the server holds right now. */
function avatarApi({ run = null, answer = null, costs = [COST_LINE] } = {}) {
  const state = { current: run, jobStatus: "running", posts: [], jobReads: [], costReads: 0, flywheelReads: 0 };
  const handlers = {
    "/api/marketing/today": async (route) => json(route, today()),
    "/api/marketing/offer/generate": async (route) => json(route, { ok: true, ready: true, job: null, offer: null }),
    "/api/marketing/costs": async (route) => {
      const line = costs[Math.min(state.costReads, costs.length - 1)];
      state.costReads += 1;
      return json(route, { ok: true, kinds: { avatar: null }, avatar_line: line });
    },
    "/api/marketing/flywheel/run": async (route) => {
      const body = bodyOf(route);
      state.posts.push(body);
      if (answer) {
        const [status, out] = answer(body);
        return json(route, out, status);
      }
      state.current = { ...RUNNING, id: body.retry_job_id || RUNNING.id };
      return json(route, { ok: true, started: true, already_running: false, ...(body.retry_job_id ? { retried: true } : {}),
        job: state.current, poll: `/api/marketing/flywheel/job?id=${state.current.id}` }, 202);
    },
    "/api/marketing/flywheel/job": async (route, { url }) => {
      state.jobReads.push(new URL(url).searchParams.get("id"));
      const job = state.jobStatus === "done" ? DONE : { ...state.current, status: "running", sentence: STEP_3 };
      if (state.jobStatus === "done") state.current = DONE;
      return json(route, { ok: true, job });
    },
    "/api/marketing/flywheel": async (route) => { state.flywheelReads += 1; return json(route, flywheel(state.current)); },
  };
  return { state, handlers };
}

async function openToday(api, { viewport = { width: 1280, height: 900 } } = {}) {
  const before = async (page) => { await page.clock.install({ time: new Date(NOW) }); };
  const opened = await screens.open("/app/marketing-command-center.html", { session: OWNER, handlers: api.handlers, before, viewport });
  await opened.page.waitForSelector(ACT);
  return opened;
}
const startBtn = (page) => page.locator(ACT).getByRole("button", { name: "Build the avatar" });

test("the row shows the cost line, the cost sheet comes before the tap, and Start building sends the run", { timeout: 90_000 }, async () => {
  await proof.check(ROW, async () => {
    const api = avatarApi({ costs: [COST_LINE, NEWER_COST_LINE] });
    const { page, errors } = await openToday(api);
    const act = page.locator(ACT);
    assert.match(await act.innerText(), /Cost: unknown, not measured yet\. This run stops by itself at \$20/);
    assert.equal(await startBtn(page).isEnabled(), true);
    assert.equal(await page.locator("dialog.av-sheet").count(), 0, "no sheet until the tap");
    assert.deepEqual(api.state.posts, [], "nothing is started by looking at the row");

    // The tap opens the sheet first and reads the cost again, so the number on it is never stale.
    const readsBefore = api.state.costReads;
    await startBtn(page).click();
    const sheet = page.locator("dialog.av-sheet");
    await sheet.waitFor();
    assert.ok(api.state.costReads > readsBefore, "the cost is read again before the sheet shows it");
    const words = await sheet.innerText();
    assert.match(words, /Build the avatar for Partner offer\?/);
    assert.ok(words.includes(NEWER_COST_LINE), "the sheet shows the newest cost line, not the one the row was loaded with");
    assert.match(words, /the avatar is assumed on purpose/, "the owner's notes for the step");
    assert.match(words, /It spends no ad money\. Nothing goes live/);
    assert.match(await sheet.locator("#avService").inputValue(), /white-label partnership/);
    assert.deepEqual(api.state.posts, [], "the sheet alone starts nothing");

    await sheet.locator("#avService").fill("Funding, done for you, for brokers.");
    await sheet.getByRole("button", { name: "Start building" }).click();
    await waitFor(() => api.state.posts.length === 1);
    const [post] = api.state.posts;
    assert.equal(post.campaign, "partner");
    assert.equal(post.stage, 1);
    assert.equal(post.service_description, "Funding, done for you, for brokers.");
    assert.match(post.request_id, /^[A-Za-z0-9._:-]{8,200}$/);
    assert.equal("retry_job_id" in post, false, "a first run is not a retry");

    // The row answers in words, shows the step the run is on, and rests the button with its reason.
    await page.waitForFunction((sel) => /Started\. It runs on the server in 10 steps; this row shows each one\./.test(document.querySelector(sel)?.textContent || ""), ACT);
    const after = await page.locator(ACT).innerText();
    assert.match(after, /Running: step 1 of 10, writing down the business facts\./);
    assert.match(after, /It is running now\. This row shows each step as it goes\./);
    assert.equal(await startBtn(page).isDisabled(), true);
    assert.equal(await page.locator(ACT).getByRole("button", { name: /^Retry/ }).count(), 0, "no Retry while it runs");
    assert.deepEqual(errors, []);
    await page.close();
  });
});

test("Not now on the cost sheet starts nothing and closes it", { timeout: 60_000 }, async () => {
  await proof.check(ROW, async () => {
    const api = avatarApi();
    const { page } = await openToday(api);
    await startBtn(page).click();
    await page.locator("dialog.av-sheet").getByRole("button", { name: "Not now" }).click();
    await page.waitForFunction(() => document.querySelectorAll("dialog.av-sheet").length === 0);
    await page.waitForTimeout(200);
    assert.deepEqual(api.state.posts, []);
    assert.equal(await startBtn(page).isEnabled(), true, "the button is back, still ready");
    await page.close();
  });
});

test("while a run goes the row follows it step by step, and when it finishes the button comes back", { timeout: 90_000 }, async () => {
  await proof.check(ROW, async () => {
    const api = avatarApi({ run: RUNNING });
    const { page, errors } = await openToday(api);
    // Opened on a run already going: the button is off with its reason, and its own sentence is shown.
    assert.equal(await startBtn(page).isDisabled(), true);
    assert.match(await page.locator(ACT).innerText(), /Running: step 1 of 10, writing down the business facts\./);
    assert.match(await page.locator(ACT).innerText(), /It is running now\. This row shows each step as it goes\./);
    assert.equal(await page.locator(ACT).getByRole("button", { name: /^Retry/ }).count(), 0);
    assert.deepEqual(api.state.jobReads, [], "it waits for the clock before asking again");

    // Every 8 seconds the row reads the run again and shows the server's own words.
    await page.clock.fastForward(8100);
    await waitFor(() => api.state.jobReads.length >= 1);
    assert.equal(api.state.jobReads[0], RUN_ID);
    await page.waitForFunction((sel) => (document.querySelector(sel)?.textContent || "").includes("Running: step 3 of 10, searching the web for buyer quotes"), ACT);
    assert.match(await page.locator(ACT).innerText(), /15 searches\./);

    // The run finishes: the row stops asking, reads the step again, and Build the avatar is ready.
    api.state.jobStatus = "done";
    await page.clock.fastForward(8100);
    await page.waitForFunction((sel) => !(document.querySelector(sel)?.textContent || "").includes("It is running now"), ACT);
    await waitFor(async () => !(await startBtn(page).isDisabled()));
    assert.equal(await startBtn(page).isEnabled(), true);
    const reads = api.state.jobReads.length;
    await page.clock.fastForward(24_000);
    await page.waitForTimeout(200);
    assert.equal(api.state.jobReads.length, reads, "a finished run is not asked about again");
    assert.deepEqual(errors, []);
    await page.close();
  });
});

test("a run stopped at the cap shows its sentence and Retry sends that run's id; a plain stop says Retry", { timeout: 90_000 }, async () => {
  await proof.check(ROW, async () => {
    const api = avatarApi({ run: STOPPED_AT_CAP });
    const { page } = await openToday(api);
    assert.match(await page.locator(ACT).innerText(), /Stopped at the \$20 run cap after step 6\./);
    assert.equal(await startBtn(page).isEnabled(), true, "after a stop a fresh build is allowed too");
    const retry = page.locator(ACT).getByRole("button", { name: "Retry (keeps what it found)" });
    assert.equal(await retry.count(), 1);
    assert.equal(await retry.isEnabled(), true);
    await retry.click();
    await waitFor(() => api.state.posts.length === 1);
    assert.equal(api.state.posts[0].retry_job_id, STOPPED_AT_CAP.id, "Retry names the run it continues");
    assert.equal(api.state.posts[0].stage, 1);
    assert.equal("service_description" in api.state.posts[0], false, "a retry does not retype what we sell");
    await page.waitForFunction((sel) => /Running again from where it stopped\. Nothing it already found is paid for twice\./.test(document.querySelector(sel)?.textContent || ""), ACT);
    assert.equal(await page.locator(ACT).getByRole("button", { name: /^Retry/ }).count(), 0, "Retry goes away once it runs");
    assert.equal(await startBtn(page).isDisabled(), true);
    await page.close();

    const plain = await openToday(avatarApi({ run: STOPPED_PLAIN }));
    assert.match(await plain.page.locator(ACT).innerText(), /Stopped at step 4\./);
    assert.equal(await plain.page.locator(ACT).getByRole("button", { name: "Retry", exact: true }).count(), 1, "a stop that was not the cap says plain Retry");
    assert.equal(await plain.page.locator(ACT).getByRole("button", { name: "Retry (keeps what it found)" }).count(), 0);
    await plain.page.close();

    // A finished or never-run avatar has no Retry at all.
    const finished = await openToday(avatarApi({ run: DONE }));
    assert.equal(await finished.page.locator(ACT).getByRole("button", { name: /^Retry/ }).count(), 0);
    assert.equal(await startBtn(finished.page).isEnabled(), true);
    await finished.page.close();
    const never = await openToday(avatarApi({ run: null }));
    assert.equal(await never.page.locator(ACT).getByRole("button", { name: /^Retry/ }).count(), 0);
    await never.page.close();
  });
});

test("when the server refuses the start, the row says why in words and nothing is left running", { timeout: 120_000 }, async () => {
  await proof.check(ROW, async () => {
    const cases = [
      ["a refusal with its own words", () => [409, { ok: false, message: "A different avatar run is already going." }], /A different avatar run is already going\./],
      ["signed out", () => [401, { ok: false }], /Your sign-in ran out\. Sign in again, then tap Build the avatar\./],
      ["no words from the server", () => [500, { ok: false }], /It did not start, and the server did not say why\. Nothing was charged\. Try again\./],
      ["already running", () => [202, { ok: true, already_running: true, message: "The avatar is already being built. This is that run." }], /The avatar is already being built\. This is that run\./],
    ];
    for (const [label, answer, words] of cases) {
      const api = avatarApi({ answer });
      const { page } = await openToday(api);
      await startBtn(page).click();
      await page.locator("dialog.av-sheet").getByRole("button", { name: "Start building" }).click();
      await waitFor(() => api.state.posts.length === 1);
      await page.waitForFunction(([sel, source, flags]) => new RegExp(source, flags).test(document.querySelector(sel)?.textContent || ""), [ACT, words.source, words.flags]);
      assert.match(await page.locator(ACT).innerText(), words, label);
      if (label === "a refusal with its own words" || label === "signed out" || label === "no words from the server") {
        assert.equal(await startBtn(page).isEnabled(), true, `${label}: nothing started, so the button is still there`);
        assert.doesNotMatch(await page.locator(ACT).innerText(), /It is running now/, label);
      }
      await page.close();
    }
  });
});

test("every listed row was exercised", () => {
  proof.assertAllClaimed();
});
