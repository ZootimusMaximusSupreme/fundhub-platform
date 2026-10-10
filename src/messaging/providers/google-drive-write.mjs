// Google Drive — the WRITE side.
//
// src/company-brain/drive-client.mjs says in its first two lines that it never
// writes, deletes, or moves, and that is still true. This is the other half:
// list a folder, rename a take, make a folder, put a small file in it.
//
// CLAUDE.md §12 puts outbound transmission in src/messaging/providers/* and
// nowhere else, so it lives here rather than beside the read client. The one
// working example of a Drive write in this repo is scripts/slo-broll-upload.mjs,
// which runs on a laptop with a raw fetch; the calls below are that script's
// calls, moved behind the fence so they can run from a worker.
//
// SHIPS UNROUTED. `ENABLED = false`, not in providers/index.mjs — same posture
// as web-push.mjs and submagic.mjs.
//
// ═══════════════════════════════════════════════════════════════════════════
// THE FENCE IS `ADAPTERS`. Creating a folder and writing a file changes a
// record at a vendor, which src/lib/outbound-fetch.mjs says outright is not
// INTERNAL. With ADAPTERS_DRY_RUN unset every call comes back `blocked`, and
// nothing is written. That is the intended default.
// ═══════════════════════════════════════════════════════════════════════════
//
// ═══════════════════════════════════════════════════════════════════════════
// TWO LIMITS YOU WILL HIT. BOTH ARE REAL AND NEITHER IS WORKED AROUND HERE.
//
// 1. SCOPE. src/company-brain/config.mjs asks Google for `drive.readonly`. A
//    read-only token cannot create a folder or upload a file, and Google
//    answers 403 insufficientPermissions. This module asks for the full `drive`
//    scope on the service-account path and CHECKS the granted scope on the
//    OAuth path, so the failure says which it was instead of reading as a
//    mystery. Granting it is a change on the Google side, not in this repo.
//    Owner law: a stored key is never removed — a token that cannot write is
//    left exactly where it is and reported.
//
// 2. BYTES — CLOSED 2026-09-22. This used to say a video could not move
//    through the fence, because src/lib/outbound-fetch.mjs read every response
//    with res.text() and an MP4 came back mangled. That gap is now filled by
//    transmitBinary()/postBinaryTo() in the same chokepoint, with a size cap
//    and a two-minute clock. downloadFile() and uploadVideo() below use it, so
//    the bytes move inside the fence rather than in a laptop script.
// ═══════════════════════════════════════════════════════════════════════════
//
// ═══════════════════════════════════════════════════════════════════════════
// SCOPE, MEASURED 2026-09-22 (docs/specs/video-pipeline-unknowns-settled-2026-09-22.md)
//
// The live OAuth token grants the FULL `https://www.googleapis.com/auth/drive`
// scope, and a real create/trash/delete round trip against the SLO Ads folder
// returned 200/200/204 with no 403. A 200 MB resumable upload session was
// granted and cancelled with zero bytes sent. So the write path works today on
// the OAuth credential; the service account was never needed and was not
// touched. If a token without write scope is ever put in its place, the guard
// in driveAccessToken() still names the missing scope rather than letting it
// read as a mystery, and no stored key is changed either way.
// ═══════════════════════════════════════════════════════════════════════════

import {
  transmit, postJsonTo, transmitBinary, postBinaryTo, ADAPTERS, redact
} from "../../lib/outbound-fetch.mjs";
import { classify, success, failure, rejection } from "./http.mjs";
import { BROLL_FOLDERS } from "../../ad-videos/broll.mjs";
import { driveConfigFromEnv } from "../../company-brain/config.mjs";
import { fetchAccessToken, fetchOAuthAccessToken } from "../../company-brain/auth.mjs";

export const PROVIDER = "google_drive_write";
export const CHANNELS = new Set(["drive_write"]);
export const ADDRESS_FIELD = "drive_folder_id";
export const ENABLED = false;
export const TRANSMITS = true;

export const DRIVE_API = "https://www.googleapis.com/drive/v3";
export const DRIVE_UPLOAD_API = "https://www.googleapis.com/upload/drive/v3";

/** The scope a write needs. `drive.readonly` is not enough and never becomes enough. */
export const DRIVE_WRITE_SCOPE = "https://www.googleapis.com/auth/drive";
export const DRIVE_FILE_SCOPE = "https://www.googleapis.com/auth/drive.file";

export const FOLDER_MIME = "application/vnd.google-apps.folder";

/* How big a file this module will carry. The brief is a few kilobytes; the cap
   is here so a caller cannot quietly hand it a video and get a corrupt upload
   instead of a refusal. See limit 2 in the header. */
export const MAX_TEXT_UPLOAD_BYTES = 5 * 1024 * 1024;

