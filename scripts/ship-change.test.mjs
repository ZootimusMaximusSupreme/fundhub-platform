import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { chooseBase, orderedChain, parseArgs, runShipChange, sourceDeltaManifest, sourceManifestDigest } from './ship-change.mjs';

const member = (number, headRefName, baseRefName, position) => ({
  number, headRefName, baseRefName, isDraft: false,
  labels: [{ name: `ship-order/${position}` }],
});

test('requires an explicit commit message and exact safe file paths', () => {
  assert.deepEqual(parseArgs(['-m', 'Finish release', '--owner-lane', 'sales-team', '--', 'scripts/a.mjs']), {
    message: 'Finish release', ownerLane: 'sales-team', files: ['scripts/a.mjs'], resume: false,
  });
  assert.throws(() => parseArgs(['-m', 'x', '--', 'a']), /owner lane/);
  assert.throws(() => parseArgs(['-m', 'x', '--owner-lane', 'A', '--', 'a']), /owner lane/);
  assert.throws(() => parseArgs(['-m', 'x', '--owner-lane', 'sales']), /exact files/);
  assert.throws(() => parseArgs(['-m', 'x', '--owner-lane', 'sales', '--', '.env']), /Secret path/);
  assert.throws(() => parseArgs(['-m', 'x', '--owner-lane', 'sales', '--', 'credentials/token']), /Secret path/);
  assert.throws(() => parseArgs(['-m', 'x', '--owner-lane', 'sales', '--', '../outside']), /Unsafe file path/);
  assert.throws(() => parseArgs(['-m', 'x', '--owner-lane', 'sales', '--', 'a', 'a']), /only once/);
  assert.deepEqual(parseArgs(['-m', 'x', '--owner-lane', 'sales', '--resume']), {
    message: 'x', ownerLane: 'sales', files: [], resume: true,
  });
  assert.throws(() => parseArgs(['-m', 'x', '--owner-lane', 'sales', '--resume', '--', 'a']), /do not list files/);
});

test('builds a linear chain and ignores unrelated legacy PRs', () => {
  const prs = [member(9, 'change-two', 'change-one', 2),
    { number: 7, headRefName: 'legacy', baseRefName: 'main', labels: [] },
    member(8, 'change-one', 'main', 1)];
  assert.deepEqual(orderedChain(prs).map(pr => pr.number), [8, 9]);
  assert.deepEqual(chooseBase(prs), { parent: orderedChain(prs)[1], base: 'change-two', position: 3 });
  assert.throws(() => orderedChain([member(8, 'one', 'main', 1), member(9, 'two', 'main', 2)]), /not linear/);
  assert.throws(() => orderedChain([member(8, 'one', 'main', 1), member(9, 'two', 'one', 1)]), /repeated/);
});

function fakeCommands(prs) {
  const calls = [];
  async function command(program, args) {
    calls.push([program, ...args]);
    if (program === 'git') {
      if (args[0] === 'symbolic-ref') return 'codex/new-change\n';
      if (args[0] === 'rev-parse' && args[1] === '--show-toplevel') return '/repo\n';
      if (args[0] === 'rev-parse' && args[1] === 'refs/remotes/origin/codex/new-change') return `${'a'.repeat(40)}\n`;
      if (args[0] === 'rev-parse' && args[1]?.startsWith('origin/')) return 'parent-head\n';
      if (args[0] === 'rev-parse' && args[1] === 'HEAD') return `${'a'.repeat(40)}\n`;
      if (args[0] === 'remote') return 'https://github.com/ZootimusMaximusSupreme/fundhub-platform.git\n';
      if (args[0] === 'status') return calls.some(c => c[0] === 'git' && c[1] === 'commit') ? '' : ' M scripts/new.mjs\0';
      if (args[0] === 'diff' && args[1] === '--cached' && args[2] === '--name-only') {
        return calls.some(call => call[0] === 'git' && call[1] === 'add') ? 'scripts/new.mjs\0' : '';
      }
      if (args[0] === 'merge-base') return 'parent-head\n';
      if (args[0] === 'ls-remote' && args[1] === '--heads' && args[3] === 'refs/heads/codex/new-change') return `${'a'.repeat(40)}\t${args[3]}\n`;
      if (args[0] === 'ls-remote' && args[1] === '--heads') return `parent-head\trefs/heads/${args[3]}\n`;
      if (args[0] === 'ls-remote' && args[1] === '--tags') {
        return calls.some(call => call[0] === 'git' && call[1] === 'push' &&
          call.at(-1)?.endsWith(':refs/tags/archive/codex/new-change'))
          ? `${'a'.repeat(40)}\trefs/tags/archive/codex/new-change\n` : '';
      }
      return '';
    }
    if (program === 'gh') {
      if (args[0] === 'pr' && args[1] === 'list') return JSON.stringify(prs);
      if (args[0] === 'pr' && args[1] === 'create') return 'https://github.com/ZootimusMaximusSupreme/fundhub-platform/pull/42\n';
      if (args[0] === 'pr' && args[1] === 'view') return JSON.stringify({ number: 42, headRefName: 'codex/new-change' });
      return '';
    }
    return '';
  }
  return { command, calls };
}

