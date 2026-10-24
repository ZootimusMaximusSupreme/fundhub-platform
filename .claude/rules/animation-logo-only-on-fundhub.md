# Animation logo — only where the script says Fundhub

**Owner law (2026-10-23):** Chris: "remove the logo from the pngs... make 1 fundhub animation for the logo so that way we can get brand loyalty," then "the logo only goes where we say fundhub."

## Always

- See-through (overlay) animations in `marketing/broll` never show the wordmark. `Wordmark` draws nothing inside `<SeeThrough on>`.
- The brand shows only in `FundhubLogo` / `FundhubLogoWide`, and that plays only on a line where the script says "Fundhub" (2 seconds).
- Put the logo on every "Fundhub" line. If another animation sits within 4 seconds, the logo wins.
- Fix the transcript when it mishears the name ("FunHub").

## Never

- Add a logo to a new see-through template.

The checker enforces it: `validateAnimationPlan` refuses a logo anchor without "Fundhub" (`logo_not_on_fundhub`). Rules board: `ops/workflows/animation-builds-2026-10-22.md`. Skill: `fundhub-video-animation-overlay`.
