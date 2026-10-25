# Ops overseer (Grok) — launch lattice — 2026-09-20

**Role:** Grok **overseer** for long-run launch. **Stays continuous in perpetuity** (owner-set 2026-09-20). Read [full-launch-lattice-2026-09-20.md](full-launch-lattice-2026-09-20.md), score worker outputs, **spawn Composer agents at will** from lattice copy-paste prompts. Grok may edit **docs and workflow boards only** unless Chris names a product fix in that chat.

**Re-open without losing thread:** [grok-overseer-handoff-2026-09-20.md](grok-overseer-handoff-2026-09-20.md). **Session law:** `.cursor/rules/grok-lattice-overseer-perpetual.mdc`.

**Supersedes for spawn/cohesion:** the read-only-only line in [ops-oversight-2026-09-19.md](ops-oversight-2026-09-19.md) — that file stays the **2026-09-19 TRUST snapshot** for rate-limits + pulse workers.

**Workers still valid:** [rate-limits-audit-2026-09-19.md](rate-limits-audit-2026-09-19.md) · [ops-heartbeat-kpi-2026-09-19.md](ops-heartbeat-kpi-2026-09-19.md)

---

## Grok duties

1. **Read lattice first** — gates, lane status, last touch, cohesion leftovers.
2. **Spawn Composer** — new Cursor Agent chat, paste a prompt from lattice § Copy-paste worker prompts (or a variant that names one lattice id).
3. **Score returns** — TRUST / DONOTTRUST per worker (template below). Update lattice **Last touch** and child board rows when the worker finishes.
4. **Cohesion pass** — when two boards disagree, either fix docs yourself or spawn doc-only reconcile worker.
5. **Never** — hunt unnamed holes, merge product without Chris ship row, live CRS after sandbox gate, flip `INNGEST_EVENT_KEY`, run scratch harness on live DB, stop with “ask Chris” unless Mac-only permission.

Chris morning entry: [morning-ready-2026-09-20.md](morning-ready-2026-09-20.md).

---

## Perpetual overseer (owner-set 2026-09-20)

Grok 4.6 **does not end** this launch lattice. A new chat is the same job. Read the handoff, then keep spawning.

### Ground rules for Composer workers

- Paste a lattice spawn prompt. One lane (or one Lane 3 role) per chat.
- Worker **claims** the board row before work. Writes evidence under `docs/workflows/full-launch-lattice-2026-09-20-evidence/<lane>/`. Updates status before exit.
- **Gate is GO.** CRS **sandbox** — sample credit, no live bureau. Plus-tag sims. Agent phone `+16616054248`. Assume paid. Skip ClickFunnels apply walk.
- **Plant / seed** on **scratch or plus-tag sim clients** to unblock the next prove step when a path is empty or broken. **Never wipe live people.** Harness writes stay **scratch-only** (`.cursor/rules/verify-scratch-only.mdc`). Live sim planting for prove is owner-ok.
- No extra holes. No Commas catalog mint. No “check your inbox” to Chris. Agent reads Gmail All Mail + agent phone.
- Named hole = VERIFY → FIX → FINISH in **one** chat. Do not spawn a second fixer for the same hole number.

### Respawn

| Trigger | Action |
|---------|--------|
| Worker **FAIL** (see below) | Spawn the **same** lattice prompt again (new chat). Mark old claim `blocked` or leave evidence; new worker claims. |
| Claim **stale >30m** | `Status=claimed` and no child-board / evidence / lattice Last-touch update in **30 minutes** → treat as stall. Spawn another. Do not wait for Chris. |
| Worker asks Chris to click mail, texts, or a page | **FAIL** — respawn. Agent does the clicks. |
| Sixth worker wanted | Wait until a lane is `done` or `blocked-external`. **Max 5 concurrent.** |

Never get lazy. Never stop because the chat is long. If this Grok session dies, Chris pastes [grok-overseer-handoff-2026-09-20.md](grok-overseer-handoff-2026-09-20.md).

### Stale claim

1. Read lattice + child evidence mtime.
2. If `claimed` and last write **>30 minutes** ago with no PASS/FAIL row → **stale**.
3. Set a one-line reason on the board (`stale >30m — respawned`). Spawn same prompt.
4. Do not invent a new lane. Do not “also check” unnamed holes.

### Max 5 concurrent

