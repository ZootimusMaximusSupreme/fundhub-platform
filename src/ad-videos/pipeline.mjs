// One take, one state at a time.
//
// marketing/ads/video-pipeline-plan.md §2 lists the states a take moves through and what
// fires each move. This file is that table as code: given a row, do the ONE
// next thing, and hand back what changed. It writes nothing itself — the
// sweeper (src/workflows/ad-video-sweeper.mjs) owns the database — which is what
// makes every step below testable with no database, no network and no clock.
//
// ═══════════════════════════════════════════════════════════════════════════
// THE ORDER CHANGED FROM THE PLAN, AND HERE IS EXACTLY WHERE.
//
// marketing/ads/video-pipeline-plan.md puts `transcribed` before Submagic, because it was
// written against Deepgram. The owner's decision of 2026-09-22 replaced Deepgram
// with Submagic's own word-level transcript, and that transcript does not exist
// until the project has been created. So two states swap places:
//
//   plan:  staged → transcribed → matched → editing
//   code:  staged → editing → transcribed → matched
//
// No state is added, removed or renamed, so the database's status list is
// untouched. This is a gap between the written plan and the built code and it is
// recorded here, in docs/journeys/ad-video-flow.md, and in the task report
// rather than quietly reconciled (CLAUDE.md §4).
// ═══════════════════════════════════════════════════════════════════════════
//
// EVERY STEP IS SAFE TO RUN TWICE. The sweeper runs every five minutes and a
// serverless function can be retried mid-flight, so "did this already happen?"
// is answered by a field on the row, not by hope:
//
//   stage            → staged_at                already set? skip
//   submagic create  → submagic_project_id      already set? skip
//   read transcript  → transcript               already set? skip
//   match            → script_id                already set? no new match, move on
//   place + export   → exported_at              already set? skip
//   notify           → notified_at              already set? skip
//   deliver          → drive_final_file_id      already set? skip
//
// That matters most at `export`: the plan allows 50 exports an hour and an
// update always costs one, so a double-submit is not just untidy, it is a
// quarter of an hour's budget.
//
// ═══════════════════════════════════════════════════════════════════════════
// THE MARK GOES DOWN BEFORE THE MONEY GOES OUT.
//
// A mark written AFTER the vendor answered is not idempotency, it is a bet
// that nothing dies in between. The two calls that cost money — the Submagic
// create and the Submagic export — can each run for minutes with a video going
// over the wire, and a serverless function can be killed at any point in that
// window. Killed after the vendor accepted and before the row was written, the
// next pass reads a row that says nothing happened and spends again.
//
// So both of those steps write a CLAIM first (migration 391:
// submagic_claimed_at, export_claimed_at), call the vendor second, and clear
// the claim in the same patch that records the result. A crash leaves the claim
// standing, and a standing claim is what the next pass reads instead of
// spending:
//
//   create  → refuses outright. Submagic has no list endpoint (GET /v1/projects
//             is a 404, measured), so nothing here can discover whether the
//             first create landed. A person looks and then retries the take.
//   export  → polls instead. A poll costs nothing and answers the question
//             definitively, which is strictly better than guessing.
//
// The claim is written through the `claim` port, which the sweeper supplies.
// NO CLAIM PORT, NO SPEND: a step that cannot write its mark does not call the
// vendor at all.
// ═══════════════════════════════════════════════════════════════════════════
//
// NOTHING HERE THROWS. A step returns a verdict. `retryable: true` means try
// the same step again next pass; `retryable: false` means a person is needed
// and the row goes to `failed` with the reason stored.

import { planBroll } from "./broll.mjs";
import { matchTakeToScript } from "./match.mjs";
import { linkNumber } from "./naming.mjs";

/** The states, exactly as marketing/ads/video-pipeline-plan.md §2 names them. */
export const STATES = Object.freeze([
  "scripted", "filming", "raw_landed", "staged", "editing", "transcribed",
  "matched", "rendered", "awaiting_approval", "approved", "delivered",
  "rejected", "failed"
]);

/** The 4K law (.claude/rules/video-4k-unless-ad.md): a take that is not a paid
    ad must be 3840×2160. An ad may stay 1080p. */
export const FOUR_K_HEIGHT = 2160;

/** Which step runs at each state. A state that is not here is a resting place:
    a person moves it, or nothing does. */
export const NEXT_STEP = Object.freeze({
  raw_landed: "stage",
  staged: "submagicCreate",
  editing: "readTranscript",
  transcribed: "matchAndRename",
  matched: "placeBrollAndExport",
  rendered: "saveFinishedAndNotify",
  approved: "deliverToPaul"
});

const ok = (patch, note) => ({ ok: true, retryable: false, patch: patch || {}, note: note || null, error: null });
const wait = (error, patch) => ({ ok: false, retryable: true, patch: patch || {}, error, note: null });
const dead = (error) => ({ ok: false, retryable: false, patch: { status: "failed", failure_reason: String(error).slice(0, 300) }, error, note: null });
const skip = (note) => ({ ok: true, retryable: false, patch: {}, note, skipped: true, error: null });

const has = (v) => v !== null && v !== undefined && String(v).trim() !== "";

/* Is a spend claim old enough that nothing could still be running behind it?

   See CLAIM_STALE_AFTER_MS. An unreadable date is treated as NOT stale, because
   the expensive mistake here is freeing a claim that is still live. */
export function claimIsStale(claimedAt, now = Date.now()) {
  const t = Date.parse(String(claimedAt || ""));
  if (!Number.isFinite(t)) return false;
  return now - t > CLAIM_STALE_AFTER_MS;
}

