// src/ad-videos/merge-takes.mjs — every take of one angle becomes ONE master,
// in script order, with the bad bits cut, BEFORE Submagic sees it.
//
// ═══════════════════════════════════════════════════════════════════════════
// THE LAW THIS FILE EXISTS TO HOLD (owner-set 2026-09-24)
//
//   .claude/rules/ad-video-best-of-clips.md — one finished video per ad, made
//   from the best of EVERY take, joined in SCRIPT order, with dead air,
//   repeats, false starts, filler and half sentences cut. Never ship a lone
//   take when other takes exist.
//   .claude/rules/ad-naming.md + marketing/ads/NAMING.md — a take's name is
//   `{Offer} Ad {n} — {angle} Take {n}.mp4`. Same offer, same ad number and
//   the same ANGLE WORDS are takes of one video. A different angle is a
//   different video, even with the same ad number. Never join across angles.
//
// marketing/MACHINE-GAPS.md item 7 measured that no code did any of this.
// ═══════════════════════════════════════════════════════════════════════════
//
// PURE. No database, no network, no clock, no filesystem, no ffmpeg. Every
// input is an argument, so every rule below is proved by a unit test with a
// fake transcript. The media half (ffmpeg, whisper.cpp) is
// src/ad-videos/merge-takes-media.mjs; the sweeper hook is
// src/ad-videos/merge-takes-step.mjs.
//
// THE PIECES, in the order a join runs them:
//
//   1. NAMES      parseTakeName() reads NAMING.md's four parts back out.
//   2. GROUP      groupKey() — offer + ad number + angle words. Nothing else.
//   3. DECIDE     decideJoin() — for one row at `staged`: send it the old way
//                 (one take only), wait, close it into another row's master,
//                 or join.
//   4. SCRIPT     parseScriptMarkdown() + findScript() — the lines, in order.
//   5. ALIGN      findHits() — every attempt at every line in every take,
//                 by local alignment of words (Smith-Waterman on tokens).
//   6. PICK       planBestOf() — per line, the cleanest complete attempt.
//   7. CUT        buildEdl() — the edit decision list: which seconds of which
//                 take, with filler, repeats, long pauses, lead-in silence
//                 and hanging tails removed.

/* ─────────────────────────────────────────────────────────────────────────
   The numbers. Every one is a safe default, written on the board
   (ops/workflows/perfect-machine-2026-10-05.md, M6) so nobody has to ask.
   ───────────────────────────────────────────────────────────────────────── */
export const DEFAULTS = Object.freeze({
  /* Takes of one angle land minutes apart (a phone uploads one 4K file at a
     time). A take is not decided until the NEWEST take of its angle has sat
     this long, so a lone take is never sent while its sibling is still
     uploading. Thirty minutes: an ad is never that urgent. */
  settleMinutes: 30,
  /* Seconds of air kept before the first word and after the last word of a
     kept run. Enough to keep the consonants, short enough that a line never
     opens or closes on dead air. padIn is the bigger one: measured 2026-10-05,
     0.08 s clipped the first sound of four lines ("Nobody" came back as
     "but he"). */
  padIn: 0.15,
  padOut: 0.12,
  /* The master's very first cut: the ad opens on Chris speaking, not on air. */
  padFirst: 0.08,
  /* A pause longer than this INSIDE a line is cut down to the two pads. */
  maxGap: 0.45,
  /* A pause longer than this inside a line counts against that attempt. */
  longPause: 0.7,
  /* A line is said "completely" when at least this share of its words are
     heard, and the attempt reaches its first and last words. */
  completeCoverage: 0.75,
  /* Fewer than this share of the script's lines found cleanly anywhere means
     the takes do not follow this script. Nothing is joined. */
  minScriptCoverage: 0.7,
  /* How many attempts at one line a single take may hold (restarts). */
  maxAttemptsPerLine: 6,
  /* A cut shorter than this after black-frame trimming is dropped. */
  minSegment: 0.1
});

/** Written at the start of failure_reason on a take that went into another
    row's master, so code and people can tell "joined" from "broken". */
export const JOINED_PREFIX = "joined into one master:";

/** Script files, in the order they are trusted. NAMING.md names the locked
    file as the source of the angle names, so it is read first; the later
    files are word-for-word compilations that also carry the newer ads. */
export const SCRIPT_SOURCES = Object.freeze([
  "marketing/ads/slo/fundhub-297/FundHub-LOCKED-ADS.md",
  "marketing/ads/scripts/ALL-ADS-since-2026-09-03.md",
  "marketing/ads/scripts/2026-10-02.md",
  "marketing/ads/scripts/book-a-call-final-2026-10-03.md",
  "marketing/ads/ascension/ascension-ads.md"
]);

/** Spoken filler. Cut wherever it is not one of the script's own words. */
export const FILLERS = Object.freeze(new Set([
  "um", "umm", "uh", "uhh", "uhm", "er", "erm", "ah", "hmm", "mm", "mhm"
]));
/* "like" and "you know" are filler only when they are NOT the script's words.
   The aligner decides that: an inserted token is one the script does not have
   at that point, so an inserted "like" is filler and a scripted one is kept. */
