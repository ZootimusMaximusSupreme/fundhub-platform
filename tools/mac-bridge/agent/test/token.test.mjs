import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { loadOrCreateToken, tokenMatches } from '../src/token.mjs';
import { tempHome } from './_helpers.mjs';
import { encodeQR } from '../src/qr.mjs';

test('token: made once as 64 hex chars, mode 0600, and reused', () => {
  const d = tempHome();
  const t1 = loadOrCreateToken(d.tokenFile);
  assert.match(t1, /^[0-9a-f]{64}$/);
  assert.equal(fs.statSync(d.tokenFile).mode & 0o777, 0o600);
  assert.equal(loadOrCreateToken(d.tokenFile), t1);
});

test('token: compare accepts only the exact token', () => {
  assert.equal(tokenMatches('abc', 'abc'), true);
  assert.equal(tokenMatches('abd', 'abc'), false);
  assert.equal(tokenMatches('', 'abc'), false);
  assert.equal(tokenMatches(undefined, 'abc'), false);
  assert.equal(tokenMatches('abcd', 'abc'), false);
});

test('qr: pairing-link sized text fits and has finder patterns', () => {
  const link = 'macbridge://pair?host=192.168.1.23&port=7878&token=' + 'a1'.repeat(32) + '&name=My-Mac.local';
  const qr = encodeQR(link);
  assert.equal(qr.size, 17 + 4 * qr.version);
  assert.ok(qr.version <= 10);
  // top-left finder: dark ring, light ring, dark 3x3 core
  assert.equal(qr.modules[0][0], true);
  assert.equal(qr.modules[1][1], false);
  assert.equal(qr.modules[3][3], true);
  assert.throws(() => encodeQR('x'.repeat(400)));
});
