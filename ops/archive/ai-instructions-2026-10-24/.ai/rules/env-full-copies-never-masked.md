---
description: Local and cloud env must hold full secrets — never asterisk masks
alwaysApply: true
---

# Env full copies — never masked

**Owner law (2026-10-04):** Laptop `.env` and `credentials/` are the working copies for agents, Claude cloud paste, and scripts. **`****************` placeholders are forbidden.** They are not secrets; they break push, ship, SMS, webhooks, and cloud sessions.

## Always

- Keep **full** values in gitignored `.env` and refresh from Netlify when a line looks masked.
- Run **`node scripts/env-audit-masks.mjs`** to count mask placeholders.
- Run **`node scripts/env-refresh-local-from-netlify.mjs`** after putting full values into **`credentials/env.revealed`** (this works only for vars that were not set with `--secret`; Netlify API/CLI **cannot** unmask `--secret` vars — masks in `.env` are usually copy-paste from `netlify env:list`, not real keys).
- Regenerate **`credentials/cloud-env-for-claude.txt`** with that script before Chris pastes cloud env vars.
- Read **`credentials/README.md`** for file names (it exists on the Mac, looked up 2026-10-24; it is gitignored, so main cannot show it).

## Never

- Write or leave `****************` in `.env` “for safety”
- Paste cloud env from a block that still contains masks
- Use **`netlify env:set ... --secret`** for keys the laptop or cloud must read (see `secrets-env-law.mdc` banned table)

## When refresh cannot unmask

Report the **key names** still masked. Recover each from `credentials/env.full.snapshot` or an old backup. If neither has it, reset it at the vendor and set the new value yourself, without `--secret`. Never tell Chris to reveal it in Netlify. Do not guess.

## Example

```text
Ask: "Copy env for Claude cloud."

❌ Copy .env with BLAND_API_KEY=****************1369.
✅ node scripts/env-refresh-local-from-netlify.mjs → open credentials/cloud-env-for-claude.txt → pbcopy.
```
