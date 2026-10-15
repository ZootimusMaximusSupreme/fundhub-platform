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
import { hasFulfilmentDisclosure } from "../brand/templates.mjs";

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

  test("PUT keeps each free-text field to its length and its type: the longest allowed is saved, one more is refused", async () => {
    const limits = { wordmark_url: 2048, voice: 2000, entity_name: 200, entity_address: 500, domain: 253 };
    for (const [field, max] of Object.entries(limits)) {
      const ok = baseTables();
      const good = await call(brandHandler, req("PUT", { body: { partner_id: PARTNER, [field]: "a".repeat(max) } }), ok, owner());
      assert.equal(good.res.statusCode, 200, `${field} at ${max}`);
      assert.equal(good.res.body.brand[field].length, max);
      const t = baseTables();
      const before = JSON.stringify(t.brands);
      const over = await call(brandHandler, req("PUT", { body: { partner_id: PARTNER, [field]: "a".repeat(max + 1) } }), t, owner());
      assert.equal(over.res.statusCode, 400, `${field} at ${max + 1}`);
      assert.match(over.res.body.problems.join(" "), new RegExp(`${field} must be ${max} characters or fewer`));
      assert.equal(JSON.stringify(t.brands), before);
    }
    const email = baseTables();
    const longEmail = await call(brandHandler, req("PUT", { body: { partner_id: PARTNER, support_email: `${"a".repeat(310)}@example.test` } }), email, owner());
    assert.equal(longEmail.res.statusCode, 400);
    assert.match(longEmail.res.body.problems.join(" "), /support_email must be 320 characters or fewer/);
    // A value that is not text at all is refused with its own words.
    for (const [field, value] of [["entity_name", { name: "Acme" }], ["domain", 12345], ["voice", ["a"]], ["entity_address", true]]) {
      const t = baseTables();
      const { res, fake } = await call(brandHandler, req("PUT", { body: { partner_id: PARTNER, [field]: value } }), t, owner());
      assert.equal(res.statusCode, 400, field);
      assert.match(res.body.problems.join(" "), new RegExp(`${field} must be a string`));
      assert.equal(fake.state.writes.length, 0);
    }
  });

  test("PUT takes the funnel list and the ramp as lists, and saves them as JSON so the database can read them", async () => {
    const t = baseTables();
    const bad = await call(brandHandler, req("PUT", { body: { partner_id: PARTNER, selected_funnels: "apply" } }), t, owner());
    assert.equal(bad.res.statusCode, 400);
    assert.match(bad.res.body.problems.join(" "), /selected_funnels must be an array/);
    const badRamp = await call(brandHandler, req("PUT", { body: { partner_id: PARTNER, ramp: "#000000" } }), baseTables(), owner());
    assert.equal(badRamp.res.statusCode, 400);
    assert.match(badRamp.res.body.problems.join(" "), /ramp must be an array/);
    const ok = await call(brandHandler, req("PUT", { body: { partner_id: PARTNER, selected_funnels: ["apply", "book"], ramp: [] } }), t, owner());
    assert.equal(ok.res.statusCode, 200, JSON.stringify(ok.res.body));
    assert.deepEqual(t.brands[0].selected_funnels, ["apply", "book"]);
    const insert = ok.fake.calls.find((c) => /INSERT INTO partner_brand/.test(c.sql));
    const cols = /INSERT INTO partner_brand \(([^)]+)\)/.exec(insert.sql)[1].split(",").map((c) => c.trim());
    for (const col of ["selected_funnels", "ramp"]) {
      assert.equal(typeof insert.params[cols.indexOf(col)], "string", `${col} is sent as JSON text`);
    }
  });

  test("PUT needs a partner id that is an id, before anything is read or saved", async () => {
    const t = baseTables();
    const before = JSON.stringify(t.brands);
    const none = await call(brandHandler, req("PUT", { body: { voice: "x" } }), t, owner());
    assert.equal(none.res.statusCode, 400);
    assert.equal(none.res.body.error, "partner_id_required");
    const bad = await call(brandHandler, req("PUT", { body: { partner_id: "nope", voice: "x" } }), t, owner());
    assert.equal(bad.res.statusCode, 400);
    assert.equal(bad.res.body.error, "invalid_partner_id");
    assert.equal(JSON.stringify(t.brands), before);
    assert.equal(none.fake.state.writes.length + bad.fake.state.writes.length, 0);
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

  test("a page request has to name a real partner and, to change a page, a real page with something to change", async () => {
    const t = pagesTables();
    const before = JSON.stringify(t.pages);
    const getNone = await call(pagesHandler, req("GET", { query: {} }), t, owner());
    assert.deepEqual([getNone.res.statusCode, getNone.res.body.error], [400, "partner_id_required"]);
    assert.equal(getNone.fake.sqlOf(/partner_pages|partner_brand/).length, 0, "no page was read for a missing partner id");
    const postBad = await call(pagesHandler, req("POST", { body: { partner_id: "nope", funnel_key: "apply" } }), t, owner());
    assert.deepEqual([postBad.res.statusCode, postBad.res.body.error], [400, "partner_id_required"]);
    const patchNone = await call(pagesHandler, req("PATCH", { body: { title: "No id" } }), t, owner());
    assert.deepEqual([patchNone.res.statusCode, patchNone.res.body.error], [400, "id_required"]);
    const patchEmpty = await call(pagesHandler, req("PATCH", { body: { id: "a2000000-0000-4000-8000-000000000002" } }), t, owner());
    assert.deepEqual([patchEmpty.res.statusCode, patchEmpty.res.body.error], [400, "nothing_to_update"]);
    assert.equal(JSON.stringify(t.pages), before, "no page changed");
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

  test("every new page starts with all four legal blocks, locked, in the partner's own trading name, for every funnel", async () => {
    for (const funnel of ["apply", "diag", "edu", "aff", "book"]) {
      const t = pagesTables({ pages: [] });
      const { res } = await call(pagesHandler, req("POST", { body: { partner_id: PARTNER, funnel_key: funnel } }), t, owner());
      assert.equal(res.statusCode, 200, funnel);
      const body = res.body.page.body_json;
      assert.equal(body.template, funnel);
      const legal = body.sections.filter((s) => s.type === "legal");
      assert.deepEqual(legal.map((s) => s.id), ["legal-lender", "legal-outcomes", "legal-sms", "legal-fulfilment"], funnel);
      assert.ok(legal.every((s) => s.locked === true), `${funnel}: every legal block is locked`);
      assert.match(legal[0].text, /^Acme Capital is not a direct lender/);
      assert.match(legal[1].text, /^Acme Capital does not guarantee approval/);
      assert.match(legal[3].text, /provided and performed by FundHub\. Acme Capital is an independent marketing partner/);
      assert.equal(hasFulfilmentDisclosure(body), true, `${funnel}: the fulfilment disclosure is there and locked`);
      assert.ok(body.sections.some((s) => s.type !== "legal" && s.locked === false), `${funnel}: and the partner's own sections are editable`);
      // The page is saved with exactly that body.
      assert.deepEqual(t.pages[0].body_json, body);
    }
  });

  test("a new page's title and address come from the caller or the funnel, and the address is made safe", async () => {
    const own = pagesTables({ pages: [] });
    const a = await call(pagesHandler, req("POST", { body: { partner_id: PARTNER, funnel_key: "apply", title: "  Our funding review  ", slug: "Hello World & Co!" } }), own, owner());
    assert.equal(a.res.statusCode, 200);
    assert.equal(a.res.body.page.title, "Our funding review", "trimmed");
    assert.equal(a.res.body.page.slug, "hello-world---co-", "lower case, letters digits and hyphens only");
    const long = pagesTables({ pages: [] });
    const b = await call(pagesHandler, req("POST", { body: { partner_id: PARTNER, funnel_key: "apply", slug: "x".repeat(100) } }), long, owner());
    assert.equal(b.res.body.page.slug.length, 63);
    const plain = pagesTables({ pages: [] });
    const c = await call(pagesHandler, req("POST", { body: { partner_id: PARTNER, funnel_key: "edu" } }), plain, owner());
    assert.deepEqual([c.res.body.page.title, c.res.body.page.slug], ["Education funnel", "education"]);
  });

  test("an edit changes the title and the address of the partner's own page, safely, and leaves the rest", async () => {
    const t = pagesTables();
    const id = "a2000000-0000-4000-8000-000000000002";
    const a = await call(pagesHandler, req("PATCH", { body: { id, title: "  Book a call  ", slug: "Book A Call!" } }), t, owner());
    assert.equal(a.res.statusCode, 200, JSON.stringify(a.res.body));
    assert.equal(t.pages[1].title, "Book a call");
    assert.equal(t.pages[1].slug, "book-a-call-");
    assert.equal(t.pages[1].status, "draft");
    assert.equal(t.pages[1].funnel_key, "book");
    const mine = await call(pagesHandler, req("PATCH", { body: { id, title: "Partner's own title" } }), t, partner());
    assert.equal(mine.res.statusCode, 200);
    assert.equal(t.pages[1].title, "Partner's own title");
    assert.equal(t.pages[1].slug, "book-a-call-", "a field not sent is left alone");
  });

  test("a published page has an address on the partner's own domain only once that domain is verified", async () => {
    const unverified = pagesTables({ brands: [{
      partner_id: PARTNER, org_id: ORG_ID, entity_name: "Acme Capital", domain: "acme.example.test", domain_verified: false, selected_funnels: ["apply"],
    }] });
    const { res } = await call(pagesHandler, req("GET", { query: { partner_id: PARTNER } }), unverified, owner());
    const live = res.body.items.find((i) => i.slug === "apply");
    assert.equal(live.live_url, `/sites/${PARTNER}/apply`, "an unverified domain is not used");
    assert.equal(live.live_path, `/sites/${PARTNER}/apply`);
    assert.equal(res.body.domain, "acme.example.test");
    assert.equal(res.body.domain_verified, false);
    const noDomain = pagesTables({ brands: [{ partner_id: PARTNER, org_id: ORG_ID, entity_name: "Acme Capital", domain: null, domain_verified: true, selected_funnels: [] }] });
    const none = await call(pagesHandler, req("GET", { query: { partner_id: PARTNER } }), noDomain, owner());
    assert.equal(none.res.body.items.find((i) => i.slug === "apply").live_url, `/sites/${PARTNER}/apply`);
    assert.equal(none.res.body.domain, null);
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
