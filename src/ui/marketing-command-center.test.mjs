// The Marketing Command Center's own rules: what it reads, what it sends, and
// the words it shows. public/app/marketing-command-center.js puts every rule
// that turns data into words on window.FHMarketingCC, so this file runs the
// real script in node:vm (same pattern as src/training/ramp-quizzes.test.mjs)
// with no browser and no server.
//
// The two promises this screen makes, and the tests that hold it to them:
//   1. NEVER FAKE A NUMBER. Null is "unknown", never $0 (CLAUDE.md §12).
//   2. EVERY ACTION ANSWERS BACK IN PLAIN WORDS. No raw status code reaches
//      the screen (UI-STANDARDS §6.3).

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createContext, runInContext } from "node:vm";
import { fileURLToPath } from "node:url";

import { OFFER_TYPES } from "../compliance/screen.mjs";
import { STAGES } from "../../scripts/flywheel/status.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP = path.resolve(HERE, "../../public/app");
const SRC = fs.readFileSync(path.join(APP, "marketing-command-center.js"), "utf8");
const HTML = fs.readFileSync(path.join(APP, "marketing-command-center.html"), "utf8");

function load() {
  const ctx = createContext({ console });
  runInContext(SRC, ctx);
  return ctx.FHMarketingCC;
}

const NOW = Date.parse("2026-10-05T19:00:00Z");
const HOUSE = "11111111-2222-4333-8444-555555555555";

/* A fixture shaped like the contract on the board (camelCase). */
function today(overrides = {}) {
  return {
    ok: true,
    asOf: "2026-10-05T07:01:00Z",
    house: { partnerId: HOUSE, slug: "fundhub-house" },
    numbers: { spend7dCents: 123456, spendPrev7dCents: 100000, spend30dCents: 500000, spendPrev30dCents: null },
    copyReady: { switchOn: true, provider: true, anthropicKey: true },
    copy: {
      pieces: [
        { id: "a1", copyText: "Your bank said no. Here is why.", complianceState: "passed", createdAt: "2026-10-05T18:00:00Z" },
        { id: "a2", copyText: "Guaranteed approval!", complianceState: "blocked",
          blockedReasons: [{ code: "guarantee", rule_set: "funding", message: "Funding ads may not promise approval." }],
          createdAt: "2026-10-04T18:00:00Z" }
      ],
      jobs: [{ id: "j1", status: "failed", error: "no active provider configured for org x", createdAt: "2026-09-17T10:00:00Z" }]
    },
    flywheel: {
      campaign: "partner",
      stages: [
        { n: 1, key: "avatar", label: "avatar", state: "READY", reasons: [], meta: { status: "approved" } },
        { n: 2, key: "ad-research", label: "ad research", state: "READY", reasons: [], meta: { status: "draft" } },
        { n: 3, key: "offer", label: "offer", state: "FAILED", reasons: ["did not report guarantees"], meta: { status: "draft" } },
        { n: 4, key: "copy", label: "copy", state: "FAILED", reasons: ["did not report distinctReasons"], meta: {} },
        { n: 5, key: "ad-strategy", label: "ad strategy", state: "BLOCKED", reasons: ["waiting on offer and copy"], meta: null },
        { n: 6, key: "spend", label: "spend", state: "MISSING", reasons: ["has not been run yet"], meta: null }
      ]
    },
    ...overrides
  };
}

/* snake_case twin of the same answer. */
function todaySnake() {
  return {
    ok: true,
    as_of: "2026-10-05T07:01:00Z",
    house: { partner_id: HOUSE },
    numbers: { spend_7d_cents: 123456, spend_prev_7d_cents: 100000, spend_30d_cents: 500000, spend_prev_30d_cents: null },
    copy_ready: { switch_on: true, provider: true, anthropic_key: true },
    copy: { pieces: [{ id: "a1", copy_text: "Your bank said no. Here is why.", compliance_state: "passed", created_at: "2026-10-05T18:00:00Z" }], jobs: [] },
    flywheel: { campaign: "partner", stages: today().flywheel.stages }
  };
}

