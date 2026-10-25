# Chris never logs in — API only

**Owner law (2026-09-24):** We do not use logins. API only, no logins.

## Law

Chris never logs into Submagic, ClickFunnels, or any other tool an agent can run by API.

Agents use the API. A browser login is not the path.

Same pattern as ClickFunnels: Chris never logs in. Agents use the API.

## Never

- Tell Chris to open a login page, paste a password, or click around an admin site
- Switch to a browser login when the API refuses
- Print API keys, passwords, or `.env` values in chat or commits

## Always

- Run the tool through its API
- If the API refuses (for example no credits), say the API error in plain words
- Read keys from gitignored `.env` or host env. Do not ask him to paste them

## Example

```text
Ask: "Caption this ad in Submagic."

❌ "Log into Submagic and upload the file."
❌ API says no credits, so open the Submagic site and click around.
✅ Call the Submagic API. If it refuses, say that error in plain words and stop.
```