test('root change runs preflight, opens a PR, and enables queue auto-merge', async () => {
  const { command, calls } = fakeCommands([]);
  const result = await runShipChange({ message: 'New change', ownerLane: 'sales', files: ['scripts/new.mjs'] }, command);
  assert.equal(result.queued, true);
  assert.equal(result.base, 'main');
  assert(calls.some(call => call.join(' ').includes('pr create --repo ZootimusMaximusSupreme/fundhub-platform --base main')));
  assert(calls.some(call => call[0] === 'gh' && call[1] === 'pr' && call[2] === 'create' && call.at(-1).includes('Owner lane: sales')));
  assert(calls.some(call => call.join(' ').includes('pr merge 42 --repo ZootimusMaximusSupreme/fundhub-platform --auto --squash')));
  assert(calls.some(call => call.join(' ') === 'npm run preflight'));
  const tagPush = calls.findIndex(call => call[0] === 'git' && call[1] === 'push' &&
    call.at(-1)?.endsWith(':refs/tags/archive/codex/new-change'));
  const branchPush = calls.findIndex(call => call[0] === 'git' && call[1] === 'push' &&
    call.at(-1) === 'HEAD:refs/heads/codex/new-change');
  assert.ok(tagPush >= 0 && tagPush < branchPush);
});

test('child change targets the preceding PR and does not merge into it', async () => {
  const { command, calls } = fakeCommands([member(41, 'codex/previous-change', 'main', 1)]);
  const result = await runShipChange({ message: 'Next change', ownerLane: 'sales', files: ['scripts/new.mjs'] }, command);
  assert.equal(result.queued, false);
  assert.equal(result.base, 'codex/previous-change');
  assert.equal(result.position, 2);
  assert(calls.some(call => call.join(' ').includes('pr create --repo ZootimusMaximusSupreme/fundhub-platform --base codex/previous-change')));
  assert(calls.some(call => call[0] === 'gh' && call[1] === 'pr' && call[2] === 'create' &&
    call.at(-1).includes('Stack parent head: parent-head')));
  assert(calls.some(call => call.join(' ').includes('pr edit 42 --repo ZootimusMaximusSupreme/fundhub-platform --add-label ship-order/2')));
  assert(calls.some(call => call.join(' ') === 'npm run preflight -- --expected-base origin/codex/previous-change'));
  assert(!calls.some(call => call[0] === 'gh' && call[1] === 'pr' && call[2] === 'merge'));
});

test('resume refreshes the recorded parent tip without changing the release manifest', async () => {
  const existing = { ...member(42, 'codex/new-change', 'codex/previous-change', 2),
    body: `Owner lane: sales\n\nRelease manifest stays.\n\nStack parent head: ${'c'.repeat(40)}` };
  const { command, calls } = fakeCommands([member(41, 'codex/previous-change', 'main', 1), existing]);
  const resumed = async (program, args, options) => {
    if (program === 'git' && args[0] === 'status') return '';
    if (program === 'git' && args[0] === 'rev-list') return '1\n';
    return command(program, args, options);
  };
  await runShipChange({ message: 'Next change', ownerLane: 'sales', files: [], resume: true }, resumed);
  const edit = calls.find(call => call[0] === 'gh' && call[1] === 'pr' && call[2] === 'edit' && call.includes('--body'));
  assert.ok(edit);
  assert.ok(edit.at(-1).includes('Release manifest stays.'));
  assert.ok(edit.at(-1).includes('Stack parent head: parent-head'));
  assert.equal((edit.at(-1).match(/Stack parent head:/g) || []).length, 1);
});

test('does not take a legacy PR out of its existing older stack', async () => {
  const legacy = { number: 42, headRefName: 'codex/new-change', baseRefName: 'older-branch',
    isDraft: false, labels: [], body: 'Owner lane: sales' };
  const { command, calls } = fakeCommands([legacy]);
  await assert.rejects(runShipChange({ message: 'Backlog change', ownerLane: 'sales',
    files: ['scripts/new.mjs'] }, command), /preserve that older chain/);
  assert.equal(calls.some(call => call[0] === 'git' && call[1] === 'commit'), false);
});

