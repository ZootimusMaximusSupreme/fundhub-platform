# Submagic settings lock — 2026-09-23

Lock the Submagic API switches and B-roll cover **before** we spend API minutes.
This board is not ad scripts. Ad scripts are a separate job.

## Task list

| # | Workflow | Owns | Status |
|---|---|---|---|
| W1 | API truth | The real field names in Submagic's docs — eye tracking, silence, merge, templates, costs | done |
| W2 | Repo wiring | What our code already sends, what it does not, the dead-space code change, cost guard | done (see "W2 Repo wiring — done") |
| W3 | B-roll coverage | AD 1–7 matrix, real Drive clips, the file naming rule | done |
| W4 | Recorded B-roll | The 8 missing screen clips — recorded, named for the matcher, 4K | done |

W4 ran after W3, because W3 is what settled the naming rule. The first three had
no dependencies and ran at once. W2 wrote the code change with the field
**name** taken from our own measured spec; W1 confirms the field's **value shape**.

## The shared brief — what we already know, measured

From `docs/specs/video-pipeline-unknowns-settled-2026-09-22.md`, measured with live
calls on 2026-09-22. Submagic checks the route before it checks the key, so a
`401` means "this path is real" and a `404` means "this path does not exist".

* Host is `https://api.submagic.co`. `api.submagic.com` does not exist.
* The key goes in an `x-api-key` header.
* Upload the film itself: `POST /v1/projects/upload`, multipart, up to 2 GB, up
  to 2 hours. **30 of these an hour.**
* Upload one of our own B-roll clips: `POST /v1/user-media/upload`, multipart,
  field `file`, answers `{ userMediaId }`. 500 an hour.
* Read the words and their times: `GET /v1/projects/{id}`. 100 an hour.
* Place the clips: `PUT /v1/projects/{id}`. 100 an hour.
* Make the finished film: `POST /v1/projects/{id}/export`. **50 an hour.**
* There is **no** list endpoint. You cannot ask Submagic "what projects do I
  have". That is why a crashed upload has to be looked at by a person.
* The optional switches Submagic's own upload page names:
  `items`, `templateName`, `webhookUrl`, `dictionary`, `magicZooms`,
  `magicBrolls`, `removeSilencePace`, `removeBadTakes`, `cleanAudio`,
  `hookTitle`, `music`, `disableCaptions`.
  **There is no eye-tracking or gaze field in that list.** W1 confirms against
  the live page.

Still unknown: the key itself has never been used. It is stored on Netlify with
`--secret`, so a laptop reads a mask, not the value. The first real call has to
come from a deployed function.


---

## W3 B-roll coverage

### 1. How the clip matcher really works

The file is `src/ad-videos/broll.mjs`. The rules, in plain words:

**The file name IS the tag list.** Nothing else tags a clip.

```js
// broll.mjs:53
const strip = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
// broll.mjs:65-68
const base = String(name || "").replace(/\.[a-z0-9]+$/i, "");
return [...new Set(
  strip(base).split(" ").filter((w) => w.length >= 3 && !/^\d+$/.test(w))
)];
```

* **Case does not matter.** Everything is forced to small letters first (`broll.mjs:53`).
* **Separators:** every character that is not a letter or a number becomes a split.
  Dashes, underscores, dots, spaces — all the same. `40k-business-card.jpg` becomes
  `40k`, `business`, `card`.
* **The file ending is thrown away** before splitting (`broll.mjs:65`).
* **Words shorter than 3 letters are dropped.** So `a`, `of`, `to` never tag anything.
* **Numbers on their own are dropped.** `broll-01.mp4` will not fire on the word "one".
  But `40k` survives, because it has a letter in it.

**There is NO stemming and NO part-word match.** The word has to be the same word:

```js
// broll.mjs:102
if (words[i + p]?.text !== parts[p]) { ok = false; break; }
```

That is a straight "is it the same" test. So a clip tagged `bank` does **not** fire when
Chris says "banks". A clip tagged `optimization` does **not** fire when he says
"optimized". This is the single biggest trap on this page.

**There is no score.** Nothing is ranked. It is first-come, first-served:

* The clips are tried **in the order they are handed in** (`broll.mjs:144`).
* For each clip, the matcher walks the spoken words from the front and takes the
  **earliest word at or after the cursor** that matches any of that clip's tags
  (`broll.mjs:94-107`).
* **Tie break:** the earliest spoken word always wins. If one spoken word matches two
  of that clip's tags, the tag listed first wins. That is the whole tie rule.

**Where the clip lands:**

```js
// broll.mjs:169-170
const startTime = hit.word.start;
const endTime = Math.min(startTime + wanted, lastEnd);
// broll.mjs:191
cursor = endTime + (Number(minGapSeconds) || 0);
```

* It starts **exactly on the word** Chris says.
* It runs **3 seconds** by default (`DEFAULT_CLIP_SECONDS`, `broll.mjs:39`), never more
  than 12 (`MAX_ITEM_SECONDS`, `broll.mjs:35`).
* **The first 3 seconds are protected.** Nothing covers the hook (`broll.mjs:42`).
* **4 seconds of clear air** after each clip before the next one may start (`broll.mjs:45`).
* **5 clips maximum** per video (`broll.mjs:48`).
* Because the cursor only moves forward, **the order you hand the clips in decides the
  order on screen.** A clip whose word is only said early gets skipped if an earlier clip
  already ate past that point.

### 2. The seven ads

All seven are real and all seven live in `docs/ads/fundhub-297/FundHub-LOCKED-ADS.md`
(locked 2026-09-19). The content map `docs/workflows/slo-ads-content-map-2026-09-23.md`
lists which ones are on tape, not what they say. Both were read.

| AD | Name | The beat that needs cover |
|---|---|---|
| AD 1 | Straight offer, full read | "a list of the banks that will approve you" — the proof that approvals are real |
| AD 2 | Straight offer, declined open | "You got declined and nobody told you why" — the decline, then the fix |
| AD 3 | Straight offer, what your file is worth | "two hundred, three hundred, four hundred thousand dollars in funding" — big numbers |
| AD 4 | Straight offer, the roadmap without the call | "I'll give you the roadmap without the call" — the roadmap document itself |
| AD 5 | Straight offer, max fundability | "what you qualify for at the top end" — the two amounts, now and after |
| AD 6 | Haynes, you already know | "that gap is a couple hundred thousand dollars in extra capital" — the gap |
| AD 7 | Haynes, the call that was never a roadmap | "hundreds of thousands in personal funding plus hundreds of thousands in business" |

### 3. What is actually in Drive today

Read live from Google Drive on 2026-09-23. SLO Ads folder is
`13ZOjA56MNuM-PHSRK5fQK0bovRwR8raZ`, the `broll` folder inside it is
`1GclLLeMNOVjVSQOJUVBgQYp7WAd3pF11`.

**Two things are wrong with the folders before we even look at the files.**

1. `broll/deliverables` **does not exist.** The `deliverables` folder is real, but it sits
   one level up, directly under **SLO Ads**, not under **broll**
   (`1Dbwyvdb5a3mTu1rzZWLv2otM9cMl0tQ7`). Our own code expects all three side by side —
   `BROLL_FOLDERS` at `broll.mjs:30` and `FOLDERS` at `scripts/slo-broll-upload.mjs:14`.
2. **There is not one single video clip in there.** Every file is a picture or a PDF.
   No .mp4, no .mov. B-roll on a video ad is normally moving footage. Right now the whole
   library is still pictures.

