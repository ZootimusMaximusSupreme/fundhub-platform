# Curve optimization — what broke and what to film

Owner-set 2026-09-27. This is the human-in-the-loop playbook: Meta reports the curve, we label the break, Chris films the next take, the next sync scores it. Definitions come from Meta’s help and Marketing API — see `marketing/ads/watch-curve.md`. We do **not** invent a 3-second insights field; the closest opening hold we store is **2-second continuous plays** (`video_continuous_2_sec_watched_actions`).

## Meta definitions we diagnose against

From [About Video Ad Metrics](https://www.facebook.com/business/help/1792720544284355) (Ads Manager → Columns → Video engagement):

- **Video plays (starts):** the video starts to play for an impression; replays are excluded (same idea as Marketing API `video_play_actions`).
- **2-second continuous video play:** played for at least 2 continuous seconds (Marketing API: `video_continuous_2_sec_watched_actions`). Meta also lists **3-second video plays** in Ads Manager; that UI metric is **not** on our insights pull — do not treat a “3-second rate” as something we store.
- **[Video plays at 25%](https://www.facebook.com/business/help/279891745529019):** “The number of times your video was played at 25% of its length, **including plays that skipped to this point**.”
- Same pattern for 50%, 75%, 100% (Marketing API `video_p25_watched_actions`, etc.).
- **[15-second ThruPlays](https://www.facebook.com/business/help/471190536725647):** played to completion **or** for at least 15 seconds; for shorter videos, after at least **97%** of length. Replays on one impression do not count.
- **Second-by-second curve:** Marketing API `video_play_curve_actions` — percent of plays still watching at each second bucket (stored in `ad_metrics_daily.video_play_curve`).

**Play** means the video started. **25% / 50% / …** means they reached that fraction of length (including skip-ahead). **ThruPlay** is long watch or finish, not “time on screen while paused.”

## Where the curve can die (diagnosis → fix type)

Use quartile counts vs **plays** (starts), not vs impressions. NULL quartiles mean Meta did not report video metrics for that row.

### Opening (`diagnosis = opening`)

**What it means:** Most people who **started** the video never reach **25%**. Meta’s 25% metric is about reaching the quarter mark of the file — if that rate is bad, the first chunk of the timeline (roughly the first quarter of runtime, and always the first seconds people actually experience) failed.

**Fix types:**

| Fix | When | What Chris changes |
|-----|------|-------------------|
| **visual** | Scroll-stops before he speaks: blank frame, slow start, no face, weak pattern, unreadable or missing on-screen text in the first 2 continuous seconds | First frame, cut timing, overlay text, B-roll entry, caption placement |
| **words** | Picture works but the first line does not earn the next second | New hook line only; keep body and CTA |
| **both** | Weak frame **and** weak first line (common when p25/plays is very low) | New cold open: frame + first sentence together; body can stay |

**Do not** recut the ending first when p25/plays is the problem — that matches Meta’s quartile definition (failure before 25% of length).

**A short watch is not always a failure.** Some people leave the ad because it already did its job: they tap through to the page. If link clicks or landing-page views are at least as common as the people who reached 25%, that is a **hop**, not a broken opening. Do not recut that ad for watch time. The purchase is the score. A person can also watch the whole ad, or a whole VSL, and buy nothing. They spaced out. A long watch with no tap is the **ask**. A short watch with a tap is a hop. Neither one is a sale.

**Optional opening signal:** Compare **2-second continuous plays** to **plays**. If 2s/plays is already poor, the drop is in the first two seconds (visual + first syllables). If 2s is decent but 25% is poor, the hook sentence or pacing between ~2s and ~25% of runtime may be wrong (often still labeled **opening** for filming: tighten or replace the hook **words**, or cut dead air in that span).

### Middle (`diagnosis = middle`)

**What it means:** A healthy share reach **25%**, but **50%** (and often **75%**) stay weak — people got past the hook then left during proof, story, or mechanism.

**Fix types:**

| Fix | When | What Chris changes |
|-----|------|-------------------|
| **words** | Hook works; body drags, repeats, or loses clarity | Shorten or reorder body lines; one proof point; remove repeated claims |
| **visual** | Audio OK but frame is static, text walls, or B-roll mismatch mid-ad | New B-roll, on-screen proof, pattern interrupt mid-body |
| **both** | Body section feels like a different ad after a strong hook | Re-film the middle as one unit (visual + script from 25%→50% zone) |

Meta’s 50% definition is the same as 25%: reached half the video length, including skip-ahead.

### Ask (`diagnosis = ask`)

**What it means:** **ThruPlay** or high **75%/100%** quartiles relative to plays, but downstream results (landing page views, leads, clicks) stay weak — people watched but did not take the action. ThruPlay explicitly counts long watch or complete viewing, so this is “they stayed, then did not convert.”

**Fix types:**

| Fix | When | What Chris changes |
|-----|------|-------------------|
| **words** | Offer, price, urgency, or CTA line is muddy | Clearer last line, single CTA, roadmap/$297 framing |
| **visual** | CTA not on screen when he says it | End card, arrow, button overlay, text CTA |
| **both** | Watchers finish but the close feels like a different video | Re-film last 15 seconds (words + on-screen ask) |

If they never reach 50%, that is not an ask problem — stay in **opening** or **middle**.

## Simple rules (automation-friendly)

1. If `plays ≥ threshold` and `p25 / plays < 0.5` → **opening** (same threshold as `src/ops/watch-curve.mjs`).
2. Else if `p25 / plays` is OK but `p50 / p25 < 0.5` (and p25 is meaningful) → **middle**.
3. Else if watch depth is strong (e.g. `thruplay / plays` or `p75 / plays` high) but clicks/LPV weak → **ask**.
4. Store the chosen **fix_type** and a **film_note** (one or two sentences) in `ad_watch_curve_diagnoses` keyed to `ad_metrics_daily`.

Human review can override the rule; the table holds the decision Chris acts on.

## Andromeda (Meta retrieval) — what we claim

**Meta primary source:** [Meta Andromeda engineering post](https://engineering.fb.com/2024/12/02/production-engineering/meta-andromeda-advantage-automation-next-gen-personalized-ads-retrieval-engine/) (Dec 2024).

Meta says, in their own words:

- Retrieval is the **first** stage: select from **tens of millions** of ad candidates down to **a few thousand** before ranking and auction.
- **Advantage+** and **generative AI** are increasing the **volume of eligible ad creatives**; Andromeda uses a **hierarchical index** and larger retrieval models to handle that growth.
- Ads use **precomputed ad embeddings and features**; the system learns relationships between people’s interests and what is offered in the ad.
- Looking forward, they expect model changes to deliver **“a more diverse set of ad candidates.”**

Meta **does not** say in that post that “similar creatives are suppressed as noise” or that “tiny hook tweaks are useless.” Do not treat third-party blog posts as law.

**Practical filming implication (grounded in Meta + volume, not vibes):** retrieval must pick your ad from a huge pool. Internal Fundhub script notes (Drive: `FundHub-Ad-Scripts-Batch-1`) talk about an “Andromeda era” with **many distinct creatives per week** — that is **our** operating note, not Meta’s metric definition. Favor **clearly different openings and angles** when a take dies at 25%, not imperceptible variants of the same first frame.

**Third-party Drive doc (not Meta):** `Ad Scaling Framework.docx` mentions troubleshooting when “issues relating to the algo update Meta Andromeda” show up while scaling — treat as operator SOP, not definition of quartiles.

## Measured example — campaign oPur TOF-SLO $297 (2026-09-26)

Meta-reported counts for that day:

| Ad | Plays | Reached 25% | Reached 50% | Spend | Landing page views | p25/plays |
|----|------:|------------:|------------:|------:|-------------------:|----------:|
| SLO1 | 281 | 92 | 30 | $23.65 | 36 | 33% |
| SLO2 | 73 | 6 | — | $10.81 | 3 | 8% |
| SLO3 | 506 | 48 | 16 | $22.95 | 25 | 9% |
| SLO4 | 339 | 22 | 12 | $39.20 | 17 | 6% |

SLO2–SLO4 are **opening** failures by the p25/plays rule. SLO1 is still below half at 25% — **opening** priority (new hook / cold open) before polishing the close. Compare the next take’s row in `ad_metrics_daily` and set `next_take_improved` on the diagnosis row when a later curve exists.

## Where this is stored

- Raw curve counts: `ad_metrics_daily` (FK target).
- Human diagnosis + film note + later outcome: `ad_watch_curve_diagnoses` (migration `395_ad_watch_curve_diagnosis.sql`).
