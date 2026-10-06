// The funnel push (build unit X4F) with no Postgres and no network: a fake
// ClickFunnels workspace that answers the way the live one did on 2026-10-06
// (src/marketing/fixtures/fake-clickfunnels.mjs) and an in-memory stand-in for
// the four statements the push sends to marketing_funnels, marketing_funnel_pages
// and repo_outbox. The stand-in throws on any statement it does not know, and
// keeps 425's rule that a pushed page's id, address-path and HTML never change.
// The real-database proof is src/http/marketing-funnel-builder.pg.test.mjs (CI).
//
// What it proves: one ClickFunnels funnel per marketing funnel, on the
// apply.fundhub.ai domain; every page made INSIDE it, in order landing ->
// booking -> thank-you, at its own path; the standalone page the first push made
// is moved into the funnel, never made again and never deleted; nothing that was
// there before is touched; and every wrong answer stops the push with the funnel
// still a draft.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { run, cfFunnelName, cfFunnelPath, pageMarker, stepMarker, sortOrderFor, addressIn, PUSH_ORDER, STEP_ORDER } from "./funnel-push.mjs";
import { renderPage } from "./funnel-pages.mjs";
import { pagePaths, urlFor, FUNNEL_ROLES } from "./funnel-paths.mjs";
import { tagMeta } from "./funnel-tracking.mjs";
import { fakeClickFunnels, FAKE_ENV, APPLY_DOMAIN_ID, SUB_HOST } from "./fixtures/fake-clickfunnels.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const COPY = JSON.parse(fs.readFileSync(path.join(HERE, "fixtures/funnel-copy-good.json"), "utf8"));
const ORG = "00000000-0000-4000-8000-0000000000a1";
const ENV = { ...FAKE_ENV, META_PIXEL_ID: "1234567890" };

let seq = 0;
function funnelRows(base = "/blueprint", key = "blueprint") {
  seq += 1;
  const id = `00000000-0000-4000-8000-${String(100000000000 + seq).slice(-12)}`;
  const funnel = {
    id, org_id: ORG, key, name: "Capital Blueprint book a call", path: base, tag: `fnl-${key.replace(/_/g, "-")}`,
    status: "draft", kind: "book_a_call", landing_url: urlFor(base), active: false, live_at: null
  };
  const paths = pagePaths(base);
  const pages = FUNNEL_ROLES.map((role, i) => ({
    id: `00000000-0000-4000-8000-${String(200000000000 + seq * 10 + i).slice(-12)}`,
    org_id: ORG, funnel_id: id, position: i + 1, role, path: paths[role],
    html: renderPage({ funnel, page: { role, path: paths[role] }, copy: COPY, paths, env: ENV }),
    cf_page_id: null, cf_public_id: null, live_url: null, pushed_at: null, sent_sha256: null, proved_at: null, proof: null
  }));
  return { funnel, pages };
}

