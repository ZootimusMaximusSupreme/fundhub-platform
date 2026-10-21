// src/documents/store.mjs — object storage behind a provider interface.
//
// The registry (register.mjs) never talks to a storage vendor. It talks to a
// store, and a store wraps a PROVIDER — a four-method object. Vercel Blob is
// implemented first because underwrite-iq-lite already uses it, but nothing
// above this line knows that: swapping in S3/R2/GCS is one new provider
// function, no changes to register.mjs, retrieve.mjs, or the schema.
//
//   provider = {
//     name,
//     put(pathname, bytes, { contentType }) -> storageKey (opaque string),
//     get(storageKey)                       -> { body: Buffer, contentType, byteSize },
//     del(storageKey)                       -> void,
//     exists(storageKey)                    -> boolean   (optional)
//   }
//
// ── storage keys are OPAQUE and SECRET ──────────────────────────────────────
// A provider returns whatever handle it needs. The memory provider returns
// `memory://<path>`; Vercel Blob returns the blob's public URL, which is a
// BEARER CREDENTIAL — anyone holding it can read the object. That is exactly
// why storage_key is never returned to a caller: retrieve.mjs strips it and
// hands out short-lived signed URLs instead (signed-url.mjs).
//
// ── keys are content-addressed ──────────────────────────────────────────────
// The pathname embeds the sha256 of the bytes. Two consequences that matter:
//   * a put can never clobber DIFFERENT bytes at an existing key — the key is
//     derived from the content, so different content is a different key. This
//     is what makes "never overwrite" structural rather than a convention.
//   * a regeneration producing byte-identical output reuses the object for
//     free. It still gets its own document_versions row (the audit trail is
//     about generations, not bytes), which is why storage_key is deliberately
//     NOT unique in the schema.

import { createHash, timingSafeEqual } from "node:crypto";
/* THE SELECTION RULE LIVES IN THE BEAT LIBRARY (2026-10-20): the store names, the
   DOCUMENT_STORE_PROVIDER-or-memory rule and the unknown-name words, so the hourly beat
   upload-door judges the store this door would pick with the same rule (a beat may import only
   from src/pulse/beats/lib). One copy; providerFromEnv below uses it. */
import {
  STORE_NAMES, storeNameFromEnv, unknownStoreMessage
} from "../pulse/beats/lib/documents-upload-truth.mjs";

// ---------------------------------------------------------------------------
// bytes + keys
// ---------------------------------------------------------------------------

/** Normalize anything a generator might hand us into a Buffer. */
export function toBytes(body) {
  if (Buffer.isBuffer(body)) return body;
  if (body instanceof Uint8Array) return Buffer.from(body);
  if (body instanceof ArrayBuffer) return Buffer.from(new Uint8Array(body));
  if (typeof body === "string") return Buffer.from(body, "utf8");
  throw new Error("document body must be a Buffer, Uint8Array, ArrayBuffer, or string");
}

/** 'sha256:<hex>' — the algorithm prefix is required by the schema CHECK. */
export function checksumOf(body) {
  return `sha256:${createHash("sha256").update(toBytes(body)).digest("hex")}`;
}

const EXT_BY_MIME = Object.freeze({
  "application/pdf": ".pdf",
  "application/json": ".json",
  "application/zip": ".zip",
  "text/html": ".html",
  "text/plain": ".txt",
  "text/csv": ".csv",
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx"
});

export const extensionFor = (mimeType, filename = null) => {
  if (filename && /\.[a-z0-9]{1,8}$/i.test(filename)) {
    return filename.slice(filename.lastIndexOf(".")).toLowerCase();
  }
  return EXT_BY_MIME[String(mimeType || "").toLowerCase()] || "";
};

// Dots are stripped, not just slashes: a path SEGMENT of ".." is directory
// traversal, and these components come from ids that never legitimately contain
// one. The extension is appended separately, after sanitizing.
const safe = (s) => String(s ?? "").replace(/[^a-zA-Z0-9_-]/g, "-");

/**
 * The content-addressed object path. Org and client are in the path so the
 * bucket is browsable during an audit; the sha256 is what makes it immutable.
 */
export function buildStoragePath({ orgId, clientId, kind, checksum, mimeType, filename }) {
  const hex = String(checksum).includes(":") ? String(checksum).split(":")[1] : String(checksum);
  return [
    "documents",
    safe(orgId),
    safe(clientId),
    safe(kind),
    `${hex}${extensionFor(mimeType, filename)}`
  ].join("/");
}