const SOFT_FILLERS = new Set(["like"]);

/* States a take is still waiting to go to Submagic in. Only these can carry a
   master; a take already at Submagic is history, but its file still joins. */
export const PRE_SUBMAGIC = Object.freeze(["raw_landed", "staged"]);

const has = (v) => v !== null && v !== undefined && String(v).trim() !== "";

/* ═════════════════════════════════════════════════════════════════════════
   1. NAMES — marketing/ads/NAMING.md
   ═════════════════════════════════════════════════════════════════════════ */

/* `{Offer} Ad {n} — {angle} Take {n}.mp4`. The dash is an em dash by law; an
   en dash or a spaced hyphen is read too, because the ANGLE WORDS are what
   decide a group and a different dash does not change a word. */
const TAKE_NAME_RE = /^(.+?)\s+Ad\s+(\d{1,4})\s+[—–-]\s+(.+?)\s+Take\s+(\d{1,3})\s*\.([A-Za-z0-9]{2,5})$/i;
/* The ad prefix alone, for a name that left the angle off ("SLO Ad 7 Take 1"). */
const AD_PREFIX_RE = /^(.+?)\s+Ad\s+(\d{1,4})\b/i;

function cleanOffer(s) {
  return String(s || "").trim().replace(/\s+/g, " ").toUpperCase();
}

/**
 * parseTakeName("SLO Ad 7 — Haynes, the call that was never a roadmap Take 1.mp4")
 *   → { offer: "SLO", adNumber: 7, angle: "Haynes, the call that was never a roadmap", takeNo: 1, ext: "mp4" }
 * Anything that is not all four parts → null. Never a guess.
 */
export function parseTakeName(name) {
  const s = String(name == null ? "" : name).trim();
  const m = TAKE_NAME_RE.exec(s);
  if (!m) return null;
  const angle = m[3].trim();
  if (!angle) return null;
  return {
    offer: cleanOffer(m[1]),
    adNumber: Number(m[2]),
    angle,
    takeNo: Number(m[4]),
    ext: m[5].toLowerCase()
  };
}

/** The offer and ad number of a name, even one that left the angle off. */
export function parseAdPrefix(name) {
  const m = AD_PREFIX_RE.exec(String(name == null ? "" : name).trim());
  if (!m) return null;
  return { offer: cleanOffer(m[1]), adNumber: Number(m[2]) };
}

/** The angle words, compared without caring about case, curly quotes, runs of
    spaces, a trailing "(9/22 rewrite)" note or end punctuation. */
