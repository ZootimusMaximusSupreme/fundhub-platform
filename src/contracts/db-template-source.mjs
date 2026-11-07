// src/contracts/db-template-source.mjs — read the contract copy out of db/*.sql.
//
// WHY A GUARD READS FILES RATHER THAN A DATABASE. Every *.pg.test.mjs skips when
// DATABASE_URL is unset, and a guard that skips is not a guard — the same
// reasoning src/contracts/offer-fee-language.test.mjs and
// src/subscriptions/partner-subscriptions.test.mjs both record. The SQL under
// db/ is what every environment is built from, so it is the honest source for
// "what do the contracts actually say", and it is readable with no database
// anywhere in sight.
//
// READ IN db/migrate.mjs's OWN ORDER — schema, then migrations, then seed, each
// sorted by filename — so a later file superseding an earlier one is exactly
// what a later entry here does. That ordering is the whole reason
// 273_repair_fee_charged_once.sql can correct 169's wording without editing it
// (editing an applied migration is a silent no-op, CLAUDE.md §12).
//
// WHAT IT UNDERSTANDS. Only the shapes db/ actually uses to write contract
// copy: an INSERT whose body is a run of E'…' literals concatenated with ||, an
// UPDATE of the same shape, and a body-text patch — an UPDATE whose body is
// `replace(body, 'old', 'new')` with plain literals, guarded by
// `strpos(body, '…') > 0` (592_partner_license_30k.sql). The patch is applied to
// the body read so far, only when its guard still matches, the way Postgres runs
// it. It is not a SQL parser and must not grow into one; a statement it cannot
// read returns null for that part and the previous definition survives, which
// is visible rather than silently wrong because the callers assert the body
// parsed.
//
// KNOWN DUPLICATE, recorded rather than left to be discovered:
// src/contracts/offer-fee-language.test.mjs carries its own private copy of this
// reader, written before this module existed. The two are the same code. Fold
// that file onto this module the next time it is opened for another reason —
// not as a drive-by (CLAUDE.md §8), and not while several workflows are editing
// around it.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { normaliseManualFields } from "./render.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

/** Full-line `--` comments only. A trailing one would need a string-aware
 *  scanner, and db/ has none inside these statements. */
const stripComments = (sql) =>
  sql.split("\n").filter((line) => !/^\s*--/.test(line)).join("\n");

/** Decode what Postgres' E'…' escape-string syntax means, for the parts db/
 *  actually uses: \n, \t, \\ and a doubled quote. */
function decodeEscapeLiteral(raw) {
  return raw
    .replace(/''/g, "'")
    .replace(/\\n/g, "\n")
    .replace(/\\t/g, "\t")
    .replace(/\\\\/g, "\\");
}

/** Every E'…' literal in a statement, concatenated. In db/ these are only ever
 *  used for a template body, so the concatenation IS the body. */
export function bodyFrom(block) {
  const parts = [];
  for (let i = 0; i < block.length; i++) {
    const isStart =
      (block[i] === "E" || block[i] === "e") &&
      block[i + 1] === "'" &&
      !/[\w.]/.test(block[i - 1] || "");
    if (!isStart) continue;
    let j = i + 2;
    let buf = "";
    while (j < block.length) {
      const c = block[j];
      if (c === "\\") { buf += c + (block[j + 1] ?? ""); j += 2; continue; }
      if (c === "'") {
        if (block[j + 1] === "'") { buf += "''"; j += 2; continue; }
        break;
      }
      buf += c;
      j++;
    }
    parts.push(decodeEscapeLiteral(buf));
    i = j;
  }
  return parts.length ? parts.join("") : null;
}

/** The manual_fields array — the only '[ … ]'::jsonb literal in a statement. */
export function fieldsFrom(block) {
  const m = [...block.matchAll(/'(\[[\s\S]*?\])'\s*::\s*jsonb/g)].pop();
  if (!m) return null;
  return normaliseManualFields(JSON.parse(m[1].replace(/''/g, "'")));
}

