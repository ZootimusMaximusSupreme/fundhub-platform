#!/usr/bin/env node

// Finish one change without pulling unrelated files into a public repository.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { recordedParentHead } from './restack-after-merge.mjs';

const execFileAsync = promisify(execFile);
const REPO = 'ZootimusMaximusSupreme/fundhub-platform';
const ORDER_LABEL = /^ship-order\/(\d+)$/;

export function parseArgs(argv) {
  const args = [...argv];
  let message = '';
  let ownerLane = '';
  let resume = false;
  const files = [];
  while (args.length) {
    const arg = args.shift();
    if (arg === '--message' || arg === '-m') {
      message = args.shift() || '';
    } else if (arg === '--owner-lane') {
      ownerLane = args.shift() || '';
    } else if (arg === '--resume') {
      resume = true;
    } else if (arg === '--') {
      files.push(...args);
      break;
    } else {
      throw new Error(`Unknown option ${arg}. Use --message "..." -- file1 file2`);
    }
  }
  if (!message.trim()) throw new Error('A commit message is required: --message "..."');
  if (!/^[a-z][a-z0-9-]{1,40}$/.test(ownerLane)) {
    throw new Error('A valid owner lane is required: --owner-lane <team-name> (2-41 lowercase letters, digits, or hyphens).');
  }
  if (!resume && !files.length) throw new Error('List the exact files to commit after --.');
  if (resume && files.length) throw new Error('--resume uses the existing commit; do not list files.');
  for (const file of files) {
    if (!file || file.startsWith('-') || file.startsWith('/') || file.split('/').includes('..')) {
      throw new Error(`Unsafe file path: ${file}`);
    }
    if (/(^|\/)\.env(?:\.|$)|(^|\/)credentials(?:\/|$)|(^|\/)\.aws(?:\/|$)/i.test(file)) {
      throw new Error(`Secret path cannot be committed: ${file}`);
    }
  }
  if (new Set(files).size !== files.length) throw new Error('Each file may be listed only once.');
  return { message: message.trim(), ownerLane, files, resume };
}

export function orderedChain(prs) {
  const members = prs.flatMap(pr => {
    const positions = (pr.labels || []).map(label => {
      const name = typeof label === 'string' ? label : label.name;
      return ORDER_LABEL.exec(name || '')?.[1];
    }).filter(Boolean);
    if (positions.length > 1) throw new Error(`PR #${pr.number} has multiple ship-order labels.`);
    return positions.length ? [{ ...pr, position: Number(positions[0]) }] : [];
  }).sort((a, b) => a.position - b.position);
  const seen = new Set();
  for (const pr of members) {
    if (!Number.isSafeInteger(pr.position) || pr.position < 1 || seen.has(pr.position)) {
      throw new Error(`Invalid or repeated ship-order position on PR #${pr.number}.`);
    }
    seen.add(pr.position);
  }
  for (let i = 1; i < members.length; i++) {
    if (members[i].baseRefName !== members[i - 1].headRefName) {
      throw new Error(`Ordered chain is not linear at PR #${members[i].number}. Resolve its base first.`);
    }
  }
  if (members[0] && members[0].baseRefName !== 'main') {
    throw new Error(`Bottom ordered PR #${members[0].number} must target main.`);
  }
  return members;
}

export function chooseBase(prs) {
  const chain = orderedChain(prs);
  const parent = chain.at(-1) || null;
  return { parent, base: parent?.headRefName || 'main', position: (parent?.position || 0) + 1 };
}

function parseStatusPaths(porcelain) {
  return porcelain.split('\0').filter(Boolean).map(entry => {
    const code = entry.slice(0, 2);
    if (code.includes('R') || code.includes('C')) {
      throw new Error('Renamed or copied files need a separate reviewed commit before ship-change.');
    }
    if (entry.length < 4 || entry[2] !== ' ') throw new Error('Could not read Git status safely.');
    return entry.slice(3);
  });
}