export function normalizeAngle(angle) {
  return String(angle || "")
    .toLowerCase()
    .replace(/[’‘`]/g, "'")
    .replace(/[“”]/g, "\"")
    .replace(/[—–]/g, "-")
    .replace(/\s*\([^)]*\)\s*$/, "")
    .replace(/\s+/g, " ")
    .replace(/[\s.,;:!?]+$/, "")
    .trim();
}

/** What makes two takes one video: offer + ad number + angle words. */
export function groupKey(parsed) {
  if (!parsed) return null;
  return `${cleanOffer(parsed.offer)}|${Number(parsed.adNumber)}|${normalizeAngle(parsed.angle)}`;
}

/** "SLO Ad 7 — Haynes, the call that was never a roadmap" — for notes. */
export function groupLabel(parsed) {
  return parsed ? `${parsed.offer} Ad ${parsed.adNumber} — ${parsed.angle}` : "(unnamed)";
}

/* ═════════════════════════════════════════════════════════════════════════
   2 + 3. GROUP AND DECIDE — for ONE row the sweeper is about to send.
   ═════════════════════════════════════════════════════════════════════════ */

function createdMs(r) {
  const t = Date.parse(String(r?.created_at || ""));
  return Number.isFinite(t) ? t : 0;
}

const byTakeThenAge = (a, b) =>
  (a.parsed.takeNo - b.parsed.takeNo) || (createdMs(a.row) - createdMs(b.row)) ||
  String(a.row.id).localeCompare(String(b.row.id));

/**
 * decideJoin(row, takes, { now, settleMinutes }) → one decision.
 *
 * `row` is the take at `staged` the sweeper is about to send. `takes` is every
 * ad_videos row with a Drive file (fresh from the database, including `row`).
 *
 *   { action: "proceed", note }              the old way: this take alone.
 *                                             ONLY when it is the one take of
 *                                             its angle, or its name cannot be
 *                                             grouped at all (no name).
 *   { action: "hold", note }                 wait. Nothing is sent.
 *   { action: "close", reason, leadId }      this take goes into another
 *                                             row's master; it is not sent.
 *   { action: "skip", note }                 this row already moved on.
 *   { action: "join", members, lead, parsed, note }
 *
 * NEVER a lone take when other takes of its angle exist.
 */
export function decideJoin(row, takes = [], { now = Date.now(), settleMinutes = DEFAULTS.settleMinutes } = {}) {
  const name = row?.drive_raw_name;

  /* No name at all. Drive never lists a file without one, so this is a row
     made by hand or by an old path; it cannot be grouped, and refusing it
     would strand it for no rule's sake. The old way, said out loud. */
  if (!has(name)) {
    return { action: "proceed", note: "join: no file name on this take, so it cannot be grouped — sent the old way, alone" };
  }

  const fresh = takes.find((t) => t.id === row.id);
  if (fresh && fresh.status !== row.status) {
    return { action: "skip", note: `join: this take is ${fresh.status} now — nothing to send` };
  }

  const parsed = parseTakeName(name);
  if (!parsed) {
    const ad = parseAdPrefix(name);
    if (ad) {
      const others = takes.filter((t) => t.id !== row.id && sameAd(parseAdPrefix(t.drive_raw_name), ad));
      if (others.length) {
        return { action: "hold", note:
          `join: "${name}" has no angle in its name (marketing/ads/NAMING.md: {Offer} Ad {n} — {angle} Take {n}) ` +
          `and ${others.length} other file(s) carry ${ad.offer} Ad ${ad.adNumber}. The angle words decide what joins, ` +
          "so nothing was joined or sent. Rename the file to its full NAMING.md name." };
      }
      return settleOrProceed(row, [row], { now, settleMinutes,
        note: `join: "${name}" has no angle in its name, and it is the only file for ${ad.offer} Ad ${ad.adNumber} — sent alone` });
    }
    return { action: "hold", note:
      `join: "${name}" does not follow marketing/ads/NAMING.md ({Offer} Ad {n} — {angle} Take {n}.mp4), ` +
      "so its other takes cannot be found and it cannot be joined. Nothing was sent. Rename it to its NAMING.md name." };
  }

  const key = groupKey(parsed);
  let group = takes
    .map((t) => ({ row: t, parsed: parseTakeName(t.drive_raw_name) }))
    .filter((t) => t.parsed && groupKey(t.parsed) === key && has(t.row.drive_raw_file_id));
  if (!group.some((g) => g.row.id === row.id)) group.push({ row, parsed });
  group.sort(byTakeThenAge);

  /* One file per take number. A second file with the same take number is the
     same take uploaded twice; the earliest one is the take. */
  const seen = new Map();
  const dupes = [];
  for (const g of group) {
    if (seen.has(g.parsed.takeNo)) dupes.push(g);
    else seen.set(g.parsed.takeNo, g);
  }
  const members = [...seen.values()];
  const label = groupLabel(parsed);

  const dupe = dupes.find((d) => d.row.id === row.id);
  if (dupe) {
    const first = seen.get(parsed.takeNo).row;
    return { action: "close", leadId: first.id,
      reason: `${JOINED_PREFIX} duplicate of ${label} Take ${parsed.takeNo} (row ${first.id}) — the same take is never sent twice` };
  }

  /* Wait for the angle to settle, so a sibling still uploading is not left out. */
  const newest = Math.max(...members.map((g) => createdMs(g.row)));
  const settleMs = settleMinutes * 60 * 1000;
  if (newest && now - newest < settleMs) {
    const left = Math.ceil((settleMs - (now - newest)) / 60000);
    return { action: "hold", note:
      `join: waiting ${left} more minute(s) for more takes of ${label} (${members.length} so far). ` +
      "A take is only sent once its angle has had no new take for " + settleMinutes + " minutes." };
  }

  /* The lead carries the master: the lowest take number still waiting to go
     to Submagic. Every other waiting take of the angle closes into it. */
  const waiting = members.filter((g) => PRE_SUBMAGIC.includes(g.row.status) && !has(g.row.submagic_project_id));
  const lead = waiting[0] || { row, parsed };
  if (lead.row.id !== row.id) {
    return { action: "close", leadId: lead.row.id,
      reason: `${JOINED_PREFIX} ${label} Take ${parsed.takeNo} goes into the master carried by Take ${lead.parsed.takeNo} (row ${lead.row.id})` };
  }

  if (members.length === 1) {
    return { action: "proceed", note: `join: ${label} has one take (Take ${parsed.takeNo}) — sent as it is, nothing to join` };
  }

  return {
    action: "join",
    parsed,
    lead: lead.row,
    members: members.map((g) => ({ ...g.row, takeNo: g.parsed.takeNo })),
    note: `join: ${members.length} takes of ${label} (Takes ${members.map((g) => g.parsed.takeNo).join(", ")})`
  };
}

function sameAd(a, b) {
  return Boolean(a && b && a.offer === b.offer && a.adNumber === b.adNumber);
}

function settleOrProceed(row, members, { now, settleMinutes, note }) {
  const newest = Math.max(...members.map(createdMs));
  const settleMs = settleMinutes * 60 * 1000;
  if (newest && now - newest < settleMs) {
    const left = Math.ceil((settleMs - (now - newest)) / 60000);
    return { action: "hold", note: `join: waiting ${left} more minute(s) in case more takes land before sending` };
  }
  return { action: "proceed", note };
}

/* ═════════════════════════════════════════════════════════════════════════
   4. SCRIPT — the lines, in order, from the repo's markdown.
   ═════════════════════════════════════════════════════════════════════════ */

const HEADING_RE = /^(#{1,6})\s+(.*?)\s*#*\s*$/;
const AD_HEADING_RE = /^(?:\$\d+\s+)?ad\s+(\d{1,4})\s*[—–-]\s*(.+?)\s*$/i;
const LABEL_RE = /^(?:\*\*[A-Z][A-Z /&-]*\*\*\s*|(?:hook|reasons?|cta|close|body|open|loop|bridge)\s*[.:]\s+)/i;

function isMetaLine(line) {
  if (/^(status|source|shoot|words|notes?|angle|matches|origin_angle)\s*:/i.test(line)) return true;
  if (/^\*\*(shoot|notes?)\*\*/i.test(line)) return true;
  if (/^`[^`]*`$/.test(line)) return true;
  if (/^(-{3,}|\*{3,}|_{3,})$/.test(line)) return true;
  if (/^([-*+]\s|\d+\.\s|\||>)/.test(line)) return true;
  /* "Straight offer. 270 words, about 1:48. Shoot: black tee, …" */
  if (/\b\d+\s+words\b/i.test(line) && (/shoot\s*:/i.test(line) || /\b\d+:\d\d\b/.test(line))) return true;
  return false;
}

function stripMarkdown(s) {
  return String(s)
    .replace(/`([^`]*)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/(^|\s)[*_]([^*_]+)[*_](?=\s|$|[.,!?])/g, "$1$2")
    .replace(/\s+/g, " ")
    .trim();
}

