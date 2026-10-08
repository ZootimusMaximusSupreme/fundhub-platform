# Partners gap checks — lane 14

Lane: affiliates, white-label, commission payouts.

File: `src/pulse/coverage/gap-partners.mjs`  
Test: `src/pulse/coverage/gap-partners.test.mjs`

Read-only. Does not pay anyone. Does not create a partner. Does not edit a page.

Tripwire is the existing Recon agent (AG-07). No second watchdog.

## What this does not repeat

Slice 17 (`slice-17-affiliates.mjs`) and slice 31 (`slice-31-affiliate-wl.mjs`) already watch the morning list and whether a monthly job has gone quiet. This lane does not check the registry, the machine list, or cron silence again.

## The four breaks

| Check | Pass | Fail |
|---|---|---|
| `partners:referral-link` | Clicks in the last 30 days match an affiliate, and every active affiliate has a code. The click door is routed and the start page still records it. | A click matched nobody, an active affiliate has no code, or the click door is gone. |
| `partners:commission-payable` | No one is stuck with earned money the payout rules say is payable. | Converted commission, signed license, tax form on file, at least $50, period already closed, and it is not on a pending, processing, or paid run. Held money with a missing license or tax form is allowed. Under $50 is allowed. |
| `partners:login-door` | Login still accepts a partner account. Each active partner has an account that can sign in, or there is no active partner. | Login route is gone, login no longer accepts a partner, or active partners cannot sign in. |
| `partners:payout-stuck` | No affiliate or partner payout has sat in processing for more than 7 days. | A run is still processing after 7 days. |

No database in the run: each check is `skip`, unless the click door or the login door is already missing. That is a fail with no database.

A fail says to tell Recon. It does not pay the run and it does not mint a partner.
