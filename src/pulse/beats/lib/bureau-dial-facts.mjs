// What the AI bureau caller dials, as data the live bundle carries.
//
// The morning lane reads the dial plan from the caller's own call scripts
// (src/inquiry-ops/bureau-dial-plan.mjs builds each one from
// vendor/inquiry-remover/src/agents/*-prompt.js). A beat may import only from
// src/pulse/beats/lib, so the two facts a script holds are written here:
//   scriptNumber   the number written in the script, used when the Netlify setting is empty
//   steps          how many phone-menu steps the script's IVR section lists
// The scripts are code: they change only with a deploy. beat-customer-records.test.mjs builds the
// real plan from the real scripts for several settings and fails if dialPlanFromFacts() answers
// anything different, so these facts cannot drift from the scripts.
//
// The setting wins over the script number, the same way each script picks its phoneNumber:
// `setting || scriptNumber`, and the Experian and TransUnion scripts also strip a pasted "\n" and
// trim. Pure: no I/O.

/** A US number in the form Bland dials: +1 and ten digits (src/inquiry-ops/bureau-dial-plan.mjs). */
export const DIAL_NUMBER_RE = /^\+1\d{10}$/;

/** Fewer menu steps than this is not a menu the caller can follow (src/inquiry-ops/bureau-dial-plan.mjs). */
export const MIN_MENU_STEPS = 3;

export const BUREAU_SCRIPT_FACTS = Object.freeze([
  Object.freeze({ code: "EX", name: "Experian", env: "EXPERIAN_DISPUTE_NUMBER", scriptNumber: "+18554146048", steps: 7, stripsNewlines: true }),
  Object.freeze({ code: "EQ", name: "Equifax", env: "EQUIFAX_DISPUTE_NUMBER", scriptNumber: "+18665495097", steps: 10, stripsNewlines: false }),
  Object.freeze({ code: "TU", name: "TransUnion", env: "TRANSUNION_DISPUTE_NUMBER", scriptNumber: "+18009168800", steps: 7, stripsNewlines: true })
]);

/**
 * The same rows bureauDialPlan() returns, built from the facts and the settings:
 *   { code, name, number, numberFrom, numberOk, steps, menuOk, problem }
 */
export function dialPlanFromFacts(env = {}, facts = BUREAU_SCRIPT_FACTS) {
  return facts.map((f) => {
    let picked = (env && env[f.env]) || f.scriptNumber;
    if (f.stripsNewlines) picked = String(picked).replace(/\\n/g, "").trim();
    const number = String(picked || "").trim();
    return {
      code: f.code,
      name: f.name,
      number,
      numberFrom: String((env && env[f.env]) || "").trim() ? "setting" : "script",
      numberOk: DIAL_NUMBER_RE.test(number),
      steps: f.steps,
      menuOk: f.steps >= MIN_MENU_STEPS,
      problem: null
    };
  });
}
