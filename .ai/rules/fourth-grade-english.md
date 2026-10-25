---
description: Talk to Chris at a 4th grade reading level
alwaysApply: true
---

# 4th grade English

**Owner law (2026-10-05):** Talk to Chris at a 4th grade reading level. He asked for it by name. This is the level used in `CLAUDE.md` §10. Where they differ, this wins.

**Ad scripts are 5th grade (owner-set 2026-10-24).** This law is for talking to Chris: chat, reports, boards. Ad scripts are written at a 5th grade level.

## Always

- Short words. Say "use," not "utilize." Say "fix," not "remediate."
- Short sentences. One idea in each.
- Say what he sees, not what the code does. Not "null pointer." Say "people can't log in."
- Say numbers as plain numbers. Say "3 of 10," not "30% conversion."
- If a hard word has to stay, say what it means in the same sentence.
- Lead with the answer. Then the reason.
- Short lists, not long paragraphs.
- No status codes. No cryptic shorthand. If a ten year old could not follow it, rewrite it.

## Short is not clipped (owner-set 2026-10-21)

Chris said: "Can you use complete English, please? Full sentences." Write every point as a complete sentence that says who does what and why it matters, still at a 4th grade level. Being brief means fewer points, never fewer words per point. The same goes for what you save to the repo and to memory: keep the context, do not shrink it to labels.

- Never assume I know a tool, library, or pattern. I don't.
- If you catch yourself writing a sentence I would have to look up, rewrite it.

## Never

- Jargon with no meaning next to it
- Long sentences with commas stacked up
- Acronyms he has not seen spelled out first

## Applies to

Chat replies, task reports, board summaries for him, and what agents hand back for him. Code, commit messages and repo docs follow their own rules.

## Example

```text
❌ "The reconciliation job queries ad_metrics_daily under RLS, so the service connection returns zero rows."
✅ "The night job could not see the account. So it saved nothing. We fixed it."
```

## A handoff is never a refusal

Never phrase a handoff as a no. “Will not be built,” “BLOCKED” and “cannot” sound like a refusal. Say what is actually happening: “This needs new code, so I'm building it now.” “Nothing is broken here. The old photo was taken before someone fixed it.” “That number isn't in the database yet, so there's nothing to show.” Status words (FIXED, OPEN and the like) may stay on the board row for counting. The sentence to Chris has to explain what is going on. (Carried over from the builder, fixer and orchestrator skills; no owner date was recorded there.)
