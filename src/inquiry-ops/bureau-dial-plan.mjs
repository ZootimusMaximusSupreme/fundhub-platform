// What the AI bureau caller really dials, and the phone menu steps it follows.
//
// Owner answer B7 (2026-10-20): the bureau phone numbers and menu steps are
// already saved. They live in the call scripts the caller uses
// (vendor/inquiry-remover/src/agents/*-prompt.js, the same builders
// src/inquiry-ops/bureau-call.mjs hands to Bland):
//   - the number is buildXCallConfig().phoneNumber: the Netlify setting
//     EXPERIAN_DISPUTE_NUMBER / EQUIFAX_DISPUTE_NUMBER / TRANSUNION_DISPUTE_NUMBER
//     when it is set, else the number written in the script;
//   - the menu steps are the IVR section of the script ("PHASE 1: IVR" for
//     Experian and TransUnion, "Step-by-Step Script" for Equifax).
// The ai_bureau_config table (migration 140) ships empty and nothing that places
// a call reads its number or menu path.
//
// The scripts are imported statically so the bundler carries them into the
// function. Building a config only builds an object: nothing is dialed, sent or
// written here.

import experian from "../../vendor/inquiry-remover/src/agents/experian-prompt.js";
import equifax from "../../vendor/inquiry-remover/src/agents/equifax-prompt.js";
import transunion from "../../vendor/inquiry-remover/src/agents/transunion-prompt.js";

/** A US number in the form Bland dials: +1 and ten digits. */
export const DIAL_NUMBER_RE = /^\+1\d{10}$/;

/** Fewer menu steps than this is not a menu the caller can follow. */
export const MIN_MENU_STEPS = 3;

export const BUREAU_SCRIPTS = Object.freeze([
  Object.freeze({ code: "EX", name: "Experian", env: "EXPERIAN_DISPUTE_NUMBER", build: experian.buildExperianCallConfig }),
  Object.freeze({ code: "EQ", name: "Equifax", env: "EQUIFAX_DISPUTE_NUMBER", build: equifax.buildEquifaxCallConfig }),
  Object.freeze({ code: "TU", name: "TransUnion", env: "TRANSUNION_DISPUTE_NUMBER", build: transunion.buildTransUnionCallConfig })
]);

const MENU_HEAD_RE = /^##\s+(?:PHASE 1: IVR\b|Step-by-Step Script\b).*$/m;
const STEP_RE = /^\s*(?:STEP\s+\d+:|\d+\.)\s+\S/;

/** The menu steps in a call script's IVR section, as plain lines. Pure. */
export function menuSteps(task) {
  const text = String(task || "");
  const head = MENU_HEAD_RE.exec(text);
  if (!head) return [];
  const rest = text.slice(head.index + head[0].length);
  const next = rest.search(/^##\s/m);
  const section = next < 0 ? rest : rest.slice(0, next);
  return section.split("\n").filter((line) => STEP_RE.test(line)).map((line) => line.trim());
}

/**
 * One row per bureau the caller dials:
 *   { code, name, number, numberFrom, numberOk, steps, menuOk, problem }
 * `numberFrom` is "setting" when the Netlify setting is used, else "script".
 * A builder that throws is a row with numberOk/menuOk false and the reason.
 */
export function bureauDialPlan({ scripts = BUREAU_SCRIPTS, env = process.env } = {}) {
  return scripts.map((s) => {
    try {
      const config = s.build({}) || {};
      const number = String(config.phoneNumber || "").trim();
      const steps = menuSteps(config.task);
      return {
        code: s.code,
        name: s.name,
        number,
        numberFrom: String(env?.[s.env] || "").trim() ? "setting" : "script",
        numberOk: DIAL_NUMBER_RE.test(number),
        steps: steps.length,
        menuOk: steps.length >= MIN_MENU_STEPS,
        problem: null
      };
    } catch (err) {
      return {
        code: s.code,
        name: s.name,
        number: "",
        numberFrom: "script",
        numberOk: false,
        steps: 0,
        menuOk: false,
        problem: String((err && err.message) || err).slice(0, 120)
      };
    }
  });
}
