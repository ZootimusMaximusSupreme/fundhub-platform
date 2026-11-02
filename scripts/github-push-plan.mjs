export function planBranchPushes(branches, isMergedIntoMain) {
  const active = [];
  const merged = [];
  for (const branch of branches) {
    if (branch === "main") continue;
    (isMergedIntoMain(branch) ? merged : active).push(branch);
  }
  return { active, merged };
}

export function requireMainFastForward(isFastForward) {
  if (!isFastForward) {
    throw new Error("local main does not contain GitHub main — refusing to overwrite newer GitHub commits");
  }
}

export function publicationPushes(remote, branches, { mainOnly = false } = {}) {
  if (mainOnly) return [["push", "--no-follow-tags", remote, "refs/heads/main:refs/heads/main"]];
  return [["push", remote, "main"], ["push", remote, "--tags"], ...branches.map(branch => ["push", remote, branch])];
}
