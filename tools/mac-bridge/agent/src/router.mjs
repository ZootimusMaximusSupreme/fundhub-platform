// Router: picks Claude or Codex when the phone sends tool "auto".
// Contract: docs/specs/mac-bridge-protocol-v2-tasks.md ("Delegation").
//
// 1. Jev picker, only when switched on (MAC_BRIDGE_JEV=on + JEV_API_KEY). It is a
//    stub today; if switched on it fails and the repo rules pick instead.
// 2. Repo rules: read AGENTS.md, CLAUDE.md and .claude/rules/*.md from the repo and
//    apply only lanes the repo actually writes down. A lane is live only while its
//    sentence is still in a rules file.
// 3. When no rule decides: Claude.
import fs from 'node:fs';
import path from 'node:path';
import { jevEnabled, jevPick } from './jev.mjs';

/**
 * Lanes the repo states today. Add a row here when a rules file adds a lane.
 *
 * Read on 2026-10-20 and deliberately NOT a lane: ".claude/rules/monday-100-percent.md"
 * says "Codex builds, Claude tests" for the Monday 2026-10-19 sweep only. The board
 * (ops/workflows/mac-bridge-2026-10-20.md) records the general lane table as waiting
 * on Chris, so it is not applied here.
 */
export const LANES = [
  {
    id: 'screens-are-claude',
    tool: 'claude',
    // The sentence that must still be in a rules file for this lane to apply.
    anchor: 'Only Claude may change what people see on a screen or on the web',
    match: /\b(?:screens?|pages?|web\s?pages?|websites?|site|landing\s+pages?|sales\s+pages?|funnels?|clickfunnels|html|css|ui|ux|layout|design|buttons?|colou?rs?|fonts?|styles?|styling|dashboards?|front[- ]?end|animations?)\b/i,
    reason: (file) => `It is screen or website work. Repo rule: only Claude changes screens (${file}).`,
  },
];

/** Read the repo rules files. Missing files are skipped. Returns [{ file, text }]. */
export function readRuleFiles(repo) {
  const out = [];
  const add = (rel) => {
    try {
      out.push({ file: rel, text: fs.readFileSync(path.join(repo, rel), 'utf8') });
    } catch {}
  };
  add('AGENTS.md');
  add('CLAUDE.md');
  let names = [];
  try {
    names = fs.readdirSync(path.join(repo, '.claude', 'rules')).filter((n) => n.endsWith('.md')).sort();
  } catch {}
  for (const n of names) add(path.join('.claude', 'rules', n));
  return out;
}

/** Pick by repo rules only. Returns { tool, pickedBy: "rules", pickReason }. */
export function pickByRules(prompt, { repo, lanes = LANES } = {}) {
  const files = readRuleFiles(repo);
  for (const lane of lanes) {
    const src = files.find((f) => f.text.includes(lane.anchor));
    if (!src) continue; // the repo no longer states this lane
    if (lane.match.test(String(prompt))) {
      return { tool: lane.tool, pickedBy: 'rules', pickReason: lane.reason(src.file) };
    }
  }
  return {
    tool: 'claude',
    pickedBy: 'rules',
    pickReason: 'No repo rule picks a tool for this task, so it goes to Claude (the default).',
  };
}

/** router.pick(prompt): Jev when on, else repo rules. */
export async function pick(prompt, { repo, env = process.env, lanes } = {}) {
  if (jevEnabled(env)) {
    try {
      const j = await jevPick(prompt, { env });
      if (j && (j.tool === 'claude' || j.tool === 'codex')) {
        return { tool: j.tool, pickedBy: 'jev', pickReason: String(j.reason || 'Jev picked it.') };
      }
    } catch (e) {
      const r = pickByRules(prompt, { repo, lanes });
      return { ...r, pickReason: `Jev is switched on but could not run (${e.message}). ${r.pickReason}` };
    }
  }
  return pickByRules(prompt, { repo, lanes });
}
