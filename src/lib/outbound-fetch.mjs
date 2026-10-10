// THE CHOKEPOINT. Every outbound call that can have an effect on a real client
// or a real vendor account goes through transmit(), and transmit() is the only
// function in this repository permitted to hold a live `fetch` for that purpose.
//
// WHY IT IS SHAPED THIS WAY. The previous fence was a condition each caller was
// trusted to remember. That design cannot be verified: a provider added next
// month either remembers or it does not, and nothing fails when it does not.
// Correctness that depends on every future author is not correctness.
//
// So the fence is not something a sender calls. It is something a sender cannot
// avoid, because the only route to the network runs through here, and
// src/lib/no-unfenced-transmit.test.mjs fails the build if any module reaches
// the network another way. Adding a bypass is possible, but not quietly — it
// takes an entry on an allow-list with a written reason, in a test a reviewer
// reads.
//
// TWO THINGS MUST BE TRUE BEFORE ANYTHING LEAVES:
//   1. The caller declared which fence it is behind — "messaging" (reaches a
//      person) or "adapters" (reaches a vendor). An undeclared or unrecognised
//      fence is BLOCKED. Forgetting the parameter cannot mean "send it".
//   2. That fence's flag is set to an explicit off value. See
//      src/lib/dry-run.mjs — unset, empty and unparseable all hold.
//
// NEVER THROWS. Callers classify outcomes; they do not handle transport
// exceptions. A blocked call returns the same shape as a failed one, with
// `blocked: true` so a caller can tell "we chose not to" from "it did not work".

import {
  fenceVerdict, MESSAGING_DRY_RUN, ADAPTERS_DRY_RUN
} from "./dry-run.mjs";

/** The fences. A caller names one; anything else is refused. */
export const MESSAGING = "messaging";
export const ADAPTERS = "adapters";

/* INTERNAL — infrastructure that has no effect on any client or client record:
   asking a language model a question, reading a document out of Drive, looking
   up a payment we already know about. These are NOT held by the dry-run flags,
   because holding them makes nobody safer and breaks the product for staff.
   Blocking an embedding call does not protect a consumer; it just stops search
   working while the fence is up.

   IT IS STILL NOT A BYPASS, AND THIS IS THE IMPORTANT PART. A caller must name
   INTERNAL out loud, and src/lib/no-unfenced-transmit.test.mjs pins the set of
   modules allowed to name it to an exact list. Adding one fails the build until
   somebody edits that list and says why. So the escape hatch exists, it is
   small, it is enumerated, and it cannot be widened quietly — which is the most
   that can be true of any escape hatch.

   If what you are adding can reach a person or change a record at a vendor, it
   is not INTERNAL, whatever it feels like. */
export const INTERNAL = "internal";

const FENCE_FLAG = Object.freeze({
  [MESSAGING]: MESSAGING_DRY_RUN,
  [ADAPTERS]: ADAPTERS_DRY_RUN
});

/** Fences that are real, in the sense that a flag can hold them. */
export const FENCED = Object.freeze([MESSAGING, ADAPTERS]);
const KNOWN_FENCES = new Set([...FENCED, INTERNAL]);

export const DEFAULT_TIMEOUT_MS = 10_000;

/* ─────────────────────────────────────────────────────────────────────────
   THE BINARY PATH. Added 2026-09-22 for the ad-video pipeline.

   transmit() reads every response with res.text(). That is right for JSON and
   fatal for an MP4: the bytes are decoded as UTF-8 and come back mangled. So
   for a long time this repo could not move a video at all, in either
   direction, and the ad-video pipeline said so out loud rather than opening a
   socket of its own.

   transmitBinary() is that missing half, and it is INSIDE the fence on
   purpose. The alternative — one raw fetch in one provider "just for video" —
   is precisely the hole src/lib/no-unfenced-transmit.test.mjs exists to close.
   A caller still names a fence, the dry-run flags still hold it, and the
   structural test still passes because nothing new reaches the network outside
   this file.

   THREE THINGS IT DOES THAT transmit() DOES NOT:

     1. A SIZE CAP, enforced while reading. A 4K take is hundreds of megabytes
        and a serverless function has about a gigabyte of memory for
        everything. The cap is checked against content-length BEFORE the body
        is pulled, and again chunk by chunk as it arrives, so a vendor that
        lies about the length still cannot fill the heap — the read stops and
        the request is aborted.
     2. A LONGER DEFAULT TIMEOUT. Ten seconds is right for a JSON call and
        wrong for 200 MB; two minutes is the default here and it is still a
        real ceiling, not "forever".
     3. BYTES BACK, NOT TEXT. `bytes` is a Uint8Array and it is never logged,
        never stored, and never put in an error message.
   ───────────────────────────────────────────────────────────────────────── */