**broll/approvals — 62 files, all pictures.**
22 older `.jpg` screenshots: `23k-chase-freedom-unlimited.jpg`, `24k-navy-federal.jpg`,
`25k-keypoint.jpg`, `25k-personal-card.jpg`, `30k-navy-federal.jpg`,
`30k-navy-federal-email.jpg`, `39k-personal-loan.jpg`, `40k-business-card.jpg`,
`40k-business-card-gm.jpg`, `41k-chase-ink.jpg`, `41k-chase-ink-business-unlimited.jpg`,
`50k-line-of-credit.jpg`, `54k-ink-business.jpg`, `70k-line-of-credit.jpg`,
`70k-line-of-credit-letter.jpg`, `70k-line-of-credit-rate-notice.jpg`,
`250k-line-of-credit.jpg`, `400k-line-of-credit.jpg`, `469k-line-of-credit.jpg`,
`469k-line-of-credit-account.jpg`, `500k-line-of-credit.jpg`,
`500k-line-of-credit-account.jpg`.
40 newer `.png` win cards uploaded today, all starting `win-`: `win-10000-lender.png`,
`win-10000-lender-2.png`, `win-10000-u-s-bank.png`, `win-12000-bank-of-america.png`,
`win-12000-bank-of-america-2.png`, `win-14000-chase.png`, `win-15000-fnbo.png`,
`win-15000-lender.png`, `win-16000-bankunited.png`, `win-16000-bankunited-2.png`,
`win-20000-truist.png`, `win-25000-enterprise-bank-trust.png`,
`win-25000-highland-bank.png`, `win-25000-lender.png`, `win-25000-umpqua-bank.png`,
`win-45000-chase.png`, `win-45000-fnbo.png`, `win-5000-nihfcu.png`,
`win-5000-u-s-bank.png`, `win-50000-chase.png`, `win-50000-keybank.png`,
`win-7000-citizens.png`, `win-70000-lender.png`, `win-74000-chase.png`,
`win-7500-pnc.png`, `win-9000-southstate.png`, plus 14 `win-noamount-…` cards
(`win-noamount-american-express-p05-2.png`, `-p23-1`, `-p27-1`,
`win-noamount-american-express-and-b-p05-3.png`, `win-noamount-chase-p02-1.png`,
`win-noamount-chase-p32-1.png`, `win-noamount-enterprise-bank-trust-p08-2.png`,
`win-noamount-first-citizens-bank-p04-1.png`, `win-noamount-ibc-bank-p10-1.png`,
`win-noamount-keybank-p37-1.png`, `win-noamount-lender-p27-2.png`,
`win-noamount-southstate-bank-p08-3.png`, `win-noamount-u-s-bank-p08-1.png`,
`win-noamount-u-s-bank-p24-1.png`).

**broll/portal — 9 pictures.**
`advisor.png`, `portal.png`, `refer.png`, `send-a-file.png`, `sign.png`, `status.png`,
`unlock-more.png`, `welcome.png`, `what-you-own.png`.

**deliverables (sitting under SLO Ads, not under broll) — 14 files, 7 pairs.**
`bank-lender-match-list.png` / `.pdf`, `credit-analysis-report.png` / `.pdf`,
`credit-optimization-roadmap.png` / `.pdf`, `funding-snapshot.png` / `.pdf`,
`letter-round-1-equifax.png` / `.pdf`, `letter-round-1-experian.png` / `.pdf`,
`letter-round-2-experian.png` / `.pdf`.

**Three other folders sit inside broll that our code does not know about:**
`client-wins` (the 37 `sanitized-page-NN.png` report pages, `client-wins-all.html`,
`AMOUNTS.md`, `fundhub-generic-face.png`), `old-approvals` (38 `deck-page-NN.png` plus
another copy of the 37 sanitized pages and `view-test.png`), and two folders made today
that are **completely empty**: `video-testimonials` and `written-testimonials`.

### 4. The matrix

"Fires" means the exact word is said in that locked ad AND a real file carries that exact
word in its name. Nothing here is invented.

| AD | Line / theme | Word that must fire | Covered | Real file that covers it |
|---|---|---|---|---|
| AD 1 | "a list of the banks that will approve you" | `list` | **Y** | `bank-lender-match-list.png` |
| AD 1 | "holding the roadmap" | `roadmap` | **Y** | `credit-optimization-roadmap.png` |
| AD 1 | "Your credit pulled from all three bureaus" | `credit` | **Y** | `credit-analysis-report.png` |
| AD 1 | "how much funding you qualify for" | `funding` | **Y** | `funding-snapshot.png` |
| AD 1 | "the document you need to address it" | `document` | **N** | nothing. No file has the word `document` |
| AD 1 | "Where your score sits today" | `score` | **N** | nothing. No file has the word `score` |
| AD 1 | "soft inquiry, so your score doesn't move" | `inquiry` | **N** | nothing |
| AD 2 | "You got declined and nobody told you why" | `declined` | **N** | nothing |
| AD 2 | "the cards sitting too high" | `cards` | **N** | files say `card`, he says `cards`. No match |
| AD 2 | "a list of the banks" | `list` | **Y** | `bank-lender-match-list.png` |
| AD 2 | "Your credit pulled from all three bureaus" | `credit` | **Y** | `credit-analysis-report.png` |
| AD 2 | "already written with your accounts in it" | `accounts` | **N** | files say `account`, he says `accounts`. No match |
| AD 3 | "two, three, four hundred thousand dollars in funding" | `funding` | **Y** | `funding-snapshot.png` |
| AD 3 | "starts your new business" | `business` | **Y** | `41k-chase-ink-business-unlimited.jpg` (or `40k-business-card.jpg`, `54k-ink-business.jpg`) |
| AD 3 | "what your credit file is actually worth" | `credit` | **Y** | `credit-analysis-report.png` |
| AD 3 | "the list of banks that will approve you" | `list` | **Y** | `bank-lender-match-list.png` |
| AD 3 | "what you qualify for right now" | `qualify` | **N** | nothing |
| AD 4 | "I'll give you the roadmap without the call" | `roadmap` | **Y** | `credit-optimization-roadmap.png` |
| AD 4 | "pull your credit from all three bureaus" | `credit` | **Y** | `credit-analysis-report.png` |
| AD 4 | "the list of banks that will approve you" | `list` | **Y** | `bank-lender-match-list.png` |
| AD 4 | "you get on the call, you get pitched" | `call` | **N** | nothing |
| AD 4 | "the document you need… already written" | `document` | **N** | nothing |
| AD 5 | "the most funding your file can possibly get you" | `funding` | **Y** | `funding-snapshot.png` |
| AD 5 | "once your file is fully optimized" | `optimized` | **N** | file says `optimization`, he says `optimized`. No match |
| AD 5 | "I'll hand you the list of banks" | `list` | **Y** | `bank-lender-match-list.png` |
| AD 5 | "leaving money on the table" | `money` | **N** | nothing |
| AD 5 | "some files take six months, some take one" | `months` | **N** | nothing |
| AD 6 | "how much more that same file would carry" | `more` | **Y** (weak) | `unlock-more.png` — a portal screen, nothing to do with the line |
| AD 6 | "a couple hundred thousand dollars in extra capital" | `capital` | **N** | nothing |
| AD 6 | "One card sitting too high" | `card` | **Y** | `40k-business-card.jpg`, `25k-personal-card.jpg` |
| AD 6 | "Personal data that doesn't match across the three bureaus" | `personal` | **Y** | `39k-personal-loan.jpg`, `25k-personal-card.jpg` |
| AD 6 | "shotgunned to a list of banks" | `list` | **Y** | `bank-lender-match-list.png` |
| AD 6 | "10x your file" | `10x` | **N** | nothing |
| AD 7 | "hundreds of thousands in personal funding" | `personal` | **Y** | `39k-personal-loan.jpg` |
| AD 7 | "plus hundreds of thousands in business funding" | `business` | **Y** | `41k-chase-ink-business-unlimited.jpg` |
| AD 7 | "Remove your inquiries, show you the roadmap" | `roadmap` | **Y** | `credit-optimization-roadmap.png` |
| AD 7 | "I'll pull your credit" | `credit` | **Y** | `credit-analysis-report.png` |
| AD 7 | "the whole thing turned into a pitch" | `pitch` | **N** | nothing |
| AD 7 | "Nobody calls you. Nobody pitches you." | `pitches` | **N** | nothing |

**Three things fall out of that table.**

1. **The word "approve" or "approval" is on no file at all.** We own 62 approval
   screenshots and not one of them will fire when Chris says "the banks that will approve
   you". The folder is called `approvals`, but the folder name is not part of the clip
   name, so the matcher never sees it. This is exactly the failure the top of
   `broll.mjs` warns about.
2. **Nothing fires on a dollar amount.** Every file leads with `41k`, `500k` or `45000`.
   Chris never says "forty one k" — he says "four hundred thousand dollars". Those tags
   are dead weight on every single ad.
