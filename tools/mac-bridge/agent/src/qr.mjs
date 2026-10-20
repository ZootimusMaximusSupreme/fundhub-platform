// Tiny QR code encoder: byte mode, error correction level L, versions 1-10
// (up to 271 bytes). Enough for the pairing link. No dependencies.

// [total codewords, ecc codewords per block, [blocks, data codewords per block], optional second group]
const VERSIONS = [
  null,
  [26, 7, [1, 19]],
  [44, 10, [1, 34]],
  [70, 15, [1, 55]],
  [100, 20, [1, 80]],
  [134, 26, [1, 108]],
  [172, 18, [2, 68]],
  [196, 20, [2, 78]],
  [242, 24, [2, 97]],
  [292, 30, [2, 116]],
  [346, 18, [2, 68], [2, 69]],
];
const ALIGN = [null, [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50]];

function dataCapacity(v) {
  const e = VERSIONS[v];
  return e[2][0] * e[2][1] + (e[3] ? e[3][0] * e[3][1] : 0);
}

function gfMul(x, y) {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z & 0xff;
}

function rsDivisor(degree) {
  const result = new Array(degree).fill(0);
  result[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < degree; j++) {
      result[j] = gfMul(result[j], root);
      if (j + 1 < degree) result[j] ^= result[j + 1];
    }
    root = gfMul(root, 2);
  }
  return result;
}

function rsRemainder(data, divisor) {
  const result = new Array(divisor.length).fill(0);
  for (const b of data) {
    const factor = b ^ result.shift();
    result.push(0);
    divisor.forEach((c, i) => (result[i] ^= gfMul(c, factor)));
  }
  return result;
}

function getBit(x, i) {
  return ((x >>> i) & 1) !== 0;
}

