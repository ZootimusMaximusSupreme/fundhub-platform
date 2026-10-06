// The ClickFunnels custom HTML page provider (build unit X4), against a fake
// ClickFunnels. It reads the page list, makes NEW pages, changes only a page id
// the caller proves is its own, never deletes, and sits behind the ADAPTERS fence.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  cfCreds, listPages, listFunnels, listDomains, createFunnel, createCustomHtmlPage, putOwnPageHtml,
  moveOwnPageOntoStep, fetchLivePage, getPage, funnelStructure, stepOf, workspaceId, TRANSMITS
} from "./clickfunnels-pages.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ENV = { CLICKFUNNELS_API_KEY: "cf_test_key", CLICKFUNNELS_SUBDOMAIN: "acme", CLICKFUNNELS_WORKSPACE_ID: "77", ADAPTERS_DRY_RUN: "0" };

function fakeCf(routes) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url, method: init.method || "GET", body: init.body ? JSON.parse(init.body) : null, headers: init.headers || {} });
    const u = new URL(url);
    const hit = routes(init.method || "GET", u);
    const status = hit ? hit.status ?? 200 : 404;
    const body = hit ? hit.body : { error: "not found" };
    return {
      ok: status >= 200 && status < 300,
      status,
      text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
      headers: new Map(Object.entries(hit && hit.headers ? hit.headers : {}))
    };
  };
  return { calls, fetchImpl };
}

describe("credentials", () => {
  test("the key from env; a masked or missing key is refused by name", () => {
    assert.deepEqual(cfCreds(ENV), { apiKey: "cf_test_key", subdomain: "acme", workspaceId: "77" });
    assert.match(cfCreds({}).error, /CLICKFUNNELS_API_KEY is not set/);
    assert.match(cfCreds({ CLICKFUNNELS_API_KEY: "****abcd" }).error, /masked/);
    assert.equal(cfCreds({ CLICKFUNNELS_API_KEY: "k" }).subdomain, "chrisstanbridgestea3f77f");
    assert.equal(TRANSMITS, true);
  });
});

describe("reading the page list (read only)", () => {
  test("follows Pagination-Next and sends the key and a User-Agent", async () => {
    const cf = fakeCf((m, u) => {
      if (m === "GET" && u.pathname === "/api/v2/workspaces/77/pages" && !u.searchParams.get("after")) {
        return { body: [{ id: 1, current_path: "/watch" }], headers: { "pagination-next": "1" } };
      }
      if (m === "GET" && u.pathname === "/api/v2/workspaces/77/pages" && u.searchParams.get("after") === "1") {
        return { body: [{ id: 2, current_path: "/blueprint" }] };
      }
      return null;
    });
    const out = await listPages({ env: ENV, fetchImpl: cf.fetchImpl });
    assert.equal(out.ok, true);
    assert.deepEqual(out.pages.map((p) => p.id), [1, 2]);
    assert.equal(out.workspace, "77");
    assert.ok(cf.calls.every((c) => c.method === "GET"));
    assert.equal(cf.calls[0].headers.authorization, "Bearer cf_test_key");
    assert.match(cf.calls[0].headers["user-agent"], /Fundhub/);
  });

  test("finds the workspace by subdomain when no id is set", async () => {
    const env = { ...ENV, CLICKFUNNELS_WORKSPACE_ID: "" };
    const cf = fakeCf((m, u) => {
      if (u.pathname === "/api/v2/teams") return { body: [{ id: 5 }] };
      if (u.pathname === "/api/v2/teams/5/workspaces") return { body: [{ id: 9, subdomain: "other" }, { id: 10, subdomain: "acme" }] };
      return null;
    });
    assert.deepEqual(await workspaceId(cfCreds(env), { env, fetchImpl: cf.fetchImpl }), { ok: true, id: "10" });
  });

  test("a refused key is said in plain words", async () => {
    const cf = fakeCf(() => ({ status: 401, body: { error: "bad key" } }));
    const out = await listPages({ env: ENV, fetchImpl: cf.fetchImpl });
    assert.equal(out.ok, false);
    assert.match(out.error, /refused the key \(HTTP 401\)/);
  });
});

