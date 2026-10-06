# Ad script flow — the states a script moves through

Generated from code on 2026-10-05 (plan unit U11, migrations 413 and 414, `api/scripts/write.mjs`).
Yardstick: the approved marketing machine spec, `docs/specs/marketing-machine-2026-10-04.md`
§1 (flow) and §7.4 (data). The intended journey file for the machine is not on main yet, so
this page is checked against the spec, not against an `-intended.md`.

**What changed from the page that was here.** The 2026-09-06 page drew a script as a
`creative_assets` row with `kind = 'copy'`. That is not how the code keeps scripts. A script is
an **`ad_scripts` row** (migration 377), one row per version. Creative Factory copy assets
(`creative_assets`, `api/creative/generate.mjs`) still exist; they are pieces of ad copy, not the
script Chris films, and they are drawn in `ad-label-spine-flow.md` and
`marketing-dashboard-flow.md`.

Plain words used below:
- **Live** = not archived (`archived_at` is empty). Only one version of a script is live.
- **Root** = version 1 of a script. Every version of one script points at it (`root_script_id`).
- **Number** = our ad number (`ad_id`), the one that goes in `utm_content`.

---

## U11 M1 7.4 data: script states, versions, numbers

### The states

```mermaid
flowchart TD
    NEW["A new script is saved<br/>api/scripts/write.mjs:328<br/>(any old writer too)"] -->|"no status sent<br/>413 default"| D["draft<br/>source = chris<br/>its own root (trigger, 413:256)"]
    D -.->|"Chris approves; gets a number<br/>NOT BUILT YET (U25, next_ad_number 414:316)"| L["locked<br/>must have a number<br/>(413:283)"]
    D -.->|"Chris rejects<br/>NOT BUILT YET (U25)"| R["rejected"]
    D -.->|"machine draft not reviewed in time<br/>NOT BUILT YET (U35)"| X["expired"]
    L -.->|"a take is matched to it<br/>NOT BUILT YET (M3)"| F["filmed<br/>must have a number"]
    F -.->|"its video is rejected<br/>needs_retake = true<br/>NOT BUILT YET (M3)"| L

    D -->|"rewrite: POST /api/scripts/write<br/>with parent_script_id"| RW{{"one transaction<br/>write.mjs:221-365"}}
    L -->|"rewrite"| RW
    F -->|"rewrite"| RW
    RW -->|"1. old version archived<br/>write.mjs:306<br/>machine-written → superseded<br/>otherwise status kept"| S["superseded / archived<br/>words, labels and number kept"]
    RW -->|"2. new version inserted<br/>version + 1, same root, same number<br/>write.mjs:328"| NV{"was the old one<br/>locked or filmed?"}
    NV -->|yes| L
    NV -->|no| D
    S -->|"rewrite it again"| STALE["409 stale<br/>names the live version<br/>nothing written<br/>write.mjs:251"]
```

Solid arrows are what the code does today. Dashed arrows are moves the spec names
(§7.4 "How status moves") that **no code makes yet**. The database allows each of those
statuses; nothing in the database checks the order of the moves.

### Every transition, and what fires it

