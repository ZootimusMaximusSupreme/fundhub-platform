// The read box: the ONLY way a pulse beat touches the database.
//
// Pulse v1 (ops/workflows/pulse-layer-2026-10-09-v1.md, delta 1). A beat can
// read. It cannot save, send or emit. Two walls, so one bug is not a leak:
//
//   WALL 1, in this file, before anything is sent:   assertReadOnlySql()
//     Only a single SELECT, WITH ... SELECT or SHOW gets through. Everything
//     else is refused with a PulseRefused that names what was refused.
//
//   WALL 2, in Postgres itself:                      BEGIN READ ONLY
//     The one connection lives inside a READ ONLY transaction. If wall 1 had a
//     hole, Postgres still answers "cannot execute INSERT in a read-only
//     transaction" (SQLSTATE 25006). `node scripts/pulse/run-beat.mjs --probe`
//     proves wall 2 on the real database by going AROUND wall 1 on purpose.
//
//   THE ONE GAP BETWEEN THE WALLS, AND THE PIECE THAT CLOSES IT. Wall 2 cannot stop
//   COMMIT: a COMMIT ends the READ ONLY transaction and the connection is read-write
//   from then on. So a lexer mismatch in wall 1 that let "SELECT 1; COMMIT; <write>"
//   through as one statement would defeat both walls (found by the checker with a
//   lone \r in a -- comment and a 90-character dollar-quote tag). Two defences:
//     (a) every user read goes out on the EXTENDED protocol (queryMode "extended").
//         Postgres itself then refuses more than one command per string ("cannot
//         insert multiple commands into a prepared statement"), whatever wall 1 thinks;
//     (b) close() asks the connection "are you still read-only?" before ROLLBACK and
//         reports it as readOnlyAtClose / leaked.
//
// WHAT THE BOX DOES
//   - ONE connection per run, not per beat, so the pooler holds one slot.
//   - Setup is one round trip: BEGIN READ ONLY; SET LOCAL statement_timeout;
//     staff scope (set_config(..., true), same as asStaff in src/partners/rls.mjs,
//     because many tables are FORCE row security); then a check that the wall is
//     really up (transaction_read_only = on). If it is not, the box refuses to open.
//   - Statements run ONE AT A TIME, first in first out.
//   - Every statement runs inside its own SAVEPOINT. An error rolls back to it
//     and is rethrown, so one bad read never poisons the next one.
//   - The box never sends COMMIT. close() sends ROLLBACK, then destroys the
//     connection (release(true)), so it is never handed back to the pool.
//   - A hung statement: the server cancels it at statement_timeout. close()
//     waits out that timeout, sends ROLLBACK capped at closeCapMs, then destroys.
//
// WHAT THIS FILE IMPORTS: nothing. The connection is injected (connect()), so a
// test hands in a fake and the runner hands in () => pool().connect().
//
// KNOWN LIMIT. The scanner below treats a backslash in an ordinary '...' string
// as plain text, which is what Postgres does when standard_conforming_strings
// is on. The box checks that setting at open and refuses to open if it is off.

/** A refusal. kind: "sql" | "closed" | "box". reason: a short code. */
export class PulseRefused extends Error {
  constructor(kind, reason, what = "") {
    const w = String(what || "").replace(/\s+/g, " ").trim().slice(0, 80);
    super(`pulse_refused_${kind}: ${reason}${w ? ` (${w})` : ""}`);
    this.name = "PulseRefused";
    this.kind = kind;
    this.reason = reason;
    this.what = w;
  }
}

export const MAX_SQL_CHARS = 50_000;
export const DEFAULT_MAX_STATEMENTS = 300; // reads per box (one box per run, shared by every beat)

const refuse = (reason, sql) => { throw new PulseRefused("sql", reason, typeof sql === "string" ? sql : ""); };
const DOLLAR_TAG = /\$(?:[A-Za-z_\u0080-\uffff][A-Za-z0-9_\u0080-\uffff]*)?\$/y;
const isIdentChar = (ch) => ch !== undefined && /[A-Za-z0-9_$\u0080-￿]/.test(ch);

