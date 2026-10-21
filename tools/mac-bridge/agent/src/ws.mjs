// Minimal RFC 6455 WebSocket server side. Text frames only (binary is refused).
// No dependencies: node:crypto and node:events only.
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const MAX_CLIENT_PAYLOAD = 1024 * 1024; // clients only send tiny JSON; 1 MB is plenty

export function acceptKey(secWebSocketKey) {
  return createHash('sha1').update(secWebSocketKey + GUID).digest('base64');
}

/** Encode one unfragmented server frame (never masked). */
export function encodeFrame(opcode, payload = Buffer.alloc(0), fin = true) {
  const body = Buffer.isBuffer(payload) ? payload : Buffer.from(payload, 'utf8');
  const len = body.length;
  let head;
  if (len < 126) {
    head = Buffer.alloc(2);
    head[1] = len;
  } else if (len <= 0xffff) {
    head = Buffer.alloc(4);
    head[1] = 126;
    head.writeUInt16BE(len, 2);
  } else {
    head = Buffer.alloc(10);
    head[1] = 127;
    head.writeBigUInt64BE(BigInt(len), 2);
  }
  head[0] = (fin ? 0x80 : 0) | (opcode & 0x0f);
  return Buffer.concat([head, body]);
}

/**
 * Incremental frame decoder. feed(chunk) returns an array of frames
 * { fin, opcode, payload } or throws an Error with .closeCode set.
 */
export class FrameDecoder {
  constructor({ requireMask = true, maxPayload = MAX_CLIENT_PAYLOAD } = {}) {
    this.buf = Buffer.alloc(0);
    this.requireMask = requireMask;
    this.maxPayload = maxPayload;
  }

  feed(chunk) {
    this.buf = this.buf.length ? Buffer.concat([this.buf, chunk]) : chunk;
    const frames = [];
    for (;;) {
      const b = this.buf;
      if (b.length < 2) break;
      const fin = (b[0] & 0x80) !== 0;
      if (b[0] & 0x70) throw closeError(1002, 'reserved bits set');
      const opcode = b[0] & 0x0f;
      const masked = (b[1] & 0x80) !== 0;
      let len = b[1] & 0x7f;
      let off = 2;
      if (len === 126) {
        if (b.length < 4) break;
        len = b.readUInt16BE(2);
        off = 4;
      } else if (len === 127) {
        if (b.length < 10) break;
        const big = b.readBigUInt64BE(2);
        if (big > BigInt(this.maxPayload)) throw closeError(1009, 'frame too large');
        len = Number(big);
        off = 10;
      }
      if (len > this.maxPayload) throw closeError(1009, 'frame too large');
      if (this.requireMask && !masked) throw closeError(1002, 'client frames must be masked');
      const isControl = opcode >= 0x8;
      if (isControl && (!fin || len > 125)) throw closeError(1002, 'bad control frame');
      const need = off + (masked ? 4 : 0) + len;
      if (b.length < need) break;
      let payload = b.subarray(off + (masked ? 4 : 0), need);
      if (masked) {
        const key = b.subarray(off, off + 4);
        const out = Buffer.allocUnsafe(len);
        for (let i = 0; i < len; i++) out[i] = payload[i] ^ key[i & 3];
        payload = out;
      } else {
        payload = Buffer.from(payload);
      }
      frames.push({ fin, opcode, payload });
      this.buf = b.subarray(need);
    }
    return frames;
  }
}

function closeError(code, message) {
  const e = new Error(message);
  e.closeCode = code;
  return e;
}

/** One connected client. Emits 'message' (string) and 'close'. */
export class WsConnection extends EventEmitter {
  constructor(socket, { pingMs = 25000, idleMs = 90000 } = {}) {
    super();
    this.socket = socket;
    this.closed = false;
    this.decoder = new FrameDecoder();
    this.fragments = [];
    this.fragmentBytes = 0;
    this.lastSeen = Date.now();
    socket.setNoDelay(true);
    socket.on('data', (d) => this.#onData(d));
    socket.on('close', () => this.#finish());
    socket.on('error', () => this.#finish());
    this.pingTimer = setInterval(() => {
      if (Date.now() - this.lastSeen > idleMs) return this.terminate();
      this.#write(encodeFrame(0x9, Buffer.alloc(0)));
    }, pingMs);
    this.pingTimer.unref?.();
  }

  #onData(chunk) {
    this.lastSeen = Date.now();
    let frames;
    try {
      frames = this.decoder.feed(chunk);
    } catch (e) {
      return this.close(e.closeCode || 1002);
    }
    for (const f of frames) {
      if (this.closed) return;
      switch (f.opcode) {
        case 0x0: // continuation
        case 0x1: // text
          if (f.opcode === 0x1 && this.fragments.length) return this.close(1002);
          if (f.opcode === 0x0 && !this.fragments.length) return this.close(1002);
          this.fragments.push(f.payload);
          this.fragmentBytes += f.payload.length;
          if (this.fragmentBytes > MAX_CLIENT_PAYLOAD) return this.close(1009);
          if (f.fin) {
            const text = Buffer.concat(this.fragments).toString('utf8');
            this.fragments = [];
            this.fragmentBytes = 0;
            this.emit('message', text);
          }
          break;
        case 0x2: // binary: not supported
          return this.close(1003);
        case 0x8: { // close: echo the code and finish
          const code = f.payload.length >= 2 ? f.payload.readUInt16BE(0) : 1005;
          return this.close(code === 1005 ? 1000 : code);
        }
        case 0x9: // ping
          this.#write(encodeFrame(0xa, f.payload));
          break;
        case 0xa: // pong
          break;
        default:
          return this.close(1002);
      }
    }
  }

  #write(buf) {
    if (this.closed || this.socket.destroyed) return false;
    if (this.socket.writableLength > 8 * 1024 * 1024) {
      this.terminate(); // client is not reading; drop it
      return false;
    }
    this.socket.write(buf);
    return true;
  }

  send(text) {
    return this.#write(encodeFrame(0x1, text));
  }

  close(code = 1000) {
    if (this.closed) return;
    const p = Buffer.alloc(2);
    p.writeUInt16BE(code, 0);
    try {
      this.socket.write(encodeFrame(0x8, p));
      this.socket.end();
    } catch {}
    this.#finish();
    setTimeout(() => this.socket.destroy(), 500).unref?.();
  }

  terminate() {
    this.#finish();
    this.socket.destroy();
  }

  #finish() {
    if (this.closed) return;
    this.closed = true;
    clearInterval(this.pingTimer);
    this.emit('close');
  }
}

/**
 * Handle an http 'upgrade' event. Returns a WsConnection or null
 * (null means the socket was already answered and closed).
 */
export function acceptUpgrade(req, socket, opts) {
  const key = req.headers['sec-websocket-key'];
  const upgrade = String(req.headers.upgrade || '').toLowerCase();
  if (upgrade !== 'websocket' || !key || req.headers['sec-websocket-version'] !== '13') {
    socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
    return null;
  }
  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\n' +
      'Upgrade: websocket\r\n' +
      'Connection: Upgrade\r\n' +
      `Sec-WebSocket-Accept: ${acceptKey(key)}\r\n\r\n`,
  );
  return new WsConnection(socket, opts);
}