3. **Two clips will fire on the wrong thing.** `what-you-own.png` carries the tags `what`,
   `you` and `own`. "You" is said within the first few seconds of every ad, so this clip
   will slap itself over the first line after the 3-second lead-in, every time.
   `send-a-file.png` carries `file` — Chris says "your file" meaning his credit file, but
   the picture is a portal upload button. Both are mis-fires waiting to happen.

### 5. The naming rule for new clips

**The rule in one line: name the clip with the exact words Chris says out loud in the ad.**

1. Use **small letters and dashes**. `approve-banks-list.mp4`. Dots, underscores and
   spaces work too, but pick dashes and stay with them.
2. Every word must be **3 letters or longer**. Shorter words are thrown away.
3. **Never lead with a number on its own.** `45000` is thrown away. `45k` survives but is
   useless, because nobody says "forty five k" out loud.
4. **Match the exact form he says.** "banks" not "bank". "optimized" not "optimization".
   "accounts" not "account". "cards" not "card". There is no stemming — close is a miss.
5. **Never use common filler words**: `you`, `what`, `the`, `and`, `now`, `more`, `file`.
   They fire in the first seconds and waste one of the five slots.
6. **Two or three real words is plenty.** Extra words only add more ways to mis-fire.
7. Put the **picture's own subject last** if you want it readable — it does not change the
   firing, only the tags do.

**Three examples, using clips that exist right now:**

| Real file today | Rename to | Why it fires |
|---|---|---|
| `approvals/41k-chase-ink-business-unlimited.jpg` | `approve-business-card-chase-ink-41k.jpg` | AD 1, 2, 3, 4 and 5 all say "banks that will **approve** you". AD 3, 6 and 7 all say "**business**". Today this file only fires on "business" by luck; renamed it also covers the approval line in all five straight-offer ads. |
| `deliverables/bank-lender-match-list.png` | `banks-approve-lender-match-list.png` | Chris always says "**banks**", plural. The file says `bank`, singular, so that half is dead. Adding `banks` and `approve` makes it fire on the real line in AD 1–6 instead of only on the word "list". |
| `deliverables/credit-optimization-roadmap.png` | `roadmap-optimized-credit-plan.png` | `optimization` never fires because he says "**optimized**". Swapping the word makes this clip cover both "the **roadmap**" (AD 1, 4, 7) and "once your file is **optimized**" (AD 1, 3, 4, 5, 6, 7). |

## W2 Repo wiring — done

### What our code sends today

| What Chris wants | Submagic field | Value we send | Wired? |
|---|---|---|---|
| No auto-edit before we read the words | `autoRender` | `false`, forced, a caller cannot turn it on | **Yes** |
| No AI stock B-roll | `magicBrolls` | `false`, forced | **Yes** |
| No mystery cuts | `removeBadTakes` | `false`, forced | **Yes** |
| Dead space trimmed | `removeSilencePace` | **new 2026-09-23** — off by default, a caller may pass it on one take | **Yes, off** |
| Spell Fundhub right | `dictionary` | `["Fundhub","fundhub.ai"]` plus extras | **Yes** |
| One caption look | `templateName` | passes through; now also reads `SUBMAGIC_TEMPLATE_NAME` | **Yes, unset** |
| Big words on the hook | `hookTitle` | passes through | **Yes, unset** |
| Cleaner voice | `cleanAudio` | passes through, only when `true` | **Yes, unset** |
| Tell us when it is done | `webhookUrl` | `SUBMAGIC_WEBHOOK_URL` | **Yes** |
| Our own clips as B-roll | `items[]` type `user-media` | `buildItems()` refuses any other type | **Yes** |
| Slow push-in on the face | `magicZooms` | not sent | **No — and leave it that way** |
| Music bed | `music` | not sent | **No** |
| Captions off | `disableCaptions` | not sent | **No** |

Eye tracking is not in that table because Submagic's upload page does not name
such a field. W1 confirms against the live page.

### Dead space — the call

**Approach A, gated on one measurement.** Turn the trim on for the pilot take
only, then check one number before it goes on anything else.

Why not the others. B is not real: the export call takes an id and nothing else,
so there is no export preset to hide a trim in. C means Chris edits, and Chris
films and approves — he does not edit.

The risk in A, in one sentence: our order is make the project, read the words and
their times, drop our clips on those times, then export — so if Submagic cuts the
silence at export instead of at create, every word time we read is from the long
version and every clip lands late.

**The measurement that settles it, free, on the pilot:** the project comes back
with a `durationSeconds`. Compare it to the length of the file we sent. Shorter
means the trim already happened and the times we read are the real ones — leave
it on. The same means the trim is waiting for export — turn it back off and the
answer becomes C after all.

### The code change, made

`src/messaging/providers/submagic.mjs`

* `createProject` and `createProjectFromFile` now take a `removeSilencePace`
  argument. It is sent **only** when a caller passes something that is not
  `false` or unset. The multipart route sends it as text, so `true` goes as
  `"true"` and a mode such as `"light"` goes as itself — either shape works,
  whichever one W1 finds on the live page.
* The file header no longer says the trim is banned forever. It says it is off
  by default and names the pilot measurement above.

`src/ad-videos/pipeline.mjs`

* `submagicCreate` now accepts and passes through `templateName`,
  `removeSilencePace`, `hookTitle` and `cleanAudio`. Before this, the provider
  supported all four and the pipeline sent none of them — so the caption look
  could never have been set on a real run.
* `templateName` falls back to `SUBMAGIC_TEMPLATE_NAME` from the environment,
  so one template covers every ad without a code change.

`src/messaging/providers/submagic.test.mjs`

* The old guard said a caller may never ask for the trim. That was an owner rule
  and Chris changed it. It is replaced by two guards of the same strength: the
  trim is not sent by default on either route, and a caller that asks for it
  gets it. Nothing was deleted or weakened to make a suite pass.

Checks: lint clean on 2628 files, `tsc --noEmit` clean, 97 of 97 tests pass.

### Merging clips — what the API can and cannot do

Submagic takes **one** film per project: `POST /v1/projects/upload` has a single
`file` field. There is no endpoint that joins two takes. `POST /v1/user-media/upload`
adds clips, but those are B-roll laid **on top of** the film, capped at 12 seconds
each — they are not a way to staple two takes end to end.

So: **anything that needs joining is joined before upload.** One finished MP4 goes
up, and Submagic's job is captions and our B-roll on top of it.

### Cost guard

* **30 project creates an hour.** That is the tight one at the front. One take,
  one create. A crashed create still costs one, which is why our code writes the
  claim before it calls and never spends a second one on the same take.
* **50 exports an hour**, and every re-edit costs another export. A take that
  gets its B-roll adjusted twice has cost two exports.
* **No AI B-roll, ever.** 3 credits a clip against 15 a month is five clips for
  a hundred ads.
* **Nothing is sent at all unless `ADAPTERS_DRY_RUN=0` is set on Netlify.**
  That is the default and it is deliberate: an edit that costs money should not
  start because a deploy forgot a variable.
* Submagic publishes **no list endpoint**. Nothing can ask "what did I already
  make", so a double-create is money that cannot be found again.

### Pilot plan — ONE file

Do **not** put all 14 Raw files in. The sweeper polls the Raw folder
(`DRIVE_RAW_FOLDER_ID` = `12L_RH8QycTZFeaXn4rHs9AIeGq7XokWU`) and takes whatever
is in it.

1. Raw holds exactly **one** take — the ad with the best B-roll cover on W3's
   matrix. Everything else stays where it is.
2. Set `SUBMAGIC_TEMPLATE_NAME` to W1's recommended template, and set
   `removeSilencePace` for this one run only.
3. Let it run: create, read the words, place our clips, export.
4. Read the pilot number — `durationSeconds` against the raw file's length — and
   write the answer on this board.
5. Only then does take two go in.

The first real call has to come from a deployed Netlify function, not a laptop:
the key is stored with `--secret`, so a laptop reads a mask and gets a 401 that
proves nothing.


---

## W1 API truth

Read on 2026-09-23 from Submagic's live docs. Every field below was copied off
the page, not remembered. Source pages: `docs.submagic.co/llms-full.txt` (the
whole doc set in one file) and the raw page files, for example
`docs.submagic.co/api-reference/upload-project.md`. Nothing here is guessed. Where
the docs do not say, it says so.