/* skeleton — the SQL with comments turned into spaces, every string literal
   turned into '' and every quoted identifier turned into "". What is left is
   only the real keywords, which is what the checks below read.

   It also returns the text of each quoted identifier, because "pg_sleep"(1) is a
   legal call and must not slip past the function list.

   Throws PulseRefused on anything it cannot read to the end (an open string, an
   open comment). Unreadable SQL is refused, never guessed at. */
function skeleton(sql) {
  let out = "";
  const idents = [];
  const n = sql.length;
  let i = 0;
  let litEnd = -1; // where the last dollar-quoted string ended; a $ right after it starts a new one
  while (i < n) {
    const ch = sql[i];
    const next = sql[i + 1];

    if (ch === "-" && next === "-") {
      // Postgres ends a -- comment at \n AND at \r (scan.l: non_newline is [^\n\r]).
      // Ending it only at \n hid everything after a lone \r (checker finding, 2026-10-09).
      while (i < n && sql[i] !== "\n" && sql[i] !== "\r") i++;
      out += " ";
      continue;
    }

    if (ch === "/" && next === "*") {
      let depth = 1;
      i += 2;
      while (i < n && depth > 0) {
        if (sql[i] === "/" && sql[i + 1] === "*") { depth++; i += 2; }
        else if (sql[i] === "*" && sql[i + 1] === "/") { depth--; i += 2; }
        else i++;
      }
      if (depth > 0) refuse("unterminated_comment", sql);
      out += " ";
      continue;
    }

    if (ch === "'") {
      // E'...' lets a backslash escape the next character. Nothing else does.
      const prev = sql[i - 1];
      const eString = (prev === "e" || prev === "E") && !isIdentChar(sql[i - 2]);
      i++;
      let closed = false;
      while (i < n) {
        const c = sql[i];
        if (eString && c === "\\") { i += 2; continue; }
        if (c === "'") {
          if (sql[i + 1] === "'") { i += 2; continue; }
          i++;
          closed = true;
          break;
        }
        i++;
      }
      if (!closed) refuse("unterminated_string", sql);
      out += "''";
      continue;
    }

    if (ch === '"') {
      if (/u&$/i.test(out)) refuse("unicode_escaped_identifier", sql);
      i++;
      let name = "";
      let closed = false;
      while (i < n) {
        const c = sql[i];
        if (c === '"') {
          if (sql[i + 1] === '"') { name += '"'; i += 2; continue; }
          i++;
          closed = true;
          break;
        }
        name += c;
        i++;
      }
      if (!closed) refuse("unterminated_identifier", sql);
      idents.push(name);
      out += '""';
      continue;
    }

    if (ch === "$") {
      // $1 is a parameter. $tag$ ... $tag$ and $$ ... $$ are dollar-quoted strings.
      if (next >= "0" && next <= "9") { out += ch; i++; continue; }
      if (isIdentChar(sql[i - 1]) && i !== litEnd) { out += ch; i++; continue; } // a $ inside a name (a$b)
      // The tag may be any length (Postgres does not cap it at 78), so no slice here.
      DOLLAR_TAG.lastIndex = i;
      const m = DOLLAR_TAG.exec(sql);
      if (!m) refuse("stray_dollar_sign", sql);
      const close = sql.indexOf(m[0], i + m[0].length);
      if (close === -1) refuse("unterminated_dollar_quote", sql);
      i = close + m[0].length;
      litEnd = i;
      out += "''";
      continue;
    }

    out += ch;
    i++;
  }
  return { text: out, idents };
}

/* Words that mean "this changes something". Whole words only, so updated_at,
   created_at, date_trunc and granted_by are not caught. */
const WRITE_WORDS = /\b(insert|update|delete|truncate|drop|alter|create|grant|revoke|merge|listen|unlisten|notify|copy|call|do)\b/;

/* Functions and clauses that have effects outside the rows a SELECT returns.
   pg_advisory* take locks, pg_sleep holds the pooler slot, set_config would let
   a caller change the scope (the box itself uses it, the caller may not),
   dblink and lo_* reach out, nextval/setval burn or move a sequence, and
   query_to_xml and friends run SQL that is hidden inside a string. */