/** The statements the push sends, and nothing else. */
function fakeDb({ funnel, pages }) {
  const outbox = [];
  const statements = [];
  const byId = (id) => pages.find((p) => p.id === id);
  const clone = (r) => (r ? { ...r } : r);
  return {
    funnel, pages, outbox, statements,
    async query(sql, params = []) {
      const s = sql.replace(/\s+/g, " ").trim();
      statements.push(s);
      if (s.startsWith("SELECT * FROM marketing_funnels WHERE id = $1 AND org_id = $2")) {
        return { rows: funnel.id === params[0] && funnel.org_id === params[1] ? [clone(funnel)] : [] };
      }
      if (s.startsWith("SELECT * FROM marketing_funnel_pages WHERE funnel_id = $1 AND org_id = $2 ORDER BY position")) {
        return { rows: pages.filter((p) => p.funnel_id === params[0]).sort((a, b) => a.position - b.position).map(clone) };
      }
      if (s.includes("SET cf_page_id = $2, cf_public_id = $3, live_url = $4, pushed_at = now()")) {
        const p = byId(params[0]);
        if (!p || p.cf_page_id !== null) return { rows: [] };
        assert.match(String(params[3]), /^https:\/\//, "425: a pushed page has an https address");
        Object.assign(p, { cf_page_id: params[1], cf_public_id: params[2], live_url: params[3], pushed_at: new Date() });
        return { rows: [clone(p)] };
      }
      if (s.includes("SET live_url = $3 WHERE id = $1 AND cf_page_id = $2 AND proved_at IS NULL")) {
        const p = byId(params[0]);
        if (!p || p.cf_page_id !== params[1] || p.proved_at) return { rows: [] };
        p.live_url = params[2];
        return { rows: [clone(p)] };
      }
      if (s.includes("SET sent_sha256 = $2 WHERE id = $1 AND cf_page_id IS NOT NULL")) {
        const p = byId(params[0]);
        if (p && p.cf_page_id) p.sent_sha256 = params[1];
        return { rows: [] };
      }
      if (s.includes("SET proved_at = now(), proof = $2::jsonb")) {
        const p = byId(params[0]);
        if (p && p.cf_page_id) Object.assign(p, { proved_at: new Date(), proof: JSON.parse(params[1]) });
        return { rows: [] };
      }
      if (s.includes("SET proof = $2::jsonb WHERE id = $1")) {
        const p = byId(params[0]);
        if (p) p.proof = JSON.parse(params[1]);
        return { rows: [] };
      }
      if (s.includes("SET status = 'live', live_at = now(), landing_url = $2, active = true")) {
        if (funnel.id !== params[0] || funnel.status !== "draft") return { rows: [] };
        Object.assign(funnel, { status: "live", live_at: new Date(), landing_url: params[1], active: true });
        return { rows: [clone(funnel)] };
      }
      if (s.startsWith("INSERT INTO repo_outbox")) {
        outbox.push({ op_id: params[1], path: params[2], mode: params[3], content: params[4] });
        return { rows: [{ id: outbox.length, op_id: params[1], path: params[2], mode: params[3] }] };
      }
      throw new Error(`fake db: a statement this test does not know: ${s.slice(0, 140)}`);
    }
  };
}

const deps = (cfk) => ({ cf: cfk.cf, sleep: async () => {}, proofWaitMs: 0, wake: async () => ({ ok: true }) });
const job = (funnel) => ({ id: "job-1", org_id: ORG, kind: "funnel_push", payload: { funnel_id: funnel.id, confirm_url: funnel.landing_url } });

/** Run the push; answers { ok, result } or { ok: false, error, final }. */
async function push(db, cfk) {
  try {
    return { ok: true, result: await run(job(db.funnel), { db, env: ENV, deps: deps(cfk) }) };
  } catch (err) {
    return { ok: false, error: String(err && err.message), final: !!(err && err.final) };
  }
}

const posts = (cfk, p) => cfk.writes().filter((c) => c.method === "POST" && c.path === p);
const PAGE_POST = "/api/v2/workspaces/77/pages/custom_html";
const FUNNEL_POST = "/api/v2/workspaces/77/funnels";

describe("small rules", () => {
  test("the ClickFunnels funnel is named by the tag and our row id; its own address is /fnl-...", () => {
    const { funnel } = funnelRows();
    assert.equal(cfFunnelName(funnel), `Fundhub fnl-blueprint ${funnel.id}`);
    assert.equal(cfFunnelPath(funnel), "/fnl-blueprint");
    assert.deepEqual([...PUSH_ORDER], ["thank_you", "booking", "landing"]);
    assert.deepEqual([...STEP_ORDER], ["landing", "booking", "thank_you"]);
  });

  test("a page's address is the funnel host + its step's path, only inside OUR funnel", () => {
    const ours = { id: 7, public_id: "F7" };
    assert.equal(addressIn({ funnelId: "7", stepPath: "/blueprint" }, ours), "https://apply.fundhub.ai/blueprint");
    assert.equal(addressIn({ funnelId: null, funnelPublicId: "F7", stepPath: "/blueprint" }, ours), "https://apply.fundhub.ai/blueprint");
    assert.equal(addressIn({ funnelId: "8", stepPath: "/blueprint" }, ours), null, "another funnel");
    assert.equal(addressIn({ funnelId: null, stepPath: null }, ours), null, "a standalone page");
  });

  test("each new step goes after the pages already in the funnel, so it reads landing, booking, thank-you", () => {
    const { pages } = funnelRows();
    const [landing, booking, thanks] = pages;
    assert.equal(sortOrderFor(thanks, pages), 0);
    thanks.cf_page_id = "1"; thanks.live_url = urlFor(thanks.path);
    assert.equal(sortOrderFor(booking, pages), 0, "booking goes before the thank-you page");
    assert.equal(sortOrderFor(landing, pages), 0);
    landing.cf_page_id = "2"; landing.live_url = urlFor(landing.path);
    assert.equal(sortOrderFor(booking, pages), 1, "booking goes after the landing page");
    assert.equal(sortOrderFor(thanks, pages), 1);
    booking.cf_page_id = "3"; booking.live_url = urlFor(booking.path);
    assert.equal(sortOrderFor(thanks, pages), 2);
  });
});

describe("push live: one ClickFunnels funnel on apply.fundhub.ai", () => {
  test("a fresh push makes one funnel on the domain and three pages in it, in order, and proves each live", async () => {
    const db = fakeDb(funnelRows());
    const cfk = fakeClickFunnels();
    const out = await push(db, cfk);
    assert.equal(out.ok, true, out.error);

    // One NEW funnel, on the apply.fundhub.ai domain, live mode on, named for our row.
    const fposts = posts(cfk, FUNNEL_POST);
    assert.equal(fposts.length, 1);
    assert.deepEqual(fposts[0].body, { funnel: { name: cfFunnelName(db.funnel), current_path: "/fnl-blueprint", domain_id: APPLY_DOMAIN_ID, live_mode: true } });
    const made = cfk.funnels.find((f) => f.name === cfFunnelName(db.funnel));
    assert.equal(String(out.result.cf_funnel_id), String(made.id));
    assert.equal(out.result.funnel_made, true);

    // Three NEW pages, each made INSIDE that funnel, the landing page last.
    const pposts = posts(cfk, PAGE_POST);
    assert.deepEqual(pposts.map((c) => c.body.page.current_path), ["/blueprint-thank-you", "/blueprint-book", "/blueprint"]);
    assert.ok(pposts.every((c) => String(c.body.page.funnel.funnel_id) === String(made.id)), "every page names our funnel");
    assert.deepEqual(pposts.map((c) => c.body.page.sort_order), [0, 0, 0]);
    assert.ok(pposts.every((c) => !("head_code" in c.body.page)));

    // In order on ClickFunnels: landing, booking, thank-you; each at its own address on the domain.
    const ids = Object.fromEntries(db.pages.map((p) => [p.role, p.cf_page_id]));
    assert.deepEqual(cfk.stepPages(made.id), [ids.landing, ids.booking, ids.thank_you]);
    for (const p of db.pages) {
      assert.equal(cfk.liveAddress(p.cf_page_id), urlFor(p.path), `${p.role} is served at its own address`);
      assert.equal(p.live_url, urlFor(p.path));
      assert.ok(p.proved_at, `${p.role} proven`);
      assert.ok(p.sent_sha256, `${p.role} token sent`);
    }
    // The token went into our own pages only; nothing that was there is touched; nothing deleted.
    const puts = cfk.writes().filter((c) => c.method === "PUT");
    assert.equal(puts.length, 3);
    assert.ok(puts.every((c) => Object.values(ids).includes(c.path.split("/").pop())));
    assert.ok(puts.every((c) => "custom_html" in c.body.page && !("current_path" in c.body.page)));
    assert.deepEqual(cfk.touchedBefore(), []);
    assert.ok(cfk.calls.every((c) => c.method !== "DELETE"));
    const html = (role) => cfk.pages.find((p) => String(p.id) === ids[role]).html;
    assert.ok(FUNNEL_ROLES.every((r) => html(r).includes(`<meta name="cf-page-token" content="cfp_${ids[r]}">`)));
    assert.ok(cfk.calls.some((c) => c.host === "apply.fundhub.ai" && c.method === "GET"), "proved on the domain");

    // Live, and queued for the repo.
    assert.equal(db.funnel.status, "live");
    assert.equal(db.funnel.landing_url, "https://apply.fundhub.ai/blueprint");
    assert.deepEqual(db.outbox.map((o) => o.path), [
      "marketing/landing-pages/funnels/blueprint/thank-you.html",
      "marketing/landing-pages/funnels/blueprint/booking.html",
      "marketing/landing-pages/funnels/blueprint/landing.html"
    ]);
    assert.ok(db.outbox.every((o) => o.content.includes(tagMeta("fnl-blueprint"))));
  });

  test("a retry after a crash reuses our funnel by its name and our page by its marker; nothing is made twice", async () => {
    const rows = funnelRows("/capital", "capital");
    const db = fakeDb(rows);
    const cfk = fakeClickFunnels();
    // The first try made the funnel and the thank-you page, then died before saving the page id.
    const f = await cfk.cf.createFunnel({ env: ENV, workspace: "77", name: cfFunnelName(rows.funnel), path: cfFunnelPath(rows.funnel), domainId: String(APPLY_DOMAIN_ID) });
    const thanks = rows.pages.find((p) => p.role === "thank_you");
    const early = await cfk.cf.createCustomHtmlPage({ env: ENV, workspace: "77", funnelId: f.id, sortOrder: 0, name: "x", description: pageMarker(rows.funnel, thanks), html: thanks.html, path: thanks.path });
    assert.equal(early.ok, true, early.error);
    cfk.calls.length = 0;

    const out = await push(db, cfk);
    assert.equal(out.ok, true, out.error);
    assert.equal(out.result.funnel_made, false);
    assert.equal(out.result.adopted, 1);
    assert.equal(out.result.created, 2);
    assert.equal(posts(cfk, FUNNEL_POST).length, 0, "no second funnel");
    assert.deepEqual(posts(cfk, PAGE_POST).map((c) => c.body.page.current_path), ["/capital-book", "/capital"]);
    assert.equal(thanks.cf_page_id, early.id);
    assert.deepEqual(cfk.stepPages(f.id), STEP_ORDER.map((r) => rows.pages.find((p) => p.role === r).cf_page_id));
    assert.equal(db.funnel.status, "live");
  });
});

describe("the page the first push made on its own (the live test, page 25568231)", () => {
  /** The live state: the thank-you row holds a standalone page on the subdomain; nothing else was made. */
  function legacy() {
    const rows = funnelRows("/blueprint", "blueprint");
    const thanks = rows.pages.find((p) => p.role === "thank_you");
    const cfk = fakeClickFunnels();
    const old = cfk.addStandalone({ id: 25568231, name: "Capital Blueprint book a call - Thank you", description: pageMarker(rows.funnel, thanks), current_path: "/blueprint-thank-you", html: thanks.html });
    Object.assign(thanks, { cf_page_id: "25568231", cf_public_id: old.public_id, live_url: `https://${SUB_HOST}/blueprint-thank-you`, pushed_at: new Date() });
    cfk.calls.length = 0;
    return { rows, thanks, cfk, db: fakeDb(rows) };
  }

  test("it is moved into the new funnel at /blueprint-thank-you, never made again and never deleted", async () => {
    const { thanks, cfk, db } = legacy();
    const out = await push(db, cfk);
    assert.equal(out.ok, true, out.error);
    assert.equal(out.result.moved, 1);
    const made = cfk.funnels.find((f) => f.name === cfFunnelName(db.funnel));

    // A step was made for it (a new page of ours, marked), then OUR page was moved onto it.
    const pposts = posts(cfk, PAGE_POST);
    assert.deepEqual(pposts.map((c) => c.body.page.current_path), ["/blueprint-thank-you", "/blueprint-book", "/blueprint"]);
    assert.equal(pposts[0].body.page.description, stepMarker(db.funnel, thanks));
    const moves = cfk.writes().filter((c) => c.method === "PUT" && c.body.page.funnel);
    assert.equal(moves.length, 1);
    assert.equal(moves[0].path, "/api/v2/pages/25568231", "only our own page is moved");
    assert.equal(thanks.cf_page_id, "25568231", "the row keeps its page for good");
    assert.equal(cfk.liveAddress("25568231"), "https://apply.fundhub.ai/blueprint-thank-you");
    assert.equal(thanks.live_url, "https://apply.fundhub.ai/blueprint-thank-you");

    // The step's first page is kept on ClickFunnels, unlinked, and never changed after.
    const holderId = String(cfk.pages.find((p) => p.description === stepMarker(db.funnel, thanks)).id);
    assert.equal(cfk.liveAddress(holderId), null);
    assert.ok(cfk.writes().every((c) => !c.path.endsWith(`/${holderId}`)), "the step's first page gets no PUT");
    assert.ok(cfk.calls.every((c) => c.method !== "DELETE"));
    assert.deepEqual(cfk.touchedBefore(), []);

    // Order and proof.
    assert.deepEqual(cfk.stepPages(made.id), STEP_ORDER.map((r) => db.pages.find((p) => p.role === r).cf_page_id));
    assert.ok(db.pages.every((p) => p.proved_at && p.live_url === urlFor(p.path)));
    assert.ok(cfk.pages.find((p) => String(p.id) === "25568231").html.includes('<meta name="cf-page-token" content="cfp_25568231">'));
    assert.equal(db.funnel.status, "live");
  });

  test("ClickFunnels will not move it: the push stops, the funnel stays a draft, the page stays where it is", async () => {
    const { thanks, db } = legacy();
    const cfk = fakeClickFunnels({ refuseMove: true });
    cfk.addStandalone({ id: 25568231, description: pageMarker(db.funnel, thanks), current_path: "/blueprint-thank-you", html: thanks.html });
    for (const round of [1, 2]) {
      const out = await push(db, cfk);
      assert.equal(out.ok, false, `round ${round}`);
      assert.equal(out.final, true);
      assert.match(out.error, /Page 25568231 stays where it is, and the funnel was not made live/);
    }
    assert.equal(posts(cfk, PAGE_POST).length, 1, "the step page is made once; the Retry finds it by its marker");
    assert.equal(posts(cfk, FUNNEL_POST).length, 1, "one funnel");
    assert.equal(cfk.liveAddress("25568231"), null);
    assert.equal(thanks.live_url, `https://${SUB_HOST}/blueprint-thank-you`);
    assert.equal(db.funnel.status, "draft");
    assert.ok(db.pages.filter((p) => p.role !== "thank_you").every((p) => p.cf_page_id === null), "no more pages were made");
  });
});

describe("every wrong answer stops the push, and the funnel stays a draft", () => {
  test("apply.fundhub.ai is not a ClickFunnels domain: nothing is made", async () => {
    const db = fakeDb(funnelRows("/nodomain", "nodomain"));
    const cfk = fakeClickFunnels({ noApplyDomain: true });
    const out = await push(db, cfk);
    assert.equal(out.final, true);
    assert.match(out.error, /apply\.fundhub\.ai is not a website domain on ClickFunnels/);
    assert.deepEqual(cfk.writes(), []);
  });

  test("an address another page or funnel uses stops the push before anything is made", async () => {
    for (const [base, key] of [["/roadmap-x", "roadmap_x"], ["/vsl", "vsl"]]) {
      const rows = funnelRows(base, key);
      const cfk = fakeClickFunnels();
      if (base === "/roadmap-x") cfk.addStandalone({ name: "somebody", description: "not ours", current_path: "/roadmap-x-book" });
      cfk.calls.length = 0;
      const out = await push(fakeDb(rows), cfk);
      assert.equal(out.final, true, base);
      assert.match(out.error, /already a page on ClickFunnels, and this machine did not make it/);
      assert.deepEqual(cfk.writes(), [], `${base}: nothing made`);
    }
  });

  test("ClickFunnels makes the funnel without the domain: no page is made", async () => {
    const db = fakeDb(funnelRows("/nodom", "nodom"));
    const cfk = fakeClickFunnels({ funnelNoDomain: true });
    for (const round of [1, 2]) {
      const out = await push(db, cfk);
      assert.equal(out.final, true);
      assert.match(out.error, round === 1 ? /without the apply\.fundhub\.ai domain/ : /is not on apply\.fundhub\.ai/);
    }
    assert.equal(posts(cfk, FUNNEL_POST).length, 1, "the Retry finds it and makes no second one");
    assert.equal(posts(cfk, PAGE_POST).length, 0);
  });

  test("ClickFunnels puts a step at another path: stops at that page, keeps its id, makes nothing on the Retry", async () => {
    const db = fakeDb(funnelRows("/stepx", "stepx"));
    const cfk = fakeClickFunnels({ stepSuffix: "-2" });
    for (const round of [1, 2]) {
      const out = await push(db, cfk);
      assert.equal(out.final, true, `round ${round}`);
      assert.match(out.error, /ClickFunnels put \/stepx-thank-you at https:\/\/apply\.fundhub\.ai\/stepx-thank-you-2, not at https:\/\/apply\.fundhub\.ai\/stepx-thank-you/);
    }
    assert.equal(posts(cfk, PAGE_POST).length, 1);
    const thanks = db.pages.find((p) => p.role === "thank_you");
    assert.ok(thanks.cf_page_id);
    assert.equal(thanks.live_url, "https://apply.fundhub.ai/stepx-thank-you-2", "the address ClickFunnels used is kept as it is");
    assert.equal(cfk.writes().filter((c) => c.method === "PUT").length, 0, "no token, no move");
    assert.ok(cfk.calls.every((c) => c.host !== "apply.fundhub.ai"), "nothing was read as proof");
    assert.equal(db.funnel.status, "draft");
  });

  test("ClickFunnels makes the page outside the funnel: it is moved in through a step, or the push stops", async () => {
    const db = fakeDb(funnelRows("/solo", "solo"));
    const cfk = fakeClickFunnels({ standaloneOnly: true });
    const out = await push(db, cfk);
    assert.equal(out.final, true);
    // Either the step page lands outside the funnel too, or ClickFunnels refuses
    // it: the push stops both ways and never deletes anything.
    assert.match(out.error, /ClickFunnels put the step for \/solo-thank-you at no address in this funnel|Making \/solo-thank-you: ClickFunnels refused it \(HTTP 422/);
    assert.equal(db.funnel.status, "draft");
    assert.ok(cfk.calls.every((c) => c.method !== "DELETE"));
  });

  test("the steps come back out of order: the funnel is not made live", async () => {
    const db = fakeDb(funnelRows("/order", "order"));
    const cfk = fakeClickFunnels({ ignoreSortOrder: true });
    const out = await push(db, cfk);
    assert.equal(out.final, true);
    assert.match(out.error, /does not hold its three pages in order \(landing, booking, thank-you\)/);
    assert.equal(db.funnel.status, "draft");
    assert.ok(db.pages.every((p) => !p.proved_at), "nothing proven or called live");
  });

  test("an answer with no address is never filled in; each Retry takes its page back by its marker until it is live", async () => {
    const db = fakeDb(funnelRows("/noaddr", "noaddr"));
    const cfk = fakeClickFunnels({ noAddress: true });
    const first = await push(db, cfk);
    assert.equal(first.final, true);
    assert.match(first.error, /ClickFunnels answered without the page address for \/noaddr-thank-you/);
    assert.ok(db.pages.every((p) => p.cf_page_id === null && p.live_url === null), "no address was guessed");
    assert.match((await push(db, cfk)).error, /without the page address for \/noaddr-book/);
    assert.match((await push(db, cfk)).error, /without the page address for \/noaddr\. /);
    const last = await push(db, cfk);
    assert.equal(last.ok, true, last.error);
    assert.equal(posts(cfk, PAGE_POST).length, 3, "each page made once");
    assert.equal(posts(cfk, FUNNEL_POST).length, 1);
    assert.equal(db.funnel.status, "live");
  });

  test("a 429 while making a page is tried again later, not failed for good", async () => {
    const db = fakeDb(funnelRows("/busy", "busy"));
    const cfk = fakeClickFunnels({ busy: 1 });
    const out = await push(db, cfk);
    assert.equal(out.ok, false);
    assert.equal(out.final, false);
    assert.match(out.error, /HTTP 429/);
    assert.ok(db.pages.every((p) => p.cf_page_id === null));
    const again = await push(db, cfk);
    assert.equal(again.ok, true, again.error);
    assert.equal(posts(cfk, FUNNEL_POST).length, 1, "the funnel from the first try is reused");
  });
});