/* answered — did the vendor actually say something?

   This is the question a standing claim turns on. `sent: false` means the
   request was never handed to fetch at all (the dry-run fence held it, or the
   payload was refused before it left), and an answer of any kind — any HTTP
   status — means the vendor replied and its reply is the truth. Either way
   nothing was created and the claim can be cleared for a clean retry.

   Only the third case is dangerous: the request went out and never came back.
   Then we genuinely do not know, the claim stays, and a person decides. */
const answered = (res) => res?.sent === false || Number(res?.status) > 0;

/* putClaim — write the mark, and report honestly whether it landed.

   Returns false when there is nothing to write with or the write threw. A
   caller that gets false must NOT call the vendor: an unwritten claim is the
   exact hole this whole mechanism exists to close. */
async function putClaim(claim, patch) {
  if (typeof claim !== "function") return false;
  try {
    const res = await claim(patch);
    return res !== false;
  } catch {
    return false;
  }
}

/* checkResolution — the 4K law, read off the real file rather than off a form.

   Returns a WARNING, not a failure. The database holds the hard stop (the plan's
   CHECK on ad_videos), and a take that is already filmed cannot be made 4K by
   refusing to caption it. What matters is that nobody finds out after Paul has
   uploaded it. */
export function checkResolution({ video_kind, height } = {}) {
  if (video_kind === "ad") return { ok: true, warning: null };
  if (!Number.isFinite(Number(height))) {
    return { ok: true, warning: "the picture size of this take is unknown, and it is not an ad — check it before it ships" };
  }
  if (Number(height) < FOUR_K_HEIGHT) {
    return { ok: false, warning:
      `this is not a paid ad and it came back ${height} lines tall, under 4K (${FOUR_K_HEIGHT}). ` +
      `Owner law: 4K unless it is an ad. Do not upscale it and do not ship it quietly.` };
  }
  return { ok: true, warning: null };
}

/* ─────────────────────────────────────────────────────────────────────────
   stage — get the take ready to hand over.

   THIS USED TO BE THE DEAD END OF THE WHOLE PIPELINE. It said a Drive link
   could not work and that nothing here could host a several-hundred-megabyte
   MP4, so every take stopped at `raw_landed` forever. Both halves were
   measured false on 2026-09-22; src/ad-videos/staging.mjs carries the story.

   NOTHING IS PUBLISHED HERE, EVER. Staging checks the take can move and says
   so; the bytes themselves go Drive → worker → Submagic inside the fence, in
   submagicCreate(). There is no `source_url` and no share, which is why there
   is nothing to expire, revoke or regret.

   The port is still injected rather than imported, so every step in this file
   stays testable with no network. The sweeper supplies the real one.
   ───────────────────────────────────────────────────────────────────────── */
export async function stage(row, { staging, env = process.env } = {}) {
  if (has(row.staged_at)) return skip("already staged");
  if (!has(row.drive_raw_file_id)) return dead("no raw file id on the row — nothing to stage");
  if (!staging || typeof staging.publicUrlFor !== "function") {
    return wait(
      "the staging port was not supplied — src/ad-videos/staging.mjs is what belongs here. " +
      "The take is safe in Drive and nothing was lost. See docs/journeys/ad-video-flow.md."
    );
  }

  const res = await staging.publicUrlFor(row, { env });
  if (!res?.ok) {
    const why = res?.error || "staging returned nothing";
    return res?.retryable === false ? dead(why) : wait(why);
  }

  const at = res.at || new Date().toISOString();
  return ok(
    { status: "staged", staged_at: at, storage_raw_key: res.storageKey || null },
    res.note || "the take goes straight to Submagic — no link was made"
  );
}

/* ─────────────────────────────────────────────────────────────────────────
   submagicCreate — hand the take over, WITHOUT rendering it.

   autoRender is forced off inside the provider. The whole B-roll timing answer
   depends on reading the real word timings before anything is placed, and that
   is impossible once the project has rendered.

   ONE ROUTE IN, AND IT PUBLISHES NOTHING. The bytes are read out of Drive with
   our own token and posted to Submagic as a multipart upload. There is no
   public link at any point, so the take is never readable by anyone who is not
   us. The old `link` route — Submagic fetching a Drive file we had shared with
   "anyone who has the link" — is gone: it left that share standing for the
   life of the file, and the vendor's own documented upload route removes the
   need for it entirely.

   A create costs one against a 30-an-hour ceiling and bills API minutes, which
   is why `submagic_project_id` is checked first, the claim is written before
   the call, and neither is ever re-spent.
   ───────────────────────────────────────────────────────────────────────── */
/* HOW LONG A WHOLE VIDEO FILE IS ALLOWED TO MOVE.

   src/lib/outbound-fetch.mjs caps a binary transfer at 120 seconds by default,
   which is right for a picture and hopeless for a take. Measured on production
   2026-09-23: `SLO Ad 1 Take 1.mp4` is 120 MB, the transfer was aborted at the
   two-minute mark every single pass, and because an aborted request never
   ANSWERS, the spend claim was not cleared — so every later pass refused to try
   at all and the take needed a person to free it. Three separate attempts died
   this way before the cause was found.

   Ten minutes, which fits inside the background function's fifteen with room to
   write the result down. */
export const BIG_FILE_TIMEOUT_MS = 600_000;

/* WHEN A SPEND CLAIM IS TOO OLD TO STILL BE RUNNING.

   A claim exists so a create is never paid for twice, and it is deliberately
   not cleared on its own — a request that never answered might still have
   landed at the vendor. But `might still be running` stops being true once the
   longest possible run has passed: a background function is killed at fifteen
   minutes, so a claim older than twenty cannot belong to anything alive.

   Below that, hands off. Above it, the take frees itself instead of waiting for
   somebody to notice. */
