// /api/money/vault — the lender packet (Finance OS unit I3): the `packets` list on
// every read, and ?packet=<key> answering one PDF behind the SAME gate as the read.
// The vault itself is the real engine's answer for the screen's sample person; the
// principal, the database and the file store are stubs. No real file, no network.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { PDFDocument } from "pdf-lib";

import handler from "../../api/money/vault.mjs";
import { LEFT_OUT } from "../finance/lender-packet.mjs";
import { sampleVault, CLIENT, BUSINESS, NOW } from "./fixtures/money-vault.sample.mjs";

const ORG = "org-1";
const OTHER = "99999999-8888-4777-8666-555555555555";
const STAFF_ID = "5aff0000-0000-4000-8000-000000000001";
const SNAPSHOT = { id: "dddd0000-0000-4000-8000-000000000001", subtype: "funding_snapshot", title: "Funding Snapshot" };
const docId = (n) => `0d0c0000-0000-4000-8000-${String(n).padStart(12, "0")}`;

function makeRes() {
  return {
    statusCode: null, body: null, raw: null, headers: {},
    status(c) { this.statusCode = c; return this; },
    setHeader(k, v) { this.headers[String(k).toLowerCase()] = v; return this; },
    json(o) { this.body = o; return this; },
    end(b) { this.raw = b; return this; }
  };
}
const clientP = () => ({ kind: "client", accountId: "acc-1", orgId: ORG, clientId: CLIENT.id });
const staffP = (role) => ({ kind: "staff", staffId: STAFF_ID, role, orgId: ORG, staff: { id: STAFF_ID, role, org_id: ORG } });
const gateAs = (p) => async (_req, res, kinds) => {
  if (!p) { res.status(401).json({ ok: false, error: "unauthorized" }); return null; }
  if (!kinds.includes(p.kind)) { res.status(403).json({ ok: false, error: "forbidden" }); return null; }
  return p;
};
const db = { query: async (sql, params) => (/FROM clients/.test(sql) ? { rows: [CLIENT.id].includes(params[0]) ? [{ "?column?": 1 }] : [] } : { rows: [] }) };

async function onePagePdf() {
  const d = await PDFDocument.create();
  d.addPage([612, 792]);
  return Buffer.from(await d.save());
}

async function call(query, principal, over = {}) {
  const res = makeRes();
  const calls = { read: [], papers: [], reader: [], files: [] };
  const pdf = await onePagePdf();
  const deps = {
    db,
    requirePrincipal: gateAs(principal),
    now: () => NOW,
    env: {},
    store: { get: async () => { throw new Error("the stub reader serves bytes"); } },
    readVault: async (_db, args) => { calls.read.push(args); return sampleVault({ variant: over.variant || "full", audience: args.audience }); },
    loadFundhubPapers: async (_db, args) => { calls.papers.push(args); if (over.papersFail) throw new Error("boom"); return [SNAPSHOT]; },
    fileReader: (_db, args) => {
      calls.reader.push(args);
      return async (id) => {
        calls.files.push(id);
        if (over.missingFile === id) return { left_out: LEFT_OUT.NOT_FOUND };
        return { mime: "application/pdf", size: pdf.length, read: async () => pdf };
      };
    },
    ...(over.deps || {})
  };
  await handler({ method: "GET", query, headers: { host: "app.example" } }, res, deps);
  return { res, calls };
}

describe("/api/money/vault — the packet list on every read", () => {
  test("a client's read carries one packet for the personal file and one per business", async () => {
    const { res, calls } = await call({}, clientP());
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body.packets.map((p) => p.key), ["personal", BUSINESS.id]);
    assert.deepEqual(calls.papers, [{ orgId: ORG, clientId: CLIENT.id, now: NOW }]);
    assert.equal(calls.files.length, 0, "a plain read never opens a file");
    assert.equal(res.raw, null);
  });

  test("when the Fundhub papers cannot be read, the vault still answers and the packet says so", async () => {
    const { res } = await call({}, clientP(), { papersFail: true });
    assert.equal(res.statusCode, 200);
    assert.ok(Array.isArray(res.body.items) && res.body.items.length);
    assert.equal(res.body.packets, null);
    assert.equal(res.body.packets_error, "could_not_check");
  });
});