| From | To | What fires it | Where | Works today? |
|---|---|---|---|---|
| nothing | `draft`, source `chris`, its own root | any insert that does not name status, source or root (Creative Factory "Write a script and label it" card, `public/app/creative-factory.html:448` → `POST /api/scripts/write`) | defaults in `413`, root trigger `set_root_script_id` (`413:256`) | **UNVERIFIED** — proved in CI only after this branch's run; not live until ship |
| a live version | archived (`superseded` if the machine wrote it) + a new live version at version + 1, same root, same number | `POST /api/scripts/write` with `parent_script_id` | `api/scripts/write.mjs:221-365`, one `asStaff()` transaction | **UNVERIFIED** — same |
| an archived version | **409 stale** with the live version (`current: {id, version, body, parts}`); nothing written | rewriting a version somebody already replaced | `write.mjs:251` (read with `FOR UPDATE`), `write.mjs:312`, `write.mjs:394` | **UNVERIFIED** — same |
| a rewrite of a `locked` or `filmed` version | the new version is `locked` (keeps the number) | same | `write.mjs:319` | **UNVERIFIED** — same |
| `draft` | `locked` + a number | Chris approves | not built (U25 `POST marketing/scripts/approve`) | no |
| `draft` | `rejected` | Chris rejects | not built (U25) | no |
| `draft` | `expired` | a machine draft is not reviewed in `draft_expiry_days` | not built (U35) | no |
| `locked` | `filmed` | M3 matches a take | not built (M3) | no |
| `filmed` | `locked`, `needs_retake = true` | its video is rejected | not built (M3) | no |

### The rows that were already there (backfill, 413:175-214)

| Row before 413 | After | On production (measured 2026-10-05, read-only) |
|---|---|---|
| archived | `superseded` | 0 rows |
| live, has a number | `locked` | 7 rows: ads 84-90 |
| live, no number | `draft` | 1 row: `MKT-WALK 2026-09-17` |

Every one of them gets source `import` and root = version 1 of its chain (today each is its
own root). `updated_at` is not moved. Imported rows stay out of the Inbox, expiry and the
nightly check (spec §7.4).

### The rules the database holds

| Rule | Where |
|---|---|
| status is one of draft, locked, rejected, filmed, superseded, expired | `ad_scripts_status_ck` (413) |
| source is one of machine, chris, agent, import | `ad_scripts_source_ck` (413) |
| a locked or filmed script has a number | `ad_scripts_number_when_locked_ck` (413:283) |
| one live version per script | `ad_scripts_one_live_per_root_uq` (413:275) |
| a version number is used once per script | `ad_scripts_root_version_uq` (413:269) |
| every row has a root | `root_script_id NOT NULL` (413:265) + trigger (413:256) |
| one live script per number per company | `ad_scripts_live_ad_id_uq` (393, unchanged) |

### Where a number comes from

```mermaid
flowchart LR
    A["caller, in ONE<br/>READ COMMITTED transaction"] --> B["next_ad_number(org)<br/>414:316"]
    B --> C["waits for the company's lock<br/>pg_advisory_xact_lock, 414:339"]
    C --> D["1 + highest number in<br/>ads.fundhub_ad_number,<br/>ad_scripts.ad_id (archived too),<br/>ad_videos.ad_id"]
    D --> E["never below the floor:<br/>marketing_settings.ad_number_floor,<br/>91 when not set"]
    E --> F["caller writes the number<br/>on the script, same transaction<br/>NOT BUILT YET (U25 approve)"]
    F --> G["COMMIT frees the lock;<br/>the next caller sees it"]
```

Today (production, 2026-10-05) the answer would be **91**: the highest number anywhere is 90.
No code calls `next_ad_number` yet.

### The tables the machine writes next (414, no code writes them yet)