const DANGEROUS = new RegExp(
  "\\b(" + [
    "pg_\\w*advisory\\w*", "pg_sleep\\w*", "set_config", "dblink\\w*", "lo_\\w+", "nextval", "setval",
    "pg_notify", "pg_terminate_backend", "pg_cancel_backend", "pg_reload_conf", "pg_rotate_logfile",
    "pg_read_\\w+", "pg_ls_\\w+", "pg_stat_file", "pg_file_\\w+", "pg_switch_\\w+", "pg_create_\\w+",
    "pg_drop_\\w+", "pg_promote", "pg_logical_\\w+", "pg_import_system_collations",
    "query_to_xml\\w*", "table_to_xml\\w*", "database_to_xml\\w*", "schema_to_xml\\w*", "cursor_to_xml"
  ].join("|") + ")\\b"
);

/**
 * Throws PulseRefused("sql", reason, ...) unless `sql` is ONE statement and that
 * statement is a SELECT, a WITH ... SELECT or a SHOW with no effects.
 * Returns the sql unchanged on success. Pure; touches nothing.
 */
export function assertReadOnlySql(sql) {
  if (typeof sql !== "string") refuse("non_string_sql");
  if (!sql.trim()) refuse("empty_sql");
  if (sql.length > MAX_SQL_CHARS) refuse("sql_too_long", sql);
  if (sql.includes("\u0000")) refuse("nul_byte", "");

  const { text, idents } = skeleton(sql);
  const low = text.toLowerCase();

  // One statement. A semicolon may only have spaces after it.
  const semi = low.indexOf(";");
  if (semi !== -1 && low.slice(semi + 1).trim() !== "") refuse("more_than_one_statement", sql);
  const body = low.replace(/;\s*$/, "").trim();
  if (!body) refuse("empty_sql");

  const first = /^[a-z]+/.exec(body);
  if (!first || !["select", "with", "show"].includes(first[0])) {
    refuse(`not_a_read (starts with ${first ? first[0].toUpperCase() : "a symbol"})`, sql);
  }

  const w = WRITE_WORDS.exec(body);
  if (w) refuse(`write_word_${w[1]}`, sql);

  if (/\binto\b/.test(body)) refuse("select_into", sql);
  if (/\bfor\s+(?:key\s+)?share\b/.test(body)) refuse("row_lock", sql);

  const d = DANGEROUS.exec(body);
  if (d) refuse(`forbidden_function_${d[1]}`, sql);
  for (const name of idents) {
    const q = DANGEROUS.exec(name.toLowerCase());
    if (q) refuse(`forbidden_function_${q[1]}`, sql);
  }
  return sql;
}

/**
 * Turn what a caller passed into { text, values } and check it.
 * A string is taken as is. { text, values } is turned into string + params first.
 * Any other shape is refused (named prepared statements, row modes, callbacks).
 */
export function normalizeQuery(sql, params) {
  let text;
  let values = params;
  if (typeof sql === "string") {
    text = sql;
  } else if (sql && typeof sql === "object" && !Array.isArray(sql) && typeof sql.text === "string") {
    const extra = Object.keys(sql).filter((k) => k !== "text" && k !== "values");
    if (extra.length) refuse(`unsupported_query_object_keys_${extra.join("_")}`, sql.text);
    text = sql.text;
    if (sql.values !== undefined) values = sql.values;
  } else {
    refuse("non_string_sql");
  }
  if (values !== undefined && !Array.isArray(values)) refuse("params_not_an_array", text);
  assertReadOnlySql(text);
  return { text, values };
}

/** The one query dbSettings() runs. Fixed text, no caller input. */
export const DB_SETTINGS_SQL =
  "SELECT current_setting('transaction_read_only') AS transaction_read_only, " +
  "current_setting('default_transaction_read_only') AS default_transaction_read_only, " +
  "pg_is_in_recovery() AS in_recovery";

/**
 * ctx.dbSettings(): ONE plain query outside the read box, to see whether a pooled
 * connection is stuck read-only (memory: pooler-session-set-leaks).
 * query(sql) must resolve { rows }. Never throws.
 */