/* How big a VIDEO this module will carry in or out. A take is held whole in
   memory while it moves, and a serverless function has about a gigabyte for
   everything it does, so this is a memory ceiling before it is a policy one.
   A 4K minute is roughly 350 MB; a take past this cap is refused by name
   instead of taking the worker down. Overridable per call. */
export const MAX_VIDEO_BYTES = 512 * 1024 * 1024;

/* The one long clock in this module. A few hundred megabytes does not move in
   ten seconds, and the JSON calls above keep the short default. */
export const VIDEO_TIMEOUT_MS = 300_000;

const FILE_FIELDS = "id,name,mimeType,parents,createdTime,modifiedTime,size,videoMediaMetadata,trashed";

/** True when Google's granted-scope list can write. Null scope means Google did
    not say, which on the OAuth path means the token may or may not write — the
    403 is then the answer, not this check. */
export function grantsWrite(scope) {
  if (!scope) return null;
  return String(scope).split(/\s+/).some((s) => s === DRIVE_WRITE_SCOPE || s === DRIVE_FILE_SCOPE);
}

/* ─────────────────────────────────────────────────────────────────────────
   The token. Cached until shortly before it expires, per process.

   Service account first asks for the full drive scope. OAuth cannot ask — the
   scope was fixed when the token was minted — so the granted list is read back
   and reported.
   ───────────────────────────────────────────────────────────────────────── */
let cachedToken = null; // { accessToken, expiresAtMs, scope, authMode }

/** Drop the cached token. For tests, and for a caller that saw a 401. */
export function resetTokenCache() { cachedToken = null; }

export async function driveAccessToken({ env = process.env, now = Date.now, fetchImpl } = {}) {
  if (cachedToken && cachedToken.expiresAtMs - 60_000 > now()) return { ok: true, ...cachedToken };

  const cfg = driveConfigFromEnv(env);
  if (!cfg.ready) {
    return { ok: false, retryable: true,
      error: `Google Drive login is not ready: ${(cfg.missing || []).join(", ") || "no credentials"} is not set` };
  }

  try {
    if (cfg.authMode === "oauth") {
      /* EVERY STORED TOKEN GETS A TURN.

         src/company-brain/config.mjs has always promised this in words — "Every
         usable token, in order. The Drive client moves to the next one when
         Google refuses a token or it has no Drive scope" — and this function
         only ever tried `[0]`. Measured 2026-09-23 on production: the first
         token answered `401 invalid_client`, the whole ad-video pipeline stalled
         at `staged` behind it, and a second, working token was sitting right
         there in the environment unused.

         This is the fix the owner law in CLAUDE.md §11 asks for. Nothing is
         unset, cleared or overwritten: a token Google refuses is stepped over
         at the point of use and left exactly where it is. */
      const cands = (cfg.oauthCandidates || []).length
        ? cfg.oauthCandidates
        : [{ credentials: cfg.oauthCredentials }];

      let lastError = null;
      let readOnlySeen = false;
      let got = null;

      for (const cand of cands) {
        let tok;
        try {
          tok = await fetchOAuthAccessToken({ ...cand.credentials, fetchImpl });
        } catch (err) {
          /* Google refused this one. Try the next rather than stopping here. */
          lastError = err;
          continue;
        }
        if (grantsWrite(tok.scope) === false) {
          readOnlySeen = true;
          continue;
        }
        got = tok;
        break;
      }

      if (!got && cfg.serviceAccount) {
        /* LAST RESORT, AND THE RIGHT CREDENTIAL FOR A SERVER ANYWAY.

           A service account does not expire the way a desktop OAuth token does,
           which is exactly why one is stored. Before 2026-09-23 it could not be
           reached at all: setting any OAuth key made driveConfigFromEnv report
           `serviceAccount: null`, so production sat stalled behind one dead
           token with a working service account beside it, untried.

           Nothing here changes a stored value. */
        const tok = await fetchAccessToken({
          clientEmail: cfg.serviceAccount.clientEmail,
          privateKey: cfg.serviceAccount.privateKey,
          delegateEmail: cfg.delegateEmail || undefined,
          scope: DRIVE_WRITE_SCOPE,
          fetchImpl
        });
        cachedToken = {
          accessToken: tok.accessToken,
          expiresAtMs: now() + (tok.expiresIn || 3600) * 1000,
          scope: DRIVE_WRITE_SCOPE,
          authMode: "service_account"
        };
        return { ok: true, ...cachedToken };
      }

      if (!got) {
        if (lastError) throw lastError;
        if (readOnlySeen) {
          return { ok: false, retryable: false,
            error: `every stored Google token is read-only (${DRIVE_WRITE_SCOPE} was not granted). ` +
                   `Nothing was written. The stored keys are left exactly as they are.` };
        }
        return { ok: false, retryable: true, error: "no stored Google token could be exchanged" };
      }

      cachedToken = {
        accessToken: got.accessToken,
        expiresAtMs: now() + (got.expiresIn || 3600) * 1000,
        scope: got.scope || null,
        authMode: "oauth"
      };
    } else {
      const tok = await fetchAccessToken({
        clientEmail: cfg.serviceAccount.clientEmail,
        privateKey: cfg.serviceAccount.privateKey,
        delegateEmail: cfg.delegateEmail || undefined,
        scope: DRIVE_WRITE_SCOPE,
        fetchImpl
      });
      cachedToken = {
        accessToken: tok.accessToken,
        expiresAtMs: now() + (tok.expiresIn || 3600) * 1000,
        scope: DRIVE_WRITE_SCOPE,
        authMode: "service_account"
      };
    }
  } catch (err) {
    return { ok: false, retryable: true, error: redact(`Google token exchange failed: ${String(err?.message || err)}`) };
  }
  return { ok: true, ...cachedToken };
}

