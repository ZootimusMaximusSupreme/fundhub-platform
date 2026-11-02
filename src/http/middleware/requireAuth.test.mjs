import { test } from "node:test";
import assert from "node:assert";
import { requireAuth, authenticate, attachStaff, bearerToken, AUTH_UNAVAILABLE } from "./requireAuth.mjs";
import { hashToken, newToken } from "../../auth/session.mjs";

const STAFF = {
  id: "staff-1", org_id: "org-1", role: "closer", roles: ["closer"],
  email: "a@b.com", name: "A", status: "active",
  avatarUrl: null
};

function fakeDb({ live = true, throws = false } = {}) {
  const calls = [];
  return {
    calls,
    async query(sql, params = []) {
      calls.push({ sql, params });
      if (throws) throw new Error("connection refused");
      if (!live) return { rows: [] };
      return { rows: [{
        session_id: "sess-1", expires_at: new Date(Date.now() + 6e8),
        staff_id: STAFF.id, org_id: STAFF.org_id, role: STAFF.role,
        email: STAFF.email, name: STAFF.name, status: STAFF.status, active_flag: null
      }] };
    }
  };
}

function fakeRes() {
  const res = { statusCode: null, body: null };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  return res;
}

const req = (headers = {}) => ({ headers });

// ------------------------------------------------------- token extraction

test("bearerToken reads Authorization: Bearer, case-insensitively", () => {
  assert.equal(bearerToken(req({ authorization: "Bearer abc123" })), "abc123");
  assert.equal(bearerToken(req({ authorization: "bearer abc123" })), "abc123");
  assert.equal(bearerToken(req({ Authorization: "Bearer abc123" })), "abc123");
  assert.equal(bearerToken(req({ authorization: "  Bearer   abc123  " })), "abc123");
});

test("bearerToken reads x-session-token and the fundhub_session cookie", () => {
  assert.equal(bearerToken(req({ "x-session-token": "tok-1" })), "tok-1");
  assert.equal(bearerToken(req({ cookie: "fundhub_session=tok-2" })), "tok-2");
  assert.equal(bearerToken(req({ cookie: "other=x; fundhub_session=tok-3; more=y" })), "tok-3");
  assert.equal(bearerToken(req({ cookie: "fundhub_session=a%2Bb" })), "a+b", "url-decoded");
});

test("bearerToken refuses a token in the query string", () => {
  // Query strings land in access logs and CDN records; this token is a live credential.
  const r = { headers: {}, query: { token: "leaky", key: "leaky", session: "leaky" } };
  assert.equal(bearerToken(r), null);
});

test("bearerToken returns null rather than throwing on odd input", () => {
  assert.equal(bearerToken(req()), null);
  assert.equal(bearerToken(req({ authorization: "Basic dXNlcjpwYXNz" })), null);
  assert.equal(bearerToken(req({ authorization: "Bearer" })), null);
  assert.equal(bearerToken(req({ authorization: 42 })), null);
  assert.equal(bearerToken(req({ cookie: "malformed" })), null);
  assert.equal(bearerToken(req({ cookie: "fundhub_session_other=x" })), null);
  assert.equal(bearerToken({}), null);
  assert.equal(bearerToken(null), null);
});

test("Authorization wins over the cookie when both are present", () => {
  assert.equal(bearerToken(req({ authorization: "Bearer hdr", cookie: "fundhub_session=cke" })), "hdr");
});

// ------------------------------------------------------------ authenticate

test("authenticate verifies by token hash and returns staff + session", async () => {
  const token = newToken();
  const db = fakeDb();
  const out = await authenticate(req({ authorization: `Bearer ${token}` }), { db });
  assert.deepEqual(out.staff, STAFF);
  assert.equal(out.session.id, "sess-1");
  assert.equal(db.calls[0].params[0], hashToken(token), "looked up by hash, never by raw token");
});

test("authenticate returns null with no token, and issues no query", async () => {
  const db = fakeDb();
  assert.equal(await authenticate(req(), { db }), null);
  assert.equal(db.calls.length, 0);
});

test("authenticate returns null for an expired/revoked/unknown session", async () => {
  assert.equal(await authenticate(req({ authorization: "Bearer nope" }), { db: fakeDb({ live: false }) }), null);
});

