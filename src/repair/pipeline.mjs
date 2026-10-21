// Pipeline stage keys + move helpers for the optimization (repair) rail.

import { moveCardToStage } from "../workflows/cards.mjs";
import { STALLED_STAGE } from "./sla.mjs";
/* REPAIR_PIPELINE, REPAIR_STAGES, readRepairStage and EVENT_STAGE live in src/pulse/beats/lib/repair-stage.mjs
   (2026-10-20), unchanged, so the hourly beat client-progress reads the stage the same way. One copy; re-exported. */
import { REPAIR_PIPELINE, REPAIR_STAGES, readRepairStage, EVENT_STAGE } from "../pulse/beats/lib/repair-stage.mjs";

export { REPAIR_PIPELINE, REPAIR_STAGES, readRepairStage, EVENT_STAGE };

export async function moveRepairCard(db, { orgId, clientId, stageKey }) {
  return moveCardToStage(db, {
    orgId,
    clientId,
    pipelineKey: REPAIR_PIPELINE,
    stageKey
  });
}

export async function stallRepairCard(db, { orgId, clientId, reason }) {
  const moved = await moveRepairCard(db, { orgId, clientId, stageKey: STALLED_STAGE });
  return { ...moved, stalled: true, reason };
}