| Table | What one row is | Rule in the database |
|---|---|---|
| `marketing_batches` | one batch of scripts (weekly or Write now) | one weekly batch per company per ISO week (`marketing_batches_one_weekly_uq`); a weekly batch must say its week; a failed batch must say why |
| `ad_ideas` | one idea in the inbox (Chris's points, a planner idea, an accepted suggestion, or new first lines for a dying ad) | a new-first-lines idea must name its script |
| `voice_pairs` | one edit Chris made to a machine line: before and after | before and after must differ |

### Gaps against the spec (findings, not fixed here)

**Nothing else changes.** No new table, no new state value, no new enum. Both columns are
nullable, so every row that exists today stays valid.

---

## Teleprompter and editing apps — checked, and the answer is no integration

Chris asked whether this should talk to BigVu, CapCut, or another teleprompter app.

**Nothing in this repo mentions any of them**, and none is needed. CapCut has no public
developer interface to build against. Whether BigVu offers one was not verified and should
not be assumed.

**A teleprompter takes pasted text, so the integration is the format.** Look at
`docs/ads/CONTROLS.md` — Ad 1 is plain paragraphs, spoken as written, with no camera
directions mixed into the words. That already pastes into any teleprompter as-is.

**So the rule for the generator is a formatting rule, not a build:** the words Chris reads
to camera stay clean and unbroken, and everything that is not spoken — the runtime band,
the outfit and location note, the origin_angle tag — sits in its own block, clearly
separated, never inside the script body. That costs nothing and it is the whole of what an
integration would have bought.

## What this page does NOT cover

- **Images and video.** A `copy` asset needs no file. A `static` or `video` asset does, and
  nothing uploads one today. Out of scope, separate batch.
- **Cost per script.** Meta's ad id and Chris's ad number never meet, so cost cannot be
  attributed per ad. Named in `docs/ops/2026-09-06-self-analysis.md`, separate batch.
- **The 83 chat scripts.** They are not in the repo and are deliberately not the seed.
  `docs/ads/VOICE.md` is seeded from the five filmed and running ads only.

## U09 M1 7.1: Rules rebuilt and the checker's strict mode

Generated from code on 2026-10-05 (`scripts/ads/check-script.mjs`, `marketing/ads/rules-data.mjs`,
`marketing/ads/banned-live.json`). Spec section 7.1. This is the check step only; the states above
are unchanged.

```mermaid
flowchart TD
    A["Script text: teleprompter body<br/>CAPS, ↑, blank lines, '- ' cues"] --> B["checkScriptText(text, {format, style, strict, parts?, bannedLive?})"]
    B --> C["Every run: banned words, banned phrases, avoid list, opener,<br/>em dash, it's-not-X-it's-Y, never-say, vendor names,<br/>cause-first checks 2 and 3"]
    C --> D{"format"}
    D -->|"standard or sorting"| E["close check: no hard pull<br/>and nothing moves without their say-so"]
    D -->|"long, notes, greenscreen, vsl"| F["no close check, no floor"]
    D -->|"missing or unknown"| W["warning: no length or close check ran"]
    E --> G{"format and style<br/>(style defaults to the format_style default)"}
    G -->|"standard, words"| H["135 words or more"]
    G -->|"standard, bullets"| I["hook, line 2, reveal and CTA present<br/>3-8 cues, each 12 words or fewer<br/>(read from parts when sent, else from the text)"]
    G -->|"sorting, any style"| J["104-137 words"]
    F --> K{"strict: true?"}
    W --> K
    H --> K
    I --> K
    J --> K
    K -->|yes| L["PART0_PATTERNS (RULES.md Part 0)<br/>+ every phrase in banned-live.json, as plain text"]
    K -->|no| R
    L --> R["{ok, failures: [{rule, match, message, line}], warnings, words}"]
```

- `checkOneScript` and `npm run ads:check` keep the old lists. The one change: "optimize" is no
  longer banned (RULES.md Part 0 rule 1). Output on `marketing/ads/CONTROLS.md` is byte for byte the
  same as before.
- Judge rules ("round two", "carry", "man" and Part 0 rules 13-34) are not patterns. Spec 7.6 gives
  them to the writer's judge model.
- `banned-live.json` is read from beside the module, then from the working directory. If neither
  copy can be read, strict mode still runs and returns a warning that names the file.
- **UNVERIFIED: no caller yet.** Nothing in `src/`, `api/` or `netlify/` calls `checkScriptText`
  today. The writer (spec 7.6) and script edits (spec 7.8) are the planned callers.
- **Gap:** `npm run ads:check` has no strict flag, so a chat writer running it does not get Part 0's
  patterns. The spec names no CLI flag, so none was added.
---

## U10 M1 7.3: RECIPES.md, angles.json, Remotion animation catalog builder, animation-plan validator

Generated from the code on 2026-10-05 (branch `mm-u10-recipes-catalog`). These are the three
files the machine writer (spec §7.6, unit U24) reads, and the check its animation plan must pass.
Nothing calls any of it yet: the writer is not built. Every arrow into "the writer" is
**UNVERIFIED** until U24 lands.

```mermaid
flowchart TD
    subgraph KIT["marketing/broll/src (the Remotion kit, never run here)"]
        R["Root.tsx: RemotionRoot"] --> REG["templates/registry.tsx<br/>TEMPLATES (8)"]
        R --> MODS["CompanyLine, offer-cta, lenderMatching,<br/>ProofWall, ProofFlood, BankPockets, toolAnalogy (14)"]
        R --> TOOLS["ContactSheet, DepthKitDemo<br/>skipped: kit tools"]
    end
    KIT -->|"node marketing/broll/scripts/catalog.mjs<br/>reads the source text only"| B{"src/marketing/catalog.mjs<br/>buildCatalog"}
    B -->|"a value it cannot read"| STOP["CatalogReadError with file:line<br/>nothing is written"]
    B -->|"read"| CAT["marketing/broll/catalog.json<br/>22 entries: id, size, fps,<br/>min/max frames from each clamp,<br/>default_props, purpose, data_tied"]
    CAT -->|"catalog.test.mjs compares bytes"| SYNC{"same as a fresh build?"}
    SYNC -->|no| RED["test fails: run the script again"]
    AB["marketing/ads/ASSET-BANK.md<br/>§2 mechanisms, §3 enemy list, §4 audiences"] -->|"copied once, names exact"| ANG["marketing/ads/angles.json<br/>29 angles: key, name, notes, source"]
    APX["spec Appendix B"] -->|"word for word"| REC["marketing/ads/RECIPES.md"]
    CAT -.->|UNVERIFIED: U24| W["the writer"]
    ANG -.->|UNVERIFIED: U24| W
    REC -.->|UNVERIFIED: U24| W
    W -.->|"animation_plan [{anchor, template, props, seconds}]"| V{"src/marketing/animation-plan.mjs<br/>validateAnimationPlan"}
    V -->|"every rule holds"| OK["ok: true"]
    V -->|"a rule breaks"| ERR["ok: false, errors [{item, code, message}]"]
```

### What `validateAnimationPlan` refuses

| Code | When |
|---|---|
| `unknown_template` | the template is not in catalog.json |
| `seconds_out_of_range` / `bad_seconds` | seconds is outside min_frames / fps to max_frames / fps, or not a number |
| `unknown_props` | a props key that is not in the template's default_props |
| `data_tied_props` | any props key on QualifyToday, ProofWall, ProofFlood, ProofFloodWide, or a future LettersWritten* / ApprovalCarousel* / ProofFlood* |
| `anchor_not_in_body` / `bad_anchor` | words style: `{phrase}` is not the exact phrase in the body (capitals count, line breaks count as spaces, whole words) |
| `no_such_cue` / `keyword_not_in_cue` / `bad_anchor` | bullets style: `{cue, keyword}`, cue counts the `cue` parts from 1, the keyword must be whole words in that cue |
| `too_few` | standard under 2, sorting under 1, any other format under 1 |
| `unknown_format` / `unknown_style` / `not_a_list` / `not_an_object` / `bad_props` / `no_catalog` | the plan or its inputs have the wrong shape |

### Gaps between the spec and the code (findings, not fixed here)

- Spec §3 says the registry has 16 templates that run 2 to 3 s. The registry has 8. The other
  14 register from their own modules with their own clamps: 75-105, 75-120, 90-120 (ProofWall),
  105-135 (LenderMatchScroll) and 120-180 (ProofFlood) frames. The catalog reads each clamp.
- Spec §7.3 says the builder "transpiles registry.tsx with TypeScript". It reads the source text
  instead, because TypeScript and the kit's packages are not dependencies here.
- Spec §7.3 names LettersWritten and "the ApprovalCarousel family". Neither exists in the kit or
  in git history. They are tied by name prefix the day they are added.
- angles.json gets later additions through the repo outbox (spec §6 step 2, §7.3). That path is
  not built yet.
1. **Status moves are not guarded in the database.** Spec §7.4 lists how status moves; 413
   checks only the allowed words and "locked or filmed needs a number". Nothing stops, for
   example, `rejected` → `filmed`. The routes that make the moves (U25, U35, M3) must keep the
   order.
2. **The dashed moves have no code yet** (approve, reject, expire, filmed, retake).
3. **`scripts/ad-scripts-load-locked.mjs`** inserts numbered scripts without a status, so a
   re-run would land them as `draft`, not `locked`. All seven are already loaded, and it skips
   loaded numbers, so this only bites if it is ever pointed at an empty database.
4. **`api/scripts/list.mjs`** does not return status, root or number, so the Creative Factory
   picker cannot show them yet.
## U12 VOICE.md layout

- `marketing/ads/VOICE.md` now has a header, then `# Real pairs` (every real pair: an AI line next to Chris's own rewrite of it, from a chat or the app), then `# Seed pairs — model side written by hand` (the 9 hand-written seed pairs, unchanged, numbers 1-9).
- `# Real pairs` holds 0 pairs on this branch. The chat search for real pairs was blocked by the permission check, so the real count is not measured.
- U05's weekly append adds app-edit pairs at the end of `# Real pairs`, numbered from one more than the highest pair. UNVERIFIED here: that code is not on this branch.

## U25 M1 7.8 core script actions + 7.9 repo files + voice pairs on edit

Drawn from code on branch `mm-u25-script-actions`: `api/marketing/scripts.mjs`, `api/marketing/script.mjs`,
`api/marketing/scripts/{approve,edit,reject,order}.mjs`, `src/marketing/scripts-store.mjs`,
`src/marketing/script-file.mjs`, `src/marketing/voice.mjs`. Yardstick: spec §7.8, §7.9, §7.2, §7.4
"How status moves", §7.7 visibility, §4 traps 9, 17, 21. Shapes: `docs/specs/marketing-machine-api.md` §6.2.
Every arrow below is **UNVERIFIED on production**: proved in GitHub CI only, not live until a ship.

### Who sees a script

| Script | Listed (`GET marketing/scripts`) | Read or acted on by id |
|---|---|---|
| source `import` (the rows from before the machine, 413 backfill) | no | no, 404 |
| from a batch that is not released, or released with `release_at` still ahead | no | no, 404 |
| from a released batch whose `release_at` has passed | yes | yes |
| with no batch | yes | yes |
| another company's | no | no, 404 |

Rule: `VISIBLE_SQL`, `scripts-store.mjs:86`. The list shows live versions; `?status=superseded` shows the replaced ones.

### The moves this unit adds

```mermaid
flowchart TD
    D["draft"] -->|"Approve<br/>POST marketing/scripts/approve<br/>scripts-store.mjs:394"| L["locked<br/>ad_id = next_ad_number (91+), once<br/>locked_at, locked_by = staff id"]
    L -->|"Approve again"| L2["same number back<br/>nothing new queued"]
    D -->|"Reject<br/>POST marketing/scripts/reject<br/>scripts-store.mjs:583"| R["rejected<br/>rejected_by = staff id<br/>reason, or 'rejected from the app, no reason given'"]
    D -->|"Edit<br/>POST marketing/scripts/edit<br/>scripts-store.mjs:481"| E{{"one transaction"}}
    L -->|"Edit"| E
    F["filmed"] -->|"Edit"| E
    E -->|"1. old version archived, status superseded<br/>:524"| S["superseded"]
    E -->|"2. new version, version + 1, same root,<br/>same number, source chris :532"| NV{"old one locked<br/>or filmed?"}
    NV -->|yes| L
    NV -->|no| D
    E -->|"3. voice pairs for the machine lines<br/>Chris changed :564"| V[("voice_pairs")]
    R -.->|"Approve or Edit"| X["400 invalid id<br/>nothing written"]
    STALE["a version that is not the live one"] -->|"any write"| C["409 stale<br/>current = {version, body, parts}<br/>lockLiveScript :284"]
```

### What one save writes, in ONE staff transaction (withRequest)

```mermaid
flowchart LR
    P["POST approve / edit / reject<br/>request_id, id, version"] --> G{"owner or admin?<br/>(closer, csm: 403)"}
    G -->|yes| T["withRequest: lock request_id,<br/>replay a repeat"]
    T --> K["lock the version FOR UPDATE<br/>stale? 409"]
    K --> W["the database change"]
    W --> F["repo file queued<br/>repo_outbox mode replace<br/>marketing/ads/scripts/machine/&lt;week or on-demand&gt;/&lt;nn&gt;-&lt;slug&gt;.md<br/>path set once in repo_path, never moved"]
    W -->|"approve, lane has a rule"| RG["registry entry queued<br/>repo_outbox mode edit, op registry_add_ad<br/>registry: queued"]
    W -->|"approve, lane slo or none"| SK["registry: skipped<br/>plain registry_note, never blocks"]
    F --> A["answer saved in marketing_requests"]
    RG --> A
    SK --> A
    A --> CM["COMMIT"]
    CM --> WK["wakeWorker after the commit<br/>(the worker commits to GitHub)"]
```

A save that fails anywhere rolls back whole: no change, no outbox row, no saved answer
(proved in `src/http/marketing-scripts.pg.test.mjs`). `POST marketing/scripts/order` sets
`film_order` (first = 1) on the live version of each listed script in the same kind of
transaction; it writes no repo file and wakes nothing.

### The repo file (§7.9)

Front matter, flat values only: `ad, version, status, offer, funnel, format, style, angle, batch,
updated_by, updated_at`. Then the body, byte for byte as the database holds it. Then a marker
line and a fenced JSON block with `parts`, `animation_plan` and `meta_copy`
(`src/marketing/script-file.mjs`). `nn` is the script's place in its batch (version 1 rows, by
when they were made); a path another script already holds gets the first 8 characters of the
script's id added.

### Gaps against the spec and the design (findings, not fixed here)

1. **`flagged` has no column.** It is read from `check_results` (an explicit `flagged: true`, or
   any check with `passed: false`), and only for machine-written versions. A person's edit is never
   machine-flagged; its checker result is saved in `check_results.strict` and its warnings come
   back on the save. U24 owns the inner keys of `check_results`.
2. **`repo_commit` stays empty.** The outbox drain (U05) stamps `repo_outbox.committed_sha` but
   nothing copies it to `ad_scripts.repo_commit` yet.
3. **Editing a rejected or expired script is refused** (400 on `id`). The spec names no move out
   of those states. The contract's edit error table does not list this answer.
4. **Editing a filmed script** makes a locked new version (its new words must be filmed again),
   the same rule `api/scripts/write.mjs` already uses. The spec only names "editing a locked
   script keeps its number".
5. **Words changed with no parts sent:** the new version's parts are cleared (null = unknown) with
   a warning, rather than keeping parts that no longer match the words.
6. **The film order** changes only the listed scripts; scripts left out keep their old number.
7. **The design** (`command-center-design-2026-10-05.md`) asks for `slot_reason`, `cost_usd`, a
   `batch` object, `outbox_id` and `voice_pairs_saved`. The contract's fixed shape 3 wins; edit
   also answers `voice_pairs` (a count) as an allowed extra key.

## U26 Ideas, rules, Fix and Write now

Generated from the code on 2026-10-06 (branch `mm-u26-ideas-rules-retry`): `api/marketing/ideas.mjs`,
`api/marketing/rules.mjs`, `api/marketing/scripts/fix.mjs`, `api/marketing/batches.mjs`,
`api/marketing/batches/write-now.mjs`, `src/marketing/ideas-store.mjs`, `src/marketing/rules-store.mjs`.
Spec §7.8 (fix, ideas, batches, write-now, rules rows), §7.5 step 7, §8.1 tabs 4 and 5, §2 item 1.
Every route: owner and admin only (requireAuth, then requireRole `ROLE_SETS.MARKETING`), the company
from the session, every write in one `withRequest` staff transaction (a repeated request_id answers
the first save and writes nothing), the worker woken after COMMIT.

### An idea, from the box to a batch

```mermaid
flowchart TD
  P["POST marketing/ideas<br/>raw_points, source chris (default) or suggestion,<br/>format?, funnel?, angle?, write_now?"] --> V{"points there, source not machine,<br/>format known, funnel of this company?"}
  V -->|no| X["400 invalid, field named<br/>nothing saved"]
  V -->|yes| T["one staff transaction"]
  T --> I["ad_ideas row: status new, kind script,<br/>created_by = Chris"]
  I --> F["repo_outbox replace row:<br/>marketing/ads/ideas/YYYY-MM-DD-id8.md<br/>(Arizona day, flat front matter, the points word for word)"]
  F --> W{"write_now?"}
  W -->|no| A["200 {idea}"]
  W -->|yes| C{"costStatus: month or batch cap reached?"}
  C -->|yes| N["200 {idea, note}<br/>idea kept, nothing queued"]
  C -->|no| B["marketing_batches: on_command, planned, release_at now<br/>idea.batch_id = this batch<br/>job start_batch {batch_id, count 1, funnel_key, idea_ids}"]
  B --> AB["200 {idea, batch_id, job_id}"]
  A --> K["COMMIT, wake the worker"]
  N --> K
  AB --> K
  K -.->|"the worker drains the outbox"| G[("repo: the idea's file")]
  K -.->|"start_batch, plan unit U35"| U35["UNVERIFIED: start_batch has no handler yet<br/>the job waits in the queue"]
```

- Accepting a planner suggestion (spec §7.5 step 7) is the same POST with `source: 'suggestion'`
  and the suggestion's `angle_key`.
- `GET marketing/ideas?status=` lists the company's ideas, newest first (at most 200); `status`
  filters to new, writing, written, failed or dropped.

### Write now

```mermaid
flowchart TD
  P["POST marketing/batches/write-now<br/>count?, funnel_key?, idea_ids?"] --> V{"count 1-50, funnel of this company,<br/>ideas of this company?"}
  V -->|no| X["400 invalid, field named"]
  V -->|yes| S["settings (made with the defaults on first read)<br/>enabled is NOT read: Write now works with the schedule off"]
  S --> C{"costStatus: month cap, or this new batch's cap, reached?"}
  C -->|yes| R["400 cap_reached, plain sentence<br/>rolled back, nothing queued"]
  C -->|no| B["marketing_batches: on_command, planned, release_at now,<br/>week_key = ISO week in the settings time zone<br/>named ideas with no batch get this batch"]
  B --> J["job start_batch {batch_id, count (default scripts_per_day), funnel_key, idea_ids}"]
  J --> K["202 {queued, batch_id, job_id}; wake the worker"]
  H["GET marketing/batches"] --> L["newest 50 batches with counts {total, ready, flagged, failed}"]
  H --> RD{"JOB_KINDS has start_batch?"}
  RD -->|no| F["write_now_ready false: screens hide Write now"]
  RD -->|yes| TT["write_now_ready true"]
```

### Fix a script

```mermaid
flowchart TD
  P["POST marketing/scripts/fix<br/>id, version, note, make_rule"] --> V{"id, version, note (up to 4,000 characters),<br/>make_rule true or false?"}
  V -->|no| X["400 invalid, field named"]
  V -->|yes| T["one staff transaction"]
  T --> S{"script with that id in this company?"}
  S -->|no| NF["404 not_found"]
  S -->|yes| L{"it is the live version of its root,<br/>and version matches?"}
  L -->|no| ST["409 stale, current = live {version, body, parts}<br/>nothing queued"]
  L -->|yes| J["job fix_script {script_id, version, note}<br/>(the note exactly as typed)"]
  J --> M{"make_rule?"}
  M -->|yes| R["repo_outbox edit row: part0_add_rule, the note on one line<br/>(at most 1,000 characters)"]
  M -->|no| OK
  R --> OK["202 {queued, job_id}; wake the worker"]
  OK -.->|"fix_script, plan unit U24"| W["UNVERIFIED: fix_script has no handler yet<br/>the writer saves the new version when it lands"]
```

### Rules (Part 0 and banned phrases)

```mermaid
flowchart TD
  G["GET marketing/rules"] --> TK{"GITHUB_REPO_TOKEN set and unmasked?"}
  TK -->|yes| GH["getRef: main's commit, then RULES.md and banned-live.json<br/>at that one commit (8 s deadline)"]
  GH -->|"answered"| P0["source github, rules_sha = that commit"]
  GH -->|"refused, missing or late"| BU
  TK -->|no| BU["the copy built into the site<br/>source bundle, rules_sha = COMMIT_REF or null"]
  P0 --> OUT["part0 [{n, text}] (readPart0), banned [phrases],<br/>recent: the company's last 20 rule changes from repo_outbox"]
  BU --> OUT
  BU -->|"no copy either"| NA["503 rules_unavailable, plain sentence"]
  PO["POST marketing/rules<br/>action add | edit | ban, n?, text"] --> V{"action known, text there and short enough,<br/>edit names a rule Part 0 has<br/>(or one a waiting add will make)?"}
  V -->|no| X["400 invalid, field named"]
  V -->|yes| E["repo_outbox edit row in one staff transaction:<br/>add = part0_add_rule, edit = part0_edit_rule, ban = ban_phrase"]
  E --> OK["202 {queued, op_id}; wake the worker"]
  OK -.-> D["the outbox re-applies the op to the newest file and commits"]
  D -.-> RS["recent: waiting → committed (commit sha) or failed (reason on the row, tried again)"]
```

- `recent` state: `waiting` = not committed yet; `committed` = on main; `failed` = the last try was
  refused (the reason is on the outbox row and shows on the health card); the outbox keeps trying.
- A bundled copy can be older than main: outbox commits carry `[skip ci]` and do not rebuild the
  site. The answer says `source: 'bundle'` so the screen can say so.

### Gaps between the spec and this code (findings, not reconciled)

- **No intended journey on main.** `docs/journeys/marketing-machine-intended.md` is not on any
  branch; this section follows spec §1 and §7.8 as the yardstick (plan note).
- **The contract's example `angle_key: "two-files"`** has a dash. The database (414
  `ad_ideas_angle_ck`) and `angles.json` keys use underscores only, so the route refuses a dash.
- **Ideas held by a batch.** Write now stamps `ad_ideas.batch_id` on the ideas it names (only those
  with no batch yet), so the weekly planner does not write the same idea twice. The spec names the
  column, not this use.
- **`partner_id` on ad_ideas stays null.** The spec lists the column; nothing says which partner
  an idea from Chris belongs to.
- **UNVERIFIED in a real database on this Mac** (no Postgres here): proved by
  `src/http/marketing-ideas.pg.test.mjs`, `marketing-batches.pg.test.mjs` and
  `marketing-rules.pg.test.mjs` in GitHub CI.
