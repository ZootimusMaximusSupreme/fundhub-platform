// contract-signing: every hour, can every sent contract be signed, does every signed contract have
// its stored file, and does the sign door still check links?
//
// Same SQL, same verdicts as the morning checks in gap-contracts.mjs (the truth lives in
// lib/contracts-truth.mjs):
//   contracts:sent-unsignable    sent or viewed, but the frozen copy, the words or the signer order
//                                mean the client cannot sign (the rules src/contracts/sign.mjs applies)
//   contracts:signed-not-stored  signed, but the signed file, its version or its hash was never saved
//   contracts:sign-route         a GET of the sign link with no token, and with a forged link, each get
//                                the door's own 404 (a router 404, a 503 "not configured", a 200 or a 5xx is red)
//
// What it guards, and why it is on `covers`:
//   route:contracts/sign   its tripwire is contracts:sent-unsignable and contracts:signed-not-stored, both
//                          run here; the sign door GETs read the same door the way a client's link does.
// The template check (contracts:template-missing) needs the offer list from src/config, which a beat
// cannot import, and guards no surface without a beat, so it stays daily.
//
// Read only: two reads through ctx.read (the read box), two GETs to our own site through ctx.http.
// Never signs, never sends, never writes.

import { laneSelfTest, runLaneBeat } from "./lib/money-hourly.mjs";
import { FORGED_LINK, SIGN_PATH, SQL_SENT, SQL_SIGNED, checkSent, checkSignDoor, checkStored } from "./lib/contracts-truth.mjs";
import { webFromHttp } from "./lib/web-reader.mjs";

export const TRIPWIRE_CHECK_IDS = Object.freeze(["contracts:sent-unsignable", "contracts:signed-not-stored"]);
export const HOURLY_CHECK_IDS = Object.freeze([...TRIPWIRE_CHECK_IDS, "contracts:sign-route"]);
/** Deep checks a covered surface names that run hourly in another beat. None: all run here. */
export const RUNS_ELSEWHERE = Object.freeze({});

const SITE = "https://fundhub.ai";
const DOOR_404 = Object.freeze({ status: 404, body: JSON.stringify({ ok: false, error: "not_found" }) });

export const LANE = Object.freeze({
  checks: Object.freeze(HOURLY_CHECK_IDS.map((checkId) => Object.freeze({ id: checkId, step: checkId.replaceAll(":", "-") }))),
  /** web is a fetch-shaped reader over ctx.http (lib/web-reader.mjs). */
  runWith: async (io, web) => {
    const db = { query: (sql, params) => io.read(sql, params) };
    return [
      await checkSent(db, io.orgId),
      await checkStored(db, io.orgId),
      await checkSignDoor("contracts:sign-route", web, io.baseUrl)
    ];
  },
  selfTest: Object.freeze({
    passRows: Object.freeze([
      Object.freeze([SQL_SENT, Object.freeze([])]),
      Object.freeze([SQL_SIGNED, Object.freeze([])])
    ]),
    passHttp: Object.freeze({
      [`GET ${SITE}${SIGN_PATH}`]: DOOR_404,
      [`GET ${SITE}${FORGED_LINK}`]: DOOR_404
    }),
    // A signed contract whose signed file was never saved: the beat must stop at contracts-signed-not-stored.
    failRows: Object.freeze([
      Object.freeze([SQL_SIGNED, Object.freeze([Object.freeze({ id: "27b299b3-0000-4000-8000-000000000000", template_key: "SELFTEST" })])])
    ])
  })
});

export const id = "contract-signing";
export const title = "Contracts can be signed and are stored";
export const kind = "probe";
export const covers = ["route:contracts/sign"];
export const box = false;
export const reads = [{ host: "SITE", methods: ["GET"] }];
export const checkIds = HOURLY_CHECK_IDS;
export const steps = ["read", ...LANE.checks.map((check) => check.step)];
export const damp = 1;
export const deadlineMs = 10000;

export async function run(ctx) {
  const lane = { ...LANE, run: (io) => LANE.runWith(io, webFromHttp(ctx.http)) };
  return runLaneBeat(ctx, lane, { noun: "contract" });
}

export const fixGuide = [
  "A sent contract cannot be signed, a signed one has no stored file, or the sign door stopped checking links.",
  "",
  "Likely causes:",
  "- The contract words changed after it was sent, or it has no frozen copy, so the sign door refuses it.",
  "- The signed PDF could not be built when the client signed, so the contract is signed with no stored file.",
  "- The signing secret is missing on Netlify, so every sign link answers 503, or the sign route fell out of the router.",
  "",
  "Steps:",
  "- Run node scripts/pulse/run-beat.mjs contract-signing and read the red step: it names the contract ids or the door answer.",
  "- For a stuck contract, send a fresh copy with a signer and a frozen file. Never sign for the client.",
  "- For a missing file, rebuild and save the signed copy on the contract. For the door, open https://fundhub.ai/api/contracts/sign and read the answer.",
  "Files: src/pulse/beats/lib/contracts-truth.mjs, src/contracts/sign.mjs, src/contracts/send.mjs, api/contracts/sign.mjs"
].join("\n");

export const selfTest = {
  pass: () => laneSelfTest(LANE),
  fail: () => laneSelfTest(LANE, true)
};
