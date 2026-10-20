import test from 'node:test';
import assert from 'node:assert/strict';
import { acceptKey, encodeFrame, FrameDecoder } from '../src/ws.mjs';

function clientFrame(opcode, payload, { fin = true, maskKey = Buffer.from([1, 2, 3, 4]) } = {}) {
  const body = Buffer.isBuffer(payload) ? payload : Buffer.from(payload);
  const len = body.length;
  let head;
  if (len < 126) head = Buffer.from([0x80 | 0, 0x80 | len]);
  else if (len <= 0xffff) {
    head = Buffer.alloc(4);
    head[1] = 0x80 | 126;
    head.writeUInt16BE(len, 2);
  } else {
    head = Buffer.alloc(10);
    head[1] = 0x80 | 127;
    head.writeBigUInt64BE(BigInt(len), 2);
  }
  head[0] = (fin ? 0x80 : 0) | opcode;
  const masked = Buffer.from(body.map((b, i) => b ^ maskKey[i & 3]));
  return Buffer.concat([head, maskKey, masked]);
}

test('RFC 6455 example: Sec-WebSocket-Accept', () => {
  assert.equal(acceptKey('dGhlIHNhbXBsZSBub25jZQ=='), 's3pPLMBiTxaQ9kYGzzhZRbK+xOo=');
});

test('server frames: 7-bit, 16-bit and 64-bit lengths', () => {
  const small = encodeFrame(0x1, 'a'.repeat(125));
  assert.equal(small[0], 0x81);
  assert.equal(small[1], 125);
  const mid = encodeFrame(0x1, 'b'.repeat(126));
  assert.equal(mid[1], 126);
  assert.equal(mid.readUInt16BE(2), 126);
  const max16 = encodeFrame(0x1, 'c'.repeat(65535));
  assert.equal(max16[1], 126);
  assert.equal(max16.readUInt16BE(2), 65535);
  const big = encodeFrame(0x1, 'd'.repeat(65536));
  assert.equal(big[1], 127);
  assert.equal(big.readBigUInt64BE(2), 65536n);
  assert.equal(big.length, 10 + 65536);
  // server frames are not masked
  assert.equal(small[1] & 0x80, 0);
});

test('decoder: masked client text frames at every length class', () => {
  for (const n of [0, 5, 125, 126, 1000, 65535, 65536, 70000]) {
    const d = new FrameDecoder({ maxPayload: 1 << 20 });
    const msg = 'é'.repeat(Math.floor(n / 2)) + 'x'.repeat(n % 2);
    const frames = d.feed(clientFrame(0x1, msg));
    assert.equal(frames.length, 1, `len ${n}`);
    assert.equal(frames[0].opcode, 1);
    assert.equal(frames[0].payload.toString('utf8'), msg);
  }
});

test('decoder: handles frames split across chunks and several frames in one chunk', () => {
  const d = new FrameDecoder();
  const f1 = clientFrame(0x1, '{"type":"subscribe"}');
  const f2 = clientFrame(0x9, 'hi');
  const all = Buffer.concat([f1, f2]);
  const out = [];
  for (let i = 0; i < all.length; i++) out.push(...d.feed(all.subarray(i, i + 1)));
  assert.deepEqual(out.map((f) => f.opcode), [1, 9]);
  assert.equal(out[0].payload.toString(), '{"type":"subscribe"}');
  const d2 = new FrameDecoder();
  assert.equal(d2.feed(all).length, 2);
});

test('decoder: rejects unmasked client frames and oversized frames', () => {
  const d = new FrameDecoder();
  assert.throws(() => d.feed(encodeFrame(0x1, 'hi')), (e) => e.closeCode === 1002);
  const d2 = new FrameDecoder({ maxPayload: 100 });
  assert.throws(() => d2.feed(clientFrame(0x1, 'z'.repeat(200))), (e) => e.closeCode === 1009);
});
