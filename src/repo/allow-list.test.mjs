// The repo allow-list: only the spec's marketing folders, only in normal form.
// Spec docs/specs/marketing-machine-2026-10-04.md §6 Step 2 ("The allow-list").

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ALLOWED_DIRS, ALLOWED_FILES, assertAllowedRepoPath, isAllowedRepoPath, normalizeRepoPath, RepoPathError
} from "./allow-list.mjs";

test("allow-list: exactly the spec list plus the flywheel folder (design slice 1 additions)", () => {
  assert.deepEqual([...ALLOWED_DIRS].sort(), [
    "marketing/ads/ideas/",
    "marketing/ads/scripts/machine/",
    "marketing/ads/videos/",
    "marketing/brain/",
    "marketing/flywheel/",
    "ops/page-requests/"
  ]);
  assert.deepEqual([...ALLOWED_FILES].sort(), [
    "marketing/ads/RULES.md",
    "marketing/ads/VOICE.md",
    "marketing/ads/angles.json",
    "marketing/ads/banned-live.json",
    "marketing/ads/registry.json"
  ]);
  assert.equal(isAllowedRepoPath("marketing/flywheel/partner/04-copy.md"), true);
  assert.equal(isAllowedRepoPath("marketing/flywheel/capital-blueprint/00-OWNER-NOTES.md"), true);
  // The folder itself is not a file, and nothing beside it is allowed.
  assert.equal(isAllowedRepoPath("marketing/flywheel/"), false);
  assert.equal(isAllowedRepoPath("marketing/flywheel"), false);
  assert.equal(isAllowedRepoPath("marketing/flywheel-old/x.md"), false);
  assert.equal(isAllowedRepoPath("marketing/flywheel/../ads/x.md"), false);
});

test("allow-list: the spec's files and folders are allowed", () => {
  for (const p of [
    "marketing/ads/RULES.md",
    "marketing/ads/VOICE.md",
    "marketing/ads/banned-live.json",
    "marketing/ads/registry.json",
    "marketing/ads/angles.json",
    "marketing/ads/scripts/machine/2026-10-12/01-denial-angle.md",
    "marketing/ads/ideas/2026-10-05-idea.md",
    "marketing/ads/videos/91.md",
    "marketing/brain/Ad 91 notes.md",
    "ops/page-requests/roadmap-hero.md"
  ]) {
    assert.equal(isAllowedRepoPath(p), true, p);
    assert.equal(assertAllowedRepoPath(p), p);
  }
});

test("allow-list: refuses ../, absolute paths, encoded dots, backslashes", () => {
  const bad = [
    "../marketing/ads/RULES.md",
    "marketing/ads/../ads/RULES.md",
    "marketing/ads/scripts/machine/../../../netlify.toml",
    "marketing/ads/scripts/machine/..",
    "./marketing/ads/RULES.md",
    "marketing/./ads/RULES.md",
    "/marketing/ads/RULES.md",
    "/etc/passwd",
    "~/marketing/ads/RULES.md",
    "marketing/ads/scripts/machine/%2e%2e/%2e%2e/netlify.toml",
    "marketing/ads/scripts/machine/%2E%2E/x.md",
    "marketing%2fads%2fRULES.md",
    "marketing\\ads\\RULES.md",
    "marketing/ads/scripts/machine\\..\\..\\x.md",
    "marketing//ads/RULES.md",
    "marketing/ads/scripts/machine/",
    "marketing/ads/scripts/machine",
    "marketing/ads/ideas/.hidden.md",
    "marketing/ads/ideas/x.md\u0000.txt",
    "marketing/ads/ideas/x.md ",
    "C:/marketing/ads/RULES.md",
    ""
  ];
  for (const p of bad) {
    assert.equal(isAllowedRepoPath(p), false, JSON.stringify(p));
    assert.throws(() => assertAllowedRepoPath(p), RepoPathError, JSON.stringify(p));
  }
});

test("allow-list: refuses anything outside the spec list", () => {
  for (const p of [
    "netlify.toml",
    "CLAUDE.md",
    ".env",
    "credentials/github-pat.txt",
    "src/repo/outbox.mjs",
    "marketing/ads/NAMING.md",
    "marketing/ads/RECIPES.md",
    "marketing/ads/rules.md",
    "Marketing/ads/RULES.md",
    "marketing/ads/RULES.md.bak",
    "marketing/ads/scripts/2026-09-02-ad-scripts.md",
    "marketing/ads/scriptsmachine/x.md",
    "marketing/brainx/note.md",
    "ops/workflows/marketing-machine-2026-10.md",
    ".github/workflows/tests.yml",
    "docs/journeys/marketing-machine-intended.md"
  ]) {
    assert.equal(isAllowedRepoPath(p), false, p);
    assert.throws(() => assertAllowedRepoPath(p), RepoPathError, p);
  }
});

test("allow-list: non-text input is refused, never coerced", () => {
  for (const p of [null, undefined, 42, {}, ["marketing/ads/RULES.md"]]) {
    assert.equal(isAllowedRepoPath(p), false);
    assert.throws(() => normalizeRepoPath(p), RepoPathError);
  }
  assert.throws(() => normalizeRepoPath("marketing/ads/ideas/" + "a".repeat(400)), /longer than/);
});

test("allow-list: a refusal says why and carries the code", () => {
  try {
    assertAllowedRepoPath("marketing/ads/../../netlify.toml");
    assert.fail("should have thrown");
  } catch (err) {
    assert.equal(err.code, "repo_path_refused");
    assert.match(err.message, /"\.\." segment/);
  }
});