function normalizePath(file) {
  return file.replace(/^\.\//, '');
}

function assertOnlySelected(staged, files) {
  const selected = new Set(files.map(normalizePath));
  const extras = staged.split('\0').filter(Boolean).filter(file => !selected.has(file));
  if (extras.length) throw new Error(`Unrelated files are staged: ${extras.join(', ')}. Unstage them before shipping.`);
}

async function archiveHead(rootGit, branch, expectedHead = null, assertFresh = async () => {}) {
  const tag = `archive/${branch}`;
  const ref = `refs/tags/${tag}`;
  const head = expectedHead || (await rootGit(['rev-parse', 'HEAD'])).trim();
  const old = (await rootGit(['ls-remote', '--tags', 'origin', ref])).split(/\s+/)[0];
  if (old === head) return;
  if (old) {
    const historyRef = `refs/tags/${tag}-${old.slice(0, 8)}`;
    const history = (await rootGit(['ls-remote', '--tags', 'origin', historyRef])).split(/\s+/)[0];
    if (history && history !== old) throw new Error(`Archive history differs for ${branch}.`);
    if (!history) {
      await assertFresh();
      await rootGit(['tag', '-f', `${tag}-${old.slice(0, 8)}`, old]);
      await assertFresh();
      await rootGit(['push', 'origin', `${old}:${historyRef}`]);
      const preserved = (await rootGit(['ls-remote', '--tags', 'origin', historyRef])).split(/\s+/)[0];
      if (preserved !== old) throw new Error(`Could not preserve original archive for ${branch}.`);
    }
  }
  await assertFresh();
  await rootGit(['tag', '-f', tag, head]);
  await assertFresh();
  await rootGit(old
    ? ['push', `--force-with-lease=${ref}:${old}`, 'origin', `${head}:${ref}`]
    : ['push', 'origin', `${head}:${ref}`]);
  const verified = (await rootGit(['ls-remote', '--tags', 'origin', ref])).split(/\s+/)[0];
  if (verified !== head) throw new Error(`Could not verify remote archive tag ${tag}; branch was not pushed.`);
}

// Programmatic operator proof only: PR-body text never enables this path.
export function sourceDeltaManifest(raw) {
  const parts = String(raw).split('\0');
  const manifest = [];
  for (let i = 0; i < parts.length && parts[i]; i += 2) {
    const match = /^:(\d{6}) (\d{6}) ([a-f0-9]{40}) ([a-f0-9]{40}) ([AMDT])$/.exec(parts[i]);
    const name = parts[i + 1];
    if (!match || !name || name.startsWith('/') || name.split('/').includes('..') || /[\0\r\n]/.test(name)) {
      throw new Error('Invalid source-boundary path/blob manifest.');
    }
    manifest.push({ path: name, beforeMode: match[1], afterMode: match[2], beforeBlob: match[3], afterBlob: match[4] });
  }
  return manifest.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
}

function canonicalSourceManifest(manifest) {
  if (!Array.isArray(manifest) || !manifest.length) throw new Error('A complete approved source manifest is required.');
  const rows = manifest.map(row => {
    if (!row || typeof row.path !== 'string' || !row.path || row.path.startsWith('/') ||
      row.path.split('/').includes('..') || /[\0\r\n]/.test(row.path) ||
      !/^\d{6}$/.test(row.beforeMode) || !/^\d{6}$/.test(row.afterMode) ||
      !/^[a-f0-9]{40}$/.test(row.beforeBlob) || !/^[a-f0-9]{40}$/.test(row.afterBlob)) {
      throw new Error('Invalid approved source manifest.');
    }
    return [row.path, row.beforeMode, row.afterMode, row.beforeBlob, row.afterBlob];
  }).sort((a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0);
  if (new Set(rows.map(row => row[0])).size !== rows.length) throw new Error('Duplicate approved source path.');
  return JSON.stringify(rows);
}

export function sourceManifestDigest(manifest) {
  return createHash('sha256').update(canonicalSourceManifest(manifest)).digest('hex');
}

async function verifiedSourceBoundary(proof, approval, { existing, rootGit, rootGh }) {
  if (!proof || proof.version !== 1 || !Number.isSafeInteger(proof.ownerPr) || proof.ownerPr < 1 ||
    proof.ownerPr === existing.number || !/^[a-f0-9]{40}$/.test(proof.head || '') ||
    !/^[a-f0-9]{40}$/.test(proof.base || '') || !/^[a-f0-9]{40}$/.test(proof.ownerArchiveHead || '') ||
    !/^[a-f0-9]{64}$/.test(approval || '')) throw new Error('Invalid reviewed source-boundary proof.');
  if (typeof proof.ownerBranch !== 'string') throw new Error('A source owner branch is required.');
  await rootGit(['check-ref-format', '--branch', proof.ownerBranch]);
  const archive = `refs/tags/archive/${proof.ownerBranch}`;
  if (![archive, `${archive}-${proof.ownerArchiveHead.slice(0, 8)}`].includes(proof.ownerArchiveRef)) {
    throw new Error('Source-owner archive does not belong to the declared branch.');
  }
  if ((await rootGit(['rev-parse', 'HEAD'])).trim() !== proof.head ||
    (await rootGit(['status', '--porcelain'])).trim()) throw new Error('Reviewed source head changed or is dirty.');
  if (/^Stack parent head:/im.test(existing.body || '') && recordedParentHead(existing) !== proof.base) {
    throw new Error('PR source-parent marker does not match its reviewed boundary.');
  }
  await rootGit(['merge-base', '--is-ancestor', proof.base, proof.head]);
  const actual = sourceDeltaManifest(await rootGit(['diff', '--raw', '--no-abbrev', '--no-renames',
    '--no-ext-diff', '--no-textconv', '-z', proof.base, proof.head, '--']));
  if (canonicalSourceManifest(actual) !== canonicalSourceManifest(proof.manifest) ||
    sourceManifestDigest(actual) !== approval) throw new Error('Reviewed source path/blob manifest does not match the complete delta.');
  const remoteHead = (await rootGit(['rev-parse', `refs/remotes/origin/${existing.headRefName}`])).trim();
  if (!/^[a-f0-9]{40}$/.test(remoteHead)) throw new Error('Original remote source child is missing.');
  await rootGit(['merge-base', '--is-ancestor', remoteHead, proof.head]);
  const childArchive = (await rootGit(['ls-remote', '--tags', 'origin',
    `refs/tags/archive/${existing.headRefName}`])).split(/\s+/)[0];
  if (childArchive !== remoteHead) throw new Error('Original source child archive is missing or changed.');
  const owner = JSON.parse(await rootGh(['api', `repos/${REPO}/pulls/${proof.ownerPr}`]));
  if (owner.head?.ref !== proof.ownerBranch || owner.head?.repo?.full_name !== REPO) {
    throw new Error('The archived source owner does not match its GitHub PR.');
  }
  const published = (await rootGit(['ls-remote', '--tags', 'origin', proof.ownerArchiveRef])).split(/\s+/)[0];
  if (published !== proof.ownerArchiveHead) throw new Error('Reviewed source-owner archive is missing or changed.');
  await rootGit(['fetch', '--no-tags', 'origin', proof.ownerArchiveRef]);
  if ((await rootGit(['rev-parse', 'FETCH_HEAD^{commit}'])).trim() !== proof.ownerArchiveHead) {
    throw new Error('Fetched source-owner archive does not match its receipt.');
  }
  await rootGit(['merge-base', '--is-ancestor', proof.base, proof.ownerArchiveHead]);
  if ((await rootGit(['rev-parse', 'HEAD'])).trim() !== proof.head ||
    (await rootGit(['status', '--porcelain'])).trim()) throw new Error('Reviewed source changed during provenance verification.');
  return { base: proof.base, remoteHead, head: proof.head };
}

export async function runShipChange(options, command = defaultCommand) {
  const { message, ownerLane, files, resume = false } = options;
  if (!/^[a-z][a-z0-9-]{1,40}$/.test(ownerLane || '')) {
    throw new Error('A valid --owner-lane <team-name> is required.');
  }
  const git = (args, opts) => command('git', args, opts);
  const gh = (args, opts) => command('gh', args, opts);

  const branch = (await git(['symbolic-ref', '--short', 'HEAD'])).trim();
  if (!branch || branch === 'main' || branch === 'master') {
    throw new Error('Ship a named change branch, never main or a detached HEAD.');
  }
  const root = (await git(['rev-parse', '--show-toplevel'])).trim();
  const scoped = (program, args) => command(program, args, { cwd: root });
  const rootGit = args => scoped('git', args);
  const rootGh = args => scoped('gh', args);
  let immutableSourceHead = (await rootGit(['rev-parse', 'HEAD'])).trim();

  const remote = (await rootGit(['remote', 'get-url', 'origin'])).trim();
  if (!/(?:github\.com[:/])ZootimusMaximusSupreme\/fundhub-platform(?:\.git)?$/i.test(remote)) {
    throw new Error(`origin is not ${REPO}.`);
  }
  const status = await rootGit(['status', '--porcelain=v1', '-z', '--untracked-files=all']);
  const changed = new Set(parseStatusPaths(status));
  if (resume && changed.size) throw new Error('--resume needs a clean working tree.');
  if (!resume) {
    for (const file of files) {
      if (!changed.has(normalizePath(file))) throw new Error(`No changed file at ${file}.`);
    }
  }
  const selected = new Set(files.map(normalizePath));
  const otherTracked = (await rootGit(['diff', '--name-only', '-z'])).split('\0').filter(Boolean)
    .filter(file => !selected.has(file));
  if (otherTracked.length) {
    throw new Error(`Other tracked files are dirty: ${otherTracked.join(', ')}. Finish or park them before shipping.`);
  }
  const preStaged = await rootGit(['diff', '--cached', '--name-only', '-z']);
  assertOnlySelected(preStaged, files);

  await rootGit(['fetch', '--prune', 'origin']);
  // Freeze the remote source before any local rewrite. A background fetch must
  // never silently change which other writer's head a force-with-lease accepts.
  const observedRemoteHead = (await rootGit(['ls-remote', '--heads', 'origin', `refs/heads/${branch}`])).split(/\s+/)[0];
  const fetchedRemoteHead = (await rootGit(['rev-parse', `refs/remotes/origin/${branch}`]).catch(() => '')).trim();
  if ((observedRemoteHead && !/^[a-f0-9]{40}$/i.test(observedRemoteHead)) || observedRemoteHead !== fetchedRemoteHead) {
    throw new Error('Remote source changed while fetching; no source rewrite or archive was made.');
  }
  const prs = JSON.parse(await rootGh(['pr', 'list', '--repo', REPO, '--state', 'open', '--limit', '200', '--json', 'number,headRefName,baseRefName,labels,isDraft,body']));
  const existing = prs.find(pr => pr.headRefName === branch);
  const existingLane = /^Owner lane:\s*([a-z][a-z0-9-]{1,40})\s*$/im.exec(existing?.body || '')?.[1]?.toLowerCase();
  if (existingLane && existingLane !== ownerLane) {
    throw new Error(`Existing PR #${existing.number} belongs to owner lane ${existingLane}, not ${ownerLane}.`);
  }
  const chain = orderedChain(prs);
  const currentMember = chain.find(pr => pr.number === existing?.number);
  const adoptingLegacy = Boolean(existing && !currentMember);
  let reviewedSourceBase = null;
  let reviewedSourceRemote = null;
  if (options.sourceBoundaryProof || options.approvedSourceManifest) {
    if (!resume || !adoptingLegacy) throw new Error('Reviewed source boundaries apply only to clean legacy adoption.');
    const reviewed = await verifiedSourceBoundary(options.sourceBoundaryProof, options.approvedSourceManifest,
      { existing, rootGit, rootGh });
    reviewedSourceBase = reviewed.base;
    reviewedSourceRemote = reviewed.remoteHead;
    if (immutableSourceHead !== reviewed.head) throw new Error('Reviewed source did not match the starting source head.');

  }
  if (adoptingLegacy && existing.baseRefName !== 'main') {
    throw new Error(`Existing PR #${existing.number} is already stacked on ${existing.baseRefName}; preserve that older chain before adopting it.`);
  }
  const choice = currentMember
    ? { parent: chain.find(pr => pr.position < currentMember.position && pr.headRefName === currentMember.baseRefName) || null,
        base: currentMember.baseRefName, position: currentMember.position }
    : chooseBase(prs);
  const { parent, base, position } = choice;
  if (reviewedSourceBase && !parent) {
    throw new Error('Reviewed source-boundary adoption requires an existing ordered target parent.');
  }

  if ((await rootGit(['rev-parse', 'HEAD'])).trim() !== immutableSourceHead) {
    throw new Error('Local source head changed while loading the queue; no source rewrite or archive was made.');
  }
  if (!resume) {
    await rootGit(['add', '--', ...files]);
    assertOnlySelected(await rootGit(['diff', '--cached', '--name-only', '-z']), files);
    await rootGit(['diff', '--cached', '--check']);
    await rootGit(['commit', '-m', message, '--', ...files]);
    immutableSourceHead = (await rootGit(['rev-parse', 'HEAD'])).trim();
  } else if (Number((await rootGit(['rev-list', '--count', 'origin/main..HEAD'])).trim()) < 1) {
    throw new Error('--resume needs a change commit ahead of origin/main.');
  }

  let parentHead = null;
  let fallbackRemoteHead = reviewedSourceRemote;
  let preparedCandidateHead = null;
  let exactTarget = null;
  async function assertState(head, expectedBranch = branch) {
    const current = (await rootGit(['rev-parse', 'HEAD'])).trim();
    const currentBranch = (await rootGit(['symbolic-ref', '--quiet', '--short', 'HEAD']).catch(() => '')).trim();
    const dirty = (await rootGit(['status', '--porcelain'])).trim();
    if (current !== head || currentBranch !== expectedBranch || dirty) {
      throw new Error('Local source or candidate changed; all new local work was preserved and publication stopped.');
    }
  }
  async function exactReplay(basePoint, targetHead, targetBranch) {
    await assertState(immutableSourceHead);
    fallbackRemoteHead = (await rootGit(['rev-parse', `refs/remotes/origin/${branch}`])).trim();
    if (!/^[a-f0-9]{40}$/i.test(fallbackRemoteHead)) throw new Error('Original remote child head is missing.');
    if (fallbackRemoteHead !== observedRemoteHead) throw new Error('Remote source tracking changed before delta preparation; branch was not pushed.');
    await rootGit(['merge-base', '--is-ancestor', basePoint, immutableSourceHead]);
    await rootGit(['merge-base', '--is-ancestor', fallbackRemoteHead, immutableSourceHead]);
    const archived = (await rootGit(['ls-remote', '--tags', 'origin', `refs/tags/archive/${branch}`])).split(/\s+/)[0];
    if (archived === immutableSourceHead && archived !== fallbackRemoteHead) {
      // A prior attempt can have archived H before candidate preparation failed.
      // Accept that retry only with the exact original R still independently archived.
      const historyRef = `refs/tags/archive/${branch}-${fallbackRemoteHead.slice(0, 8)}`;
      const history = (await rootGit(['ls-remote', '--tags', 'origin', historyRef])).split(/\s+/)[0];
      if (history !== fallbackRemoteHead) throw new Error('Original remote child archive history is missing or changed; branch was not pushed.');
    } else if (archived !== fallbackRemoteHead) {
      throw new Error('Original remote child archive is missing; branch was not pushed.');
    }
    await scoped('npm', ['run', 'preflight', '--', '--expected-base', basePoint]);
    const sourcePr = JSON.parse(await rootGh(['pr', 'view', String(existing.number), '--repo', REPO, '--json', 'headRefOid,baseRefName']));
    const sourceTarget = (await rootGit(['ls-remote', '--heads', 'origin', targetBranch])).split(/\s+/)[0];
    await assertState(immutableSourceHead);
    if (sourcePr.headRefOid !== fallbackRemoteHead || sourcePr.baseRefName !== existing.baseRefName || sourceTarget !== targetHead) {
      throw new Error('Source or target moved during preflight; archive and branch were not pushed.');
    }
    await archiveHead(rootGit, branch, immutableSourceHead, () => assertState(immutableSourceHead));
    await assertState(immutableSourceHead);
    const helperUrl = new URL('./restack-after-merge.mjs', import.meta.url).href;
    const candidate = (await scoped(process.execPath, ['--input-type=module', '-e',
      'const {createArchivedSourceDelta}=await import(process.argv[2]); const c=createArchivedSourceDelta(JSON.parse(process.argv[1])); if(!c)process.exitCode=1;else process.stdout.write(c);',
      JSON.stringify({ base: basePoint, head: immutableSourceHead, branch, number: existing.number, target: targetHead, sourceBranch: branch }), helperUrl])).trim();
    if (!/^[a-f0-9]{40}$/i.test(candidate)) throw new Error('No verified archived-delta candidate was produced.');
    await assertState(immutableSourceHead);
    // Checkout does not force/reset/clean; another writer's files must survive.
    await rootGit(['switch', '--detach', candidate]);
    await assertState(candidate, '');
    await rootGit(['update-ref', `refs/heads/${branch}`, candidate, immutableSourceHead]);
    await assertState(candidate, '');
    await rootGit(['switch', branch]);
    await assertState(candidate);
    preparedCandidateHead = candidate;
    exactTarget = { branch: targetBranch, head: targetHead };
  }
  if (parent) {
    await rootGit(['fetch', 'origin', `refs/heads/${parent.headRefName}:refs/remotes/origin/${parent.headRefName}`]);
    const ancestor = await rootGit(['merge-base', 'HEAD', `origin/${parent.headRefName}`]);
    parentHead = (await rootGit(['rev-parse', `origin/${parent.headRefName}`])).trim();
    await assertState(immutableSourceHead);
    if (ancestor.trim() !== parentHead) {
      const forkPoint = adoptingLegacy ? '' : await rootGit(['merge-base', '--fork-point',
        `origin/${parent.headRefName}`, 'HEAD']).catch(() => '');
      const recorded = !adoptingLegacy ? recordedParentHead(existing || {}) : null;
      if (recorded) await rootGit(['merge-base', '--is-ancestor', recorded, immutableSourceHead]);
      const basePoint = adoptingLegacy
        ? reviewedSourceBase || (await rootGit(['merge-base', immutableSourceHead, 'origin/main'])).trim()
        : recorded || forkPoint.trim() || ancestor.trim();
      if (!basePoint) throw new Error('Could not identify the branch base for ordered rebase.');
      if (!adoptingLegacy && !forkPoint.trim() && !recorded && (resume || existing)) {
        throw new Error(`Could not identify the previous tip of ${parent.headRefName}; leave this branch open for a safe restack.`);
      }
      if (adoptingLegacy || recorded) {
        await exactReplay(basePoint, parentHead, parent.headRefName);
      } else {
        await rootGit(['rebase', '--onto', parentHead, basePoint, branch]);
      }
    } else if (adoptingLegacy || reviewedSourceBase) {
      await exactReplay(reviewedSourceBase || parentHead, parentHead, parent.headRefName);
    }
  } else {
    if (adoptingLegacy) {
      const mainHead = (await rootGit(['rev-parse', 'origin/main'])).trim();
      const basePoint = (await rootGit(['merge-base', immutableSourceHead, mainHead])).trim();
      await exactReplay(basePoint, mainHead, 'main');
    } else {
      await rootGit(['rebase', 'origin/main']);
    }
  }
  if (preparedCandidateHead) await assertState(preparedCandidateHead);

  // The repository rule requires preflight before opening or updating a PR.
  await scoped('npm', parent
    ? ['run', 'preflight', '--', '--expected-base', `origin/${parent.headRefName}`]
    : ['run', 'preflight']);
  // Another agent may have opened the next PR while preflight was running.
  // Stop before pushing a duplicate chain position; resume against its head.
  if (!existing) {
    const latestPrs = JSON.parse(await rootGh(['pr', 'list', '--repo', REPO, '--state', 'open',
      '--limit', '200', '--json', 'number,headRefName,baseRefName,labels,isDraft,body']));
    const latest = chooseBase(latestPrs);
    if (latest.base !== base || latest.position !== position) {
      throw new Error(`Ordered queue advanced to ${latest.base} at position ${latest.position}; rerun --resume before pushing.`);
    }
  }
  if (parent) {
    const remoteParent = (await rootGit(['ls-remote', '--heads', 'origin', parent.headRefName])).split(/\s+/)[0];
    if (remoteParent !== parentHead) {
      throw new Error(`Stack parent ${parent.headRefName} advanced during shipping. Rerun with --resume after fetching it.`);
    }
  }
  if (fallbackRemoteHead) {
    const current = JSON.parse(await rootGh(['pr', 'view', String(existing.number), '--repo', REPO, '--json', 'headRefOid,baseRefName']));
    if (current.headRefOid !== fallbackRemoteHead || current.baseRefName !== existing.baseRefName) {
      throw new Error('Child PR moved during delta preparation; branch was not pushed.');
    }
  }
  if (preparedCandidateHead) {
    await assertState(preparedCandidateHead);
    const currentTarget = (await rootGit(['ls-remote', '--heads', 'origin', exactTarget.branch])).split(/\s+/)[0];
    if (currentTarget !== exactTarget.head) throw new Error('Exact-delta target changed; branch was not pushed.');
  }
  // Archive the exact new head before it can be pushed and later auto-deleted.
  await archiveHead(rootGit, branch, preparedCandidateHead, preparedCandidateHead ? () => assertState(preparedCandidateHead) : undefined);
  if (preparedCandidateHead) await assertState(preparedCandidateHead);
  if (preparedCandidateHead) await assertState(preparedCandidateHead);
  const publishedSource = preparedCandidateHead || 'HEAD';
  await rootGit(fallbackRemoteHead
    ? ['push', `--force-with-lease=refs/heads/${branch}:${fallbackRemoteHead}`, 'origin', `${publishedSource}:refs/heads/${branch}`]
    : observedRemoteHead
    ? ['push', `--force-with-lease=refs/heads/${branch}:${observedRemoteHead}`, 'origin', `${publishedSource}:refs/heads/${branch}`]
    : ['push', '-u', `--force-with-lease=refs/heads/${branch}:`, 'origin', `${publishedSource}:refs/heads/${branch}`]);

  let pr = existing;
  if (!pr) {
    const body = `Ordered change ${position}.\nBase: ${base}.\nOwner lane: ${ownerLane}`
      + (parentHead ? `\nStack parent head: ${parentHead}` : '');
    const url = (await rootGh(['pr', 'create', '--repo', REPO, '--base', base, '--head', branch, '--title', message, '--body', body])).trim();
    pr = JSON.parse(await rootGh(['pr', 'view', url, '--repo', REPO, '--json', 'number,headRefName,baseRefName,labels']));
  } else {
    let body = (existing.body || '').trim();
    if (!existingLane) body = `${body}\n\nOwner lane: ${ownerLane}`.trim();
    if (parentHead) {
      const marker = `Stack parent head: ${parentHead}`;
      body = /^Stack parent head: .*$/m.test(body)
        ? body.replace(/^Stack parent head: .*$/m, marker)
        : `${body}\n\n${marker}`.trim();
    }
    if (body !== (existing.body || '').trim()) {
      await rootGh(['pr', 'edit', String(pr.number), '--repo', REPO, '--body', body]);
    }
    if (existing.baseRefName !== base) {
      await rootGh(['pr', 'edit', String(pr.number), '--repo', REPO, '--base', base]);
    }
  }
  const label = `ship-order/${position}`;
  await rootGh(['label', 'create', label, '--repo', REPO, '--color', '5319E7', '--description', 'Position in the ordered shipping chain', '--force']);
  await rootGh(['pr', 'edit', String(pr.number), '--repo', REPO, '--add-label', label]);
  if (base === 'main') {
    await rootGh(['pr', 'merge', String(pr.number), '--repo', REPO, '--auto', '--squash']);
  }
  return { number: pr.number, branch, base, position, queued: base === 'main' };
}

export async function defaultCommand(program, args, options = {}) {
  const { stdout } = await execFileAsync(program, args, { ...options, maxBuffer: 8 * 1024 * 1024 });
  return stdout;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  runShipChange(parseArgs(process.argv.slice(2)))
    .then(result => console.log(`PR #${result.number} is ${result.queued ? 'waiting for required checks and squash auto-merge' : `stacked at position ${result.position} on ${result.base}`}.`))
    .catch(error => { console.error(error.message); process.exitCode = 1; });
}