### Read this first — the one thing that changes the plan

**There are two ways to start a video and they are not the same.**

* `POST /v1/projects/upload` — you push the film up yourself (multipart file).
* `POST /v1/projects` — you give Submagic a web link to the film (`videoUrl`).

The link version has one switch the upload version does not have: `autoRender`.
That switch is what lets you look at the words before the film is made. Details
in item 8. If we want to check captions before paying for a render, we have to
put the film somewhere with a public link and use `POST /v1/projects`.

---

### 1. Eye tracking / gaze

**It is not on the upload call. It IS in the API, on a preset.**

There is no eye field of any kind on `POST /v1/projects/upload` or on
`POST /v1/projects`. I listed every single field on both pages. Not there.

But a preset has one:

| Thing | Truth |
|---|---|
| Field name | `eyeContactCorrection` |
| Type | boolean (`true` / `false`) |
| Where it lives | `PUT /v1/presets/{id}` (set it) and `GET /v1/presets/{id}` (read it) |
| Default | Docs do not state a default. The sample preset shows `false` |
| Doc line | "Whether Eye Contact correction is enabled." — Update Preset page |

It is **not** gated. Some preset switches (logo, colour filter, music) only work
if the preset already has that thing saved — the docs call that `configured`.
`eyeContactCorrection` is not in the `configured` list, so we can just turn it on.

**The catch, and it is a big one.** To use a preset on a video you pass
`presetId`. And the docs say, word for word:

> "presetId cannot be combined with templateName, userThemeId, aiEditTemplate,
> magicZooms, magicBrolls, magicBrollsPercentage, removeBadTakes,
> removeSilencePace, items, hookTitle, music, captionPositionY, or
> captionPositionX. The preset controls these settings."

Read `items` in that list. `items` is how we drop **our own B-roll clips at exact
seconds**. So on the create call it is either eye contact **or** our own B-roll
placement. Not both.

**Possible way round it, UNVERIFIED.** `PUT /v1/projects/{id}` also takes `items`,
and that page lists no preset clash. So in theory: create with the preset (eye
contact on), then add our clips with `PUT`, then export. The docs never say this
works. Nobody has run it. Do not plan around it until someone tries it.

**Also note:** there is no "create a preset" endpoint. The API can only list, read
and change presets that already exist. The preset itself has to be made once in
the Submagic app. After that agents can drive it.

---

### 2. Dead space / silence removal

Our guess was right. The field is real.

| Thing | Truth |
|---|---|
| Field name | `removeSilencePace` |
| Type | string (on the file-upload call it is sent as text) |
| Allowed values | `natural`, `fast`, `extra-fast` |
| Default | None. Leave it out and no silence is cut |
| Where | `POST /v1/projects`, `POST /v1/projects/upload`, `PUT /v1/projects/{id}` |

**The names are backwards from what you would expect.** Straight off the page:

* `extra-fast` — cuts gaps of **0.1 to 0.2 seconds**. This is the most aggressive one.
* `fast` — cuts gaps of **0.2 to 0.6 seconds**.
* `natural` — cuts gaps of **0.6 seconds and up**. This is the gentlest one.

So `natural` only removes long pauses. `extra-fast` removes tiny breaths too.

There is a second, separate switch: `removeBadTakes` (boolean, default `false`).
Its description says it removes "bad takes **and silence**". So the two overlap.
Turning both on has an effect the docs do not describe.

#### Does turning it on move the times in `words[]`? — **UNVERIFIED**

The docs never answer this. I searched the whole doc set for any mention of a
shift, an offset, a re-time, or an original-versus-cut timeline. Nothing.

Here is what we do know. `GET /v1/projects/{id}` gives back `words[]`, and each
entry has `text`, `type` (`word`, `silence` or `punctuation`), `startTime` and
`endTime` in seconds. Note it hands back **silence blocks as their own entries**.
That strongly suggests the times are from the original film, before any cutting.
But "strongly suggests" is not proof and I will not write it down as one.

**Why this matters more than it sounds.** Our own B-roll clips are placed with
`items`, using `startTime` and `endTime` in seconds. If silence removal shortens
the film and the times are measured against the **cut** version, every clip we
place lands in the wrong spot, and the drift gets worse the further into the
video you go. If the times are against the **original**, we are fine.

**This has to be measured, not read.** One test: upload one short film twice, once
with `removeSilencePace` set and once without, and compare the last word's
`endTime` in each. Same number means the times are original-film times and our
B-roll placement is safe. A smaller number on the silence-removed one means every
placement we compute has to be re-mapped. This is the single riskiest unknown on
the whole board.

---

### 3. Merging clips

**Submagic merges nothing. There is no merge.**

I listed every endpoint in the docs — 22 of them. There is no join, no merge, no
stitch, no concatenate, no multi-file upload. Every create call takes exactly one
video: one `file`, or one `videoUrl`.

The only thing that sounds close is Magic Clips
(`POST /v1/projects/magic-clips`), and it does the **opposite** — it takes one long
video and chops it into several short ones.

**So: all joining happens on our side, before the upload.** One finished MP4 or
MOV goes up. Limits are 2 GB and 2 hours.

The one thing Submagic can lay on top of an already-joined film is B-roll —
either our own clips or AI ones — through `items`. That is covering, not joining.

---

### 4. `magicZooms`

| Thing | Truth |
|---|---|
| Field name | `magicZooms` |
| Type | boolean on `POST /v1/projects`. String `"true"` / `"false"` on `POST /v1/projects/upload` |
| Values | on or off. Nothing in between. No strength or speed setting |
| Default | `false` (off) |
| Doc line | "Enable automatic zoom effects on the video to enhance visual engagement. Optional, defaults to false." |

Two related ones while we are here:

* `magicBrolls` — boolean, default `false`. AI picks moments and drops in **stock**
  footage on its own.
* `magicBrollsPercentage` — number 0-100, default `50`. How much of the video the
  AI B-roll covers. Only does anything when `magicBrolls` is on.

---

### 5. Caption style

**How `templateName` works.** It is a string. You pass the exact name of a style.
Default is `"Sara"` if you leave it out. The docs warn: "Template names are
case-sensitive." `templateName` cannot be used at the same time as `userThemeId`
(a custom style you built in the app), and cannot be used with `presetId`.

**`GET /v1/templates` returns real names.** The docs print the actual answer, all
42 of them:

Matt, Jess, Jack, Nick, Laura, Kelly 2, Caleb, Kendrick, Lewis, Doug, Carlos,
Luke, Leila, Mark, Sara, Daniel, Dan 2, Hormozi 4, Dan, Devin, Tayo, Ella, Tracy,
Hormozi 1, Hormozi 2, Hormozi 3, Hormozi 5, Jason, William, Leon, Ali, Beast,
Maya, Karl, Iman, Umi, David, Noah, Gstaad, Malta, Nema, seth

**The docs do not say what any of them look like.** Names only. No pictures, no
descriptions, no "this one is loud, this one is calm". The docs say so outright:
"the API doesn't provide template previews directly" and suggest making small test
projects to see them.

So I cannot tell you from the docs which one is clean and professional. Anyone who
says they can is guessing.

**What the docs DO describe** is a different, smaller list — the three
`aiEditTemplate` names, each with one word of style:

* `kelly` — "minimal, design"
* `karl` — "effective, modern"
* `ella` — "dynamic, bold"

Careful: those are whole-video auto-edit styles, not caption styles. And they are
all-or-nothing — the docs say when you use `aiEditTemplate` the **only** other
things you may send are `title`, `language`, the video, `webhookUrl` and
`dictionary`. Everything else is thrown away. That rules it out for us. We want
control.

#### My pick for Fundhub ads

This is my judgement, not a doc fact, and it needs eyeballs on it before we lock it.

**Start with `"Sara"`.** Two reasons, both from the docs and neither invented:
it is the default, and the docs describe it as "optimized for general social media
content". A default is the safest starting point when you cannot see previews.

**Stay away from anything named Hormozi or Beast.** Those are named after creators
whose look is the loud, big, bouncing, word-by-word style. That is the exact
TikTok-flashy thing we do not want. I am reading the naming, not a doc line —
flagging that so nobody quotes it back as fact.

