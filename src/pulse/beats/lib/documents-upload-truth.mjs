// documents:upload-store — where does an upload land? Report only. Read only.
//
// ONE JUDGE, TWO CLOCKS (2026-10-20). The store setting half of this check used to live in
// src/pulse/coverage/gap-documents.mjs, and the rule that picks the store lived in
// src/documents/store.mjs providerFromEnv. Both moved here, unchanged:
//   - store.mjs picks its store with storeNameFromEnv() and words an unknown name with
//     unknownStoreMessage(), so the upload door and the pulse read ONE rule;
//   - gap-documents.mjs (the morning lane) and beat-upload-door.mjs (hourly) word a bad store with the
//     same rows (unknownStoreRow, notRealStoreRow).
//
// WHAT RUNS WHEN.
//   hourly   the store setting, from the live environment: uploads go to a store that keeps files
//            (netlify-blobs or vercel-blob). Unset means memory, and memory loses every upload at the
//            next cold start. A name the door does not know means no upload can be saved at all.
//   morning  the same setting, plus the READ-BACK: the newest saved file (SAMPLE_SQL) is asked for in
//            the file store. That read goes through the store's own package (@netlify/blobs) and the
//            site's internal token, which a beat may not load, so it stays in the morning lane.
//
// NOT JUDGED HOURLY, ON PURPOSE: the newest file's record (size above zero, the record matching its
// version). Those cannot go red through today's door: an empty file is refused before it is stored
// (src/documents/upload-validate.mjs), the size is counted from the bytes written (createStore put), and
// the record and its version are written in one transaction (src/documents/register.mjs). A check that
// can only pass is not a tripwire. A record with no version a client can open is documents:cannot-open.
//
// Pure: no I/O. The caller hands in the environment (ctx.env hourly, the lane's env in the morning).

import { check, clip, fix } from "./documents-truth.mjs";

export const ID_STORE = "documents:upload-store";

/** The store names the upload door knows. src/documents/store.mjs keys PROVIDERS with these. */
export const STORE_NAMES = Object.freeze({
  MEMORY: "memory",
  VERCEL_BLOB: "vercel-blob",
  NETLIFY_BLOBS: "netlify-blobs"
});

/** The store an unconfigured environment gets. It keeps files in memory only. */
export const DEFAULT_STORE = STORE_NAMES.MEMORY;

/** The store names that keep files after a cold start. "memory" does not. */
export const REAL_STORES = Object.freeze([STORE_NAMES.NETLIFY_BLOBS, STORE_NAMES.VERCEL_BLOB]);

/** The newest saved file the morning read-back asks the store about. */
export const SAMPLE_SQL = `
SELECT d.id::text AS document_id, v.storage_key
  FROM documents d
  JOIN document_versions v ON v.id = d.current_version_id AND v.document_id = d.id
 WHERE d.org_id = $1::uuid
   AND d.is_demo IS NOT TRUE
   AND nullif(btrim(v.storage_key), '') IS NOT NULL
 ORDER BY v.created_at DESC
 LIMIT $2::int`;

/** DOCUMENT_STORE_PROVIDER selects; memory is the default. The upload door's own rule (providerFromEnv). */
export function storeNameFromEnv(env) {
  return env.DOCUMENT_STORE_PROVIDER || DEFAULT_STORE;
}

/** The error the upload door throws for a store name it does not know. */
export function unknownStoreMessage(name, knownNames) {
  return `unknown DOCUMENT_STORE_PROVIDER "${name}" — expected one of ${knownNames.join(", ")}`;
}

/** The row for a store setting the door does not know. `reason` is the door's own error, clipped. */
export function unknownStoreRow(reason) {
  return check(
    ID_STORE,
    "FAIL",
    `the document store setting is not one the upload door knows: ${reason}`,
    fix("Set DOCUMENT_STORE_PROVIDER to netlify-blobs. Uploads cannot be saved without it.")
  );
}

/** The row for a store that does not keep files, or null when the store is a real one. */
export function notRealStoreRow(name) {
  if (REAL_STORES.includes(name)) return null;
  return check(
    ID_STORE,
    "FAIL",
    `uploads are going to the ${name} store. It keeps files in memory only, so every upload is lost at the next cold start.`,
    fix("Set DOCUMENT_STORE_PROVIDER to netlify-blobs on the live site.")
  );
}

/**
 * The hourly verdict: the store the upload door would pick from this environment. Same rule, same words
 * as the morning lane; the read-back of the newest file is the morning's alone, and the green line says so.
 */
export function judgeUploadStore(env) {
  const name = storeNameFromEnv(env || {});
  const known = Object.values(STORE_NAMES);
  if (!known.includes(name)) return unknownStoreRow(clip(unknownStoreMessage(name, known)));
  return notRealStoreRow(name) || check(
    ID_STORE,
    "PASS",
    `uploads go to the ${name} store. The newest saved file is read back from the store each morning, not hourly. No file was uploaded.`
  );
}
