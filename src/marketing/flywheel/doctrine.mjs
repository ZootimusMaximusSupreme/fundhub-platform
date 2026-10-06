// @ts-check
// The ad-strategy doctrine the server's step 5 reads, bundled as text.
//
// .claude/workflows/ad-strategy.js loaded the Jeremy Haynes skill from the
// laptop (~/Library/Application Support/Claude/...), which a Netlify function
// cannot read, and the design says the doctrine is "bundled in src/ as string
// exports (esbuild cannot see an fs read)" (docs/specs/command-center-design-
// 2026-10-05.md §3.2, unit X3). The repo holds the strategy SOPs only as the
// excerpts below, written "against the Jeremy Haynes ad system, read in full";
// the full SOPs are in Drive (the list at the end) and this step does not read
// them. So the writer is told plainly which strategies have their requirements
// written here and which do not, and never to fill a gap from memory.
//
// GENERATED, WORD FOR WORD, from the files named in DOCTRINE_SOURCES.
// src/marketing/flywheel/doctrine.test.mjs fails when an excerpt is no longer
// in its source file, so a change there is a change here in the same commit.

export const DOCTRINE_SOURCES = Object.freeze([
  "marketing/ads/ascension/ascension-ads.md",
  "marketing/copy/Drive-Source-Index.md",
  "marketing/flywheel/partner/05-ad-strategy.md"
]);

/** ascension-ads.md §1, "Which strategy". */
export const STRATEGY_PICK = "## 1. Which strategy — and why the obvious answer is wrong for us right now\n\nThe system's own table sends a high-ticket offer to **Venus Fly Trap 2.0**. That is the\ncorrect long-term answer for a $10,000 offer. It is not the day-one answer, for two\nreasons the SOP states outright:\n\n- It needs **15 long-form videos** — five per step, three steps.\n- The SOP says plainly: **\"This isn't a $50/day strategy.\"** Its worked example is\n  **$60,000 across 30 days**, with half or more of it parked in Step 1.\n\n**We have zero videos.** So VFT 2.0 cannot start, and neither can The Forester, which\nneeds **5–12 videos** of its own.\n\n### Start here: Paid Leads, cold → the $27 autopsy\n\nThe one strategy in the system that needs **no content library**, and the ladder is\nalready built for it:\n\n> Sell something cheap and genuinely useful at break-even. What comes back is a\n> **buyer**, not a freeloader. Then the buyers go to closers.\n\nSo run direct response straight at the **$27 Decline Autopsy**. Every buyer is somebody\nwho had declines, paid to understand them, and has now watched how we read a file. That\nis a far warmer list for a $10,000 partnership than any cold audience, and it was bought\nat break-even instead of paid for as a lead.\n\n**Do not run cold traffic at the $10,000 page.** No proof, no video, no content, highest\nprice on the ladder.\n\n### Then, as content gets shot: The Forester\n\nThe Forester's whole purpose is CPM arbitrage — turn cold into warm for about **$0.01 per\nengagement** (the SOP records as low as $0.0001), then run direct response at the warm\naudience, because warm CPMs are lower. Real setup from the SOP:\n\n- **Content Cycle Bin 1:** one campaign, **5–12 ad sets, one video per ad set**,\n  **ad set budget optimization**, objective **Engagement**. Same cold targeting in every\n  ad set — a lookalike stack of past customers, past qualified leads and the qualified\n  email list, or an ideal-buyer cold interest set if those don't exist yet.\n- **From $5/day per ad set** upward. The SOP's screenshot example runs $30/day per ad\n  set across 9 ad sets.\n- **10 seconds of any one video = warm.** Build the audience on **365-day** windows —\n  a wider audience costs less. Include every engagement option: visited profile, engaged\n  with post or ad, pressed a button, messaged the page, saved a post.\n- **Then run direct response at that warm audience AND Content Cycle Bin 2 at the same\n  time.** Bin 2 is built identically to Bin 1. Match the per-ad-set spend on warm to\n  cold — the SOP flags a client who ran $30/day cold and only $5/day warm as the mistake.\n- The SOP's framing matters: **it is a spider web, not a sequence.** Let the platform\n  decide which video each person sees. Do not force an order.\n\n**Only then, VFT 2.0**, once 15 long-form videos and a real budget exist.";