/* This asserted that a database failure resolves to null — i.e. is reported to
   the caller as "not signed in". It was justified by leaving room for the
   dashboard shared-secret fallback, which now fails closed, and it is misleading
   on its own terms: during an outage every user is told their credentials are
   bad and the frontend signs them out. "I could not check" is a distinct answer
   from "you are not authenticated". */
test("a database failure is AUTH_UNAVAILABLE, not null and not a throw", async () => {
  const out = await authenticate(req({ authorization: "Bearer x" }), { db: fakeDb({ throws: true }) });
  assert.equal(out, AUTH_UNAVAILABLE);
  assert.notEqual(out, null, "an outage must not look like a missing session");
});

test("a genuinely absent or unknown session is still plain null", async () => {
  assert.equal(await authenticate(req({}), { db: fakeDb() }), null, "no token");
  assert.equal(
    await authenticate(req({ authorization: "Bearer nope" }), { db: fakeDb({ live: false }) }),
    null, "unknown session");
});

test("a malformed session cookie is not a crash", async () => {
  // decodeURIComponent throws URIError on "%zz"; that used to escape
  // authenticate() and 500 every authenticated route, including logout, so the
  // bad cookie could not be cleared from inside the app.
  const r = req({ cookie: "fundhub_session=%zz" });
  const out = await authenticate(r, { db: fakeDb({ live: false }) });
  assert.equal(out, null, "a malformed cookie should be no session, not an exception");
});

// ------------------------------------------------------------ attach + gate

test("attachStaff hangs staff and session off the request", async () => {
  const r = req({ authorization: `Bearer ${newToken()}` });
  const staff = await attachStaff(r, { db: fakeDb() });
  assert.deepEqual(staff, STAFF);
  assert.deepEqual(r.staff, STAFF);
  assert.equal(r.session.id, "sess-1");
});

test("attachStaff leaves the request untouched when unauthenticated", async () => {
  const r = req();
  assert.equal(await attachStaff(r, { db: fakeDb() }), null);
  assert.equal(r.staff, undefined);
  assert.equal(r.session, undefined);
});

test("requireAuth returns the staff on success and writes nothing", async () => {
  const res = fakeRes();
  const staff = await requireAuth(req({ authorization: `Bearer ${newToken()}` }), res, { db: fakeDb() });
  assert.deepEqual(staff, STAFF);
  assert.equal(res.statusCode, null, "no response written on success");
});

test("requireAuth returns a clean 401 that leaks no reason", async () => {
  // Expired, revoked, suspended and never-existed stay indistinguishable — the
  // difference is only useful to someone probing. "db down" is NOT in this list
  // any more: it is our failure, not the caller's, and is asserted below.
  for (const [label, opts, headers] of [
    ["no token", {}, {}],
    ["unknown session", { live: false }, { authorization: "Bearer nope" }]
  ]) {
    const res = fakeRes();
    const staff = await requireAuth(req(headers), res, { db: fakeDb(opts) });
    assert.equal(staff, null, label);
    assert.equal(res.statusCode, 401, label);
    assert.deepEqual(res.body, { ok: false, error: "unauthorized" }, label);
    assert.equal(Object.keys(res.body).length, 2, `${label}: no extra detail`);
  }
});

test("requireAuth answers 503 db:down on an outage, so nobody is told to sign in again", async () => {
  const res = fakeRes();
  const staff = await requireAuth(req({ authorization: "Bearer x" }), res,
    { db: fakeDb({ throws: true }) });
  assert.equal(staff, null);
  assert.equal(res.statusCode, 503, "an outage was reported as 401 unauthorized");
  assert.equal(res.body.db, "down",
    "public/app/data.js keys its 'backend unavailable' banner off db:'down'");
});

test("the 401 body never contains a token, an email or a staff id", async () => {
  const token = newToken();
  const res = fakeRes();
  await requireAuth(req({ authorization: `Bearer ${token}` }), res, { db: fakeDb({ live: false }) });
  const blob = JSON.stringify(res.body);
  assert.ok(!blob.includes(token));
  assert.ok(!blob.includes(STAFF.email));
  assert.ok(!blob.includes(STAFF.id));
});
