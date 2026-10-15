// The one batch 16 display row that cannot honestly be attached today, and exactly why.
// It is a finding, not a failure. fin-b16-rows.test.mjs holds the reason to the repo: the moment the reason
// stops being true, that test goes red and says the row can now be attached.

export const FIN_B16_NOT_ATTACHABLE = Object.freeze([
  Object.freeze({
    sourceFile: "desks-c.json",
    surface: "messaging.html",
    control: "Reference disclosure (who-sent-it colour key)",
    why: "The button and its colour key are in the page's markup (#demoToggle inside #demozone), but public/app/fundhub-brand.css "
      + "lists #demozone and .demozone among the placeholders that never render (UI-STANDARDS section 5) with "
      + "display:none !important, and messaging.html loads that stylesheet. A person cannot see the button, so they cannot "
      + "press it. A test that un-hides it first would prove a control nobody can use, so the row is not attached.",
  }),
]);