/** Two minutes. Long enough for a few hundred megabytes, short enough to be a
    ceiling a stuck socket actually hits. */
export const DEFAULT_BINARY_TIMEOUT_MS = 120_000;

/** How much a binary call will hold in memory unless the caller raises it. */
export const DEFAULT_MAX_BINARY_BYTES = 512 * 1024 * 1024;

/** The ceiling on that ceiling. A caller cannot ask for more than this, whatever
    it passes, because past here the process is the thing that breaks. */
export const HARD_MAX_BINARY_BYTES = 2 * 1024 * 1024 * 1024;

/** How much of an error is kept. It lands in messages.last_error, which
    operators read and paste into support threads, so it is bounded. */
export const MAX_ERROR_CHARS = 300;

/* redact — strip anything credential-shaped out of text bound for the database
   or the logs.

   Vendor errors echo back request context, and a misconfigured request can echo
   back the Authorization header with it. CLAUDE.md §8: never a secret in code,
   fixtures, or logs.

   Deliberately aggressive. A redacted error that is harder to read is a far
   cheaper mistake than a live API key sitting in a database column. */
export function redact(text) {
  return String(text ?? "")
    .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi, "$1 [redacted]")
    .replace(/\b(api[_-]?key|apikey|token|secret|password|authorization)"?\s*[:=]\s*"?[^\s",}]+/gi,
      "$1=[redacted]")
    .replace(/\bkey-[A-Za-z0-9]{8,}/g, "[redacted]")
    .replace(/\bre_[A-Za-z0-9_]{8,}/g, "[redacted]")
    .slice(0, MAX_ERROR_CHARS);
}

/* `transmitted` — WAS A REQUEST HANDED TO fetch AT ALL?

   Separate from `blocked`, and it is the field a caller must read before it
   retries anything. `blocked` says only "the dry-run fence held it"; there are
   other ways to return without reaching the network, and a caller that checks
   `blocked` alone treats those as maybes.

   false means NOTHING LEFT THIS PROCESS. Proven by control flow, not inferred
   from a status code or an error string — every `false` below is returned from
   a branch that sits above the `doFetch` call.

   true means a request was started. It does NOT mean it arrived, and it does
   not mean it succeeded: a timeout and a dropped socket are both `transmitted:
   true, status: 0`, because the vendor may well have accepted the work before
   the connection died. Anything that must not happen twice — mailing a letter,
   charging a card — has to treat that as "may have happened".

   `status: 0` is NOT a substitute for reading this. Both a fence hold and a
   timeout report 0. src/repair/send.mjs shipped a guard that could not tell
   those apart, and the result was that a send the fence held destroyed the
   letter it refused to send. */

/** The shape returned when nothing was sent. Same fields as a real result so a
    caller that ignores `blocked` still sees a clean failure rather than a
    surprise `undefined`. */
function held(reason, fence) {
  return {
    ok: false, blocked: true, transmitted: false, status: 0,
    body: null, headers: {}, error: reason, fence: fence ?? null
  };
}

/* readHeaders — response headers as a plain lower-cased object.

   Some vendors put the only copy of an identifier a caller needs in a header
   rather than the body: CRS returns the id its retention log is keyed by as
   `RequestID`, and nowhere else. Callers cannot reach the Response object —
   that is the whole point of the chokepoint — so the headers have to come back
   through here or they are unreachable.

   Never logged and never stored by this module. A header block can carry a
   Set-Cookie or an echoed Authorization, and the moment it lands somewhere
   durable it is a credential at rest. */
function readHeaders(res) {
  const out = {};
  try {
    res?.headers?.forEach?.((value, key) => { out[String(key).toLowerCase()] = value; });
  } catch { /* a stand-in Response with no iterable headers is not an error */ }
  return out;
}

