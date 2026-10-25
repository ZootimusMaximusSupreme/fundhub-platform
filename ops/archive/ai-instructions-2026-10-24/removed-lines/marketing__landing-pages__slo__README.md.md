# Removed from `marketing/landing-pages/slo/README.md` on 2026-10-24

Reason: S40. TEMPORARY. The launch is over. Sim mode is already off in the pages. The PAGES list now includes `slo-02-booking.html`.

```
SWAP BEFORE LAUNCH
  Video files:   fundhub.ai/funnel/slo-vsl.mp4 (+ slo-vsl-poster.jpg), slo-vsl2-funding.mp4, slo-vsl3-repair.mp4
  CTA hrefs:     /order  -> live order page path
  Proof:         replace bracket placeholders in slo-01 Section 5 with real results (they auto-hide until then)

--------------------------------------------------------------------------
SIM MODE — LAYOUT PREVIEW (added 2026-08-31, temporary)

The page hides anything it has no real content for, so on a fresh checkout the
proof section and the pre-approval card both render empty. That is correct live
behaviour, but it makes the layout impossible to judge.

Sim mode fills those two spots with clearly-marked samples.

  slo-01-sales.html      3 sample client-result cards in Section 5 (Proof)
  slo-03-thank-you.html  a stand-in pre-approval amount ($84,500)

Both carry an amber bar on screen saying the content is a sample, and every
result card repeats "Sample - not a real client". Nothing here can be mistaken
for a real testimonial.

TURNING IT OFF — one line per file:

  slo-01-sales.html       var FH_SIM = true;   ->  false
  slo-03-thank-you.html   var FH_SIM = true;   ->  false

With FH_SIM off, the original behaviour is back exactly as it was: empty slots
hide themselves, and the pre-approval card falls back to its "amount is in your
Funding Snapshot" line unless a real ?pa= is on the address.

A real ?pa= in the address always wins over the sim amount, on or off.

REMOVE BEFORE LAUNCH. Search each file for "SIM MODE" and delete the marked
block, plus the .sim-flag / .res-card rules in the sales page stylesheet.

Marked-up screenshots of what sim mode renders:
  docs/workflows/slo-sim-evidence/
```