describe("reading GET marketing/today", () => {
  test("camelCase and snake_case answers read the same", () => {
    const cc = load();
    const a = cc.normalizeToday(today());
    const b = cc.normalizeToday(todaySnake());
    for (const k of ["asOf", "partnerId", "spend7", "spendPrev7", "spend30", "spendPrev30", "campaign"]) {
      assert.equal(a[k], b[k], `${k} differs between the two spellings`);
    }
    assert.deepEqual({ ...a.copyReady }, { ...b.copyReady });
    assert.equal(a.partnerId, HOUSE);
    assert.equal(a.loaded, true);
  });

  test("only the five flywheel steps are kept, in order", () => {
    const cc = load();
    const v = cc.normalizeToday(today());
    assert.deepEqual([...v.stages.map((s) => s.key)], ["avatar", "ad-research", "offer", "copy", "ad-strategy"]);
    // The five keys are the checker's own keys (scripts/flywheel/status.mjs).
    const checkerKeys = STAGES.filter((s) => s.n <= 5).map((s) => s.key);
    assert.deepEqual([...cc.FIVE], checkerKeys);
  });

  test("a failed read leaves every number unknown and the page not loaded", () => {
    const cc = load();
    const v = cc.normalizeToday(null);
    assert.equal(v.loaded, false);
    assert.equal(v.spend7, null);
    assert.equal(v.spend30, null);
    assert.equal(v.partnerId, null);
  });

  test("a 200 with none of the keys is loaded, and still invents nothing", () => {
    const cc = load();
    const v = cc.normalizeToday({ ok: true, count: 0, items: [] });
    assert.equal(v.loaded, true);
    assert.equal(v.spend7, null);
    assert.equal(v.pieces.length, 0);
    assert.equal(v.stages.length, 0);
  });
});

describe("never fake a number", () => {
  test("null money is 'unknown'; a real zero is $0", () => {
    const cc = load();
    assert.equal(cc.money(null), "unknown");
    assert.equal(cc.money(undefined), "unknown");
    assert.equal(cc.money(""), "unknown");
    assert.equal(cc.money(0), "$0");
    assert.equal(cc.money(123456), "$1,235");
    assert.equal(cc.money(4550), "$45.50");
  });

  test("the spend tiles print 'unknown', not $0, when the server sent null", () => {
    const cc = load();
    const v = cc.normalizeToday(today({ numbers: { spend7dCents: null, spendPrev7dCents: null, spend30dCents: null } }));
    const seven = cc.renderSpendTile(v, 7, NOW);
    const thirty = cc.renderSpendTile(v, 30, NOW);
    assert.match(seven, />unknown</);
    assert.match(thirty, />unknown</);
    assert.doesNotMatch(seven + thirty, /\$0/);
    assert.match(seven, /No number for the 7 days before\./);
  });

  test("every spend number has a comparison, said in words", () => {
    const cc = load();
    assert.equal(cc.compare(123456, 100000, "7 days"), "Up 23% from $1,000 the 7 days before.");
    assert.equal(cc.compare(50000, 100000, "7 days"), "Down 50% from $1,000 the 7 days before.");
    assert.equal(cc.compare(100000, 100000, "7 days"), "About the same as the 7 days before ($1,000).");
    assert.equal(cc.compare(500, 0, "7 days"), "Up from $0 the 7 days before.");
    assert.equal(cc.compare(500000, null, "30 days"), "No number for the 30 days before.");
    assert.equal(cc.compare(null, 100000, "7 days"), "The 7 days before: $1,000.");
  });

  test("the 'as of' time is relative under a day, a date after, unknown when missing", () => {
    const cc = load();
    assert.equal(cc.when("2026-10-05T17:00:00Z", NOW).text, "2 hours ago");
    assert.equal(cc.when("2026-10-05T18:59:30Z", NOW).text, "just now");
    assert.match(cc.when("2026-10-01T07:01:00Z", NOW).text, /^Oct 1, /);
    assert.equal(cc.when(null, NOW).text, "unknown");
    assert.equal(cc.when("not a date", NOW).text, "unknown");
    assert.ok(cc.when("2026-10-05T17:00:00Z", NOW).title.length > 0, "exact time goes in the tooltip");
  });

  test("machine parts: unknown is never counted as ready", () => {
    const cc = load();
    const v = cc.normalizeToday(today({ copyReady: { switchOn: true, provider: null, anthropicKey: false } }));
    const parts = cc.deriveParts(v, NOW);
    assert.deepEqual([...parts.map((p) => p.ready)], [true, true, null, false]);
    const tile = cc.renderPartsTile(v, NOW);
    assert.match(tile, />2 of 4</);
    assert.match(tile, /Not ready: AI key for writing\./);
  });

  test("a Meta pull older than two days is not ready, and says so", () => {
    const cc = load();
    const v = cc.normalizeToday(today({ asOf: "2026-10-01T07:01:00Z" }));
    const meta = cc.deriveParts(v, NOW)[0];
    assert.equal(meta.ready, false);
    assert.match(meta.note, /It should pull every day\./);
  });
});