/** A body-text patch: `SET body = replace(body, 'old', 'new')`, nested
 *  replace(replace(body, …), …) too, as [old, new] pairs. Only the SET clause is
 *  read, so a literal in the WHERE guard is never taken for a replacement. null
 *  when the statement is not that shape. */
export function bodyReplacementsFrom(block) {
  const set = block.match(/\bSET\s+body\s*=\s*((?:replace\(\s*)+body\s*,[\s\S]*?)(?=,\s*updated_at\b|\s+WHERE\b)/i);
  if (!set) return null;
  const pairs = [...set[1].matchAll(/'((?:[^']|'')*)'\s*,\s*'((?:[^']|'')*)'/g)]
    .map(([, before, after]) => [before.replace(/''/g, "'"), after.replace(/''/g, "'")]);
  return pairs.length ? pairs : null;
}

/** The guard `strpos(body, 'text') > 0`: the UPDATE only touches a body that
 *  still holds that text. null when the statement has no such guard. */
export function bodyGuardFrom(block) {
  const m = block.match(/\bWHERE\b[\s\S]*?\bstrpos\(\s*body\s*,\s*'((?:[^']|'')*)'\s*\)\s*>\s*0/i);
  return m ? m[1].replace(/''/g, "'") : null;
}

/** Which template a statement is about. */
export function keyFrom(block) {
  const insert = block.match(/VALUES\s*\(\s*v_org\s*,\s*'([A-Z0-9][A-Z0-9-]*)'/);
  if (insert) return insert[1];
  const update = block.match(/\bWHERE\b[\s\S]*?\btemplate_key\s*=\s*'([A-Z0-9][A-Z0-9-]*)'/);
  return update ? update[1] : null;
}

/**
 * Every contract template db/ defines, as the last word on it wins.
 *
 * @param {string} [root] repository root; defaults to this file's own repo.
 * @returns {Map<string, {body: string|null, fields: any[]|null, block: string,
 *                        sources: string[]}>}
 */
export function readContractTemplatesFromDb(root = ROOT) {
  /** @type {Map<string, {body: string|null, fields: any[]|null, block: string, sources: string[]}>} */
  const out = new Map();
  for (const dir of ["schema", "migrations", "seed"]) {
    const full = path.join(root, "db", dir);
    if (!fs.existsSync(full)) continue;
    for (const name of fs.readdirSync(full).filter((f) => f.endsWith(".sql")).sort()) {
      const sql = fs.readFileSync(path.join(full, name), "utf8");
      if (!/contract_templates/.test(sql)) continue;
      const blocks = stripComments(sql)
        .split(/(?=INSERT INTO contract_templates|UPDATE contract_templates)/)
        .filter((b) => /^(INSERT INTO|UPDATE) contract_templates/.test(b.trim()));
      for (const block of blocks) {
        const key = keyFrom(block);
        if (!key) continue;
        const prev = out.get(key) || { body: null, fields: null, block: "", sources: [] };
        const body = bodyFrom(block);
        const patch = body === null ? bodyReplacementsFrom(block) : null;
        if (patch) {
          /* A body-text patch writes no other column, so the statement that
             wrote the row stays its block. Like the UPDATE itself, it changes
             nothing when the guard text is gone (a second run, or copy
             somebody rewrote on the Contracts screen). */
          const guard = bodyGuardFrom(block);
          const applies = prev.body !== null && (guard === null || prev.body.includes(guard));
          out.set(key, {
            body: applies ? patch.reduce((text, [from, to]) => text.split(from).join(to), prev.body) : prev.body,
            fields: prev.fields,
            block: prev.block,
            sources: [...prev.sources, `${dir}/${name}`]
          });
          continue;
        }
        const fields = fieldsFrom(block);
        out.set(key, {
          body: body ?? prev.body,
          fields: fields ?? prev.fields,
          block,
          sources: [...prev.sources, `${dir}/${name}`]
        });
      }
    }
  }
  return out;
}
