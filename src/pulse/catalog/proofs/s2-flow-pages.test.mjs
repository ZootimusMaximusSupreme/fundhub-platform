import test from "node:test";

import { S2_FLOW_SPECS } from "./s2-display-contracts.mjs";
import { assertSpecsAreSafe, runSpecs } from "./s2-run-specs.mjs";

test("the Flow page specs exist and make no live writes", () => {
  assertSpecsAreSafe(S2_FLOW_SPECS);
});

test("the consulting pages are driven in a real browser", () => {
  runSpecs(S2_FLOW_SPECS, "slice-2 flow page proofs");
});