describe("flywheel and what waits on Chris", () => {
  test("each checker state reads as plain words", () => {
    const cc = load();
    const v = cc.normalizeToday(today());
    const words = v.stages.map((s) => cc.stageWord(s).word);
    assert.deepEqual([...words], ["Done", "Needs your OK", "Needs a redo", "Needs a redo", "Waiting on an earlier step"]);
  });

  test("code names in a reason become words", () => {
    const cc = load();
    assert.equal(cc.plainReasons(["did not report distinctReasons"]), "Did not report distinct reasons.");
    assert.equal(cc.plainReasons(["did not report guarantees"]), "Did not report guarantees.");
    assert.equal(cc.plainReasons([]), "");
  });

  test("waiting on you comes from the flywheel rows when the server sends no list", () => {
    const cc = load();
    const list = cc.deriveWaiting(cc.normalizeToday(today()));
    assert.deepEqual([...list.map((w) => w.what)], [
      "Read and approve the ad research step",
      "Redo the offer step",
      "Redo the copy step"
    ]);
  });

  test("the server's own waiting list wins over the page's guess", () => {
    const cc = load();
    const list = cc.deriveWaiting(cc.normalizeToday(today({ waiting: [{ what: "Film Ad 91", why: "Scripts are ready." }] })));
    assert.deepEqual([...list.map((w) => w.what)], ["Film Ad 91"]);
  });

  test("an empty day says nothing is waiting", () => {
    const cc = load();
    const v = cc.normalizeToday(today({ flywheel: { campaign: "partner", stages: [] } }));
    assert.match(cc.renderWaiting(v), /Nothing is waiting on you right now\./);
    assert.match(cc.renderFlywheel(v), /No flywheel steps are on file yet\./);
  });
});

