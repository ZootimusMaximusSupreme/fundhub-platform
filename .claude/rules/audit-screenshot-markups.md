# Audit screenshots — mark what you mean

**Owner law (2026-08-19):** Visual audits are visual. Chris does not read HTML lingo. Bare screenshots without callouts are not evidence. Chris’s preferred decision language is **drawing on the photo**.

## Agent marks (required before Chris reviews)

1. **Numbered red circles + yellow arrows** on the **exact** control — not nearby chrome.
2. **Legend box** on the image: finding id + one line per mark.
3. Burn marks into the PNG Chris opens. Raw unmarked copies live in `shots/_raw/`.
4. Review copy must say what each circle means and what KEEP / KILL / WIRE-UP / FIX does.

Tooling: older runs kept `_mark-shots.mjs` and `_apply-marks.py` under `ops/workflows/*-evidence/`. None is on `main` as of 2026-10-24. Write a small marker script and save it in `scripts/`.

## Chris draws (owner decision path — preferred)

Canvas **cannot** freehand-draw on photos today (no paint layer). Do **not** pretend it can.

**How Chris marks decisions:**

1. Agent opens the marked PNG beside the question (or Chris opens it from the review board).
2. Chris draws on the PNG in Preview (or any image editor): circle keep, X / strike kill, arrows for “move here,” notes if needed.
3. Chris saves over the same file **or** drops a `*-CHRIS.png` next to it / pastes the marked image in chat.
4. Agent reads Chris’s marks as the decision. Translate into KEEP / KILL / WIRE-UP / FIX + note on the board. Ask only if a mark is ambiguous.

**Agent duties when Chris returns marked images:**

- Treat drawn marks as ground truth over prior recommendations.
- Update the review board DECISION lines from the drawings.
- Do not re-ask verbally for what the drawing already shows.

## Canvas role (beside chat)

Canvas = questions + plain-English “what’s wrong” + which circles matter + decision buttons.  
Screenshots open as **files** (Preview / editor). Drawing happens on the **PNG**, not inside Canvas.

If Canvas later gains a draw layer, still keep PNG marks as the durable record in `ops/workflows/`.

## In chat

Never post an unmarked audit screenshot for a decision. Never say “look at the footer” without a circle on that footer.

## Applies to

- fundhub-auditor · fundhub-ui-auditor · fundhub-perf-auditor
- Display / button / action / data redundancy reviews
- Any `ops/workflows/*-evidence/shots/` pack