describe("making a funnel", () => {
  test("POST funnels: name, its own address, the domain id and live mode; answers the id and the domain", async () => {
    const cf = fakeCf((m, u) => (m === "POST" && u.pathname === "/api/v2/workspaces/77/funnels"
      ? { status: 201, body: { id: 991, public_id: "FnL", name: "Fundhub fnl-blueprint x", current_path: "/fnl-blueprint", domain_id: 673591, live_mode: true } }
      : null));
    const out = await createFunnel({ env: ENV, fetchImpl: cf.fetchImpl, workspace: "77", name: "Fundhub fnl-blueprint x", path: "/fnl-blueprint", domainId: "673591" });
    assert.equal(out.ok, true, out.error);
    assert.equal(out.id, "991");
    assert.equal(out.domainId, "673591");
    assert.deepEqual(cf.calls[0].body, { funnel: { name: "Fundhub fnl-blueprint x", current_path: "/fnl-blueprint", domain_id: 673591, live_mode: true } });
  });

  test("no domain or a dirty address is refused before any request", async () => {
    const cf = fakeCf(() => ({ status: 201, body: { id: 1 } }));
    assert.equal((await createFunnel({ env: ENV, fetchImpl: cf.fetchImpl, workspace: "77", name: "x", path: "/fnl-x", domainId: "" })).ok, false);
    assert.equal((await createFunnel({ env: ENV, fetchImpl: cf.fetchImpl, workspace: "77", name: "x", path: "/../x", domainId: "5" })).ok, false);
    assert.equal(cf.calls.length, 0);
  });
});

describe("making a page", () => {
  test("POST custom_html INSIDE a funnel: name, description, the whole page, the address, the step position; no head_code", async () => {
    const answer = {
      id: 501, public_id: "AbC", current_path: "/capital-blueprint-landing-page", url: "https://acme.myclickfunnels.com/capital-blueprint-landing-page",
      show_page_step: { id: 77001, public_id: "StP", current_path: "/blueprint", sort_order: 0 },
      funnel: { id: 991, public_id: "FnL", name: "Fundhub fnl-blueprint x" }, sdk: { token: "cfp_t" }
    };
    const cf = fakeCf((m, u) => (m === "POST" && u.pathname === "/api/v2/workspaces/77/pages/custom_html" ? { status: 201, body: answer } : null));
    const out = await createCustomHtmlPage({ env: ENV, fetchImpl: cf.fetchImpl, workspace: "77", funnelId: "991", sortOrder: 0, name: "Blueprint - Landing", description: "marker", html: "<!doctype html><p>x</p>", path: "/blueprint" });
    assert.equal(out.ok, true, out.error);
    assert.equal(out.id, "501");
    assert.equal(out.token, "cfp_t");
    assert.equal(out.url, "https://acme.myclickfunnels.com/capital-blueprint-landing-page", "the url ClickFunnels answers is the subdomain, kept as it is");
    assert.equal(out.funnelId, "991");
    assert.equal(out.stepId, "77001");
    assert.equal(out.stepPath, "/blueprint");
    assert.equal(cf.calls.length, 1);
    assert.deepEqual(cf.calls[0].body, { page: { name: "Blueprint - Landing", description: "marker", custom_html: "<!doctype html><p>x</p>", current_path: "/blueprint", sort_order: 0, funnel: { funnel_id: "991" } } });
    assert.ok(!("head_code" in cf.calls[0].body.page));
  });

  test("a page outside a funnel is refused before any request: it would never be served on apply.fundhub.ai", async () => {
    const cf = fakeCf(() => ({ status: 201, body: { id: 1 } }));
    for (const funnelId of [undefined, "", "../x"]) {
      const out = await createCustomHtmlPage({ env: ENV, fetchImpl: cf.fetchImpl, workspace: "77", funnelId, name: "x", description: "x", html: "x", path: "/x" });
      assert.equal(out.ok, false);
      assert.match(out.error, /outside a funnel/);
    }
    assert.equal(cf.calls.length, 0);
  });

  test("a failed make carries the HTTP status, so a busy 429 can be told from a refused 422", async () => {
    for (const status of [429, 422, 401]) {
      const cf = fakeCf(() => ({ status, body: { error: "no" } }));
      const out = await createCustomHtmlPage({ env: ENV, fetchImpl: cf.fetchImpl, workspace: "77", funnelId: "9", name: "x", description: "x", html: "x", path: "/x" });
      assert.equal(out.ok, false);
      assert.equal(out.status, status);
      assert.match(out.error, new RegExp(`HTTP ${status}`));
    }
  });

  test("a dirty address or step position is refused before any request", async () => {
    const cf = fakeCf(() => ({ body: {} }));
    const out = await createCustomHtmlPage({ env: ENV, fetchImpl: cf.fetchImpl, workspace: "77", funnelId: "9", name: "x", description: "x", html: "x", path: "/../watch" });
    assert.equal(out.ok, false);
    const bad = await createCustomHtmlPage({ env: ENV, fetchImpl: cf.fetchImpl, workspace: "77", funnelId: "9", sortOrder: -1, name: "x", description: "x", html: "x", path: "/x" });
    assert.equal(bad.ok, false);
    assert.equal(cf.calls.length, 0);
  });

  test("held by the fence unless ADAPTERS_DRY_RUN is an explicit off value", async () => {
    const cf = fakeCf(() => ({ status: 201, body: { id: 1 } }));
    const out = await createCustomHtmlPage({ env: { ...ENV, ADAPTERS_DRY_RUN: undefined }, fetchImpl: cf.fetchImpl, workspace: "77", funnelId: "9", name: "x", description: "x", html: "x", path: "/x" });
    assert.equal(out.ok, false);
    assert.match(out.error, /held by the outbound fence/);
    assert.equal(cf.calls.length, 0, "nothing was sent");
  });
});