test('a parent branch that moves during preflight stops before child push or PR creation', async () => {
  const { command, calls } = fakeCommands([member(41, 'codex/previous-change', 'main', 1)]);
  const moved = async (program, args, options) => {
    if (program === 'git' && args[0] === 'ls-remote' && args[1] === '--heads' && args[3] !== 'refs/heads/codex/new-change') {
      return `new-parent-head\trefs/heads/${args[3]}\n`;
    }
    return command(program, args, options);
  };
  await assert.rejects(runShipChange({ message: 'Next change', ownerLane: 'sales', files: ['scripts/new.mjs'] }, moved), /Stack parent .* advanced/);
  assert(!calls.some(call => call[0] === 'git' && call[1] === 'push'));
  assert(!calls.some(call => call[0] === 'gh' && call[1] === 'pr' && call[2] === 'create'));
});

test('another PR claiming the next position during preflight stops before push', async () => {
  const first = member(41, 'codex/previous-change', 'main', 1);
  const { command, calls } = fakeCommands([first]);
  let lists = 0;
  const raced = async (program, args, options) => {
    if (program === 'gh' && args[0] === 'pr' && args[1] === 'list' && ++lists === 2) {
      return JSON.stringify([first, member(42, 'codex/other-change', 'codex/previous-change', 2)]);
    }
    return command(program, args, options);
  };
  await assert.rejects(runShipChange({ message: 'Next change', ownerLane: 'sales',
    files: ['scripts/new.mjs'] }, raced), /Ordered queue advanced/);
  assert(!calls.some(call => call[0] === 'git' && call[1] === 'push'));
  assert(!calls.some(call => call[0] === 'gh' && call[1] === 'pr' && call[2] === 'create'));
});

test('resume rebases only child commits when a stacked parent was rewritten', async () => {
  const { command, calls } = fakeCommands([member(41, 'codex/previous-change', 'main', 1)]);
  const moved = async (program, args, options) => {
    if (program === 'git' && args[0] === 'status') return '';
    if (program === 'git' && args[0] === 'rev-list') return '1\n';
    if (program === 'git' && args[0] === 'merge-base') {
      return args[1] === '--fork-point' ? 'old-parent-head\n' : 'main-base\n';
    }
    if (program === 'git' && args[0] === 'rev-parse' && args[1]?.startsWith('origin/')) {
      return 'new-parent-head\n';
    }
    if (program === 'git' && args[0] === 'ls-remote' && args[1] === '--heads' && args[3] !== 'refs/heads/codex/new-change') {
      return `new-parent-head\trefs/heads/${args[3]}\n`;
    }
    return command(program, args, options);
  };
  await runShipChange({ message: 'Next change', ownerLane: 'sales', files: [], resume: true }, moved);
  assert(calls.some(call => call[0] === 'git' && call[1] === 'rebase' &&
    call[2] === '--onto' && call[3] === 'new-parent-head' && call[4] === 'old-parent-head'));
  assert(!calls.some(call => call[0] === 'git' && call[1] === 'rebase' && call[4] === 'main-base'));
});

test('resume stops safely when a rewritten parent has no known fork point', async () => {
  const { command, calls } = fakeCommands([member(41, 'codex/previous-change', 'main', 1)]);
  const moved = async (program, args, options) => {
    if (program === 'git' && args[0] === 'status') return '';
    if (program === 'git' && args[0] === 'rev-list') return '1\n';
    if (program === 'git' && args[0] === 'merge-base') {
      if (args[1] === '--fork-point') throw new Error('no reflog');
      return 'main-base\n';
    }
    if (program === 'git' && args[0] === 'rev-parse' && args[1]?.startsWith('origin/')) {
      return 'new-parent-head\n';
    }
    return command(program, args, options);
  };
  await assert.rejects(runShipChange({ message: 'Next change', ownerLane: 'sales', files: [], resume: true }, moved),
    /Could not identify the previous tip/);
  assert(!calls.some(call => call[0] === 'git' && call[1] === 'rebase'));
  assert(!calls.some(call => call[0] === 'git' && call[1] === 'push'));
});

test('an unverified archive tag stops before branch push', async () => {
  const { command, calls } = fakeCommands([]);
  const staleTag = async (program, args, options) => {
    if (program === 'git' && args[0] === 'ls-remote' && args[1] === '--tags') {
      return `${'f'.repeat(40)}\trefs/tags/archive/codex/new-change\n`;
    }
    return command(program, args, options);
  };
  await assert.rejects(runShipChange({ message: 'New change', ownerLane: 'sales', files: ['scripts/new.mjs'] }, staleTag), /Could not verify remote archive tag/);
  assert(!calls.some(call => call[0] === 'git' && call[1] === 'push' &&
    call.at(-1) === 'HEAD:refs/heads/codex/new-change'));
});

