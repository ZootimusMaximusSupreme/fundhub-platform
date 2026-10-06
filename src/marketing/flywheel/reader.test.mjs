// The flywheel reader: GitHub pinned to one commit, pending saves on top, the
// bundle only as the fallback, and every answer names its source. Unit X3,
// design docs/specs/command-center-design-2026-10-05.md §3.2 (GET marketing/flywheel).
// No network: every GitHub call is a stand-in passed through deps.

import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFlywheel, overlayPending, pendingCampaigns, readRepoFile, clearReaderCache, CAMPAIGN_FILES } from "./reader.mjs";

const SHA = "a".repeat(40);

function fakeGitHub(tree) {
  const calls = [];
  return {
    calls,
    getRef: async () => { calls.push("ref"); return { ok: true, sha: SHA }; },
    listFolder: async (p, o) => {
      calls.push(`list ${p}@${o.ref}`);
      return { ok: true, entries: Object.keys(tree).map((name) => ({ name, type: "dir", path: `${p}/${name}` })) };
    },
    getContents: async (p, o) => {
      calls.push(`read ${p}@${o.ref}`);
      const m = /^marketing\/flywheel\/([^/]+)\/(.+)$/.exec(p);
      const text = m && tree[m[1]] ? tree[m[1]][m[2]] : undefined;
      return text == null ? { ok: true, missing: true, content: null } : { ok: true, content: text, etag: `"e-${p}"` };
    }
  };
}

beforeEach(() => clearReaderCache());

