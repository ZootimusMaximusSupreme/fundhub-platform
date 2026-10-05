// Read-only Google Drive API client.
// Scope is drive.readonly — this module never writes, deletes, or moves.

import fs from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { DRIVE_API_BASE } from "./config.mjs";
import { fetchAccessToken, fetchOAuthAccessToken } from "./auth.mjs";

const FILE_FIELDS = "id,name,mimeType,parents,modifiedTime,md5Checksum,size,webViewLink,trashed";

const DRIVE_SCOPES = new Set([
  "https://www.googleapis.com/auth/drive",
  "https://www.googleapis.com/auth/drive.readonly"
]);

/** True when Google's granted-scope list can read Drive, or when Google did not say. */
function grantsDrive(scope) {
  if (!scope) return true;
  return String(scope).split(/\s+/).some((s) => DRIVE_SCOPES.has(s));
}

/**
 * Create a Drive client bound to personal OAuth or a service account + delegate.
 * Token is refreshed lazily and cached until near expiry.
 *
 * `oauthCandidates` ([{ credentials, tokenSource }], from driveConfigFromEnv) are
 * tried in order: a token Google refuses, or one with no Drive scope, is passed
 * over for the next. Nothing stored is changed — the refused key stays set.
 */
export function createDriveClient({
  serviceAccount,
  delegateEmail,
  oauthCredentials = null,
  oauthCandidates = null,
  fetchImpl = globalThis.fetch,
  apiBase = DRIVE_API_BASE
} = {}) {
  const candidates = (oauthCandidates || []).filter((c) => c?.credentials?.refreshToken);
  if (!candidates.length && oauthCredentials?.refreshToken) {
    candidates.push({ credentials: oauthCredentials, tokenSource: null });
  }
  const useOAuth = candidates.length > 0;
  if (!useOAuth && (!serviceAccount?.clientEmail || !serviceAccount?.privateKey)) {
    throw new Error("createDriveClient requires serviceAccount or oauthCredentials");
  }

  let cached = null; // { accessToken, expiresAtMs }
  let activeIndex = 0; // first candidate still worth trying
  let activeSource = null;
  const refused = []; // [{ source, reason }] — reasons are Google error codes, never secrets

  async function oauthAccessToken() {
    let firstError = null;
    let noScope = null; // a token that refreshed but has no Drive scope
    for (let i = activeIndex; i < candidates.length; i += 1) {
      const cand = candidates[i];
      const source = cand.tokenSource || `oauth token ${i + 1}`;
      let tok;
      try {
        tok = await fetchOAuthAccessToken({ ...cand.credentials, fetchImpl });
      } catch (err) {
        firstError = firstError || err;
        refused.push({ source, reason: String(err?.message || err).slice(0, 200) });
        continue;
      }
      if (!grantsDrive(tok.scope)) {
        refused.push({ source, reason: "no Drive scope" });
        noScope = noScope || { tok, i };
        continue;
      }
      if (refused.length) {
        console.warn(
          `[drive] passed over ${refused.map((r) => `${r.source} (${r.reason})`).join("; ")} — using ${source}`
        );
      }
      activeIndex = i;
      activeSource = cand.tokenSource || null;
      return tok;
    }
    // No token reads Drive. Use one that at least refreshed, as before this fallback.
    if (noScope) {
      activeIndex = noScope.i;
      activeSource = candidates[noScope.i].tokenSource || null;
      return noScope.tok;
    }
    if (candidates.length - activeIndex === 1 && firstError) throw firstError;
    throw new Error(
      `oauth token refresh failed for every Google token: ${refused.map((r) => `${r.source}: ${r.reason}`).join("; ")}`
    );
  }

  async function accessToken() {
    const now = Date.now();
    if (cached && cached.expiresAtMs > now + 60_000) return cached.accessToken;
    const tok = useOAuth
      ? await oauthAccessToken()
      : await fetchAccessToken({
        clientEmail: serviceAccount.clientEmail,
        privateKey: serviceAccount.privateKey,
        delegateEmail,
        fetchImpl
      });
    cached = {
      accessToken: tok.accessToken,
      expiresAtMs: now + (tok.expiresIn * 1000)
    };
    return cached.accessToken;
  }

  async function driveFetch(path, { query, accept } = {}) {
    const token = await accessToken();
    const url = new URL(path.startsWith("http") ? path : `${apiBase}${path}`);
    if (query) {
      for (const [k, v] of Object.entries(query)) {
        if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
      }
    }
    const headers = { authorization: `Bearer ${token}` };
    if (accept) headers.accept = accept;
    const res = await fetchImpl(url.toString(), { method: "GET", headers });
    return res;
  }

  /**
   * List non-trashed files. Yields pages; does not recurse folders itself —
   * Drive files.list already returns all files the account can see when
   * corpora=user (default). H-2: no folder filter.
   */
  async function* listAllFiles({ pageSize = 1000, q = "trashed = false", orderBy } = {}) {
    let pageToken = null;
    do {
      const res = await driveFetch("/files", {
        query: {
          pageSize,
          pageToken: pageToken || undefined,
          q,
          orderBy: orderBy || undefined,
          fields: `nextPageToken,files(${FILE_FIELDS})`,
          supportsAllDrives: "true",
          includeItemsFromAllDrives: "true"
        }
      });
      const text = await res.text();
      let json;
      try {
        json = JSON.parse(text);
      } catch {
        throw new Error(`files.list non-json (${res.status})`);
      }
      if (!res.ok) {
        throw new Error(`files.list failed (${res.status}): ${json.error?.message || text.slice(0, 200)}`);
      }
      for (const f of json.files || []) yield f;
      pageToken = json.nextPageToken || null;
    } while (pageToken);
  }

  async function getFile(fileId) {
    const res = await driveFetch(`/files/${encodeURIComponent(fileId)}`, {
      query: { fields: FILE_FIELDS, supportsAllDrives: "true" }
    });
    const text = await res.text();
    const json = JSON.parse(text);
    if (!res.ok) {
      throw new Error(`files.get failed (${res.status}): ${json.error?.message || text.slice(0, 200)}`);
    }
    return json;
  }

  /** Download binary/media content (alt=media). Small files only — large video use downloadMediaToFile. */
  async function downloadMedia(fileId) {
    const res = await driveFetch(`/files/${encodeURIComponent(fileId)}`, {
      query: { alt: "media", supportsAllDrives: "true" }
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`files.get media failed (${res.status}): ${text.slice(0, 200)}`);
    }
    const buf = Buffer.from(await res.arrayBuffer());
    return buf;
  }

  /** Stream Drive media to disk (avoids Node's ~2GB Buffer cap on long course videos). */
  async function downloadMediaToFile(fileId, destPath) {
    const res = await driveFetch(`/files/${encodeURIComponent(fileId)}`, {
      query: { alt: "media", supportsAllDrives: "true" }
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`files.get media failed (${res.status}): ${text.slice(0, 200)}`);
    }
    if (!res.body) {
      throw new Error("files.get media failed: empty body");
    }
    fs.mkdirSync(path.dirname(destPath), { recursive: true });
    const nodeStream = Readable.fromWeb(res.body);
    await pipeline(nodeStream, fs.createWriteStream(destPath));
  }

  /** Export a Google Docs/Sheets/Slides file to a mime type. */
  async function exportFile(fileId, exportMime) {
    const res = await driveFetch(`/files/${encodeURIComponent(fileId)}/export`, {
      query: { mimeType: exportMime }
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`files.export failed (${res.status}): ${text.slice(0, 200)}`);
    }
    return Buffer.from(await res.arrayBuffer());
  }

  async function getStartPageToken() {
    const res = await driveFetch("/changes/startPageToken", {
      query: { supportsAllDrives: "true" }
    });
    const text = await res.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      throw new Error(`changes.startPageToken non-json (${res.status})`);
    }
    if (!res.ok || !json.startPageToken) {
      throw new Error(
        `changes.startPageToken failed (${res.status}): ${json.error?.message || text.slice(0, 200)}`
      );
    }
    return String(json.startPageToken);
  }

  /**
   * One page of changes.list. Caller loops on nextPageToken until null,
   * then persists newStartPageToken.
   */
  async function listChangesPage(pageToken, { pageSize = 1000 } = {}) {
    if (!pageToken) throw new Error("listChangesPage requires pageToken");
    const res = await driveFetch("/changes", {
      query: {
        pageToken: String(pageToken),
        pageSize,
        includeRemoved: "true",
        supportsAllDrives: "true",
        includeItemsFromAllDrives: "true",
        fields: `nextPageToken,newStartPageToken,changes(fileId,removed,file(${FILE_FIELDS}))`
      }
    });
    const text = await res.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      throw new Error(`changes.list non-json (${res.status})`);
    }
    if (res.status === 410) {
      const err = new Error(`changes.list token expired (410): ${json.error?.message || text.slice(0, 200)}`);
      err.code = "PAGE_TOKEN_EXPIRED";
      err.status = 410;
      throw err;
    }
    if (!res.ok) {
      throw new Error(`changes.list failed (${res.status}): ${json.error?.message || text.slice(0, 200)}`);
    }
    const changes = (json.changes || []).map((ch) => ({
      fileId: ch.fileId || ch.file?.id || null,
      removed: !!ch.removed || !!ch.file?.trashed,
      file: ch.file || null
    }));
    return {
      changes,
      nextPageToken: json.nextPageToken || null,
      newStartPageToken: json.newStartPageToken || null
    };
  }

  /** Drain all change pages from pageToken; returns { changes, newStartPageToken }. */
  async function listAllChanges(pageToken, opts = {}) {
    const all = [];
    let token = pageToken;
    let newStartPageToken = null;
    while (token) {
      const page = await listChangesPage(token, opts);
      all.push(...page.changes);
      if (page.nextPageToken) token = page.nextPageToken;
      else {
        newStartPageToken = page.newStartPageToken;
        token = null;
      }
    }
    return { changes: all, newStartPageToken };
  }

  return {
    listAllFiles,
    getFile,
    downloadMedia,
    downloadMediaToFile,
    exportFile,
    getStartPageToken,
    listChangesPage,
    listAllChanges,
    /** Env key of the OAuth token in use (null before the first call or for a service account). */
    tokenSource() { return activeSource; },
    /** Tokens passed over so far: [{ source, reason }]. */
    refusedTokens() { return refused.map((r) => ({ ...r })); },
    /** test helper */
    _clearTokenCache() { cached = null; }
  };
}

/** Build a Drive client from driveConfigFromEnv output. */
export function createDriveClientFromConfig(config, { fetchImpl = globalThis.fetch } = {}) {
  if (config?.authMode === "oauth") {
    return createDriveClient({
      oauthCredentials: config.oauthCredentials,
      oauthCandidates: config.oauthCandidates || null,
      fetchImpl
    });
  }
  return createDriveClient({
    serviceAccount: config.serviceAccount,
    delegateEmail: config.delegateEmail,
    fetchImpl
  });
}

/**
 * Read-only live check: get a Drive token and read the changes start token.
 * Writes nothing — not to Drive, not to the database.
 */
export async function checkDriveAccess(config, { fetchImpl = globalThis.fetch } = {}) {
  if (!config?.ready) {
    return { ok: false, token_source: null, refused: [], error: "not_configured" };
  }
  const client = createDriveClientFromConfig(config, { fetchImpl });
  try {
    await client.getStartPageToken();
    return { ok: true, token_source: client.tokenSource(), refused: client.refusedTokens(), error: null };
  } catch (err) {
    return {
      ok: false,
      token_source: client.tokenSource(),
      refused: client.refusedTokens(),
      error: String(err?.message || err).slice(0, 300)
    };
  }
}