test('refuses unselected staged files before committing or pushing', async () => {
  const { command, calls } = fakeCommands([]);
  const bad = async (program, args, options) => {
    if (program === 'git' && args[0] === 'diff' && args[1] === '--cached' && args[2] === '--name-only') return 'private/customer.pdf\0';
    return command(program, args, options);
  };
  await assert.rejects(runShipChange({ message: 'Safe change', ownerLane: 'sales', files: ['scripts/new.mjs'] }, bad), /Unrelated files are staged/);
  assert(!calls.some(call => call[0] === 'git' && call[1] === 'push'));
});

test('refuses other dirty tracked files before touching the index', async () => {
  const { command, calls } = fakeCommands([]);
  const bad = async (program, args, options) => {
    if (program === 'git' && args[0] === 'diff' && args[1] === '--name-only') return 'docs/customer-notes.txt\0';
    return command(program, args, options);
  };
  await assert.rejects(runShipChange({ message: 'Safe change', ownerLane: 'sales', files: ['scripts/new.mjs'] }, bad), /Other tracked files are dirty/);
  assert(!calls.some(call => call[0] === 'git' && call[1] === 'add'));
});

test('rejects porcelain rename pairs before staging either path', async () => {
  const { command, calls } = fakeCommands([]);
  const renamed = async (program, args, options) => {
    if (program === 'git' && args[0] === 'status') return 'R  scripts/new.mjs\0scripts/old.mjs\0';
    return command(program, args, options);
  };
  await assert.rejects(runShipChange({ message: 'Rename', ownerLane: 'sales', files: ['scripts/new.mjs'] }, renamed), /Renamed or copied/);
  assert(!calls.some(call => call[0] === 'git' && call[1] === 'add'));
});

test('adds the required owner lane to an existing ordered PR', async () => {
  const existing = { ...member(42, 'codex/new-change', 'main', 1), body: 'Existing details.' };
  const { command, calls } = fakeCommands([existing]);
  await runShipChange({ message: 'Update change', ownerLane: 'sales', files: ['scripts/new.mjs'] }, command);
  assert(calls.some(call => call[0] === 'gh' && call[1] === 'pr' && call[2] === 'edit' &&
    call.includes('--body') && call.at(-1).includes('Existing details.\n\nOwner lane: sales')));
});

test('does not take over an existing PR assigned to another owner lane', async () => {
  const existing = { ...member(42, 'codex/new-change', 'main', 1), body: 'Owner lane: finance' };
  const { command, calls } = fakeCommands([existing]);
  await assert.rejects(runShipChange({ message: 'Update change', ownerLane: 'sales', files: ['scripts/new.mjs'] }, command), /belongs to owner lane finance/);
  assert(!calls.some(call => call[0] === 'git' && call[1] === 'commit'));
});

test('resume retries an existing clean commit without making a second commit', async () => {
  const { command, calls } = fakeCommands([]);
  const resumed = async (program, args, options) => {
    if (program === 'git' && args[0] === 'status') return '';
    if (program === 'git' && args[0] === 'rev-list') return '1\n';
    return command(program, args, options);
  };
  const result = await runShipChange({ message: 'New change', ownerLane: 'sales', files: [], resume: true }, resumed);
  assert.equal(result.queued, true);
  assert(!calls.some(call => call[0] === 'git' && ['add', 'commit'].includes(call[1])));
  assert(calls.some(call => call[0] === 'gh' && call[1] === 'pr' && call[2] === 'create'));
});

