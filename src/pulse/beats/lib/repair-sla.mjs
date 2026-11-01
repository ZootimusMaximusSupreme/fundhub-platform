// The repair desk's stage clocks. THE ONE COPY (2026-10-20).
//
// This file used to be a word-for-word copy of src/repair/sla.mjs for the pulse. src/repair/sla.mjs now
// re-exports this file, so the desk's Stuck chip, the SLA sweeper, the progress timeline and the hourly
// repair beats all read these clocks (a beat may import only from src/pulse/beats/lib).
// repair-sla.test.mjs holds that the app file hands out these very objects. Change the clocks here.
// Pure: no imports, no I/O.

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
  if (sla.businessDays && sla.days) {
    // Match repair/croa.mjs::addBusinessDays: count Mon–Fri using UTC dates.
    // Preserve the actual entered time; weekends are not elapsed SLA days.
    // The existing CROA helper does not exclude public holidays either.
    const due = new Date(start);
    for (let remaining = sla.days; remaining > 0;) {
      due.setUTCDate(due.getUTCDate() + 1);
      const day = due.getUTCDay();
      if (day !== 0 && day !== 6) remaining -= 1;
    }
    return { breached: now > due.getTime(), task: sla.task, sla };
  }
  let ms = 0;
  if (sla.minutes) ms = sla.minutes * 60000;
  else if (sla.hours) ms = sla.hours * 3600000;
  else if (sla.days) ms = sla.days * 86400000;
  return { breached: now > start + ms, task: sla.task, sla };
}

/** Stages that fail automation land here — the only human queue. */
export const STALLED_STAGE = "stalled";