export const CLAIM_STALE_AFTER_MS = 20 * 60 * 1000;

export async function submagicCreate(row, {
  submagic, drive, claim, env = process.env, webhookUrl, maxUploadBytes,
  /* The caption look. One Fundhub template for every ad so a hundred of them
     look like one brand. Unset means Submagic's own default. */
  templateName,
  /* Silence trim. OFF unless a caller passes it, one take at a time, and not
     until the pilot has proved Submagic trims at create and not at export —
     see the header of src/messaging/providers/submagic.mjs. */
  removeSilencePace,
  hookTitle, cleanAudio
} = {}) {
  /* RESUME, DO NOT RE-CREATE. A row that already holds a project id is at
     Submagic whatever its status says — a retry that put it back to `staged`
     must not buy a second project. Measured 2026-09-24: four paid projects for
     one take, one of them still perfectly good. Moving straight to `editing`
     is the diagram's own arrow, without the upload. */
  if (has(row.submagic_project_id)) return ok({ status: "editing" }, "already at Submagic — resuming");
  if (!submagic?.createProjectFromFile) return wait("the Submagic provider was not supplied");

  /* A CLAIM STANDING WITH NO PROJECT ID IS A CRASH MID-UPLOAD, and it is the
     one case nothing here can resolve on its own: Submagic publishes no list
     endpoint, so there is no way to ask "did my project get made?". Creating a
     second one would be the wrong guess half the time and it is the expensive
     half. A person looks in the Submagic account and retries the take, which
     clears the claim (src/ad-videos/store.mjs retryFailed). */
  /* A STALE CLAIM IS A STOP, NOT A FREE PASS.

     Measured 2026-09-24: Chris's Submagic account held FOUR projects for one
     take. Every upload our side lost — killed at 26s, killed at 30s, crashed
     writing the id — had landed at the vendor anyway. So "it never came back,
     it probably never arrived" is wrong in the direction that costs money, and
     freeing an old claim automatically is an automatic double-bill.

     A claim nothing can still be running behind is therefore not cleared and
     retried. It is turned into a `failed` with the reason spelled out, so a
     person looks in the account, finds the orphan, and puts the id on the row
     or retries on purpose. One project is one project. */
  if (has(row.submagic_claimed_at) && claimIsStale(row.submagic_claimed_at)) {
    return dead(
      `a Submagic create was started at ${row.submagic_claimed_at} and never wrote a project id, ` +
      "and it is too old to still be running. The upload almost certainly LANDED anyway — " +
      "four orphan projects were measured this way on 2026-09-24. Nothing was sent. " +
      "Find the project in the Submagic account and either put its id on this row or retry on purpose."
    );
  }
  if (has(row.submagic_claimed_at)) {
    return wait(
      "a Submagic create was already started for this take and never came back with a project id. " +
      "Submagic cannot be asked to list projects, so nothing here can tell whether that one landed. " +
      "Nothing was sent. Look in the Submagic account, then retry this take."
    );
  }

  if (!has(row.drive_raw_file_id)) return dead("no Drive file — there is nothing to hand to Submagic");
  if (typeof drive?.downloadFile !== "function") {
    return wait("the upload route needs drive.downloadFile — the Drive provider was not supplied");
  }

  /* The download is free and it fails often — a phone that is still uploading
     answers zero bytes. So it happens BEFORE the claim: a claim spent on a take
     that was never going to be sent is a take that stalls for nothing. */
  const got = await drive.downloadFile(row.drive_raw_file_id, {
    env, maxBytes: maxUploadBytes, timeoutMs: BIG_FILE_TIMEOUT_MS
  });
  if (!got.ok) return got.retryable === false ? dead(got.error) : wait(got.error);

  const claimed = await putClaim(claim, { submagic_claimed_at: new Date().toISOString() });
  if (!claimed) {
    return wait(
      "the claim could not be written, so nothing was sent to Submagic. A create that is not " +
      "marked first can be paid for twice, and that is not a trade this step makes."
    );
  }

  const res = await submagic.createProjectFromFile({
    title: row.title || `Fundhub take ${row.id}`,
    language: row.language || "en",
    webhookUrl: webhookUrl || env.SUBMAGIC_WEBHOOK_URL || undefined,
    env,
    file: got.bytes,
    fileName: row.drive_raw_name || `take-${row.id}.mp4`,
    contentType: got.contentType || "video/mp4",
    maxBytes: maxUploadBytes,
    timeoutMs: BIG_FILE_TIMEOUT_MS,
    templateName: templateName || env.SUBMAGIC_TEMPLATE_NAME || undefined,
    removeSilencePace,
    hookTitle,
    cleanAudio
  });

  if (!res.ok) {
    /* The vendor answered, so no project was made and the claim is a lie the
       next pass would trip over. Clear it. A `dead` goes to markFailed(), which
       writes only the status and the reason — retryFailed() clears the claim
       there, which is what makes a retried take able to move at all. */
    if (res.retryable === false) return dead(res.error);
    return wait(res.error, answered(res) ? { submagic_claimed_at: null } : {});
  }

  return ok({ status: "editing", submagic_project_id: res.projectId, submagic_claimed_at: null });
}

/* readTranscript — the words, with their real times.

   This is also the only moment the pipeline learns how long the take runs,
   which is the number the Submagic minute bill is made of. */
