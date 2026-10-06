#!/usr/bin/env node
// The flywheel staleness gate.
//
// Each stage file records which version of its inputs it was built from. This
// compares those recorded hashes against the files as they are now and says, in
// plain English, which stages can no longer be trusted.
//
// It is the only thing standing between a tweaked stage 2 and four downstream
// files quietly built on the old one. It is mechanical on purpose: no agent can
// forget to run it, and no agent's opinion is involved.
//
//   node scripts/flywheel/status.mjs [campaign]        report, always exits 0
//   node scripts/flywheel/status.mjs [campaign] --gate 3   exit 1 if stage 3 cannot start
//
// No dependencies. Front matter is parsed by a deliberately dumb line reader
// rather than a YAML library, because the shape is fixed and known.

import { createHash } from 'node:crypto'
import { readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

// ---------------------------------------------------------------------------
// The contract. One row per stage.
//
// `inputs` are the handoff files this stage is built from. `optionalInputs` may
// be absent without blocking - stage 2 improves when it has the avatar but does
// not require it, which is what lets stages 1 and 2 run at the same time.
//
// `gates` are minimum counts taken from the workflow's own return value, not
// from a regex over prose. They exist because this has already gone wrong once:
// a real avatar run returned New_Information.md with zero verified findings and
// the run carried on regardless.
// ---------------------------------------------------------------------------

export const STAGES = [
  {
    n: 1, key: 'avatar', file: '01-avatar.md', label: 'avatar',
    inputs: [], optionalInputs: [],
    gates: { quotes: 20, languageEntries: 100 },
  },
  {
    n: 2, key: 'ad-research', file: '02-ad-research.md', label: 'ad research',
    inputs: [], optionalInputs: ['01-avatar.md'],
    gates: { rowsVerified: 8, competitorsFound: 3 },
    ratioGates: [{ of: 'rowsWithFirstSeen', atLeastHalfOf: 'rowsVerified' }],
  },
  {
    n: 3, key: 'offer', file: '03-offer.md', label: 'offer',
    inputs: ['01-avatar.md', '02-ad-research.md'], optionalInputs: [],
    gates: { priceSet: 1, bonuses: 3, valueEquationScores: 4, guarantees: 2 },
  },
  {
    n: 4, key: 'copy', file: '04-copy.md', label: 'copy',
    // Two inputs, not one. COPY-DIRECTIVES.md is owner-set and requires copy be
    // written from the market's own recurring phrases, so the language bank is
    // a first-class input and a change to it makes the copy stale.
    inputs: ['03-offer.md', '01-avatar/Market_Language_Bank.md'], optionalInputs: [],
    // 15 distinct REASONS is Meta's Andromeda floor - one argument restated many
    // ways is still one argument, and the algorithm prices it as such.
    gates: { hooks: 5, humanizerPassRun: 1, distinctReasons: 15 },
  },
  {
    n: 5, key: 'ad-strategy', file: '05-ad-strategy.md', label: 'ad strategy',
    inputs: ['03-offer.md', '04-copy.md'], optionalInputs: [],
    gates: { strategyNamed: 1, dailyBudgetStated: 1 },
  },
  {
    n: 6, key: 'spend', file: '06-spend.md', label: 'spend',
    inputs: ['04-copy.md', '05-ad-strategy.md'], optionalInputs: [],
    gates: {},
  },
]

const PLACEHOLDERS = ['TODO', 'TBD', 'XXX', '[placeholder]', 'Lorem ipsum']

// ---------------------------------------------------------------------------

/**
 * Split a stage file into its front matter block and its body.
 *
 * The body is everything after the closing `---`. That boundary is load-bearing:
 * hashes cover the BODY ONLY, so flipping `status: draft` to `status: approved`
 * does not change the hash and therefore does not mark every downstream stage
 * stale. Approving a file must never invalidate anything.
 */
export function splitFrontMatter (text) {
  if (!text.startsWith('---')) return { frontMatter: '', body: text }
  const end = text.indexOf('\n---', 3)
  if (end === -1) return { frontMatter: '', body: text }
  const afterClose = text.indexOf('\n', end + 1)
  return {
    frontMatter: text.slice(text.indexOf('\n') + 1, end + 1),
    body: afterClose === -1 ? '' : text.slice(afterClose + 1),
  }
}

/** First 8 hex characters of the sha256 of a stage file's body. */
export function bodyHash (text) {
  return createHash('sha256').update(splitFrontMatter(text).body, 'utf8').digest('hex').slice(0, 8)
}

/**
 * Parse the fixed front-matter shape: top-level `key: value`, plus two-space
 * indented entries under `inputs:` and `counts:`. Not YAML, and not trying to be.
 */
export function parseFrontMatter (fm) {
  const out = { inputs: {}, counts: {} }
  let section = null
  for (const raw of fm.split('\n')) {
    if (!raw.trim() || raw.trim().startsWith('#')) continue
    const indented = /^\s{2,}\S/.test(raw)
    const m = raw.match(/^\s*([^:]+):\s*(.*)$/)
    if (!m) continue
    const key = m[1].trim()
    const value = m[2].trim()
    if (!indented) {
      if (key === 'inputs' || key === 'counts') { section = key; continue }
      section = null
      out[key] = /^-?\d+$/.test(value) ? Number(value) : value
    } else if (section) {
      out[section][key] = /^-?\d+$/.test(value) ? Number(value) : value
    }
  }
  return out
}

function readStage (read, file) {
  const text = read(file)
  if (text == null) return null
  const { frontMatter, body } = splitFrontMatter(text)
  return { path: file, text, body, meta: parseFrontMatter(frontMatter) }
}

/** A reader over one campaign folder on disk: file name -> text, or null. */
export function diskReader (dir) {
  return (file) => {
    const path = join(dir, file)
    return existsSync(path) ? readFileSync(path, 'utf8') : null
  }
}

/**
 * The same states as evaluate(dir), over any reader: `read(file)` returns the
 * file's text or null when it is not there. The Command Center reads the stage
 * files from GitHub with the dashboard's pending saves on top
 * (src/marketing/flywheel/reader.mjs) and decides with exactly these rules.
 */
export function evaluateFiles (read) {
  return evaluateWith(read)
}

/**
 * Work out the state of every stage.
 *
 * MISSING  - the file is not there.
 * STALE    - an input's body hash no longer matches what this file recorded.
 * BLOCKED  - an upstream stage is missing or stale, so this one cannot be
 *            trusted even when its own hashes still match.
 * FAILED   - the file exists and is current but does not clear its own gates.
 * READY    - good.
 */
export function evaluate (dir) {
  return evaluateWith(diskReader(dir))
}

function evaluateWith (read) {
  const rows = []
  for (const stage of STAGES) {
    const loaded = readStage(read, stage.file)
    const row = { ...stage, state: 'READY', reasons: [], meta: loaded ? loaded.meta : null }

    if (!loaded) {
      row.state = 'MISSING'
      row.reasons.push('has not been run yet')
      rows.push(row)
      continue
    }

    // Inputs: required ones must exist and match; optional ones only matter if present.
    for (const input of [...stage.inputs, ...stage.optionalInputs]) {
      const required = stage.inputs.includes(input)
      const inputText = read(input)
      if (inputText == null) {
        if (required) { row.state = 'BLOCKED'; row.reasons.push(`${input} is missing`) }
        continue
      }
      const recorded = loaded.meta.inputs[input]
      if (recorded === undefined) {
        if (required) { row.state = 'STALE'; row.reasons.push(`was built without recording ${input}`) }
        continue
      }
      const actual = bodyHash(inputText)
      if (actual !== recorded) {
        row.state = 'STALE'
        const src = STAGES.find(s => s.file === input)
        row.reasons.push(src ? `built on the old ${src.label}` : `${input} changed since this was built`)
      }
    }

    // Gates. Only meaningful once the file is otherwise current.
    if (row.state === 'READY') {
      for (const [key, min] of Object.entries(stage.gates)) {
        const got = loaded.meta.counts[key]
        if (typeof got !== 'number') {
          row.state = 'FAILED'; row.reasons.push(`did not report ${key}`)
        } else if (got < min) {
          row.state = 'FAILED'
          if (key === 'guarantees') {
            row.reasons.push(`only ${got} guarantee${got === 1 ? '' : 's'} — an offer needs a stack of at least ${min}`)
          } else if (key === 'distinctReasons') {
            row.reasons.push(`${got} distinct reasons, below Meta's Andromeda floor of ${min}`)
          } else {
            row.reasons.push(`${key} is ${got}, needs at least ${min}`)
          }
        }
      }
      for (const rg of stage.ratioGates || []) {
        const a = loaded.meta.counts[rg.of]
        const b = loaded.meta.counts[rg.atLeastHalfOf]
        if (typeof a === 'number' && typeof b === 'number' && a < b / 2) {
          row.state = 'FAILED'
          row.reasons.push(`only ${a} of ${b} ${rg.atLeastHalfOf} have a ${rg.of.replace(/^rowsWith/, '').toLowerCase()} date`)
        }
      }
      if (!loaded.text.includes('## Review card')) {
        row.state = 'FAILED'; row.reasons.push('has no review card')
      }
      const found = PLACEHOLDERS.filter(p => loaded.body.includes(p))
      if (found.length) {
        row.state = 'FAILED'; row.reasons.push(`still contains ${found.join(', ')}`)
      }
    }

    rows.push(row)
  }

  // Propagate: a stage sitting on a broken upstream stage is blocked, whatever
  // its own hashes say. Runs in order so the block cascades all the way down.
  for (const row of rows) {
    const bad = row.inputs
      .map(f => rows.find(r => r.file === f))
      .filter(r => r && r.state !== 'READY' && r.state !== 'APPROVED')
    if (bad.length && row.state === 'READY') {
      row.state = 'BLOCKED'
      row.reasons.push(`waiting on ${bad.map(b => b.label).join(' and ')}`)
    }
  }

  return rows
}

function summary (row) {
  if (!row.meta) return ''
  const c = row.meta.counts || {}
  if (row.n === 1 && c.quotes) return `${c.quotes} quotes`
  if (row.n === 2 && c.rowsVerified) return `${c.rowsVerified} ads`
  if (row.n === 3 && c.bonuses) return `price set, ${c.bonuses} bonuses`
  if (row.n === 4 && c.hooks) return `${c.hooks} hooks`
  if (row.n === 5 && c.strategyNamed) return 'strategy chosen'
  return ''
}

export function render (rows, campaign) {
  const lines = [``, `Flywheel: ${campaign}`, ``]
  for (const row of rows) {
    const state = row.state === 'READY'
      ? (row.meta && row.meta.status === 'approved' ? 'ready       approved' : 'ready       not reviewed')
      : row.state
    const why = row.state === 'READY' ? summary(row) : row.reasons.join('; ')
    lines.push(`  ${row.n} ${row.label.padEnd(14)} ${state.padEnd(22)} ${why}`)
  }
  const broken = rows.filter(r => r.state === 'STALE' || r.state === 'FAILED')
  lines.push('')
  if (broken.length) {
    lines.push(`${broken.length} stage${broken.length > 1 ? 's' : ''} need${broken.length > 1 ? '' : 's'} re-running. Do them in order: ${broken.map(b => b.n).join(', then ')}.`)
  } else if (rows.every(r => r.state === 'READY')) {
    lines.push('Every stage is current.')
  } else {
    const next = rows.find(r => r.state === 'MISSING')
    if (next) lines.push(`Next to run: stage ${next.n}, ${next.label}.`)
  }
  lines.push('')
  return lines.join('\n')
}

// ---------------------------------------------------------------------------

function main (argv) {
  const args = argv.slice(2)
  const gateIdx = args.indexOf('--gate')
  const gate = gateIdx === -1 ? null : Number(args[gateIdx + 1])
  const campaign = args.find(a => !a.startsWith('--') && a !== String(gate)) || 'partner'
  const dir = join(REPO, 'marketing', 'flywheel', campaign)

  if (!existsSync(dir)) {
    process.stdout.write(`\nNo flywheel at marketing/flywheel/${campaign}. Nothing has been run yet.\n\n`)
    return gate ? 1 : 0
  }

  const rows = evaluate(dir)
  process.stdout.write(render(rows, campaign))

  if (gate) {
    // Can stage `gate` safely start? Only if every required input is READY.
    const stage = STAGES.find(s => s.n === gate)
    if (!stage) { process.stdout.write(`No stage ${gate}.\n`); return 1 }
    const blockers = stage.inputs
      .map(f => rows.find(r => r.file === f))
      .filter(r => !r || r.state !== 'READY')
    if (blockers.length) {
      process.stdout.write(`Stage ${gate} cannot start: ${blockers.map(b => b ? `${b.label} is ${b.state.toLowerCase()}` : 'an input is missing').join(', ')}.\n\n`)
      return 1
    }
    process.stdout.write(`Stage ${gate} is clear to run.\n\n`)
  }
  return 0
}

// Plain mode always exits 0 so it never trips the repo's Stop hook.
if (import.meta.url === `file://${process.argv[1]}`) {
  process.exit(main(process.argv))
}