describe("readFlywheel", () => {
  test("GitHub: every read pinned to one commit; the source is github", async () => {
    const gh = fakeGitHub({ partner: { "03-offer.md": "OFFER", "00-OWNER-NOTES.md": "NOTES" }, "capital-blueprint": {} });
    const out = await readFlywheel({ campaign: "partner", env: {}, deps: { ...gh, pendingRows: async () => [] } });
    assert.equal(out.source, "github");
    assert.equal(out.commit_sha, SHA);
    assert.deepEqual(out.campaigns, ["capital-blueprint", "partner"]);
    assert.equal(out.files["03-offer.md"].text, "OFFER");
    assert.equal(out.files["03-offer.md"].source, "github");
    assert.equal(out.files["04-copy.md"].text, null);
    assert.equal(out.files["04-copy.md"].source, "missing");
    assert.ok(gh.calls.filter((c) => c.startsWith("read ")).every((c) => c.endsWith(`@${SHA}`)), "pinned to the commit");
    assert.equal(gh.calls.filter((c) => c.startsWith("read ")).length, CAMPAIGN_FILES.length);
  });

  test("pending saves lay on top: a replace is the new file, an edit re-applies; committed rows are already in git", async () => {
    const gh = fakeGitHub({ partner: { "00-OWNER-NOTES.md": "# n\n\n## Notes\n\nold line\n", "04-copy.md": "---\nstatus: draft\n---\n\nbody\n" } });
    const rows = [
      { id: 1, path: "marketing/flywheel/partner/04-copy.md", mode: "edit", edit: { op: "set_front_matter_key", key: "status", value: "approved" }, committed_sha: null },
      { id: 2, path: "marketing/flywheel/partner/00-OWNER-NOTES.md", mode: "edit", edit: { op: "append_line_under_heading", heading: "## Notes", line: "new line" }, committed_sha: "b".repeat(40) },
      { id: 3, path: "marketing/flywheel/partner/06-spend.md", mode: "replace", content: "SPEND", committed_sha: null },
      { id: 4, path: "marketing/flywheel/capital-blueprint/00-OWNER-NOTES.md", mode: "replace", content: "NEW", committed_sha: null }
    ];
    const out = await readFlywheel({ campaign: "partner", env: {}, deps: { ...gh, pendingRows: async () => rows } });
    assert.equal(out.files["04-copy.md"].text, "---\nstatus: approved\n---\n\nbody\n");
    assert.equal(out.files["04-copy.md"].source, "outbox-pending");
    assert.equal(out.files["06-spend.md"].text, "SPEND");
    assert.equal(out.files["00-OWNER-NOTES.md"].text, "# n\n\n## Notes\n\nold line\n", "a committed row is not laid on GitHub's copy again");
    assert.deepEqual(out.campaigns, ["capital-blueprint", "partner"], "a campaign only in the outbox is listed");
  });

  test("no token: the bundle is read, every save is laid on (committed too), and the answer says why", async () => {
    const rows = [{ id: 9, path: "marketing/flywheel/partner/06-spend.md", mode: "replace", content: "SAVED", committed_sha: "c".repeat(40) }];
    const out = await readFlywheel({ campaign: "partner", env: {}, deps: { pendingRows: async () => rows } });
    assert.equal(out.source, "bundle-fallback");
    assert.match(out.fallback_reason, /GITHUB_REPO_TOKEN is not set/);
    assert.ok(out.campaigns.includes("partner"));
    assert.equal(out.files["03-offer.md"].source, "bundle-fallback");
    assert.match(out.files["03-offer.md"].text, /^---\nstage: 3/);
    assert.equal(out.files["06-spend.md"].text, "SAVED");
  });

  test("a masked token is no token", async () => {
    const out = await readFlywheel({ campaign: null, env: { GITHUB_REPO_TOKEN: "****abcd" }, deps: { pendingRows: async () => [] } });
    assert.equal(out.source, "bundle-fallback");
  });

  test("GitHub failing falls back to the bundle with the reason, never a made-up file", async () => {
    const out = await readFlywheel({ campaign: "partner", env: {}, deps: {
      getRef: async () => ({ ok: false, error: "401 Bad credentials" }), pendingRows: async () => []
    } });
    assert.equal(out.source, "bundle-fallback");
    assert.match(out.fallback_reason, /401 Bad credentials/);
    assert.equal(out.commit_sha, null);
  });

  test("a 304 uses the copy read before", async () => {
    let n = 0;
    const gh = fakeGitHub({ partner: { "03-offer.md": "OFFER" } });
    const deps = { ...gh, pendingRows: async () => [], getContents: async (p, o) => {
      n++;
      if (o.etag && p.endsWith("03-offer.md")) return { ok: true, notModified: true, etag: o.etag };
      return gh.getContents(p, o);
    } };
    await readFlywheel({ campaign: "partner", env: {}, deps });
    const again = await readFlywheel({ campaign: "partner", env: {}, deps });
    assert.equal(again.files["03-offer.md"].text, "OFFER");
    assert.ok(n >= CAMPAIGN_FILES.length * 2);
  });
});

test("overlayPending ignores rows for other campaigns and bad edits", () => {
  const files = { "04-copy.md": { text: "no stamp", source: "github" } };
  const out = overlayPending(files, [
    { path: "marketing/flywheel/other/04-copy.md", mode: "replace", content: "X", committed_sha: null },
    { path: "marketing/flywheel/partner/04-copy.md", mode: "edit", edit: { op: "set_front_matter_key", key: "status", value: "approved" }, committed_sha: null }
  ], "partner");
  assert.deepEqual(out["04-copy.md"], { text: "no stamp", source: "github" });
  assert.deepEqual(pendingCampaigns([{ path: "marketing/flywheel/a-b/x.md", committed_sha: null }, { path: "marketing/ads/x.md" }]), ["a-b"]);
});

test("readRepoFile: GitHub first, else the copy beside the code, else missing", async () => {
  const gh = await readRepoFile("ops/x.md", { env: {}, deps: { getContents: async () => ({ ok: true, content: "GH" }) } });
  assert.deepEqual(gh, { text: "GH", source: "github" });
  const local = await readRepoFile("marketing/flywheel/README.md", { env: {} });
  assert.equal(local.source, "bundle");
  assert.match(local.text, /# The marketing flywheel/);
  const none = await readRepoFile("ops/workflows/ads-revenue-model-2026-08-24.md", { env: {} });
  assert.deepEqual(none, { text: null, source: "missing" });
});
