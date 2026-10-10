# ClickFunnels funnel push: the three stops, and how an agent clears each one

**Who runs this:** an agent, by API. Chris never logs into ClickFunnels
(`.claude/rules/chris-never-clickfunnels.md`). He is asked only for the owner calls named below.

**Status: documented, not tried.** Nothing here has been run against the live ClickFunnels workspace.
Every call below is read from the ClickFunnels API docs on 2026-10-09 (pages named in each step). The
first live push of the `blueprint` funnel is the first real test. Do not treat any step as proven until
it has been run and its answer written back into
`docs/journeys/marketing-dashboard-flow.md` (the X4F "Gaps" list).

**API ground truth:** https://developers.myclickfunnels.com/ (index: `llms.txt`). Base URL
`https://{subdomain}.myclickfunnels.com/api/v2`, Bearer key `CLICKFUNNELS_API_KEY` (env name only; the
value lives in gitignored `.env`). Never invent an endpoint. If a call here answers differently, stop and
read the docs page again.

## What the push does, in one breath

`src/marketing/funnel-push.mjs` makes one ClickFunnels funnel on `apply.fundhub.ai` (named
`Fundhub <tag> <funnel row id>`), makes three custom HTML pages as steps in it (thank-you, booking,
landing last), moves the page the first push made on its own into the funnel, reads the steps back, and
proves each page live. It never deletes anything and it never changes a funnel or page it did not make.
When ClickFunnels answers something it did not expect, it **stops with the funnel left a draft**. These
are the three stops that have no way out from inside the app.

## Stop A. The funnel was made without the apply.fundhub.ai domain

**What you see.** The push job fails with "ClickFunnels made the funnel for /blueprint without the
apply.fundhub.ai domain. The funnel was not made live, and no pages were made." Every Retry finds the
funnel by its name and stops again with "The ClickFunnels funnel made for /blueprint is not on
apply.fundhub.ai".

**Why the app cannot clear it.** The provider never changes a funnel it already made.

**Steps (agent, by API).**

1. Find the funnel. `GET /workspaces/{workspace_id}/funnels` (List Funnels). Pick the row whose `name` is
   `Fundhub fnl-blueprint <funnel row id>` and is not archived. Note its `id` and `domain_id`.
2. Find the domain. `GET /workspaces/{workspace_id}/domains` (List Domains). Note the `id` of
   `apply.fundhub.ai` (673591 when read on 2026-10-06).
3. Put the funnel on the domain. `PUT /funnels/{id}` (Update Funnel; `PATCH` also works) with
   `{"funnel":{"domain_id": <that id>}}`. The docs list `domain_id` as a changeable field. They also say
   domain changes may keep propagating after the answer returns, so read the funnel again
   (`GET /funnels/{id}`) until `domain_id` matches before going on.
4. Retry the job: `POST /api/marketing/jobs/retry` with the failed job's id (staff session). The Retry
   finds the funnel by name, sees the right domain, and goes on.

**If the PUT is refused (422).** Stop. Do not make a second funnel by hand. The fallback is an **owner
call**: archive the empty funnel (`POST /funnels/{id}/archive`, Archive a Funnel; the docs say the funnel's
path is changed to a disambiguated one, and restoring does not bring the old path back), then Retry makes a
fresh one. Ask Chris first.

## Stop B. The steps come back in the wrong order

**What you see.** The job fails at "The ClickFunnels funnel for /blueprint does not hold its three pages in
order (landing, booking, thank-you): it holds pages A, B, C, not X, Y, Z. The funnel was not made live."
Nothing was proved yet. The app has no call that reorders steps.

**Steps (agent, by API).**

1. Read the order. `GET /funnels/{id}/structure` (Fetch Funnel Structure). Read `steps` in array order (the
   docs say `sort_order` repeats across branches, so follow the array, not the number). Note each step's
   `page.id`.
2. Read the three page ids this funnel saved: `marketing_funnel_pages.cf_page_id` for the roles landing,
   booking, thank_you (SELECT only).
3. If the funnel holds any page that is not one of those three, **stop and tell Chris**. Do not move a page
   that is not ours.