function maskFn(mask, x, y) {
  switch (mask) {
    case 0: return (x + y) % 2 === 0;
    case 1: return y % 2 === 0;
    case 2: return x % 3 === 0;
    case 3: return (x + y) % 3 === 0;
    case 4: return (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0;
    case 5: return ((x * y) % 2) + ((x * y) % 3) === 0;
    case 6: return ((((x * y) % 2) + ((x * y) % 3)) % 2) === 0;
    default: return ((((x + y) % 2) + ((x * y) % 3)) % 2) === 0;
  }
}

function penalty(m, size) {
  let score = 0;
  // N1: runs of 5+ in rows and columns
  for (const rowsFirst of [true, false]) {
    for (let a = 0; a < size; a++) {
      let run = 1;
      for (let b = 1; b < size; b++) {
        const cur = rowsFirst ? m[a][b] : m[b][a];
        const prev = rowsFirst ? m[a][b - 1] : m[b - 1][a];
        if (cur === prev) {
          run++;
          if (run === 5) score += 3;
          else if (run > 5) score += 1;
        } else run = 1;
      }
    }
  }
  // N2: 2x2 blocks
  for (let y = 0; y < size - 1; y++)
    for (let x = 0; x < size - 1; x++) {
      const c = m[y][x];
      if (c === m[y][x + 1] && c === m[y + 1][x] && c === m[y + 1][x + 1]) score += 3;
    }
  // N3: finder-like 1:1:3:1:1 with 4 light modules on a side
  const pat = [true, false, true, true, true, false, true];
  for (const rowsFirst of [true, false]) {
    for (let a = 0; a < size; a++) {
      for (let b = 0; b + 7 <= size; b++) {
        let ok = true;
        for (let k = 0; k < 7 && ok; k++) ok = (rowsFirst ? m[a][b + k] : m[b + k][a]) === pat[k];
        if (!ok) continue;
        const light = (i) => {
          if (i < 0 || i >= size) return true;
          return !(rowsFirst ? m[a][i] : m[i][a]);
        };
        let before = true;
        let after = true;
        for (let k = 1; k <= 4; k++) {
          before = before && light(b - k);
          after = after && light(b + 6 + k);
        }
        if (before) score += 40;
        if (after) score += 40;
      }
    }
  }
  // N4: dark/light balance
  let dark = 0;
  for (const row of m) for (const c of row) if (c) dark++;
  const pct = (dark * 100) / (size * size);
  score += Math.floor(Math.abs(pct - 50) / 5) * 10;
  return score;
}

/** Returns { size, modules: boolean[][] } or throws if the text is too long. */
export function encodeQR(text) {
  const bytes = Buffer.from(text, 'utf8');
  let version = 0;
  for (let v = 1; v <= 10; v++) {
    const countBits = v < 10 ? 8 : 16;
    if (4 + countBits + bytes.length * 8 <= dataCapacity(v) * 8) {
      version = v;
      break;
    }
  }
  if (!version) throw new Error('text too long for the built-in QR encoder');
  const [, eccLen, g1, g2] = VERSIONS[version];
  const capBits = dataCapacity(version) * 8;

  const bits = [];
  const put = (val, n) => {
    for (let i = n - 1; i >= 0; i--) bits.push((val >>> i) & 1);
  };
  put(0b0100, 4);
  put(bytes.length, version < 10 ? 8 : 16);
  for (const b of bytes) put(b, 8);
  put(0, Math.min(4, capBits - bits.length));
  while (bits.length % 8) bits.push(0);
  const data = [];
  for (let i = 0; i < bits.length; i += 8) {
    let b = 0;
    for (let k = 0; k < 8; k++) b = (b << 1) | bits[i + k];
    data.push(b);
  }
  for (let pad = 0xec; data.length < capBits / 8; pad ^= 0xec ^ 0x11) data.push(pad);

  // split into blocks, add ECC, interleave
  const blocks = [];
  let pos = 0;
  for (const g of [g1, g2]) {
    if (!g) continue;
    for (let i = 0; i < g[0]; i++) {
      blocks.push(data.slice(pos, pos + g[1]));
      pos += g[1];
    }
  }
  const divisor = rsDivisor(eccLen);
  const eccBlocks = blocks.map((b) => rsRemainder(b, divisor));
  const all = [];
  const maxLen = Math.max(...blocks.map((b) => b.length));
  for (let i = 0; i < maxLen; i++) for (const b of blocks) if (i < b.length) all.push(b[i]);
  for (let i = 0; i < eccLen; i++) for (const e of eccBlocks) all.push(e[i]);

  const size = 17 + 4 * version;
  const mk = () => Array.from({ length: size }, () => new Array(size).fill(false));
  const modules = mk();
  const isFn = mk();
  const set = (x, y, v) => {
    modules[y][x] = v;
    isFn[y][x] = true;
  };

  for (let i = 0; i < size; i++) {
    set(6, i, i % 2 === 0);
    set(i, 6, i % 2 === 0);
  }
  const finder = (cx, cy) => {
    for (let dy = -4; dy <= 4; dy++)
      for (let dx = -4; dx <= 4; dx++) {
        const d = Math.max(Math.abs(dx), Math.abs(dy));
        const x = cx + dx;
        const y = cy + dy;
        if (x >= 0 && x < size && y >= 0 && y < size) set(x, y, d !== 2 && d !== 4);
      }
  };
  finder(3, 3);
  finder(size - 4, 3);
  finder(3, size - 4);
  const ap = ALIGN[version];
  for (let i = 0; i < ap.length; i++)
    for (let j = 0; j < ap.length; j++) {
      if ((i === 0 && j === 0) || (i === 0 && j === ap.length - 1) || (i === ap.length - 1 && j === 0)) continue;
      for (let dy = -2; dy <= 2; dy++)
        for (let dx = -2; dx <= 2; dx++) set(ap[i] + dx, ap[j] + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    }

  const drawFormat = (mask) => {
    const d = (1 << 3) | mask; // ECC level L = 01
    let rem = d;
    for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    const fb = ((d << 10) | rem) ^ 0x5412;
    for (let i = 0; i <= 5; i++) set(8, i, getBit(fb, i));
    set(8, 7, getBit(fb, 6));
    set(8, 8, getBit(fb, 7));
    set(7, 8, getBit(fb, 8));
    for (let i = 9; i < 15; i++) set(14 - i, 8, getBit(fb, i));
    for (let i = 0; i < 8; i++) set(size - 1 - i, 8, getBit(fb, i));
    for (let i = 8; i < 15; i++) set(8, size - 15 + i, getBit(fb, i));
    set(8, size - 8, true);
  };
  drawFormat(0);
  if (version >= 7) {
    let rem = version;
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
    const vb = (version << 12) | rem;
    for (let i = 0; i < 18; i++) {
      const a = size - 11 + (i % 3);
      const b = Math.floor(i / 3);
      set(a, b, getBit(vb, i));
      set(b, a, getBit(vb, i));
    }
  }

  // zigzag placement of data + ecc bits
  let i = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++) {
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        const upward = ((right + 1) & 2) === 0;
        const y = upward ? size - 1 - vert : vert;
        if (!isFn[y][x] && i < all.length * 8) {
          modules[y][x] = getBit(all[i >>> 3], 7 - (i & 7));
          i++;
        }
      }
    }
  }

  // choose the best mask
  let best = null;
  let bestScore = Infinity;
  for (let mask = 0; mask < 8; mask++) {
    const trial = modules.map((r) => r.slice());
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (!isFn[y][x] && maskFn(mask, x, y)) trial[y][x] = !trial[y][x];
    const sc = penalty(trial, size);
    if (sc < bestScore) {
      bestScore = sc;
      best = { mask, trial };
    }
  }
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) modules[y][x] = best.trial[y][x];
  drawFormat(best.mask);
  return { size, modules, version, mask: best.mask };
}

/** Render with black-on-white ANSI colors and half-height blocks (works on dark and light terminals). */
export function renderQR(qr, quiet = 2) {
  const { size, modules } = qr;
  const dark = (x, y) => x >= 0 && y >= 0 && x < size && y < size && modules[y][x];
  const lines = [];
  for (let y = -quiet; y < size + quiet; y += 2) {
    let line = '\x1b[30;47m';
    for (let x = -quiet; x < size + quiet; x++) {
      const t = dark(x, y);
      const b = dark(x, y + 1);
      line += t && b ? '█' : t ? '▀' : b ? '▄' : ' ';
    }
    lines.push(line + '\x1b[0m');
  }
  return lines.join('\n');
}

/** Plain PNG of the QR (for checking it with a real decoder). */
export async function qrToPng(qr, scale = 8, quiet = 4) {
  const { deflateSync } = await import('node:zlib');
  const n = qr.size + quiet * 2;
  const w = n * scale;
  const raw = Buffer.alloc((w + 1) * w);
  for (let py = 0; py < w; py++) {
    raw[py * (w + 1)] = 0;
    const my = Math.floor(py / scale) - quiet;
    for (let px = 0; px < w; px++) {
      const mx = Math.floor(px / scale) - quiet;
      const d = mx >= 0 && my >= 0 && mx < qr.size && my < qr.size && qr.modules[my][mx];
      raw[py * (w + 1) + 1 + px] = d ? 0 : 255;
    }
  }
  const crcTable = Array.from({ length: 256 }, (_, k) => {
    let c = k;
    for (let i = 0; i < 8; i++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf) => {
    let c = 0xffffffff;
    for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const c = Buffer.alloc(4);
    c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(w, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 0; // grayscale
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