**Prove it before locking it.** Push one 20-second test clip through 3 styles —
`Sara`, `Karl`, `Kelly 2` — and look at them side by side. Three projects, three
exports. That is a small, cheap test and it turns a guess into a fact. Until that
is done, the style is not locked.

**Long VSL segments: use a calmer setting, and the calm comes from the switches
more than the style name.** For a long talking-head piece, the things that make it
feel calm are:

* `magicZooms: false` — no jumping about on a 20-minute talk
* `magicBrolls: false` — we place our own covering, on purpose
* `removeSilencePace: "natural"` — only long pauses go, breathing stays
* `hookTitle` left off — a big animated hook belongs on an ad, not a VSL

Same caption style is fine. It is those four switches that separate an ad from a VSL.

There is a third option worth knowing: `userThemeId`. You build a look once by hand
in the Submagic app, and from then on agents pass its ID. That is how we would lock
a Fundhub house style permanently. Not needed today.

---

### 6. Rate limits and what it costs

#### Limits, straight off the pages

| Call | Limit |
|---|---|
| `GET /v1/templates` | 1000 an hour |
| `GET /v1/hook-title/templates` | 1000 an hour |
| `GET /v1/languages` | 100 a **minute** |
| `POST /v1/projects` (link) | 500 an hour |
| `POST /v1/projects/upload` (file) | 500 an hour |
| `GET /v1/projects/{id}` (read words) | 100 an hour |
| `PUT /v1/projects/{id}` (place clips) | 100 an hour |
| `POST /v1/user-media` and `/upload` | 500 an hour |
| `GET /v1/user-media` | 500 an hour |
| `PUT /v1/presets/{id}` | 500 an hour |
| `POST /v1/projects/{id}/export` | **The docs give no number** |

**Two corrections to this board's own brief, above.**

1. The brief says uploads are **30 an hour**. The live page says **500 an hour**.
2. The brief says export is **50 an hour**. The Export Project page gives no number
   at all — it only says it "has enhanced rate limits for API-generated projects".
   The 50 figure is not on the page today. Treat both old numbers as dead.

**Careful — the docs contradict themselves on reads.** The Rate Limits page puts
"project retrieval" at 500 an hour. The Get Project page itself says 100 an hour.
Plan for the lower one, 100.

The tightest real limit for our work is **100 an hour on read and 100 an hour on
place-the-clips**. Those are the two we do over and over per video. Do not poll
in a tight loop — use `webhookUrl` instead.

Every answer carries headers telling you where you stand: `X-RateLimit-Limit`,
`X-RateLimit-Remaining`, `X-RateLimit-Reset`. Going over gives a `429` with a
`retryAfter` in seconds.

#### Credits — mostly not stated, and that absence is the finding

The docs give **no credit cost for making an ordinary project and no credit cost
for an export**. I searched the whole doc set. It is simply not published.

The only costs written down anywhere:

* **AI B-roll: 3 AI credits per clip.** Doc line: "Every AI B-roll item consumes
  **3 AI credits**." Each `ai-broll` entry in `items` costs 3. This is the one place
  we could quietly burn money, because it is per clip, not per video.
* **Magic Clips: 1 credit per project.** And it draws on the Magic Clips pot, not
  the API pot.
* **Publishing to social needs API credits.** No number given. Refuses with a
  `402` saying "Insufficient API credits to publish".

**So we cannot build a cost guard from the docs.** What a project or an export
costs has to come from watching the credit balance in the Submagic account before
and after the first real run. Our own B-roll (`user-media`) has no stated cost —
which is another reason to prefer our clips over AI ones.

---

### 7. The other names, all confirmed

Every one of these is real and spelled exactly like this.

| Name | Type | Values / default | What it does |
|---|---|---|---|
| `autoRender` | boolean | default `true`. **Only on `POST /v1/projects`, NOT on `/upload`** | See item 8 |
| `magicBrolls` | boolean (string on upload) | default `false` | AI picks moments and inserts **stock** B-roll |
| `removeBadTakes` | boolean (string on upload) | default `false` | AI removes fluffed takes and silence. Docs warn it "may take 1-2 minutes" |
| `hookTitle` | boolean **or** object | off unless sent | Animated opening caption |
| `cleanAudio` | boolean (string on upload) | default `false` | Removes background noise |
| `dictionary` | array (JSON string on upload) | max 100 items, 50 characters each | Words to spell right |
| `webhookUrl` | string | must be HTTPS | Where Submagic pings us when it is done |
| `disableCaptions` | boolean | default `false` | Hides captions on the finished film |

**`hookTitle` in detail.** Send `true` and AI writes one. Or send an object:

* `text` — our own hook, 1 to 100 characters
* `template` — hook style name, default `"tiktok"`. The 13 real names from
  `GET /v1/hook-title/templates` are: tiktok, laura, steph, kevin, kelly, mark,
  logan, enrico, mike, devin, hormozi, masi, ali
* `top` — how far down, 0 to 80, default `50`
* `size` — text size, 0 to 80, default `30`

**`dictionary` has a side effect worth knowing.** Doc line: "Terms are saved to
your account and applied to **all your future projects**; your account keeps the
1,000 most recently added terms." So it is not per-video. Put "Fundhub" in it once
and it sticks for everything after. Good for us — but it means a junk word we send
once keeps affecting later videos.

#### Our own B-roll — the path, confirmed

Two steps, and it is simple.

**Step one — get the clip into Submagic.** Either way gives back a `userMediaId`.

* From a link: `POST /v1/user-media`, JSON body `{ "url": "..." }`. The link has to
  be public.
* From a file on our machine: `POST /v1/user-media/upload`, multipart, field `file`.

**Step two — say where it goes.** In `items`, each of our clips is one entry:

* `type` — must be the exact text `"user-media"`
* `startTime` — seconds, 0 or more
* `endTime` — seconds, must be bigger than `startTime`
* `userMediaId` — the ID from step one
* `layout` — how it sits on screen. Real values for video:
  `cover`, `contain`, `rounded`, `square`, `split-50-50`, `split-35-65`,
  `split-50-50-bordered`, `split-35-65-bordered`, `pip-top-right`,
  `pip-bottom-right`. For a still image only the first four work.

That `layout` list is the answer to "face stays hero". `cover` hides Chris
completely. The `split-` and `pip-` ones keep him on screen while the clip plays
beside or over him. For an ad where the face is the hero, `split-35-65` or
`pip-bottom-right` keeps him visible. `cover` should be used only for short beats.

**Rules the docs set:** every item needs a `type`. Items **may not overlap in
time**. Bad lengths, overlaps, or an over-long AI prompt get the whole request
rejected.

The AI version of the same thing is `type: "ai-broll"` with a `prompt` (1 to 2500
characters) instead of a `userMediaId`, capped at **12 seconds** per clip, and it
costs 3 credits each. Ours cost nothing extra.

---

### 8. The find nobody asked for but it changes the build

**`autoRender` only exists on the link-based create call.**

* `POST /v1/projects` (link) — has `autoRender`.
* `POST /v1/projects/upload` (file) — does **not**. I listed every field on that
  page. It is not there.

What `autoRender` does: set it to `false` and Submagic transcribes the film and
then **stops**, without making the video. You then read the words with
`GET /v1/projects/{id}`, fix any wrong ones with `PUT /v1/projects/{id}`, and only
then pay for the render with `POST /v1/projects/{id}/export`.

Without it, the film renders the moment the words are ready — misheard words and
all — and fixing them means rendering a second time.

**What this means for us.** If we want to check the captions before the render,
the film has to sit at a public web link. If we push the file straight up, we get
whatever the first pass heard.

**The export call also answers the 4K question.** `POST /v1/projects/{id}/export`
takes `fps` (1-60), `width` (100-4000) and `height` (100-4000). 3840 by 2160 is
inside that range, so a 4K export is possible. Left alone it copies the original
film's size. For a 4K VSL we must pass the numbers — do not assume.

**There is also an MCP server.** `POST https://api.submagic.co/mcp`, same key, sent
as `Authorization: Bearer sk-...`. Same limits, same credits. It can be added to
Claude Code with one command. Worth knowing; not needed to build the pipeline.