export async function readTranscript(row, { submagic, env = process.env } = {}) {
  /* Same resume rule: the words are on the row, so move on rather than sit. */
  if (has(row.transcript)) return ok({ status: "transcribed" }, "transcript already read — resuming");
  if (!has(row.submagic_project_id)) return wait("no project id yet");
  if (!submagic?.getProject) return wait("the Submagic provider was not supplied");

  const res = await submagic.getProject(row.submagic_project_id, { env });
  if (!res.ok) return res.retryable === false ? dead(res.error) : wait(res.error);
  if (!res.words?.length) {
    /* Not a failure. Submagic is still processing; the next pass looks again. */
    return wait(`Submagic has not finished listening yet (status ${res.status || "unknown"})`);
  }
  const text = res.words.map((w) => w.word ?? w.text ?? "").join(" ").trim();
  return ok({
    status: "transcribed",
    transcript: text,
    transcript_words: res.words,
    duration_seconds: res.durationSeconds ?? row.duration_seconds ?? null
  });
}

/* ─────────────────────────────────────────────────────────────────────────
   matchAndRename — which ad this take is, and which take of it.

   THE NAME STAYS FOR NEXT_STEP AND seam.test.mjs. THE RENAME IS GONE.
   This step used to rename the raw file in Drive to `084_t01_raw_….mp4` once
   the match cleared the floor. Owner law says never move or rename raw files
   (.claude/rules/ad-video-best-of-clips.md, spec §2 item 17 and §9.1 step 5),
   and NAMING.md marks that format wrong. So a phone upload keeps the camera's
   own name, and the Command Center shows which take belongs to which ad.
   renamed_at stays on the table, unused.

   A ROW WITH script_id IS MATCHED. It is never matched again: a retried take
   keeps its script on purpose (store.mjs RETRY_CLEARS), and asking again costs
   a model call for an answer we already have. It moves straight on. Rows
   matched before this change can hold a script and no take number — those get
   the next free number, still without a new match.
   ───────────────────────────────────────────────────────────────────────── */

/** "Give this take the next free number for its ad." The store picks the
    number inside the same UPDATE that writes the match (src/ad-videos/store.mjs
    NEXT_FREE_TAKE_NO, the same word). Not imported from there: this file stays
    pure, with no database module behind it. pipeline.test.mjs pins the two. */
export const NEXT_FREE_TAKE_NO = "next_free";

/** "Take 6" in the file name is take 6. Anything else is no number at all. */
export function takeNoFromName(name) {
  const n = Number((/\btake\s*(\d{1,3})\b/i.exec(String(name || "")) || [])[1]);
  return Number.isInteger(n) && n >= 1 ? n : null;
}

export async function matchAndRename(row, {
  candidateScripts = [], env = process.env, fetchImpl
} = {}) {
  if (!has(row.transcript)) return wait("no transcript yet");

  let scriptId = row.script_id;
  let adId = row.ad_id;
  let confidence = row.match_confidence;
  let note = null;

  if (has(scriptId)) {
    note = "already matched — the match was not run again";
  } else {
    const m = await matchTakeToScript({
      transcript: row.transcript_words?.length ? row.transcript_words : row.transcript,
      candidates: candidateScripts,
      env,
      fetchImpl
    });
    if (!m.ok) {
      return m.retryable
        ? wait(m.reason)
        /* A take nobody can place is a person's job, not a retry's. The take is
           not lost — it is still in Drive and still on the row. */
        : dead(`could not tell which script this take is: ${m.reason}`);
    }
    scriptId = m.scriptId;
    adId = m.adId ?? adId;
    confidence = m.confidence;
    note = m.reason || null;
  }

  if (!has(adId)) {
    return dead(
      "the matched script carries no ad number. The ad number must exist before filming — " +
      "no number on the script means no number on the file, the folder or the landing link."
    );
  }

  /* THE TAKE NUMBER (spec §9.1 step 5), in this order:
       1. the number the row already holds — never re-numbered;
       2. "Take N" in the file name (a phone that names its own files);
       3. otherwise the next free number for this ad, picked by the store in
          the same UPDATE. This used to be a flat 1, so the second take of an
          ad hit UNIQUE (org, ad, take) and stopped at `transcribed`. */
  const takeNo = has(row.take_no)
    ? row.take_no
    : (takeNoFromName(row.drive_raw_name) ?? NEXT_FREE_TAKE_NO);

  return ok({
    status: "matched",
    script_id: scriptId,
    ad_id: String(adId),
    take_no: takeNo,
    match_confidence: confidence ?? null
  }, note);
}

/* ─────────────────────────────────────────────────────────────────────────
   placeBrollAndExport — our clips, then the render. In that order, once.

   `exported_at` is the idempotency key and it is the important one. Export is
   capped at 50 an hour and every update costs another, so a step that ran twice
   would spend a quarter of the hour's budget on one take.

   A take with no matching clip still exports. An ad with captions and no B-roll
   is an ad; an ad that never renders is nothing.
   ───────────────────────────────────────────────────────────────────────── */
/* HOW LONG TO WAIT FOR SUBMAGIC TO FINISH TAKING OUR CLIPS IN.

   POST /v1/user-media/upload answers with an id the moment the bytes land, and
   then Submagic keeps working on the file. Ask it to place that id a second
   later and it refuses: `VALIDATION_ERROR: The following media is not ready
   yet … Please wait for the upload to complete.` Measured 2026-09-24 on the
   first real take: every clip uploaded, the placement was refused for exactly
   that reason, and the export went out with nothing on it.

   So a placement that is refused as NOT READY is tried again on this clock —
   about a minute and a half all told, well inside the worker's fifteen — and if
   it is still not ready the take WAITS rather than exporting empty. Tests pass
   an array of zeros. */
