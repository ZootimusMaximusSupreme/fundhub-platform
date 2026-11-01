import assert from 'node:assert/strict';
import test from 'node:test';
import { chooseBase, orderedChain, parseArgs, runShipChange } from './ship-change.mjs';

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
      if (args[0] === 'rev-parse' && args[1]?.startsWith('origin/')) return 'parent-head\n';
      if (args[0] === 'rev-parse' && args[1] === 'HEAD') return `${'a'.repeat(40)}\n`;
      if (args[0] === 'remote') return 'https://github.com/ZootimusMaximusSupreme/fundhub-platform.git\n';
      if (args[0] === 'status') return ' M scripts/new.mjs\0';
      if (args[0] === 'diff' && args[1] === '--cached' && args[2] === '--name-only') {
        return calls.some(call => call[0] === 'git' && call[1] === 'add') ? 'scripts/new.mjs\0' : '';
      }
      if (args[0] === 'merge-base') return 'parent-head\n';
      if (args[0] === 'ls-remote' && args[1] === '--heads') return `parent-head\trefs/heads/${args[3]}\n`;
      if (args[0] === 'ls-remote' && args[1] === '--tags') {
        return calls.some(call => call[0] === 'git' && call[1] === 'push' &&
          call.at(-1) === 'refs/tags/archive/codex/new-change')
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
    call.at(-1) === 'refs/tags/archive/codex/new-change');
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
  assert(calls.some(call => call.join(' ').includes('pr edit 42 --repo ZootimusMaximusSupreme/fundhub-platform --add-label ship-order/2')));
  assert(calls.some(call => call.join(' ') === 'npm run preflight -- --expected-base origin/codex/previous-change'));
  assert(!calls.some(call => call[0] === 'gh' && call[1] === 'pr' && call[2] === 'merge'));
});

test('a parent branch that moves during preflight stops before child push or PR creation', async () => {
  const { command, calls } = fakeCommands([member(41, 'codex/previous-change', 'main', 1)]);
  const moved = async (program, args, options) => {
    if (program === 'git' && args[0] === 'ls-remote' && args[1] === '--heads') {
      return `new-parent-head\trefs/heads/${args[3]}\n`;
    }
    return command(program, args, options);
  };
  await assert.rejects(runShipChange({ message: 'Next change', ownerLane: 'sales', files: ['scripts/new.mjs'] }, moved), /Stack parent .* advanced/);
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
    if (program === 'git' && args[0] === 'ls-remote' && args[1] === '--heads') {
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
