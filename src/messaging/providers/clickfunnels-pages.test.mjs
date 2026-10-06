// The ClickFunnels custom HTML page provider (build unit X4), against a fake
// ClickFunnels. It reads the page list, makes NEW pages, changes only a page id
// the caller proves is its own, never deletes, and sits behind the ADAPTERS fence.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  cfCreds, listPages, createCustomHtmlPage, putOwnPageHtml, fetchLivePage, getPage, workspaceId, TRANSMITS
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

describe("making a page", () => {
  test("POST custom_html with name, description, the whole page and the address; no head_code, no funnel", async () => {
    const cf = fakeCf((m, u) => (m === "POST" && u.pathname === "/api/v2/workspaces/77/pages/custom_html"
      ? { status: 201, body: { id: 501, public_id: "AbC", current_path: "/blueprint", url: "https://apply.fundhub.ai/blueprint", sdk: { token: "cfp_t" } } }
      : null));
    const out = await createCustomHtmlPage({ env: ENV, fetchImpl: cf.fetchImpl, workspace: "77", name: "Blueprint - Landing", description: "marker", html: "<!doctype html><p>x</p>", path: "/blueprint" });
    assert.deepEqual(out, { ok: true, id: "501", publicId: "AbC", url: "https://apply.fundhub.ai/blueprint", currentPath: "/blueprint", token: "cfp_t" });
    assert.equal(cf.calls.length, 1);
    assert.deepEqual(cf.calls[0].body, { page: { name: "Blueprint - Landing", description: "marker", custom_html: "<!doctype html><p>x</p>", current_path: "/blueprint" } });
    assert.ok(!("head_code" in cf.calls[0].body.page) && !("funnel" in cf.calls[0].body.page));
  });

  test("a dirty address is refused before any request", async () => {
    const cf = fakeCf(() => ({ body: {} }));
    const out = await createCustomHtmlPage({ env: ENV, fetchImpl: cf.fetchImpl, workspace: "77", name: "x", description: "x", html: "x", path: "/../watch" });
    assert.equal(out.ok, false);
    assert.equal(cf.calls.length, 0);
  });

  test("held by the fence unless ADAPTERS_DRY_RUN is an explicit off value", async () => {
    const cf = fakeCf(() => ({ status: 201, body: { id: 1 } }));
    const out = await createCustomHtmlPage({ env: { ...ENV, ADAPTERS_DRY_RUN: undefined }, fetchImpl: cf.fetchImpl, workspace: "77", name: "x", description: "x", html: "x", path: "/x" });
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

  test("the module has no delete and no head or footer code write", () => {
    const src = fs.readFileSync(path.join(HERE, "clickfunnels-pages.mjs"), "utf8")
      .split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");
    assert.ok(!/"DELETE"/.test(src), "no DELETE");
    assert.ok(!/head_code|footer_code/.test(src), "no head_code or footer_code");
    assert.equal((src.match(/"PUT"/g) || []).length, 1, "one PUT, inside putOwnPageHtml");
    assert.equal((src.match(/"POST"/g) || []).length, 1, "one POST, the page create");
  });
});

describe("reading pages back", () => {
  test("getPage reads the page token of a page we made", async () => {
    const cf = fakeCf((m, u) => (u.pathname === "/api/v2/pages/501" ? { body: { id: 501, sdk: { token: "cfp_z" } } } : null));
    const out = await getPage({ env: ENV, fetchImpl: cf.fetchImpl, pageId: "501" });
    assert.equal(out.ok, true);
    assert.equal(out.token, "cfp_z");
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