describe("Write ad copy", () => {
  function fakeApi(answers) {
    const calls = [];
    const api = (p, init) => {
      calls.push({ path: p, init });
      const a = answers[p];
      const out = typeof a === "function" ? a(init) : a;
      return Promise.resolve(out || { status: 404, body: { ok: false, error: "not_found" } });
    };
    return { api, calls };
  }

  test("the request is the shape api/creative/generate.mjs accepts", () => {
    const cc = load();
    const body = cc.copyRequest(HOUSE, "  turned down by the bank  ", "funding", "k1");
    assert.equal(body.partner_id, HOUSE);
    assert.equal(body.asset_kind, "copy");
    assert.equal(body.idempotency_key, "k1");
    assert.equal(body.spec.assetKind, "copy", "the runner resolves the provider from spec.assetKind");
    assert.equal(body.spec.offerType, "funding", "the ad rules check reads spec.offerType off the job");
    assert.equal(body.spec.prompt, "turned down by the bank");
    for (const t of cc.OFFER_TYPES) assert.ok(OFFER_TYPES.has(t), `${t} is not a type the server accepts`);
    assert.equal(cc.OFFER_TYPES.length, OFFER_TYPES.size);
  });

  test("a fresh batch name every press, so a second press is a second ad", () => {
    const cc = load();
    const a = cc.newKey(NOW, 0.123456789);
    const b = cc.newKey(NOW + 1000, 0.987654321);
    assert.match(a, /^mcc-copy-\d{14}-\d{6}$/);
    assert.notEqual(a, b);
  });

  test("success: generate, then run, then show the words and the check result", async () => {
    const cc = load();
    const view = cc.normalizeToday(today());
    const { api, calls } = fakeApi({
      "/api/creative/generate": { status: 200, body: { ok: true, created: true, job: { id: "job-9" }, provider_ready: true } },
      "/api/creative/run": { status: 200, body: { ok: true, ran: 1, jobs: [
        { job_id: "job-9", status: "succeeded", assets: [{ id: "c1", copy_text: "Turned down? Here is why.", compliance_state: "passed" }] }
      ] } }
    });
    const out = await cc.writeAdCopy({ api, now: () => NOW, rand: () => 0.5 }, view, "turned down by the bank", "funding");
    assert.deepEqual(calls.map((c) => c.path), ["/api/creative/generate", "/api/creative/run"]);
    assert.equal(calls[0].init.method, "POST");
    assert.equal(calls[1].init.body.partner_id, HOUSE);
    assert.equal(out.tone, "ok");
    assert.match(out.message, /Here is your new ad copy/);
    assert.equal(out.pieces.length, 1);
    assert.equal(out.pieces[0].text, "Turned down? Here is why.");
  });

  test("a stopped ad shows the rule's own reason", async () => {
    const cc = load();
    const view = cc.normalizeToday(today());
    const { api } = fakeApi({
      "/api/creative/generate": { status: 200, body: { ok: true, created: true, job: { id: "job-9" }, provider_ready: true } },
      "/api/creative/run": { status: 200, body: { ok: true, jobs: [
        { job_id: "job-9", status: "succeeded", assets: [{ id: "c1", copy_text: "Guaranteed!", compliance_state: "blocked",
          blocked_reasons: [], screen: { reasons: [{ code: "g", message: "Funding ads may not promise approval." }] } }] }
      ] } }
    });
    const out = await cc.writeAdCopy({ api }, view, "x", "funding");
    assert.match(out.message, /stopped it/);
    assert.match(cc.renderPieces(out.pieces, NOW), /Funding ads may not promise approval\./);
  });

  test("refused at generate: nothing is run and the reason is plain", async () => {
    const cc = load();
    const view = cc.normalizeToday(today());
    const { api, calls } = fakeApi({
      "/api/creative/generate": { status: 403, body: { ok: false, error: "suite_off" } }
    });
    const out = await cc.writeAdCopy({ api }, view, "x", "funding");
    assert.equal(calls.length, 1, "run must not be called after a refusal");
    assert.equal(out.tone, "err");
    assert.equal(out.message, "Marketing is switched off for the Fundhub house account, so nothing was written.");
  });

  test("no copy writer switched on: saved, not run, and said plainly", async () => {
    const cc = load();
    const view = cc.normalizeToday(today());
    const { api, calls } = fakeApi({
      "/api/creative/generate": { status: 200, body: { ok: true, created: true, job: { id: "j" }, provider_ready: false } }
    });
    const out = await cc.writeAdCopy({ api }, view, "x", "funding");
    assert.equal(calls.length, 1);
    assert.match(out.message, /no copy writer is switched on/);
  });

  test("the job failed: the reason is translated, never the raw error", async () => {
    const cc = load();
    const view = cc.normalizeToday(today());
    const { api } = fakeApi({
      "/api/creative/generate": { status: 200, body: { ok: true, created: true, job: { id: "job-9" }, provider_ready: true } },
      "/api/creative/run": { status: 200, body: { ok: true, jobs: [
        { job_id: "job-9", status: "failed", error: "ANTHROPIC_API_KEY is not set — the copy provider cannot run." }
      ] } }
    });
    const out = await cc.writeAdCopy({ api }, view, "x", "funding");
    assert.equal(out.tone, "err");
    assert.equal(out.message, "It did not work, and nothing was made. The AI key is missing.");
    assert.doesNotMatch(out.message, /ANTHROPIC_API_KEY/);
  });

  test("the run timed out: it says the job is still writing", async () => {
    const cc = load();
    const view = cc.normalizeToday(today());
    const { api } = fakeApi({
      "/api/creative/generate": { status: 200, body: { ok: true, created: true, job: { id: "job-9" }, provider_ready: true } },
      "/api/creative/run": { status: 504, body: null }
    });
    const out = await cc.writeAdCopy({ api }, view, "x", "funding");
    assert.equal(out.tone, "wait");
    assert.match(out.message, /still writing/);
  });

  test("our job not in this run: it is in line, not lost", async () => {
    const cc = load();
    const view = cc.normalizeToday(today());
    const { api } = fakeApi({
      "/api/creative/generate": { status: 200, body: { ok: true, created: true, job: { id: "job-9" }, provider_ready: true } },
      "/api/creative/run": { status: 200, body: { ok: true, ran: 0, jobs: [] } }
    });
    const out = await cc.writeAdCopy({ api }, view, "x", "funding");
    assert.equal(out.tone, "wait");
    assert.match(out.message, /waiting in line/);
  });

  test("stopped before anything is sent", async () => {
    const cc = load();
    const { api, calls } = fakeApi({});
    const blank = await cc.writeAdCopy({ api }, cc.normalizeToday(today()), "   ", "funding");
    assert.match(blank.message, /Write a few words/);
    const noHouse = await cc.writeAdCopy({ api }, cc.normalizeToday(today({ house: {} })), "x", "funding");
    assert.match(noHouse.message, /could not find the Fundhub house account/);
    const off = await cc.writeAdCopy({ api }, cc.normalizeToday(today({ copyReady: { switchOn: false, provider: false, anthropicKey: true } })), "x", "funding");
    assert.equal(off.message, "This cannot write yet: marketing is switched off for the Fundhub house account and no copy writer is set up.");
    const badType = await cc.writeAdCopy({ api }, cc.normalizeToday(today()), "x", "mortgages");
    assert.match(badType.message, /Pick what we are selling/);
    assert.equal(calls.length, 0, "nothing may be sent when the input is not usable");
  });

  test("unknown setup is not treated as 'no'", () => {
    const cc = load();
    assert.equal(cc.setupBlock({ switchOn: null, provider: null, anthropicKey: null }), null);
    const line = cc.setupLine(cc.normalizeToday(today({ copyReady: {} })));
    assert.equal(line.bad, false);
  });
});