### What is still not known

1. **Does silence removal move the word times?** Not in the docs. Has to be measured.
   This decides whether our B-roll lands in the right place. Biggest open risk.
2. **What a project and an export cost in credits.** Not published. Has to be read
   off the account balance on the first real run.
3. **What any of the 42 caption styles look like.** No previews exist. Needs a
   3-style test export.
4. **Whether preset-then-add-items works.** That is the only route to eye contact
   plus our own B-roll, and the docs neither allow it nor forbid it.
5. **Whether the key works at all.** Unchanged from the brief above — it is stored
   with `--secret`, so the laptop reads a mask. First real call has to be from a
   deployed function.

## Reconciliation — W2 closing the board

### The two numbers that disagree

W1 read **500 creates an hour** off the live page on 2026-09-23. Our own measured
spec (`docs/specs/video-pipeline-unknowns-settled-2026-09-22.md`) read **30** off
the same page one day earlier, and `RATE_LIMITS.create` in the provider says 30.

Not resolved, and not worth resolving. **The code keeps 30.** Being careful with
a number that decides how much money a sweeper can spend in an hour costs us
nothing; being wrong the other way costs a bill. The real ceiling for our work is
the read and the place-the-clips call at 100 an hour each, and those two agree.

### The one thing that is now a decision for Chris, not for an agent

Eye contact and our own B-roll cannot both be on the same create call.
`eyeContactCorrection` only exists on a preset, and the docs say a create call
that uses a preset gives up `items` — which is the exact field that puts our
clips at exact seconds. There is a possible way round it (create with the preset,
then `PUT` the items on afterwards) and **nobody has tested it.** It is one free
call to find out, on the pilot.

### Still unproved, both settle on the same pilot take

1. Does `removeSilencePace` shift the word times, or not.
2. Does a preset-then-`PUT`-items call keep both eye contact and our clips.


---

## W4 Recorded B-roll

Eight moving screen clips, recorded 2026-09-23. W3 measured that the whole B-roll
library was still **pictures**. These are the first moving clips. Chris filmed nothing
for these — they are screen recordings, no camera.

Made by `scripts/broll-record.mjs`. It can be re-run at any time and will rebuild
everything from scratch.

### The eight clips

| # | What is on screen | File name | Length | Size | Data on screen |
|---|---|---|---|---|---|
| 1 | The bank and lender match list, scrolling through the matched banks | `list-banks-bank-approve-approval-approved.webm` | 3.8s | 3840x2160 | Made-up. Sample file "Jordan Sample" |
| 2 | The funding roadmap document, scrolling the month-by-month plan | `roadmap-document-documents.webm` | 3.8s | 3840x2160 | Made-up. Sample file |
| 3 | The credit analysis report — the three bureaus and the three scores | `credit-score-scores-bureaus-bureau.webm` | 3.8s | 3840x2160 | Made-up. Sample file |
| 4 | The funding snapshot — the amounts now and after the work | `funding-qualify-qualified.webm` | 3.8s | 3840x2160 | Made-up. Sample file |
| 5 | The real soft-pull approval screen — "It is a soft inquiry" | `inquiry-inquiries-soft.webm` | 3.8s | 3840x2160 | Made-up. Every box left empty |
| 6 | Why the banks say no — the bad items and the "why it matters" column | `declined-decline-why.webm` | 3.8s | 3840x2160 | Made-up. Sample file |
| 7 | Four real approval emails, one after another | `approval-approved-approvals.webm` | 3.8s | 3840x2160 | **Real approvals, already blacked out at the source.** See the note below |
| 8 | A dispute letter, scrolling | `letter-letters-accounts-account.webm` | 3.8s | 3840x2160 | Made-up. Sample name, real letter engine |

Where they are on this Mac:

```
docs/workflows/slo-broll-2026-09-23-evidence/clips/
```

44 MB in total. That folder is gitignored (`docs/workflows/*-evidence/`), the same as
every other picture and video dump in this repo, so the clips sit on disk and the
script that makes them is what is in git.

**Nobody has moved these to Drive yet.** They belong in the `broll` folder,
`1GclLLeMNOVjVSQOJUVBgQYp7WAd3pF11`. Drive writes were refused in the session that made
them.

### The names are the whole job

`src/ad-videos/broll.mjs` has no stemming: a clip tagged `bank` does not fire when Chris
says "banks". So each name spells out every form of every word it has to catch, and
carries no dollar amounts, take numbers or dates — those never match a spoken word.

Proved by running the product's own reader, `keywordsFromName`, over the eight finished
files:

```
approval-approved-approvals.webm                 -> ["approval","approved","approvals"]
credit-score-scores-bureaus-bureau.webm          -> ["credit","score","scores","bureaus","bureau"]
declined-decline-why.webm                        -> ["declined","decline","why"]
funding-qualify-qualified.webm                   -> ["funding","qualify","qualified"]
inquiry-inquiries-soft.webm                      -> ["inquiry","inquiries","soft"]
letter-letters-accounts-account.webm             -> ["letter","letters","accounts","account"]
list-banks-bank-approve-approval-approved.webm   -> ["list","banks","bank","approve","approval","approved"]
roadmap-document-documents.webm                  -> ["roadmap","document","documents"]
```

That closes six of the holes W3's matrix listed as **N**: `document`, `score`, `inquiry`,
`declined`, `qualify` and `accounts`. It also puts the word `approve` on a clip for the
first time — W3 found 62 approval pictures and not one that fires when Chris says "the
banks that will approve you".

### Nobody real is on screen

These run in paid ads, so the rule was: no real client, no real report, no real name, no
real account number.

* Clips 1, 2, 3, 4, 6 and 8 are the **real Fundhub deliverables** rendered for the
  made-up sample file "Jordan Sample" that already lives inside
  `scripts/black-reports/fundhub_gen.py`. No database was opened. Nothing was read from
  the live site.
* The sample file carries a full street address and the roadmap prints it in the "form
  your LLC" step. The script swaps it for `1200 Sample Street` before a single frame is
  drawn. A street address does not belong in an ad even with a made-up name beside it.
* Clip 5 is the **real soft-pull screen** with its network answer stubbed. Nothing was
  typed into any box. The Social Security line shows the page's own grey placeholder.
* Clip 7 is **real client approvals**, taken from
  `clickfunnels-fragments/slo/client-wins/` — the sanitized set, where every name is
  blacked out in the picture itself. This is on purpose: the proof-cards law says an
  approval card is built from the real screenshot and never invented, so a made-up
  approval email was not an option.

### 4K, and the format

Every clip is **3840 x 2160**. Owner law `.claude/rules/video-4k-unless-ad.md` — some of
these land in VSLs, not only ads, and 1080p cannot be upscaled later.

**Measured, and it is a trap worth writing down:** Playwright only ever scales a page
picture **down** into the video frame, never up, and `deviceScaleFactor` does not change
what the recorder receives. A 1280x720 window asked to record at 3840x2160 gave a small
picture sitting in the corner of a grey 4K frame. The fix is to make the window itself
3840x2160 and zoom the page 3x, which lays the document out at the width it was designed
for and paints every pixel.

**The clips are `.webm`, not `.mp4`, and that is a real gap.** Turning VP8 into H.264
needs an encoder this Mac does not have: no `ffmpeg` on the PATH, no Homebrew to install
one, and Playwright's own bundled ffmpeg is built with **libvpx and png only**. That
bundled one is still enough to cut the blank first half-second off each clip and fix the
length at 3.8 seconds, which it did. The moment a real ffmpeg is on this machine,
re-running `scripts/broll-record.mjs` writes `.mp4` instead — no other change needed.

**Unproved:** whether Submagic's `POST /v1/user-media/upload` accepts a `.webm`. W1's
read of the docs did not name the file types that endpoint takes. One upload answers it.

### One substitution, named

Clip 6 was asked for as "the portal showing a decline reason". **There is no such screen.**
`public/app/client-control-panel.html` records a bank answer as Approved / Declined /
Pending and stores **no reason** with it, and nothing on any client-facing page shows one.
So clip 6 is the closest real thing the product has: the credit analysis report's bad-items
table, with its "why it matters" column and the order to fix them in. Renaming that screen
is not this job — it is written down here so nobody reports it twice.

