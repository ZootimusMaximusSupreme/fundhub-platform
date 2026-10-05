# fhconsulting.online → Netlify (owner-set 2026-09-28, offer aligned 2026-10-05)

**Site:** `transcendent-wisp-888771` (same deploy as `fundhub.ai`).

**What the site sells:** marketing consulting for agencies. AI tools, offer tools, and marketing systems. No posted dollar amounts. The fee is on the proposal and at checkout.

**Netlify:** Domain aliases `fhconsulting.online` and `www.fhconsulting.online` on the site.

**Live pages:** `public/consulting/` — home, Terms, Privacy, Refund.

**Host fence:** `netlify/edge-functions/fhconsulting-host.js`. On this host only, `/` goes to `/consulting/`. Other Fundhub paths on this host go to the consulting home. `www` goes to the apex.

## DNS (GoDaddy — zone `fhconsulting.online`)

Registrar nameservers: `NS39.DOMAINCONTROL.COM`, `NS40.DOMAINCONTROL.COM`.

| Type  | Name | Value                                   |
|-------|------|-----------------------------------------|
| A     | @    | `75.2.60.5`                             |
| CNAME | www  | `transcendent-wisp-888771.netlify.app`  |

Remove any other **A** or **AAAA** records on `@`. Netlify’s load balancer is IPv4-only.

Until those records replace the GoDaddy parking addresses, `https://fhconsulting.online/` is not this site.

After DNS propagates, Netlify provisions HTTPS (can take up to 24 hours).

**Prove:** `https://fhconsulting.online/` redirects to `/consulting/`, title “FH Consulting | Marketing consulting for agencies”, `server: Netlify`.

**Also works:** `https://fundhub.ai/consulting/` (same files).
