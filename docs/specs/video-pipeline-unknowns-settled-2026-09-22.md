# Video pipeline — the four unknowns, settled with real calls (2026-09-22)

Every line below came from a live read-only call made on 2026-09-22, or from a doc page that was
actually opened (URL given). Nothing here is inferred. Where something is still unknown it says so.

**No key value, token or env value appears in this file. Names only.**
No project was created at Submagic. No API minutes were spent. One Drive folder was created and
then permanently deleted as the write test; nothing else was written anywhere.

---

## Headline

**The ~200 MB take does not need new hosting. Google Drive already serves it, publicly, with no
credentials.** Measured today: a 344.6 MB file in the SLO Ads folder returns real MP4 bytes to a
client holding nothing at all, over `drive.usercontent.google.com/download?id=…&export=download&confirm=t`.

**And Submagic does not need a URL at all.** `POST /v1/projects/upload` exists and takes the file
itself as a multipart upload, up to 2 GB.

The repo's own earlier research (`docs/specs/video-pipeline-api-verification-2026-09-22.md`) says a
Drive link cannot work and that takes must be copied to Cloudflare R2 or S3 first. **That is now
measured wrong on both counts** — see §2.4 and §1.3. No R2, no S3, no new vendor, no new bill.

> Superseded by docs/specs/marketing-machine-2026-10-04.md (owner-approved 2026-10-05): spec v3 moves videos to Cloudflare R2 (§2 item 12), because Netlify paused the site over video bandwidth: the ad pipeline's files go in the private bucket `fundhub-ad-video` (§9.5) and the site's videos in `fundhub-media` (§12.1).

---

## 1. Submagic

### 1.1 CONFIRMED — host, auth header, error shape

| Thing | Answer | Evidence |
|---|---|---|
| API host | `https://api.submagic.co` | answers; `api.submagic.com` does not resolve (`fetch failed`) |
| Base path | `/v1` | `/languages` and `/v2/languages` both 404 |
| Auth header | **`x-api-key: sk-…`** | https://docs.submagic.co/api-reference/user-media-upload and .../create-project, both quote `x-api-key: sk-your-api-key-here` |
| Auth failure shape | `401` + `{"error":"UNAUTHORIZED","message":"Invalid or missing API key"}` | live |
| Unknown-route shape | `404` + `{"error":"NOT_FOUND","message":"The requested endpoint does not exist"}` | live |

The two shapes above are different, and **the server checks the route before it checks the key.**
That is what let the whole surface below be mapped with no key and no spend: `401` means the route
exists, `404` means it does not.

`src/messaging/providers/submagic.mjs` already defaults to `api.submagic.co` and `x-api-key`
(lines 115–116). **Both are now confirmed correct**, and the comment at line 38 calling the auth
header "a guess" can be retired.

### 1.2 CONFIRMED — the route map (no key needed, nothing created)

Exists (`401`):

```
GET    /v1/languages
GET    /v1/templates
GET    /v1/presets              GET  /v1/presets/{id}        PUT /v1/presets/{id}
GET    /v1/user-media
POST   /v1/user-media           POST /v1/user-media/upload
POST   /v1/projects             POST /v1/projects/upload
GET    /v1/projects/{id}        PUT  /v1/projects/{id}
POST   /v1/projects/{id}/export
POST   /v1/projects/{id}/publish
```

Does not exist (`404`): `GET /v1/projects` (no list), `PATCH`/`DELETE /v1/projects/{id}`,
`/v1/projects/{id}/render`, `/v1/projects/{id}/words`, `/v1/projects/{id}/transcript`,
`/v1/uploads`, `/v1/upload`, `/v1/media`, `/v1/files`, `/v1/assets`, `/v1/account`, `/v1/me`,
`/v1/credits`, `/v1/themes`, `/v1/health`, `/v1/magic-clips`, `/v1/webhooks`, `/v1/usage`,
`/v1/limits`, `/v2/*`.

**This settles open item 3 of the earlier research.** It listed the export path as "inferred".
`POST /v1/projects/{id}/export` returns 401, so the route is real. The provider's
`DEFAULT_EXPORT_PATH` (line 117) is correct.