/** ascension-ads.md §5, "Hammer Them". */
export const HAMMER_THEM = "## 5. Ad set C — Hammer Them, the 72 hours before a review call\n\n**15–20+ pieces inside 72 hours** before the call. The mechanism the SOP names is\nfamiliarity bias and the mere-exposure effect — and the key strategic point:\n**you are selling the next step (showing up), not the offer.**\n\nFormat, per the SOP: **short, direct, vertical videos built for Reels**, posted organically\nto Instagram and cross-posted to Facebook. **Do not use copyrighted music** — it blocks\nyou from running them through paid engagement campaigns later.\n\nThe SOP's **four pillars**, mapped to this offer:\n\n| Pillar | Pieces to make |\n|---|---|\n| **Questions** | Why we're opening the engine to partners at all · how the 50/50 actually works · what fulfillment covers, step by step |\n| **Second-layer questions** | What \"a partner view, not the whole CRM\" means in practice · what the ad-account connection is for · how add-ons get priced |\n| **Objections** | \"Which lenders?\" — the real answer and why it stays that way · the ten-a-month floor, including who shouldn't apply · \"do I need to get funded myself?\" — no · \"is marketing included?\" — no |\n| **Expectations** | What the review call is and who's on it · what day one looks like · what the first thirty days look like |\n\n**Client results:** blocked until real, verifiable results exist. Do not fabricate one.\n\nThe SOP's own warning applies: this strategy is not for people who won't make content.";

/** The strategy SOPs that exist in Drive (Drive-Source-Index.md lines, as written). */
export const DRIVE_SOPS = Object.freeze([
  "- **Ad Scaling Framework.docx (36MB)** (copywriting) — `1RmsLIHJpGfDXNDGRRreKOLOF8-2Hd0WL`",
  "- **Venus Fly Trap 2.0 SOP.docx** (copywriting) — `10NlRD0k6j1PR8SONEa3dRWhczAjvY-MK`",
  "- **The Forester Ad Strategy.docx (11MB)** (copywriting) — `1WIel9sDXgWaBKfBnCbR8OPWvlmGneAkY`",
  "- **The_Harvester_Ad_Strategy.docx** (copywriting) — `1WcS1k8t0pMgLQxalvGAY2Pj8AfJt8KFX`",
  "- **The Tornado Ad Strategy.docx** (copywriting) — `194I5Z-uMGreUFHQZOnNgRkLZGccHj884`",
  "- **Hammer Them Ad Strategy SOP.docx** (copywriting) — `1GOA7iPTQlX_tIwyGHNXgaB8wmeOv_mnM`",
  "- **THE_HYDRA_Ad_Strategy.pdf** (copywriting) — `1dLvEDqD2NesDpy2HMr6DqoLdXPT2Pcth`",
  "- **The_Slingshot_Ad_Strategy.pdf** (copywriting) — `1e06DoLXWLCoUbtvEZDROOR-R-Ax_GUyH`",
  "- **Venus_Fly_Trap_Ad_Strategy.pdf** (funnel) — `17Q3E-WRgxHQTU1ZbbdhKbKMF8P_MFECl`",
  "- **The_Forester_Ad_Strategy.pdf** (funnel) — `1eEDVundc7C2kk9hXTaz7VEOrTpv7TUlQ`",
  "- **_The_Harvester_Ad_Strategy.pdf** (funnel) — `130QO_5J8oR1ATsZb04nA-Vj0c45GFGdm`"
]);

/** The six strategies the last step-5 run checked (marketing/flywheel/partner/05-ad-strategy.md §1). */
export const NAMED_STRATEGIES = Object.freeze([
  "Venus Fly Trap 1.0", "Venus Fly Trap 2.0", "The Forester", "The Tornado", "The Harvester", "Hammer Them"
]);

/** The doctrine block every plan prompt gets. */
export const STRATEGY_DOCTRINE = [
  "WHAT THE REPO HOLDS OF THE AD STRATEGY DOCTRINE. These excerpts were written against the",
  "Jeremy Haynes ad system's strategy SOPs, read in full. Where a strategy's requirements are",
  "not written below, they are UNKNOWN here: say so, and do not fill them in from memory.",
  "The excerpts were written for the Ascension funnel (a $10,000 offer), so their \"we have\"",
  "lines describe that campaign on the day they were written, not the one you are planning.",
  "",
  `The named strategies: ${NAMED_STRATEGIES.join(", ")}.`,
  "",
  STRATEGY_PICK,
  "",
  HAMMER_THEM,
  "",
  "The full strategy SOPs (in Drive, not read by this step):",
  ...DRIVE_SOPS
].join("\n");
