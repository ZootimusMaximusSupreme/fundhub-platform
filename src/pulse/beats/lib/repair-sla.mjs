// The repair desk's stage clocks, for the pulse. A COPY of src/repair/sla.mjs.
//
// src/repair/sla.mjs is app code (the desk's Stuck chip and the SLA sweeper read it), so it stays
// where it is. A beat may import only from src/pulse/beats/lib, so the clocks the repair checks judge
// with are copied here word for word. repair-sla.test.mjs fails the moment the two drift: the same
// STAGE_SLA, the same STALLED_STAGE and the same isBreached answer on a grid of stages and ages.
// Change the clocks in src/repair/sla.mjs first, then copy them here. Pure: no imports, no I/O.

export const STAGE_SLA = Object.freeze({
  intake: { days: 3, businessDays: true, task: "chase_contract" },
  awaiting_documents: { days: 14, task: "owner_contact_client" },
  analysis: { hours: 1, task: "engineering_engine_failure" },
  letters_generated: { minutes: 30, task: "engineering_generation_or_variance" },
  ready_to_send: { hours: 4, task: "dispatch_failure" },
  in_transit: { days: 10, task: "check_postgrid_tracking" },
  awaiting_response: { daysAfterDue: 5, task: "bureau_deadline_breach" },
  response_received: { hours: 24, task: "owner_reviews_parse" }
});

export function isBreached({ stageKey, enteredAt, asOf, responseDueAt }) {
  const sla = STAGE_SLA[stageKey];
  if (!sla || !enteredAt) return { breached: false };
  const now = new Date(asOf || Date.now()).getTime();
  const start = new Date(enteredAt).getTime();
  if (!Number.isFinite(now) || !Number.isFinite(start)) return { breached: false };

  if (sla.daysAfterDue != null) {
    if (!responseDueAt) return { breached: false };
    const due = new Date(responseDueAt).getTime() + sla.daysAfterDue * 86400000;
    return { breached: now > due, task: sla.task, sla };
  }
  let ms = 0;
  if (sla.minutes) ms = sla.minutes * 60000;
  else if (sla.hours) ms = sla.hours * 3600000;
  else if (sla.days) ms = sla.days * 86400000;
  return { breached: now > start + ms, task: sla.task, sla };
}

/** Stages that fail automation land here — the only human queue. */
export const STALLED_STAGE = "stalled";