export const MEDIA_READY_DELAYS_MS = Object.freeze([
  /* ~9 minutes all told. Measured 2026-09-24, second cut: the first ladder
     (95 s) ran out with a 4K clip still not ready, and because every pass
     uploads its winners afresh, a clock shorter than Submagic's own intake
     time can never catch up. The worker has fifteen minutes; this leaves room
     for the export and the write. */
  5_000, 10_000, 20_000, 30_000, 60_000, 60_000, 120_000, 120_000, 120_000
]);

const NOT_READY = /not ready yet|wait for the upload/i;
const pause = (ms) => (ms > 0 ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve());

export async function placeBrollAndExport(row, ports = {}) {
  const {
    submagic, claim, drive, brollLibrary = [], env = process.env, brollOptions = {},
    mediaReadyDelaysMs = MEDIA_READY_DELAYS_MS
  } = ports;
  /* ALREADY EXPORTED — OR ALREADY CLAIMED? THEN ASK WHETHER IT IS FINISHED.

     The webhook is the fast path out of this state and it is also the only
     unauthenticated one, so it cannot be the ONLY path: a ping that is lost,
     blocked or never configured would strand the take here forever with the
     render sitting finished at the vendor. Polling on the five-minute clock is
     the floor under it.

     A CLAIM WITH NO exported_at IS A CRASH MID-EXPORT, and polling is exactly
     the right answer to it: the poll costs nothing, it is inside a 100-an-hour
     read limit, and it settles the question a second export would only guess
     at — if the render appears, the first export landed. */
  if (has(row.exported_at) || has(row.export_claimed_at)) return pollFinished(row, ports);
  if (!has(row.submagic_project_id)) return wait("no project id yet");
  if (!submagic?.exportProject) return wait("the Submagic provider was not supplied");

  const notes = [];
  let placed = 0;

  if (!has(row.broll_placed_at) && brollLibrary.length && submagic.uploadUserMedia && submagic.updateProject) {
    /* Upload first, then place. A clip with no userMediaId cannot be placed,
       and planBroll reports it rather than dropping it silently. */
    /* TWO PASSES, AND THE FIRST ONE COSTS NOTHING.

       planBroll matches on a clip's FILE NAME, so which clips win is already
       decided before a single byte moves. The library is the whole Drive folder
       — 78 clips as measured on 2026-09-23 — and at most 5 of them can be used.
       Uploading all 78 for every take would be dozens of megabytes of download
       and 78 calls against a 500-an-hour ceiling, to place five.

       So: plan once with a stand-in id to learn the winners, fetch and upload
       only those, then plan again with the real ids. The second plan is handed
       the same clips in the same order, and planBroll is deterministic, so it
       returns the same placements. */
    /* STILLS ARE HELD OUT OF PLACEMENT FOR NOW. Measured three passes running
       on 2026-09-24: every 4K video Submagic took in within minutes; the one
       PNG was "not ready yet" every single time, for as long as we waited. A
       picture that never becomes ready cannot be allowed to hold a cut, and
       dropping it after the fact still costs the upload and the wait. So until
       Submagic is shown to take a still in, only moving clips are offered. The
       stills stay in the Drive library untouched; flip AD_VIDEO_BROLL_STILLS=1
       to offer them again once that is proven. */
    const stillsOn = String(env.AD_VIDEO_BROLL_STILLS || "") === "1";
    const offered = stillsOn ? brollLibrary : brollLibrary.filter((c) =>
      String(c.mimeType || "").startsWith("video/") || /\.(mp4|mov|webm|m4v)$/i.test(String(c.name || "")));
    if (offered.length < brollLibrary.length) {
      notes.push(`${brollLibrary.length - offered.length} still(s) held back — Submagic never finished taking a still in (AD_VIDEO_BROLL_STILLS=1 to offer them)`);
    }
    const stand = offered.map((c, i) => ({ ...c, userMediaId: c.userMediaId || `pending-${i}` }));
    const dry = planBroll({ words: row.transcript_words || [], clips: stand, ...brollOptions });
    const wanted = new Set((dry.placements || []).map((p) => p.userMediaId));

    const clips = [];
    for (const clip of stand) {
      if (!wanted.has(clip.userMediaId)) continue;
      const { userMediaId: standIn, ...real } = clip;
      if (!String(standIn).startsWith("pending-")) { clips.push(clip); continue; }

      /* The bytes. A public link is used as-is; a Drive clip is fetched here,
         because a Drive file is not readable without our credentials and the
         vendor's downloader has none. */
      let up;
      if (real.url) {
        up = await submagic.uploadUserMedia(row.submagic_project_id, { url: real.url, name: real.name, env });
      } else if (real.driveFileId && typeof drive?.downloadFile === "function") {
        const got = await drive.downloadFile(real.driveFileId, { env });
        if (!got.ok) { notes.push(`${real.name || real.driveFileId}: ${got.error}`); continue; }
        up = await submagic.uploadUserMedia(row.submagic_project_id, {
          file: got.bytes, name: real.name, contentType: got.contentType || real.mimeType, env
        });
      } else {
        notes.push(`${real.name || real.driveFileId}: no link and no way to fetch it`);
        continue;
      }
      if (!up.ok) { notes.push(`${real.name || real.driveFileId}: ${up.error}`); continue; }
      clips.push({ ...real, userMediaId: up.userMediaId });
    }

    const plan = planBroll({ words: row.transcript_words || [], clips, ...brollOptions });
    for (const s of plan.skipped) notes.push(`${s.clip}: ${s.why}`);

    if (plan.placements.length) {
      let placements = plan.placements;
      const clipOf = (id) => clips.find((c) => c.userMediaId === id);
      const isStill = (id) => String(clipOf(id)?.mimeType || "").startsWith("image/")
        || /\.(png|jpe?g|webp|gif)$/i.test(String(clipOf(id)?.name || ""));
      const stuckIds = (err) => new Set(String(err || "").match(/[0-9a-f]{8}-[0-9a-f-]{27}/g) || []);

      let upd = await submagic.updateProject(row.submagic_project_id, { placements, env });

      /* A STILL THAT IS NOT READY ON THE FIRST ASK IS DROPPED, NOT WAITED FOR.
         Measured 2026-09-24, second cut: three 4K videos were ready inside the
         clock and the one PNG never was — nine minutes of waiting on a picture
         that Submagic was not going to finish taking in. A video gets the full
         clock below; a picture gets one ask, then the cut goes out without it,
         and the note says so. An ad with three moving clips beats no ad. */
      if (!upd.ok && NOT_READY.test(String(upd.error || ""))) {
        const stuck = [...stuckIds(upd.error)];
        if (stuck.length && stuck.every(isStill)) {
          const keep = placements.filter((pl) => !stuck.includes(pl.userMediaId));
          notes.push(`dropped ${stuck.length} still(s) Submagic never finished taking in: ` +
            stuck.map((id) => clipOf(id)?.name || id).join(", "));
          placements = keep;
          upd = keep.length
            ? await submagic.updateProject(row.submagic_project_id, { placements: keep, env })
            : { ok: true, nothingLeft: true };
        }
      }

      /* NOT READY on a VIDEO is not a refusal, it is "ask again". See MEDIA_READY_DELAYS_MS. */
      for (const ms of mediaReadyDelaysMs) {
        if (upd.ok || !NOT_READY.test(String(upd.error || ""))) break;
        await pause(ms);
        upd = await submagic.updateProject(row.submagic_project_id, { placements, env });
      }
      if (!upd.ok && NOT_READY.test(String(upd.error || ""))) {
        /* Still not ready after the whole clock. Exporting now would bill a
           render with nothing on it — the exact thing that happened once. Wait;
           the next pass uploads nothing (the ids are the account's) and asks
           again. */
        const names = clips.map((c) => `${c.name}=${c.userMediaId}`).join(", ");
        return wait(`our clips are still being taken in at Submagic — not exporting an empty cut: ${upd.error} [uploaded: ${names}]`);
      }
      if (!upd.ok) {
        /* A placement refused for a REAL reason must not stop the ad. Captions
           alone are still a finished ad, and the reason stays on the row. */
        notes.push(`b-roll refused: ${upd.error}`);
      } else {
        placed = upd.nothingLeft ? 0 : placements.length;
      }
    }
  }

  /* THE BILLED CALL. The mark goes down first — see the file header. */
  const claimed = await putClaim(claim, { export_claimed_at: new Date().toISOString() });
  if (!claimed) {
    return wait(
      "the export claim could not be written, so no export was asked for. An export bills API " +
      "minutes against a 50-an-hour cap and never runs before its mark is on the row."
    );
  }

  const exported = await submagic.exportProject(row.submagic_project_id, { env });
  if (!exported.ok) {
    if (exported.retryable === false) return dead(exported.error);
    return wait(exported.error, answered(exported) ? { export_claimed_at: null } : {});
  }

  return ok({
    broll_placed_at: new Date().toISOString(),
    broll_count: placed,
    broll_notes: notes.length ? notes.join("; ").slice(0, 1000) : null,
    exported_at: new Date().toISOString(),
    export_claimed_at: null
  }, notes.length ? notes.join("; ") : null);
}

