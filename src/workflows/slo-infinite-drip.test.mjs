import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { sweepSloDrip, sendDueDrip, dripSendKey } from "./slo-infinite-drip.mjs";
import { DRIP_LANES, DRIP_ON, DRIP_STEP, DRIP_NEXT } from "../slo/drip-plan.mjs";
import { morningEmailPathMissesFailureCheck } from "../pulse/coverage/gap-email.mjs";
import { pgFake } from "./test-support.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ORG = "org-1";

function dripTemplates() {
  return Object.values(DRIP_LANES).flat().map((key) => ({
    org_id: ORG, template_key: key, channel: "email", subject: key, body: `body ${key}`, compliance_passed: true
  }));
}

function onDrip(id, step = 0) {
  return {
    id, org_id: ORG, email: `${id}@example.com`,
    custom_fields: { [DRIP_ON]: "1", [DRIP_STEP]: String(step), [DRIP_NEXT]: "2026-10-01T00:00:00.000Z" }
  };
}

/** pgFake plus the one sweep read it does not answer: who is due. */
function dripDb(seed) {
  const base = pgFake(seed);
  return {
    ...base,
    async query(sql, params = []) {
      if (/FROM clients\s+WHERE custom_fields->>\$1 = '1'/.test(sql)) {
        const [on, next, now] = params;
        const rows = base.clients
          .filter((c) => c.custom_fields?.[on] === "1"
            && (c.custom_fields?.[next] == null || c.custom_fields[next] <= now))
          .map((c) => ({ id: c.id, org_id: c.org_id, custom_fields: { ...c.custom_fields } }));
        return { rows };
      }
      return base.query(sql, params);
    }
  };
}

const dripRows = (db, clientId) =>
  db.messages.filter((m) => m.client_id === clientId && String(m.template_key).startsWith("EMAIL-SLO-DRIP-"));

test("two people on the same step each get their own drip email", async () => {
  const db = dripDb({ clients: [onDrip("c-a"), onDrip("c-b")], templates: dripTemplates() });

  const out = await sweepSloDrip(db, new Date("2026-10-09T15:00:00.000Z"));

  assert.equal(out.scanned, 2);
  assert.equal(dripRows(db, "c-a").length, 1, "first person has one email row");
  assert.equal(dripRows(db, "c-b").length, 1, "second person has one email row too");
  assert.notEqual(dripRows(db, "c-a")[0].provider_ref, dripRows(db, "c-b")[0].provider_ref);
  assert.equal(dripRows(db, "c-a")[0].template_key, DRIP_LANES.cold[0]);
  assert.equal(dripRows(db, "c-b")[0].template_key, DRIP_LANES.cold[0]);
  for (const id of ["c-a", "c-b"]) {
    assert.equal(db.clients.find((c) => c.id === id).custom_fields[DRIP_STEP], "1");
  }
});

test("the send key is one per person per step, and never null", () => {
  assert.equal(dripSendKey("c-a", 3), "slo-infinite-drip:c-a:3");
  assert.notEqual(dripSendKey("c-a", 0), dripSendKey("c-b", 0));
  // Step 7 is template 1 again (the lane wraps), but it is a new step, so a new key.
  assert.notEqual(dripSendKey("c-a", 0), dripSendKey("c-a", 7));
});

test("the same person at the same step never gets that email twice", async () => {
  const client = onDrip("c-a", 2);
  const db = dripDb({ clients: [client], templates: dripTemplates() });
  const row = { id: client.id, org_id: ORG, custom_fields: { ...client.custom_fields } };

  const first = await sendDueDrip(db, row);
  // A rerun of the same step (the step write was lost, or two runs overlap).
  const again = await sendDueDrip(db, row);

  assert.equal(first.sent, true);
  assert.equal(again.sent, true, "already queued for this person counts as queued");
  assert.equal(dripRows(db, "c-a").length, 1, "one row, not two");
});

test("no email queued: the step does not move", async () => {
  // No templates seeded, so sendTemplated says template_pending.
  const db = dripDb({ clients: [onDrip("c-a", 3)], templates: [] });

  const out = await sweepSloDrip(db, new Date("2026-10-09T15:00:00.000Z"));

  assert.equal(out.results[0].sent, false);
  assert.equal(out.results[0].reason, "template_pending");
  const cf = db.clients[0].custom_fields;
  assert.equal(cf[DRIP_STEP], "3", "step stays where it was");
  assert.equal(cf[DRIP_NEXT], "2026-10-01T00:00:00.000Z", "next time is not pushed out");
  assert.equal(dripRows(db, "c-a").length, 0);
});

test("the morning pulse sees the drip read its send result", () => {
  const src = fs.readFileSync(path.join(HERE, "slo-infinite-drip.mjs"), "utf8");
  assert.equal(morningEmailPathMissesFailureCheck(src), false);
});
