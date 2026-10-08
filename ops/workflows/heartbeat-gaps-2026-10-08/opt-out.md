# SMS and email opt-out

Lane: SMS and email opt-out only. Read only. This check does not send a message. It does not change an opt-out row.

breaks: 3
new checks: 3

One tripwire stays Recon. No second watchdog.

Voice is not this lane. Consent papers are not this lane. The SMS gap already skips people who opted out of texts. This check does not look at whether a text was queued.

## Breaks

| id | What fails |
|---|---|
| `opt-out:table-unreadable` | The opt-out table cannot be read. |
| `opt-out:stop-did-not-stick` | In the last 30 days, a person sent STOP or unsubscribe (the whole message, same words as the inbound handler) and there is no opt-out row that covers it. A later START means the stop did stick. |
| `opt-out:send-ignores` | A client text or email send path does not read opt-out, or someone who was still opted out got a text or email after that time. |

The send path read looks at code. The gate must read opt-out for the channel on the message. The dispatcher must call that gate before it sends. A direct Twilio, Resend, or Mailgun send that is not an owner or staff alert is a miss.

Owner and staff alerts are not a client opt-out. They stay off this list: the morning pulse text, the instant pulse text, the ad-video text, the Blake lead text, staff pay mail, and staff login mail.

The count is read only. It counts texts and emails that left (`sent`, `delivered`, `complained`) after the opt-out time, on that same channel, while the opt-out is still on. A later delivery stamp does not count as a new send.

## New checks

`gapChecks` in `src/pulse/coverage/gap-opt-out.mjs`. Each row is `{ id, status, detail, suggestedFix }` with PASS, FAIL, or skip.

## Prove

`node --test src/pulse/coverage/gap-opt-out.test.mjs`
