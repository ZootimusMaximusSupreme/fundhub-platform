# Recorded vendor fixtures

`funding-vertical.json` is a **recorded payload shape**, not live data. No vendor
key exists for Apify, AdLibrary.com or anything else (W2 §6.3), so this is what
the whole of Layer 2 is built and tested against.

Every advertiser domain ends in `.test`, which is a reserved TLD that can never
resolve. Nothing in this file names a real company.

The rows are deliberately awkward, because the interesting code paths in Layer 2
are the ones where something is missing or something is wrong:

| Row | What it is there to exercise |
|---|---|
| `cq-1001` | The long runner — five weekly observations, broad placement spread |
| `cq-1002` | Landing-page change: the destination path changes mid-run |
| `cq-1003` | A variant of the same advertiser + angle + domain (variant count) |
| `cq-1004` | A destination the vendor returned that is not a URL at all |
| `fr-2001` | Re-launch: live, dark for two weeks, live again |
| `sc-3001` | A banned claim — guaranteed approval, no credit check, removal promise |
| `ea-4001` | Death watch: seen once, five weeks ago, never again |
| `nc-5001` | New entrant: first seen in the latest week, not on the watch-list |
| `tk-6001` | TikTok, with the ordinal performance bucket it is the only source of |
| `yt-6002` | Cross-platform echo: same angle and domain on a third platform |
| `gg-7001` | A search ad with no headline and no media |

Dates are Sundays, matching the weekly pull cadence in §6.6.

To replay the whole recorded history rather than one day, call the ingest job
without an `observedOn` override — each row carries its own `observed_on`, so a
single pass produces the multi-week sequence the signals are computed from.