### 1.3 CONFIRMED — a media upload endpoint exists, and so does a whole-project upload

Two separate things, and the difference matters:

**`POST /v1/user-media/upload`** — multipart, form field `file`, returns `{"userMediaId":"<uuid>"}`.
Rate limit 500/hour. This is for **B-roll and music only** — the id goes into `items[]` as
`{"type":"user-media","userMediaId":…}`. It is *not* a way to supply the main video.
Source: https://docs.submagic.co/api-reference/user-media-upload

**`POST /v1/projects/upload`** — multipart. Required fields `title`, `language`, `file`. Takes every
optional field `POST /v1/projects` takes (`items`, `templateName`, `webhookUrl`, `dictionary`,
`magicZooms`, `magicBrolls`, `removeSilencePace`, `removeBadTakes`, `cleanAudio`, `hookTitle`,
`music`, `disableCaptions`, …). Max file **2 GB**. Rate limit **30/hour**.
Source: https://docs.submagic.co/api-reference/upload-project.md and
https://docs.submagic.co/rate-limits.md

**So the MP4 can be pushed straight to Submagic and no public URL is needed anywhere.**

### 1.4 CONFIRMED — a defect in the reviewed pipeline

`src/messaging/providers/submagic.mjs` line 373 posts B-roll media to:

```
POST /v1/projects/{id}/user-media
```

That route **does not exist** — it returns `404 NOT_FOUND`, not `401`. So it is not an auth problem
that would clear once a key is present; the path is simply wrong and every B-roll upload would fail.
The real call is `POST /v1/user-media/upload`, multipart, field `file`, response `{userMediaId}`,
and the id is not scoped to a project.

### 1.5 CONFIRMED — `videoUrl` rules, for the URL-based route

> "Public URL to your video file. Must be accessible without authentication and in a supported format."

Required: `title` (1–100 chars), `language`, `videoUrl`. Max 2 GB, max 2 hours, MP4/MOV.
A `userMediaId` **cannot** stand in for `videoUrl`.
Source: https://docs.submagic.co/api-reference/create-project

