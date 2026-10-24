# Page edits — marked draft first

**Owner law (2026-09-29):** When Chris asks to change a page, show him a marked draft first. He liked this on the `/roadmap` page: "I really like this way of editing the pages where you highlight and everything you did."

**Owner update (2026-10-19):** Keep the marked draft, but do not ask again when Chris has already authorized publication of this work. A ship/deploy/GO choice for the release carries across turns. See `owner-go-no-repeat-approval.md`.

**Owner update (2026-10-23):** Show the marked draft, but do not block on his answer once he has said push. Push, then prove the live page.

## How

1. **Never touch the live page first.** Build a draft copy with a script. The script reads the live file and does not change it.
2. **Round 1: red marks.** Put a red box around every bad line and number it. Under each one, write the problem and a suggested fix. Moved words stay word for word.
3. **Blue dashed boxes** show the new section order. Each box has a label that says what moved.
4. **Round 2: green marks.** When Chris says fix it, write the fixes into the draft. Every new or changed line is marked green. A button at the top hides the marks so he can read it clean.
5. **Share it as an Artifact link** he can open on his phone. Keep the same link every round.
6. **Every fact comes from the repo, the product, or Chris.** Look it up. Never invent a number, a name, a quote, or a feature.
7. **Push live only with Chris's authorization.** An existing ship/deploy/GO choice for this release is enough; do not ask again. Strip every mark first. Keep a copy of the old live page. Prove the live page after the push.

The working example is `marketing/landing-pages/slo/preview/reorg-draft-build.mjs`. It builds the red draft, the green draft, the share copy, and the clean live page from one script.

## Never

- Change the live page before Chris has seen the marked draft
- Make a change with no mark: every change is red in round 1 or green in round 2
- Rewrite moved words without marking them
- Leave a mark, banner, or draft label on the live page

## Example

```text
Ask: "Fix the copy on the roadmap page."

❌ Edit slo-01-sales.html and push it.
✅ Send the marked draft link: red boxes, the problem and a fix under each.
   He says fix it → the same link, fixes in green, with a button to hide the marks.
   He says push it → strip the marks, push, prove the live page.
```