function verdictOf(res, what) {
  if (res.blocked) return { ok: false, retryable: true, status: 0, error: res.error || `${what} held by the adapters fence` };
  if (res.transmitted === false) return { ok: false, retryable: true, status: 0, error: res.error || `${what} was not sent` };
  /* A BINARY CALL CAN FAIL WITH A 200. The size cap in transmitBinary bites on
     a response the server thinks went perfectly, so `ok: false` under a 2xx is
     real and must not be read off the status code alone. It is not retryable —
     the file will be the same size next time. */
  if (res.ok === false && res.status >= 200 && res.status < 300) {
    return { ok: false, retryable: false, status: res.status, error: redact(res.error || `${what} was refused`) };
  }
  if (res.status === 0) return { ok: false, retryable: true, status: 0, error: res.error || `${what} did not complete` };
  if (res.status === 403) {
    return { ok: false, retryable: false, status: 403,
      error: redact(`${what}: HTTP 403 from Google. The commonest cause is a read-only token — ` +
        `this pipeline needs ${DRIVE_WRITE_SCOPE}. Nothing was written and no stored key was changed.`) };
  }
  const cls = classify(res.status);
  if (cls.status === "sent") return { ok: true, retryable: false, status: res.status, error: null, body: res.body };
  return { ok: false, retryable: cls.retryable, status: res.status, error: redact(res.error || `${what} returned HTTP ${res.status}`) };
}

async function driveCall(method, url, { token, body, contentType, extraHeaders, env = process.env, fetchImpl, timeoutMs, signal, what }) {
  const headers = { authorization: `Bearer ${token}`, accept: "application/json", ...(extraHeaders || {}) };
  const opts = { fence: ADAPTERS, env, fetchImpl, timeoutMs, signal, what };
  if (method === "POST" && body !== undefined) {
    return postJsonTo(url, { headers, body, contentType: contentType || "application/json", ...opts });
  }
  return transmit(url, {
    method,
    headers: body === undefined ? headers : { ...headers, "Content-Type": contentType || "application/json" },
    body
  }, opts);
}

const qs = (params) => Object.entries(params)
  .filter(([, v]) => v !== undefined && v !== null && v !== "")
  .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
  .join("&");

/* Shared-drive flags. Every call carries them: Paul's folder is a shared drive,
   and a call without these answers 404 for a file that plainly exists. */
const SHARED = { supportsAllDrives: "true", includeItemsFromAllDrives: "true" };

/* ─────────────────────────────────────────────────────────────────────────
   listNewVideos — the trigger for the whole pipeline.

   `files.list` with the folder in parents, createdTime after a watermark, and
   trashed = false — exactly the query in the API research. Two filters are
   applied here rather than in the query because Drive cannot express them:

     * SIZE ABOVE ZERO. A phone that is still uploading has a real file id and
       zero bytes. Picking it up starts an edit on an empty video.
     * A VIDEO. A stray note or thumbnail in the folder is not a take.
   ───────────────────────────────────────────────────────────────────────── */
