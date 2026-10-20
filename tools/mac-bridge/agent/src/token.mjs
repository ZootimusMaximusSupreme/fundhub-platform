import fs from 'node:fs';
import path from 'node:path';
import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';

/** Read ~/.mac-bridge/token, or make a random 32-byte hex token (mode 0600). */
export function loadOrCreateToken(tokenFile) {
  try {
    const t = fs.readFileSync(tokenFile, 'utf8').trim();
    if (t.length >= 16) {
      try {
        fs.chmodSync(tokenFile, 0o600);
      } catch {}
      return t;
    }
  } catch {}
  fs.mkdirSync(path.dirname(tokenFile), { recursive: true, mode: 0o700 });
  const token = randomBytes(32).toString('hex');
  fs.writeFileSync(tokenFile, token + '\n', { mode: 0o600 });
  fs.chmodSync(tokenFile, 0o600);
  return token;
}

const digest = (s) => createHash('sha256').update(String(s)).digest();

/** Constant-time compare (both sides are hashed first so lengths always match). */
export function tokenMatches(given, expected) {
  if (typeof given !== 'string' || !given) return false;
  return timingSafeEqual(digest(given), digest(expected));
}

export function bearerFrom(req) {
  const h = req.headers.authorization;
  if (typeof h !== 'string') return '';
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : '';
}