describe("Write offer", () => {
  test("before the offer writer ships, the button says it is not ready", () => {
    const cc = load();
    const out = cc.summarizeOffer({ status: 404, body: { ok: false, error: "not_found", path: "marketing/offer/generate" } });
    assert.equal(out.notReady, true);
    assert.equal(out.message, "The offer writer is not ready yet. It turns on with the next update.");
  });

  test("a written offer comes back to the card", async () => {
    const cc = load();
    const calls = [];
    const api = (p, init) => {
      calls.push({ p, init });
      return Promise.resolve({ status: 200, body: { ok: true, offer: { title: "Funding Roadmap", summary: "Know your number.", createdAt: "2026-10-05T18:30:00Z" } } });
    };
    const out = await cc.writeOffer({ api }, cc.normalizeToday(today()));
    assert.equal(calls[0].p, "/api/marketing/offer/generate");
    assert.equal(calls[0].init.body.campaign, "partner");
    assert.equal(calls[0].init.body.partner_id, HOUSE);
    assert.equal(out.tone, "ok");
    assert.equal(out.offer.title, "Funding Roadmap");
    assert.equal(out.offer.text, "Know your number.");
  });

  test("an offer saved earlier shows; none saved says so", () => {
    const cc = load();
    const v1 = cc.normalizeToday(today({ offer: { latest: { summary: "Know your number.", createdAt: "2026-10-05T18:30:00Z" } } }));
    assert.match(cc.renderOfferLatest(v1, NOW), /Know your number\./);
    const v2 = cc.normalizeToday(today());
    assert.match(cc.renderOfferLatest(v2, NOW), /No offer has been written here yet\./);
    assert.match(cc.renderOfferStatus(v2), /Needs a redo/);
  });
});

