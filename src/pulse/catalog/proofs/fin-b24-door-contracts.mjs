// Batch 24 of "finish the 853" (lane gap-door-batch-routes, staff doors): route
// rows that now have a real-handler test with fake data. A row appears here only
// when a test calls the real api/ handler, against a stand-in database that
// answers by the conditions the SQL text names, and judges the named result. The
// guard test next to this file checks every row against the coverage map, every
// test file, and every test title.
//
// These are PRACTICE TESTS (fake data, stand-in database, vendor and worker
// doors handed in through the handlers' own seams). They are not live checks and
// never read a real customer's saved result.
//
// Not here on purpose: route:climate/geocode. The row says "state / county" and
// the door returns a state code, a point and a formatted address. It never
// returns a county. See ops/workflows/finish-853-2026-10-14/manifest-b24.md.

export const FIN_B24_GUARD_TEST = "src/pulse/catalog/proofs/fin-b24-door-contracts.test.mjs";

const ENTRIES = [
  {
    sourceFile: "routes-0.json",
    surface: "route:ad-videos",
    control: "List filmed ad takes and where each is stuck (awaiting_approval, editing, rendered ...). Reads only; approval is a different door.",
    tests: ["src/pulse/catalog/proofs/fin-b24-staff-reads.test.mjs"],
    titles: [
      "ad-videos lists this company's takes with where each is stuck in plain words, can narrow by state or by ad, and never writes",
      "ad-videos lets in owner and admin only; the sales floor never sees unreleased creative",
      "ad-videos refuses a login that names no company and reads nothing for it",
    ],
  },
  {
    sourceFile: "routes-1.json",
    surface: "route:adintel/board",
    control: "GET ?view=movers|death-watch|new-entrants|saturation|weeks (Winner's Board read; staff must name partner_id)",
    tests: ["src/pulse/catalog/proofs/fin-b24-agent-board.test.mjs", "src/pulse/catalog/proofs/fin-b24-front-guards.test.mjs"],
    titles: [
      "adintel/board movers: this week's top creatives for a partner, rank trend kept, the company's own ads and the raw score withheld, both stated limits sent",
      "adintel/board filters: a known angle narrows the feed, an unknown one is ignored, a week in the address is used as given",
      "adintel/board views: death watch, new entrants, the saturation grid and the weeks list each ask their own question for this company",
      "adintel/board says plainly when nothing has been rolled up, and makes staff name a partner; a client or affiliate login is refused",
      "adintel/board refuses a login that names no company, for a staff sign-in and for a partner, and reads no board",
    ],
  },
  {
    sourceFile: "routes-0.json",
    surface: "route:agent-call",
    control: "action=check: asks whether a live registry agent could phone one client. Never dials.",
    tests: ["src/pulse/catalog/proofs/fin-b24-agent-board.test.mjs", "src/pulse/catalog/proofs/fin-b24-front-guards.test.mjs"],
    titles: [
      "agent-call check says a live phone agent could call this client, and dials nothing and records nothing",
      "agent-call check stops by its own reason: unknown agent, internal agent, not live, no script, no client, no number, do-not-call, voice opt-out, restricted words, no phone key",
      "agent-call check is for the six contact desks only, and another company's staff reach neither its agent nor its client",
      "agent-call refuses a login that names no company and asks nothing about any agent or client",
    ],
  },
  {
    sourceFile: "routes-0.json",
    surface: "route:analytics/clickfunnels-connect",
    control: "Save a ClickFunnels API key + subdomain after proving them with a live listFunnels call.",
    tests: ["src/pulse/catalog/proofs/fin-b24-analytics.test.mjs", "src/pulse/catalog/proofs/fin-b24-front-guards.test.mjs"],
    titles: [
      "clickfunnels-connect proves the key against ClickFunnels first, then saves it encrypted for this company's connection and returns only the id, the workspace and the state",
      "clickfunnels-connect saves nothing and says ClickFunnels' own words when the key is refused, and refuses a missing key or a subdomain that is not a name",
      "clickfunnels-connect is for staff only and refuses a partner or client login before anything is asked or saved",
      "clickfunnels-connect refuses a login that names no company before ClickFunnels is asked or anything is saved",
    ],
  },
  {
    sourceFile: "routes-1.json",
    surface: "route:analytics/clickfunnels-sync",
    control: "POST pull funnels, pages and page stats from ClickFunnels into funnel_page_stats",
    tests: ["src/pulse/catalog/proofs/fin-b24-analytics.test.mjs", "src/pulse/catalog/proofs/fin-b24-front-guards.test.mjs"],
    titles: [
      "clickfunnels-sync saves one stats row for every page of every funnel for this company, unknown numbers as NULL and never 0, and marks the connection synced",
      "clickfunnels-sync keeps the pages already saved, marks the connection as an error with ClickFunnels' words, and answers 502 when the pull fails partway; no connection is a 404",
      "clickfunnels-sync refuses a login that names no company before ClickFunnels is asked or any page is saved",
      "clickfunnels-sync answers a read with 405 and asks ClickFunnels for nothing",
    ],
  },
  {
    sourceFile: "routes-2.json",
    surface: "route:analytics/youtube-connect",
    control: "POST /api/analytics/youtube-connect — saves the org's YouTube OAuth credentials after a live Google token refresh and channel read; stores them encrypted. Caller: any staff role in ROLE_SETS.STAFF. Response never returns the secrets.",
    tests: ["src/pulse/catalog/proofs/fin-b24-analytics.test.mjs", "src/pulse/catalog/proofs/fin-b24-front-guards.test.mjs"],
    titles: [
      "youtube-connect checks the three Google values by really asking Google, then saves them encrypted for this company with the channel id, and returns no secret",
      "youtube-connect saves nothing, and says Google's own words, when Google refuses the token, the channel list or the channel; and refuses a missing field",
      "youtube-connect refuses a login that names no company before Google is asked or anything is saved",
      "youtube-connect answers a read with 405 and asks Google for nothing",
    ],
  },
  {
    sourceFile: "routes-0.json",
    surface: "route:analytics/youtube-sync",
    control: "Manual 'Sync now': refresh Google OAuth token, list channel videos, pull watch stats, upsert one snapshot per video per day.",
    tests: ["src/pulse/catalog/proofs/fin-b24-analytics.test.mjs", "src/pulse/catalog/proofs/fin-b24-front-guards.test.mjs"],
    titles: [
      "youtube-sync saves one snapshot per video per day with the title, keeps unknown numbers NULL and never 0, skips a row with no video, and marks the connection synced",
      "youtube-sync marks the connection expired when Google revoked the token and error when anything else fails, with Google's words, and writes no stats on a failure; no connection is a 404",
      "youtube-sync refuses a login that names no company before Google is asked or any snapshot is saved",
    ],
  },
  {
    sourceFile: "routes-0.json",
    surface: "route:campaigns/detail",
    control: "One campaign with ad sets, 30-day metric series and recent actions.",
    tests: ["src/pulse/catalog/proofs/fin-b24-campaigns.test.mjs"],
    titles: [
      "campaigns/detail gives one campaign with its ad sets, its daily numbers for the window asked and its recent actions, for the partner on the login",
      "campaigns/detail says not found for a campaign the partner cannot see, wants an id, makes staff name a partner, and refuses a client or affiliate login",
    ],
  },
  {
    sourceFile: "routes-2.json",
    surface: "route:campaigns/link-asset",
    control: "POST /api/campaigns/link-asset — a person says which creative is running on an ad and what our own ad number is; sets ads.asset_id and fundhub_ad_number (key presence = set, null/blank = clear). Caller: partner (own) or staff via partner scope. This is what turns on the ad label spine.",
    tests: ["src/pulse/catalog/proofs/fin-b24-campaigns.test.mjs"],
    titles: [
      "campaigns/link-asset sets the creative and our ad number on this partner's ad, each only when its key is sent, and a blank or null clears it",
      "campaigns/link-asset refuses another partner's or company's creative, an ad that is not theirs, and anything that is not a uuid or a number; nothing is written",
    ],
  },
  {
    sourceFile: "routes-0.json",
    surface: "route:campaigns/sync",
    control: "Pull Meta campaigns, ad sets, ads and daily insights for one partner connection into local tables; promotes a pending connection; sends the dying-ad buzz to the owner.",
    tests: ["src/pulse/catalog/proofs/fin-b24-campaigns.test.mjs"],
    titles: [
      "campaigns/sync pulls the campaign, ad set, ad and daily numbers into this partner's tables, switches a pending connection to active the moment Meta answers, and writes Meta's verification word",
      "campaigns/sync tells the truth when Meta refuses: nothing is counted, a pending connection stays pending with Meta's sentence on it, and the answer is 502",
      "campaigns/sync says which connection it cannot use and why: expired, no key, no ad account number, or none at all",
      "campaigns/sync buzzes the owner once for each running ad that dies before 25% and is not tapping through, and records the day; a healthy ad gets no buzz",
      "campaigns/sync keeps a good pull when the buzz cannot go out, and does not mark the day as buzzed so tomorrow tries again; staff must name a partner; a client login is refused",
    ],
  },
  {
    sourceFile: "routes-2.json",
    surface: "route:chat/ask",
    control: "POST /api/chat/ask — staff chat widget: mode system (platform help) or knowledge (Company Brain search plus a written answer). Caller: staff in ROLE_SETS.STAFF; knowledge needs canQueryBrain(role).",
    tests: ["src/pulse/catalog/proofs/fin-b24-chat-journeys.test.mjs"],
    titles: [
      "chat/ask system mode hands the question to the platform help answerer and returns its text and sources; knowledge mode retrieves for this person's company and role, then writes the answer from those chunks",
      "chat/ask answers a refused or failed search honestly, refuses an empty, long or unknown question and a role outside staff, and never calls a model it was not handed",
    ],
  },
  {
    sourceFile: "routes-0.json",
    surface: "route:chat/messages",
    control: "Staff chat widget: list internal threads and messages, send staff-to-staff internal messages.",
    tests: ["src/pulse/catalog/proofs/fin-b24-chat-journeys.test.mjs", "src/pulse/catalog/proofs/fin-b24-front-guards.test.mjs"],
    titles: [
      "chat/messages lists only the staff member's own internal threads in their company, and a thread's messages oldest first, for a participant",
      "chat/messages POST internal saves one delivered staff message in this company from this person, makes the pair thread once, and never goes near the compliance gate",
      "chat/messages POST internal refuses yourself, a person outside the company, an empty or huge text, a thread you are not in and another company's thread; nothing is saved",
      "chat/messages refuses a login that names no company and lists or sends no message",
    ],
  },
  {
    sourceFile: "routes-0.json",
    surface: "route:content/tiles",
    control: "Content screen read: locked-tile copy and prices, welcome videos, tier-to-video map, products.",
    tests: ["src/pulse/catalog/proofs/fin-b24-content-docs.test.mjs", "src/pulse/catalog/proofs/fin-b24-front-guards.test.mjs"],
    titles: [
      "content/tiles GET gives the screen this company's tiles with prices and on-off, its videos, the tier-to-video map and its products",
      "content/tiles GET forgives only the two known missing-shape errors; a real fault is a 500, never painted as an empty library",
      "content/tiles lets in owner and admin only and answers nothing to another verb",
      "content/tiles refuses a login that names no company and reads no tile, price or video",
    ],
  },
  {
    sourceFile: "routes-2.json",
    surface: "route:content/welcome-video",
    control: "GET/HEAD /api/content/welcome-video — the hero video on the client portal. Without ?sig it needs a session (client sees own file, staff name the client) and answers whether a video is mapped, whether its bytes are in the store, and a short-lived signed link; with ?sig it streams the bytes with no session (the signature is the credential).",
    tests: ["src/pulse/catalog/proofs/fin-b24-content-docs.test.mjs", "src/pulse/catalog/proofs/fin-b24-front-guards.test.mjs", "src/pulse/catalog/proofs/fin-b24-more-guards.test.mjs"],
    titles: [
      "content/welcome-video metadata tells staff whether a video is mapped, whether its bytes are in the store, and mints a short-lived signed link without a storage key",
      "content/welcome-video says the file is unverified, with the link minted, when the store cannot be asked, and has no link at all with no signing key",
      "content/welcome-video serves a signed-in client the mapped video, and refuses a client login with no client file, a partner login and no login",
      "content/welcome-video streams the bytes with no session when the signature is good, and answers one 404 for a forged, expired or unknown link",
      "content/welcome-video lets in every staff role for the preview and refuses a partner or client login posing as staff",
      "content/welcome-video refuses a staff login that names no company and says nothing about the video",
      "content/welcome-video says the signing key is not set up, in plain words and without its name, when a player asks for the bytes with no key to check the link against",
    ],
  },
  {
    sourceFile: "routes-3.json",
    surface: "route:creative/generate",
    control: "POST enqueue a Creative Factory generation job (image, video or copy) for a partner. The Netlify creative-job-runner claims it.",
    tests: ["src/pulse/catalog/proofs/fin-b24-creative.test.mjs"],
    titles: [
      "creative/generate saves one queued job for the partner on the login, with who asked and what to make, and says whether anything is switched on to run it",
      "creative/generate answers a repeat of the same key with the first job and no second row, so a double click is never a second bill",
      "creative/generate saves nothing when the key, the offer, the script or the partner is wrong, or the suite is off for this partner",
      "creative/generate tells the screen plainly when no ad-making service is switched on, when the one on file is unknown, and when it could not check; the job is saved either way",
    ],
  },
  {
    sourceFile: "routes-3.json",
    surface: "route:creative/run",
    control: "POST claim and run queued generation jobs for a partner (or all partners with due work for staff with all=1). The Netlify creative-job-runner runs the same path on a clock.",
    tests: ["src/pulse/catalog/proofs/fin-b24-creative.test.mjs"],
    titles: [
      "creative/run claims and runs up to the number asked for, for the partner on the login only, and sums what worked, what failed and what went back in the queue",
      "creative/run caps one press at ten jobs, falls back to three when the number is not a whole number, and puts the ad checker's verdict on every piece of copy",
      "creative/run lets staff run every partner's due work with all=1 and nobody else; staff must otherwise name a partner; a client login is refused",
      "creative/run leaves copy jobs for the Mac when the runner is local: it never claims them, and says how many are waiting",
    ],
  },
  {
    sourceFile: "routes-2.json",
    surface: "route:dashboard/kpis",
    control: "GET /api/dashboard/kpis?period=today|7d|30d|qtd — company money and funnel KPIs for Command Center and Ops: cash collected, funded count and amount, close rate, show rate, cost per funded, new clients, pipeline movement. Read-only. Caller: staff session, or the shared x-dashboard-key header (which has no org and is refused with 403).",
    tests: ["src/pulse/catalog/proofs/fin-b24-staff-reads.test.mjs", "src/pulse/catalog/proofs/fin-b24-more-guards.test.mjs"],
    titles: [
      "dashboard/kpis states cash in cents, funded count and amount, close and show rate, cost per funded, new clients and pipeline movement for this company's window",
      "dashboard/kpis says unknown, never zero, when ad spend or bookings are missing, and refuses the shared dashboard key because it names no company",
      "dashboard/kpis blames the request, not the server, when a statement is refused for a bad value, and answers a real fault with a plain 500",
    ],
  },
  {
    sourceFile: "routes-2.json",
    surface: "route:documents-download",
    control: "GET /api/documents-download?id= — mints a fresh signed link for a saved document (the bytes still come from api/documents/[id]). Caller: staff in ROLE_SETS.STAFF in the same org, or the client for their own file. Every refusal is the same 404.",
    tests: ["src/pulse/catalog/proofs/fin-b24-content-docs.test.mjs", "src/pulse/catalog/proofs/fin-b24-front-guards.test.mjs"],
    titles: [
      "documents-download mints a fresh signed link for a saved document of the caller's own company, with no storage key, and one 404 for every refusal",
      "documents-download lets in every staff role and refuses a partner login before any document is read",
      "documents-download refuses a login that names no company and mints no link",
    ],
  },
  {
    sourceFile: "routes-1.json",
    surface: "route:hiring/apply",
    control: "GET open roles (key, name, brief only) for the public careers page",
    tests: ["src/pulse/catalog/proofs/fin-b24-hiring.test.mjs"],
    titles: [
      "hiring/apply GET lists this company's open roles by name with key, name and brief only; a blank brief is null; no sign-in; cached for a minute",
    ],
  },
  {
    sourceFile: "routes-1.json",
    surface: "route:hiring/apply",
    control: "POST one job application (honeypot, rate limit; always answers received)",
    tests: ["src/pulse/catalog/proofs/fin-b24-hiring.test.mjs"],
    titles: [
      "hiring/apply POST saves one candidate and one application in stage applied, queues a task for a person, decides nothing, and answers received",
      "hiring/apply POST gives a person, a returning person and a bot the same reply, and stores a second application for the same role only once",
      "hiring/apply POST is burst-limited per address and per email, and says when to come back",
      "hiring/apply POST refuses protected fields, a missing name or email, a link in the name, an unknown role and a body that is not JSON, and stores nothing",
    ],
  },
  {
    sourceFile: "routes-2.json",
    surface: "route:hiring/apply (POST application)",
    control: "POST /api/hiring/apply — public careers door: takes one application (name, email, phone, role), burst-limited per IP, honeypot; always answers {ok:true, received:true}. Writes a candidate and an application in stage applied; decides nothing. Caller: public.",
    tests: ["src/pulse/catalog/proofs/fin-b24-hiring.test.mjs"],
    titles: [
      "hiring/apply POST saves one candidate and one application in stage applied, queues a task for a person, decides nothing, and answers received",
      "hiring/apply POST gives a person, a returning person and a bot the same reply, and stores a second application for the same role only once",
      "hiring/apply POST is burst-limited per address and per email, and says when to come back",
      "hiring/apply POST refuses protected fields, a missing name or email, a link in the name, an unknown role and a body that is not JSON, and stores nothing",
    ],
  },
  {
    sourceFile: "routes-2.json",
    surface: "route:hiring/decide",
    control: "POST /api/hiring/decide — the one place a person moves a candidate: action advance (to_stage) or reject (written reason required); decided_by comes from the session and a body that names it is refused. Reject queues a candidate-feedback task for a person; nothing is emailed. Caller: owner, admin.",
    tests: ["src/pulse/catalog/proofs/fin-b24-hiring.test.mjs"],
    titles: [
      "hiring/decide advance moves one application to the stage asked for and writes who decided, from where, to where and the machine's advice at the time",
      "hiring/decide reject needs a written reason, writes the decision and the rejected stage in one transaction, and queues a feedback task for a person; nothing is emailed",
      "hiring/decide refuses a body that names the decider or the company, an unknown stage or action, a closed application and an unknown one; nothing changes",
      "hiring/decide lets in owner and admin only and answers nothing to another verb",
    ],
  },
  {
    sourceFile: "routes-1.json",
    surface: "route:hiring/decide",
    control: "POST action=advance|reject {application_id, to_stage, reason} (a person moves or rejects a candidate; reject needs a written reason)",
    tests: ["src/pulse/catalog/proofs/fin-b24-hiring.test.mjs"],
    titles: [
      "hiring/decide advance moves one application to the stage asked for and writes who decided, from where, to where and the machine's advice at the time",
      "hiring/decide reject needs a written reason, writes the decision and the rejected stage in one transaction, and queues a feedback task for a person; nothing is emailed",
      "hiring/decide refuses a body that names the decider or the company, an unknown stage or action, a closed application and an unknown one; nothing changes",
      "hiring/decide lets in owner and admin only and answers nothing to another verb",
    ],
  },
  {
    sourceFile: "routes-0.json",
    surface: "route:inquiry",
    control: "GET action=cases or status: open inquiry-removal cases for the Specialist desk, or one outbound call row.",
    tests: ["src/pulse/catalog/proofs/fin-b24-staff-reads.test.mjs", "src/pulse/catalog/proofs/fin-b24-front-guards.test.mjs"],
    titles: [
      "inquiry GET action=cases lists this company's cases newest first, narrowed by status, and action=status reads one call row of this company",
      "inquiry lets in the inquiry specialist, admin and owner only; every other role is refused before any case is read",
      "inquiry refuses a login that names no company and lists no case and no call",
    ],
  },
  {
    sourceFile: "routes-0.json",
    surface: "route:journeys/ask",
    control: "Server-side proxy to Claude for the Journeys editor: sends the staff member's system and user text to Anthropic and returns the text.",
    tests: ["src/pulse/catalog/proofs/fin-b24-chat-journeys.test.mjs"],
    titles: [
      "journeys/ask sends the editor's system and user text to the model with the key held on the server and returns the joined text; every failure is a named 4xx or 5xx",
    ],
  },
  {
    sourceFile: "routes-1.json",
    surface: "route:journeys/run",
    control: "POST {journey?, format?} walk every journey branch through the real event bus inside one transaction that is always rolled back",
    tests: ["src/pulse/catalog/proofs/fin-b24-chat-journeys.test.mjs", "src/pulse/catalog/proofs/fin-b24-front-guards.test.mjs"],
    titles: [
      "journeys/run walks a journey's branches with a fresh pretend client for each path through the real event bus, routes messages to the memory provider, and never commits",
      "journeys/run walks all six seeded journeys when none is named, can answer in plain text, and still rolls back; an unknown journey is a 400 that lists the real ones",
      "journeys/run is for owner, admin and sales manager only, and refuses every other role before a connection is opened",
      "journeys/run refuses a login that names no company and walks no journey",
      "journeys/run answers a read with 405 and walks no journey",
    ],
  },
  {
    sourceFile: "routes-2.json",
    surface: "route:journeys/run",
    control: "POST /api/journeys/run — walks every journey branch through the real event bus and workflows inside one transaction that is always rolled back (memory provider, nothing sent), and reports what the code did. Caller: owner, admin, sales_manager (ROLE_SETS.FINANCE).",
    tests: ["src/pulse/catalog/proofs/fin-b24-chat-journeys.test.mjs", "src/pulse/catalog/proofs/fin-b24-front-guards.test.mjs"],
    titles: [
      "journeys/run walks a journey's branches with a fresh pretend client for each path through the real event bus, routes messages to the memory provider, and never commits",
      "journeys/run walks all six seeded journeys when none is named, can answer in plain text, and still rolls back; an unknown journey is a 400 that lists the real ones",
      "journeys/run is for owner, admin and sales manager only, and refuses every other role before a connection is opened",
      "journeys/run refuses a login that names no company and walks no journey",
      "journeys/run answers a read with 405 and walks no journey",
    ],
  },
  {
    sourceFile: "routes-3.json",
    surface: "route:lender-observations",
    control: "POST log which bureau a lender actually pulled, or review an observation (action log or review).",
    tests: ["src/pulse/catalog/proofs/fin-b24-staff-reads.test.mjs", "src/pulse/catalog/proofs/fin-b24-front-guards.test.mjs"],
    titles: [
      "lender-observations log saves which bureau pulled, flags a mismatch against what the lender is known to pull, for this company",
      "lender-observations review changes only this company's observation, with a word the table allows, and says not found for another company's",
      "lender-observations lets in exactly owner, admin and funding advisor and refuses every other role before any data is read",
      "lender-observations refuses a login that names no company and saves no observation or review",
    ],
  },
  {
    sourceFile: "routes-3.json",
    surface: "route:marketing/ad",
    control: "GET ?n= one ad number for the Ads drawer: 30-day row, Meta ads, watch curve, alerts and diagnoses.",
    tests: ["src/pulse/catalog/proofs/fin-b24-marketing-reads.test.mjs"],
    titles: [
      "marketing/ad gives one ad number's drawer: its row for the last 30 Arizona days, the Meta ads that carry it, the watch curve and the alerts and diagnoses, for this company only",
      "marketing/ad answers a number with no ad-days as unknown spend, not zero; 404s a number the company has never seen; 400s a number that is not digits; owner and admin only",
    ],
  },
  {
    sourceFile: "routes-1.json",
    surface: "route:marketing/angles",
    control: "GET marketing numbers by angle, last 30 Arizona days (spend, leads, booked, sales, cash, ROAS)",
    tests: ["src/pulse/catalog/proofs/fin-b24-marketing-reads.test.mjs"],
    titles: [
      "marketing/angles rolls this company's saved spend and leads up by angle for the last 30 Arizona days: a script's angle wins over the creative's, an ad with no angle is in no row, nothing of another company is counted",
      "marketing/angles says unknown spend as null, never 0, when no ad-day was saved, and is for owner and admin only",
    ],
  },
  {
    sourceFile: "routes-1.json",
    surface: "route:marketing/batches/write-now",
    control: "POST {request_id, count, funnel_key, idea_ids} start a script batch now (queues a start_batch job, spends model money)",
    tests: ["src/pulse/catalog/proofs/fin-b24-marketing-writes.test.mjs"],
    titles: [
      "marketing/batches/write-now queues one on-command batch and one start_batch job for this company, takes the chosen ideas into it, wakes the worker, and a repeated press answers the first answer and queues nothing more",
      "marketing/batches/write-now queues nothing when a model-bill cap is reached, or when the count, funnel or ideas are wrong; another press's request id is refused",
    ],
  },
  {
    sourceFile: "routes-3.json",
    surface: "route:marketing/costs",
    control: "GET what each paid job kind cost last time and the month and batch caps. Every cost line on the Command Center reads this.",
    tests: ["src/pulse/catalog/proofs/fin-b24-marketing-reads.test.mjs"],
    titles: [
      "marketing/costs gives each job kind's last measured cost and minutes (unknown when never measured), this month's spend against the cap, and the run caps, for this company",
    ],
  },
  {
    sourceFile: "routes-0.json",
    surface: "route:marketing/flywheel",
    control: "Ideas tab flywheel card: every campaign and its six steps in plain words; reads repo files and saved rows. Free.",
    tests: ["src/pulse/catalog/proofs/fin-b24-marketing-reads.test.mjs"],
    titles: [
      "marketing/flywheel lists every campaign and the six steps of one in plain words, picks partner when none is named, and reads files and saved rows only",
      "marketing/flywheel refuses a campaign name that is not a folder name, says no such flywheel for one that is not there, and answers an honest empty card when there are none; owner and admin only",
    ],
  },
  {
    sourceFile: "routes-1.json",
    surface: "route:marketing/flywheel/approve",
    control: "POST {request_id, campaign, stage} mark a flywheel step approved (edits the file's front matter through the repo outbox)",
    tests: ["src/pulse/catalog/proofs/fin-b24-marketing-writes.test.mjs"],
    titles: [
      "marketing/flywheel/approve queues one front-matter edit that sets status to approved on that step's file, once per press, and wakes the worker",
      "marketing/flywheel/approve refuses a step with no file or no stamp, an unknown campaign or step, and a request with no press id; nothing is queued",
    ],
  },
  {
    sourceFile: "routes-3.json",
    surface: "route:marketing/flywheel/campaign",
    control: "POST {request_id, key} start a flywheel for an offer key: queues the campaign folder and owner-notes file through the repo outbox; wakes the worker.",
    tests: ["src/pulse/catalog/proofs/fin-b24-marketing-writes.test.mjs"],
    titles: [
      "marketing/flywheel/campaign queues the folder's owner-notes file with the offer key line for a new flywheel, and starts nothing twice for one that exists",
    ],
  },
  {
    sourceFile: "routes-0.json",
    surface: "route:marketing/flywheel/job",
    control: "Poll one flywheel run step by step (status, cost so far, sentence).",
    tests: ["src/pulse/catalog/proofs/fin-b24-marketing-reads.test.mjs"],
    titles: [
      "marketing/flywheel/job polls one avatar run of this company step by step with the cost so far, and says not found for any other run",
    ],
  },
  {
    sourceFile: "routes-1.json",
    surface: "route:marketing/flywheel/run",
    control: "POST {request_id, campaign, stage 1-6, note} run or redo a flywheel step (1 avatar, 2 market research, 3 offer, 4 copy, 5 ad strategy: model spend; 6 spend read: free)",
    tests: ["src/pulse/catalog/proofs/fin-b24-marketing-writes.test.mjs"],
    titles: [
      "marketing/flywheel/run starts the copy and the strategy as one saved job each, only after the steps they depend on are approved, once per step, under the month cap and with a model key",
      "marketing/flywheel/run refuses with no model key, past the month cap, an unknown campaign or step, and a step 5 that waits for step 4; nothing is queued",
      "marketing/flywheel/run hands step 3 to the offer writer with this campaign's files and notes, and starts the avatar (step 1) and the market research (step 2) as their own saved runs",
    ],
  },
  {
    sourceFile: "routes-3.json",
    surface: "route:marketing/flywheel/spend-read",
    control: "POST {request_id, campaign} flywheel step 6: reads the saved ad numbers for the campaign, writes the conclusion into 06-spend.md through the outbox. Free; no model call.",
    tests: ["src/pulse/catalog/proofs/fin-b24-marketing-writes.test.mjs"],
    titles: [
      "marketing/flywheel/spend-read reads this company's saved ad numbers for the last 30 Arizona days ending yesterday, words a conclusion, and queues 06-spend.md for the repo in the same transaction",
      "marketing/flywheel/spend-read refuses an unknown or malformed campaign and a missing press id, is free of any model or vendor call, and is for owner and admin only",
    ],
  },
  {
    sourceFile: "routes-0.json",
    surface: "route:marketing/flywheel/tweak",
    control: "Tweak a flywheel row: appends a dated line to the owner notes (git outbox) and re-runs that step; the re-run is a paid model call.",
    tests: ["src/pulse/catalog/proofs/fin-b24-marketing-writes.test.mjs"],
    titles: [
      "marketing/flywheel/tweak appends one dated line under Notes in the owner notes, then re-runs that step where it can, with the note riding on the new job; the note is saved even when the step is blocked",
      "marketing/flywheel/tweak refuses an empty or long note, a campaign with no owner notes, an unknown campaign and a missing press id; nothing is saved or run",
    ],
  },
];

export function finB24DoorKey(sourceFile, row) {
  const file = String(sourceFile || "").split(/[\\/]/).at(-1);
  return [file, String(row?.surface || "").trim(), String(row?.control || "").trim()].join("\0");
}

export const FIN_B24_DOOR_CONTRACTS = Object.freeze(ENTRIES.map((entry) => Object.freeze({
  ...entry,
  key: finB24DoorKey(entry.sourceFile, entry),
  proof: Object.freeze({
    depth: "e2e",
    evidence: [FIN_B24_GUARD_TEST, ...entry.tests].join(" "),
    asserts: entry.control,
  }),
})));

const BY_KEY = new Map(FIN_B24_DOOR_CONTRACTS.map((entry) => [entry.key, entry.proof]));

export function finB24DoorProof(sourceFile, row) {
  return BY_KEY.get(finB24DoorKey(sourceFile, row)) || null;
}
