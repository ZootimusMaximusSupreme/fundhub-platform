# Clarity Data Export

**Owner law (2026-09-29):** Clarity Data Export: one pull per time Chris asks. Go through `src/adapters/clarity-export.mjs` only. Do not curl or fetch `https://www.clarity.ms/export-data` yourself. Do not retry. If that one pull fails, say the error and stop. Also never exceed Microsoft's 10 requests per project per day; the helper blocks call 11 before any HTTP request.

## Never

- A second Clarity export call for the same ask (another dimension set, another `numOfDays`, a retry)
- `curl` or raw `fetch` to `https://www.clarity.ms/export-data`
- Print `CLARITY_DATA_EXPORT_TOKEN` or burn quota to "check"

## Always

- Call `fetchClarityLiveInsights` from `src/adapters/clarity-export.mjs` once per ask
- If that one pull fails, report the error and stop
- Stop when the helper says the Microsoft daily cap is used