/**
 * Make an outbound request, if the fence permits it.
 *
 * @param {string} url
 * @param {object} [init]                 Passed to fetch. method/headers/body.
 * @param {object} opts
 * @param {"messaging"|"adapters"} opts.fence   Required. Undeclared = blocked.
 * @param {string} [opts.what]            Short description for the log line.
 * @param {object} [opts.env]             Defaults to process.env.
 * @param {Function} [opts.fetchImpl]     Injected for tests. Does NOT bypass
 *                                        the fence — a test that wants a send
 *                                        must turn the fence off explicitly.
 * @param {number} [opts.timeoutMs]
 * @param {AbortSignal} [opts.signal]
 * @returns {Promise<{ok:boolean, blocked:boolean, transmitted:boolean,
 *                     status:number, body:any,
 *                     headers:Record<string,string>, error:string|null,
 *                     fence:string|null}>}
 *          `transmitted:false` means no request was handed to fetch — proven by
 *          control flow, not guessed from the status. See the note above held().
 */
/* fenceHold — the two questions asked before ANY request, binary or not.
   Returns a held() shape when the answer is no, and null when the caller may
   proceed. One function so the binary path cannot drift into asking a weaker
   question than the JSON path asks. */
function fenceHold(fence, { what, env, url } = {}) {
  if (!KNOWN_FENCES.has(fence)) {
    /* Not a configuration problem — a programming one. Loud, because the fix is
       to name a fence and the alternative is a silent unguarded send. */
    return held(
      `outbound transmit refused: no fence declared${fence ? ` (got "${fence}")` : ""}. ` +
      `Pass fence: MESSAGING, ADAPTERS or INTERNAL from src/lib/outbound-fetch.mjs.`,
      fence
    );
  }

  const flag = FENCE_FLAG[fence];
  if (flag) {
    const verdict = fenceVerdict(flag, env);
    if (!verdict.allowed) {
      console.warn(`[fence] held ${what || url} — ${verdict.reason}`);
      return held(`${verdict.reason}${what ? ` (${what})` : ""}`, fence);
    }
  }
  return null;
}

export async function transmit(url, init = {}, {
  fence,
  what,
  env,
  fetchImpl,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  signal,
  asText = false
} = {}) {
  const hold = fenceHold(fence, { what, env, url });
  if (hold) return hold;

  const doFetch = fetchImpl || globalThis.fetch;
  if (typeof doFetch !== "function") {
    // Above the call, so nothing was sent — even though the fence allowed it.
    return { ok: false, blocked: false, transmitted: false, status: 0, body: null, headers: {},
      error: "no fetch implementation available", fence };
  }

  // AbortController rather than Promise.race: a race leaves the request running
  // and the socket open, which under load is a connection leak that presents as
  // the vendor rate-limiting us.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const onOuterAbort = () => controller.abort();
  if (signal) signal.addEventListener("abort", onOuterAbort, { once: true });

  try {
    const res = await doFetch(url, { ...init, signal: controller.signal });

    // Read as text and parse defensively. A gateway returning an HTML error page
    // under a JSON content-type is ordinary, and res.json() throwing there would
    // lose the status code — which is the part that decides retryable.
    const text = await res.text().catch(() => "");
    let parsed = null;
    try { parsed = text ? JSON.parse(text) : null; } catch { /* not JSON; keep text */ }

    return {
      ok: res.ok,
      blocked: false,
      transmitted: true,
      status: res.status,
      body: asText ? text : parsed,
      headers: readHeaders(res),
      error: res.ok ? null : redact(text || `HTTP ${res.status}`),
      fence
    };
  } catch (err) {
    const aborted = err && (err.name === "AbortError" || err.name === "TimeoutError");
    return {
      ok: false,
      blocked: false,
      // The call was made. A timeout or a dropped socket says nothing about
      // whether the vendor accepted the work, so this stays true.
      transmitted: true,
      status: 0,
      body: null,
      headers: {},
      error: redact(aborted ? `timed out after ${timeoutMs}ms` : String((err && err.message) || err)),
      fence
    };
  } finally {
    clearTimeout(timer);
    if (signal) signal.removeEventListener("abort", onOuterAbort);
  }
}

