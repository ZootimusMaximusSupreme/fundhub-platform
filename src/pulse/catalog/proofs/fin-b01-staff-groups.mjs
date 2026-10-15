// Finish-the-853, batch 01: the staff screen controls whose saved result is judged live
// (see fin-b01-display-contracts.mjs). Same shape as STAFF_UI_GROUPS in
// display-batch-staff-ui.mjs: a spec that presses the controls, and the exact control
// rows it presses. The spec is part of the staff browser batch; the contract is read
// by the display lane.
export const FIN_B01_STAFF_UI_GROUPS = Object.freeze([
  Object.freeze({
    sourceFile: "desks-a.json",
    surface: "agent-editor.html",
    specs: Object.freeze(["e2e/fin-b01-agent-authority.spec.mjs"]),
    controls: Object.freeze([
      "Authority switch: May take a payment",
      "Authority switch: May run a soft pull",
      "Authority: Max discount input (percent)",
    ]),
  }),
]);