export async function listNewVideos({
  folderId, since, pageSize = 50, env = process.env, fetchImpl, timeoutMs, signal
} = {}) {
  const parent = String(folderId || "").trim();
  if (!parent) return { ok: false, retryable: false, error: "listNewVideos needs a folderId", files: [] };

  const tok = await driveAccessToken({ env, fetchImpl });
  if (!tok.ok) return { ...tok, files: [] };

  const clauses = [`'${parent.replace(/'/g, "\\'")}' in parents`, "trashed = false"];
  /* MODIFIED time, not CREATED time. `since` is when we last recorded a take.
     A take filmed a week ago and moved into Raw today was CREATED a week ago,
     so a created-time filter never sees it — measured 2026-09-24: the second
     take, filmed 09-21, sat in Raw invisible while the poll asked for files
     created after 01:45 that morning. Moving a file into a folder bumps its
     modified time, which is the event the poll is actually waiting for. A file
     seen twice is harmless: recordRawTake is idempotent on the Drive id. */
  if (since) clauses.push(`modifiedTime > '${new Date(since).toISOString()}'`);

  const url = `${DRIVE_API}/files?${qs({
    q: clauses.join(" and "),
    fields: `files(${FILE_FIELDS})`,
    orderBy: "modifiedTime",
    pageSize,
    ...SHARED
  })}`;

  const res = await driveCall("GET", url, { token: tok.accessToken, env, fetchImpl, timeoutMs, signal, what: "drive list new takes" });
  const v = verdictOf(res, "drive list new takes");
  if (!v.ok) return { ...v, files: [] };

  const files = (v.body?.files || []).filter((f) => {
    const bytes = Number(f.size);
    if (!Number.isFinite(bytes) || bytes <= 0) return false;
    return String(f.mimeType || "").startsWith("video/");
  });
  return { ok: true, retryable: false, files, skipped: (v.body?.files || []).length - files.length };
}

/* ═══════════════════════════════════════════════════════════════════════════
   listBrollClips — the B-roll library, in priority order.

   MEASURED 2026-09-23: nothing in this repo loaded the B-roll library. The
   sweeper always handed `brollLibrary: []` to the pipeline, and
   placeBrollAndExport skips B-roll entirely when that list is empty. So no ad
   had ever had, or could ever have had, a single clip placed on it. Renaming
   the clips so the planner can match them does nothing until this runs.

   THE ORDER OUT OF HERE IS THE PRIORITY ORDER. planBroll walks the clips as
   handed and its cursor only moves forward, so the folder listed first takes
   the early moments. That is why `folders` defaults to BROLL_FOLDERS and why
   this does not sort the result.

   Returns clips carrying `driveFileId` and `name` and no bytes. The bytes are
   fetched later, and only for the handful of clips that actually win a slot —
   downloading all of them on every pass would be dozens of megabytes per take
   for five clips of use.
   ═══════════════════════════════════════════════════════════════════════════ */