4. Put our three in order, one `PUT /pages/{cf_page_id}` (Update Page) each, in this order:
   landing `{"page":{"sort_order":0}}`, booking `{"page":{"sort_order":1}}`, thank_you
   `{"page":{"sort_order":2}}`. The docs say `sort_order` is the zero-based position within the funnel, the
   page must belong to exactly one funnel step, and an out-of-bounds number is a 422.
5. Read it back. `GET /funnels/{id}/structure` must show the three page ids in the order landing, booking,
   thank_you.
6. Retry the job (`POST /api/marketing/jobs/retry`).

## Stop C. A step at the old standalone page's path is refused

**Background.** The first push (X4, 2026-10-06) made one page on its own: ClickFunnels page 25568231, at
`/blueprint-thank-you` on the workspace subdomain. Its row keeps that id for good (migration 425). The new
push makes a step page in the funnel at the same path and moves page 25568231 onto it.

**What you see.** The job fails when it makes the step for `/blueprint-thank-you`: either ClickFunnels
answers 422 ("ClickFunnels refused it") or it puts the step at another address ("ClickFunnels put the step
for /blueprint-thank-you at ..., not at ..."). The funnel stays a draft.

**Steps (agent, by API).**

1. Look. `GET /pages/25568231` (Fetch Page). Confirm it is ours (the id is `cf_page_id` on the blueprint
   `thank_you` row), that it is in no funnel, and note its `current_path` and `url`.
2. Move it aside, the same way the 2026-10-01 funnel split moved old step paths
   (`docs/sops/clickfunnels-custom-html-push.md`): `PUT /pages/25568231` with
   `{"page":{"current_path":"/blueprint-thank-you-standalone"}}`. The docs list `current_path` as changeable
   on custom HTML pages.
3. Read it back (`GET /pages/25568231`): `current_path` is the new one.
4. Retry the job (`POST /api/marketing/jobs/retry`). The push now finds `/blueprint-thank-you` free, makes
   the step page there, and moves page 25568231 onto it.
5. After it goes live, `GET /pages/25568231` again and write down which `current_path` the moved page ended
   up with. That answer is not in the docs.

**If any of this is refused.** Stop. Never delete page 25568231 or the step page left behind. Deleting is
an owner call.

## Watching the first live push of the blueprint funnel

An agent watches. Chris says go (the owner's confirm). The Push live button is off for `blueprint` because a
page is already on ClickFunnels, so the push starts from the route: `POST /api/marketing/funnels/push-live`
with `request_id`, the funnel `id` and `confirm_url` = `https://apply.fundhub.ai/blueprint`.

1. **Before.** SELECT the funnel and its pages: status `draft`, three built pages. Read ClickFunnels
   (GET only): `/blueprint`, `/blueprint-book`, `/blueprint-thank-you` and `/fnl-blueprint` are not used by
   anything this machine did not make, and the domain list holds apply.fundhub.ai.
2. **During.** Poll the job (`GET /api/marketing/funnel?id=` lists the jobs). When it stops, read the error
   word for word. Match it to Stop A, B or C above, or to none of them.
3. **Clear.** Do only the steps for the stop that matched. Retry. Write each answer ClickFunnels gave.
4. **After it says live.** GET each of the three pages on `apply.fundhub.ai` with a cache-busting
   `?fh_cb=<time>`: 200, and the page carries `<meta name="fh-funnel-tag" content="fnl-blueprint">`. Then
   run the morning lane once: `npm run pulse:prove -- --lanes=gap-built-funnels`. The row
   `built-funnels:live-pages-answer` must read PASS ("1 live built funnel, 3 pages").
5. **Write it down.** Replace each "UNVERIFIED" line in the X4F "Gaps" list of
   `docs/journeys/marketing-dashboard-flow.md` with what was seen, and note which stop (if any) was hit.

## What watches the page after it is live

`src/pulse/coverage/gap-built-funnels.mjs`, every morning: for each built funnel with `status = 'live'`
it does one cache-busted GET of each page's `live_url` and goes red on any answer other than 200 or a page
with no funnel tag. With no live built funnel it says "nothing to judge" (code `low-traffic`), and the audit
re-reads the database to prove that again every morning. The pulse only reports. An agent fixes a red by API
with the steps above.
