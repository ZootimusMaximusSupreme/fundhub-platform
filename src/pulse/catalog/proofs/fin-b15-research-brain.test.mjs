// Practice test (fake data, the REAL handler) for the research card's "Save to the brain" button, one of the
// buttons on the row
//   "Ideas: research card buttons: Read it / Hide it, Approve, Tweak (+ 'Run the tweak'), Redo, 'Save to the brain', Retry".
//
// The live check on that row reads what the brain holds after a press (a page for a finished report, with
// chunks, opening with the report's own words). This test holds the press itself: the words handed to the
// brain are the finished report's words, under the report's own key and title, for the company that is
// signed in, and an unfinished run, another company's run and a brain that says no are each answered and
// leave nothing written. The brain is a stand-in (deps.upsertGeneratedDocument); nothing is embedded.
//
// Breaks made on purpose (each alone, then put back): the handler passes an empty text; it passes the
// question instead of the report; it keys the page by something other than the run's id; it skips the
// "finished" check. Each turns a test red.

import assert from "node:assert/strict";
import test from "node:test";

import brain from "../../../../api/marketing/research/brain.mjs";
import { hit, ORG_ID } from "./s5-route-kit.mjs";

const RUN = "0c000000-0000-4000-8000-000000000001";
const REPORT = "# Banks check your inquiries first\n\nThe lender reads hard pulls in the last 24 months before anything else.";

const runRow = (over = {}) => ({
  id: RUN, status: "done", payload: { question: "What do banks check first?" }, result: { report: { markdown: REPORT, repo_path: "marketing/research/x/report.md" } }, ...over
});

/** The brain, recorded. Answers what it is told to. */
function stand(answer = { ok: true, fileId: "brain-file-1", chunkCount: 3 }) {
  const calls = [];
  return { calls, upsertGeneratedDocument: async (db, args) => { calls.push(args); return answer; } };
}

async function press(run, brainStand, { body = { id: RUN, request_id: "00000000-0000-4000-8000-0000000000aa" } } = {}) {
  return hit(brain, {
    method: "POST",
    body,
    // the run is read for the signed-in company only: the stand-in answers only when asked with that company
    rules: [[/FROM marketing_jobs WHERE id = \$1 AND org_id = \$2/, (sql, params) => (params[1] === ORG_ID && run ? [run] : [])]],
    deps: { upsertGeneratedDocument: brainStand.upsertGeneratedDocument, env: {} }
  });
}

test("a finished report is handed to the brain whole, under its own key, with a title from its question, for this company", async () => {
  const b = stand();
  const out = await press(runRow(), b);
  assert.equal(out.status, 200);
  assert.deepEqual(out.body, { ok: true, brain_file_id: "brain-file-1", chunks: 3, unchanged: false });
  assert.equal(b.calls.length, 1);
  assert.deepEqual(
    { orgId: b.calls[0].orgId, sourceType: b.calls[0].sourceType, sourceKey: b.calls[0].sourceKey, title: b.calls[0].title, text: b.calls[0].text, accessTier: b.calls[0].accessTier },
    { orgId: ORG_ID, sourceType: "deep-research", sourceKey: RUN, title: "Research: What do banks check first?", text: REPORT, accessTier: "owner" }
  );
});

test("the same report saved twice says unchanged, and a brain that cannot take the page is a plain sentence", async () => {
  const again = await press(runRow(), stand({ ok: true, fileId: "brain-file-1", chunkCount: 0, skipped: true }));
  assert.equal(again.status, 200);
  assert.equal(again.body.unchanged, true);

  const noCredit = await press(runRow(), stand({ ok: false, reason: "embed 429 insufficient credit" }));
  assert.equal(noCredit.status, 503);
  assert.equal(noCredit.body.error, "brain_unavailable");
  assert.equal(noCredit.body.message, "The brain cannot save new pages right now: its embedding key has no credit.");
});

test("a run that is not finished, has no report, or belongs to another company is refused and the brain is never asked", async () => {
  for (const [run, status, error] of [
    [runRow({ status: "running" }), 400, "invalid"],
    [runRow({ result: { report: {} } }), 400, "invalid"],
    [null, 404, "not_found"]
  ]) {
    const b = stand();
    const out = await press(run, b);
    assert.equal(out.status, status, JSON.stringify(run));
    assert.equal(out.body.error, error);
    assert.equal(b.calls.length, 0, "nothing was handed to the brain");
  }
});