/* pollFinished — "is the render done yet?", asked with our own key.

   The same question the webhook branch answers, reached the other way. One
   GET per pass per take, well inside the 100-an-hour read limit, and it costs
   no API minutes — minutes are billed on the render, not on a read. */
export async function pollFinished(row, { submagic, env = process.env } = {}) {
  if (!submagic?.getProject) return wait("the Submagic provider was not supplied");
  const res = await submagic.getProject(row.submagic_project_id, { env });
  if (!res.ok) return res.retryable === false ? dead(res.error) : wait(res.error);

  const status = String(res.status || "").toLowerCase();
  if (status === "failed" || status === "error") {
    return dead(`Submagic reported the render failed (${status})`);
  }
  if (!res.downloadUrl) return wait(`still rendering (status ${status || "unknown"})`);

  return ok({
    status: "rendered",
    finished_url: res.downloadUrl,
    rendered_at: new Date().toISOString(),
    duration_seconds: res.durationSeconds ?? row.duration_seconds ?? null
  });
}

/* ─────────────────────────────────────────────────────────────────────────
   recordSubmagicWebhook — the ping, and what it is allowed to mean.

   THE PAYLOAD IS NOT EVIDENCE. It arrives unauthenticated from the open
   internet and the API research records no signature for it. So it is trusted
   for exactly one thing — "go and look at this project" — and the truth comes
   from a fresh GET against the API with our own key. Anyone can send us a
   "finished" body; nobody else can make Submagic agree.
   ───────────────────────────────────────────────────────────────────────── */
