// Which message templates exist only because a SQL file inserts them (finish-853, batch 22).
//
// A build-time reader. It tokenizes the SQL seed and migration files and lists every template key that an
// "INSERT INTO message_templates" statement writes, with the channel and whether the seed marked it approved.
// The live check (fin-b22-flow-live.mjs) reads the saved list (fin-b22-sql-template-keys.json), never the
// SQL files, because the live bundle does not carry repo files. fin-b22-flow-live.test.mjs regenerates the
// list from the files and fails when the saved list is stale, so a new seed cannot slip past the check.
//
// Tokens understood: 'text' with '' escapes, $tag$text$tag$, words, numbers, punctuation, -- and /* */ comments.

import fs from "node:fs";
import path from "node:path";

export function tokenize(sql) {
  const toks = [];
  let i = 0;
  const n = sql.length;
  while (i < n) {
    const c = sql[i];
    if (/\s/.test(c)) { i += 1; continue; }
    if (c === "-" && sql[i + 1] === "-") { while (i < n && sql[i] !== "\n") i += 1; continue; }
    if (c === "/" && sql[i + 1] === "*") { const e = sql.indexOf("*/", i + 2); i = e < 0 ? n : e + 2; continue; }
    if (c === "'") {
      let j = i + 1;
      let s = "";
      while (j < n) {
        if (sql[j] === "'") {
          if (sql[j + 1] === "'") { s += "'"; j += 2; continue; }
          break;
        }
        s += sql[j];
        j += 1;
      }
      toks.push({ t: "str", v: s });
      i = j + 1;
      continue;
    }
    if (c === "$") {
      const m = /^\$([A-Za-z_0-9]*)\$/.exec(sql.slice(i, i + 40));
      if (m) {
        const e = sql.indexOf(m[0], i + m[0].length);
        if (e >= 0) {
          toks.push({ t: "str", v: sql.slice(i + m[0].length, e) });
          i = e + m[0].length;
          continue;
        }
      }
    }
    if (/[A-Za-z_]/.test(c)) {
      let j = i;
      while (j < n && /[A-Za-z0-9_.]/.test(sql[j])) j += 1;
      toks.push({ t: "word", v: sql.slice(i, j) });
      i = j;
      continue;
    }
    if (/[0-9]/.test(c)) {
      let j = i;
      while (j < n && /[0-9.]/.test(sql[j])) j += 1;
      toks.push({ t: "num", v: sql.slice(i, j) });
      i = j;
      continue;
    }
    toks.push({ t: "p", v: c });
    i += 1;
  }
  return toks;
}

const KEY_RE = /^[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)+$|^[A-Z]{2,}[0-9]+$/;
const isWord = (tok, value) => tok && tok.t === "word" && tok.v.toLowerCase() === value;

/** One entry per INSERT INTO message_templates statement: its keys, its channel words and its approved flag. */
export function templateStatements(sql, file = "") {
  const toks = tokenize(sql);
  const out = [];
  for (let i = 0; i < toks.length; i += 1) {
    if (!(isWord(toks[i], "insert") && isWord(toks[i + 1], "into") && toks[i + 2] && toks[i + 2].v === "message_templates")) continue;
    let j = i;
    while (j < toks.length && !(toks[j].t === "p" && toks[j].v === ";")) j += 1;
    const stmt = toks.slice(i, j);
    const keys = [];
    for (let k = 0; k < stmt.length; k += 1) {
      const tok = stmt[k];
      if (tok.t !== "str") continue;
      const afterOrgId = k >= 2 && stmt[k - 1].t === "p" && stmt[k - 1].v === "," && stmt[k - 2].t === "word" && stmt[k - 2].v === "o.id";
      if (KEY_RE.test(tok.v) || (afterOrgId && /^[A-Za-z][A-Za-z0-9_-]+$/.test(tok.v))) keys.push(tok.v);
    }
    // the approved flag: the true or false word that sits right before FROM (the SELECT form) or at the end
    let flag = null;
    for (let k = 0; k < stmt.length; k += 1) {
      if (isWord(stmt[k], "true") || isWord(stmt[k], "false")) {
        const next = stmt[k + 1];
        if (!next || isWord(next, "from") || (next.t === "p" && next.v === ")")) flag = stmt[k].v.toLowerCase() === "true";
      }
    }
    const channels = stmt.filter((x) => x.t === "str" && (x.v === "sms" || x.v === "email")).map((x) => x.v);
    out.push({ file, keys, channels, approved: flag, doNothing: stmt.some((x, k) => isWord(x, "do") && isWord(stmt[k + 1], "nothing")) });
    i = j;
  }
  return out;
}

function channelFor(key, channels) {
  if (key.startsWith("SMS-")) return "sms";
  if (key.startsWith("EMAIL-")) return "email";
  return channels[0] || null;
}

/**
 * The saved list: every key a SQL file writes that the doc source does not also carry.
 * @param {string} root repo root
 * @param {Set<string>} docKeys keys the two source docs carry (the doc seeder owns these)
 */
export function sqlOnlyTemplateKeys(root, docKeys) {
  const found = new Map();
  for (const dir of ["db/seed", "db/migrations"]) {
    const full = path.join(root, dir);
    for (const name of fs.readdirSync(full).filter((n) => n.endsWith(".sql")).sort()) {
      const file = `${dir}/${name}`;
      const text = fs.readFileSync(path.join(full, name), "utf8");
      if (!/INSERT\s+INTO\s+message_templates/i.test(text)) continue;
      for (const st of templateStatements(text, file)) {
        for (const key of st.keys) {
          const prior = found.get(key) || { key, channel: null, approvedBySeed: true, files: [] };
          prior.channel = prior.channel || channelFor(key, st.channels);
          // approved only when every statement that writes the key marks it approved
          if (st.approved !== true) prior.approvedBySeed = false;
          if (!prior.files.includes(file)) prior.files.push(file);
          found.set(key, prior);
        }
      }
    }
  }
  return [...found.values()]
    .filter((row) => !docKeys.has(row.key))
    .sort((a, b) => (a.key < b.key ? -1 : 1));
}
