// Pure trip verdict helpers shared by the morning coverage lanes and hourly beats.
// This file deliberately has no imports and performs no I/O.

export const MIN_MS = 60 * 1000;
export const HOUR_MS = 60 * MIN_MS;
export const DAY_MS = 24 * HOUR_MS;
export const BY = Object.freeze({ SYSTEM: "system", PERSON: "person", CLIENT: "client" });
export const NO_FIX =
  "The trip check only reads. Do not fix from the pulse. Open the file the step names, find why it did not happen, and fix it there.";

export function row(id, status, detail, suggestedFix = null) {
  return { id, status, detail, suggestedFix };
}

export function intOf(value) {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

export function plural(n, word, many = null) {
  return `${n} ${n === 1 ? word : (many || `${word}s`)}`;
}

export function clip(value, n = 180) {
  const msg = value && value.message ? value.message : value;
  return String(msg == null ? "" : msg).replace(/\s+/g, " ").trim().slice(0, n).trim();
}

function toDate(value) {
  if (value === null || value === undefined || value === "") return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

function ageOf(then, now) {
  const date = toDate(then);
  const ms = date ? now.getTime() - date.getTime() : NaN;
  if (!Number.isFinite(ms) || ms < 0) return "a short time";
  const minutes = Math.floor(ms / MIN_MS);
  if (minutes < 120) return plural(Math.max(minutes, 1), "minute");
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return plural(hours, "hour");
  return plural(Math.floor(hours / 24), "day");
}

function span(ms) {
  const n = Math.max(0, Number(ms) || 0);
  if (n >= HOUR_MS && n % HOUR_MS === 0 && n < 2 * DAY_MS) return plural(n / HOUR_MS, "hour");
  if (n < 2 * HOUR_MS) return plural(Math.max(1, Math.round(n / MIN_MS)), "minute");
  if (n < 2 * DAY_MS) return plural(Math.round(n / HOUR_MS), "hour");
  return plural(Math.round(n / DAY_MS), "day");
}

const has = (facts, key) => {
  const value = facts ? facts[key] : undefined;
  return value !== undefined && value !== null && value !== false;
};

export function walkTrip({
  steps, facts = {}, now = new Date(), notOwed = [], ended = null, stall = null, detail = {}, defects = []
}) {
  const skipped = steps.map((step) => notOwed.includes(step.key));
  const reached = steps.map((step) => has(facts, step.key));
  const claimed = steps.map((step) => has(facts, `${step.key}:claim`));
  const base = {
    doneCount: steps.filter((step, i) => !skipped[i] && reached[i]).length,
    owedCount: skipped.filter((value) => !value).length,
    since: null,
    waitingOn: null
  };
  if (ended) return { ...base, state: "ended", step: null, why: String(ended.why || "the trip ended") };

  const at = (key) => {
    const value = facts[key];
    if (value instanceof Date) return Number.isFinite(value.getTime()) ? value : null;
    return typeof value === "string" && value.trim() ? toDate(value) : null;
  };
  const more = (i) => (detail && detail[steps[i].key] ? `. ${detail[steps[i].key]}` : "");
  const broken = (i, why, since = null) => ({
    ...base, state: "broken", step: steps[i], why: `${why}${more(i)}`, since
  });

  let furthest = -1;
  for (let i = 0; i < steps.length; i += 1) if (reached[i] || claimed[i]) furthest = i;
  for (let i = 0; i < steps.length; i += 1) {
    if (claimed[i] && !reached[i] && !skipped[i]) {
      return broken(i, `the board shows "${steps[i].label}" but no record backs it up`);
    }
  }
  for (const defect of Array.isArray(defects) ? defects : []) {
    const i = steps.findIndex((step) => step.key === defect.key);
    if (i >= 0 && !skipped[i]) return broken(i, String(defect.why || "the record for this step is wrong"));
  }
  for (let i = 0; i < furthest; i += 1) {
    if (!reached[i] && !skipped[i] && steps[i].required) {
      return broken(i, `"${steps[furthest].label}" is there, but "${steps[i].label}" never happened`);
    }
  }
  for (let i = 0; i < steps.length; i += 1) {
    const step = steps[i];
    if (skipped[i] || reached[i] || step.by !== BY.SYSTEM) continue;
    let anchor = step.from;
    if (!anchor) {
      for (let j = i - 1; j >= 0; j -= 1) {
        if (reached[j] && !skipped[j]) { anchor = steps[j].key; break; }
      }
    }
    if (!anchor || !has(facts, anchor)) continue;
    const anchorAt = at(anchor);
    if (!anchorAt || step.graceMs == null) continue;
    const label = step.fromLabel || (steps.find((candidate) => candidate.key === anchor) || { label: anchor }).label;
    if (now.getTime() - anchorAt.getTime() > step.graceMs) {
      return broken(
        i,
        `"${label}" was ${ageOf(anchorAt, now)} ago and "${step.label}" is owed within ${span(step.graceMs)} of it`,
        anchorAt
      );
    }
  }
  if (stall) {
    let lastDone = -1;
    for (let i = 0; i < steps.length; i += 1) if (reached[i] && !skipped[i]) lastDone = i;
    let i = stall.key ? steps.findIndex((step) => step.key === stall.key) : -1;
    if (i < 0) {
      for (let j = lastDone + 1; j < steps.length; j += 1) {
        if (!skipped[j] && !reached[j]) { i = j; break; }
      }
    }
    if (i >= 0 && !skipped[i] && !reached[i]) return broken(i, String(stall.why || "the step is past its clock"));
  }

  let lastReached = -1;
  for (let i = 0; i < steps.length; i += 1) if (reached[i] && !skipped[i]) lastReached = i;
  for (let i = lastReached + 1; i < steps.length; i += 1) {
    if (skipped[i] || reached[i]) continue;
    const who = steps[i].by === BY.SYSTEM ? "the system" : steps[i].by === BY.CLIENT ? "the customer" : "a person";
    return { ...base, state: "waiting", step: steps[i], why: `waiting on ${who} for "${steps[i].label}"`, waitingOn: steps[i] };
  }
  return { ...base, state: "finished", step: null, why: "every step the company and the customer owe is done" };
}

export function whoIs(value) {
  const code = value && value.client_code ? String(value.client_code).trim() : "";
  if (code) return code;
  const id = value && (value.client_id || value.id) ? String(value.client_id || value.id) : "";
  return id ? id.slice(0, 8) : "an unknown customer";
}

export function judgeTrip({
  id, tripName, steps, rows = [], now = new Date(), windowDays = 60, cap = null,
  fix = NO_FIX, what = "customer", note = ""
}) {
  if (!rows.length) {
    return row(id, "PASS", `Nobody started the ${tripName} trip in the last ${windowDays} days, so nobody is stuck. ` +
      "There is no customer to follow yet; the first one is the first real test of every step.");
  }
  const walks = rows.map((value) => ({
    value,
    walk: walkTrip({
      steps: typeof steps === "function" ? steps(value) : steps,
      facts: value.facts,
      now,
      notOwed: value.notOwed || [],
      ended: value.ended || null,
      stall: value.stall || null,
      detail: value.detail || {},
      defects: value.defects || []
    })
  }));
  const broken = walks.filter((item) => item.walk.state === "broken");
  const total = rows.length;
  const capNote = cap && total >= cap ? ` (the first ${cap}, oldest first)` : "";
  if (broken.length) {
    const lines = broken.map(({ value, walk }) => `${value.who || whoIs(value)} stopped at "${walk.step.label}": ${walk.why}`);
    const shown = lines.slice(0, 4).join("; ") + (lines.length > 4 ? `; and ${lines.length - 4} more` : "");
    return row(
      id,
      "FAIL",
      `${broken.length} of ${plural(total, what)} who started the ${tripName} trip in the last ${windowDays} days ${broken.length === 1 ? "is" : "are"} stuck${capNote}. ${shown}.${note ? ` ${note}` : ""}`,
      fix
    );
  }
  const finished = walks.filter((item) => item.walk.state === "finished").length;
  const endedCount = walks.filter((item) => item.walk.state === "ended").length;
  const waiting = walks.filter((item) => item.walk.state === "waiting");
  const byStep = new Map();
  for (const item of waiting) {
    const key = item.walk.waitingOn ? item.walk.waitingOn.label : "an unknown step";
    byStep.set(key, (byStep.get(key) || 0) + 1);
  }
  const waitText = waiting.length
    ? `${waiting.length} waiting (${[...byStep].map(([key, n]) => `${n} at "${key}"`).join(", ")})`
    : "0 waiting";
  return row(
    id,
    "PASS",
    `${plural(total, what)} started the ${tripName} trip in the last ${windowDays} days${capNote}: ${finished} finished, ${waitText}, ${endedCount} ended. None is stuck on a step the company owes.${note ? ` ${note}` : ""}`
  );
}

export function realClientSql(alias, param) {
  return `COALESCE(${alias}.is_demo, false) = false
     AND COALESCE(${alias}.custom_fields ->> 'synthetic', '') <> 'true'
     AND COALESCE(${alias}.email, '') !~* ${param}::text
     AND (${alias}.custom_fields ->> 'crm_archived_at') IS NULL`;
}
