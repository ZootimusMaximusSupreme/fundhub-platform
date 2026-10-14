# Bank outreach — fewest tools (research 2026-10-14)

Goal from Chris: the fewest tools that still run the whole bank outreach on autopilot. LinkedIn and email go out on their own, AI answers replies, and a call happens only when a banker asks.

Prices are from official pricing pages unless marked "third-party". Anything not confirmed is marked "not verified".

## Recommended stack: 3 vendors

| Job | Tool | Cost |
|---|---|---|
| Bank list | FDIC + NCUA files | Free |
| Find bankers, emails, LinkedIn links | Apollo.io | $49–$79 a month per seat (third-party) |
| Email + LinkedIn sequences, one inbox | Salesforge Growth | $80 a month flat: unlimited LinkedIn senders and mailboxes, 50,000 emails a month, warmup included |
| Sending mailboxes | Mailforge (Salesforge's own) | $3 a mailbox, 15 mailboxes on 5 domains ≈ $51 a month with domains |
| AI that answers replies | Our own agent on the Claude API (Haiku 5.5) | under $1 a month for ~500 replies |
| **Total** | | **about $180–$210 a month** |

What it replaces: the Brave search, the separate AI cleanup step, a separate LinkedIn tool, a separate email tool and Google mailboxes.

How it runs:
1. Load bank domains from the FDIC and NCUA lists into Apollo People Search with job title + state filters. Searching costs 0 credits.
2. Pull email + LinkedIn link only for the people we keep: 1 credit each, nothing charged when no email is found.
3. Push them into Salesforge sequences (email from 15 Mailforge mailboxes, LinkedIn from 2 team accounts).
4. Replies come to our CRM. Our Claude agent answers, asks for the bank's data points, saves them, and books a call only when the banker asks.

## Check before paying

- **Salesforge:** confirm in writing that (a) webhooks send LinkedIn and email replies out to our system, (b) the API can send a reply on both channels, (c) LinkedIn runs in the cloud. Webhooks appear only in Salesforge's own site summary, not its pricing page (not verified). Mailforge uses shared IPs.
- **Apollo:** its pricing page says API access is for Custom plans, but its rate-limit docs list Basic, Professional and Organization (not verified). If the API is Custom-only, use the web app export (up to 10,000 leads per export) for the build. Coverage of small credit unions is not verified: test one state on the free plan first.
- **Apollo credits:** Basic ≈ 30,000 a year, Professional ≈ 48,000 a year; extra credits ≈ $0.20 each (third-party).

## Backup stack if Salesforge fails the check: 4 vendors

| Job | Tool | Cost |
|---|---|---|
| Find bankers | Apollo.io | $49–$79 a month |
| Email + mailboxes | Instantly Hypergrowth + done-for-you Google mailboxes | ≈ $178 a month (15 mailboxes) |
| LinkedIn | HeyReach Growth, 2 senders | $158 a month |
| AI replies | Our Claude agent | under $1 a month |
| **Total** | | **about $385–$415 a month** |

All of these have published APIs and webhooks. HeyReach plugs into Instantly directly.

## Why not one all-in-one tool

- **Reply.io** comes closest by itself: automated LinkedIn, email with warmup, and an AI agent ("Jason") that sends replies and books meetings. But Jason costs $500–$1,000 a month on annual billing, only 50 data credits a month are included, and LinkedIn replies by the AI are not verified. About $700–$1,200 a month in all.
- **Salesforge's AI agent (Frank)** costs $499–$599 a month. Our own agent does the same job for under $1 a month.
- **Lemlist:** AI only drafts replies, and its LinkedIn runs through a Chrome browser session.
- **Apollo:** LinkedIn steps are manual tasks, so it is the data source only.
- **Instantly / Smartlead / HeyReach:** each covers one channel.
- **Waalaxy, Expandi, La Growth Machine:** no AI replies and no contact database.
- **People Data Labs, Clay, ZoomInfo:** cost 5–20 times more than Apollo for the same contacts.

## Sending rules to keep

- Never send cold email from fundhub.ai. Use 5 lookalike domains, 3 mailboxes each, about 25–30 sends per mailbox per day after 2–3 weeks of warmup.
- SPF, DKIM and DMARC on every sending domain.
- CAN-SPAM: a real postal address and a working opt-out in every email; honor opt-outs within 10 business days.
- LinkedIn: about 100–200 requests a week per account. Team accounts only, never Chris's own profile.

## Sources

- https://www.salesforge.ai/pricing · https://www.salesforge.ai/agent-frank · https://www.salesforge.ai/llms.txt · https://www.mailforge.ai/pricing
- https://www.apollo.io/pricing · https://docs.apollo.io/reference/people-api-search · https://docs.apollo.io/reference/people-enrichment.md · https://docs.apollo.io/docs/rate-limits · https://docket.io/resources/research/apollo-pricing (third-party)
- https://instantly.ai/pricing · https://help.instantly.ai/en/articles/11774076-ai-reply-agent · https://help.instantly.ai/en/articles/6261906-webhooks
- https://www.heyreach.io/pricing · https://instantly.ai/integration/heyreach
- https://reply.io/pricing/ · https://reply.io/jason-ai/
- https://www.lemlist.com/pricing · https://help.lemlist.com/en/articles/15382535
- https://knowledge.apollo.io/hc/en-us/articles/5646233248269
- https://brave.com/search/api/
- https://www.peopledatalabs.com/pricing · https://www.clay.com/pricing
- https://platform.claude.com/docs/en/about-claude/pricing
- https://support.google.com/mail/answer/81126 · https://www.law.cornell.edu/uscode/text/15/7704