export async function readDbSettings(query, { capMs = 1500 } = {}) {
  const t0 = Date.now();
  let timer;
  try {
    const res = await Promise.race([
      Promise.resolve().then(() => query(DB_SETTINGS_SQL)),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`timed out after ${capMs} ms`)), capMs); })
    ]);
    const row = res?.rows?.[0] ?? {};
    const on = (v) => (v === true || v === "on" ? true : v === false || v === "off" ? false : null);
    return {
      ok: true,
      ms: Date.now() - t0,
      transaction_read_only: on(row.transaction_read_only),
      default_transaction_read_only: on(row.default_transaction_read_only),
      in_recovery: on(row.in_recovery)
    };
  } catch (err) {
    return { ok: false, ms: Date.now() - t0, error: String((err && err.message) || err).slice(0, 200) };
  } finally {
    clearTimeout(timer);
  }
}

/** COMMIT, END, ABORT or PREPARE TRANSACTION at the start of any statement in a string. */
export const TX_ENDER = /(?:^|;)\s*(?:commit|end|abort|prepare\s+transaction)\b/i;

/** The close check: still read-only? Fixed text, no caller input. */
export const READ_ONLY_CHECK_SQL = "SELECT current_setting('transaction_read_only') AS ro_at_close";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function destroy(client) {
  try {
    if (typeof client.release === "function") client.release(true);
    else if (typeof client.end === "function") Promise.resolve(client.end()).catch(() => {});
  } catch { /* the connection is gone either way */ }
}

/**
 * openReadBox({ connect, statementTimeoutMs, closeCapMs, scope })
 *
 * connect() resolves a pg client. Returns { read(sql, params), report(), close({ timedOut }) }.
 * Rejects (and destroys the connection) if the wall is not up.
 */