describe("changing a page: only our own", () => {
  test("a page id that is not in ownedIds is refused and no request is made", async () => {
    const cf = fakeCf(() => ({ body: {} }));
    const out = await putOwnPageHtml({ env: ENV, fetchImpl: cf.fetchImpl, pageId: "25516164", html: "x", ownedIds: ["501", "502"] });
    assert.equal(out.ok, false);
    assert.equal(out.refused, true);
    assert.match(out.error, /was not made by this machine/);
    assert.equal(cf.calls.length, 0);
  });

  test("our own page: one PUT /pages/{id} with custom_html only", async () => {
    const cf = fakeCf((m, u) => (m === "PUT" && u.pathname === "/api/v2/pages/501" ? { body: { id: 501 } } : null));
    const out = await putOwnPageHtml({ env: ENV, fetchImpl: cf.fetchImpl, pageId: "501", html: "<p>y</p>", ownedIds: ["501"] });
    assert.deepEqual(out, { ok: true });
    assert.deepEqual(cf.calls.map((c) => [c.method, new URL(c.url).pathname]), [["PUT", "/api/v2/pages/501"]]);
    assert.deepEqual(cf.calls[0].body, { page: { custom_html: "<p>y</p>" } });
  });

  test("moving a page onto a step: only our own page, one PUT with the step id only", async () => {
    const cf = fakeCf((m, u) => (m === "PUT" && u.pathname === "/api/v2/pages/25568231" ? { body: { id: 25568231 } } : null));
    const refused = await moveOwnPageOntoStep({ env: ENV, fetchImpl: cf.fetchImpl, pageId: "25516164", stepId: "77001", ownedIds: ["25568231"] });
    assert.equal(refused.ok, false);
    assert.equal(refused.refused, true);
    assert.equal(cf.calls.length, 0, "a page we did not make: no request");
    const out = await moveOwnPageOntoStep({ env: ENV, fetchImpl: cf.fetchImpl, pageId: "25568231", stepId: "77001", ownedIds: ["25568231"] });
    assert.deepEqual(out, { ok: true });
    assert.deepEqual(cf.calls[0].body, { page: { funnel: { show_page_step_id: "77001" } } });
    assert.equal((await moveOwnPageOntoStep({ env: ENV, fetchImpl: cf.fetchImpl, pageId: "25568231", stepId: "", ownedIds: ["25568231"] })).refused, true);
  });

  test("the module has no delete and no head or footer code write; one PUT for our own pages, two POSTs (funnel, page)", () => {
    const src = fs.readFileSync(path.join(HERE, "clickfunnels-pages.mjs"), "utf8")
      .split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");
    assert.ok(!/"DELETE"/.test(src), "no DELETE");
    assert.ok(!/"PATCH"/.test(src), "no PATCH");
    assert.ok(!/head_code|footer_code/.test(src), "no head_code or footer_code");
    assert.equal((src.match(/"PUT"/g) || []).length, 1, "one PUT, inside putOwnPage (the owned-id check)");
    assert.equal((src.match(/"POST"/g) || []).length, 2, "two POSTs: the funnel create and the page create");
  });
});