// ---------------------------------------------------------------------------
// the store
// ---------------------------------------------------------------------------

/**
 * createStore({ provider }) — the interface register.mjs depends on.
 * Defaults to the in-memory provider so nothing (tests included) needs a
 * storage vendor configured to work.
 */
export function createStore({ provider = memoryProvider() } = {}) {
  if (!provider || typeof provider.put !== "function" || typeof provider.get !== "function") {
    throw new Error("createStore requires a provider with put/get/del");
  }

  return {
    name: provider.name,
    provider,

    /**
     * put — store bytes, return everything the registry needs to record them.
     * Idempotent by construction: identical bytes land on the identical key.
     */
    async put({ orgId, clientId, kind, body, mimeType, filename = null }) {
      if (!orgId || !clientId || !kind) throw new Error("put requires orgId, clientId, kind");
      if (!mimeType) throw new Error("put requires mimeType");
      const bytes = toBytes(body);
      if (bytes.byteLength === 0) throw new Error("refusing to store an empty document");

      const checksum = checksumOf(bytes);
      const pathname = buildStoragePath({ orgId, clientId, kind, checksum, mimeType, filename });
      const storageKey = await provider.put(pathname, bytes, { contentType: mimeType });

      return { storageKey, checksum, byteSize: bytes.byteLength, mimeType, pathname };
    },

    /** get — fetch bytes back. Verifies the checksum when one is supplied. */
    async get(storageKey, { expectedChecksum = null } = {}) {
      const out = await provider.get(storageKey);
      if (!out) return null;
      const bytes = toBytes(out.body);
      if (expectedChecksum) {
        const actual = checksumOf(bytes);
        const a = Buffer.from(actual);
        const b = Buffer.from(String(expectedChecksum));
        if (a.length !== b.length || !timingSafeEqual(a, b)) {
          throw new Error(
            `checksum mismatch for stored document — expected ${expectedChecksum}, got ${actual}`);
        }
      }
      return { body: bytes, byteSize: bytes.byteLength, contentType: out.contentType ?? null };
    },

    /**
     * del — REMOVES BYTES. Read this before calling it.
     *
     * Registered documents are NEVER deleted: the rule is supersede-with-a-new-
     * version, and both tables block DELETE at the database level. This method
     * exists for exactly one legitimate case — an ORPHANED OBJECT, where put()
     * succeeded but register() then failed, so bytes are in the bucket with no
     * row pointing at them.
     *
     * Deleting an object that a document_versions row still references breaks
     * the audit trail with no way to notice (the row survives, the bytes do
     * not). If you are reaching for this from a workflow, you want a new
     * version instead.
     */
    async del(storageKey) {
      return provider.del(storageKey);
    },

    async exists(storageKey) {
      if (typeof provider.exists === "function") return provider.exists(storageKey);
      const out = await provider.get(storageKey).catch(() => null);
      return Boolean(out);
    }
  };
}

// ---------------------------------------------------------------------------
// provider: memory (the default)
// ---------------------------------------------------------------------------

/**
 * In-memory provider. The DEFAULT, so unit tests and local runs never need a
 * storage vendor. Obviously not durable — do not select it in production.
 *
 * Every direct call gets its OWN fresh Map, on purpose: store.test.mjs and
 * register.test.mjs each build one to get an isolated store per test. The
 * process-wide sharing that a real caller needs (see storeFromEnv() below)
 * lives there, not here — this stays the plain, unsurprising constructor.
 */
export function memoryProvider({ objects = new Map() } = {}) {
  return {
    name: "memory",
    _objects: objects,
    async put(pathname, bytes, { contentType } = {}) {
      const key = `memory://${pathname}`;
      objects.set(key, { body: Buffer.from(bytes), contentType: contentType ?? null });
      return key;
    },
    async get(storageKey) {
      const hit = objects.get(storageKey);
      return hit ? { body: hit.body, contentType: hit.contentType } : null;
    },
    async del(storageKey) { objects.delete(storageKey); },
    async exists(storageKey) { return objects.has(storageKey); }
  };
}

// ---------------------------------------------------------------------------
// provider: Vercel Blob
// ---------------------------------------------------------------------------

// ⚠️ CONFIRM before cutover (same posture as the adapters in src/adapters/):
//   `@vercel/blob` is NOT a dependency of this repo — package.json is owned by
//   another session. The SDK is therefore imported LAZILY, and selecting this
//   provider without it installed fails with an actionable message rather than
//   breaking module load for everyone else. Whoever adds the dependency also
//   needs BLOB_READ_WRITE_TOKEN in the environment (see src/documents/README.md).
//
//   The three SDK call shapes below (put/head/del) match the @vercel/blob API
//   as used by underwrite-iq-lite, but they have not been exercised against the
//   live SDK from this repo. Verify with one real round-trip before this
//   provider carries production traffic.