describe("plain words only", () => {
  test("no error sentence carries a raw status code or a server code word", () => {
    const cc = load();
    const cases = [
      { status: 0, transport: "net" }, { status: 401, body: { ok: false, error: "unauthorized" } },
      { status: 403, body: { ok: false, error: "forbidden" } }, { status: 404, body: { ok: false, error: "not_found" } },
      { status: 400, body: { ok: false, error: "partner_id_required" } }, { status: 500, body: { ok: false, error: "boom: relation x" } },
      { status: 502, body: null }, { status: 503, body: null }
    ];
    for (const what of ["today", "copy", "offer"]) {
      for (const res of cases) {
        const s = cc.plainError(res, what);
        assert.doesNotMatch(s, /\b(4\d\d|5\d\d)\b/, `"${s}" shows a status code`);
        assert.doesNotMatch(s, /_|boom|relation/, `"${s}" leaks a server word`);
        assert.match(s, /\.$/, `"${s}" is not a sentence`);
      }
    }
  });

  test("ad words from the server are escaped, never run as markup", () => {
    const cc = load();
    const html = cc.renderPieces([cc.normalizePiece({ copy_text: "<img src=x onerror=alert(1)>", compliance_state: "passed" })], NOW);
    assert.doesNotMatch(html, /<img/);
    assert.match(html, /&lt;img/);
  });

  test("latest copy: empty says how to make the first one; tries show plain reasons", () => {
    const cc = load();
    const empty = cc.normalizeToday(today({ copy: { pieces: [], jobs: [] } }));
    assert.match(cc.renderLatest(empty, NOW), /No ad copy yet\. Press Write ad copy to make the first one\./);
    const full = cc.renderLatest(cc.normalizeToday(today()), NOW);
    assert.match(full, /No copy writer is switched on for this account\./);
    assert.doesNotMatch(full, /no active provider configured/);
  });
});

describe("the page itself", () => {
  test("exactly one primary button, and it is Write ad copy (UI-STANDARDS §1)", () => {
    const primaries = HTML.match(/class="btn primary"/g) || [];
    assert.equal(primaries.length, 1);
    assert.match(HTML, /<button class="btn primary"[^>]*id="copyBtn"[\s\S]*?Write ad copy<\/span><\/button>/);
    assert.doesNotMatch(SRC, /btn primary/, "the script must not paint a second primary button");
  });

  test("it loads the shell and its own script, and carries the shared sidebar", () => {
    assert.match(HTML, /<script defer src="shell\.js"><\/script>/);
    assert.match(HTML, /<script defer src="marketing-command-center\.js"><\/script>/);
    assert.match(HTML, /<a class="navitem on" href="marketing-command-center\.html">/);
    assert.match(HTML, /class="logo inv"/);
  });

  test("the shell keeps it owner/admin only", () => {
    const shell = fs.readFileSync(path.join(APP, "shell.js"), "utf8");
    const owner = shell.match(/var OWNER_ADMIN_ONLY = \[([\s\S]*?)\];/);
    assert.ok(owner && owner[1].includes('"marketing-command-center.html"'),
      "marketing-command-center.html must be in OWNER_ADMIN_ONLY — marketing/today is owner/admin only");
  });

  test("the company name is spelled Fundhub", () => {
    assert.doesNotMatch(HTML + SRC, /FundHub|FUNDHUB|Fund Hub/);
  });
});
