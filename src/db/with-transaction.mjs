// withTransaction — a REAL transaction against this repo's actual database handle.
//
// WHY THIS FILE EXISTS. There are two copies of this helper in the tree already
// and they do not behave the same way:
//
//   src/pii/index.mjs           — probes `typeof db.connect !== "function"` and
//                                 runs the callback inline when it is missing.
//   src/finance/soft-pulls.mjs  — the same probe, then a correction, because the
//                                 probe is WRONG against the handle every
//                                 production caller passes.
//
// THE TRAP, in soft-pulls.mjs's own words: `src/db.mjs` exports `db` as
// `{ query }` and NOTHING ELSE. It has no `connect()`. So the naive probe takes
// the no-transaction branch on the one object every real caller hands in, and the
// callback runs with AUTOCOMMIT — each statement committing itself as it goes.
//
// That is not an abstract concern for the callers in this directory. A revoke
// deletes a credential, cascades a set of accounts, and writes an audit row. An
// erasure writes an audit row and then de-identifies across several tables. Under
// autocommit, a failure halfway through leaves the credential gone and the audit
// row absent, or the audit row present and the removal half-applied. Cascading
// deletes with autocommit is exactly how half-deleted data happens, and
// half-deleted is the one outcome a compliance path may not produce: it is
// indistinguishable from "we did what you asked" and it is not.
//
// This copy is soft-pulls.mjs's corrected version, lifted rather than imported.
// It is not imported from there because that module is the soft-pull fulfil path
// — live, compliant, and explicitly not to be modified — and exporting a helper
// out of it means editing it. Consolidating all three into this one file is the
// right end state and is a cross-module refactor: recorded as a finding on
// ops/workflows/fundhub-beta-buildout.md rather than done as a drive-by.
//
// THE ORDER OF THE BRANCHES IS THE WHOLE POINT:
//   1. the handle IS the singleton   -> reach past it to the pool it wraps.
//   2. connect() and NOT release()   -> a real Pool, or a test double that wants
//                                       to observe BEGIN/COMMIT/ROLLBACK.
//   3. anything else                 -> a checked-out PoolClient (connect+release),
//                                       or a plain fake; run inline on the handle.
// A checked-out pg client still exposes connect(). Calling it again throws
// "Client has already been connected" — release() is what separates pool from client.
// Getting 1 wrong is the autocommit bug. Getting 2 vs 3 wrong breaks PG tests and
// nested units of work. Removing 3 breaks every stubbed-db test in the repo.

import { db as sharedDb, pool } from "../db.mjs";

export async function withTransaction(db, fn) {
  const acquire = db === sharedDb
    ? () => pool().connect()
    : typeof db?.connect === "function" && typeof db?.release !== "function"
      ? () => db.connect()
      : null;

  // Checked-out PoolClient or plain fake: caller already owns the transaction,
  // or the stub cannot honour BEGIN/COMMIT. Run inline on the handle given.
  if (!acquire) return fn(db);

  const client = await acquire();
  try {
    await client.query("BEGIN");
    const out = await fn(client);
    await client.query("COMMIT");
    return out;
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

export default withTransaction;
