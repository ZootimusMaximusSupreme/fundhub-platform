// upload-door: every hour, does a client's upload go to a file store that keeps it?
//
// Same rule, same words as the morning lane gap-documents.mjs (the truth lives in
// lib/documents-upload-truth.mjs, and src/documents/store.mjs picks its store with the same rule):
//
//   documents:upload-store   the store the upload door picks from the live environment
//                            (DOCUMENT_STORE_PROVIDER) is netlify-blobs or vercel-blob. Unset means memory, and
//                            memory loses every upload at the next cold start; a name the door does not know
//                            means no upload can be saved at all.
//
// MORNING ONLY, SAID PLAINLY: the read-back. The morning lane also asks the file store whether the newest saved
// file is really there. That read goes through the store's own package and the site's internal token, which a
// beat may not load, so the hourly green line says the read-back runs each morning.
//
// What it guards, and why it is on `covers` (the deep checks src/pulse/tripwires.mjs names):
//   route:documents-upload   documents:upload-store here, documents:stuck-processing in beat repair-trip
//                            (RUNS_ELSEWHERE below; its test holds repair-trip to that step)
//
// Read only: one read of the default company through ctx.read and the frozen ctx.env. No send, no write, no web call.

import { laneSelfTest, runLaneBeat } from "./lib/money-hourly.mjs";
import { ID_STORE, judgeUploadStore } from "./lib/documents-upload-truth.mjs";

export const HOURLY_CHECK_IDS = Object.freeze([ID_STORE]);

/** A deep check a covered surface names that runs hourly in another beat: [beat id, step]. */
export const RUNS_ELSEWHERE = Object.freeze({
  "documents:stuck-processing": Object.freeze(["repair-trip", "documents-stuck-processing"])
});

export const LANE = Object.freeze({
  checks: Object.freeze(HOURLY_CHECK_IDS.map((checkId) => Object.freeze({ id: checkId, step: checkId.replaceAll(":", "-") }))),
  run: async (io) => [judgeUploadStore(io.env)],
  selfTest: Object.freeze({
    passEnv: Object.freeze({ DOCUMENT_STORE_PROVIDER: "netlify-blobs" }),
    // The setting is gone, so uploads fall back to memory: stop at documents-upload-store.
    failEnv: Object.freeze({})
  })
});

export const id = "upload-door";
export const title = "Client uploads go to a store that keeps them";
export const kind = "probe";
export const covers = ["route:documents-upload"];
export const box = false;
export const reads = [];
export const checkIds = HOURLY_CHECK_IDS;
export const steps = ["read", ...LANE.checks.map((check) => check.step)];
export const damp = 1;
export const deadlineMs = 5000;

export async function run(ctx) {
  return runLaneBeat(ctx, LANE, { noun: "upload door" });
}

export const fixGuide = [
  "Client uploads are not going to a file store that keeps them, so a file a client sends is lost or refused.",
  "",
  "Likely causes:",
  "- DOCUMENT_STORE_PROVIDER is unset on the live site, so the upload door falls back to the memory store.",
  "- DOCUMENT_STORE_PROVIDER has a typo, so the upload door knows no such store and refuses every upload.",
  "",
  "Steps:",
  "- Run node scripts/pulse/run-beat.mjs upload-door and read the red step: it names the store setting.",
  "- Set DOCUMENT_STORE_PROVIDER to netlify-blobs on the live site (all contexts), then ship once.",
  "- The newest file's read-back from the store is the morning check documents:upload-store; read that row too.",
  "- Do not upload, move or delete a client file from the pulse; the beat only reads.",
  "Files: src/pulse/beats/lib/documents-upload-truth.mjs, src/documents/store.mjs, api/documents-upload.mjs,",
  "src/pulse/coverage/gap-documents.mjs"
].join("\n");

export const selfTest = {
  pass: () => laneSelfTest(LANE),
  fail: () => laneSelfTest(LANE, true)
};
