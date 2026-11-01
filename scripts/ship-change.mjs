#!/usr/bin/env node

// Finish one change without pulling unrelated files into a public repository.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

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

async function archiveHead(rootGit, branch) {
  const tag = `archive/${branch}`;
  const ref = `refs/tags/${tag}`;
  const head = (await rootGit(['rev-parse', 'HEAD'])).trim();
  const old = (await rootGit(['ls-remote', '--tags', 'origin', ref])).split(/\s+/)[0];
  if (old === head) return;
  await rootGit(['tag', '-f', tag, head]);
  await rootGit(old
    ? ['push', `--force-with-lease=${ref}:${old}`, 'origin', ref]
    : ['push', 'origin', ref]);
  const verified = (await rootGit(['ls-remote', '--tags', 'origin', ref])).split(/\s+/)[0];
  if (verified !== head) throw new Error(`Could not verify remote archive tag ${tag}; branch was not pushed.`);
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
  const prs = JSON.parse(await rootGh(['pr', 'list', '--repo', REPO, '--state', 'open', '--limit', '200', '--json', 'number,headRefName,baseRefName,labels,isDraft,body']));
  const existing = prs.find(pr => pr.headRefName === branch);
  const existingLane = /^Owner lane:\s*([a-z][a-z0-9-]{1,40})\s*$/im.exec(existing?.body || '')?.[1]?.toLowerCase();
  if (existingLane && existingLane !== ownerLane) {
    throw new Error(`Existing PR #${existing.number} belongs to owner lane ${existingLane}, not ${ownerLane}.`);
  }
  const chain = orderedChain(prs);
  const currentMember = chain.find(pr => pr.number === existing?.number);
  const adoptingLegacy = Boolean(existing && !currentMember);
  if (adoptingLegacy && existing.baseRefName !== 'main') {
    throw new Error(`Existing PR #${existing.number} is already stacked on ${existing.baseRefName}; preserve that older chain before adopting it.`);
  }
  const choice = currentMember
    ? { parent: chain.find(pr => pr.position < currentMember.position && pr.headRefName === currentMember.baseRefName) || null,
        base: currentMember.baseRefName, position: currentMember.position }
    : chooseBase(prs);
  const { parent, base, position } = choice;

  if (!resume) {
    await rootGit(['add', '--', ...files]);
    assertOnlySelected(await rootGit(['diff', '--cached', '--name-only', '-z']), files);
    await rootGit(['diff', '--cached', '--check']);
    await rootGit(['commit', '-m', message, '--', ...files]);
  } else if (Number((await rootGit(['rev-list', '--count', 'origin/main..HEAD'])).trim()) < 1) {
    throw new Error('--resume needs a change commit ahead of origin/main.');
  }

  let parentHead = null;
  if (parent) {
    await rootGit(['fetch', 'origin', `refs/heads/${parent.headRefName}:refs/remotes/origin/${parent.headRefName}`]);
    const ancestor = await rootGit(['merge-base', 'HEAD', `origin/${parent.headRefName}`]);
    parentHead = (await rootGit(['rev-parse', `origin/${parent.headRefName}`])).trim();
    if (ancestor.trim() !== parentHead) {
      // A parent can be rebased while this branch waits. The ordinary merge
      // base then falls back to main and would replay the parent's old commits.
      const forkPoint = adoptingLegacy ? '' : await rootGit(['merge-base', '--fork-point',
        `origin/${parent.headRefName}`, 'HEAD']).catch(() => '');
      const basePoint = adoptingLegacy
        ? (await rootGit(['merge-base', 'HEAD', 'origin/main'])).trim()
        : forkPoint.trim() || ancestor.trim();
      if (!basePoint) throw new Error('Could not identify the branch base for ordered rebase.');
      if (!adoptingLegacy && !forkPoint.trim() && (resume || existing)) {
        throw new Error(`Could not identify the previous tip of ${parent.headRefName}; leave this branch open for a safe restack.`);
      }
      await rootGit(['rebase', '--onto', parentHead, basePoint, branch]);
    }
  } else {
    // Keep the bottom PR current before required checks and squash auto-merge.
    await rootGit(['rebase', 'origin/main']);
  }

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
  // Archive the exact new head before it can be pushed and later auto-deleted.
  await archiveHead(rootGit, branch);
  const remoteBranch = await rootGit(['ls-remote', '--heads', 'origin', branch]);
  await rootGit(remoteBranch.trim()
    ? ['push', '--force-with-lease', 'origin', `HEAD:refs/heads/${branch}`]
    : ['push', '-u', 'origin', `HEAD:refs/heads/${branch}`]);

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