/* readCapped — pull the body, stopping the moment it is too big.

   Chunk by chunk rather than res.arrayBuffer(), because arrayBuffer() buffers
   the WHOLE thing before anyone can object: a vendor that answers a 5 GB file
   to a request for a 200 MB one would take the process down before the cap was
   ever consulted. Here the cap bites on the chunk that crosses it, the reader
   is cancelled, and nothing further is pulled.

   A stand-in Response in a test may have no .body stream; arrayBuffer() is the
   fallback and its size is checked the moment it lands. */
async function readCapped(res, cap) {
  const body = res?.body;
  if (!body || typeof body.getReader !== "function") {
    const buf = await res.arrayBuffer();
    const u8 = new Uint8Array(buf);
    return u8.byteLength > cap
      ? { over: true, bytes: null, byteLength: u8.byteLength }
      : { over: false, bytes: u8, byteLength: u8.byteLength };
  }

  const reader = body.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    const chunk = value instanceof Uint8Array ? value : new Uint8Array(value);
    total += chunk.byteLength;
    if (total > cap) {
      try { await reader.cancel(); } catch { /* already gone */ }
      return { over: true, bytes: null, byteLength: total };
    }
    chunks.push(chunk);
  }

  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) { out.set(c, at); at += c.byteLength; }
  return { over: false, bytes: out, byteLength: total };
}

/** The shape a binary call returns when nothing came back. Same fields as a
    good one, so a caller that forgets to check `ok` reads a clean empty rather
    than an undefined. */
function noBytes(base) {
  return { ...base, bytes: null, byteLength: 0, contentType: null };
}

/**
 * Fetch BYTES through the fence. Never throws.
 *
 * @param {string} url
 * @param {object} [init]                 method/headers/body, as fetch takes them.
 * @param {object} opts
 * @param {"messaging"|"adapters"|"internal"} opts.fence  Required, same as transmit().
 * @param {number} [opts.maxBytes]        Refuses anything larger. See the cap notes above.
 * @param {number} [opts.timeoutMs]
 * @returns {Promise<{ok:boolean, blocked:boolean, transmitted:boolean, status:number,
 *                    bytes:Uint8Array|null, byteLength:number, contentType:string|null,
 *                    headers:Record<string,string>, error:string|null, fence:string|null}>}
 */
