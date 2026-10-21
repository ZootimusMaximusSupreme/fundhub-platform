import test from "node:test";
import assert from "node:assert/strict";
import * as beat from "./beat-upload-door.mjs";
import * as repairTrip from "./beat-repair-trip.mjs";
import * as truth from "./lib/documents-upload-truth.mjs";
import * as lane from "../coverage/gap-documents.mjs";
import { PROVIDERS, providerFromEnv } from "../../documents/store.mjs";
import { checkBeatSelfTest, runBeat, validateBeat } from "./contract.mjs";
import { ctxLog, makeFakeCtx } from "./ctx.mjs";
import { laneSelfTest } from "./lib/money-hourly.mjs";
import { TRIPWIRES } from "../tripwires.mjs";

const OTHER_BEATS = { "repair-trip": repairTrip };
const withEnv = (env) => ({ ...laneSelfTest(beat.LANE), env });
const ORG = "11111111-1111-4111-8111-111111111111";

test("upload-door is valid, green on netlify-blobs, red at documents-upload-store when the setting is gone", async () => {
  assert.deepEqual(validateBeat(beat, { file: "beat-upload-door.mjs" }), []);
  assert.deepEqual(await checkBeatSelfTest(beat), []);
  const passCtx = makeFakeCtx(beat, beat.selfTest.pass());
  const passed = await runBeat(beat, passCtx);
  assert.equal(passed.ok, true, passed.detail);
  assert.equal(passed.detail, "1 upload door checks passed");
  assert.deepEqual(ctxLog(passCtx).refused, []);
  const failed = await runBeat(beat, makeFakeCtx(beat, beat.selfTest.fail()));
  assert.equal(failed.ok, false);
  assert.equal(failed.step, "documents-upload-store");
  assert.match(failed.detail, /uploads are going to the memory store\. It keeps files in memory only/);
});

test("upload-door: memory and a typo are red with the morning lane's words; both real stores are green", async () => {
  const memory = await runBeat(beat, makeFakeCtx(beat, withEnv({ DOCUMENT_STORE_PROVIDER: "memory" })));
  assert.deepEqual([memory.ok, memory.step], [false, "documents-upload-store"]);
  assert.match(memory.detail, /lost at the next cold start/);

  const typo = await runBeat(beat, makeFakeCtx(beat, withEnv({ DOCUMENT_STORE_PROVIDER: "netlfy-blobs" })));
  assert.deepEqual([typo.ok, typo.step], [false, "documents-upload-store"]);
  assert.match(typo.detail, /not one the upload door knows: unknown DOCUMENT_STORE_PROVIDER "netlfy-blobs"/);

  for (const name of ["netlify-blobs", "vercel-blob"]) {
    const ok = await runBeat(beat, makeFakeCtx(beat, withEnv({ DOCUMENT_STORE_PROVIDER: name })));
    assert.equal(ok.ok, true, name);
  }
  // The green line says plainly that the read-back is the morning's.
  const row = truth.judgeUploadStore({ DOCUMENT_STORE_PROVIDER: "netlify-blobs" });
  assert.equal(row.status, "PASS");
  assert.match(row.detail, /read back from the store each morning, not hourly/);
});

test("upload-door: one rule, one copy — the door, the morning lane and the beat pick and word the store the same way", async () => {
  // The door picks with the lib's rule and keys its providers with the lib's names, in the same order.
  assert.deepEqual(Object.keys(PROVIDERS), Object.values(truth.STORE_NAMES));
  for (const env of [{}, { DOCUMENT_STORE_PROVIDER: "" }, { DOCUMENT_STORE_PROVIDER: "netlify-blobs" }, { DOCUMENT_STORE_PROVIDER: "vercel-blob" }]) {
    assert.equal(providerFromEnv(env, { objects: new Map() }).name, truth.storeNameFromEnv(env));
  }
  // The door's own error for an unknown name is the words the beat clips into its row.
  let doorError = null;
  try { providerFromEnv({ DOCUMENT_STORE_PROVIDER: "dropbox" }); } catch (err) { doorError = err.message; }
  assert.equal(doorError, truth.unknownStoreMessage("dropbox", Object.values(truth.STORE_NAMES)));

  // The morning lane's store-setting rows are the beat's rows, for each bad setting.
  const db = { query: async () => ({ rows: [] }) };
  for (const env of [{}, { DOCUMENT_STORE_PROVIDER: "memory" }, { DOCUMENT_STORE_PROVIDER: "netlfy-blobs" }]) {
    const morning = (await lane.gapChecks({ db, orgId: ORG, env })).find((r) => r.id === lane.ID_STORE);
    assert.deepEqual(truth.judgeUploadStore(env), morning, JSON.stringify(env));
  }
  assert.equal(lane.ID_STORE, truth.ID_STORE);
  assert.equal(lane.REAL_STORES, truth.REAL_STORES);
  assert.equal(lane.SAMPLE_SQL, truth.SAMPLE_SQL);
});

test("upload-door: every check route:documents-upload names runs hourly, here or in the beat that owns it", () => {
  assert.deepEqual(beat.covers, ["route:documents-upload"]);
  for (const surface of beat.covers) {
    const wire = TRIPWIRES[surface];
    assert.ok(wire, `${surface} is not a tripwire`);
    for (const checkId of wire.checks) {
      if (beat.HOURLY_CHECK_IDS.includes(checkId)) continue;
      const elsewhere = beat.RUNS_ELSEWHERE[checkId];
      assert.ok(elsewhere, `${surface} needs ${checkId} hourly`);
      const [otherId, step] = elsewhere;
      assert.equal(OTHER_BEATS[otherId].id, otherId);
      assert.ok(OTHER_BEATS[otherId].steps.includes(step), `${otherId} has no step ${step}`);
      assert.ok(OTHER_BEATS[otherId].HOURLY_CHECK_IDS.includes(checkId), `${otherId} does not run ${checkId}`);
    }
  }
  // repair-trip does not claim the upload door itself; this beat does.
  assert.ok(!repairTrip.covers.includes("route:documents-upload"));
});