## W5 What actually shipped — 2026-09-23

Five real breaks were found by running the thing, not by reading it. Every one
of them would have made the pilot look like a Submagic problem.

### 1. No ad could ever have had B-roll on it

Nothing in the repo loaded the B-roll library. The sweeper passed an empty list
every time and `placeBrollAndExport` skips B-roll when the list is empty. The
planner worked, the uploader worked, the clips were in Drive — and not one clip
had ever been placed, or could have been.

`listBrollClips` now reads the three folders. Three tests fail if the list comes
back empty again, because an empty list is silent.

### 2. The first take ever polled was thrown away

`duration_seconds` is a whole-number column. Drive reports the length in
milliseconds, so a 67.248-second take arrived as a fraction and Postgres refused
the whole row: `invalid input syntax for type integer: "67.248"`. Nothing could
reach Submagic at all. Now rounded.

### 3. 62 approval pictures that could never match

The planner matches the words in a file's NAME against what Chris says, and it
does not bridge singular and plural. Not one of the 62 approval screenshots
carried the word "approve". `bank` never matched "banks". `card` never matched
"cards". 78 files renamed with the spoken words spelled out in full.

Two were firing on the wrong thing: `what-you-own.png` matched "you" and so
covered the opening line of every ad, and `send-a-file.png` matched "file".

### 4. The approvals were crowding out the documents

`BROLL_FOLDERS` listed approvals first. The planner takes clips in the order it
gets them and its cursor only moves forward, so once all 62 approvals carried
the same words they took the early slots and the roadmap, the credit report and
the bank list never placed. AD 1 fell to 2 clips of 5. Order flipped to
deliverables, portal, approvals.

### 5. A stuck take said nothing

The pilot reached `staged` and stopped. Every five minutes the sweeper tried the
next step, the step answered "wait" with a reason, and a wait wrote no patch —
so from the outside a take retrying every five minutes looked exactly like a
take nobody was touching. Migration 392 adds `last_step`, `last_step_note` and
`last_step_at`, written on every pass.

### Also done

* **Eight new clips.** 4K screen recordings of the real deliverables and portal,
  converted to H.264, filed so the documents win the early moments. Six use the
  built-in sample file, not a real client; the sample's street address is
  replaced before any frame is drawn. The approval reel uses the already
  blacked-out set.
* **A moving clip now beats a picture of the same thing.** Submagic gives a
  still only the full-frame layouts, so a picture hides Chris for its whole three
  seconds. A video can sit beside him.
* **Raw holds one take.** The other 13 went back to the SLO Ads root, so the
  pilot is one project and not fourteen.
* **`SUBMAGIC_TEMPLATE_NAME=Sara`** and **`DRIVE_BROLL_FOLDER_ID`** set on
  Netlify.

### Coverage, measured against the locked ads

Before today: **zero clips on all seven ads**, because the library never loaded.

After: **AD 2, 3, 4 and 5 place the full five**, with a video leading every one.
AD 6 places four, AD 7 places three. AD 1 places two — its lines lean on words no
clip carries yet (`score`, `inquiry`, `document` as spoken).

### Still open

* **Does the silence trim move the word times?** Unmeasured. The trim stays off
  until the pilot answers it.
* **Eye contact or our own B-roll, not both** on one create call. The
  preset-then-`PUT` way round it is untested.
* **Nobody has proved Submagic accepts our clips.** They are H.264 MP4 now
  rather than the WebM they were recorded as, which removes the obvious risk.
* **What a project and an export actually cost** is published nowhere. The
  pilot's bill is the measurement.


## W6 The pilot run — what it found, live

The pilot did its job. Four more real breaks, every one of them invisible until
a real file went through, and every one of them would have looked like
"Submagic is broken".

### 6. The take was thrown away before it was ever polled

`duration_seconds` is a whole-number column, Drive reports milliseconds, and a
67.248-second take made Postgres refuse the entire row. Fixed by rounding. See
W5 item 2 — this is the same break, found first.

### 7. One dead Google login stopped everything

The sweeper reached the take and answered
`Google token exchange failed: oauth token refresh failed (401): invalid_client`.
Two Google logins are stored on production. `driveAccessToken` only ever tried
the first one, although `config.mjs` has promised the fall-through in writing
for as long as it has existed. Now every stored token gets a turn.

### 8. The service account could not be reached at all

Worse than untried. `driveConfigFromEnv` returned `serviceAccount: null` the
moment any OAuth key was set, so `GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON` — the
credential that does not expire, the right one for a server, sitting on
production the whole time — was invisible to the code. OAuth still goes first;
there is now something behind it.

### 9. A 120 MB take cannot move in 26 seconds

**This was the real one.** The sweeper was an Inngest cron, and an Inngest pass
runs inside the synchronous `/api/inngest` request, which Netlify kills at **26
seconds**. `submagicCreate` downloads the whole take out of Drive and pushes the
whole take to Submagic. `SLO Ad 1 Take 1.mp4` is **120 MB**.

Measured on production: the pass wrote its spend claim at 02:25:11, began the
upload, and was killed before it could write a project id. The next pass found a
claim with nothing behind it and refused to spend again — correctly, because
Submagic publishes no list endpoint and nothing can ask whether the upload
landed. The take stopped dead and only a person could free it.

Moved to a Netlify **scheduled** function, which gets **15 minutes** — the same
pattern `staff-message-sweeper`, `commas-inbox-sweeper`, `creative-job-runner`
and the others in that directory already use. Unregistered from Inngest so two
crons cannot race the same take. The workflow module is untouched; the new
function calls its `sweep()`.

### On the keys

Nothing was unset, cleared or overwritten. The dead OAuth token is still stored
exactly where it was — it is stepped over at the point of use. Both fixes are
in the code around the key, which is what CLAUDE.md §11 asks for.


## W7 Steps 3 and 4 passed live — then the match step, and what it found

**Live, measured:** `staged → editing` at 03:40:33 (project created, id saved).
`editing → transcribed` at 04:00:53 (344 words with real times saved). Then the
match step failed the take at 04:05 — correctly. Bugs 13 and 14:

### 13. None of the seven locked ads were in the database

`ad_scripts` held one unrelated walkthrough. Claude was asked "which of these
is it", was offered the wrong script, and said so. `scripts/ad-scripts-load-locked.mjs`
loads the seven verbatim from `docs/ads/fundhub-297/FundHub-LOCKED-ADS.md`.

### 14. A script had nowhere to carry its ad number

`match.mjs` wants candidates with an `adId`; `candidateScripts()` selected none
and `ad_scripts` had no column. Migration 393 adds `ad_scripts.ad_id`. Only
scripts with a number are offered to the matcher now.

**Ad numbers 84–90, agent-set 2026-09-24.** The registry tops out at 83, no
`ads` row carries a number, and 1–7 were left alone on purpose — a low number
could attach historical `utm_content` clicks to these ads. Next free above the
top is collision-proof.

### Four paid projects for one take

Every upload our side lost — killed at 26 s, at 30 s, crashed writing the id —
had landed at Submagic anyway. Chris's account shows four. Three are orphans our
database cannot see (no list endpoint). So: a row that already has a project id
now **resumes** into `editing` rather than sitting or re-creating, and an
expired claim **fails the take with the reason** instead of spending again.

### Left for an owner call — retry still pays again

`retryFailed()` clears `submagic_project_id` on purpose (journey entry
2026-09-22), so `failed → staged` re-creates a project even when the existing
one is healthy. Tonight's take is repaired by hand instead: back to `staged`,
then the project id and transcript put back on the row, so the resume path
carries it forward for free. Whether retry should keep a healthy project is a
money-versus-simplicity decision, not an agent's.

## W8 THE PILOT RAN END TO END — 2026-09-24 04:35 UTC

`SLO Ad 1 Take 1.mp4` → matched **AD 1 as ad 84, take 1, confidence 95** →
exported → rendered 04:32:25 → saved-and-notified 04:35:11 → `awaiting_approval`
with a real approve token. Every one of the eight steps ran on production, on
the five-minute clock, through the code — the only hands-on moves were the two
row repairs recorded here. **Sixteen breaks, all ours, none Submagic's.**