describe("reading pages back", () => {
  test("getPage reads the page token of a page we made, and where it sits", async () => {
    const cf = fakeCf((m, u) => (u.pathname === "/api/v2/pages/501" ? { body: { id: 501, sdk: { token: "cfp_z" } } } : null));
    const out = await getPage({ env: ENV, fetchImpl: cf.fetchImpl, pageId: "501" });
    assert.equal(out.ok, true);
    assert.equal(out.token, "cfp_z");
    assert.equal(out.standalone, true, "no funnel, no step");
  });

  test("stepOf: the funnel and the step's path (lower case, no trailing slash); the url is not the address", () => {
    assert.deepEqual(stepOf({ url: "https://acme.myclickfunnels.com/x-page", show_page_step: { id: 3, current_path: "/Roadmap/" }, funnel: { id: 984178, public_id: "YxAGqw" } }),
      { funnelId: "984178", funnelPublicId: "YxAGqw", stepId: "3", stepPath: "/roadmap", standalone: false });
    assert.deepEqual(stepOf({ url: "https://acme.myclickfunnels.com/blueprint-thank-you", show_page_step: null, funnel: null }),
      { funnelId: null, funnelPublicId: null, stepId: null, stepPath: null, standalone: true });
  });

  test("lists of funnels and domains, and a funnel's steps in order (read only)", async () => {
    const cf = fakeCf((m, u) => {
      if (u.pathname === "/api/v2/workspaces/77/funnels") return { body: [{ id: 984178, name: "Fundhub $297 Roadmap", current_path: "/fundhub-297-roadmap", domain_id: 673591 }] };
      if (u.pathname === "/api/v2/workspaces/77/domains") return { body: [{ id: 673591, name: "apply.fundhub.ai" }] };
      if (u.pathname === "/api/v2/funnels/984178/structure") {
        return { body: { funnel: { id: 984178 }, steps: [
          { step_type: "show_page_step", show_page_step_id: "oyEOAN", page: { id: 25516164 } },
          { step_type: "show_page_step", show_page_step_id: "gVOBpl", page: { id: 25516165 } }
        ] } };
      }
      return null;
    });
    const f = await listFunnels({ env: ENV, fetchImpl: cf.fetchImpl });
    assert.equal(f.ok, true);
    assert.equal(f.funnels[0].domain_id, 673591);
    const d = await listDomains({ env: ENV, fetchImpl: cf.fetchImpl });
    assert.equal(d.domains[0].name, "apply.fundhub.ai");
    const st = await funnelStructure({ env: ENV, fetchImpl: cf.fetchImpl, funnelId: "984178" });
    assert.deepEqual(st.steps.map((x) => x.pageId), ["25516164", "25516165"]);
    assert.ok(cf.calls.every((c) => c.method === "GET"));
  });

  test("fetchLivePage busts the cache and sends no key", async () => {
    const cf = fakeCf((m, u) => (u.host === "apply.fundhub.ai" && u.pathname === "/blueprint" ? { body: "<html>live</html>" } : null));
    const out = await fetchLivePage({ env: ENV, fetchImpl: cf.fetchImpl, url: "https://apply.fundhub.ai/blueprint", now: 1234 });
    assert.equal(out.ok, true);
    assert.equal(out.html, "<html>live</html>");
    assert.equal(new URL(cf.calls[0].url).searchParams.get("fh_cb"), "1234");
    assert.equal(cf.calls[0].headers.authorization, undefined);
    assert.equal((await fetchLivePage({ env: ENV, fetchImpl: cf.fetchImpl, url: "http://apply.fundhub.ai/x" })).ok, false);
  });
});