export async function recordSubmagicWebhook(parsed, { submagic, env = process.env } = {}) {
  if (!parsed?.ok) return { ok: false, retryable: false, patch: {}, error: parsed?.error || "unreadable payload" };
  if (!submagic?.getProject) return { ok: false, retryable: true, patch: {}, error: "the Submagic provider was not supplied" };

  const truth = await submagic.getProject(parsed.projectId, { env });
  if (!truth.ok) {
    return { ok: false, retryable: truth.retryable !== false, patch: {}, error: truth.error };
  }

  const status = String(truth.status || "").toLowerCase();
  if (status === "failed" || status === "error") {
    return { ok: true, retryable: false, projectId: parsed.projectId,
      patch: { status: "failed", failure_reason: `Submagic reported the render failed (${status})` } };
  }
  if (!truth.downloadUrl) {
    /* The ping arrived before the file did, or it was not about a finished
       render. Nothing moves; the sweeper's own poll picks it up. */
    return { ok: false, retryable: true, projectId: parsed.projectId, patch: {},
      error: `Submagic has no finished file for this project yet (status ${status || "unknown"})` };
  }

  return { ok: true, retryable: false, projectId: parsed.projectId, patch: {
    status: "rendered",
    finished_url: truth.downloadUrl,
    rendered_at: new Date().toISOString(),
    duration_seconds: truth.durationSeconds ?? null
  } };
}

/* ─────────────────────────────────────────────────────────────────────────
   saveFinishedAndNotify — buzz the phone.

   GRAB THE FILE FIRST, ALWAYS. The research could not find out how long the
   Submagic download link stays alive, so treating it as short-lived is the only
   safe reading. Saving our own copy is the `saveFinished` port; see the note on
   stage() for why moving video bytes is not built here.

   The notification carries an ad number, a take number and two links, and
   nothing else. A topic is a public address.
   ───────────────────────────────────────────────────────────────────────── */
export async function saveFinishedAndNotify(row, {
  notify, saveFinished, approveUrl, rejectUrl, env = process.env
} = {}) {
  if (has(row.notified_at)) return skip("already notified");
  if (!has(row.finished_url)) return wait("no finished file link yet");

  const patch = { status: "awaiting_approval" };

  if (!has(row.storage_final_key) && typeof saveFinished === "function") {
    const saved = await saveFinished(row, { env });
    if (saved?.ok) patch.storage_final_key = saved.key || null;
    /* A copy we could not take is recorded and does NOT stop the approval. The
       link still works right now, which is when Chris is about to watch it. */
    else patch.save_note = String(saved?.error || "our own copy was not taken").slice(0, 300);
  }

  const size = checkResolution(row);

  if (!notify?.send) return { ...ok(patch), note: "no notifier supplied — the video is waiting, nobody was told" };

  const res = await buzz(row, { notify, approveUrl, rejectUrl, env, size });

  if (res?.status === "sent") {
    return ok({ ...patch, notified_at: new Date().toISOString() }, size.warning);
  }
  /* The row still moves to awaiting_approval. A buzz that did not land is not a
     reason to hide a finished video — it is a reason to try the buzz again. */
  return ok({ ...patch, notify_error: String(res?.error || "notification did not send").slice(0, 300) }, size.warning);
}

/* buzz — the one message, whether it is the first time or a retry. */
export async function buzz(row, { notify, approveUrl, rejectUrl, env = process.env, size } = {}) {
  const sz = size || checkResolution(row);
  const label = `Ad ${row.ad_id ?? "?"} take ${row.take_no ?? "?"}`;
  return notify.send({
    id: row.id,
    notification: {
      title: `${label} is ready`,
      body: sz.warning ? `Watch it, then approve or reject. ${sz.warning}` : "Watch it, then approve or reject.",
      priority: 4,
      tags: ["clapper"],
      click: row.finished_url,
      actions: [
        approveUrl ? { label: "Approve", url: approveUrl } : null,
        rejectUrl ? { label: "Reject", url: rejectUrl } : null
      ].filter(Boolean)
    }
  }, { env });
}

/* The approve and reject links for a take that already holds its token. The
   sweeper mints a token only at `rendered`; a retry must reuse the one on the
   row, or every link already sent goes dead. The token IS the credential
   (api/public/ad-video-approve.mjs), stored as-is. */
export function linksFromToken(row, env = process.env) {
  const token = String(row?.approval_token || "").trim();
  if (!token) return { approveUrl: null, rejectUrl: null };
  const base = String(env.PUBLIC_SITE_URL || "https://fundhub.ai").replace(/\/+$/, "");
  const url = (d) => `${base}/api/public/ad-video-approve?token=${encodeURIComponent(token)}&decision=${d}`;
  return { approveUrl: url("approve"), rejectUrl: url("reject") };
}

/* How long a buzz that did not land keeps being retried. */
export const REBUZZ_WINDOW_MS = 24 * 60 * 60 * 1000;

/* ─────────────────────────────────────────────────────────────────────────
   renotify — try the buzz again.

   saveFinishedAndNotify's own note says a buzz that did not land "is a reason
   to try the buzz again". Nothing ever did. Measured 2026-09-24: the first
   finished ad's text failed, the row was marked notified because the ntfy
   push had landed, and no pass ever looked at it again. This runs for a row
   waiting on Chris with no notified_at, inside a day of the render, with the
   links it already holds. It writes no status.
   ───────────────────────────────────────────────────────────────────────── */
export async function renotify(row, { notify, env = process.env } = {}) {
  if (has(row.notified_at)) return skip("already notified");
  if (String(row.status) !== "awaiting_approval") return skip(`not waiting on Chris (${row.status})`);
  if (!has(row.finished_url)) return wait("no finished file link");
  const renderedAt = Date.parse(String(row.rendered_at || row.updated_at || ""));
  if (Number.isFinite(renderedAt) && Date.now() - renderedAt > REBUZZ_WINDOW_MS) {
    return skip("render is more than a day old — not buzzing again");
  }
  if (!notify?.send) return wait("no notifier supplied");

  const { approveUrl, rejectUrl } = linksFromToken(row, env);
  const res = await buzz(row, { notify, approveUrl, rejectUrl, env });
  if (res?.status === "sent") return ok({ notified_at: new Date().toISOString(), notify_error: null });
  return wait(String(res?.error || "notification did not send").slice(0, 300),
    { notify_error: String(res?.error || "notification did not send").slice(0, 300) });
}