### 15. The pipeline called the naming module by names it never had

`naming.rawName / adFolderName / briefName / finalName` vs the module's
`rawFileName / paulFolderName / briefFileName / finalFileName` — different
names and argument shapes; the pipeline's tests passed on a stub that invented
the first set. The rename guard was simply false (the Drive file kept its phone
name) and delivery would have waited for ever. Pipeline now calls the real
functions; `seam.test.mjs` checks every `naming.*` call against the exports —
the third gap of the exact kind that file was written for.

### 16. The first export carried no B-roll — "media is not ready yet"

All four clips uploaded and Submagic handed back ids; placing them a second
later was refused because Submagic was still taking the files in. The code then
exported anyway: a billed render, empty. Now the placement is asked again on a
~90-second clock and a take **waits** rather than exporting an empty cut over a
transient refusal. A refusal for a real reason still exports captions-only with
the reason on the row.

**Take 1 is being re-cut with its clips** (project reused; cost: one export and
one match call). Cut 1's approve link dies when the row leaves
`awaiting_approval`; cut 2 mints a fresh one.

### Left undone, plainly

* **Our own copy of the finished file was not taken.** `saveFinished` is not
  supplied by the Netlify worker, so `storage_final_key` is NULL and the branch
  writes no note. The only copy of cut 1 is Submagic's download link. Paul's
  folder still gets the file at delivery (uploaded from that link). Wire
  `saveFinished` into `netlify/functions/ad-video-worker-background.mjs`.
* **Retry still re-creates a project** — owner call (W7).
* **Three orphan Submagic projects** for this take, unreachable by API.
* **The premature commit `a33d0cd8`** shipped with the seam test red for one
  cycle; behaviour was unchanged and `74ab1b1c` fixed it. The ship chain now
  gates on `# fail 0`.
* **AD 1 places 4 clips, not 5** — its remaining lines lean on words no clip
  carries (`score`, `inquiry`, `document` as spoken).
* **The phone buzz went to the ntfy topic.** Chris asked for SMS; no real
  number yet (the one given was a 555 number). Twilio is set up; wiring it is
  one decision away.

## W9 The re-cut with clips, and the last two finds — 2026-09-24 05:20 UTC

Cut 1 went out captions-only (bug 16). Cut 2 reused the same Submagic project
— `awaiting_approval → failed → staged` through the store's own functions, then
the project id and words put back so the resume path carried it to `matched`
again for free (ad 84, confidence 95, second time).

### 17. Submagic never finishes taking in an uploaded PNG

The 9-minute readiness clock named it: the three 4K videos became ready; the one
still (`…report-credit-analysis.png`) never did — `not ready yet` for nine
minutes, on a picture. So a still that is not ready on the **first** ask is now
dropped and the videos go in at once, with the dropped names on the row; a video
gets the full clock. An ad with three moving clips beats no ad. Chris's stills
are still in the library and still offered; a still Submagic *does* take in
places as before.

### The phone buzz now texts Chris

`src/ad-videos/notify-fanout.mjs`: the finished-ad notification goes to Chris's
phone by SMS through the Twilio provider **and** to the ntfy topic. The number is
never written down — it comes from `PULSE_SMS_TO`, the same variable
`src/pulse/notify.mjs` already documents as "Chris: dest from PULSE_SMS_TO. Do
not hardcode." The text carries the video link, Approve and Reject, one per line.
A proof text from the laptop was refused by the session's safety gate (a real
SMS by hand); the pipeline sends it from production instead.

### The fence caught the scheduler

`netlify/functions/ad-video-sweeper.mjs` makes one raw `fetch` — a POST to our
own deploy to start the background worker, behind a shared secret. The fence
test ("nothing reaches the network except through the chokepoint") is right to
flag it and it is allow-listed with that reason. It had slipped through two
ships because those chains did not run the fence test; the ship chain now gates
on `# fail 0` across the ad-video, sweeper, fence, scheduled-return and worker
guard suites.

### A tick that lands on a deploy is skipped

05:00 fired nothing — scheduler and worker both silent — because the deploy of
the readiness clock landed at 05:00:39. Netlify swaps the function under the
schedule and that minute's invocation is lost. Not a break; a thing to know:
**do not ship inside the 30 seconds before a five-minute mark** when a take is
mid-flight.

### Cost so far, honestly

* Submagic: four orphan projects from the timeout era (unreachable by API),
  plus the one real project, plus two exports on it (cut 1 empty, cut 2 with
  clips). Credits per create/export are unpublished; the account is on the
  trial plan.
* Claude: two match calls (~600 tokens each).
* Netlify: eleven production deploys tonight.

### Stills are held out of placement (agent-set 2026-09-24 05:37)

Three passes running measured the same thing: every 4K video was taken in by
Submagic within minutes; the one PNG was "not ready yet" every time, for as long
as we waited. Two passes after the drop-rule deploy still waited on it — the
drop code was in that commit, so the background function was serving a stale
build (see below). Until a still is shown to be taken in, only moving clips are
offered: `AD_VIDEO_BROLL_STILLS=1` re-enables them, the stills stay in Drive
untouched, and the row notes how many were held. Chris's call stands — pics are
fine — this is about Submagic not finishing the intake, not about the pictures.

### A background function can serve a stale build for a while

Two worker passes after a deploy behaved exactly like the code before it, and
nothing in the log could say which build they were. The worker now prints
`COMMIT_REF` at the start of every pass. Rule of thumb from tonight: after a
ship, do not trust the next two ticks to be on the new build until the log line
says so.

## W10 Delivered — 2026-09-24 05:45:22 UTC

Cut 2 of `SLO Ad 1 Take 1` — ad 84, take 1, **three moving clips**, 160 MB MP4
verified at the link — reached `awaiting_approval` with a fresh token and the
notify step went out with no error. Video, Approve and Reject links handed to
Chris in chat; the same three went to the pulse number by SMS and to ntfy.

### Two small leftovers from the last hour

* **The build marker prints `unknown`.** `COMMIT_REF` exists at build time only;
  the function runtime does not see it. To make a stale background function
  visible, the sha has to be baked in at build (a generated file, or the ship
  script setting a variable before deploy). Left as is; noted so nobody trusts
  that line.
* **The SMS leg could not be proved from the log** on the first real text —
  nothing logged per channel. `notify-fanout.mjs` now prints one line per
  channel (`sms: sent | ntfy: sent`), number never shown. Every take from here
  on is provable.
* **2026-10-05 (W2 of `ops/workflows/finish-builds-2026-10-05.md`, branch
  `w2-stalled-launches`):** `saveFinished` is now wired. The background worker
  hands `saveFinishedToDrive` to the sweep; the cut goes to
  `DRIVE_FINISHED_FOLDER_ID`, never the Raw or B-roll folder, and a miss is a
  `save_note` that never holds the buzz. That folder variable is not set yet,
  so until it is, each finished cut gets a note naming it. The `sms: sent`
  line is proved offline only (two tests in `notify-fanout.test.mjs` with a
  stand-in transport; nothing sent). The live line still needs one real text,
  which is a yes/no for Chris on the finish-builds board. "Retry still pays
  again" (W7) is still an owner call, also on that board.

### Leftover cards (not this job's holes — recorded, not fixed)

* **`src/pulse` registry test is red on a clean tree**: "every routed api/
  handler and live public/app desk is listed or explicitly unmonitored". Seen
  while gating the pulse-number change; fails without any of tonight's edits.
* **The daily pulse text has never actually been sent.** `daily-pulse.mjs`
  defaults `dryRun = true` and `partner-production-floor.mjs` never passes
  `false`, so `PULSE_SMS_TO` — the number the ad-video text now uses — had
  never been exercised before tonight. Whether it is current is Chris's to say.

### 18. The Drive poll could never find a second take

`lastRawSeenAt` is the time we last *recorded* a take; the poll compared it to
Drive's *created* time. Every take was filmed on 09-21, and moving a file into
Raw does not change when it was created — so after the first take, no other
could ever be seen. `SLO Ad 3 Take 1` sat in Raw invisible. The poll now keys
on *modified* time, which a move into Raw bumps; a file seen twice is harmless
because `recordRawTake` is idempotent on the Drive id.
