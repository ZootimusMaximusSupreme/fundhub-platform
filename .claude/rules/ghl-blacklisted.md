# GoHighLevel / GHL — blacklisted

**Owner law (2026-09-19):** Fundhub does **not** use GoHighLevel (GHL). That vendor is out of scope for this company.

## Never

- Add GHL / GoHighLevel API keys, env vars, adapters, relay modules, or routes
- Document GHL as the CRM, a dependency, or a punchlist win
- Tell Chris to open GoHighLevel or wire Fundhub to LeadConnector / msgsndr / gohighlevel.com

## Always

- Fundhub CRM is **fundhub.ai** (this repo). Twilio, Resend, Mailgun, etc. are the live comms providers.
- If old rows or columns still carry legacy provider strings from before cutover, treat them as dead data — do not revive the vendor integration.
