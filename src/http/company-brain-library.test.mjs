import test from "node:test";
import assert from "node:assert/strict";

import handler from "../../api/company-brain/library.mjs";
import { categoryForInstruction, listLibraryFiles } from "../company-brain/library.mjs";

const ORG = "11111111-1111-4111-8111-111111111111";

function response() {
  return {
    statusCode: 200,
    body: null,
    headers: {},
    setHeader(key, value) { this.headers[key] = value; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }
  };
}

test("library lists only approved, readable, non-client instruction files", async () => {
  let query;
  let values;
  const db = { query: async (sql, args) => {
    query = sql;
    values = args;
    return { rows: [
      { id: "one", name: "Closer Call Script.pdf", web_view_link: "https://drive.google.com/file/one", source: "drive", updated_at: "2026-10-30" },
      { id: "two", name: "Funding class core.md", web_view_link: "javascript:alert(1)", source: "upload", updated_at: "2026-10-29" }
    ] };
  } };
  const result = await listLibraryFiles(db, { orgId: ORG, role: "closer" });
  assert.equal(result.ok, true);
  assert.deepEqual(values.slice(0, 2), [ORG, ["public", "sales", "staff"]]);
  assert.match(query, /f\.approval_status = 'approved'/);
  assert.match(query, /f\.client_id IS NULL/);
  assert.match(query, /f\.access_tier = ANY/);
  assert.match(query, /c\.access_tier = f\.access_tier/);
  assert.deepEqual(result.files.map((file) => file.category), ["Sales", "Funding"]);
  assert.equal(result.files[0].url, "https://drive.google.com/file/one");
  assert.equal(result.files[1].url, null);
});

test("library refuses an external role before querying", async () => {
  let queried = false;
  const result = await listLibraryFiles({ query: async () => { queried = true; } }, { orgId: ORG, role: "affiliate" });
  assert.equal(result.ok, false);
  assert.equal(queried, false);
});

test("instruction category matches the work named by the file", () => {
  assert.equal(categoryForInstruction("Client onboarding checklist"), "Onboarding");
  assert.equal(categoryForInstruction("CSM support guide"), "Support");
  assert.equal(categoryForInstruction("Team handbook"), "General");
});

test("library endpoint uses the signed-in role and company", async () => {
  let seen;
  const res = response();
  await handler({ method: "GET" }, res, {
    db: {},
    requireAuth: async () => ({ id: "staff", org_id: ORG, role: "owner" }),
    listLibraryFiles: async (_db, scope) => { seen = scope; return { ok: true, files: [] }; }
  });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(seen, { orgId: ORG, role: "owner" });
  assert.deepEqual(res.body.files, []);
});

test("library endpoint rejects non-staff and unsupported methods", async () => {
  const forbidden = response();
  await handler({ method: "GET" }, forbidden, {
    db: {},
    requireAuth: async () => ({ id: "external", org_id: ORG, role: "affiliate" }),
    listLibraryFiles: async () => { throw new Error("should not list"); }
  });
  assert.equal(forbidden.statusCode, 403);

  const method = response();
  await handler({ method: "POST" }, method, { db: {} });
  assert.equal(method.statusCode, 405);
  assert.equal(method.headers.allow, "GET");
});
