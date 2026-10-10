// Fakes for the pulse tests: a Postgres client and a fetch. No network, no database.
//
// WHY THEY ARE NOT "ANSWER ANYTHING". A fake that answers every query with canned
// rows proves nothing about the SQL (CLAUDE.md §12, pulse v1 rules). So:
//   - the fake pg behaves like Postgres where it matters to the read box:
//       * a failed statement leaves the transaction ABORTED (25P02) until
//         ROLLBACK TO SAVEPOINT, so a missing savepoint fails the test
//       * a write inside BEGIN READ ONLY fails with 25006
//       * it records every statement it was sent, in order
//       * it can be told to fail a statement, or to hang one (forever, or until
//         a server-side statement timeout)
//   - the fake fetch throws for a URL nobody gave it an answer for.
// Real SQL is proven against the real database by `node scripts/pulse/run-beat.mjs --probe`
// and by each beat's read-only calibration run.

/* ---------------- fake pg ---------------- */

const pgError = (code, message) => Object.assign(new Error(message), { code });
const firstWord = (text) => (/^\s*([a-z]+)/i.exec(text) || [])[1]?.toLowerCase() ?? "";
const WRITE_VERBS = new Set(["insert", "update", "delete", "create", "drop", "alter", "truncate", "grant", "revoke"]);

/**
 * createFakePg(options) -> a client with query(), release(), end() and a record of what happened.
 *
 * options:
 *   answer(text, params) -> rows array | { rows, rowCount }   canned rows for a user statement (default: [])
 *   fail(text)           -> Error | undefined                  fail a user statement
 *   hang(text)           -> boolean                            hang a user statement
 *   hangOnRollback       boolean                               ROLLBACK never returns
 *   serverTimeoutMs      number | null                         a hung statement is cancelled by the "server" after this
 *   roSetting / scsSetting   what current_setting(...) reports at setup (default "on" / "on")
 *
 * The client has: statements (every statement, split on ;, each with mode "simple" | "extended"), texts(), released (array of the
 * destroy flag per release), ended, commits, rollbacks, settings (set_config calls), inTxn, readOnly, aborted.
 */
