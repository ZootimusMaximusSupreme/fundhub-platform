// finish-853 batch 08: the white-label partner doors. GET/PUT /api/partner-brand and
// GET/POST/PATCH /api/partner-pages. The real handlers run on a stand-in that builds each INSERT
// and UPDATE from the statement's own column list, so a column the SQL stops writing (or a
// condition it stops carrying) changes the answer. Practice test, fake data, no network, no database.
import { test, describe } from "node:test";
import assert from "node:assert/strict";

import brandHandler from "../../api/partner-brand.mjs";
import pagesHandler from "../../api/partner-pages.mjs";
import { makeRes, req, runWithSharedDb, staffSession, accountSession, ORG_ID, OTHER_ORG_ID } from "./../testing/handler-harness.mjs";
import { partnerTables } from "../testing/fin-b08-partner-tables.mjs";
import { STAFF_ROLES } from "../pulse/catalog/proofs/s2-route-kit.mjs";

const PARTNER = "d1000000-0000-4000-8000-000000000001";
const OTHER_PARTNER = "d2000000-0000-4000-8000-000000000002";
const FOREIGN_PARTNER = "d3000000-0000-4000-8000-000000000003";

// One stand-in carrying the session rules and the partner tables.
async function call(handler, request, tables, who) {
  const fake = partnerTables({ ...tables, extra: who });
  const res = makeRes();
  await runWithSharedDb(fake, () => handler(request, res));
  return { res, fake };
}

const owner = (role = "owner", org_id = ORG_ID) => [staffSession({ role, org_id })];
const partner = (partnerId = PARTNER) => accountSession({ kind: "partner", partnerId, orgId: ORG_ID });
const baseTables = (over = {}) => ({
  partners: [
    { id: PARTNER, org_id: ORG_ID },
    { id: OTHER_PARTNER, org_id: ORG_ID },
    { id: FOREIGN_PARTNER, org_id: OTHER_ORG_ID },
  ],
  brands: [{
    partner_id: PARTNER, org_id: ORG_ID, wordmark_url: "https://cdn.example.test/acme.svg", ink: "#101820", paper: "#fafafa",
    ramp: [], entity_name: "Acme Capital", domain: "acme.example.test", domain_verified: true, selected_funnels: ["apply"],
    approval_status: "approved",
  }],
  ...over,
});

