// @ts-check
// The repo read helpers, for the writer and the rules routes.
//
// The GitHub client itself lives in src/messaging/providers/github-repo.mjs,
// because outbound calls are only allowed from src/messaging/providers/* (spec
// docs/specs/marketing-machine-2026-10-04.md §4 trap 7). This file re-exports
// what readers need so they never import a provider module directly.
//
//   getContents(path, {ref, etag}) -> {content, sha, etag, notModified, missing}
//   getRef()                       -> {sha}   (pin a batch's rules at one commit)
//   repoToken(env)                 -> the token, or null when missing or masked
//
// When GitHub cannot be reached, readers fall back to the copies netlify.toml
// bundles with every function (included_files: RULES.md, VOICE.md, RECIPES.md,
// angles.json, banned-live.json, registry.json, marketing/broll/catalog.json).

export {
  getContents,
  listFolder,
  getRef,
  listCommits,
  repoToken,
  repoConfig,
  DEFAULT_REPO,
  DEFAULT_BRANCH
} from "../messaging/providers/github-repo.mjs";