export async function openReadBox({
  connect,
  statementTimeoutMs = 4000,
  closeCapMs = 1000,
  scope = "staff",
  guardSlackMs = 1500,
  maxStatements = DEFAULT_MAX_STATEMENTS
} = {}) {
  if (typeof connect !== "function") throw new TypeError("openReadBox needs connect()");
  if (scope !== "staff" && scope !== "none") throw new TypeError('scope must be "staff" or "none"');
  const timeoutMs = Math.max(1, Math.min(Math.floor(Number(statementTimeoutMs)) || 4000, 30_000));

  const rep = {
    began: false, readOnlyVerified: false, closed: false, rolledBack: false, destroyed: false,
    hung: false, broken: false, timedOut: false, commitsSent: 0,
    readOnlyAtClose: null, leaked: false,
    statements: 0, reads: 0, errors: 0, setupMs: 0, refused: []
  };

  const client = await connect();
  // The box's own fixed statements (BEGIN, SET LOCAL, SAVEPOINT, ROLLBACK, the close check)
  // use the simple protocol. They are constants; no caller text goes this way.
  const wire = (text) => {
    rep.statements++;
    return client.query(text);
  };
  // Caller text goes out on the extended protocol: one command per string, enforced by Postgres.
  // It is also scanned for a transaction ender at the start of ANY statement (not just the
  // first word), so commitsSent counts what a lexer mismatch would have let through.
  const wireUser = (text, params) => {
    if (TX_ENDER.test(text)) rep.commitsSent++;
    rep.statements++;
    return client.query({ text, values: params ?? [], queryMode: "extended" });
  };

  const t0 = Date.now();
  try {
    const setup = ["BEGIN READ ONLY", `SET LOCAL statement_timeout = '${timeoutMs}ms'`];
    if (scope === "staff") {
      setup.push("SELECT set_config('fundhub.actor','staff',true), set_config('fundhub.partner_id','',true)");
    }
    setup.push("SELECT current_setting('transaction_read_only') AS ro, current_setting('standard_conforming_strings') AS scs");
    const res = await wire(setup.join("; "));
    rep.began = true;
    const last = Array.isArray(res) ? res[res.length - 1] : res;
    const row = last?.rows?.[0] ?? {};
    if (row.ro !== "on") throw new PulseRefused("box", "transaction_is_not_read_only");
    if (row.scs !== "on") throw new PulseRefused("box", "standard_conforming_strings_is_off");
    rep.readOnlyVerified = true;
  } catch (err) {
    rep.destroyed = true;
    destroy(client);
    throw err;
  }
  rep.setupMs = Date.now() - t0;

  let closing = false;
  let closePromise = null;
  let chain = Promise.resolve();
  let current = null; // the statement on the wire, as a promise that never rejects
  let seq = 0;
  let accepted = 0;

  const refusal = (kind, reason, what) => {
    const err = new PulseRefused(kind, reason, what);
    rep.refused.push({ kind, what: `${reason}${err.what ? `: ${err.what}` : ""}` });
    return err;
  };

  async function exec(q) {
    if (closing) throw refusal("closed", "read_box_is_closed", q.text);
    if (rep.hung) throw refusal("box", "read_box_is_hung", q.text);
    if (rep.broken) throw refusal("box", "read_box_is_broken", q.text);
    const sp = `pr_${++seq}`;
    rep.reads++;
    const inflight = (async () => {
      await wire(`SAVEPOINT ${sp}`);
      try {
        const r = await wireUser(q.text, q.values);
        await wire(`RELEASE SAVEPOINT ${sp}`);
        const rows = Array.isArray(r?.rows) ? r.rows : [];
        return { rows, rowCount: typeof r?.rowCount === "number" ? r.rowCount : rows.length };
      } catch (err) {
        rep.errors++;
        try { await wire(`ROLLBACK TO SAVEPOINT ${sp}`); } catch { rep.broken = true; }
        throw err;
      }
    })();
    current = inflight.then(() => {}, () => {});
    let timer;
    const guard = new Promise((_, reject) => {
      timer = setTimeout(() => {
        rep.hung = true;
        reject(new Error(`db read did not return within ${timeoutMs + guardSlackMs} ms`));
      }, timeoutMs + guardSlackMs);
    });
    try {
      return await Promise.race([inflight, guard]);
    } finally {
      clearTimeout(timer);
    }
  }

  async function read(sql, params) {
    let q;
    try {
      q = normalizeQuery(sql, params);
    } catch (err) {
      if (err instanceof PulseRefused) {
        rep.refused.push({ kind: err.kind, what: `${err.reason}${err.what ? `: ${err.what}` : ""}` });
      }
      throw err;
    }
    if (closing) throw refusal("closed", "read_box_is_closed", q.text);
    if (accepted >= maxStatements) throw refusal("box", "too_many_statements", q.text);
    accepted++;
    const run = chain.then(() => exec(q));
    chain = run.then(() => {}, () => {});
    return run;
  }

  function report() {
    return { ...rep, refused: rep.refused.map((x) => ({ ...x })) };
  }

  function close({ timedOut = false } = {}) {
    if (closePromise) return closePromise;
    closePromise = (async () => {
      closing = true;
      rep.timedOut = Boolean(timedOut);
      // A statement still on the wire: wait out the statement timeout so the server
      // cancels it, instead of cutting the socket under a running query.
      if (current && !rep.hung) await Promise.race([current, sleep(timeoutMs + 250)]);
      rep.closed = true;
      if (rep.began) {
        // Still read-only? If not, a COMMIT got through somewhere. Skipped when the
        // connection is stuck or already broken (the check would only queue behind it).
        if (!rep.hung && !rep.broken) {
          const check = Promise.resolve().then(() => wire(READ_ONLY_CHECK_SQL)).then(
            (r) => { const last = Array.isArray(r) ? r[r.length - 1] : r; return last?.rows?.[0]?.ro_at_close ?? null; },
            () => null
          );
          const ro = await Promise.race([check, sleep(Math.min(closeCapMs, 500)).then(() => null)]);
          rep.readOnlyAtClose = ro === "on" ? true : ro === "off" ? false : null;
          rep.leaked = rep.readOnlyAtClose === false;
        }
        const rollback = Promise.resolve().then(() => wire("ROLLBACK")).then(() => true, () => false);
        rep.rolledBack = await Promise.race([rollback, sleep(closeCapMs).then(() => false)]);
      }
      rep.destroyed = true;
      destroy(client);
      return report();
    })();
    return closePromise;
  }

  return { read, report, close };
}
