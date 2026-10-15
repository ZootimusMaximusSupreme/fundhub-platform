// Batch 16 practice tests, second file for the Today tab of the Marketing Command Center
// (public/app/marketing-cc-today.js inside marketing-command-center.html), in a real Chromium with fake
// /api answers. No live data, no spend, nothing sent.
//
// fin-b16-cc-today.test.mjs holds the first pass. This file closes the holes an independent check found in it:
//
//   the word table      every step (2 to 6) in EVERY state the page can show: done, done and approved, failed,
//                       out of date, waiting on other steps, not run yet, and a state nobody named. Each step's
//                       own sentence under the chip, and the "where this runs" line under it. Step 6 also with a
//                       review card, so its Read it / Hide it path is run.
//   the offer fold      "Show more" on the offer card (the whole offer behind a fold)
//   Waiting on you     the approve and redo lines, the videos row (live link, ran out, none; oldest day; "or more"),
//                       the Mac row in both states
//   What is turned on   Meta that never sent numbers, the marketing switch off, parts nobody answered for
//   the spend tiles     up, down, about the same, no number before, no number now, $0 before, today's number,
//                       and the two day line between fresh and old numbers

import { test } from "node:test";
import assert from "node:assert/strict";

import { proofRows, sharedScreens } from "./fin-b16-kit.mjs";
import { CARD, HOUSE, NOW, STAGES, ok, today, todayOpener, stageRow } from "./fin-b16-cc-today-kit.mjs";

const proof = proofRows(import.meta.url);
const screens = sharedScreens();
const openToday = todayOpener(screens);