export async function listBrollClips({
  brollFolderId, folders = BROLL_FOLDERS, pageSize = 300,
  env = process.env, fetchImpl, timeoutMs, signal
} = {}) {
  const parent = String(brollFolderId || "").trim();
  if (!parent) return { ok: false, retryable: false, error: "listBrollClips needs a brollFolderId", clips: [] };

  const tok = await driveAccessToken({ env, fetchImpl });
  if (!tok.ok) return { ...tok, clips: [] };

  const listIn = async (folderId) => {
    const url = `${DRIVE_API}/files?${qs({
      q: `'${String(folderId).replace(/'/g, "\\'")}' in parents and trashed = false`,
      fields: `files(${FILE_FIELDS})`,
      orderBy: "name",
      pageSize,
      ...SHARED
    })}`;
    const res = await driveCall("GET", url, { token: tok.accessToken, env, fetchImpl, timeoutMs, signal, what: "drive list b-roll" });
    const v = verdictOf(res, "drive list b-roll");
    return v.ok ? (v.body?.files || []) : null;
  };

  const top = await listIn(parent);
  if (top === null) return { ok: false, retryable: true, error: "could not read the b-roll folder", clips: [] };

  const byName = new Map(
    top.filter((f) => f.mimeType === FOLDER_MIME).map((f) => [f.name, f.id])
  );

  const clips = [];
  const missing = [];
  for (const wanted of folders) {
    const id = byName.get(wanted);
    if (!id) { missing.push(wanted); continue; }
    const files = await listIn(id);
    if (files === null) { missing.push(wanted); continue; }
    /* VIDEO BEFORE STILLS, inside each folder.

       A still can only use Submagic's `cover`, `contain`, `rounded` or `square`
       layouts — every one of which fills the frame, so Chris disappears for the
       three seconds it is up. A video clip can use `split-35-65` or
       `pip-bottom-right` and keep his face on screen beside it. The face is the
       ad. So when a moving version of the same thing exists, it wins. */
    const usable = files.filter((f) => {
      const mime = String(f.mimeType || "");
      /* A PDF cannot be shown as b-roll, and a folder is not a clip. */
      return mime.startsWith("video/") || mime.startsWith("image/");
    });
    const rank = (f) => (String(f.mimeType || "").startsWith("video/") ? 0 : 1);
    usable.sort((a, b) => rank(a) - rank(b) || String(a.name).localeCompare(String(b.name)));
    for (const f of usable) {
      clips.push({ driveFileId: f.id, name: f.name, mimeType: f.mimeType, folder: wanted });
    }
  }

  return { ok: true, retryable: false, clips, missingFolders: missing };
}

/** getFileMeta — one file, including videoMediaMetadata (width/height/duration).
    That is where the 4K check in .claude/rules/video-4k-unless-ad.md gets its
    real numbers, rather than trusting what anyone typed. */
export async function getFileMeta(fileId, { env = process.env, fetchImpl, timeoutMs, signal } = {}) {
  const id = String(fileId || "").trim();
  if (!id) return { ok: false, retryable: false, error: "getFileMeta needs a fileId" };
  const tok = await driveAccessToken({ env, fetchImpl });
  if (!tok.ok) return tok;

  const url = `${DRIVE_API}/files/${encodeURIComponent(id)}?${qs({ fields: FILE_FIELDS, ...SHARED })}`;
  const res = await driveCall("GET", url, { token: tok.accessToken, env, fetchImpl, timeoutMs, signal, what: "drive get file" });
  const v = verdictOf(res, "drive get file");
  if (!v.ok) return v;
  const meta = v.body?.videoMediaMetadata || {};
  return {
    ok: true, retryable: false,
    file: v.body,
    width: Number.isFinite(Number(meta.width)) ? Number(meta.width) : null,
    height: Number.isFinite(Number(meta.height)) ? Number(meta.height) : null,
    durationSeconds: Number.isFinite(Number(meta.durationMillis)) ? Number(meta.durationMillis) / 1000 : null
  };
}

/** renameFile — files.update with a new name. The raw take gets its real name
    only after the transcript says which script it is; before that the phone's
    own file name is all anyone has. */
export async function renameFile(fileId, name, { env = process.env, fetchImpl, timeoutMs, signal } = {}) {
  const id = String(fileId || "").trim();
  const newName = String(name || "").trim();
  if (!id) return { ok: false, retryable: false, error: "renameFile needs a fileId" };
  if (!newName) return { ok: false, retryable: false, error: "renameFile needs a name" };

  const tok = await driveAccessToken({ env, fetchImpl });
  if (!tok.ok) return tok;

  const url = `${DRIVE_API}/files/${encodeURIComponent(id)}?${qs({ fields: "id,name", ...SHARED })}`;
  const res = await driveCall("PATCH", url, {
    token: tok.accessToken, body: JSON.stringify({ name: newName }),
    env, fetchImpl, timeoutMs, signal, what: "drive rename file"
  });
  const v = verdictOf(res, "drive rename file");
  return v.ok ? { ok: true, retryable: false, fileId: id, name: v.body?.name || newName } : v;
}

/* ensureFolder — find it or make it. Idempotent on purpose: the sweeper reruns
   every five minutes and a second pass must not leave two folders called 043. */
export async function ensureFolder({ parentId, name, env = process.env, fetchImpl, timeoutMs, signal } = {}) {
  const parent = String(parentId || "").trim();
  const folderName = String(name || "").trim();
  if (!parent) return { ok: false, retryable: false, error: "ensureFolder needs a parentId" };
  if (!folderName) return { ok: false, retryable: false, error: "ensureFolder needs a name" };

  const tok = await driveAccessToken({ env, fetchImpl });
  if (!tok.ok) return tok;

  const q = `'${parent.replace(/'/g, "\\'")}' in parents and trashed = false and ` +
            `mimeType = '${FOLDER_MIME}' and name = '${folderName.replace(/'/g, "\\'")}'`;
  const findUrl = `${DRIVE_API}/files?${qs({ q, fields: "files(id,name)", pageSize: 10, ...SHARED })}`;
  const found = await driveCall("GET", findUrl, { token: tok.accessToken, env, fetchImpl, timeoutMs, signal, what: "drive find folder" });
  const fv = verdictOf(found, "drive find folder");
  if (!fv.ok) return fv;
  const existing = (fv.body?.files || [])[0];
  if (existing?.id) return { ok: true, retryable: false, folderId: String(existing.id), created: false };

  const makeUrl = `${DRIVE_API}/files?${qs({ fields: "id,name", ...SHARED })}`;
  const made = await driveCall("POST", makeUrl, {
    token: tok.accessToken,
    body: JSON.stringify({ name: folderName, mimeType: FOLDER_MIME, parents: [parent] }),
    env, fetchImpl, timeoutMs, signal, what: "drive create folder"
  });
  const mv = verdictOf(made, "drive create folder");
  if (!mv.ok) return mv;
  const id = mv.body?.id;
  if (!id) return { ok: false, retryable: false, error: "Drive made a folder but returned no id" };
  return { ok: true, retryable: false, folderId: String(id), created: true };
}

/* ─────────────────────────────────────────────────────────────────────────
   uploadTextFile — the one-page brief that rides beside the video.

   Multipart upload, because a text body is the one thing the chokepoint can
   carry. The boundary is random per call: a fixed boundary that happened to
   appear inside the brief would split the request in the middle of the copy.
   ───────────────────────────────────────────────────────────────────────── */
