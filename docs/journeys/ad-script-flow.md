# Ad script flow — the states a script moves through

Required by `CLAUDE.md` §3a step 4. Written 2026-09-06, before any code.

This page is the back end. The screen is a window onto it. If this page is right, the
screen can be rebuilt in an hour.

---

## The one thing that decides the schema

**Every state a script needs already exists in this database.** Three state machines are
already shipped, and a generated ad script passes through all three. Nothing here invents
a fourth.

| Machine | Column | Values | Where |
|---|---|---|---|
| The job that writes it | `generation_jobs.status` | `queued` · `running` · `succeeded` · `failed` | `045_creative_factory.sql:312` |
| The script itself | `creative_assets.compliance_state` | `pending` · `passed` · `blocked` · `approved` | `045_creative_factory.sql:201` |
| The finished ad on the platform | `ads.approval_state` | `draft` · `awaiting_approval` · `approved` · `live` · `paused` · `archived` | `046_ad_platforms.sql:311` |

A script is a `creative_assets` row with `kind = 'copy'`. That is already allowed:
`creative_assets_kind_ck` permits `static`, `video`, `copy`.

---

## The flow

```mermaid
flowchart TD
    A["Chris asks for 10 scripts in a lane"] --> B["generation_jobs row<br/>status = queued"]
    B -->|runner claims it| C["status = running"]
    C -->|model writes the scripts| D{"The checker<br/>scripts/ads/check-script.mjs"}
    D -->|banned phrase, wrong length,<br/>hook not cause-first| C
    D -->|passes| E["creative_assets row<br/>kind = copy<br/>compliance_state = pending"]
    E --> F{"The compliance screen<br/>src/compliance/screen.mjs<br/>12 rules"}
    F -->|a rule fires| G["compliance_state = blocked<br/>blocked_reasons filled<br/>THE ROW IS KEPT"]
    F -->|clean| H["compliance_state = passed"]
    G -->|Chris rewrites the line| E
    H -->|Chris reads it and keeps it| I["compliance_state = approved<br/>only a person can do this"]
    H -->|Chris cuts it| J["archived_at set<br/>the row is never deleted"]
    I -->|Chris rewrites a line first| K["the pair is added to<br/>docs/ads/VOICE.md"]
    K --> I
    I -->|Chris films it, Paul builds it in Meta| M["ads row<br/>asset_id points back at this script<br/>approval_state = draft"]
    M --> N["approval_state = live<br/>spend starts"]
    N -->|utm_content carries the ad id| O["client_ad_attribution<br/>joins the ad to a booked call"]
```

---

## Every transition, and what fires it

| From | To | What fires it | Who or what does it |
|---|---|---|---|
| — | `queued` | Chris asks for scripts | the skill |
| `queued` | `running` | the runner claims the job | `src/creative/runner.mjs` |
| `running` | rewrite loop | the checker finds a banned phrase, a bad length, or a hook that is not cause-first | `scripts/ads/check-script.mjs` |
| `running` | `succeeded` + a `creative_assets` row | the checker passes | `src/creative/generate.mjs` |
| `pending` | `blocked` | one of the twelve compliance rules matches | `src/compliance/screen.mjs`, inside `storeAsset` |
| `pending` | `passed` | no rule matches | same |
| `blocked` | `pending` | Chris rewrites the offending line | a person |
| `passed` | `approved` | Chris keeps it | **a person only.** Nothing in the generate path can approve |
| `passed` | archived | Chris cuts it | `api/creative/actions.mjs` |
| `approved` | filmed | Chris films it | **a person only.** Not recorded, and does not need to be |
| filmed | an `ads` row with `asset_id` set | Paul builds it in the ad account | outside this system. This row IS the proof it was filmed |

---

## The schema change, and it is one column plus one timestamp

**1. `copy_text` on `creative_assets`.** Nullable. Holds the words of a written ad.

Today the words are generated and thrown away: the table has `storage_key` for a file and
nothing for text, and nothing uploads a file for a copy asset anyway. So a written ad
exists for a moment and is gone. Every other state on this page is unreachable without it.

Written for blocked assets too, not only clean ones. A blocked script is the most useful
thing in the library, because it is the one Chris has to rewrite, and he cannot rewrite
what was not saved.

*Name chosen deliberately.* The redactor in `src/http/read-api.mjs` strips any field whose
name contains a forbidden substring, which is why `has_storage_key` is eaten today.
`copy_text` contains none of them.

**2. There is no second column. `filmed_at` was specced here and has been dropped.**

Chris's call, 2026-09-06: "seems a bit overengineering." He was right, and the code agrees.

`db/migrations/046_ad_platforms.sql:291` already carries `asset_id uuid REFERENCES
creative_assets(id) ON DELETE RESTRICT` on the `ads` table, with an index at line 318. So
the moment a script becomes an ad in the ad account, that row points straight back at the
script it came from.

**Which means "was it filmed" is already answerable and does not need recording.** A script
whose `creative_assets.id` appears as an `asset_id` on a live ad was filmed. That is the
proof, and it arrives on its own through the Meta sync. A hand-set `filmed_at` would be a
second, weaker copy of a fact the system already gets for free, and it would rot the first
week somebody forgot to tick it.

The transition table above keeps the filmed hop, because it is a real thing that happens.
It is just not a column.

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
