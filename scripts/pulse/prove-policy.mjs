const RUNNER_ONLY_REASON = /not the live server|row of asterisks|is a mask|oauth is not set|empty or masked|laptop copy/i;

// GitHub proves the bundle before Netlify runs it. These vendor secrets stay on
// the live server, so an empty CI copy is named but never counted green. A real
// provider refusal still stays red and stops pretending that the door was read.
const CI_SECRET_ONLY_IDS = new Set(["keys:vendor-key-read"]);

export function isRunnerOnlyNotChecked({ id = "", why = "" } = {}, { ci = false } = {}) {
  return RUNNER_ONLY_REASON.test(String(why))
    || (ci && CI_SECRET_ONLY_IDS.has(String(id)) && /not set here/i.test(String(why)));
}

export function isPartialLaneOnlyNotChecked({ why = "" } = {}, { partial = false } = {}) {
  return partial && /^Claims covered by .+, but .+ did not run today\.$/.test(String(why));
}

export function unknownRequestedLanes(requested = [], available = []) {
  const known = new Set(available.map(String));
  return [...new Set(requested.map(String).filter((lane) => !known.has(lane)))];
}

