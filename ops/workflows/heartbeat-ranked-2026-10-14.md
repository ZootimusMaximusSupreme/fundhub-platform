# The heartbeat, ranked: broken, working, and everything else — 2026-10-14

Built from a full run of the morning pulse against the live database, read only (state of `main` after PR #41, before the proof round). **2,622 items in total.**

Ranked by what an item touches, most important first: money, then customer messages, then customer records and journeys, then staff tools, then the plumbing. Ranking is by name and proof text, so treat the boundary between tiers as rough.

## The totals

| | Items |
|---|---:|
| Broken | 114 |
| Not proved yet | 1,553 |
| Not Checked | 9 |
| Working | 709 |
| Nothing To Judge | 237 |
| **All items** | **2,622** |

## By importance

| What it touches | Broken | Not proved yet | Not checked | Working | Nothing to judge | Total |
|---|---:|---:|---:|---:|---:|---:|
| 1 Money | 28 | 149 | 0 | 138 | 19 | 334 |
| 2 Customer messages | 21 | 82 | 3 | 70 | 165 | 341 |
| 3 Customer records and journey | 46 | 383 | 2 | 191 | 23 | 645 |
| 4 Staff and internal tools | 17 | 939 | 4 | 304 | 30 | 1294 |
| 5 Plumbing (the heartbeat checking itself) | 2 | 0 | 0 | 6 | 0 | 8 |

## 1. BROKEN: the real problems, most important first

### How to read the Broken list

Of the 114 Broken items: **17** say "no saved receipt or linked result exists for this exact check". That means the control has never been used for real on live data, so the check has nothing to read. They are red by rule, not because we saw a wrong answer. **4** say "N of M saved results failed": those were measured wrong and are the strongest signals. **42** are workflow-receipt items (an event arrived and no run receipt matches; mostly the test events from the Oct 11 test-on-live-database accident). The rest are single named problems (a key, a template, a job, a stuck invoice).

### 1 Money  (28)

1. `ads-number-unmapped`: 2 ads have spend in the last 28 days and no Fundhub ad number: AD, Adspine numberless.  
   *Fix guide:* Set fundhub_ad_number on that ad. Spend with no number cannot be tied to a lead. Recon (AG-07) already reports this on the morning pulse. Do
2. `catalog-data:spend_ceilings`: spend_ceilings: 1 of 1 saved result row is missing a business result.  
   *Fix guide:* Open the spend_ceilings rows counted by the catalog data check and finish the missing result. Do not auto-fix. Chris fixes reds.
3. `catalog-display:desks-a.json:client-control-panel.html:Mark funded… button, amount box, Sa`: Mark funded… button, amount box, Save funded, Cancel: 3 of 6 saved results failed the exact check. Required: The round.funded receipt must link to the same funding round and preserve the exact funded   
   *Fix guide:* Open the named result rows and fix the broken link or value. Do not auto-fix. Chris fixes reds.
4. `catalog-display:desks-b.json:financeos.html#next:'Do task' button on a step the helper or `: 'Do task' button on a step the helper or a person can do: no saved receipt or linked result exists for this exact check. Required: The task-assigned log must link the exact money task, client, task ke  
   *Fix guide:* Create one real result through the named control, then let the read-only pulse judge it. Do not auto-fix. Chris fixes reds.
5. `catalog-display:desks-b.json:financeos.html#next:'I'm ready to get funded' button (opens t`: 'I'm ready to get funded' button (opens the Capital Blueprint closing-prep call task): no saved receipt or linked result exists for this exact check. Required: The ready-to-fund log must link the exac  
   *Fix guide:* Create one real result through the named control, then let the read-only pulse judge it. Do not auto-fix. Chris fixes reds.
6. `catalog-display:desks-e.json:public/app/pipeline.html:Funded amount prompt (window.prompt,`: Funded amount prompt (window.prompt, up to 3 tries; blank or cancel abandons the move, never sends zero): 3 of 6 saved results failed the exact check. Required: A valid prompt submission must reach th  
   *Fix guide:* Open the named result rows and fix the broken link or value. Do not auto-fix. Chris fixes reds.
7. `catalog-display:desks-f.json:products-commissions.html:'Approve selected': moves Accrued r`: 'Approve selected': moves Accrued rows to Approved: no saved receipt or linked result exists for this exact check. Required: Each commission.approved receipt must link to the same ledger amount and an  
   *Fix guide:* Create one real result through the named control, then let the read-only pulse judge it. Do not auto-fix. Chris fixes reds.
8. `catalog-display:desks-f.json:products-commissions.html:'Mark paid...': asks for the ACH / `: 'Mark paid...': asks for the ACH / check / payroll id, marks Approved rows Paid (records only, moves no money): no saved receipt or linked result exists for this exact check. Required: Each commission  
   *Fix guide:* Create one real result through the named control, then let the read-only pulse judge it. Do not auto-fix. Chris fixes reds.
9. `catalog-display:desks-f.json:products-commissions.html:Commission rule 'Close v<N> - open `: Commission rule 'Close v<N> - open v<N+1>': saves a new effective-dated rate and reason: 1 of 2 saved results failed the exact check. Required: Each closed rule must link to its replacement at the exa  
   *Fix guide:* Open the named result rows and fix the broken link or value. Do not auto-fix. Chris fixes reds.
10. `catalog:hourly-proof-linked`: 86 customer or money tripwire surfaces still lack an hourly beat: desk:brand-studio.html, desk:client-portal.html, desk:csm-queue.html, desk:hiring.html, desk:inquiry-remover.html, desk:messaging.html  
   *Fix guide:* Open hourlyUncoveredSurfaces in the built catalog. Reuse a real hourly business-result check or add the missing read-only proof; never attac
11. `gap-door-batch-jobs:catalog-job:jobs.json:function:ad-video-worker-background:ad-video-wor`: function:ad-video-worker-background — ad-video-worker-background (netlify/functions/ad-video-worker-background.mjs): background function (15 minutes) started by ad-video-sweeper. Needs header x-fundhu  
   *Fix guide:* Add a non-empty fake-data run for function:ad-video-worker-background that judges this exact final result.
12. `gap-underwrite:uw-pack-email-not-queued`: EMAIL-U02-ANALYZER-FUNDING-DELIVERY has no row, so no pack-ready email can be queued.  
   *Fix guide:* Read the client's messages for EMAIL-U02-ANALYZER-FUNDING-DELIVERY and the slo-pack-delivery run. If the template is missing or not approved
13. `meta-sync`: Meta ad numbers saved 2026-10-14 07:00 UTC (2 h ago), but the last Meta call failed: Invalid initialization vector / decryptToken: malformed auth tag / Invalid initialization vector / Invalid initiali  
   *Fix guide:* Read ad_platform_connections.last_error and the meta-campaign-sync-sweeper run (07:00 UTC). Do not auto-fix from this pulse.
14. `partners:commission-payable`: 1 affiliate earned commission the rules say is payable (signed license, tax form, at least $50, converted before 2026-10-01) and it is not on a pending, processing, or paid run.  
   *Fix guide:* Look at those converted referrals. The monthly payout job should have written a pending row. Do not mark anyone paid. Tell Recon (AG-07). Do
15. `payments:invoice-stuck`: 7 invoices stuck (dunning state does not match the money, or a paid link still sits on an open invoice).  
   *Fix guide:* Recon (AG-07) is the one tripwire. Leave that agent on the morning pulse. Do not auto-fix. Do not take a card payment. Do not mint a Commas 
16. `portal:paid-client-never-signed-in`: 1 paying client has held portal access for over 72 hours and has never signed in (longest wait 8 days; 0 of 1 asked for a sign-in link since access was given). Left out: 23 test clients, 2 with no pay  
   *Fix guide:* Send each of them their sign-in link from the staff screen, or call them. Do not auto-fix from this pulse.
17. `wf:c-05-pre-funding-review`: 5 round.started events came and no receipt shows this workflow started (first 2026-10-11 10:14 p.m. Arizona time).  
   *Fix guide:* Open c-05-pre-funding-review in Inngest and look for the round.started event. If Inngest never got it, the send was lost. If it did, the wor
18. `wf:f-01-funding-intake`: 5 round.started events came and no receipt shows this workflow started (first 2026-10-11 10:14 p.m. Arizona time).  
   *Fix guide:* Open f-01-funding-intake in Inngest and look for the round.started event. If Inngest never got it, the send was lost. If it did, the workflo
19. `wf:f-06-funding-conditions-missing-docs`: 1 mail.response event came and no receipt shows this workflow started (first 2026-10-11 10:15 p.m. Arizona time).  
   *Fix guide:* Open f-06-funding-conditions-missing-docs in Inngest and look for the mail.response event. If Inngest never got it, the send was lost. If it
20. `wf:f-07-funding-locked`: 3 round.funded events came and no receipt shows this workflow started (first 2026-10-11 10:14 p.m. Arizona time).  
   *Fix guide:* Open f-07-funding-locked in Inngest and look for the round.funded event. If Inngest never got it, the send was lost. If it did, the workflow
21. `wf:f-08-post-funding-monitoring`: 3 round.funded events came and no receipt shows this workflow started (first 2026-10-11 10:14 p.m. Arizona time).  
   *Fix guide:* Open f-08-post-funding-monitoring in Inngest and look for the round.funded event. If Inngest never got it, the send was lost. If it did, the
22. `wf:f-09-funding-declined-no-path`: 1 mail.response event came and no receipt shows this workflow started (first 2026-10-11 10:15 p.m. Arizona time).  
   *Fix guide:* Open f-09-funding-declined-no-path in Inngest and look for the mail.response event. If Inngest never got it, the send was lost. If it did, t
23. `wf:f-10-client-funding-inbox-provisioner`: 5 round.started events came and no receipt shows this workflow started (first 2026-10-11 10:14 p.m. Arizona time).  
   *Fix guide:* Open f-10-client-funding-inbox-provisioner in Inngest and look for the round.started event. If Inngest never got it, the send was lost. If i
24. `wf:n-04-post-funding-nurture`: 3 round.closeout events came and no receipt shows this workflow started (first 2026-10-11 10:14 p.m. Arizona time).  
   *Fix guide:* Open n-04-post-funding-nurture in Inngest and look for the round.closeout event. If Inngest never got it, the send was lost. If it did, the 
25. `wf:n-06-renewal-second-wave`: 3 round.funded events came and no receipt shows this workflow started (first 2026-10-11 10:14 p.m. Arizona time).  
   *Fix guide:* Open n-06-renewal-second-wave in Inngest and look for the round.funded event. If Inngest never got it, the send was lost. If it did, the wor
26. `wf:s-06-post-call-funding-purchased`: 3 deposit.paid events came and no receipt shows this workflow started (first 2026-10-11 10:14 p.m. Arizona time).  
   *Fix guide:* Open s-06-post-call-funding-purchased in Inngest and look for the deposit.paid event. If Inngest never got it, the send was lost. If it did,
27. `wf:s-08-post-call-funding-declined`: 1 call.completed event came and no receipt shows this workflow started (first 2026-10-11 10:15 p.m. Arizona time).  
   *Fix guide:* Open s-08-post-call-funding-declined in Inngest and look for the call.completed event. If Inngest never got it, the send was lost. If it did
28. `wf:sys-01-ltv-calculator`: 3 round.funded events came and no receipt shows this workflow started (first 2026-10-11 10:14 p.m. Arizona time).  
   *Fix guide:* Open sys-01-ltv-calculator in Inngest and look for the round.funded event. If Inngest never got it, the send was lost. If it did, the workfl

### 2 Customer messages  (21)

29. `brain:embed-key`: OPENAI_API_KEY is a row of asterisks (a mask), not a key. OpenAI refuses it, so Company Brain cannot turn a question into a search. Every question gets a 502 and no new text file can be saved for sear  
   *Fix guide:* Put the real OpenAI key in OPENAI_API_KEY and ship once. Do not unset or delete any stored key. Recon (AG-07) is the one tripwire. Leave tha
30. `calls:booked-no-join-link`: 0 of the newest 5 real bookings carried a join link, so a new booking will not have one either (the newest real booking was made 3 days ago). The 15-minute text sends the portal sign-in page where the  
   *Fix guide:* Decide where a customer gets the call link, and make every booking keep it. ClickFunnels sends none. If the link is in the ClickFunnels conf
31. `catalog-display:desks-b.json:consent-capture.html:History table: 'live / not live' state a`: History table: 'live / not live' state and Withdraw button (asks for a reason in a prompt): no saved receipt or linked result exists for this exact check. Required: Every revoked consent must preserve  
   *Fix guide:* Create one real result through the named control, then let the read-only pulse judge it. Do not auto-fix. Chris fixes reds.
32. `catalog-display:desks-b.json:consent-capture.html:Record consent: call_recording`: Record consent: call_recording: no saved receipt or linked result exists for this exact check. Required: The saved consent must be the call_recording kind with frozen words, version, capture method, a  
   *Fix guide:* Create one real result through the named control, then let the read-only pulse judge it. Do not auto-fix. Chris fixes reds.
33. `catalog-display:desks-b.json:consent-capture.html:Record consent: marketing_use (permissio`: Record consent: marketing_use (permission to use what the client said in ads): no saved receipt or linked result exists for this exact check. Required: The saved consent must be the marketing_use kind  
   *Fix guide:* Create one real result through the named control, then let the read-only pulse judge it. Do not auto-fix. Chris fixes reds.
34. `consent:dispute-required`: 1 active repair client has been enrolled over 7 days and has neither a live dispute authorization nor a signed repair agreement.  
   *Fix guide:* A repair client has neither a live dispute authorization nor a signed repair agreement, so no letters can be prepared. Chase the signature t
35. `consent:required`: 2 clients paid for a credit report over 24 hours ago and have no live soft-pull consent.  
   *Fix guide:* A client who paid for a credit report has no live written permission. Use the consent page with that client before any credit pull. Do not r
36. `email:sending-stuck`: 1 outbound email has been on sending for more than 15 minutes.  
   *Fix guide:* The dispatcher picked this email up and never wrote a result, and nothing puts it back. Read the messages rows still on sending. Report it o
37. `gap-door-batch-jobs:catalog-job:jobs.json:workflow:contract-chaser:contract-chaser (src/wo`: workflow:contract-chaser — contract-chaser (src/workflows/contract-chaser.mjs): trigger cron 0 10 * * *. daily at 10:00 UTC reminds the person holding up a contract and puts it on a list | sends or ca  
   *Fix guide:* Add a non-empty fake-data run for workflow:contract-chaser that judges this exact final result.
38. `gap-door-batch-jobs:catalog-job:jobs.json:workflow:pulse-instant-watch:pulse-instant-watch`: workflow:pulse-instant-watch — pulse-instant-watch (src/workflows/pulse-instant-watch.mjs): trigger cron */5 * * * *. every 5 minutes checks critical doors and stuck outbound and texts Chris on a brea  
   *Fix guide:* Add a non-empty fake-data run for workflow:pulse-instant-watch that judges this exact final result.
39. `gap-sms:gap:msg-inbound-unmatched`: In the last 7 days: 1 customer text reached our door and no message was saved (older than 15 minutes). 1 text from our own lines left out.  
   *Fix guide:* Read the message.inbound event and the saved message that share its sid. Lost means the reply handler did not run. Unlinked from a saved num
40. `gap:sms-journey-zero`: 1 step that should text has no text row (booking.created).  
   *Fix guide:* A step that should text wrote no text row. Read the event and the template. Do not send a text from this check. Do not change the outbound s
41. `gap:sms-provider-failed`: 6 customer texts and 0 staff texts failed at the phone company in the last 7 days.  
   *Fix guide:* The phone company said no. Read last_error on the text row. Do not send a text from this check. Do not change the outbound switch. Recon sta
42. `gap:sms-sending-stuck`: 1 customer text and 0 staff texts are stuck on sending past 15 minutes.  
   *Fix guide:* A text was picked up and never finished. Read the messages row still on sending. Do not send a text from this check. Do not change the outbo
43. `msg:per-template-path`: 2 templates queued mail that never arrived in the last 7 days: SMS-AISET04-HANDOFF (text, 2 old rows, 0 delivered: 2 failed or bounced); SMS-S05A-NOSHOW-RECOVERY (text, 2 old rows, 0 delivered: 2 fail  
   *Fix guide:* Read the message rows for the template named. If none was delivered, check the provider for that channel, the delivery receipt door (email e
44. `opt-out:unsubscribe-link`: Email unsubscribe links are broken: a link cannot be signed, so email goes out with no unsubscribe link (UNSUBSCRIBE_TOKEN_SECRET is missing or too short (need >= 32 chars) — refusing to sign unsubscr  
   *Fix guide:* The email unsubscribe link could not be made or checked. Look at the signing secret in the function settings (UNSUBSCRIBE_TOKEN_SECRET, 32 o
45. `wf:dpc-03-inbound-reply-router`: 1 message.inbound event came and no receipt shows this workflow started (first 2026-10-11 10:15 p.m. Arizona time).  
   *Fix guide:* Open dpc-03-inbound-reply-router in Inngest and look for the message.inbound event. If Inngest never got it, the send was lost. If it did, t
46. `wf:f-11-bank-email-event-router`: 1 mail.response event came and no receipt shows this workflow started (first 2026-10-11 10:15 p.m. Arizona time).  
   *Fix guide:* Open f-11-bank-email-event-router in Inngest and look for the mail.response event. If Inngest never got it, the send was lost. If it did, th
47. `wf:s-00-welcome`: 1 entry.captured event came and no receipt shows this workflow started (first 2026-10-11 10:15 p.m. Arizona time).  
   *Fix guide:* Open s-00-welcome in Inngest and look for the entry.captured event. If Inngest never got it, the send was lost. If it did, the workflow ran 
48. `wf:s-04c-staff-booked-alert`: 1 booking.created event came and no receipt shows this workflow started (first 2026-10-11 10:15 p.m. Arizona time).  
   *Fix guide:* Open s-04c-staff-booked-alert in Inngest and look for the booking.created event. If Inngest never got it, the send was lost. If it did, the 
49. `wf:slo-genuine-reply`: 1 message.inbound event came and no receipt shows this workflow started (first 2026-10-11 10:15 p.m. Arizona time).  
   *Fix guide:* Open slo-genuine-reply in Inngest and look for the message.inbound event. If Inngest never got it, the send was lost. If it did, the workflo

### 3 Customer records and journey  (46)

50. `calls:booked-no-outcome`: 2 booked calls ended with no outcome  
   *Fix guide:* Log the outcome on the calendar or the closer desk. Recon (AG-07) on the daily pulse is the only tripwire. Do not build a second watchdog. D
51. `calls:booking-webhook`: 1 booking webhook accepted with no bookings row  
   *Fix guide:* The booking webhook was accepted but the bookings row was not saved. Check the booking handler. Recon (AG-07) on the daily pulse is the only
52. `catalog-data:client_custom_fields`: client_custom_fields: 26 of 26 saved result rows are missing a business result.  
   *Fix guide:* Open the client_custom_fields rows counted by the catalog data check and finish the missing result. Do not auto-fix. Chris fixes reds.
53. `catalog-data:repair_decision_log`: repair_decision_log: 6 of 6 saved result rows are missing a business result.  
   *Fix guide:* Open the repair_decision_log rows counted by the catalog data check and finish the missing result. Do not auto-fix. Chris fixes reds.
54. `catalog-display:desks-a.json:client-control-panel.html:Close round button`: Close round button: no saved receipt or linked result exists for this exact check. Required: A card-stacking round.closeout receipt must name the closed stage and engagement-complete result.  
   *Fix guide:* Create one real result through the named control, then let the read-only pulse judge it. Do not auto-fix. Chris fixes reds.
55. `catalog-display:desks-a.json:client-control-panel.html:Lender row: Approved $ amount input`: Lender row: Approved $ amount input: no saved receipt or linked result exists for this exact check. Required: An Approved bank-decision receipt must link to an application with a positive saved approv  
   *Fix guide:* Create one real result through the named control, then let the read-only pulse judge it. Do not auto-fix. Chris fixes reds.
56. `catalog-display:desks-a.json:client-control-panel.html:Lender row: Approved button`: Lender row: Approved button: no saved receipt or linked result exists for this exact check. Required: An Approved bank-decision receipt must link to the exact application and named staff actor.  
   *Fix guide:* Create one real result through the named control, then let the read-only pulse judge it. Do not auto-fix. Chris fixes reds.
57. `catalog-display:desks-a.json:client-control-panel.html:Lender row: Declined button`: Lender row: Declined button: no saved receipt or linked result exists for this exact check. Required: A Denied bank-decision receipt must link to the exact application and named staff actor.  
   *Fix guide:* Create one real result through the named control, then let the read-only pulse judge it. Do not auto-fix. Chris fixes reds.
58. `catalog-display:desks-a.json:client-control-panel.html:Lender row: Doesn't count / Count a`: Lender row: Doesn't count / Count again button (exclude or reinstate an approval, asks for a reason): no saved receipt or linked result exists for this exact check. Required: The exclusion or reinstat  
   *Fix guide:* Create one real result through the named control, then let the read-only pulse judge it. Do not auto-fix. Chris fixes reds.
59. `catalog-display:desks-a.json:client-control-panel.html:Mark round submitted button`: Mark round submitted button: 4 of 7 saved results failed the exact check. Required: A card-stacking round.submitted receipt must carry the client, stage, source, and round number.  
   *Fix guide:* Open the named result rows and fix the broken link or value. Do not auto-fix. Chris fixes reds.
60. `catalog-display:desks-a.json:client-portal.html:Refer a friend: Get my link button`: Refer a friend: Get my link button: no saved receipt or linked result exists for this exact check. Required: A client account with a referral link must point to one active same-company affiliate with   
   *Fix guide:* Create one real result through the named control, then let the read-only pulse judge it. Do not auto-fix. Chris fixes reds.
61. `catalog-display:desks-b.json:contracts.html:PDF editor: Save boxes`: PDF editor: Save boxes: no saved receipt or linked result exists for this exact check. Required: A saved PDF wording must contain real boxes whose page, signer, type, and label are valid.  
   *Fix guide:* Create one real result through the named control, then let the read-only pulse judge it. Do not auto-fix. Chris fixes reds.
62. `catalog-display:desks-b.json:contracts.html:Wording list: click a row to edit it`: Wording list: click a row to edit it: no saved receipt or linked result exists for this exact check. Required: Each PDF wording row must link to its document and have one stored page size per page.  
   *Fix guide:* Create one real result through the named control, then let the read-only pulse judge it. Do not auto-fix. Chris fixes reds.
63. `catalog-display:desks-b.json:csm-queue.html:Save these answers button (needs at least one `: Save these answers button (needs at least one answer): no saved receipt or linked result exists for this exact check. Required: A saved insight must link the client, recorder, non-empty answers, and t  
   *Fix guide:* Create one real result through the named control, then let the read-only pulse judge it. Do not auto-fix. Chris fixes reds.
64. `clickfunnels-night-job`: no active ClickFunnels connection, so the night job has nothing to pull.  
   *Fix guide:* Fix clickfunnels-analytics-sweeper so its 07:15 UTC pass writes funnel_page_stats (src/workflows/clickfunnels-analytics-sweeper.mjs). Do not
65. `closer-setup:calendar-late`: 2 people are past due to join the booking page. Justice Nikkel (closer): asked Oct 7, 7 days ago, due Oct 10, not a host on the booking page. Sarah Blankstein (sales manager): asked Oct 7, 7 days ago,  
   *Fix guide:* A team member is past due to join the booking page. Send the ClickFunnels invite, nudge, give more days, or drop the ask. Only a ClickFunnel
66. `contracts:signed-not-stored`: 1 signed contract has no stored signed file: 27b299b3-2be1-4c44-be44-9915d2ee6270.  
   *Fix guide:* Save the signed file on the contract. Do not sign again as the client. Recon (AG-07) is the one tripwire. Do not add a second watchdog. Do n
67. `documents:cannot-open`: A client cannot open their file: 7 document rows have no version a client can open  
   *Fix guide:* Restore the current version and the stored file on the document row. This check only asks the store whether a file exists. It does not open 
68. `fulfillment:next-action`: 1 repair file past the clock and the screen shows no next step. Look at 64212914-1e0d-4ec1-bd6e-07fa156108b8 (analysis).  
   *Fix guide:* Open the repair desk and set the next step on the file that has been waiting. Recon (AG-07) is the one tripwire. Do not auto-fix from this p
69. `gap-door-batch-jobs:catalog-job:jobs.json:workflow:inquiry-call-sweeper:inquiry-call-sweep`: workflow:inquiry-call-sweeper — inquiry-call-sweeper (src/workflows/inquiry-call-sweeper.mjs): trigger cron */15 * * * *. every 15 minutes places the AI bureau calls whose wait has elapsed (call_due_a  
   *Fix guide:* Add a non-empty fake-data run for workflow:inquiry-call-sweeper that judges this exact final result.
70. `gap-door-batch-jobs:catalog-job:jobs.json:workflow:meet-transcript-sweeper:meet-transcript`: workflow:meet-transcript-sweeper — meet-transcript-sweeper (src/workflows/meet-transcript-sweeper.mjs): trigger cron */10 * * * *. every 10 minutes picks new Meet recordings from Drive and pulls the w  
   *Fix guide:* Add a non-empty fake-data run for workflow:meet-transcript-sweeper that judges this exact final result.
71. `gap-door-batch-jobs:catalog-job:jobs.json:workflow:repair-bureau-response-reader:repair-bu`: workflow:repair-bureau-response-reader — repair-bureau-response-reader (src/workflows/repair-bureau-response.mjs): trigger events docs.received. reads a bureau answer that arrived as a document and re  
   *Fix guide:* Add a non-empty fake-data run for workflow:repair-bureau-response-reader that judges this exact final result.
72. `gap-door-batch-webhooks:door-batch:webhook-lendflow-contract`: The Lendflow door and fail-closed HMAC code run, but no real Lendflow payload has confirmed the provider's signature scheme or stage words.  
   *Fix guide:* Keep this red until one real or sandbox Lendflow payload confirms the header, HMAC scheme, and stage words.
73. `gap-pipeline-boards:pipeline:age`: 1 card sits past a stage time limit: Repair Analysis: 1 card past 1 hour (oldest 9 days).  
   *Fix guide:* Open Pipeline and read the stage the card sits in. The time limit is written in code; a card past it is not moving. The pulse only reports. 
74. `gap-trip-repair:trip:repair`: 1 of 1 customer who started the repair trip in the last 60 days is stuck. FH-000507 stopped at "round 1 letters made": the file has been in "Analysis" past its clock of 1 hour. The letter engine is wa  
   *Fix guide:* Open the client on the Repair desk and read the step named. A missing program, letter or card move means the handler behind it did not run: 
75. `pipeline:clients`: 1 paying client with no progress in 72+ hours (not escalated yet).  
   *Fix guide:* Check Client Control Panel and DPC-05 escalations. Do not auto-fix from this pulse.
76. `pipeline:repair`: 1 repair file need staff (stuck stage or letters waiting).  
   *Fix guide:* Open Repair desk and work the stuck queue. Do not auto-fix from this pulse.
77. `repair-letter-round`: 1 repair file has sat in analysis past the 1 hour clock with no letters made. Look at 64212914-1e0d-4ec1-bd6e-07fa156108b8 (analysis).  
   *Fix guide:* A letter round should have been written and was not. A person can look on the Repair desk. Do not mail it. Recon (AG-07) is the only tripwir
78. `wf:ai-set-01-josh-setter`: 1 booking.created event came and no receipt shows this workflow started (first 2026-10-11 10:15 p.m. Arizona time).  
   *Fix guide:* Open ai-set-01-josh-setter in Inngest and look for the booking.created event. If Inngest never got it, the send was lost. If it did, the wor
79. `wf:ai-set-03-no-answer-cadence`: 1 call.completed event came and no receipt shows this workflow started (first 2026-10-11 10:15 p.m. Arizona time).  
   *Fix guide:* Open ai-set-03-no-answer-cadence in Inngest and look for the call.completed event. If Inngest never got it, the send was lost. If it did, th
80. `wf:ai-set-04-3way-handoff`: 1 booking.created event came and no receipt shows this workflow started (first 2026-10-11 10:15 p.m. Arizona time).  
   *Fix guide:* Open ai-set-04-3way-handoff in Inngest and look for the booking.created event. If Inngest never got it, the send was lost. If it did, the wo
81. `wf:bs-01-precall-launcher`: 1 booking.created event came and no receipt shows this workflow started (first 2026-10-11 10:15 p.m. Arizona time).  
   *Fix guide:* Open bs-01-precall-launcher in Inngest and look for the booking.created event. If Inngest never got it, the send was lost. If it did, the wo
82. `wf:c-02b-inquiry-removal-requested`: 3 deposit.paid events came and no receipt shows this workflow started (first 2026-10-11 10:14 p.m. Arizona time).  
   *Fix guide:* Open c-02b-inquiry-removal-requested in Inngest and look for the deposit.paid event. If Inngest never got it, the send was lost. If it did, 
83. `wf:dpc-02-call-outcome-enforcement`: 1 booking.created event came and no receipt shows this workflow started (first 2026-10-11 10:15 p.m. Arizona time).  
   *Fix guide:* Open dpc-02-call-outcome-enforcement in Inngest and look for the booking.created event. If Inngest never got it, the send was lost. If it di
84. `wf:dpc-05-no-progress-escalation`: 1 booking.created event came and no receipt shows this workflow started (first 2026-10-11 10:15 p.m. Arizona time).  
   *Fix guide:* Open dpc-05-no-progress-escalation in Inngest and look for the booking.created event. If Inngest never got it, the send was lost. If it did,
85. `wf:ds-01-repair-referral`: 1 call.completed event came and no receipt shows this workflow started (first 2026-10-11 10:15 p.m. Arizona time).  
   *Fix guide:* Open ds-01-repair-referral in Inngest and look for the call.completed event. If Inngest never got it, the send was lost. If it did, the work
86. `wf:f-02-portal-id-missing`: 5 round.started events came and no receipt shows this workflow started (first 2026-10-11 10:14 p.m. Arizona time).  
   *Fix guide:* Open f-02-portal-id-missing in Inngest and look for the round.started event. If Inngest never got it, the send was lost. If it did, the work
87. `wf:f-05-inquiry-cleanup-gate`: 3 round.approved events came and no receipt shows this workflow started (first 2026-10-11 10:14 p.m. Arizona time).  
   *Fix guide:* Open f-05-inquiry-cleanup-gate in Inngest and look for the round.approved event. If Inngest never got it, the send was lost. If it did, the 
88. `wf:round-started-client-notify`: 5 round.started events came and no receipt shows this workflow started (first 2026-10-11 10:14 p.m. Arizona time).  
   *Fix guide:* Open round-started-client-notify in Inngest and look for the round.started event. If Inngest never got it, the send was lost. If it did, the
89. `wf:s-01-new-lead-intake`: 1 entry.captured event came and no receipt shows this workflow started (first 2026-10-11 10:15 p.m. Arizona time).  
   *Fix guide:* Open s-01-new-lead-intake in Inngest and look for the entry.captured event. If Inngest never got it, the send was lost. If it did, the workf
90. `wf:s-02-incomplete-survey-nudge`: 1 entry.captured event came and no receipt shows this workflow started (first 2026-10-11 10:15 p.m. Arizona time).  
   *Fix guide:* Open s-02-incomplete-survey-nudge in Inngest and look for the entry.captured event. If Inngest never got it, the send was lost. If it did, t
91. `wf:s-04-call-booked`: 1 booking.created event came and no receipt shows this workflow started (first 2026-10-11 10:15 p.m. Arizona time).  
   *Fix guide:* Open s-04-call-booked in Inngest and look for the booking.created event. If Inngest never got it, the send was lost. If it did, the workflow
92. `wf:s-04b-booking-reminders`: 1 booking.created event came and no receipt shows this workflow started (first 2026-10-11 10:15 p.m. Arizona time).  
   *Fix guide:* Open s-04b-booking-reminders in Inngest and look for the booking.created event. If Inngest never got it, the send was lost. If it did, the w
93. `wf:s-offer-bucket`: 1 call.completed event came and no receipt shows this workflow started (first 2026-10-11 10:15 p.m. Arizona time).  
   *Fix guide:* Open s-offer-bucket in Inngest and look for the call.completed event. If Inngest never got it, the send was lost. If it did, the workflow ra
94. `wf:s-portal-invite`: 1 booking.created event came and no receipt shows this workflow started (first 2026-10-11 10:15 p.m. Arizona time).  
   *Fix guide:* Open s-portal-invite in Inngest and look for the booking.created event. If Inngest never got it, the send was lost. If it did, the workflow 
95. `wf:sys-01-client-value-calculator`: 3 round.approved events came and no receipt shows this workflow started (first 2026-10-11 10:14 p.m. Arizona time).  
   *Fix guide:* Open sys-01-client-value-calculator in Inngest and look for the round.approved event. If Inngest never got it, the send was lost. If it did,

### 4 Staff and internal tools  (17)

96. `catalog-data:bank_transactions`: bank_transactions: 38 of 1116 saved result rows are missing a business result.  
   *Fix guide:* Open the bank_transactions rows counted by the catalog data check and finish the missing result. Do not auto-fix. Chris fixes reds.
97. `catalog-display:desks-b.json:financeos.html#helper:Suggestion buttons (3: due this week, w`: Suggestion buttons (3: due this week, which card first, got declined paste the letter): no saved receipt or linked result exists for this exact check. Required: Each exact suggestion input must finish  
   *Fix guide:* Create one real result through the named control, then let the read-only pulse judge it. Do not auto-fix. Chris fixes reds.
98. `catalog:proof-linked`: 3919 of 3942 unique company items link to executable proof at the required level; 23 remain red or unproved.  
   *Fix guide:* Open the generated coverage catalog, add real proof for red items, rebuild it, and keep moving. Never mark an item green without executable 
99. `gap-door-batch-jobs:door-batch:ad-video-worker-result`: The ad-video worker has 4 stuck upload claim(s) and 0 stuck export claim(s).  
   *Fix guide:* Review the named ad-video rows before clearing or retrying a spend claim.
100. `gap-door-batch-keys:door-batch:keys-live-proof`: The shared key batch proves key rules with fake values, but it does not read every live value.  
   *Fix guide:* Add safe live checks for the keys that matter. Never print a secret value.
101. `gap-door-batch-webhooks:door-batch:webhook-ad-video-worker`: The ad-video worker secret guard is closed. The ad-video worker has 4 stuck upload claim(s) and 0 stuck export claim(s).  
   *Fix guide:* Review the named ad-video rows before clearing or retrying a spend claim.
102. `gap-records:bureau-config:complete`: The AI bureau config is not filled in: no service number for EX, EQ, TU; no menu path for EX, EQ, TU.  
   *Fix guide:* Fill each bureau's service number and menu path on the Lenders page, AI bureau config tab (or POST /api/ai-bureau-config). Do not invent num
103. `live-playwright:desks`: Last desk sweep was 155.4h ago (score 100/100, 41/41 passed). Too old.  
   *Fix guide:* Run node scripts/live-playwright-sweep.mjs on the Mac and wire a nightly launchd/cron.
104. `sales-manager:read-api`: sales floor or my numbers read API would answer 500: the sales floor read failed (the sales floor read took longer than 12 seconds).  
   *Fix guide:* Recon (AG-07) is the one tripwire. Leave that agent on the morning pulse. Do not auto-fix. Do not add another watcher. Do not open the close
105. `sales-manager:totals`: manager totals cannot be read: the sales floor read took longer than 12 seconds  
   *Fix guide:* Recon (AG-07) is the one tripwire. Leave that agent on the morning pulse. Do not auto-fix. Do not add another watcher. Do not open the close
106. `wf:af-02-referral-ownership-capture`: 1 entry.captured event came and no receipt shows this workflow started (first 2026-10-11 10:15 p.m. Arizona time).  
   *Fix guide:* Open af-02-referral-ownership-capture in Inngest and look for the entry.captured event. If Inngest never got it, the send was lost. If it di
107. `wf:at-01-first-touch-capture`: 1 entry.captured event came and no receipt shows this workflow started (first 2026-10-11 10:15 p.m. Arizona time).  
   *Fix guide:* Open at-01-first-touch-capture in Inngest and look for the entry.captured event. If Inngest never got it, the send was lost. If it did, the 
108. `wf:bc-01-customer-responsiveness`: 5 round.started events came and no receipt shows this workflow started (first 2026-10-11 10:14 p.m. Arizona time).  
   *Fix guide:* Open bc-01-customer-responsiveness in Inngest and look for the round.started event. If Inngest never got it, the send was lost. If it did, t
109. `wf:bc-02-customer-friction`: 5 round.started events came and no receipt shows this workflow started (first 2026-10-11 10:14 p.m. Arizona time).  
   *Fix guide:* Open bc-02-customer-friction in Inngest and look for the round.started event. If Inngest never got it, the send was lost. If it did, the wor
110. `wf:f-03-round-submitted`: 3 round.submitted events came and no receipt shows this workflow started (first 2026-10-11 10:14 p.m. Arizona time).  
   *Fix guide:* Open f-03-round-submitted in Inngest and look for the round.submitted event. If Inngest never got it, the send was lost. If it did, the work
111. `wf:f-04-round-approvals`: 3 round.approved events came and no receipt shows this workflow started (first 2026-10-11 10:14 p.m. Arizona time).  
   *Fix guide:* Open f-04-round-approvals in Inngest and look for the round.approved event. If Inngest never got it, the send was lost. If it did, the workf
112. `wf:s-doc-collection`: 3 deposit.paid events came and no receipt shows this workflow started (first 2026-10-11 10:14 p.m. Arizona time).  
   *Fix guide:* Open s-doc-collection in Inngest and look for the deposit.paid event. If Inngest never got it, the send was lost. If it did, the workflow ra

### 5 Plumbing (the heartbeat checking itself)  (2)

113. `audit:briefs-sent`: No morning report was sent for 2026-10-13. Sending it failed. Error: {"code":20003,"message":"authentication failed, account AC[twilio-id-removed] with status 4 is not active",.  
   *Fix guide:* Read yesterday's row in morning_briefs and its delivery error. The text goes out right after the 6 a.m. pulse.
114. `audit:not-checked`: 9 checks were not checked: gmail, meta-server-events, gap:auth-reset-mail, keys:send-fence-open, keys:inngest-event-key, keys:launch-secrets-present, keys:credit-pull-live-allowed, keys:vendor-key-rea  
   *Fix guide:* Turn each one into a real check, or into a nothing-to-judge row with a reason the computer can check again. The rules are in src/pulse/na-co

## 2. NOT PROVED YET: no test yet, so we do not know

These might work fine. There is simply no automatic test that proves the exact result. Counts by importance, then the biggest groups:

**1 Money: 149**  
Biggest groups: catalog-display / desks-a.json:campaign-manager.html (11); catalog-display / desks-f.json:present.html (+ present.js, contract-send.js) (11); catalog-display / desks-f.json:products-commissions.html (11); catalog-display / desks-a.json:closer-dashboard.html (10); catalog-display / desks-f.json:sales-floor.html (+ sales-floor.js) (10); catalog-display / desks-e.json:public/app/money-transfers.html (8)

**2 Customer messages: 82**  
Biggest groups: catalog-display / desks-a.json:agent-editor.html (17); catalog-display / desks-c.json:money-alerts.html (8); catalog-display / desks-e.json:public/app/pipeline.html (8); catalog-display / desks-e.json:public/app/ops-admin.html (5); catalog-display / desks-f.json:present.html (+ present.js, contract-send.js) (4); catalog-display / desks-a.json:client-portal.html (3)

**3 Customer records and journey: 383**  
Biggest groups: catalog-display / desks-e.json:public/app/pipeline.html (67); catalog-display / desks-c.json:inquiry-remover.html (36); catalog-display / desks-a.json:client-control-panel.html (18); catalog-display / desks-a.json:brand-studio.html (14); catalog-display (12); catalog-display / desks-b.json:contracts.html (10)

**4 Staff and internal tools: 939**  
Biggest groups: gap-catalog-flow / flow:flow (123); catalog-display / desks-c.json:marketing-command-center.html (77); catalog-display / desks-f.json:sidebar.fragment.html (33); catalog-display / desks-c.json:hiring.html (31); catalog-display / desks-b.json:creative-factory.html (30); catalog-display / desks-f.json:present.html (+ present.js, contract-send.js) (27)

## 3. NOT CHECKED: should be zero

- `gap-leads:lead:pipe-cut-with-traffic`: The ad table has no row for 2026-10-12 or 2026-10-13, so we cannot tell if ads sent people. Zero real people saved on /roadmap since 2026-10-12.
- `gap:auth-reset-mail`: This run is not the live server and its copy of RESEND_API_KEY is empty or masked, so it was not proved here. Resend sent 12 emails in 7 days.
- `gmail`: Gmail oauth is not set — prove search skipped
- `keys:credit-pull-live-allowed`: This run is not the live server (no Netlify or Lambda marker), so its settings are a laptop copy and were not read as the live site's.
- `keys:inngest-event-key`: This run is not the live server (no Netlify or Lambda marker), so its settings are a laptop copy and were not read as the live site's.
- `keys:launch-secrets-present`: This run is not the live server (no Netlify or Lambda marker), so its settings are a laptop copy and were not read as the live site's.
- `keys:send-fence-open`: The company send switch in the CRM is on. This run is not the live server (no Netlify or Lambda marker), so its settings are a laptop copy and were not read as 
- `keys:vendor-key-read`: Twilio was not asked: TWILIO_SEND_ACCOUNT_SID is a row of asterisks in this run. Resend was not asked: RESEND_API_KEY is a row of asterisks in this run.
- `meta-server-events`: all 7 events in 24 h were test or company sessions, which Meta never gets

## 4. WORKING: checked and green

| What it touches | Working |
|---|---:|
| 1 Money | 138 |
| 2 Customer messages | 70 |
| 3 Customer records and journey | 191 |
| 4 Staff and internal tools | 304 |
| 5 Plumbing (the heartbeat checking itself) | 6 |

**1 Money:** reg (50), gap-funnels (12), job (8), payments (7), catalog-data (6), finance-os (6), gap-money-funding (6), funding (5), checkout (3), gap-pipeline-facts (3), ads-meta (2), catalog-display (2), finance-os-setup (2), payments-unmatched (2)  
**2 Customer messages:** reg (21), msg (7), job (6), handoff (5), catalog-display (4), email (4), gap-sms (4), consent (3), nurture (3), opt-out (3), gap-outside-inngest (3), webhooks (3), gap (1), contracts (1)  
**3 Customer records and journey:** reg (96), gap-funnels (15), gap-crm-links (7), job (6), portal (6), catalog-data (5), gap-pixels (4), gap-underwrite (4), gap (3), documents (3), inquiry (3), gap-soft-pull (3), brain (2), calls (2)  
**4 Staff and internal tools:** reg (230), job (22), catalog-data (14), owner-tools (5), marketing-queue (3), gap-pixels (3), ai-agents (2), crm-links (2), gap-jobs (2), social (2), gap-staff (2), training (2), wf (2), health (1)  
**5 Plumbing (the heartbeat checking itself):** audit (6)  

## 5. NOTHING TO JUDGE

237 items are verified as having nothing to judge today (a feature that is switched off, no traffic yet, nothing waiting). Each one is re-checked every morning and goes red the day it stops being true.