for (const scenario of ['clean', 'conflict', 'legacy clean', 'legacy conflict', 'proof clean', 'proof linear', 'proof conflict', 'proof wrong base', 'proof dropped manifest', 'proof wrong body', 'proof missing owner archive', 'proof foreign owner', 'proof changed source', 'proof missing approval', 'proof owner ancestry', 'proof no target', 'proof owner race', 'proof archive race', 'proof candidate race', 'proof CAS race', 'proof staged race', 'proof unstaged race', 'proof untracked race', 'proof push race', 'proof archive ref race', 'proof merge-only', 'ordered merge-only', 'changed head', 'late changed head', 'deleted branch', 'preflight refusal', 'missing archive', 'invalid parent', 'retry after helper failure', 'retry missing history', 'retry wrong history', 'retry foreign archive']) {
  test(`real Git open parent rewrite without reflog: ${scenario}`, async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ship-open-parent-'));
    const work = path.join(root, 'work');
    const origin = path.join(root, 'origin.git');
    fs.mkdirSync(work);
    const git = (...args) => execFileSync('git', args, { cwd: work, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    const write = (name, text) => fs.writeFileSync(path.join(work, name), text);
    const proofCase = scenario.startsWith('proof ');
    const retryCase = scenario.startsWith('retry ');
    const legacy = scenario.startsWith('legacy ') || proofCase || retryCase;
    const contentConflict = scenario === 'conflict' || scenario === 'legacy conflict' || scenario === 'proof conflict';
    try {
      execFileSync('git', ['init', '--bare', origin], { stdio: 'ignore' });
      git('init', '-b', 'main'); git('config', 'user.name', 'Test'); git('config', 'user.email', 'test@example.invalid');
      git('remote', 'add', 'origin', origin);
      write('base.txt', 'base\n'); git('add', '.'); git('commit', '-m', 'base');
      const mainBase = git('rev-parse', 'HEAD');
      git('switch', '-c', 'old-parent'); write('parent.txt', 'parent feature\n');
      if (contentConflict) write('child.txt', 'parent line\n');
      git('add', '.'); git('commit', '-m', 'old parent'); const oldParent = git('rev-parse', 'HEAD');
      if (legacy && !proofCase) git('branch', '-f', 'main', oldParent);
      git('switch', '-c', 'original-child'); write('child.txt', 'draft\n'); git('add', '.'); git('commit', '-m', 'draft');
      const first = git('rev-parse', 'HEAD'); write('child.txt', 'final  '); git('add', '.'); git('commit', '-m', 'final');
      const original = git('rev-parse', 'HEAD');
      git('switch', '-c', 'child', oldParent);
      if (scenario === 'proof linear') {
        git('merge', '--ff-only', 'original-child');
      } else {
        git('cherry-pick', '--no-commit', first); git('commit', '-m', 'copy draft');
        git('cherry-pick', '--no-commit', original); git('commit', '-m', 'copy final');
        if (scenario.endsWith('merge-only')) {
          git('merge', '--no-commit', '--no-ff', 'original-child');
          write('merge-only.txt', 'reviewed merge resolution only\n'); git('add', '.'); git('commit', '-m', 'merge with approved resolution');
        } else git('merge', '--no-edit', 'original-child');
      }
      const remoteHead = git('rev-parse', 'HEAD'); git('push', 'origin', 'child');
      if (scenario !== 'missing archive') { git('tag', 'archive/child', remoteHead); git('push', 'origin', 'refs/tags/archive/child'); }
      write('local-fix.txt', 'reviewed CI fix\n'); git('add', '.'); git('commit', '-m', 'new unpublished fix');
      const sourceHead = git('rev-parse', 'HEAD');
      git('switch', 'main'); write('main-only.txt', 'current main\n'); git('add', '.'); git('commit', '-m', 'main update'); git('push', 'origin', 'main');
      git('switch', '-c', 'parent'); write('parent.txt', 'parent feature\n'); write('parent-new.txt', 'keep new parent delta\n');
      if (contentConflict) write('child.txt', 'new parent decision\n');
      git('add', '.'); git('commit', '-m', 'rewritten open parent'); const parentHead = git('rev-parse', 'HEAD'); git('push', 'origin', 'parent');
      git('switch', 'child');
      const parentArchive = `refs/tags/archive/parent-${oldParent.slice(0, 8)}`;
      if (proofCase && scenario !== 'proof missing owner archive') {
        git('tag', parentArchive.replace('refs/tags/', ''), oldParent);
        git('push', 'origin', parentArchive);
      }
      const manifest = sourceDeltaManifest(execFileSync('git', ['diff', '--raw', '--no-abbrev', '--no-renames',
        '--no-ext-diff', '--no-textconv', '-z', oldParent, sourceHead, '--'], { cwd: work, encoding: 'utf8' }));
      const proof = { version: 1, head: sourceHead, base: oldParent, ownerPr: 41,
        ownerBranch: 'parent', ownerArchiveHead: oldParent, ownerArchiveRef: parentArchive, manifest };
      let approval = sourceManifestDigest(manifest);
      if (scenario === 'proof wrong base') proof.base = mainBase;
      if (scenario === 'proof owner ancestry') {
        proof.base = first;
        proof.manifest = sourceDeltaManifest(execFileSync('git', ['diff', '--raw', '--no-abbrev', '--no-renames',
          '--no-ext-diff', '--no-textconv', '-z', first, sourceHead, '--'], { cwd: work, encoding: 'utf8' }));
        approval = sourceManifestDigest(proof.manifest);
      }
      if (scenario === 'proof dropped manifest') { proof.manifest = manifest.slice(1); approval = sourceManifestDigest(proof.manifest); }
      if (scenario === 'proof changed source') proof.head = 'e'.repeat(40);
      if (scenario === 'proof missing approval') approval = undefined;
      const prs = [...(scenario === 'proof no target' ? [] : [member(41, 'parent', 'main', 1)]), { ...member(42, 'child', legacy ? 'main' : 'parent', 2),
        ...(legacy ? { labels: [] } : {}),
        body: proofCase ? `Owner lane: ci\nStack parent head: ${scenario === 'proof wrong body' ? mainBase : proof.base}` : legacy ? 'Owner lane: ci' : `Owner lane: ci\nStack parent head: ${scenario === 'invalid parent' ? 'f'.repeat(40) : oldParent}` }];
      const calls = [];
      let rebaseFailed = false;
      let helperFailed = false;
      let prReads = 0;
      let preflights = 0;
      let actorHead = null;
      const actorCommit = () => { write('actor.txt', 'new concurrent work\n'); git('add', 'actor.txt'); git('commit', '-m', 'concurrent actor'); actorHead = git('rev-parse', 'HEAD'); };
      const command = async (program, args) => {
        calls.push([program, ...args]);
        if (retryCase && program === process.execPath && !helperFailed) { helperFailed = true; throw new Error('injected candidate helper failure'); }
        if (program === 'npm') {
          preflights += 1;
          if (scenario === 'proof candidate race' && preflights === 2) actorCommit();
          if (scenario === 'preflight refusal') throw new Error('preflight refused');
          return '';
        }
        if (program === 'gh') {
          if (args[0] === 'pr' && args[1] === 'list') return JSON.stringify(prs);
          if (args[0] === 'api' && args[1] === 'repos/ZootimusMaximusSupreme/fundhub-platform/pulls/41') {
            return JSON.stringify({ head: { ref: 'parent', repo: { full_name: scenario === 'proof foreign owner'
              ? 'foreign/repo' : 'ZootimusMaximusSupreme/fundhub-platform' } } });
          }
          if (args[0] === 'pr' && args[1] === 'view') {
            prReads += 1;
            if (scenario === 'deleted branch' && prReads === 2) git('push', 'origin', ':refs/heads/child');
            return JSON.stringify({ headRefOid: scenario === 'changed head' || (scenario === 'late changed head' && prReads > 1) ? 'e'.repeat(40) : remoteHead, baseRefName: legacy ? 'main' : 'parent' });
          }
          return '';
        }
        if (program === 'git' && args[0] === 'remote') return 'https://github.com/ZootimusMaximusSupreme/fundhub-platform.git';
        if (scenario === 'proof CAS race' && program === 'git' && args[0] === 'update-ref') {
          actorHead = git('commit-tree', git('rev-parse', `${sourceHead}^{tree}`), '-p', sourceHead, '-m', 'concurrent source commit');
          git('update-ref', 'refs/heads/child', actorHead, sourceHead);
        }
        if (scenario === 'proof archive ref race' && program === 'git' && args[0] === 'push' && args.at(-1)?.endsWith(':refs/tags/archive/child')) git('tag', '-f', 'archive/child', remoteHead);
        if (scenario === 'proof push race' && program === 'git' && args[0] === 'push' && args.at(-1)?.endsWith(':refs/heads/child')) actorCommit();
        try {
          const result = execFileSync(program, args, { cwd: work, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
          if (scenario === 'proof owner race' && program === 'git' && args[0] === 'fetch' && args.at(-1) === parentArchive) actorCommit();
          if (scenario === 'proof archive race' && program === 'git' && args[0] === 'push' && args.at(-1)?.endsWith(':refs/tags/archive/child') && git('rev-parse', 'HEAD') === sourceHead) actorCommit();
          if (/^proof (staged|unstaged|untracked) race$/.test(scenario) && program === process.execPath) {
            if (scenario === 'proof unstaged race') write('base.txt', 'new unstaged work\n');
            else { write('actor.txt', 'new concurrent work\n'); if (scenario === 'proof staged race') git('add', 'actor.txt'); }
          }
          return result;
        }
        catch (error) { if (program === 'git' && args[0] === 'rebase') rebaseFailed = true; throw error; }
      };
      let action = runShipChange({ message: 'CI fix', ownerLane: 'ci', files: [], resume: true,
        ...(proofCase ? { sourceBoundaryProof: proof, approvedSourceManifest: approval } : {}) }, command);
      if (retryCase) {
        await assert.rejects(action, /injected candidate helper failure/);
        assert.equal(git('rev-parse', 'HEAD'), sourceHead);
        assert.equal(git('ls-remote', '--heads', 'origin', 'child').split(/\s+/)[0], remoteHead);
        assert.equal(git('ls-remote', '--tags', 'origin', 'refs/tags/archive/child').split(/\s+/)[0], sourceHead);
        const oldArchive = `refs/tags/archive/child-${remoteHead.slice(0, 8)}`;
        assert.equal(git('ls-remote', '--tags', 'origin', oldArchive).split(/\s+/)[0], remoteHead);
        if (scenario === 'retry missing history') git('push', 'origin', `:${oldArchive}`);
        if (scenario === 'retry wrong history') git('push', '--force', 'origin', `${mainBase}:${oldArchive}`);
        if (scenario === 'retry foreign archive') git('push', '--force', 'origin', `${oldParent}:refs/tags/archive/child`);
        calls.length = 0;
        action = runShipChange({ message: 'CI fix', ownerLane: 'ci', files: [], resume: true }, command);
      }
      if (scenario === 'retry after helper failure' || scenario === 'clean' || scenario === 'legacy clean'  || scenario === 'proof clean' || scenario === 'proof linear' || scenario.endsWith('merge-only') || scenario === 'proof push race' || scenario === 'proof archive ref race') {
        assert.equal((await action).number, 42);
        assert.equal(rebaseFailed, false, 'verified final delta must never replay source history');
        const published = git('ls-remote', '--heads', 'origin', 'child').split(/\s+/)[0];
        assert.equal(git('rev-parse', `${published}:child.txt`), git('rev-parse', `${sourceHead}:child.txt`));
        assert.equal(git('show', `${published}:parent-new.txt`), 'keep new parent delta');
        assert.equal(git('show', `${published}:local-fix.txt`), 'reviewed CI fix');
        assert.equal(git('show', `${published}:main-only.txt`), 'current main');
        assert.equal(git('merge-base', published, parentHead), parentHead);
        assert.equal(git('symbolic-ref', '--short', 'HEAD'), 'child');
        assert.equal(git('rev-parse', `refs/tags/archive/child-${remoteHead.slice(0, 8)}`), remoteHead);
        assert.equal(git('rev-parse', `refs/tags/archive/child-${sourceHead.slice(0, 8)}`), sourceHead);
        const preflightCalls = calls.filter(c => c[0] === 'npm');
        assert.deepEqual(preflightCalls.map(c => c.at(-1)), [oldParent, 'origin/parent']);
        assert.ok(calls.some(c => c.includes(`--force-with-lease=refs/heads/child:${remoteHead}`)));
        if (legacy) assert.ok(calls.some(c => c[0] === 'gh' && c.includes('--base') && c.at(-1) === 'parent'));
        if (scenario.endsWith('merge-only')) assert.equal(git('show', `${published}:merge-only.txt`), 'reviewed merge resolution only');
        if (scenario === 'proof push race') {
          assert.equal(git('rev-parse', 'HEAD'), actorHead);
          assert.throws(() => git('cat-file', '-e', `${published}:actor.txt`));
          assert.ok(calls.some(c => c[0] === 'git' && c[1] === 'push' && c.at(-1) === `${published}:refs/heads/child`));
        }
        if (proofCase) {
          assert.equal(git('show', `${published}:parent.txt`), 'parent feature');
          assert.ok(calls.some(c => c[0] === 'gh' && c.includes('--body') && c.at(-1).includes(`Stack parent head: ${parentHead}`)));
        }
      } else {
        await assert.rejects(action);
        assert.equal(git('ls-remote', '--heads', 'origin', 'child').split(/\s+/)[0], scenario === 'deleted branch' ? '' : remoteHead);
        assert.equal(calls.some(c => c[0] === 'git' && c[1] === 'push' && c.at(-1)?.endsWith(':refs/heads/child')), scenario === 'deleted branch');
        if (scenario === 'deleted branch') assert.ok(calls.some(c => c.includes(`--force-with-lease=refs/heads/child:${remoteHead}`)));
        assert.equal(calls.some(c => c[0] === 'gh' && (c.includes('--base') || c[1] === 'merge')), false);
        if (scenario === 'changed head' || scenario === 'preflight refusal') {
          assert.equal(calls.some(c => c[0] === 'git' && c[1] === 'push'), false, 'source preflight/freshness refusal must precede all archive pushes');
        }
        if (contentConflict) assert.equal(git('symbolic-ref', '--short', 'HEAD'), 'child');
        if (proofCase && !contentConflict && !scenario.endsWith(' race')) assert.equal(calls.some(c => c[0] === 'git' && c[1] === 'push'), false,
          'invalid source provenance/manifest must fail before any source archive push');
        if (actorHead) assert.equal(git('rev-parse', 'refs/heads/child'), actorHead, 'concurrent committed work survives refusal');
        if (scenario === 'proof staged race') assert.equal(git('show', ':actor.txt'), 'new concurrent work');
        if (scenario === 'proof unstaged race') assert.equal(fs.readFileSync(path.join(work, 'base.txt'), 'utf8'), 'new unstaged work\n');
        if (scenario === 'proof untracked race') assert.equal(fs.readFileSync(path.join(work, 'actor.txt'), 'utf8'), 'new concurrent work\n');
      }
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });
}

for (const scenario of ['normal clean', 'remote moves during preflight', 'remote moves at push', 'fetch observation mismatch', 'new branch clean', 'new branch race']) {
  test(`real Git source lease is frozen before rewrite: ${scenario}`, async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ship-frozen-lease-'));
    const work = path.join(root, 'work');
    const origin = path.join(root, 'origin.git');
    fs.mkdirSync(work);
    const git = (...args) => execFileSync('git', args, { cwd: work, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    const isNew = scenario.startsWith('new branch');
    try {
      execFileSync('git', ['init', '--bare', origin], { stdio: 'ignore' });
      git('init', '-b', 'main'); git('config', 'user.email', 'test@example.test'); git('config', 'user.name', 'Test');
      git('remote', 'add', 'origin', origin);
      fs.writeFileSync(path.join(work, 'base.txt'), 'base\n'); git('add', '.'); git('commit', '-m', 'base'); git('push', 'origin', 'main');
      git('switch', '-c', 'child'); fs.writeFileSync(path.join(work, 'child.txt'), 'published child\n');
      git('add', '.'); git('commit', '-m', 'published child'); const remoteHead = git('rev-parse', 'HEAD');
      if (!isNew) { git('push', 'origin', 'child'); git('tag', 'archive/child'); git('push', 'origin', 'refs/tags/archive/child'); }
      fs.writeFileSync(path.join(work, 'local.txt'), 'local intended fix\n'); git('add', '.'); git('commit', '-m', 'local fix');
      const sourceHead = git('rev-parse', 'HEAD');
      const otherHead = git('commit-tree', git('rev-parse', `${remoteHead}^{tree}`), '-p', remoteHead, '-m', 'another writer owns this commit');
      const calls = [];
      let raced = false;
      const moveRemote = (fetchTracking) => {
        raced = true;
        const replacement = scenario === 'new branch race' ? remoteHead : otherHead;
        git('push', 'origin', `${replacement}:refs/heads/child`);
        if (fetchTracking) git('fetch', 'origin', 'refs/heads/child:refs/remotes/origin/child');
        else {
          // A different checkout's push cannot update this checkout's fetched ref.
          git('update-ref', 'refs/remotes/origin/child', remoteHead);
        }
      };
      const command = async (program, args) => {
        calls.push([program, ...args]);
        if (program === 'npm') {
          if (scenario === 'remote moves during preflight' && !raced) moveRemote(true);
          return '';
        }
        if (program === 'gh') {
          if (args[1] === 'list') return JSON.stringify(isNew ? [] : [{ ...member(42, 'child', 'main', 1), body: 'Owner lane: ci' }]);
          if (args[1] === 'create') return 'https://github.com/ZootimusMaximusSupreme/fundhub-platform/pull/42';
          if (args[1] === 'view') return JSON.stringify(member(42, 'child', 'main', 1));
          return '';
        }
        if (program === 'git' && args[0] === 'remote') return 'https://github.com/ZootimusMaximusSupreme/fundhub-platform.git';
        if (scenario === 'fetch observation mismatch' && !raced && program === 'git' && args[0] === 'ls-remote' && args.at(-1) === 'refs/heads/child') moveRemote(false);
        if ((scenario === 'remote moves at push' || scenario === 'new branch race') && !raced && program === 'git' && args[0] === 'push' && args.at(-1)?.endsWith(':refs/heads/child')) moveRemote(true);
        return execFileSync(program, args, { cwd: work, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
      };
      const action = runShipChange({ message: 'CI fix', ownerLane: 'ci', files: [], resume: true }, command);
      const expectedLease = `--force-with-lease=refs/heads/child:${isNew ? '' : remoteHead}`;
      if (scenario === 'normal clean' || scenario === 'new branch clean') {
        await action;
        assert.equal(git('ls-remote', '--heads', 'origin', 'child').split(/\s+/)[0], sourceHead);
      } else {
        await assert.rejects(action);
        assert.equal(git('ls-remote', '--heads', 'origin', 'child').split(/\s+/)[0], scenario === 'new branch race' ? remoteHead : otherHead, 'the other writer must survive even if a background fetch updates origin/child');
        assert.equal(git('rev-parse', 'HEAD'), sourceHead, 'local intended work also survives');
        assert.equal(calls.some(c => c[0] === 'gh' && (c[1] === 'edit' || c[1] === 'merge')), false);
      }
      if (scenario === 'fetch observation mismatch') {
        assert.equal(calls.some(c => c[0] === 'git' && ['rebase', 'push'].includes(c[1])), false);
      } else {
        assert.ok(calls.some(c => c[0] === 'git' && c[1] === 'push' && c.includes(expectedLease) && c.at(-1)?.endsWith(':refs/heads/child')));
        assert.equal(calls.some(c => c.includes('--force-with-lease')), false, 'never use a tracking-ref-derived lease');
      }
      const observed = calls.findIndex(c => c[0] === 'git' && c[1] === 'ls-remote' && c.at(-1) === 'refs/heads/child');
      const rewrite = calls.findIndex(c => c[0] === 'git' && c[1] === 'rebase');
      assert.ok(observed >= 0 && (rewrite < 0 || observed < rewrite));
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });
}
