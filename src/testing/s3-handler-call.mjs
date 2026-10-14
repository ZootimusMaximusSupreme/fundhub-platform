// One call of a real api/ handler against a stand-in database (slice S3 proofs).
// Wraps the harness so each proof file does not repeat the same six lines.
import { fakeDb as plainFakeDb, makeRes, runWithSharedDb } from "./handler-harness.mjs";
import { bindProblem } from "./s3-scoped-rows.mjs";

/**
 * The harness stand-in, with Postgres's own bind rules applied before it answers: a value the statement
 * does not use, or one used only in an IS NULL test, is a protocol error (see bindProblem). A handler
 * that lost a condition then fails the test the way a real database would, instead of quietly
 * returning the canned rows.
 */
export function strictFakeDb(rules = [], options = {}) {
  const fake = plainFakeDb(rules, options);
  const answer = fake.query;
  fake.query = async (sql, params = []) => {
    const text = typeof sql === "string" ? sql : (sql && sql.text) || "";
    const values = typeof sql === "string" ? params : (sql && sql.values) || params;
    const problem = bindProblem(text, values);
    if (problem) {
      const err = new Error(`bind: ${problem}`);
      err.code = "08P01";
      throw err;
    }
    return answer(sql, params);
  };
  return fake;
}

/** Run `handler(request, res)` with the shared db pointed at a stand-in. */
export async function callShared(handler, request, rules = []) {
  const fake = strictFakeDb(rules);
  const res = makeRes();
  await runWithSharedDb(fake, () => handler(request, res));
  return { res, fake };
}