describe("GET and PUT /api/partner-brand", () => {
  test("an owner reads a partner's brand: trading name, colours, domain and funnels, as the effective brand", async () => {
    const { res } = await call(brandHandler, req("GET", { query: { partner_id: PARTNER } }), baseTables(), owner());
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.brand.partner_id, PARTNER);
    assert.equal(res.body.brand.entity_name, "Acme Capital");
    assert.equal(res.body.brand.ink, "#101820");
    assert.equal(res.body.brand.domain, "acme.example.test");
    assert.deepEqual(res.body.brand.selected_funnels, ["apply"]);
  });

  test("reads need an id, a valid id and a brand that exists", async () => {
    const t = baseTables();
    assert.equal((await call(brandHandler, req("GET", { query: {} }), t, owner())).res.body.error, "partner_id_required");
    assert.equal((await call(brandHandler, req("GET", { query: { partner_id: "nope" } }), t, owner())).res.body.error, "invalid_partner_id");
    const none = await call(brandHandler, req("GET", { query: { partner_id: OTHER_PARTNER } }), t, owner());
    assert.equal(none.res.statusCode, 404);
  });

  test("every staff role is tried: only owner and admin read or write a partner's brand, and the brand table is not touched for the rest", async () => {
    const letIn = [];
    for (const role of STAFF_ROLES) {
      const read = await call(brandHandler, req("GET", { query: { partner_id: PARTNER } }), baseTables(), owner(role));
      const t = baseTables();
      const write = await call(brandHandler, req("PUT", { body: { partner_id: PARTNER, voice: "bold" } }), t, owner(role));
      if (read.res.statusCode === 403) {
        assert.equal(write.res.statusCode, 403, `${role} write`);
        assert.equal(read.fake.sqlOf(/partner_brand|v_partner_brand/).length, 0, `${role}: nothing read`);
        assert.equal(t.brands[0].voice, undefined, `${role}: nothing written`);
      } else {
        letIn.push(role);
        assert.equal(write.res.statusCode, 200, `${role} write`);
      }
    }
    assert.deepEqual(letIn.sort(), ["admin", "owner"]);
  });

  test("a partner reads and edits only their own brand; another partner's id is refused", async () => {
    const mine = await call(brandHandler, req("GET", { query: { partner_id: PARTNER } }), baseTables(), partner());
    assert.equal(mine.res.statusCode, 200);
    const theirs = await call(brandHandler, req("GET", { query: { partner_id: OTHER_PARTNER } }), baseTables(), partner());
    assert.equal(theirs.res.statusCode, 403);
    const t = baseTables();
    const edit = await call(brandHandler, req("PUT", { body: { partner_id: OTHER_PARTNER, voice: "loud" } }), t, partner());
    assert.equal(edit.res.statusCode, 403);
    assert.equal(t.brands.length, 1, "no brand row was created for the other partner");
  });

  test("PUT saves exactly the brand fields sent and leaves the others as they were", async () => {
    const t = baseTables();
    const sent = {
      wordmark_url: "https://cdn.example.test/new.svg", ink: "#112233", paper: "#eeeeee",
      ramp: ["#000000", "#111111", "#222222", "#333333", "#444444", "#555555"],
      display_face: "Playfair Display", mono_face: "IBM Plex Mono", voice: "Plain and warm",
      entity_name: "Acme Capital LLC", entity_address: "1 Main St, Phoenix AZ", support_email: "help@acme.example.test",
      domain: "new.acme.example.test", selected_funnels: ["apply", "book"],
    };
    const { res, fake } = await call(brandHandler, req("PUT", { body: { partner_id: PARTNER, ...sent } }), t, owner());
    assert.equal(res.statusCode, 200);
    for (const [field, value] of Object.entries(sent)) {
      assert.deepEqual(res.body.brand[field], value, `${field} is saved and read back`);
    }
    assert.equal(res.body.brand.domain_verified, true, "the domain check is not touched");
    assert.equal(res.body.brand.approval_status, "approved", "the review status is not touched");
    const write = fake.state.writes.find((w) => w.table === "partner_brand");
    assert.deepEqual(write.cols.sort(), Object.keys(sent).sort());

    const partial = await call(brandHandler, req("PUT", { body: { partner_id: PARTNER, voice: "Short" } }), t, owner());
    assert.equal(partial.res.body.brand.voice, "Short");
    assert.equal(partial.res.body.brand.ink, "#112233", "a field not sent is left alone");
    assert.deepEqual(partial.fake.state.writes.find((w) => w.table === "partner_brand").cols, ["voice"]);
  });

  test("PUT cannot write the disclosure or approval fields: 400 and nothing is stored", async () => {
    for (const field of ["disclosure", "approval_status", "approved_at", "approved_by", "domain_verified", "compliance_text"]) {
      const t = baseTables();
      const before = JSON.stringify(t.brands);
      const { res, fake } = await call(brandHandler, req("PUT", { body: { partner_id: PARTNER, [field]: "x", voice: "ok" } }), t, owner());
      assert.equal(res.statusCode, 400, field);
      assert.match(res.body.problems.join(" "), new RegExp(`${field} is not writable`));
      assert.equal(JSON.stringify(t.brands), before, field);
      assert.equal(fake.state.writes.length, 0, field);
    }
  });

  test("PUT checks colours, font names, the six-stop ramp and the email before it saves anything", async () => {
    const bad = [
      [{ ink: "red" }, /ink must be #rrggbb/],
      [{ paper: "#12345" }, /paper must be #rrggbb/],
      [{ display_face: "Evil; DROP" }, /display_face must be a Google Fonts family name/],
      [{ ramp: ["#000000"] }, /exactly six stops/],
      [{ support_email: "not-an-email" }, /support_email must be an email address/],
      [{ entity_name: "x".repeat(201) }, /entity_name must be 200 characters or fewer/],
    ];
    for (const [fields, pattern] of bad) {
      const t = baseTables();
      const { res, fake } = await call(brandHandler, req("PUT", { body: { partner_id: PARTNER, ...fields } }), t, owner());
      assert.equal(res.statusCode, 400, JSON.stringify(fields));
      assert.match(res.body.problems.join(" "), pattern);
      assert.equal(fake.state.writes.length, 0);
    }
  });

  test("PUT for a partner that does not exist is 404 and a first save creates the brand under the partner's own company", async () => {
    const t = baseTables({ brands: [] });
    const missing = await call(brandHandler, req("PUT", { body: { partner_id: "d9000000-0000-4000-8000-000000000009", voice: "x" } }), t, owner());
    assert.equal(missing.res.statusCode, 404);
    const created = await call(brandHandler, req("PUT", { body: { partner_id: OTHER_PARTNER, entity_name: "Beta Funding" } }), t, owner());
    assert.equal(created.res.statusCode, 200);
    assert.equal(t.brands.length, 1);
    assert.equal(t.brands[0].org_id, ORG_ID);
    assert.equal(t.brands[0].entity_name, "Beta Funding");
  });
});

describe("GET, POST and PATCH /api/partner-pages", () => {
  const page = (over = {}) => ({
    id: "a1000000-0000-4000-8000-000000000001", org_id: ORG_ID, partner_id: PARTNER, funnel_key: "apply", title: "Apply", slug: "apply",
    status: "published", body_json: { sections: [
      { id: "hero", type: "hero", headline: "Get funded" },
      { id: "legal-lender", type: "legal", locked: true, text: "Not a direct lender." },
    ] }, published_at: "2026-10-01T00:00:00.000Z", created_at: "x", updated_at: "x", ...over,
  });
  const pagesTables = (over = {}) => baseTables({
    pages: [
      page(),
      page({ id: "a2000000-0000-4000-8000-000000000002", slug: "book", funnel_key: "book", status: "draft", published_at: null }),
      page({ id: "a3000000-0000-4000-8000-000000000003", partner_id: OTHER_PARTNER, slug: "apply" }),
      page({ id: "a4000000-0000-4000-8000-000000000004", org_id: OTHER_ORG_ID, partner_id: PARTNER, slug: "leak" }),
    ],
    settings: [{ partner_id: PARTNER, marketing_suite_enabled: true, ai_token_cap_monthly: 1000, org_id: ORG_ID }],
    ...over,
  });

  test("GET lists this partner's pages in this company, with a live address only for a published one", async () => {
    const { res } = await call(pagesHandler, req("GET", { query: { partner_id: PARTNER } }), pagesTables(), owner());
    assert.equal(res.statusCode, 200);
    const slugs = res.body.items.map((i) => i.slug).sort();
    assert.deepEqual(slugs, ["apply", "book"], "another partner's page and another company's page are not listed");
    const live = res.body.items.find((i) => i.slug === "apply");
    assert.equal(live.live_path, `/sites/${PARTNER}/apply`);
    assert.equal(live.live_url, "https://acme.example.test/apply", "a verified domain is used for the live address");
    const draft = res.body.items.find((i) => i.slug === "book");
    assert.equal(draft.live_path, null);
    assert.equal(draft.live_url, null);
    assert.equal(res.body.domain_verified, true);
    assert.deepEqual(res.body.templates, ["apply", "diag", "edu", "aff", "book"]);
  });

  test("a partner sees only their own pages; naming another partner is 403 and another partner's page is 404", async () => {
    const t = pagesTables();
    const other = await call(pagesHandler, req("GET", { query: { partner_id: OTHER_PARTNER } }), t, partner());
    assert.equal(other.res.statusCode, 403);
    const patch = await call(pagesHandler, req("PATCH", { body: { id: "a3000000-0000-4000-8000-000000000003", title: "Mine now" } }), t, partner());
    assert.equal(patch.res.statusCode, 404);
    assert.equal(t.pages[2].title, "Apply", "the other partner's page is untouched");
  });

  test("POST makes a draft page from a funnel template with the brand's name, and records the funnel on the brand", async () => {
    const t = pagesTables({ pages: [] });
    const { res } = await call(pagesHandler, req("POST", { body: { partner_id: PARTNER, funnel_key: "diag" } }), t, owner());
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.page.status, "draft");
    assert.equal(res.body.page.funnel_key, "diag");
    assert.equal(res.body.page.slug, "diagnostic");
    assert.equal(res.body.page.org_id, ORG_ID);
    assert.match(JSON.stringify(res.body.page.body_json), /Acme Capital/, "the legal blocks carry the brand's trading name");
    assert.ok(t.brands[0].selected_funnels.includes("diag"));
    assert.equal(res.body.page.published_at, null);
  });

  test("POST refuses an unknown funnel and a partner of another company", async () => {
    const t = pagesTables({ pages: [] });
    const unknown = await call(pagesHandler, req("POST", { body: { partner_id: PARTNER, funnel_key: "casino" } }), t, owner());
    assert.equal(unknown.res.statusCode, 400);
    assert.equal(unknown.res.body.error, "unknown_funnel_key");
    const foreign = await call(pagesHandler, req("POST", { body: { partner_id: FOREIGN_PARTNER, funnel_key: "apply" } }), t, owner());
    assert.equal(foreign.res.statusCode, 404);
    assert.equal(foreign.res.body.error, "partner_not_found");
    assert.equal(t.pages.length, 0);
  });

  test("a partner cannot start a page for another partner of the same company: 403 and no page is made", async () => {
    const t = pagesTables({ pages: [] });
    const { res, fake } = await call(pagesHandler, req("POST", { body: { partner_id: OTHER_PARTNER, funnel_key: "apply" } }), t, partner());
    assert.equal(res.statusCode, 403);
    assert.equal(res.body.error, "forbidden");
    assert.equal(t.pages.length, 0);
    assert.equal(fake.state.writes.length, 0, "the other partner's brand was not touched either");
    // The same partner can still start their own.
    const own = await call(pagesHandler, req("POST", { body: { partner_id: PARTNER, funnel_key: "apply" } }), t, partner());
    assert.equal(own.res.statusCode, 200);
    assert.equal(t.pages.length, 1);
    assert.equal(t.pages[0].partner_id, PARTNER);
  });

  test("a sign-in with no company on it reads and writes nothing: 403 no_org_scope on every method", async () => {
    const t = pagesTables();
    const before = JSON.stringify(t.pages);
    const calls = [
      req("GET", { query: { partner_id: PARTNER } }),
      req("POST", { body: { partner_id: PARTNER, funnel_key: "book" } }),
      req("PATCH", { body: { id: "a2000000-0000-4000-8000-000000000002", status: "published" } }),
    ];
    for (const request of calls) {
      const { res, fake } = await call(pagesHandler, request, t, owner("owner", null));
      assert.equal(res.statusCode, 403, request.method);
      assert.equal(res.body.error, "no_org_scope", request.method);
      assert.equal(fake.sqlOf(/partner_pages|partner_brand|partners/).length, 0, `${request.method}: no partner table was read`);
    }
    assert.equal(JSON.stringify(t.pages), before);
  });

  test("publishing stamps published_at and goes live; unpublishing clears the stamp", async () => {
    const t = pagesTables();
    const id = "a2000000-0000-4000-8000-000000000002";
    const publish = await call(pagesHandler, req("PATCH", { body: { id, status: "published" } }), t, owner());
    assert.equal(publish.res.statusCode, 200);
    assert.equal(publish.res.body.page.status, "published");
    assert.ok(t.pages[1].published_at, "published_at is stamped");
    const unpublish = await call(pagesHandler, req("PATCH", { body: { id, status: "draft" } }), t, owner());
    assert.equal(unpublish.res.statusCode, 200);
    assert.equal(t.pages[1].status, "draft");
    assert.equal(t.pages[1].published_at, null, "unpublishing clears the stamp");
  });

  test("publishing is refused while the partner's marketing suite is off, and the page stays a draft", async () => {
    const t = pagesTables({ settings: [{ partner_id: PARTNER, marketing_suite_enabled: false, ai_token_cap_monthly: 1000, org_id: ORG_ID }] });
    const { res } = await call(pagesHandler, req("PATCH", { body: { id: "a2000000-0000-4000-8000-000000000002", status: "published" } }), t, owner());
    assert.equal(res.statusCode, 403);
    assert.equal(res.body.error, "suite_off");
    assert.equal(t.pages[1].status, "draft");
    assert.equal(t.pages[1].published_at, null);
  });

  test("an edit cannot remove or change a locked legal block, and a page of another company cannot be edited", async () => {
    const t = pagesTables();
    const id = "a1000000-0000-4000-8000-000000000001";
    const { res } = await call(pagesHandler, req("PATCH", { body: { id, body_json: { sections: [
      { id: "hero", type: "hero", headline: "Brand new headline" },
      { id: "legal-lender", type: "legal", locked: true, text: "We guarantee approval." },
    ] } } }), t, owner());
    assert.equal(res.statusCode, 200);
    const sections = t.pages[0].body_json.sections;
    assert.equal(sections.find((s) => s.id === "hero").headline, "Brand new headline");
    assert.equal(sections.find((s) => s.id === "legal-lender").text, "Not a direct lender.", "the locked legal text is kept");
    // Same id, but the block comes back without its locked flag: the stored locked block still wins.
    const unflagged = await call(pagesHandler, req("PATCH", { body: { id, body_json: { sections: [
      { id: "hero", type: "hero", headline: "Brand new headline" },
      { id: "legal-lender", type: "legal", text: "Approval is guaranteed." },
    ] } } }), t, owner());
    assert.equal(unflagged.res.statusCode, 200);
    assert.equal(t.pages[0].body_json.sections.find((s) => s.id === "legal-lender").text, "Not a direct lender.");
    const stripped = await call(pagesHandler, req("PATCH", { body: { id, body_json: { sections: [{ id: "hero", type: "hero", headline: "Only this" }] } } }), t, owner());
    assert.equal(stripped.res.statusCode, 200);
    assert.ok(t.pages[0].body_json.sections.some((s) => s.id === "legal-lender"), "a locked block cannot be dropped");

    const foreignId = "a4000000-0000-4000-8000-000000000004";
    const foreign = await call(pagesHandler, req("PATCH", { body: { id: foreignId, title: "Hijacked" } }), t, owner());
    assert.equal(foreign.res.statusCode, 404);
    assert.equal(t.pages[3].title, "Apply");
  });

  test("every staff role is tried: only owner and admin reach the page editor", async () => {
    const letIn = [];
    for (const role of STAFF_ROLES) {
      const { res } = await call(pagesHandler, req("GET", { query: { partner_id: PARTNER } }), pagesTables(), owner(role));
      if (res.statusCode !== 403) letIn.push(role);
    }
    assert.deepEqual(letIn.sort(), ["admin", "owner"]);
  });
});
