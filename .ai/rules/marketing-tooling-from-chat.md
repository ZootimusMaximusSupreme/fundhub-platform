---
description: Ad, script, and VSL work runs from chat with a skill and rules pack, never a scheduled job.
alwaysApply: true
---

# Marketing tooling runs from chat, not from a scheduled job

**Owner rule, 2026-09-06.** Chris drives ad, script and VSL generation from a Claude chat and that is fine. The bottleneck was never the trigger. It is that a chat session has nothing good to read.

**Both, for now (owner-set 2026-10-24):** ad scripts and video work run from chat with the skills today. The Command Center dashboard is the goal: judge every marketing build by whether it moves the work there. Neither is a scheduled job.

So build marketing tooling as a **skill plus a rules pack in the repo**, never as a GitHub Action, a cron, or a headless job. Do not propose adding a schedule trigger, a repository secret, or an SDK for this. Three reasons it would be wasted work: GitHub Actions here has no `schedule:` trigger, holds `contents: read` only, and gets no model key; Netlify and Inngest run inside a serverless function with no git checkout, so neither can save a file or open a pull request; and none of that is what slows the work down.

What actually makes generated scripts good is what the generator is allowed to read. Point it at the rules, the lane definitions and real examples of Chris's finished scripts. A rule that only exists in a chat, in a session log under `ops/workflows/`, or in an untracked skill on the laptop is a rule the generator cannot obey.

Enforce style and compliance with a checker that runs before Chris sees the output. A regex cannot lie about having run; an agent can. `.claude/workflows/copy.js` is the pattern to copy.

**Ads are identified by id, not by name (owner-set 2026-09-06).** `utm_content` is leading digits with an OPTIONAL `-slug`; `fundhub_ad_id()` in `db/migrations/286_client_ad_attribution.sql` ignores the slug entirely, and `utm_content=43` resolves correctly with no name at all. Meta's own API keys on its ad id too. So never make naming a blocker, never ask Chris to name ads before something else can proceed, and never call an untitled ad a defect. A title makes a report readable and nothing else.