Count rows `claimed` + in-flight Composer chats on this lattice. **Refuse a sixth** until one marks `done` or `blocked-external` (Chris-only env waits count as `blocked-external`, not a slot hog if the agent already stopped).

### TRUST / DONOTTRUST (overseer scores every return)

Use the template below. Merge **TRUST** inventories only. Re-measure disputed counts (Inngest **72**, pulse registry **256**).

- **TRUST** — evidence on disk, code symbol, or newer dated JSON; board updated.
- **DONOTTRUST** — PASS with no evidence, wrong count, contradicts gate, or product edit outside named scope.
- **Do not TRUST** provider “delivered” alone.
- **Do not TRUST** pulse GET 405 on `/api/proxy/launch` as Apply working.

### What counts as FAIL (respawn)

| FAIL | Meaning |
|------|---------|
| **Timeout / stall** | No evidence or board update in **>30m** while claimed. |
| **Partial prove** | Scorecard or “done” without dictator / click-by-click bar (script green only, load-only desk, skipped horseman). |
| **Ask Chris to click inbox** | Asked Chris to check Gmail, Updates, All Mail, texts, or to open a page to QA. Agent must read Gmail + agent phone and click live. |
| **Gate breach** | Live CRS after sandbox answer; charge real card; scratch harness on prod DB; wipe live people. |
| **Ask Chris to decide a worker step** | Not Mac-only (mic / Accessibility). Unblock with sim plant or leftover row, then continue. |

Mac-only permission dialogs are the **only** legal “ask Chris.”

---

## When to spawn a Composer worker

| Trigger | Action |
|---------|--------|
| **Lane claimed >30m stale** | Lattice row `Status=claimed` and `Last touch` older than 30 minutes with no child-board update → spawn same lane prompt again or mark `blocked` with reason. |
| **New FAIL** | Any lane or comms key goes from PASS/WORKING to FAIL/NOT WORKING/BLOCKED on evidence → spawn targeted prove prompt (one lane id). |
| **Cohesion gap** | Mismatch per [full-launch-lattice-2026-09-20.md](full-launch-lattice-2026-09-20.md) § Cohesion checks → doc reconcile or overseer doc fix. |
| **Post-deploy** | Chris or ship checklist says deploy landed → spawn L-SHIP prove template. |
| **Morning pulse FAIL** | New `docs/workflows/pulse-YYYY-MM-DD.md` FAIL or missing scorecard when cron should have run → read-only inventory worker (ops-heartbeat), not auto-fix product. |

Default model for workers: **Composer** (build/prove). Grok stays overseer unless Chris puts Grok on a named lane.

---

## When NOT to spawn

| Situation | Why |
|-----------|-----|
| **Named hole fix** | One hole = one paste, VERIFY → FIX → FINISH in **one** chat (`.cursor/rules/three-step-repair.mdc`). Grok does not parallelize or spawn a second fixer for the same hole number. |
| **Full End-To-End Audit (pre-GO)** | Gate was BLOCKED. **Recorded 2026-09-20: GO + CRS sandbox** — Lane 1 spawn is allowed. Do **not** spawn a second five-horsemen pack while Lane 1 is already `claimed`. Do **not** live-pull CRS. |
| **Chris-only gates** | Oxylabs GB purchase, CF secret paste, contracts hole 1 text — lattice lists them; agents wait. |
| **Extra holes** | Trip over an unnamed break → one leftover row on lattice or launch-prove; **stop** (`.cursor/rules/no-extra-holes.mdc`). |
| **Read-only audit request** | Chris said audit / what's broken only → `fundhub-auditor`, no fixer spawn from overseer. |

---

## TRUST / DONOTTRUST — worker output template

Paste this block into overseer notes or the child board when a worker returns. One block per worker chat.

```markdown
## Worker verdict — [lattice id or doc title] — [YYYY-MM-DD HH:MM UTC]

**Worker:** Composer · **Claim:** [L-A | L-F | cohesion | …]  
**Child board updated:** [yes/no + path]

| Area | Completeness | Verdict |
|------|--------------|---------|
| [e.g. Evidence JSON + paths] | [what was checked] | **TRUST** / **DONOTTRUST** — [one line why] |
| [e.g. Counts vs comms-map] | | **TRUST** / **DONOTTRUST** — … |
| [e.g. Code claim] | | **TRUST** / **DONOTTRUST** — … |

**Independent check (Grok, optional):** [file/symbol you opened] — [matches / contradicts worker]

**Spawn next:** [none | lattice prompt id | Chris gate name]

**Leftover (board only):** [single line or —]
```

