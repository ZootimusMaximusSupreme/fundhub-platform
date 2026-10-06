// One queued job, start to finish, against the in-memory job table and the
// real callModel with a fake fetch answering recorded Anthropic bodies.

import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { runOfferJob, OFFER_ROLES } from "./offer-run.mjs";
import { askAnthropic } from "./offer-transport.mjs";
import { createOfferJob } from "./offer-store.mjs";
import { makeFakeDb } from "./fixtures/offer-fake-db.mjs";
import { anthropicMessage, CANDIDATES_TEXT, SYNTHESIS_TEXT, panelsText } from "./fixtures/offer-replies.mjs";

const ORG = randomUUID();
const PAYLOAD = {
  campaign: "partner", today: "2026-10-05",
  avatarSummary: "AVATAR", adResearchSummary: "RESEARCH", ownerNotes: "",
  sources: { avatar: "supplied", adResearch: "supplied", ownerNotes: null }, cut: {}
};

/* The production ask, with only the network replaced. Each call is answered by
   which step's prompt it is — the same way a real reply follows its prompt. */
function recordedAsk({ synthesis = SYNTHESIS_TEXT, fail = null } = {}) {
  const urls = [];
  const fetchImpl = async (url, init) => {
    urls.push(url);
    const body = JSON.parse(init.body);
    const user = body.messages[0].content;
    let text;
    if (fail && user.includes(fail.when)) return { ok: false, status: fail.status, json: async () => fail.json };
    if (user.startsWith("Design SIX offers")) text = CANDIDATES_TEXT;
    else if (user.startsWith("You are a panel of four judges")) {
      text = panelsText([...new Set([...user.matchAll(/"blindId":"(Offer [A-F])"/g)].map((m) => m[1]))]);
    } else text = synthesis;
    return { ok: true, status: 200, json: async () => anthropicMessage(text, { input: 1000, output: 500 }) };
  };
  const ask = (args) => askAnthropic({ ...args, env: { ANTHROPIC_API_KEY: "test-key-not-real" }, fetchImpl });
  return { ask, urls };
}

test("the gate is owner and admin only", () => {
  assert.deepEqual([...OFFER_ROLES].sort(), ["admin", "owner"]);
});

test("queued → running → done, with the winner and the review card saved", async () => {
  const db = makeFakeDb();
  const { job } = await createOfferJob(db, { orgId: ORG, staffId: null, payload: PAYLOAD });
  const { ask, urls } = recordedAsk();
  const out = await runOfferJob(db, { jobId: job.id, orgId: ORG, ask });
  assert.deepEqual(out, { ok: true, status: "done" });
  assert.equal(urls.length, 3);
  const row = db.jobs[0];
  assert.equal(row.status, "done");
  assert.equal(row.attempts, 1);
  assert.equal(row.result.offer.name, "Live or We Keep Building");
  assert.equal(row.result.reviewCard.threeThingsToCheck[0], "The price is $10,000 once, can be financed — yes or no?");
  assert.equal(row.result.model, "claude-opus-5-5");
  assert.equal(row.result.usage.input_tokens, 3000);
  assert.equal(row.result.asOf, "2026-10-05");
});

test("a job that is not queued is not run twice", async () => {
  const db = makeFakeDb();
  const { job } = await createOfferJob(db, { orgId: ORG, staffId: null, payload: PAYLOAD });
  const { ask, urls } = recordedAsk();
  await runOfferJob(db, { jobId: job.id, orgId: ORG, ask });
  const again = await runOfferJob(db, { jobId: job.id, orgId: ORG, ask });
  assert.deepEqual(again, { ok: false, status: null, error: "not_queued" });
  assert.equal(urls.length, 3);
  // Another company's id is not this company's job.
  const db2 = makeFakeDb();
  const other = await createOfferJob(db2, { orgId: ORG, staffId: null, payload: PAYLOAD });
  assert.equal((await runOfferJob(db2, { jobId: other.job.id, orgId: randomUUID(), ask })).error, "not_queued");
});

test("an Anthropic failure ends the job failed, with the reason in plain words", async () => {
  const db = makeFakeDb();
  const { job } = await createOfferJob(db, { orgId: ORG, staffId: null, payload: PAYLOAD });
  const { ask } = recordedAsk({ fail: { when: "Design SIX offers", status: 400, json: { type: "error", error: { message: "Your credit balance is too low" } } } });
  const out = await runOfferJob(db, { jobId: job.id, orgId: ORG, ask });
  assert.equal(out.status, "failed");
  const row = db.jobs[0];
  assert.equal(row.status, "failed");
  assert.match(row.error, /The first step \(six offers\) did not work: the Anthropic account is out of credit/);
  assert.equal(row.result.usage.calls.length, 1);
});

test("a crash inside the writer still closes the row", async () => {
  const db = makeFakeDb();
  const { job } = await createOfferJob(db, { orgId: ORG, staffId: null, payload: PAYLOAD });
  const out = await runOfferJob(db, { jobId: job.id, orgId: ORG, ask: async () => { throw new Error("boom"); } });
  assert.equal(out.status, "failed");
  assert.equal(db.jobs[0].status, "failed");
  assert.match(db.jobs[0].error, /Something broke while writing the offer, and nothing was chosen: boom/);
});