export function createFakePg(options = {}) {
  const {
    answer = () => [], fail = () => undefined, hang = () => false,
    hangOnRollback = false, serverTimeoutMs = null, roSetting = "on", scsSetting = "on"
  } = options;

  const state = { inTxn: false, readOnly: false, aborted: false };
  const client = {
    statements: [],
    released: [],
    ended: false,
    commits: 0,
    rollbacks: 0,
    settings: [],
    get inTxn() { return state.inTxn; },
    get readOnly() { return state.readOnly; },
    get aborted() { return state.aborted; },
    texts() { return client.statements.map((s) => s.text); },
    release(destroy) { client.released.push(destroy === true || (destroy !== undefined && destroy !== false)); },
    async end() { client.ended = true; },

    async query(input, params) {
      const text = typeof input === "string" ? input : String(input?.text ?? "");
      const values = params ?? (typeof input === "object" ? input.values : undefined);
      const extended = typeof input === "object" && input?.queryMode === "extended";
      // Like Postgres: the extended protocol takes ONE command per string and says so
      // before it runs anything. (This split is on ";", so it is a model of that rule, not
      // proof of how Postgres lexes. The lexer is proven against the real database by
      // src/pulse/beats/readbox.pg.test.mjs.)
      if (extended && text.split(";").map((s) => s.trim()).filter(Boolean).length > 1) {
        client.statements.push({ text, params: values, mode: "extended", refused: true });
        throw pgError("42601", "cannot insert multiple commands into a prepared statement");
      }
      // A parameterless string is a simple query and may hold several statements.
      const parts = values === undefined
        ? text.split(";").map((s) => s.trim()).filter(Boolean)
        : [text.trim()];
      const results = [];
      for (const part of parts) results.push(await one(part, values, extended ? "extended" : "simple"));
      return results.length > 1 ? results : results[0];
    }
  };

  const ok = (rows = [], command = "SELECT") => ({ rows, rowCount: rows.length, command });

  async function one(text, values, mode = "simple") {
    client.statements.push({ text, params: values, mode });
    const lower = text.toLowerCase();
    const verb = firstWord(text);

    if (verb === "rollback" && /^rollback\s+to\b/.test(lower)) {
      state.aborted = false;
      return ok([], "ROLLBACK");
    }
    if (verb === "rollback") {
      client.rollbacks++;
      if (hangOnRollback) return new Promise(() => {});
      state.inTxn = false; state.readOnly = false; state.aborted = false;
      return ok([], "ROLLBACK");
    }
    if (verb === "commit" || verb === "end") {
      client.commits++;
      state.inTxn = false;
      return ok([], "COMMIT");
    }
    if (verb === "begin") {
      state.inTxn = true;
      state.readOnly = /read\s+only/.test(lower);
      return ok([], "BEGIN");
    }
    if (state.aborted) throw pgError("25P02", "current transaction is aborted, commands ignored until end of transaction block");
    if (verb === "savepoint" || (verb === "release")) return ok([], verb.toUpperCase());
    if (verb === "set") return ok([], "SET");

    if (/^select\s+set_config\(/.test(lower)) {
      client.settings.push(text);
      return ok([{ set_config: "" }]);
    }
    if (/current_setting\('transaction_read_only'\)\s+as\s+ro_at_close/.test(lower)) {
      return ok([{ ro_at_close: state.inTxn && state.readOnly ? "on" : "off" }]);
    }
    if (/current_setting\('transaction_read_only'\)\s+as\s+ro\b/.test(lower)) {
      return ok([{ ro: roSetting, scs: scsSetting }]);
    }

    const failWith = (err) => { if (state.inTxn) state.aborted = true; throw err; };
    if (state.readOnly && WRITE_VERBS.has(verb)) {
      failWith(pgError("25006", `cannot execute ${verb.toUpperCase()} in a read-only transaction`));
    }
    if (hang(text)) {
      if (serverTimeoutMs == null) return new Promise(() => {});
      await new Promise((r) => setTimeout(r, serverTimeoutMs));
      failWith(pgError("57014", "canceling statement due to statement timeout"));
    }
    const err = fail(text);
    if (err) failWith(err instanceof Error ? err : pgError("XX000", String(err)));
    const a = await answer(text, values);
    if (Array.isArray(a)) return ok(a);
    return { rows: a?.rows ?? [], rowCount: a?.rowCount ?? (a?.rows ?? []).length, command: verb.toUpperCase() };
  }

  return client;
}

/* ---------------- fake fetch ---------------- */

/**
 * createFakeFetch(routes) -> an async function you pass as fetchImpl. It has .calls.
 *
 * routes is an object keyed "GET https://host/path" (or just "https://host/path"), or a function
 * (method, url, init) -> route. A route is:
 *   { status = 200, headers = {}, body = "" }       a normal answer
 *   { bytes: N }                                    a body of N bytes, streamed (to test the size cap)
 *   { delayMs }                                     answer after a delay (aborts if init.signal aborts)
 *   { hang: true }                                  never answers until aborted
 *   { throws: "message" }                           the network fails
 * A URL with no route THROWS, so a test that forgot a route fails loudly.
 *
 * Each call is recorded: { method, url, headers (lower-case), redirect, pulled }.
 */
export function createFakeFetch(routes = {}) {
  const calls = [];
  async function fakeFetch(input, init = {}) {
    const url = typeof input === "string" ? input : String(input?.url ?? input);
    const method = String(init.method || "GET").toUpperCase();
    const headers = {};
    for (const [k, v] of Object.entries(init.headers || {})) headers[String(k).toLowerCase()] = String(v);
    const call = { method, url, headers, redirect: init.redirect, pulled: 0 };
    calls.push(call);

    const route = typeof routes === "function" ? routes(method, url, init) : (routes[`${method} ${url}`] ?? routes[url]);
    if (!route) throw new TypeError(`fake fetch: no route for ${method} ${url}`);
    if (route.throws) throw new TypeError(route.throws);

    const wait = (ms) => new Promise((resolve, reject) => {
      const t = setTimeout(resolve, ms);
      init.signal?.addEventListener("abort", () => { clearTimeout(t); reject(Object.assign(new Error("aborted"), { name: "AbortError" })); }, { once: true });
    });
    if (route.hang) await wait(60_000);
    if (route.delayMs) await wait(route.delayMs);

    const status = route.status ?? 200;
    const responseHeaders = new Headers(route.headers || {});
    let body = route.body ?? "";
    if (route.bytes != null) {
      const chunk = new Uint8Array(8192).fill(97);
      let left = route.bytes;
      body = new ReadableStream({
        pull(controller) {
          if (left <= 0) { controller.close(); return; }
          const n = Math.min(left, chunk.byteLength);
          controller.enqueue(chunk.subarray(0, n));
          left -= n;
          call.pulled += n;
        }
      });
    }
    const nullBody = status === 204 || status === 205 || status === 304 || method === "HEAD";
    return new Response(nullBody ? null : body, { status, headers: responseHeaders });
  }
  fakeFetch.calls = calls;
  return fakeFetch;
}

/* ---------------- a minimal valid beat ---------------- */

/**
 * A small, valid beat object for tests of the harness and of anything that takes a beat.
 * `over` replaces any field. It reads one row, GETs the site, and skips its last step.
 * selfTest.pass is green; selfTest.fail goes red at step "two".
 */
export function makeFixtureBeat(over = {}) {
  return {
    id: "fixture",
    title: "Fixture beat",
    kind: "probe",
    covers: [],
    box: false,
    reads: [{ host: "SITE", methods: ["GET"] }],
    steps: ["one", "two", "three"],
    deadlineMs: 2000,
    fixGuide: [
      "Check the fixture page answers on the site.",
      "",
      "Likely causes:",
      "- The page moved (shows up at step two).",
      "- The database did not answer (shows up at step one).",
      "Steps:",
      "- Open the page in a browser and read the status.",
      "- Run node scripts/pulse/run-beat.mjs fixture and read the step it stops at.",
      "Files: src/pulse/beats/contract.mjs"
    ].join("\n"),
    async run(ctx) {
      const rows = await ctx.step("one", async () => (await ctx.read("SELECT 1 AS n")).rows);
      await ctx.step("two", async () => {
        const r = await ctx.http.get(`${ctx.siteUrl}/x`);
        if (!r.ok) throw ctx.fail("two", `the site said ${r.status}`);
      });
      ctx.skipStep("three", "nothing to do in the fixture");
      return ctx.done("fine", { rows: rows.length });
    },
    selfTest: {
      pass: () => ({ read: [{ match: /SELECT 1/, rows: [{ n: 1 }] }], http: { "GET https://fundhub.ai/x": { status: 200 } } }),
      fail: () => ({ read: [{ match: /SELECT 1/, rows: [{ n: 1 }] }], http: { "GET https://fundhub.ai/x": { status: 500 } } })
    },
    ...over
  };
}