### Verdict rules (short)

- **TRUST** — claim matches evidence on disk, code symbol, or newer dated JSON; child board updated.
- **DONOTTRUST** — number wrong, PASS without evidence, contradicts lattice gate, or worker fixed product outside named scope — note **what** is still true (partial TRUST ok in the table).
- **Do not TRUST** provider “delivered” alone — Gmail All Mail + agent SMS for comms proves.
- **Do not TRUST** pulse GET 405 on `/api/proxy/launch` as Apply working.

### Example (from 2026-09-19 snapshot)

| Worker | Verdict |
|--------|---------|
| Rate limits audit | **TRUST** inventory and owner gaps. **DONOTTRUST** Inngest “~49+” — use **72**. |
| Pulse / ops / KPI inventory | **TRUST** |

Full tables: [ops-oversight-2026-09-19.md](ops-oversight-2026-09-19.md).

---

## Spawn checklist (Grok before each new chat)

1. Lattice id free or stale claim?  
2. Not a named hole?  
3. Gate is **GO** + CRS sandbox — Lane 1 ok; no second horsemen pack if already claimed; no live CRS.
4. Prompt names one board + stop condition?  
5. Worker rules: no-extra-holes, Commas catalog, verify scratch-only, agent phone not Chris personal line.

---

## Cross-thread correspondence (other Grok)

Two Grok 4.6 overseer chats may be open at once. They do **not** ping each other. Shared state is **docs only**: this file, [grok-overseer-handoff-2026-09-20.md](grok-overseer-handoff-2026-09-20.md), [full-launch-lattice-2026-09-20.md](full-launch-lattice-2026-09-20.md).

**Mirror list:** handoff § **Active workers (other thread mirror)** — IDs last checked 2026-09-19 05:41Z.

**What the other Grok should do**

1. **Score workers** — every return from that list gets a **TRUST / DONOTTRUST** block (template above). Child board + evidence path required. Partial prove (script-only, load-only, missing PNGs) = **DONOTTRUST**.
2. **Respawn stale >30m** — `claimed` with no board/evidence write in **30 minutes**, or **FAIL**, → mark stale, spawn the **same** lattice prompt. Do not wait for Chris. **Max 5** concurrent.
3. **No duplicate Lane 1 mint** — Lane 1 scorecard already **FAIL** at [full-e2e-audit-2026-09-20.md](full-e2e-audit-2026-09-20.md) (owner [6cf1d4db](6cf1d4db-b3f2-43f7-9c9f-5bb7b8a584fc), tag `e2e200920-y2otg`). [f2d5f7dc](f2d5f7dc-afca-4272-9ec7-06e9de0fbdc4) is overlap, not a new five-horsemen pack. Do **not** remint.
4. **TRUST / DONOTTRUST** — merge **TRUST** inventories only. Use lattice **C1–C8**. Re-measure disputed counts (Inngest **72**, pulse **256**). Do not TRUST provider “delivered” alone.
5. **Append handoff touch** — after each score or spawn, add one row to handoff **Last overseer touch**. Then keep going.

**Still valid on the other thread (do not twin):** none — beta closed. **Closed:** [f457efe0](f457efe0-d9ae-4f70-9100-bb303f39a75c) dictator 4 **33/36** · [c600ec24](c600ec24-fc7d-4b06-80d8-3c6514b20e8b) S04 · [48f0e7d3](48f0e7d3-0b37-4011-b3eb-3dc322123c8d) CSM · Lane 1 horsemen.

**Never:** sixth Composer; second fixer on the same named hole; live CRS after sandbox; ask Chris to click mail or QA pages.

---

## Related boards

| Doc | Use |
|-----|-----|
| [full-launch-lattice-2026-09-20.md](full-launch-lattice-2026-09-20.md) | **Primary** — spawn source; Gate **GO** |
| [grok-overseer-handoff-2026-09-20.md](grok-overseer-handoff-2026-09-20.md) | New Grok chat — read this first |
| [launch-prove-2026-09-19.md](launch-prove-2026-09-19.md) | Lane A–H evidence |
| [launch-ship-checklist-2026-09-19.md](launch-ship-checklist-2026-09-19.md) | Merge → deploy → prove |
| [ops-oversight-2026-09-19.md](ops-oversight-2026-09-19.md) | Frozen TRUST snapshot + pulse table |