const KEYS = ["avatar", "ad-research", "offer", "copy", "ad-strategy", "spend"];
const LABEL = { avatar: "avatar", "ad-research": "ad research", offer: "offer", copy: "copy", "ad-strategy": "ad strategy", spend: "spend" };
const ROW = {
  avatar: /^Today flywheel step 1 \(avatar/, "ad-research": /^Today flywheel step 2 \(ad-research/, offer: /^Today flywheel step 3 \(offer/,
  copy: /^Today flywheel step 4 \(copy/, "ad-strategy": /^Today flywheel step 5 \(ad-strategy/, spend: /^Today flywheel step 6 \(spend/,
};

/** Six steps, each with its own state, reasons, counts and a review card (step 6 included). */
function stagesOf(spec) {
  return KEYS.map((key, i) => {
    const [state, approved, reasons, counts, why] = spec[key];
    return { n: i + 1, key, label: LABEL[key], state, approved, status: state, why: why || "", reasons, counts: counts || {}, review_card: CARD(`${LABEL[key]} decided.`) };
  });
}
const withStages = (spec) => today({ flywheel: { campaigns: [{ campaign: "partner", stages: stagesOf(spec), advice: "" }] } });

// What the page must say for each step in each state. Written here by hand, one line per cell:
// [chip word, chip tone classes, the sentence under the chip].
const WAIT = " It waits for you to read it and approve it.";
const FIXTURES = {
  ready: {
    t: withStages({
      avatar: ["READY", true, [], { quotes: 133 }],
      "ad-research": ["READY", false, [], { rowsFound: 361, rowsVerified: 8, competitorsFound: 160 }],
      offer: ["READY", false, [], { priceSet: 1, bonuses: 3 }],
      copy: ["READY", true, [], { hooks: 31 }],
      "ad-strategy": ["READY", false, [], { strategyNamed: 1 }],
      spend: ["READY", false, [], {}, "7 days of spend read"],
    }),
    want: {
      avatar: ["Done, approved", ["on"], "Done. 133 customer quotes collected."],
      "ad-research": ["Done", ["wip"], `Done. 361 findings, 8 checked, 160 competitors.${WAIT}`],
      offer: ["Done", ["wip"], `Done. Price set, 3 bonuses.${WAIT}`],
      copy: ["Done, approved", ["on"], "Done. 31 hooks written."],
      "ad-strategy": ["Done", ["wip"], `Done. Strategy chosen.${WAIT}`],
      spend: ["Done", ["wip"], `Done. 7 days of spend read.${WAIT}`],
    },
  },
  failed: {
    t: withStages({
      avatar: ["FAILED", false, ["did not report quotes"]],
      "ad-research": ["FAILED", false, ["did not report rowsFound"]],
      offer: ["FAILED", false, ["did not report priceSet"]],
      copy: ["FAILED", false, ["did not report distinctReasons"]],
      "ad-strategy": ["FAILED", false, ["did not report strategyNamed"]],
      spend: ["FAILED", false, ["has no review card"]],
    }),
    want: {
      avatar: ["Needs a redo", ["bad"], "It did not count its quotes. Redo the step."],
      "ad-research": ["Needs a redo", ["bad"], "It did not count its findings. Redo the step."],
      offer: ["Needs a redo", ["bad"], "It did not say its price. Redo the step."],
      copy: ["Needs a redo", ["bad"], "It did not count its different reasons. Redo the step."],
      "ad-strategy": ["Needs a redo", ["bad"], "It did not name its strategy. Redo the step."],
      spend: ["Needs a redo", ["bad"], "It has no review card. Redo the step."],
    },
  },
  stale: {
    t: withStages({
      avatar: ["READY", true, [], { quotes: 133 }],
      "ad-research": ["STALE", false, ["built on the old avatar"]],
      offer: ["STALE", false, ["built on the old ad research"]],
      copy: ["STALE", false, ["built on the old offer"]],
      "ad-strategy": ["STALE", false, ["built on the old copy"]],
      spend: ["STALE", false, ["built on the old ad strategy"]],
    }),
    want: {
      avatar: ["Done, approved", ["on"], "Done. 133 customer quotes collected."],
      "ad-research": ["Out of date", ["wip"], "Step 1 changed, so this needs a redo."],
      offer: ["Out of date", ["wip"], "Step 2 changed, so this needs a redo."],
      copy: ["Out of date", ["wip"], "Step 3 changed, so this needs a redo."],
      "ad-strategy": ["Out of date", ["wip"], "Step 4 changed, so this needs a redo."],
      spend: ["Out of date", ["wip"], "Step 5 changed, so this needs a redo."],
    },
  },
  staleOther: {
    t: withStages({
      avatar: ["READY", true, [], { quotes: 133 }],
      "ad-research": ["STALE", false, []],
      offer: ["STALE", false, ["the market file was edited"]],
      copy: ["STALE", false, ["built on the old offer", "built on the old ad research"]],
      "ad-strategy": ["STALE", false, ["built on the old copy"]],
      spend: ["STALE", false, ["built on the old ad strategy"]],
    }),
    want: {
      avatar: ["Done, approved", ["on"], "Done. 133 customer quotes collected."],
      "ad-research": ["Out of date", ["wip"], "An earlier step changed, so this needs a redo."],
      offer: ["Out of date", ["wip"], "The market file was edited."],
      copy: ["Out of date", ["wip"], "Step 3 and 2 changed, so this needs a redo."],
      "ad-strategy": ["Out of date", ["wip"], "Step 4 changed, so this needs a redo."],
      spend: ["Out of date", ["wip"], "Step 5 changed, so this needs a redo."],
    },
  },
  blocked: {
    t: withStages({
      avatar: ["BLOCKED", false, []],
      "ad-research": ["BLOCKED", false, ["waiting on avatar"]],
      offer: ["BLOCKED", false, ["waiting on avatar and ad research"]],
      copy: ["BLOCKED", false, ["waiting on offer"]],
      "ad-strategy": ["BLOCKED", false, ["waiting on offer and copy"]],
      spend: ["BLOCKED", false, ["waiting on ad strategy"]],
    }),
    want: {
      avatar: ["Waiting", ["wip"], "An earlier step has to be done first."],
      "ad-research": ["Waiting on step 1", ["wip"], "Step 1 has to be done first."],
      offer: ["Waiting on steps 1 and 2", ["wip"], "Steps 1 and 2 have to be done first."],
      copy: ["Waiting on step 3", ["wip"], "Step 3 has to be done first."],
      "ad-strategy": ["Waiting on steps 3 and 4", ["wip"], "Steps 3 and 4 have to be done first."],
      spend: ["Waiting on step 5", ["wip"], "Step 5 has to be done first."],
    },
  },
  missing: {
    t: withStages(Object.fromEntries(KEYS.map((key) => [key, ["MISSING", false, ["has not been run yet"]]]))),
    want: Object.fromEntries(KEYS.map((key) => [key, ["Not run yet", [], "It has not been run yet."]])),
  },
  unknown: {
    t: withStages(Object.fromEntries(KEYS.map((key) => [key, ["", false, []]]))),
    want: Object.fromEntries(KEYS.map((key) => [key, ["Unknown", [], null]])),
  },
};

// The "where this runs" line under the chip, one per step, the same in every state.
const RUNS = {
  avatar: "Not on this page yet: it ships in slice 5a. Cost not measured.",
  "ad-research": "Not on this page yet: it ships in slice 10. Cost not measured.",
  offer: "Write offer, on the Offer card, writes a new offer on this page.",
  copy: "Not on this page yet: it ships in slice 5.",
  "ad-strategy": "Not on this page yet: it ships in slice 5.",
  spend: "Not on this page yet: it ships in slice 5.",
};

async function readStages(page) {
  const out = {};
  for (const key of KEYS) {
    const row = stageRow(page, key);
    const chip = row.locator(".chip").first();
    out[key] = {
      word: (await chip.textContent()).trim(),
      tone: (await chip.getAttribute("class")).split(/\s+/).filter((c) => c && c !== "chip"),
      lines: (await row.locator(".row-why").allInnerTexts()).map((s) => s.trim()),
    };
  }
  return out;
}

test("every step says its chip, its tone, its own sentence and where it runs, in every state the page can show", { timeout: 180_000 }, async () => {
  const seen = {};
  for (const [name, fixture] of Object.entries(FIXTURES)) {
    const { page, errors } = await openToday({ t: fixture.t });
    seen[name] = await readStages(page);
    assert.deepEqual(errors, [], `${name}: no page error`);
    await page.close();
  }

  for (const key of KEYS.slice(1)) {
    await proof.check(ROW[key], async () => {
      for (const [name, fixture] of Object.entries(FIXTURES)) {
        const [word, tone, sentence] = fixture.want[key];
        const got = seen[name][key];
        assert.equal(got.word, word, `${key} / ${name}: chip word`);
        assert.deepEqual(got.tone, tone, `${key} / ${name}: chip tone`);
        // The sentence under the chip is this step's own, then the one line about where it runs.
        const lines = sentence === null ? [RUNS[key]] : [sentence, RUNS[key]];
        assert.deepEqual(got.lines, lines, `${key} / ${name}: the sentence and the run line`);
      }
      // A step the page could not name is never worded as done.
      assert.notEqual(seen.unknown[key].word, "Done");
      assert.notEqual(seen.stale[key].word, "Done");
      assert.notEqual(seen.stale[key].word, "Done, approved");
    });
  }
});

test("step 6 with a review card opens and closes it, and a step that went out of date still has its card", { timeout: 90_000 }, async () => {
  await proof.check(ROW.spend, async () => {
    const { page } = await openToday({ t: FIXTURES.stale.t });
    for (const key of ["spend", "ad-research"]) {
      const row = stageRow(page, key);
      const toggle = row.locator("button[data-toggle]");
      assert.equal((await toggle.innerText()).trim(), "Read it", key);
      assert.equal(await toggle.isEnabled(), true, `${key}: the Read it button is live when there is a card`);
      assert.equal(await toggle.getAttribute("aria-expanded"), "false");
      const card = page.locator(`#${await toggle.getAttribute("data-toggle")}`);
      assert.equal(await card.isHidden(), true);
      await toggle.click();
      assert.equal((await toggle.innerText()).trim(), "Hide it");
      assert.equal(await toggle.getAttribute("aria-expanded"), "true");
      assert.equal(await card.isVisible(), true);
      assert.ok((await card.innerText()).includes(`${LABEL[key]} decided.`), `${key}: its own card words`);
      assert.equal(await row.locator("button", { hasText: "Read it" }).count(), 0, "the closed label is gone while it is open");
      await toggle.click();
      assert.equal((await toggle.innerText()).trim(), "Read it");
      assert.equal(await card.isHidden(), true);
    }
    await page.close();
  });
});

// ───────────────────────── the offer card's own "Show more" ─────────────────────────

const OFFER = {
  ok: true,
  job: { id: "offer-job-1", status: "done", created_at: "2026-10-05T16:00:00Z", finished_at: "2026-10-05T16:05:00Z" },
  offer: {
    jobId: "offer-job-1", campaign: "partner", finishedAt: "2026-10-05T16:05:00Z",
    offer: {
      name: "The Partner Roadmap", price: "$297", oneSentence: "A plain plan to get your business funded.",
      whatTheyGet: ["A written roadmap", "A lender list"],
      guarantees: [{ name: "Plan guarantee", promise: "Not useful, money back." }],
      bonuses: ["A call script"],
    },
    reviewCard: { whatThisDecided: "What the partner buys and what it costs.", threeThingsToCheck: ["Is the price right?", "Is the guarantee right?"], notSureAbout: ["nothing."] },
  },
};

test("the offer card keeps the whole offer behind Show more and opens and closes it in place", { timeout: 90_000 }, async () => {
  await proof.check(/^Today: 'Show more' \/ 'Read it' text folds/, async () => {
    const { page, errors } = await openToday({ offer: [OFFER, 200], wait: "#offerLatest .offer-body" });
    const card = page.locator("#offerLatest");
    // What shows first: the review words and the offer's name and price.
    const first = await card.innerText();
    assert.match(first, /Latest offer/);
    assert.match(first, /What this decided/);
    assert.match(first, /What the partner buys and what it costs\./);
    assert.match(first, /The Partner Roadmap · \$297/);
    assert.match(first, /Is the price right\?/);

    const toggle = card.locator('button[data-toggle="offerMore"]');
    const more = page.locator("#offerMore");
    assert.equal((await toggle.innerText()).trim(), "Show more");
    assert.equal(await toggle.getAttribute("aria-expanded"), "false");
    assert.equal(await toggle.getAttribute("aria-controls"), "offerMore");
    assert.equal(await more.isHidden(), true, "the whole offer starts folded");
    assert.equal(await page.getByText("A lender list").isVisible(), false);

    await toggle.click();
    assert.equal((await toggle.innerText()).trim(), "Show less");
    assert.equal(await toggle.getAttribute("aria-expanded"), "true");
    assert.equal(await more.isVisible(), true);
    const words = await more.innerText();
    assert.match(words, /A plain plan to get your business funded\./);
    assert.match(words, /What they get/);
    assert.match(words, /A written roadmap/);
    assert.match(words, /A lender list/);
    assert.match(words, /Guarantee/);
    assert.match(words, /Plan guarantee: Not useful, money back\./);
    assert.match(words, /Bonuses/);
    assert.match(words, /A call script/);

    await toggle.click();
    assert.equal((await toggle.innerText()).trim(), "Show more");
    assert.equal(await toggle.getAttribute("aria-expanded"), "false");
    assert.equal(await more.isHidden(), true);

    // The page reads the offer's answer again after the tab refreshes: an open fold stays open.
    await toggle.click();
    await page.clock.fastForward(5 * 60 * 1000 + 1000);
    await page.waitForTimeout(300);
    assert.equal(await toggle.getAttribute("aria-expanded"), "true");
    assert.equal(await more.isVisible(), true);
    assert.deepEqual(errors, []);
    await page.close();

    // An offer with a name and nothing else has nothing to fold.
    const bare = structuredClone(OFFER);
    bare.offer.offer = { name: "The Partner Roadmap", price: "$297" };
    const short = await openToday({ offer: [bare, 200], wait: "#offerLatest .offer-body" });
    assert.match(await short.page.locator("#offerLatest").innerText(), /The Partner Roadmap · \$297/);
    assert.equal(await short.page.locator('#offerLatest button[data-toggle="offerMore"]').count(), 0);
    assert.equal(await short.page.locator("#offerMore").count(), 0);
    await short.page.close();
  });
});

// ───────────────────────── Waiting on you ─────────────────────────

const STEP_TO_DO = {
  avatar: ["READY", false, [], { quotes: 133 }],
  "ad-research": ["READY", true, [], { rowsFound: 361, rowsVerified: 8, competitorsFound: 160 }],
  offer: ["FAILED", false, ["did not report priceSet"]],
  copy: ["STALE", false, ["built on the old offer"]],
  "ad-strategy": ["READY", false, [], { strategyNamed: 1 }],
  spend: ["FAILED", false, ["has no review card"]],
};
const vid = (id, ad, over = {}) => ({ id, ad_id: String(ad), take_no: 1, status: "awaiting_approval", created_at: "2026-09-20T10:00:00Z", updated_at: "2026-09-22T10:00:00Z", approval_expires_at: null, status_means: "waiting on Chris", ...over });
const list = (items, over = {}) => ({ ok: true, count: items.length, limit: 50, offset: 0, hasMore: false, items, ...over });

async function waitingRows(page) {
  await page.waitForSelector("#waitingList li[data-wait], #waitingList p.muted");
  return page.locator("#waitingList li[data-wait]").evaluateAll((els) => els.map((e) => ({
    kind: e.getAttribute("data-wait"),
    what: e.querySelector("b").innerText.trim(),
    lines: [...e.querySelectorAll(".row-why")].map((n) => n.innerText.trim()),
  })));
}

test("Waiting on you says, for each step that needs a person, what to do, why, and where it is done", { timeout: 90_000 }, async () => {
  await proof.check(/^Today: 'Waiting on you' list/, async () => {
    const { page } = await openToday({ t: withStages(STEP_TO_DO), videos: [list([]), 200] });
    const rows = await waitingRows(page);
    assert.deepEqual(rows, [
      { kind: "approve", what: "Read and approve: Who we sell to (step 1 of 6)",
        lines: ["Done. 133 customer quotes collected.", "Read it under Offer and market. Approving: Not on this page yet: it ships in slice 5a."] },
      { kind: "redo", what: "Redo the offer (step 3 of 6)",
        lines: ["It did not say its price. Redo the step.",
          "Write offer, on the Offer card, makes a new offer. This row clears only when the offer file is redone. Saving the offer file: Not on this page yet: it ships in slice 1."] },
      { kind: "redo", what: "Redo ad copy (step 4 of 6)",
        lines: ["Step 3 changed, so this needs a redo.", "Not on this page yet: it ships in slice 5."] },
      { kind: "approve", what: "Read and approve: Which ad strategy (step 5 of 6)",
        lines: ["Done. Strategy chosen.", "Read it under Offer and market. Approving: Not on this page yet: it ships in slice 5."] },
      { kind: "redo", what: "Redo read the spend (step 6 of 6)",
        lines: ["It has no review card. Redo the step.", "Not on this page yet: it ships in slice 5."] },
    ]);
    assert.equal((await page.locator("#waitingCount").innerText()).trim(), "5 to do");
    await page.close();

    // The out-of-date step is on the list, and a step that is out of date is not "approved" or "waiting".
    const onlyStale = withStages({
      avatar: ["READY", true, [], { quotes: 133 }], "ad-research": ["STALE", false, ["built on the old avatar"]],
      offer: ["READY", true, [], { priceSet: 1, bonuses: 3 }], copy: ["BLOCKED", false, ["waiting on offer"]], "ad-strategy": ["MISSING", false, []], spend: ["MISSING", false, []],
    });
    const stale = await openToday({ t: onlyStale, videos: [list([]), 200] });
    assert.deepEqual(await waitingRows(stale.page), [{
      kind: "redo", what: "Redo what the market sells (step 2 of 6)",
      lines: ["Step 1 changed, so this needs a redo.", "Not on this page yet: it ships in slice 10."],
    }]);
    await stale.page.close();
  });
});

test("Waiting on you: the videos row names the approve link that is live, that ran out, or that was never sent", { timeout: 120_000 }, async () => {
  await proof.check(/^Today: 'Waiting on you' list/, async () => {
    const only = async (videos, over = {}) => {
      const { page } = await openToday({ t: today({ flywheel: undefined, ...over }), videos: [videos, 200], wait: "#waitingList" });
      await page.waitForFunction(() => document.querySelector('#waitingList li[data-wait="videos"]'));
      const rows = (await waitingRows(page)).filter((r) => r.kind === "videos");
      await page.close();
      assert.equal(rows.length, 1);
      return rows[0];
    };
    const LIVE = "Approving is not on this page yet. Use the Approve link in the text we sent you.";

    // NOW is Oct 5, 12:00 PM in Arizona. A link that ends Oct 8 is live.
    const live = await only(list([vid("v1", 84, { approval_expires_at: "2026-10-08T19:00:00Z" })]));
    assert.deepEqual(live, { kind: "videos", what: "Approve or reject 1 video", lines: ["Ad 84. Waiting since Sep 22.", LIVE] });
    // One live link among ended ones is enough: the page points at the text.
    const mixed = await only(list([vid("v1", 84, { approval_expires_at: "2026-09-27T05:00:00Z" }), vid("v2", 86, { approval_expires_at: "2026-10-08T19:00:00Z" })]));
    assert.equal(mixed.lines[1], LIVE);
    // A link that ended an hour ago is not live.
    const justEnded = await only(list([vid("v1", 84, { approval_expires_at: "2026-10-05T18:00:00Z" })]));
    assert.equal(justEnded.lines[1], "Approving is not on this page yet, and the approve links in your text ran out on Oct 5.");
    // Every link ended: it says the LATEST end day (Sep 28 here, not Sep 26).
    const ended = await only(list([vid("v1", 84, { approval_expires_at: "2026-09-26T05:00:00Z" }), vid("v2", 86, { approval_expires_at: "2026-09-28T23:00:00Z" })]));
    assert.equal(ended.lines[1], "Approving is not on this page yet, and the approve links in your text ran out on Sep 28.");
    // No link at all was sent.
    const none = await only(list([vid("v1", 84)]));
    assert.equal(none.lines[1], "Approving is not on this page yet, and no working approve link was sent for them.");

    // The oldest day is the one it says, and the ads are named in number order.
    const many = await only(list([
      vid("v1", 90, { updated_at: "2026-09-25T10:00:00Z" }), vid("v2", 84, { updated_at: "2026-09-18T10:00:00Z" }), vid("v3", 86, { updated_at: "2026-09-21T10:00:00Z" }),
    ]));
    assert.equal(many.what, "Approve or reject 3 videos");
    assert.equal(many.lines[0], "Ad 84, Ad 86 and Ad 90. Waiting since Sep 18.");
    // More waiting than the page asked for: "or more", and the same name at 2 and 1.
    const more = await only(list([vid("v1", 84), vid("v2", 86)], { hasMore: true }));
    assert.equal(more.what, "Approve or reject 2 or more videos");
  });
});

test("Waiting on you: the Mac row says waiting or running, and is gone when neither", { timeout: 90_000 }, async () => {
  await proof.check(/^Today: 'Waiting on you' list/, async () => {
    const ready = STAGES.map((s) => ({ ...s, state: "READY", approved: true, reasons: [] }));
    const quiet = { flywheel: { campaigns: [{ campaign: "partner", stages: ready, advice: "" }] } };
    const noVideos = [list([]), 200];
    const rows = async (mac) => {
      const { page } = await openToday({ t: today({ ...quiet, ...(mac ? { mac_queue: mac } : {}) }), videos: noVideos, wait: "#waitingList" });
      const got = await waitingRows(page);
      await page.close();
      return got;
    };
    assert.deepEqual(await rows({ waiting: 3, running: 0, line: "3 AI jobs wait for your Mac." }), [{
      kind: "mac", what: "Waiting for your Mac to run it", lines: ["3 AI jobs wait for your Mac.", "The queue runner on your Mac picks these up while it is on."],
    }]);
    assert.deepEqual(await rows({ waiting: 0, running: 1, line: "1 AI job is running on your Mac." }), [{
      kind: "mac", what: "Your Mac is running it now", lines: ["1 AI job is running on your Mac.", "The queue runner on your Mac picks these up while it is on."],
    }]);
    // Waiting wins when both are true.
    assert.equal((await rows({ waiting: 1, running: 1, line: "x" }))[0].what, "Waiting for your Mac to run it");
    assert.deepEqual(await rows({ waiting: 0, running: 0, line: "nothing" }), []);
    assert.deepEqual(await rows(null), []);
  });
});

// ───────────────────────── What is turned on ─────────────────────────

test("What is turned on: Meta that never sent numbers, a switch that is off, and parts nobody answered for", { timeout: 90_000 }, async () => {
  await proof.check(/^Today: 'What is turned on' tile and health list/, async () => {
    const health = async (page) => Object.fromEntries((await page.locator("#healthList li.row").allInnerTexts()).map((r) => [r.split("\n")[0].trim(), r]));
    const tile = async (page) => ({ value: (await page.locator("#tileParts .vl").innerText()).trim(), cmp: (await page.locator("#tileParts .cmp").innerText()).trim() });

    // Meta answered, but has never sent a number: not ready, and it says so in those words.
    const never = await openToday({ t: today({ last_sync: { meta_synced_at: null, metrics_synced_at: null, latest_metrics_date: null } }) });
    assert.deepEqual(await tile(never.page), { value: "5 of 6", cmp: "Not ready: Ad numbers from Meta." });
    const neverRows = await health(never.page);
    assert.match(neverRows["Ad numbers from Meta"], /Meta has never sent numbers for this company\.[\s\S]*not ready/i);
    await never.page.close();

    // The marketing switch is off: that part is not ready and says why.
    const off = await openToday({ t: today({ copy_ready: {
      ready: false, partner_id: HOUSE,
      checks: [ok("house_partner"), { ...ok("marketing_switch"), ok: false }, ok("copy_provider"), ok("anthropic_key"), { ...ok("writing_budget"), used: 1000, cap: 250000 }],
      missing: ["marketing_switch"],
    } }) });
    assert.deepEqual(await tile(off.page), { value: "5 of 6", cmp: "Not ready: Marketing switch for the Fundhub house account." });
    assert.match((await health(off.page))["Marketing switch for the Fundhub house account"], /Off, so ad copy cannot be written\.[\s\S]*not ready/i);
    await off.page.close();

    // The writing budget is used up.
    const spent = await openToday({ t: today({ copy_ready: {
      ready: false, partner_id: HOUSE,
      checks: [ok("house_partner"), ok("marketing_switch"), ok("copy_provider"), ok("anthropic_key"), { ...ok("writing_budget"), ok: false, used: 250000, cap: 250000 }],
      missing: ["writing_budget"],
    } }) });
    assert.deepEqual(await tile(spent.page), { value: "5 of 6", cmp: "Not ready: Writing budget this month." });
    assert.match((await health(spent.page))["Writing budget this month"], /Used up for this month\.[\s\S]*not ready/i);
    await spent.page.close();

    // Nobody answered for the copy parts: they are "not known yet", never counted as ready, and nothing is called not ready.
    const quiet = await openToday({ t: today({ copy_ready: { ready: null, partner_id: HOUSE, checks: [ok("house_partner"), ok("marketing_switch")], missing: [] } }) });
    assert.deepEqual(await tile(quiet.page), { value: "3 of 6", cmp: "The rest are not known yet." });
    const quietRows = await health(quiet.page);
    for (const label of ["Copy writer set up", "AI key for writing", "Writing budget this month"]) {
      assert.match(quietRows[label], /Not known yet\.[\s\S]*unknown/i, label);
      assert.doesNotMatch(quietRows[label], /not ready/i, label);
    }
    await quiet.page.close();
  });
});

// ───────────────────────── the spend tiles ─────────────────────────

function spendOf(over7 = {}, over30 = {}, todayWin = {}) {
  const t = today();
  Object.assign(t.spend.windows.last_7_days, over7);
  Object.assign(t.spend.windows.last_30_days, over30);
  Object.assign(t.spend.windows.today, todayWin);
  return t;
}

test("the spend tiles say up, down or about the same, and what is missing, and when numbers are old", { timeout: 180_000 }, async () => {
  await proof.check(/^Today: spend tiles \(7 days vs the 7 before/, async () => {
    const cmp = async (t, which = 7) => {
      const { page } = await openToday({ t });
      const text = (await page.locator(`#tileSpend${which} .cmp`).innerText()).trim();
      const value = (await page.locator(`#tileSpend${which} .vl`).innerText()).trim();
      await page.close();
      return { text, value };
    };
    const prior = (cents) => ({ spend_cents: cents });
    const win = (t, key, cents) => { t.spend.windows[key].spend_cents = cents; return t; };

    // Down, and the same two lines the up case prints: it must not read "Up from".
    assert.deepEqual(await cmp(win(today(), "last_7_days", 80000)), { text: "Down from $1,000 the 7 days before.", value: "$800" });
    assert.deepEqual(await cmp(win(today(), "last_30_days", 300000), 30), { text: "Down from $4,000 the 30 days before. Numbers saved for 12 of 30 days.", value: "$3,000" });
    // Within half a percent is "about the same"; past it is up or down.
    assert.equal((await cmp(win(today(), "last_7_days", 100400))).text, "About the same as the 7 days before ($1,000).");
    assert.equal((await cmp(win(today(), "last_7_days", 99600))).text, "About the same as the 7 days before ($1,000).");
    assert.equal((await cmp(win(today(), "last_7_days", 100600))).text, "Up from $1,000 the 7 days before.");
    assert.equal((await cmp(win(today(), "last_7_days", 99400))).text, "Down from $1,000 the 7 days before.");
    // A number missing on either side is said, never made into $0.
    const noPrior = today();
    noPrior.spend.windows.prior_7_days = { ...noPrior.spend.windows.prior_7_days, spend_cents: null };
    assert.equal((await cmp(noPrior)).text, "No number for the 7 days before.");
    assert.deepEqual(await cmp(win(today(), "last_7_days", null)), { text: "The 7 days before: $1,000.", value: "unknown" });
    // A period that spent nothing is a real $0.
    const zeroBefore = win(today(), "prior_7_days", 0);
    assert.equal((await cmp(zeroBefore)).text, "Up from $0 the 7 days before.");
    assert.equal((await cmp(win(win(today(), "prior_7_days", 0), "last_7_days", 0))).text, "Same as the 7 days before ($0).");
    // Seven of seven days saved needs no coverage note; five of seven does.
    const five = today();
    five.spend.windows.last_7_days.days_with_data = 5;
    assert.match((await cmp(five)).text, /Up from \$1,000 the 7 days before\. Numbers saved for 5 of 7 days\.$/);
    assert.doesNotMatch((await cmp(today())).text, /Numbers saved for/);
    const none = today();
    none.spend.windows.last_7_days.days_with_data = 0;
    assert.doesNotMatch((await cmp(none)).text, /Numbers saved for/, "no saved day at all is not 0 of 7");
  });

  await proof.check(/^Today: spend tiles \(7 days vs the 7 before/, async () => {
    // Today's own number is printed when the pull has it, and unknown only when the pull is old.
    const withToday = await openToday({ t: spendOf({}, {}, { spend_cents: 4200, days_with_data: 1 }) });
    assert.match(await withToday.page.locator("#tileSpend30 .note").innerText(), /Today so far: \$42\./);
    await withToday.page.close();
    const normal = await openToday({ t: today() });
    assert.match(await normal.page.locator("#tileSpend30 .note").innerText(), /Today's numbers come in tomorrow morning\. The Meta pull runs at midnight, Arizona time\./);
    await normal.page.close();

    // The line between fresh and old is two days. 47 hours is fresh; 49 hours is old.
    const synced = (hoursAgo) => {
      const at = new Date(Date.parse(NOW) - hoursAgo * 3_600_000).toISOString();
      return today({ last_sync: { meta_synced_at: at, metrics_synced_at: at, latest_metrics_date: "2026-10-03" } });
    };
    const fresh = await openToday({ t: synced(47) });
    assert.doesNotMatch(await fresh.page.locator("#tileSpend7").innerText(), /Old numbers/);
    assert.equal(await fresh.page.locator("#mccAsOf").evaluate((n) => n.classList.contains("stale")), false);
    assert.equal((await fresh.page.locator("#tileParts .vl").innerText()).trim(), "6 of 6", "fresh Meta numbers count as ready");
    await fresh.page.close();
    const old = await openToday({ t: synced(49) });
    assert.match(await old.page.locator("#tileSpend7").innerText(), /Old numbers: last saved Oct 3\./);
    assert.equal(await old.page.locator("#mccAsOf").evaluate((n) => n.classList.contains("stale")), true);
    assert.equal((await old.page.locator("#tileParts .vl").innerText()).trim(), "5 of 6", "old Meta numbers do not count as ready");
    await old.page.close();
  });
});

test("every listed row was exercised", () => {
  proof.assertAllClaimed();
});