/* ─────────────────────────────────────────────────────────────────────────
   deliverToPaul — the folder, the brief, and the one file in it.

   marketing/ads/video-pipeline-plan.md §4: one folder per ad number, one finished file
   inside it. The brief's landing link reads the ad number from the row, NEVER
   from the folder name — `fundhub_ad_id()` returns text, so utm_content=043 and
   utm_content=43 are two different ads and one ad's results split in half.
   ───────────────────────────────────────────────────────────────────────── */
export function buildBrief(row, { landingBase = "https://fundhub.ai" } = {}) {
  /* linkNumber(), not String(row.ad_id). It is the same value today — the
     database's ad_videos_ad_id_ck already refuses a padded number — but this is
     the line that puts an ad number in front of Paul, and it should REFUSE a
     padded one rather than print it. A brief is the last place the mistake is
     still cheap: once Paul has pasted `utm_content=043` into Meta, that ad's
     results are split in half and neither number looks wrong on its own. */
  const adId = linkNumber(row.ad_id);
  const link = `${String(landingBase).replace(/\/+$/, "")}/?utm_content=${encodeURIComponent(adId)}`;
  return [
    `Ad number: ${adId}`,
    `Take: ${row.take_no ?? "?"}`,
    `Hook: ${row.hook_text ?? "—"}`,
    `Headline: ${row.headline ?? "—"}`,
    "",
    "Primary text:",
    row.primary_text ?? "—",
    "",
    `Landing link: ${link}`,
    "",
    "The ad number in that link is NOT padded. 043 and 43 are two different ads",
    "and padding it splits this ad's results in half. Paste the link exactly."
  ].join("\n");
}

export async function deliverToPaul(row, {
  drive, naming, paulFolderId, landingBase, env = process.env
} = {}) {
  if (has(row.drive_final_file_id)) return skip("already delivered");
  if (!has(row.ad_id)) return dead("no ad number on the row — there is no folder to put this in");
  if (!drive?.ensureFolder || !drive?.uploadTextFile) return wait("the Drive provider was not supplied");
  if (!has(paulFolderId)) return wait("DRIVE_PAUL_FOLDER_ID is not set — there is nowhere to deliver to");
  if (!naming?.paulFolderName || !naming?.briefFileName || !naming?.finalFileName) return wait("the naming module was not supplied");

  const folder = await drive.ensureFolder({
    parentId: paulFolderId,
    name: naming.paulFolderName(row.ad_id),
    env
  });
  if (!folder.ok) return folder.retryable === false ? dead(folder.error) : wait(folder.error);

  const brief = await drive.uploadTextFile({
    parentId: folder.folderId,
    name: naming.briefFileName(row.ad_id, "txt"),
    content: buildBrief(row, { landingBase }),
    mimeType: "text/plain",
    env
  });
  if (!brief.ok) return brief.retryable === false ? dead(brief.error) : wait(brief.error);

  /* The video itself. This used to be a named gap — uploadVideo() refused,
     because the fence could not carry an MP4 — and it is now real: the
     finished render is pulled down and pushed into Paul's folder as a
     resumable upload, both halves inside the fence. A provider that still does
     not offer it is reported as `unsupported` and the folder and brief stay. */
  const video = await (drive.uploadVideo
    ? drive.uploadVideo({
      parentId: folder.folderId,
      name: naming.finalFileName(row.ad_id, row.take_no, row.finished_version || 1),
      sourceUrl: row.finished_url,
      env
    })
    : { ok: false, unsupported: true, error: "no uploadVideo on the Drive provider" });

  if (!video.ok) {
    return {
      ok: false,
      retryable: video.unsupported !== true,
      patch: {
        paul_folder_id: folder.folderId,
        drive_brief_file_id: brief.fileId,
        delivery_note: String(video.error).slice(0, 500)
      },
      error: video.error,
      note: null
    };
  }

  return ok({
    status: "delivered",
    paul_folder_id: folder.folderId,
    drive_brief_file_id: brief.fileId,
    drive_final_file_id: video.fileId,
    delivered_at: new Date().toISOString()
  });
}

/** The steps, by name, so the sweeper does not hold a switch statement. */
export const STEPS = Object.freeze({
  stage, submagicCreate, readTranscript, matchAndRename,
  placeBrollAndExport, pollFinished, saveFinishedAndNotify, deliverToPaul
});

/**
 * advance(row, ports) → { ok, retryable, patch, error, note, step }
 *
 * Runs the ONE step this row's state calls for. A state with no step is a
 * resting place and comes back `skipped` — which is the right answer for
 * `awaiting_approval`, where the next move belongs to a person.
 *
 * NEVER THROWS.
 */
export async function advance(row, ports = {}) {
  const state = String(row?.status || "");
  const name = NEXT_STEP[state];
  if (!name) return { ...skip(`nothing to do at "${state}"`), step: null };
  try {
    const out = await STEPS[name](row, ports);
    return { ...out, step: name };
  } catch (err) {
    /* A bug in a step must not take the pass down: the other rows in this pass
       still have work to do, and the next pass is the recovery. */
    return { ...wait(`${name} threw: ${String(err?.message || err)}`), step: name };
  }
}

export default advance;