/** Split spoken text into sentences — a "line" is one sentence. */
export function splitSentences(text) {
  return String(text || "")
    .split(/(?<=[.!?])["”')\]]*\s+(?=["“(]?[A-Z0-9$])/)
    .map((s) => s.trim())
    .filter((s) => tokenize(s).length > 0);
}

/**
 * parseScriptMarkdown(text, source) → [{ adNumber, angle, heading, lines, source }]
 *
 * A script is a heading `## AD 7 — angle` / `### $297 Ad 7 — angle` / `## Ad 21 — angle`
 * and the spoken paragraphs under it, up to the next heading. Status, source,
 * shoot and word-count lines, bullets, tables and the HOOK / REASONS / CTA /
 * CLOSE labels are not spoken and are left out.
 */
export function parseScriptMarkdown(text, source = null) {
  const out = [];
  let cur = null;
  let para = [];
  const flush = () => {
    if (cur && para.length) cur.paragraphs.push(para.join(" "));
    para = [];
  };
  const close = () => {
    flush();
    if (cur) {
      const lines = cur.paragraphs.flatMap((p) => splitSentences(p));
      if (lines.length) out.push({ adNumber: cur.adNumber, angle: cur.angle, heading: cur.heading, lines, source });
    }
    cur = null;
  };
  for (const raw of String(text || "").split(/\r?\n/)) {
    const line = raw.trim();
    const h = HEADING_RE.exec(line);
    if (h) {
      close();
      const m = AD_HEADING_RE.exec(stripMarkdown(h[2]));
      if (m) cur = { adNumber: Number(m[1]), angle: m[2].trim(), heading: h[2], paragraphs: [] };
      continue;
    }
    if (!cur) continue;
    if (!line) { flush(); continue; }
    if (isMetaLine(line)) { flush(); continue; }
    const spoken = stripMarkdown(line.replace(LABEL_RE, ""));
    if (spoken) para.push(spoken);
  }
  close();
  return out;
}

/** Does a script heading name this file's angle? Exact words, or the heading
    is the angle plus a longer tail after a comma ("…, 10x your file"). */
export function angleMatches(fileAngle, headingAngle) {
  const a = normalizeAngle(fileAngle);
  const h = normalizeAngle(headingAngle);
  if (!a || !h) return false;
  return h === a || h.startsWith(`${a},`);
}

/** The first script, in source order, for this ad number and angle — or null. */
export function findScript(scripts, { adNumber, angle }) {
  for (const s of scripts || []) {
    if (Number(s.adNumber) === Number(adNumber) && angleMatches(angle, s.angle)) return s;
  }
  return null;
}

/* ═════════════════════════════════════════════════════════════════════════
   5. ALIGN — where in each take each line was said, and how well.
   ═════════════════════════════════════════════════════════════════════════ */

const NUMBER_WORDS = {
  zero: "0", one: "1", two: "2", three: "3", four: "4", five: "5", six: "6", seven: "7",
  eight: "8", nine: "9", ten: "10", eleven: "11", twelve: "12", thirteen: "13",
  fourteen: "14", fifteen: "15", twenty: "20", thirty: "30", fifty: "50", hundred: "100"
};