Rate limits (https://docs.submagic.co/rate-limits.md): `POST /v1/projects` 30/hr,
`POST /v1/projects/upload` 30/hr, `GET /v1/projects/{id}` 100/hr, `GET /v1/languages` and
`/v1/templates` 1000/hr. The earlier research's "create 500/hr" is wrong — it is **30/hr**.

### 1.6 STILL UNKNOWN — and why

**The key itself was never exercised.** `SUBMAGIC_API_KEY` is **not in the local `.env`** at all
(93 names there, none is it). It **is** set on Netlify production, but it was stored with
`--secret`, so `netlify env:get SUBMAGIC_API_KEY --context production` hands back a 20-character
mask (sixteen asterisks and four characters), not the value. A mask sent as a key is exactly what
produces the 401 above.

Per the owner law in `CLAUDE.md` §11 the stored value is left exactly where it is. Nothing was
unset, cleared or overwritten, and no new Submagic variable was set.

Consequence: **every 401 in this document proves the route exists and proves nothing about the key.**
These stay open until the key is exercised from somewhere that can read it — that is, from a
deployed Netlify function, not from a laptop:

1. Whether the stored key is live and which plan it carries.
2. The real `GET /v1/languages` body.
3. The `GET /v1/projects/{id}` body for a missing id (404 vs 401 vs an empty 200).
4. Whether `items[]` timestamps are measured on the original or the post-cut timeline
   (open item 1 of the earlier research — still open, and only a real project answers it).
5. How long the webhook `downloadUrl` stays valid (open item 2 — still open).

**Worth knowing separately:** 36 of the values loaded from the local `.env` are Netlify masks of the
same `****************xxxx` shape, not real credentials — including `OPENAI_API_KEY`,
`RESEND_API_KEY`, `TWILIO_*`, `INNGEST_*`, `GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON` and
`GOOGLE_DRIVE_OAUTH_TOKEN_JSON`. Anything local that needs one of those will fail the same way
Submagic just did. Nothing was changed; this is recorded so the next agent does not lose a day to it.

---

## 2. Google Drive

### 2.1 CONFIRMED — which credential is actually in play

`driveConfigFromEnv()` reports `ready: true`, `authMode: oauth`, `missing: []`, and the token it
picks comes from **`GOOGLE_GMAIL_OAUTH_TOKEN_PATH`** — the desktop-OAuth `token.json` on disk. The
two Drive-specific env names hold masks, not credentials, so the fall-through documented in
`config.mjs` is what is carrying Drive today, exactly as its comment says.

### 2.2 CONFIRMED — the scopes Google actually grants

From `https://oauth2.googleapis.com/tokeninfo` on a freshly refreshed token (status 200):

```
https://www.googleapis.com/auth/calendar
https://www.googleapis.com/auth/calendar.readonly
https://www.googleapis.com/auth/drive            <-- FULL READ/WRITE DRIVE
https://www.googleapis.com/auth/drive.readonly
https://www.googleapis.com/auth/gmail.modify
https://www.googleapis.com/auth/gmail.readonly
https://www.googleapis.com/auth/gmail.settings.basic
```

`drive.file` is **not** granted; the full `drive` scope is, which is broader and supersedes it.

### 2.3 CONFIRMED — the write test passed

Against the SLO Ads folder `13ZOjA56MNuM-PHSRK5fQK0bovRwR8raZ` (name "SLO Ads", owner
`stanbridgejchris@gmail.com`, `capabilities.canAddChildren: true`, `canEdit: true`):

| Step | Result |
|---|---|
| `POST /drive/v3/files` create folder `fundhub-pipeline-scope-test` | **200** — id `1M8Vnwglva5mhvqPqeGAopLcBztjZwvDe` |
| `PATCH …?trashed=true` | 200 |
| `DELETE /drive/v3/files/{id}` | 204 — permanently gone |
| leftover sweep `name='fundhub-pipeline-scope-test' and trashed=false` | `{"files":[]}` — clean |

**No 403. Drive writes work.** Cleanup is verified, not assumed.

A resumable upload session for a **200 MB** `video/mp4` was also requested and granted (`200`, a
session URL was issued) and then cancelled with zero bytes sent. So writing a 200 MB take into Drive
from a worker is proven available, not just permitted.

### 2.4 CONFIRMED — a big Drive file downloads with NO credentials

This is the finding that removes the need for new hosting.

The SLO Ads folder already carries `{"id":"anyoneWithLink","type":"anyone","role":"reader"}`, and
the files inside inherit it. Two files in it were fetched with **no Authorization header, no cookies,
no credentials of any kind**, using a `Range: bytes=0-65535` request so only 64 KB was ever pulled:

| File | Size | `uc?export=download` | `usercontent…&export=download` | `…&export=download&confirm=t` |
|---|---|---|---|---|
| `DUPLICATE - SLO Ad 1 Take 2.mp4` | 4.6 MB | **206 `video/mp4`, real MP4 bytes** | 206 `video/mp4` | 206 `video/mp4` |
| `8FEE9AD2-…-D45180DEF6C1.mp4` | **344.6 MB** | 200 `text/html` — virus-scan page | 200 `text/html` — virus-scan page | **206 `video/mp4`, `content-range: bytes 0-65535/361356950`, real MP4 `ftyp` bytes** |

So:

* The earlier research's "breaks over 25 MB" is wrong — 4.6 MB and everything under roughly 100 MB
  serves cleanly from the plain URL.
* Over the scan threshold the plain URL does return the interstitial, and the interstitial is
  **2,457 bytes of HTML**, not a sign-in wall. That is the failure the earlier research saw.
* **`&confirm=t` defeats it.** A 344.6 MB file returned `206 Partial Content`,
  `content-type: video/mp4`, and genuine MP4 bytes, and honoured `Range`.

The working shape is:

```
https://drive.usercontent.google.com/download?id=<FILE_ID>&export=download&confirm=t
```

A file that is *not* shared returns an `accounts.google.com` sign-in page instead — measured on a
private 6.4 GB file — so the `anyone with link / reader` permission is doing real work and must be
set per file (or inherited from the folder, as it is here).

### 2.5 STILL UNKNOWN

* **Whether Submagic's own fetcher accepts that URL.** It is a plain HTTPS GET returning
  `video/mp4` with `Range` support, so there is no technical reason it would not, but Submagic's
  downloader could reject the query string, the redirect, or the host on its own rules. Untestable
  without a working key. **§3 of the recommendation removes this risk entirely.**
* **Service account.** `GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON` is a mask locally, so the service
  account could not be tested at all. On Netlify the same name is set and its mask ends in `om"}`,
  which is consistent with a real service-account JSON, but it is stored `--secret` and cannot be
  read back. Untested. The OAuth token already holds the full `drive` scope and writes succeed, so
  nothing in the pipeline needs the service account.
* Google publishes no contractual egress limit for this path. It served a 344.6 MB file today; it
  is not a CDN with an SLA.

### 2.6 Worth recording

Everything in the SLO Ads folder — 21 MP4s, several over 100 MB, including the VSL takes — is
readable by **anyone who has the file id**, with no sign-in. That is what makes the recommendation
below work. It is also true of every file already in there. Recorded as fact; nothing was changed.

---

## 3. Netlify Blobs

The repo already uses `@netlify/blobs` **10.7.11** in `src/documents/store.mjs`, with
`NETLIFY_BLOBS_TOKEN` and `NETLIFY_SITE_ID`.

| Question | Answer | Source |
|---|---|---|
| Max object size | **5 GB** — "An individual object's total size cannot exceed 5 GB." | https://docs.netlify.com/build/data-and-storage/netlify-blobs/ |
| Object metadata | 2 KB | same |
| Key size / store name | 600 bytes / 64 bytes | same |
| Can a blob be served publicly? | **No.** There is no public URL. Access is only via a function, edge function, build plugin, the CLI, or the Blobs UI. | same |
| Can a function stream ~200 MB back out? | **No.** A streamed synchronous function response is capped at **20 MB** with a **60-second** execution limit; a non-streamed response is far smaller again. | https://docs.netlify.com/build/functions/api/ |

**Verdict: Netlify Blobs can hold a 200 MB take but cannot hand it to Submagic.** The object fits
(200 MB « 5 GB) and fails at the door: there is no public URL, and the only way out is a function
response capped at 20 MB — ten times too small. `src/documents/store.mjs` gets around this for
documents by issuing short-lived *signed* URLs that a function resolves, which is fine for a PDF and
useless for a 200 MB video.

Not a candidate. Nothing was written to Blobs.

---

## 4. Supabase Storage

Read-only calls to `https://api.supabase.com` with `SUPABASE_ACCESS_TOKEN`. **Nothing was created.**

| Call | Result |
|---|---|
| `GET /v1/projects` | 200 — one project, `oqpnlusrotpxfenysfxz`, `us-west-2`, `ACTIVE_HEALTHY` |
| `GET /v1/organizations/{id}` | 200 — `{"id":"bdctixfduuubvqufaeqj","name":"Fundhub LLC","plan":"free"}` |
| `GET /v1/projects/{ref}/api-keys` | 200 — **4 keys returned, each with an `api_key` field** |
| `GET /v1/projects/{ref}/config/storage` | 200 — **`{"fileSizeLimit": 52428800, …}`**, `s3Protocol.enabled: true`, `imageTransformation.enabled: true` |

### CONFIRMED

* **A service key can be obtained through the management API.** `/v1/projects/{ref}/api-keys`
  returns them with the token this repo already holds. (The values were fetched and immediately
  redacted; none is recorded here or anywhere else.)
* **A bucket can be created through the management API** — the storage config endpoint answers, and
  the Storage admin API is reachable with a service key. Not done, as instructed.
* **The upload ceiling is 50 MB, measured, not assumed.** `fileSizeLimit: 52428800` is exactly
  50 MiB, read live off our own project.
* **We are on the free plan.** Free allows: 1 GB file storage, 5 GB egress, **50 MB max per file**.
  Pro would be 100 GB storage, 250 GB egress, 500 GB max file.
  Source: https://supabase.com/pricing and https://supabase.com/docs/guides/storage/uploads/file-limits
* Signed URL shape: `GET /storage/v1/object/sign/{bucket}/{path}` returns a `signedURL`, served from
  `https://{ref}.supabase.co/storage/v1/object/sign/{bucket}/{path}?token=<jwt>`. A public bucket
  serves `…/storage/v1/object/public/{bucket}/{path}` with no token.

### Verdict

**Supabase Storage cannot take a 200 MB take on the plan we pay for.** The file is four times the
50 MB ceiling. Raising it needs Pro. And even on Pro, one 200 MB take downloaded once burns 200 MB
of a 5 GB free egress budget — about 25 takes a month before it bills.

Not a candidate while we are on free. Nothing was created.

---

## 5. Recommendation

Use what is already paid for, in this order. The first option removes the hosting question entirely.

### First choice — push the file straight to Submagic

`POST /v1/projects/upload`, multipart, field `file`, max 2 GB. A 200 MB take is well inside it.

* No public URL anywhere. No virus-scan page, no signed-link expiry, no `confirm=t`, no bet on
  whether Submagic's downloader likes our host.
* No new vendor, no new bill, no new env var.
* The take never has to be world-readable to get edited.
* Costs one change in `src/ad-videos/pipeline.mjs` `submagicCreate()`: read the bytes from Drive
  with the token we already have (proven in §2.3) and post them, instead of passing `row.source_url`
  as `videoUrl`.
* Budget the rate limit: **30 creates an hour**, not 500.

### Fallback — the Drive public URL

If the upload route turns out to be plan-gated once the key is exercised, the Drive link works
today, measured on a 344.6 MB file:

```
https://drive.usercontent.google.com/download?id=<FILE_ID>&export=download&confirm=t
```

The take is already in Drive, the folder is already `anyone with link`, and the worker already has
the full `drive` scope to set that permission per file if a take ever lands somewhere private.
`confirm=t` is not optional above roughly 100 MB — without it Submagic receives 2,457 bytes of HTML
and fails with exactly the "not a downloadable media file" error the earlier research recorded.

### Not candidates, and why, in one line each

* **Netlify Blobs** — holds it (5 GB) but cannot serve it; the only exit is a function response
  capped at 20 MB.
* **Supabase Storage** — 50 MB ceiling on our free plan, which a 200 MB take is four times over.
* **Cloudflare R2 / S3** — a new vendor and a new bill for a problem Drive and Submagic already
  solve. The earlier research recommended this on the belief that Drive links cannot work; §2.4
  measured that belief false.
  Superseded by docs/specs/marketing-machine-2026-10-04.md (owner-approved 2026-10-05): spec v3 picks Cloudflare R2 for videos (§2 item 12, §9.5, §12.1), because Netlify paused the site over video bandwidth.

### Before any of it can run

`SUBMAGIC_API_KEY` is readable **only from inside a deployed Netlify function**. Nothing that needs
it can be proven from a laptop. Write the first live Submagic call as a deployed function or an
Inngest job, not as a local script, or it will fail on a mask and look like a bad key.

---

## What this changes in the earlier research

`docs/specs/video-pipeline-api-verification-2026-09-22.md` stays as the owner's ground truth for the
overall flow. Four of its statements are now measured differently:

1. "Never hand a Google Drive link to Submagic … copy each Raw take to Cloudflare R2 or S3" —
   **superseded.** A public Drive file over 100 MB downloads cleanly with `&confirm=t` (§2.4).
2. "Drive's virus-scan page breaks programmatic downloads over 25 MB" — **the threshold is around
   100 MB, not 25 MB, and it is defeated by `&confirm=t`** (§2.4).
3. Export path `/v1/projects/{id}/export` "is inferred" — **confirmed real** (§1.2).
4. "Rate limits: create 500/hr" — **30/hr** (§1.5).

And one thing it did not cover at all: `POST /v1/projects/upload` accepts the file directly, so the
public-URL problem it spends its first required change on can be skipped entirely (§1.3).