describe("/api/money/vault?packet= — the one PDF", () => {
  test("personal: a PDF of the ready files, saved as an attachment, with nothing left out", async () => {
    const { res, calls } = await call({ packet: "personal" }, clientP());
    assert.equal(res.statusCode, 200);
    assert.equal(res.headers["content-type"], "application/pdf");
    assert.equal(res.headers["content-disposition"], 'attachment; filename="lender-packet-personal-2026-10-07.pdf"');
    assert.equal(res.headers["cache-control"], "private, no-store");
    assert.equal(res.headers["x-packet-files"], "4");
    assert.deepEqual(JSON.parse(res.headers["x-packet-left-out"]), []);
    assert.equal(Buffer.from(res.raw).subarray(0, 5).toString("latin1"), "%PDF-");
    assert.equal((await PDFDocument.load(res.raw)).getPageCount(), 1 + 4);
    assert.deepEqual(calls.files, [docId(1), docId(2), docId(3), SNAPSHOT.id]);
    assert.deepEqual(calls.reader.map((r) => [r.orgId, r.clientId]), [[ORG, CLIENT.id]]);
  });

  test("a client's packet is always their own: a client_id in the query is never read", async () => {
    const { res, calls } = await call({ packet: "personal", client_id: OTHER }, clientP());
    assert.equal(res.statusCode, 200);
    assert.equal(calls.read[0].clientId, CLIENT.id);
    assert.equal(calls.reader[0].clientId, CLIENT.id);
  });

  test("a business packet carries only that business's ready files", async () => {
    const { res, calls } = await call({ packet: BUSINESS.id }, staffP("owner"), {});
    // staff need client_id
    assert.equal(res.statusCode, 400);
    assert.equal(calls.read.length, 0);
    const ok = await call({ packet: BUSINESS.id, client_id: CLIENT.id }, staffP("owner"));
    assert.equal(ok.res.statusCode, 200);
    assert.deepEqual(ok.calls.files, [docId(4), docId(7), SNAPSHOT.id]);
    assert.equal(ok.res.headers["content-disposition"], 'attachment; filename="lender-packet-fundhub-llc-2026-10-07.pdf"');
  });

  test("a file that could not be read is named in x-packet-left-out", async () => {
    const { res } = await call({ packet: "personal" }, clientP(), { missingFile: docId(2) });
    assert.equal(res.statusCode, 200);
    assert.equal(res.headers["x-packet-files"], "3");
    assert.deepEqual(JSON.parse(res.headers["x-packet-left-out"]), [{ id: docId(2), reason: "not_found" }]);
  });

  test("a key that is not a packet key is 400 and nothing is read", async () => {
    for (const bad of ["../x", "", "Personal", "12"]) {
      const { res, calls } = await call({ packet: bad }, clientP());
      assert.equal(res.statusCode, 400, bad);
      assert.equal(res.body.error, "invalid_packet");
      assert.equal(calls.read.length, 0, bad);
    }
  });

  test("a business that is not on this file is 404", async () => {
    const { res, calls } = await call({ packet: OTHER }, clientP());
    assert.equal(res.statusCode, 404);
    assert.equal(res.body.error, "no_such_packet");
    assert.equal(calls.files.length, 0);
  });

  test("nothing ready is 409, never a PDF with only a cover", async () => {
    const empty = await call({ packet: BUSINESS.id }, clientP(), { variant: "empty" });
    // The empty sample has the business scope with every line missing, plus the snapshot.
    assert.equal(empty.res.statusCode, 200, "the funding letter alone is still a packet");
    const noneReadable = await call({ packet: "personal" }, clientP(), {
      variant: "empty",
      deps: { loadFundhubPapers: async () => [] }
    });
    assert.equal(noneReadable.res.statusCode, 409);
    assert.equal(noneReadable.res.body.error, "nothing_ready");
    assert.equal(noneReadable.res.raw, null);
  });

  test("ready files that all fail to read are 409 with the reasons", async () => {
    const { res } = await call({ packet: "personal" }, clientP(), {
      deps: { fileReader: () => async () => ({ left_out: LEFT_OUT.NOT_FOUND }) }
    });
    assert.equal(res.statusCode, 409);
    assert.equal(res.body.left_out.length, 4);
    assert.equal(res.raw, null);
  });

  test("the same staff gate as the read: setters, CSMs and advisors are refused before any read", async () => {
    for (const role of ["setter", "csm", "funding_advisor"]) {
      const { res, calls } = await call({ packet: "personal", client_id: CLIENT.id }, staffP(role));
      assert.equal(res.statusCode, 403, role);
      assert.equal(calls.read.length, 0, role);
      assert.equal(calls.files.length, 0, role);
    }
    assert.equal((await call({ packet: "personal" }, null)).res.statusCode, 401);
    assert.equal((await call({ packet: "personal", client_id: OTHER }, staffP("owner"))).res.statusCode, 404, "another org's client");
  });
});