/** One word, as the aligner compares it. */
export function normToken(word) {
  let s = String(word == null ? "" : word).toLowerCase().replace(/[’‘`]/g, "'");
  s = s.replace(/[^a-z0-9']+/g, "").replace(/^'+|'+$/g, "");
  return NUMBER_WORDS[s] || s;
}

/** Text → the words the aligner compares. Hyphens and slashes split words on
    both sides, so "low-interest" matches whichever way it was transcribed. */
export function tokenize(text) {
  return String(text || "")
    .split(/[\s/—–]+|-(?=\S)/)
    .map(normToken)
    .filter(Boolean);
}

/** A transcript word list → the same shape, with junk dropped. Keeps the
    original index so a cut maps back to real seconds. */
export function normalizeWords(words) {
  const out = [];
  for (const w of words || []) {
    const text = String(w?.word ?? w?.text ?? "").trim();
    if (!text || /^[[(].*[\])]$/.test(text)) continue;          // [BLANK_AUDIO], (music)
    const start = Number(w.start);
    const end = Number(w.end);
    if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
    for (const n of tokenize(text)) out.push({ n, word: text, start, end: Math.max(end, start) });
  }
  return out;
}

function editDistanceAtMostOne(a, b) {
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0, j = 0, edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++edits > 1) return false;
    if (a.length > b.length) i++;
    else if (b.length > a.length) j++;
    else { i++; j++; }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}

/** Close enough to be the same spoken word (plural, -ed, one letter off). */
export function fuzzyEq(a, b) {
  if (a === b) return true;
  if (a.length < 4 || b.length < 4) return false;
  if ((a.startsWith(b) || b.startsWith(a)) && Math.abs(a.length - b.length) <= 2) return true;
  return a.length >= 5 && editDistanceAtMostOne(a, b);
}

/* Scores, doubled so they stay whole numbers. A filler costs half a gap, so an
   "um" in the middle of a line does not break the line in two. */
const S_MATCH = 4, S_FUZZY = 2, S_SUB = -2, S_GAP = -2, S_FILLER = -1;

function localAlign(line, take, mask) {
  const m = line.length;
  const n = take.length;
  const W = n + 1;
  const H = new Int32Array((m + 1) * W);
  const D = new Uint8Array((m + 1) * W);
  let best = 0, bi = 0, bj = 0;
  for (let i = 1; i <= m; i++) {
    const a = line[i - 1];
    for (let j = 1; j <= n; j++) {
      const k = i * W + j;
      if (mask[j - 1]) continue;                                   // a claimed word is a wall
      const b = take[j - 1].n;
      const s = a === b ? S_MATCH : fuzzyEq(a, b) ? S_FUZZY : S_SUB;
      const diag = H[k - W - 1] + s;
      const up = H[k - W] + S_GAP;
      const left = H[k - 1] + (FILLERS.has(b) ? S_FILLER : S_GAP);
      let v = 0, d = 0;
      if (diag > v) { v = diag; d = 1; }
      if (up > v) { v = up; d = 2; }
      if (left > v) { v = left; d = 3; }
      H[k] = v; D[k] = d;
      if (v > best) { best = v; bi = i; bj = j; }
    }
  }
  if (!best) return null;
  const ops = [];
  let i = bi, j = bj;
  while (i > 0 && j > 0 && D[i * W + j]) {
    const d = D[i * W + j];
    if (d === 1) {
      const a = line[i - 1], b = take[j - 1].n;
      ops.push({ type: a === b ? "match" : fuzzyEq(a, b) ? "fuzzy" : "sub", i: i - 1, j: j - 1 });
      i--; j--;
    } else if (d === 2) { ops.push({ type: "del", i: i - 1, j: null }); i--; }
    else { ops.push({ type: "ins", i: null, j: j - 1 }); j--; }
  }
  ops.reverse();
  return { score: best, ops };
}

function sameRun(take, p, q, k) {
  if (q < 0 || q + k > take.length) return false;
  for (let x = 0; x < k; x++) if (take[p + x].n !== take[q + x].n) return false;
  return true;
}

/* Read one alignment into what Chris actually did on that attempt. */
function describeHit(lineIndex, line, take, aligned, opts) {
  const { ops, score } = aligned;
  const paired = ops.filter((o) => o.type !== "del" && o.type !== "ins");
  const firstI = paired.length ? paired[0].i : null;
  const lastI = paired.length ? paired[paired.length - 1].i : null;
  const matched = ops.filter((o) => o.type === "match" || o.type === "fuzzy").length;
  const takeOps = ops.filter((o) => o.j !== null);
  const jStart = takeOps[0].j;
  const jEnd = takeOps[takeOps.length - 1].j;

  /* Inserted words — the take has them, the script does not. Grouped in runs
     so a repeated phrase ("to hop on a, to hop on a call") is seen whole. */
  const remove = new Set();
  let fillers = 0, repeats = 0, stumbles = 0;
  const insJ = takeOps.filter((o) => o.type === "ins").map((o) => o.j);
  for (let x = 0; x < insJ.length;) {
    let y = x;
    while (y + 1 < insJ.length && insJ[y + 1] === insJ[y] + 1) y++;
    const p = insJ[x];
    const k = y - x + 1;
    if (sameRun(take, p, p + k, k) || sameRun(take, p, p - k, k)) {
      repeats += 1;
      for (let q = p; q < p + k; q++) remove.add(q);
    } else {
      for (let q = p; q < p + k; q++) {
        const t = take[q].n;
        const youKnow = t === "you" && take[q + 1]?.n === "know" && insJ.includes(q + 1);
        const knowAfterYou = t === "know" && take[q - 1]?.n === "you" && remove.has(q - 1);
        if (FILLERS.has(t) || SOFT_FILLERS.has(t) || youKnow || knowAfterYou) { fillers += 1; remove.add(q); }
        else stumbles += 1;
      }
    }
    x = y + 1;
  }
  const subs = ops.filter((o) => o.type === "sub").length;
  const dels = ops.filter((o) => o.type === "del").length;
  let pauses = 0;
  for (let q = jStart; q < jEnd; q++) {
    if (take[q + 1].start - take[q].end > opts.longPause) pauses += 1;
  }

  const m = line.length;
  const coverage = matched / m;
  const startSlack = m >= 8 ? 1 : 0;
  const endSlack = m >= 10 ? 1 : 0;
  const complete = m <= 4
    ? (matched === m && firstI === 0 && lastI === m - 1 && subs === 0)
    : (coverage >= opts.completeCoverage && firstI !== null && firstI <= startSlack && lastI >= m - 1 - endSlack);

  return {
    lineIndex, score, ops, jStart, jEnd, matched, coverage, complete, remove,
    firstI, lastI, lineLen: m,
    start: take[jStart].start, end: take[jEnd].end,
    defects: { fillers, repeats, stumbles, subs, dels, pauses },
    defectScore: 3 * dels + 2 * stumbles + 2 * repeats + 2 * fillers + subs + pauses
  };
}

/**
 * findHits(lines, takeWords, opts) → every attempt at every line in one take.
 *
 * Each line is aligned to the take again and again, walling off each attempt
 * it finds, so a line said three times gives three hits. Then the take's words
 * are shared out: complete attempts first, best first, and a word belongs to
 * one attempt only. A false start ("They told you to hop on a—") is a partial
 * hit: it is kept here so it is seen and walled off, and never picked.
 */
export function findHits(lines, takeWords, opts = {}) {
  const o = { ...DEFAULTS, ...opts };
  const take = takeWords;
  const all = [];
  lines.forEach((text, lineIndex) => {
    const line = tokenize(text);
    if (!line.length || !take.length) return;
    const mask = new Uint8Array(take.length);
    for (let attempt = 0; attempt < o.maxAttemptsPerLine; attempt++) {
      const aligned = localAlign(line, take, mask);
      if (!aligned) break;
      const hit = describeHit(lineIndex, line, take, aligned, o);
      const enough = line.length <= 4 ? hit.complete : (hit.matched >= 2 && hit.coverage >= 0.4);
      if (!enough) break;
      all.push(hit);
      for (let q = hit.jStart; q <= hit.jEnd; q++) mask[q] = 1;
    }
  });

  all.sort((a, b) => (Number(b.complete) - Number(a.complete)) || (b.score - a.score) || (a.jStart - b.jStart));
  const claimed = new Uint8Array(take.length);
  const kept = [];
  for (const h of all) {
    let free = true;
    for (let q = h.jStart; q <= h.jEnd; q++) if (claimed[q]) { free = false; break; }
    if (!free) continue;
    for (let q = h.jStart; q <= h.jEnd; q++) claimed[q] = 1;
    kept.push(h);
  }
  for (const h of kept) extendEdges(h, take, claimed, o);
  return kept.sort((a, b) => a.jStart - b.jStart);
}

/* A misheard first or last word is still that word. The aligner starts an
   attempt at its first MATCHING word, so when speech-to-text hears "Getting
   told the call" as "Everything told the call" (measured 2026-10-05), the cut
   would start at "told" and lose the first word. When the script has words
   before the first one heard (or after the last), the attempt takes in that
   many of the take's own neighbouring words — only words no other attempt
   owns, with no pause between, and never a filler. */
function extendEdges(h, take, claimed, o) {
  let lead = h.firstI ?? 0;
  while (lead > 0 && h.jStart > 0 && !claimed[h.jStart - 1] && !FILLERS.has(take[h.jStart - 1].n) &&
    take[h.jStart].start - take[h.jStart - 1].end <= o.maxGap) {
    h.jStart -= 1; claimed[h.jStart] = 1; lead -= 1; h.defects.subs += 1;
  }
  let trail = (h.lineLen ?? 0) - 1 - (h.lastI ?? 0);
  while (trail > 0 && h.jEnd + 1 < take.length && !claimed[h.jEnd + 1] && !FILLERS.has(take[h.jEnd + 1].n) &&
    take[h.jEnd + 1].start - take[h.jEnd].end <= o.maxGap) {
    h.jEnd += 1; claimed[h.jEnd] = 1; trail -= 1; h.defects.subs += 1;
  }
  h.start = take[h.jStart].start;
  h.end = take[h.jEnd].end;
  const d = h.defects;
  h.defectScore = 3 * d.dels + 2 * d.stumbles + 2 * d.repeats + 2 * d.fillers + d.subs + d.pauses;
}

/* ═════════════════════════════════════════════════════════════════════════
   6. PICK — per line, the cleanest complete attempt across every take.
   ═════════════════════════════════════════════════════════════════════════ */

/**
 * planBestOf({ lines, takes: [{ takeNo, id, words }] }) → the plan.
 *
 * For each script line, in script order: only COMPLETE attempts compete (a
 * half sentence is never picked). Fewest defects wins. A tie goes to the take
 * the previous line came from, if this attempt comes after it (fewer jump
 * cuts), then to the lower take number, then to the later attempt (the retry
 * is usually the keeper).
 */
export function planBestOf({ lines = [], takes = [] } = {}, opts = {}) {
  const o = { ...DEFAULTS, ...opts };
  const prepared = takes.map((t, takeIndex) => {
    const words = normalizeWords(t.words);
    return { ...t, takeIndex, norm: words, hits: findHits(lines, words, o) };
  });

  const plan = [];
  let prev = null;
  lines.forEach((text, lineIndex) => {
    const cands = [];
    const partial = [];
    for (const t of prepared) {
      for (const h of t.hits) {
        if (h.lineIndex !== lineIndex) continue;
        (h.complete ? cands : partial).push({ take: t, hit: h });
      }
    }
    cands.sort((a, b) => {
      if (a.hit.defectScore !== b.hit.defectScore) return a.hit.defectScore - b.hit.defectScore;
      const flowA = prev && a.take.takeIndex === prev.take.takeIndex && a.hit.jStart > prev.hit.jEnd ? 0 : 1;
      const flowB = prev && b.take.takeIndex === prev.take.takeIndex && b.hit.jStart > prev.hit.jEnd ? 0 : 1;
      if (flowA !== flowB) return flowA - flowB;
      if (a.take.takeNo !== b.take.takeNo) return Number(a.take.takeNo) - Number(b.take.takeNo);
      return b.hit.jStart - a.hit.jStart;
    });
    const pick = cands[0] || null;
    plan.push({
      lineIndex, text,
      pick: pick ? { takeIndex: pick.take.takeIndex, takeNo: pick.take.takeNo, hit: pick.hit } : null,
      attempts: cands.length,
      falseStarts: partial.length
    });
    if (pick) prev = pick;
  });

  const found = plan.filter((p) => p.pick).length;
  const missing = plan.filter((p) => !p.pick).map((p) => p.lineIndex);
  const ratio = lines.length ? found / lines.length : 0;
  return {
    lines: plan,
    takes: prepared,
    found,
    total: lines.length,
    missing,
    viable: lines.length > 0 && ratio >= o.minScriptCoverage,
    why: lines.length === 0
      ? "the script has no lines"
      : ratio >= o.minScriptCoverage
        ? null
        : `only ${found} of ${lines.length} script lines were said completely in any take ` +
          `(needs ${Math.ceil(o.minScriptCoverage * 100)}%) — these takes do not follow this script`
  };
}

/* ═════════════════════════════════════════════════════════════════════════
   7. CUT — the edit decision list.
   ═════════════════════════════════════════════════════════════════════════ */

/**
 * buildEdl(plan, opts) → [{ takeIndex, takeNo, start, end, lineIndex }]
 *
 * Each picked attempt becomes one or more cuts of its own take:
 *   * filler and repeated words inside it are cut out;
 *   * a pause longer than maxGap inside it is cut down to the two pads;
 *   * it starts padIn before its first word and ends padOut after its last,
 *     so no line opens on dead air or ends on a hanging tail;
 *   * two cuts of the same take that touch become one.
 * Lines that were never said completely are left out (plan.missing says so).
 */
export function buildEdl(plan, opts = {}) {
  const o = { ...DEFAULTS, ...opts };
  const segs = [];
  for (const line of plan.lines) {
    if (!line.pick) continue;
    const take = plan.takes[line.pick.takeIndex];
    const { hit } = line.pick;
    const words = take.norm;
    const dur = Number(take.duration) || Infinity;

    let run = null;
    const runs = [];
    for (let q = hit.jStart; q <= hit.jEnd; q++) {
      if (hit.remove.has(q)) { if (run) { runs.push(run); run = null; } continue; }
      if (run && words[q].start - words[run.last].end > o.maxGap) { runs.push(run); run = null; }
      if (!run) run = { first: q, last: q };
      else run.last = q;
    }
    if (run) runs.push(run);

    for (const r of runs) {
      /* The pads never reach into a word that was cut, nor past the previous
         or next word: cut audio stays cut. */
      const before = r.first > 0 ? words[r.first - 1].end : 0;
      const after = r.last + 1 < words.length ? words[r.last + 1].start : dur;
      const start = Math.max(0, before, words[r.first].start - (segs.length ? o.padIn : o.padFirst));
      const end = Math.min(dur, after, words[r.last].end + o.padOut);
      if (end - start <= 0) continue;
      segs.push({ takeIndex: take.takeIndex, takeNo: take.takeNo, start: round3(start), end: round3(end), lineIndex: line.lineIndex });
    }
  }

  const merged = [];
  for (const s of segs) {
    const p = merged[merged.length - 1];
    if (p && p.takeIndex === s.takeIndex && s.start >= p.start && s.start - p.end <= 0.04) {
      p.end = Math.max(p.end, s.end);
      continue;
    }
    merged.push({ ...s });
  }
  return merged;
}

const round3 = (x) => Math.round(x * 1000) / 1000;

/**
 * refineWordsWithSilence(words, silences) → words whose edges stop at silence.
 *
 * whisper.cpp stretches a word's end into the pause after it (measured
 * 2026-10-05: "call," ran 0.79 s on a 0.3 s word followed by silence). Cutting
 * at that end would keep the dead air the law says to cut. ffmpeg's
 * silencedetect knows where the sound actually stops, so a word that runs into
 * a silence is ended where the silence starts, and one that starts inside a
 * silence is started where it ends.
 */
export function refineWordsWithSilence(words, silences = [], { keep = 0.03, onset = 0.06, lead = 0.15 } = {}) {
  if (!silences?.length) return (words || []).map((w) => ({ ...w }));
  return (words || []).map((w, i, all) => {
    let { start, end } = w;
    /* The first word after a pause starts where the pause ends. A short first
       word ("If") can be aligned up to a third of a second late (measured
       2026-10-05: "If"@58.92 after a pause that ended at 58.56), and a cut
       made there loses it. */
    const prevStart = i > 0 ? Number(all[i - 1].start) : -Infinity;
    const gapBefore = silences.find((s) => s.end <= start && start - s.end <= 0.5 && prevStart < s.start);
    if (gapBefore) start = Math.min(start, gapBefore.end - onset);
    for (const s of silences) {
      if (start >= s.start && start < s.end) {
        /* The word's own time lands INSIDE a silence. An aligned time can be a
           little late or a little early, so it belongs to the nearer edge:
           near the silence's start, it is the last word before the pause
           (measured 2026-10-05: "up."@55.88 against a pause from 55.85 —
           pushing it past the pause stranded it after 1.4 s of air); near its
           end, it is the first word after the pause. */
        if (start - s.start <= s.end - start) {
          end = s.start + keep;
          start = Math.min(start, s.start - lead);
        } else {
          /* A soft first sound ("n", "h") sits under the silence floor, so
             the word starts a little before the measured end of the pause. */
          start = s.end - onset;
        }
      } else if (s.start > start + 0.05 && s.start < end) {
        end = Math.min(end, s.start + keep);
      }
    }
    return { ...w, start: round3(Math.max(0, start)), end: round3(Math.max(end, start + 0.02)) };
  });
}

/**
 * avoidBlack(segments, blackByTake) → the cuts with black frames trimmed off.
 *
 * A camera that starts or stops on black, or a dropped frame, must not land at
 * a join as a black flash. A cut that starts in black starts after it, one
 * that ends in black ends before it, and one that is all black is dropped.
 */
export function avoidBlack(segments, blackByTake = {}, { minSegment = DEFAULTS.minSegment } = {}) {
  const out = [];
  for (const s of segments) {
    let { start, end } = s;
    for (const b of blackByTake[s.takeIndex] || []) {
      if (b.start <= start && b.end > start) start = b.end;
      if (b.start < end && b.end >= end) end = b.start;
    }
    if (end - start >= minSegment) out.push({ ...s, start: round3(start), end: round3(end) });
  }
  return out;
}

/** Plain-language summary of a plan, for the row's note and the report. */
export function summarizePlan(plan, segments) {
  const used = [...new Set(plan.lines.filter((l) => l.pick).map((l) => l.pick.takeNo))].sort((a, b) => a - b);
  const seconds = segments.reduce((t, s) => t + (s.end - s.start), 0);
  const cut = plan.lines.filter((l) => l.pick).reduce((t, l) => {
    const d = l.pick.hit.defects;
    return { fillers: t.fillers + d.fillers, repeats: t.repeats + d.repeats, pauses: t.pauses + d.pauses };
  }, { fillers: 0, repeats: 0, pauses: 0 });
  const parts = [
    `${plan.found} of ${plan.total} lines`,
    `best lines from Takes ${used.join(", ") || "none"}`,
    `${segments.length} cuts`,
    `${seconds.toFixed(1)} s`,
    `cut ${cut.fillers} filler word(s), ${cut.repeats} repeat(s), ${cut.pauses} long pause(s)`
  ];
  if (plan.missing.length) {
    parts.push(`NOT said cleanly in any take, left out: line(s) ${plan.missing.map((i) => i + 1).join(", ")}`);
  }
  return parts.join("; ");
}