const loadVercelBlobSdk = () => import("@vercel/blob");

// Wrapping happens HERE rather than inside the default loader, so every load
// failure produces the actionable message — including an injected loader's.
const sdkOrExplain = async (loadSdk) => {
  try {
    return await loadSdk();
  } catch (cause) {
    throw new Error(
      "the vercel-blob document store provider needs the @vercel/blob package, " +
      "which is not installed. Run `npm i @vercel/blob` and set BLOB_READ_WRITE_TOKEN, " +
      "or select a different provider (DOCUMENT_STORE_PROVIDER=memory).",
      { cause });
  }
};

/**
 * Vercel Blob provider.
 *
 * The storage key is the blob URL the SDK returns — treat it as a bearer
 * credential (see the header note). `addRandomSuffix: false` keeps the
 * content-addressed pathname intact so identical bytes stay on one object;
 * `allowOverwrite: true` is safe for the same reason — the only thing that can
 * ever be written to a given key is the identical content that produced it.
 */
export function vercelBlobProvider({
  token = process.env.BLOB_READ_WRITE_TOKEN,
  loadSdk = loadVercelBlobSdk,
  fetchImpl = null
} = {}) {
  const fetcher = () => fetchImpl || globalThis.fetch;

  return {
    name: "vercel-blob",

    async put(pathname, bytes, { contentType } = {}) {
      const { put } = await sdkOrExplain(loadSdk);
      const res = await put(pathname, bytes, {
        access: "public",
        contentType,
        addRandomSuffix: false,
        allowOverwrite: true,
        ...(token ? { token } : {})
      });
      const key = res?.url || res?.downloadUrl;
      if (!key) throw new Error("vercel blob put returned no url");
      return key;
    },

    async get(storageKey) {
      const f = fetcher();
      if (typeof f !== "function") throw new Error("no fetch available to read from vercel blob");
      const res = await f(storageKey);
      if (!res || res.status === 404) return null;
      if (!res.ok) throw new Error(`vercel blob read failed: ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      return { body: buf, contentType: res.headers?.get?.("content-type") ?? null };
    },

    async del(storageKey) {
      const { del } = await sdkOrExplain(loadSdk);
      await del(storageKey, token ? { token } : undefined);
    },

    async exists(storageKey) {
      const { head } = await sdkOrExplain(loadSdk);
      try {
        const meta = await head(storageKey, token ? { token } : undefined);
        return Boolean(meta);
      } catch {
        return false;
      }
    }
  };
}

// ---------------------------------------------------------------------------
// provider: Netlify Blobs — the storage decision for client uploads.
// ---------------------------------------------------------------------------
//
// Unlike Vercel Blob, a Netlify Blobs key is NOT a public URL — reading one
// back requires the SDK (and, outside a Netlify runtime, a siteID + token).
// That is a better fit for storage_key's own contract ("opaque and secret",
// see the file header) than a bearer-credential URL ever was; nothing in
// register.mjs or retrieve.mjs cares which shape a key takes.
//
// `@netlify/blobs` is loaded lazily for the same reason `@vercel/blob` is —
// package.json now DOES declare it (this is the provider the storage decision
// actually picked), but the lazy import keeps the failure mode identical and
// actionable if it is ever removed or the version drifts.
const loadNetlifyBlobsSdk = () => import("@netlify/blobs");

const netlifyBlobsSdkOrExplain = async (loadSdk) => {
  try {
    return await loadSdk();
  } catch (cause) {
    throw new Error(
      "the netlify-blobs document store provider needs the @netlify/blobs package, " +
      "which is not installed. Run `npm i @netlify/blobs`, or select a different " +
      "provider (DOCUMENT_STORE_PROVIDER=memory).",
      { cause });
  }
};

/**
 * netlifyBlobsProvider.
 *
 * Inside a deployed Netlify Function, `getStore(storeName)` resolves the site
 * and an internal token from the runtime automatically — no config needed.
 * Outside that runtime (a local script, a test, `netlify dev` without the
 * right context) it needs `siteID` + `token` explicitly, which is exactly
 * what NETLIFY_SITE_ID / NETLIFY_BLOBS_TOKEN are for below.
 */
export function netlifyBlobsProvider({
  storeName = process.env.NETLIFY_BLOBS_STORE || "documents",
  siteID = process.env.NETLIFY_SITE_ID,
  token = process.env.NETLIFY_BLOBS_TOKEN,
  loadSdk = loadNetlifyBlobsSdk
} = {}) {
  const openStore = async () => {
    const { getStore } = await netlifyBlobsSdkOrExplain(loadSdk);
    return siteID && token ? getStore({ name: storeName, siteID, token }) : getStore(storeName);
  };

  // The pathname IS the key — buildStoragePath() already makes it opaque and
  // content-addressed. Prefixed with the store name only so a storage_key
  // written by a DIFFERENT provider can never be silently misread by this one.
  const KEY_PREFIX = `netlify-blob://${storeName}/`;
  const toBlobKey = (storageKey) => {
    const s = String(storageKey);
    if (!s.startsWith(KEY_PREFIX)) {
      throw new Error(`storage key "${s}" was not written by the netlify-blobs provider`);
    }
    return s.slice(KEY_PREFIX.length);
  };

  return {
    name: "netlify-blobs",

    async put(pathname, bytes, { contentType } = {}) {
      const store = await openStore();
      await store.set(pathname, bytes, contentType ? { metadata: { contentType } } : undefined);
      return `${KEY_PREFIX}${pathname}`;
    },

    async get(storageKey) {
      const store = await openStore();
      const blobKey = toBlobKey(storageKey);
      const [buf, meta] = await Promise.all([
        store.get(blobKey, { type: "arrayBuffer" }),
        store.getMetadata(blobKey).catch(() => null)
      ]);
      if (buf == null) return null;
      return { body: Buffer.from(buf), contentType: meta?.metadata?.contentType ?? null };
    },

    async del(storageKey) {
      const store = await openStore();
      await store.delete(toBlobKey(storageKey));
    },

    async exists(storageKey) {
      const store = await openStore();
      const meta = await store.getMetadata(toBlobKey(storageKey)).catch(() => null);
      return Boolean(meta);
    }
  };
}

// ---------------------------------------------------------------------------
// selection
// ---------------------------------------------------------------------------

export const PROVIDERS = Object.freeze({
  [STORE_NAMES.MEMORY]: memoryProvider,
  [STORE_NAMES.VERCEL_BLOB]: vercelBlobProvider,
  [STORE_NAMES.NETLIFY_BLOBS]: netlifyBlobsProvider
});

/**
 * providerFromEnv — DOCUMENT_STORE_PROVIDER selects; memory is the default so
 * an unconfigured environment runs instead of exploding. Production must set
 * this explicitly; storeFromEnv() warns once if it has not.
 *
 * When the selection resolves to "memory" and the caller did not pass its own
 * `opts.objects`, this hands memoryProvider() ONE Map shared for the life of
 * the process (see storeMemoryObjects below) rather than a fresh one per
 * call. Every real caller — an upload handler storing bytes, the download
 * route reading them back a moment later — goes through storeFromEnv()
 * independently and expects to see what the other one wrote; a fresh Map
 * per call made that impossible; a document would register successfully and
 * its own just-minted signed link would 404. Tests that want an isolated
 * store still get one by constructing memoryProvider() directly (unaffected
 * by this) or by passing `{ objects: new Map() }` here.
 */
export function providerFromEnv(env = process.env, opts = {}) {
  const name = storeNameFromEnv(env);
  const factory = PROVIDERS[name];
  if (!factory) {
    throw new Error(unknownStoreMessage(name, Object.keys(PROVIDERS)));
  }
  if (name === "memory" && !opts.objects) {
    return factory({ ...opts, objects: storeMemoryObjects() });
  }
  return factory(opts);
}

// The process-wide memory store providerFromEnv() shares across calls.
// Lazily created so importing store.mjs never allocates it unused.
let _sharedMemoryObjects = null;
function storeMemoryObjects() {
  if (!_sharedMemoryObjects) _sharedMemoryObjects = new Map();
  return _sharedMemoryObjects;
}

let _warned = false;
export function storeFromEnv(env = process.env, opts = {}) {
  const store = createStore({ provider: providerFromEnv(env, opts) });
  if (store.name === "memory" && env.NODE_ENV === "production" && !_warned) {
    _warned = true;
    console.warn(
      "[documents] the in-memory store is selected in production — documents will " +
      "NOT survive a cold start. Set DOCUMENT_STORE_PROVIDER=vercel-blob.");
  }
  return store;
}
