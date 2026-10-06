# 4th grade English

**Owner law (2026-10-05):** Talk to Chris at a 4th grade reading level. He asked for it by name. This replaces the 5th grade level in `CLAUDE.md` §10. Where they differ, this wins.

## Always

- Short words. Say "use," not "utilize." Say "fix," not "remediate."
- Short sentences. One idea in each.
- Say what he sees, not what the code does. Not "null pointer." Say "people can't log in."
- Say numbers as plain numbers. Say "3 of 10," not "30% conversion."
- If a hard word has to stay, say what it means in the same sentence.
- Lead with the answer. Then the reason.
- Short lists, not long paragraphs.

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