export async function transmitBinary(url, init = {}, {
  fence,
  what,
  env,
  fetchImpl,
  timeoutMs = DEFAULT_BINARY_TIMEOUT_MS,
  maxBytes = DEFAULT_MAX_BINARY_BYTES,
  signal
} = {}) {
  const hold = fenceHold(fence, { what, env, url });
  if (hold) return noBytes(hold);

  const cap = Math.min(Math.max(Number(maxBytes) || 0, 0), HARD_MAX_BINARY_BYTES);
  if (cap <= 0) {
    return noBytes({
      ok: false, blocked: false, transmitted: false, status: 0, body: null, headers: {},
      error: `binary transfer refused: maxBytes must be a positive number of bytes`, fence
    });
  }

  const doFetch = fetchImpl || globalThis.fetch;
  if (typeof doFetch !== "function") {
    return noBytes({ ok: false, blocked: false, transmitted: false, status: 0, body: null, headers: {},
      error: "no fetch implementation available", fence });
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const onOuterAbort = () => controller.abort();
  if (signal) signal.addEventListener("abort", onOuterAbort, { once: true });

  try {
    const res = await doFetch(url, { ...init, signal: controller.signal });
    const headers = readHeaders(res);
    const contentType = headers["content-type"] || null;

    /* THE CHEAP CHECK FIRST. content-length is a claim, not proof, but when it
       is present and over the cap there is no reason to pull a single byte. */
    const declared = Number(headers["content-length"]);
    if (Number.isFinite(declared) && declared > cap) {
      controller.abort();
      return noBytes({
        ok: false, blocked: false, transmitted: true, status: res.status, body: null, headers,
        error: `${what || url} is ${declared} bytes, over the ${cap}-byte cap for this transfer`,
        fence
      });
    }

    if (!res.ok) {
      /* An error body is small and is text. Read it for the reason, redact it,
         and never let it near the bytes path. */
      const text = await res.text().catch(() => "");
      return noBytes({
        ok: false, blocked: false, transmitted: true, status: res.status, body: null, headers,
        error: redact(text || `HTTP ${res.status}`), fence
      });
    }

    const read = await readCapped(res, cap);
    if (read.over) {
      return noBytes({
        ok: false, blocked: false, transmitted: true, status: res.status, body: null, headers,
        error: `${what || url} sent more than the ${cap}-byte cap for this transfer ` +
               `(stopped after ${read.byteLength} bytes)`,
        fence
      });
    }

    return {
      ok: true, blocked: false, transmitted: true, status: res.status,
      bytes: read.bytes, byteLength: read.byteLength, contentType,
      body: null, headers, error: null, fence
    };
  } catch (err) {
    const aborted = err && (err.name === "AbortError" || err.name === "TimeoutError");
    return noBytes({
      ok: false, blocked: false,
      // Same reasoning as transmit(): the call was made, so this stays true.
      transmitted: true, status: 0, body: null, headers: {},
      error: redact(aborted ? `timed out after ${timeoutMs}ms` : String((err && err.message) || err)),
      fence
    });
  } finally {
    clearTimeout(timer);
    if (signal) signal.removeEventListener("abort", onOuterAbort);
  }
}

/* sizeOf — how many bytes a body is, when that is knowable.

   FormData cannot be measured without walking it, so it answers null and the
   caller is expected to pass `byteLength` for the part that matters. A null is
   "unknown", never "zero". */
function sizeOf(body) {
  if (body == null) return 0;
  if (typeof body === "string") return Buffer.byteLength(body, "utf8");
  if (body instanceof Uint8Array) return body.byteLength;
  if (body instanceof ArrayBuffer) return body.byteLength;
  if (typeof Blob !== "undefined" && body instanceof Blob) return body.size;
  return null;
}

/**
 * SEND bytes through the fence, and read the (small, JSON) answer back.
 *
 * The other half of the binary path: an upload's response is a few hundred
 * bytes of JSON, so transmit() handles the reply perfectly well — what it could
 * not do was carry a large body under a ten-second clock with no size check.
 *
 * The cap is checked BEFORE anything is sent. A body too big to send is a
 * refusal, not a request that dies halfway and leaves a half-made record at a
 * vendor.
 */
export async function postBinaryTo(url, {
  headers = {},
  body,
  contentType,
  byteLength,
  maxBytes = DEFAULT_MAX_BINARY_BYTES,
  timeoutMs = DEFAULT_BINARY_TIMEOUT_MS,
  method = "POST",
  redirect,
  ...rest
} = {}) {
  const cap = Math.min(Math.max(Number(maxBytes) || 0, 0), HARD_MAX_BINARY_BYTES);
  const size = Number.isFinite(Number(byteLength)) ? Number(byteLength) : sizeOf(body);
  if (size !== null && size > cap) {
    /* NOT `blocked`. blocked means the dry-run fence held it, and a caller that
       reads this as a fence hold would wait for a flag that is already off.
       Nothing left the process either way — transmitted stays false. */
    return {
      ok: false, blocked: false, transmitted: false, status: 0, body: null, headers: {},
      error: `binary upload refused before it was sent: ${size} bytes is over the ${cap}-byte cap`,
      fence: rest.fence ?? null
    };
  }
  const init = {
    method,
    headers: contentType ? { "Content-Type": contentType, ...headers } : headers,
    body
  };
  /* Google's resumable upload answers 308 while the file is still incomplete.
     fetch follows 308 by default and would throw the rest of the file away. */
  if (redirect) init.redirect = redirect;
  return transmit(url, init, { ...rest, timeoutMs });
}

/** JSON POST — the shape almost every caller wants. */
export function postJsonTo(url, { headers = {}, body, contentType = "application/json", ...rest } = {}) {
  return transmit(url, {
    method: "POST",
    headers: { "Content-Type": contentType, ...headers },
    body
  }, rest);
}

/** Multipart POST — Whisper and other file uploads. Do not set Content-Type. */
export function postFormTo(url, { headers = {}, body, ...rest } = {}) {
  return transmit(url, {
    method: "POST",
    headers,
    body
  }, rest);
}
