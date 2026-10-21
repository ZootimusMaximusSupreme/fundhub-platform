// The roadmap drip check, read only: email:drip-step-no-email.
//
// ONE JUDGE, TWO CLOCKS (2026-10-20). This check, its SQL and the read helpers it uses used to live in
// src/pulse/coverage/gap-email.mjs. They moved here unchanged so the morning lane (which imports them
// back) and the hourly beat lead-handoff run the same SQL and the same verdict. A beat may import only
// from src/pulse/beats/lib, so the truth lives here. db is anything with query(sql, params).
// Never sends. Never writes. Never touches the outbound switch.

export const DRIP_CHECK_ID = "email:drip-step-no-email";

export const RECON =
  "Report it on the morning pulse (Recon AG-07). Do not send email from this check. Do not flip outbound. Do not build a second watchdog.";

export function check(id, status, detail, suggestedFix = null) {
  return { id, status, detail, suggestedFix };
}

/* The roadmap drip (src/workflows/slo-infinite-drip.mjs, 8:00 a.m. Arizona) moves a
   person's slo_drip_step up by one each time it queues their email. So a person
   whose step is higher than the number of drip emails they have is a person the
   drip skipped. This reads the result in the database, which is the one place
   that works when the source file is not on disk.
   Measured 2026-10-08: sendTemplated was called with eventId null, so the ref was
   workflow:<template>:null and every person after the first deduped into the
   first person's row. Fixed 2026-10-09: the key is person + step, and the step
   moves only when email.sent is true. */
export const DRIP_SQL = `
SELECT count(*)::int AS n,
       COALESCE(sum(gap), 0)::int AS missing
  FROM (
    SELECT s.step - s.sent AS gap
      FROM (
        SELECT CASE WHEN c.custom_fields->>'slo_drip_step' ~ '^[0-9]+$'
                    THEN (c.custom_fields->>'slo_drip_step')::int ELSE 0 END AS step,
               (SELECT count(*) FROM messages m
                 WHERE m.org_id = c.org_id
                   AND m.client_id = c.id
                   AND m.channel = 'email'
                   AND m.template_key LIKE 'EMAIL-SLO-DRIP-%')::int AS sent
          FROM clients c
         WHERE c.org_id = $1::uuid
           AND COALESCE(c.is_demo, false) = false
           AND c.custom_fields->>'slo_drip_on' = '1'
      ) s
     WHERE s.step > s.sent
  ) g
`.trim();

/** One read. rows[0] with every named column a real number, or a reason. */
export async function safeRead(db, sql, params, columns) {
  try {
    const { rows } = await db.query(sql, params);
    const got = rows && rows[0];
    if (!got) return { ok: false, error: "no row came back", unreadable: true };
    const out = {};
    for (const col of columns) {
      const raw = got[col];
      const n = raw == null || raw === "" ? NaN : Number(raw);
      if (!Number.isFinite(n)) return { ok: false, error: `${col} came back unreadable`, unreadable: true };
      out[col] = n > 0 ? Math.floor(n) : 0;
    }
    return { ok: true, ...out };
  } catch (err) {
    return { ok: false, error: String((err && err.message) || err).slice(0, 160) };
  }
}

/** A read that failed is a FAIL (we cannot see the break). A count that came back blank is a skip. */
export function unreadRow(id, result, fix) {
  if (result.unreadable) return check(id, "skip", `could not read: ${result.error}`);
  return check(id, "FAIL", `could not read: ${result.error}`, fix);
}

export function plural(n, one, many) {
  return n === 1 ? one : many;
}

export function dripDetail(n, missing) {
  return `${n} ${plural(n, "person is", "people are")} on the roadmap drip with ${missing} ${plural(missing, "step", "steps")} that never queued an email.`;
}

export const DRIP_FIX = `The drip moved their step and no email row exists. Read slo_drip_step on the client and the EMAIL-SLO-DRIP rows. sendTemplated ignores a repeat provider_ref. ${RECON}`;

/** The one drip read: how many people on the drip have a step with no email row, and how many steps. */
export function readDrip(db, orgId) {
  return safeRead(db, DRIP_SQL, [orgId], ["n", "missing"]);
}

/** The verdict on one readDrip result. A failed read is a FAIL; a blank count is a skip. */
export function judgeDrip(drip) {
  if (!drip.ok) return unreadRow(DRIP_CHECK_ID, drip, DRIP_FIX);
  if (drip.n > 0) return check(DRIP_CHECK_ID, "FAIL", dripDetail(drip.n, drip.missing), DRIP_FIX);
  return check(DRIP_CHECK_ID, "PASS", "every person on the roadmap drip has an email row for each step the drip took");
}
