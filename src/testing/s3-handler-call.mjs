// One call of a real api/ handler against a stand-in database (slice S3 proofs).
// Wraps the harness so each proof file does not repeat the same six lines.
import { fakeDb, makeRes, runWithSharedDb } from "./handler-harness.mjs";

/** Run `handler(request, res)` with the shared db pointed at a stand-in. */
export async function callShared(handler, request, rules = []) {
  const fake = fakeDb(rules);
  const res = makeRes();
  await runWithSharedDb(fake, () => handler(request, res));
  return { res, fake };
}