export async function uploadTextFile({
  parentId, name, content, mimeType = "text/plain",
  env = process.env, fetchImpl, timeoutMs, signal
} = {}) {
  const parent = String(parentId || "").trim();
  const fileName = String(name || "").trim();
  const text = String(content ?? "");
  if (!parent) return { ok: false, retryable: false, error: "uploadTextFile needs a parentId" };
  if (!fileName) return { ok: false, retryable: false, error: "uploadTextFile needs a name" };
  const bytes = Buffer.byteLength(text, "utf8");
  if (bytes > MAX_TEXT_UPLOAD_BYTES) {
    return { ok: false, retryable: false,
      error: `uploadTextFile carries text, not media: ${bytes} bytes is over the ${MAX_TEXT_UPLOAD_BYTES}-byte cap` };
  }

  const tok = await driveAccessToken({ env, fetchImpl });
  if (!tok.ok) return tok;

  let boundary = `fundhub-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`;
  while (text.includes(boundary)) boundary += Math.random().toString(36).slice(2);

  const body =
    `--${boundary}\r\n` +
    `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
    `${JSON.stringify({ name: fileName, parents: [parent] })}\r\n` +
    `--${boundary}\r\n` +
    `Content-Type: ${mimeType}; charset=UTF-8\r\n\r\n` +
    `${text}\r\n` +
    `--${boundary}--\r\n`;

  const url = `${DRIVE_UPLOAD_API}/files?${qs({ uploadType: "multipart", fields: "id,name", ...SHARED })}`;
  const res = await driveCall("POST", url, {
    token: tok.accessToken, body, contentType: `multipart/related; boundary=${boundary}`,
    env, fetchImpl, timeoutMs, signal, what: "drive upload brief"
  });
  const v = verdictOf(res, "drive upload brief");
  if (!v.ok) return v;
  const id = v.body?.id;
  if (!id) return { ok: false, retryable: false, error: "Drive accepted the brief but returned no file id" };
  return { ok: true, retryable: false, fileId: String(id), name: v.body?.name || fileName };
}

/* ─────────────────────────────────────────────────────────────────────────
   downloadFile — the take itself, as bytes, with our own token.

   `alt=media` on the ordinary files endpoint. Authenticated, so there is no
   virus-scan interstitial, no `confirm=t` query trick, no size threshold and
   no requirement that the file be shared with anybody. That is the whole
   reason this is the preferred way to get a take out of Drive.

   The cap is the caller's, defaulting to MAX_VIDEO_BYTES, and it is enforced
   inside the chokepoint against content-length first and then chunk by chunk.
   ───────────────────────────────────────────────────────────────────────── */
export async function downloadFile(fileId, {
  env = process.env, fetchImpl, maxBytes = MAX_VIDEO_BYTES,
  timeoutMs = VIDEO_TIMEOUT_MS, signal
} = {}) {
  const id = String(fileId || "").trim();
  if (!id) return { ok: false, retryable: false, error: "downloadFile needs a fileId" };

  const tok = await driveAccessToken({ env, fetchImpl });
  if (!tok.ok) return tok;

  const url = `${DRIVE_API}/files/${encodeURIComponent(id)}?${qs({ alt: "media", ...SHARED })}`;
  const res = await transmitBinary(url, {
    method: "GET",
    headers: { authorization: `Bearer ${tok.accessToken}` }
  }, {
    fence: ADAPTERS, env, fetchImpl, maxBytes, timeoutMs, signal,
    what: "drive download take"
  });

  const v = verdictOf(res, "drive download take");
  if (!v.ok) return v;
  if (!res.bytes || res.byteLength <= 0) {
    /* A real file id with zero bytes is a phone that has not finished
       uploading. listNewVideos already filters those; this is the second
       line, because sending an empty MP4 to Submagic costs a paid minute. */
    return { ok: false, retryable: true, error: "Drive returned an empty file — the upload from the phone may still be running" };
  }
  return {
    ok: true, retryable: false,
    bytes: res.bytes,
    byteLength: res.byteLength,
    contentType: res.contentType || "video/mp4"
  };
}

/* ─────────────────────────────────────────────────────────────────────────
   THERE IS NO shareAnyoneWithLink HERE ANY MORE, AND THAT IS ON PURPOSE.

   It used to live at this spot: one POST that added
   `{ role: "reader", type: "anyone" }` to a file, so that Submagic could fetch
   a take from a plain URL. Its only caller was the `link` staging mode in
   src/ad-videos/staging.mjs.

   Both were deleted on 2026-09-22. The share was never taken off again — a
   take handed over for one edit stayed world-readable to anyone holding its id
   for the life of the file — and Google grants no expiry on an `anyone`
   permission, so there was no small fix that bounded it. Submagic's own
   documented route (`POST /v1/projects/upload`, multipart, up to 2 GB) takes
   the bytes directly, so nothing needs the share at all.

   DO NOT ADD IT BACK to make some other feature easier. Publishing a customer
   or owner file to the whole internet is a decision, not a helper function.
   ───────────────────────────────────────────────────────────────────────── */

/* ─────────────────────────────────────────────────────────────────────────
   uploadVideo — the finished ad, into Paul's folder. RESUMABLE, in two calls.

   This used to refuse. The reason it refused — the chokepoint could not carry
   an MP4 — is fixed in src/lib/outbound-fetch.mjs, so the bytes now move
   inside the fence with a size cap and a long clock.

   WHY RESUMABLE AND NOT MULTIPART. Google's own guidance puts multipart at 5 MB
   and under; a finished take is two orders of magnitude past that. Resumable
   is two requests: the first creates a session and answers with a one-time
   session URL in the `location` header, the second PUTs the bytes to it. The
   session URL is a credential for one upload — it is never logged and never
   stored.

   `sourceUrl` is fetched with NO credentials on purpose: it is the vendor's
   own finished-render link, and attaching our Drive token to a third-party
   host is how a token leaks.
   ───────────────────────────────────────────────────────────────────────── */
export async function uploadVideo({
  parentId, name, sourceUrl, bytes, contentType = "video/mp4",
  env = process.env, fetchImpl, maxBytes = MAX_VIDEO_BYTES,
  timeoutMs = VIDEO_TIMEOUT_MS, signal
} = {}) {
  const parent = String(parentId || "").trim();
  const fileName = String(name || "").trim();
  if (!parent) return { ok: false, retryable: false, error: "uploadVideo needs a parentId" };
  if (!fileName) return { ok: false, retryable: false, error: "uploadVideo needs a name" };

  let payload = bytes || null;
  let type = contentType;

  if (!payload) {
    const from = String(sourceUrl || "").trim();
    if (!/^https?:\/\//i.test(from)) {
      return { ok: false, retryable: false, error: "uploadVideo needs bytes or an http(s) sourceUrl" };
    }
    const got = await transmitBinary(from, { method: "GET" }, {
      fence: ADAPTERS, env, fetchImpl, maxBytes, timeoutMs, signal,
      what: "download the finished render"
    });
    const gv = verdictOf(got, "download the finished render");
    if (!gv.ok) return gv;
    if (!got.bytes || got.byteLength <= 0) {
      return { ok: false, retryable: true, error: "the finished-render link returned no bytes" };
    }
    payload = got.bytes;
    type = got.contentType || contentType;
  }

  if (payload.byteLength > maxBytes) {
    return { ok: false, retryable: false,
      error: `uploadVideo refused: ${payload.byteLength} bytes is over the ${maxBytes}-byte cap` };
  }

  const tok = await driveAccessToken({ env, fetchImpl });
  if (!tok.ok) return tok;

  // 1. Open the session. Metadata only; not one byte of video moves here.
  const startUrl = `${DRIVE_UPLOAD_API}/files?${qs({ uploadType: "resumable", fields: "id,name", ...SHARED })}`;
  const started = await driveCall("POST", startUrl, {
    token: tok.accessToken,
    body: JSON.stringify({ name: fileName, parents: [parent] }),
    env, fetchImpl, timeoutMs, signal, what: "drive open upload session"
  });
  const sv = verdictOf(started, "drive open upload session");
  if (!sv.ok) return sv;

  const session = started.headers?.location || started.headers?.["x-guploader-uploadid-location"] || null;
  if (!session) {
    return { ok: false, retryable: true,
      error: "Drive opened an upload session but returned no location header — nothing was uploaded" };
  }

  // 2. The bytes. One PUT, through the same fence, with the long clock.
  const put = await postBinaryTo(session, {
    method: "PUT",
    headers: { authorization: `Bearer ${tok.accessToken}` },
    contentType: type,
    body: payload,
    byteLength: payload.byteLength,
    maxBytes,
    timeoutMs,
    fence: ADAPTERS, env, fetchImpl, signal, what: "drive upload video"
  });
  const pv = verdictOf(put, "drive upload video");
  if (!pv.ok) return pv;

  const id = pv.body?.id;
  if (!id) return { ok: false, retryable: true, error: "Drive accepted the video but returned no file id" };
  return { ok: true, retryable: false, fileId: String(id), name: pv.body?.name || fileName, byteLength: payload.byteLength };
}

/** A Drive resumable session URL. Anything else is refused, so this cannot be
    pointed at some other host. */
export function driveSessionUrl(url) {
  try {
    const u = new URL(String(url || ""));
    return u.protocol === "https:"
      && u.hostname === "www.googleapis.com"
      && u.pathname.startsWith("/upload/drive/");
  } catch {
    return false;
  }
}

function receivedFromRange(header) {
  const m = /bytes=(\d+)-(\d+)/i.exec(String(header || ""));
  if (!m) return null;
  return Number(m[2]) + 1;
}

function readChunkStatus(put, { start, total }) {
  if (put.blocked || put.transmitted === false) {
    return { ok: false, retryable: true, error: put.error || "the upload did not leave" };
  }
  const received = receivedFromRange(put.headers?.range);
  if (put.status === 308) {
    if (received == null || received <= start) {
      return { ok: false, retryable: true, status: 308, error: "Drive did not keep that part of the file" };
    }
    return { ok: true, done: received >= total, received, status: 308 };
  }
  if (put.status >= 200 && put.status < 300) {
    const id = put.body?.id;
    if (!id) return { ok: false, retryable: true, status: put.status, error: "Drive accepted the video but returned no file id" };
    return {
      ok: true, done: true, fileId: String(id), name: put.body?.name || null,
      received: total, status: put.status
    };
  }
  return {
    ok: false, retryable: put.status >= 500 || put.status === 0, status: put.status,
    error: put.error || `Drive returned HTTP ${put.status}`
  };
}

/**
 * Open a resumable upload into one folder. No video bytes move here.
 * The caller then sends the file in pieces with putVideoChunk.
 */
export async function openVideoSession({
  parentId, name, totalBytes, contentType = "video/mp4",
  env = process.env, fetchImpl, timeoutMs = 20_000, signal
} = {}) {
  const parent = String(parentId || "").trim();
  const fileName = String(name || "").trim();
  const total = Number(totalBytes);
  if (!parent) return { ok: false, retryable: false, error: "openVideoSession needs a parentId" };
  if (!fileName) return { ok: false, retryable: false, error: "openVideoSession needs a name" };
  if (!Number.isFinite(total) || total < 1) {
    return { ok: false, retryable: false, error: "openVideoSession needs the file size" };
  }

  const tok = await driveAccessToken({ env, fetchImpl });
  if (!tok.ok) return tok;

  const startUrl = `${DRIVE_UPLOAD_API}/files?${qs({ uploadType: "resumable", fields: "id,name", ...SHARED })}`;
  const started = await driveCall("POST", startUrl, {
    token: tok.accessToken,
    body: JSON.stringify({ name: fileName, parents: [parent] }),
    extraHeaders: {
      "X-Upload-Content-Type": contentType,
      "X-Upload-Content-Length": String(total)
    },
    env, fetchImpl, timeoutMs, signal, what: "drive open upload session"
  });
  const sv = verdictOf(started, "drive open upload session");
  if (!sv.ok) return sv;

  const session = started.headers?.location || null;
  if (!session || !driveSessionUrl(session)) {
    return { ok: false, retryable: true,
      error: "Drive opened an upload session but returned no location header — nothing was uploaded" };
  }
  return { ok: true, sessionUrl: session };
}

/**
 * Forward one slice of the original file. The bytes are not re-encoded.
 * A 308 means Drive has that slice and wants the next one.
 */
export async function putVideoChunk({
  sessionUrl, bytes, start, end, total, contentType = "video/mp4",
  env = process.env, fetchImpl, timeoutMs = 25_000, signal
} = {}) {
  if (!driveSessionUrl(sessionUrl)) {
    return { ok: false, retryable: false, error: "that upload session is not a Drive upload" };
  }
  const tok = await driveAccessToken({ env, fetchImpl });
  if (!tok.ok) return tok;
  const payload = bytes instanceof Uint8Array ? bytes : Buffer.from(bytes || []);
  const put = await postBinaryTo(sessionUrl, {
    method: "PUT",
    redirect: "manual",
    headers: {
      authorization: `Bearer ${tok.accessToken}`,
      "content-range": `bytes ${start}-${end}/${total}`
    },
    contentType,
    body: payload,
    byteLength: payload.byteLength,
    maxBytes: Math.max(payload.byteLength, 1),
    timeoutMs,
    fence: ADAPTERS,
    env, fetchImpl, signal,
    what: "drive upload video chunk"
  });
  return readChunkStatus(put, { start, total });
}

/** send — provider contract. Writes the brief; refuses anything else. */
export async function send(message = {}, options = {}) {
  try {
    const res = await uploadTextFile({
      parentId: message.to || message.parentId,
      name: message.name,
      content: message.body,
      mimeType: message.mimeType,
      ...options
    });
    if (res.ok) return success(res.fileId);
    return res.retryable === false ? rejection(res.error) : failure(res.error);
  } catch (err) {
    return failure(`google drive write provider error: ${String((err && err.message) || err)}`);
  }
}

export default {
  PROVIDER, CHANNELS, ADDRESS_FIELD, ENABLED, TRANSMITS, send,
  driveAccessToken, resetTokenCache, grantsWrite,
  listNewVideos, getFileMeta, renameFile, ensureFolder, uploadTextFile,
  downloadFile, uploadVideo, openVideoSession, putVideoChunk, driveSessionUrl
};
