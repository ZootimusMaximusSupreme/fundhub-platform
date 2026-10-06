export const meta = {
  name: 'copy',
  description: 'Write the ads and emails, then strip the AI tells mechanically. The humanizer pass is a regex in this script, not an instruction an agent can believe it followed. Stage 4 of the flywheel.',
  whenToUse: 'After the offer. Pass {campaign, today, offerSummary, avatarSummary, languageBank?, burnedOutAngles?, ownerNotes?} as args.',
  phases: [
    { title: 'Angles', detail: 'the dog food exercise - 15 to 20 separate reasons someone buys' },
    { title: 'Write', detail: 'one complete ad per reason, hook body and close all aligned' },
    { title: 'Humanize', detail: 'scan, attack, rewrite, re-scan. Loop until clean or dropped.' },
    { title: 'Verify', detail: 'the Andromeda gate, then promise-vs-terms, voice and sameness' },
  ],
}

// Duplicated on purpose - workflow scripts cannot import anything.
// Date.now(), Math.random() and new Date() all THROW in here.

const A = (typeof args === 'object' && args) || {}
const CAMPAIGN = A.campaign || 'partner'
const TODAY = A.today
if (!TODAY) return { error: 'args.today is required (YYYY-MM-DD). The clock is unavailable inside a workflow.' }

const OFFER = String(A.offerSummary || '')
if (!OFFER) return { error: 'args.offerSummary is required. Copy may not invent an offer.' }
const AVATAR = String(A.avatarSummary || '').slice(0, 7000)
const LANGUAGE_BANK = String(A.languageBank || '').slice(0, 9000)
const BURNED = Array.isArray(A.burnedOutAngles) ? A.burnedOutAngles : []
const OWNER_NOTES = String(A.ownerNotes || '').slice(0, 2000)

// ---------------------------------------------------------------------------
// The ban lists, inlined VERBATIM from ~/.claude/skills/humanizer/SKILL.md.
// Never paraphrase these - the scanner is a literal match and a reworded list
// silently stops catching things. If the skill changes, change this too.
// ---------------------------------------------------------------------------

// 'optimize' came off on 2026-10-05 (marketing/ads/RULES.md Part 0 rule 1:
// "optimize your credit"), the same change as marketing/ads/rules-data.mjs.
// scripts/ads/check-script.test.mjs fails if these three lists and that
// file's lists stop holding the same entries.
const BAN_WORDS = ['delve', 'tapestry', 'leverage', 'utilize', 'robust', 'seamless', 'realm',
  'testament', 'beacon', 'underscore', 'showcase', 'pivotal', 'crucial', 'foster', 'elevate',
  'embark', 'unleash', 'navigate', 'landscape', 'boast', 'myriad', 'plethora', 'intricate',
  'vibrant', 'enhance', 'streamline', 'comprehensive', 'empower', 'holistic',
  'cultivate', 'resonate', 'align', 'nestled']

const BAN_PHRASES = ["in today's fast-paced world", 'when it comes to', "it's important to note",
  'plays a crucial role in', 'at the end of the day', 'the world of', 'more than just',
  'unlock the power of', 'elevate your', 'take it to the next level', 'supercharge',
  'move the needle', 'deep dive', 'low-hanging fruit', 'circle back', 'best-in-class',
  'in conclusion', 'a journey', 'treasure trove', 'the possibilities are endless']

const BAN_OPENERS = ['imagine a world where', 'have you ever wondered', 'picture this',
  'so there you have it', "let's dive in", "here's the thing", "here's the kicker",
  "but here's where it gets interesting", 'let that sink in', 'plot twist', 'trust me']

/**
 * The mechanical humanizer pass. Pure string work, run by the script on every
 * returned piece, so no agent can skip it or report a clean pass it did not earn.
 */
function banScan (text) {
  const hits = []
  if (!text) return hits
  const lower = text.toLowerCase()

  for (const w of BAN_WORDS) {
    if (new RegExp(`\\b${w}(s|d|ed|ing|es)?\\b`, 'i').test(text)) hits.push({ kind: 'word', hit: w })
  }
  for (const p of BAN_PHRASES) if (lower.includes(p)) hits.push({ kind: 'phrase', hit: p })
  for (const o of BAN_OPENERS) if (lower.trimStart().startsWith(o)) hits.push({ kind: 'opener', hit: o })

  if (text.includes('—')) hits.push({ kind: 'shape', hit: 'em dash' })
  if (/\b(it'?s|this is|that'?s) not [^.,;]{1,50}, it'?s /i.test(text)) {
    hits.push({ kind: 'shape', hit: "negative parallelism (it's not X, it's Y)" })
  }
  // Three or more consecutive very short sentences, stacked for drama.
  const sentences = text.split(/(?<=[.!?])\s+/).map(s => s.trim()).filter(Boolean)
  let run = 0
  for (const s of sentences) {
    run = s.split(/\s+/).length <= 4 ? run + 1 : 0
    if (run >= 3) { hits.push({ kind: 'shape', hit: 'stacked staccato fragments' }); break }
  }
  // Sycophantic openers.
  if (/^\s*(great question|absolutely|certainly|i'?d be happy to)/i.test(text)) {
    hits.push({ kind: 'shape', hit: 'sycophancy' })
  }
  // Ending on a rhetorical question after the point is already made.
  if (sentences.length > 2 && /\?\s*$/.test(text.trim())) {
    hits.push({ kind: 'shape', hit: 'ends on a rhetorical question' })
  }
  return hits
}

/** Did the rewrite sand off the concrete detail that made the piece work? */
function keepsSpecifics (text, tokens) {
  if (!tokens.length) return true
  return tokens.some(t => text.toLowerCase().includes(String(t).toLowerCase()))
}

/**
 * Andromeda check, run by the script so no agent can wave it through.
 *
 * Meta's Andromeda algorithm rewards genuinely different MESSAGING, not volume.
 * The failure mode named in the source SOP is one argument said many subtly
 * different ways - "those subtle variances are what is currently fucking
 * people." A shared closing line across every ad is that failure in its purest
 * form, and the first run of this workflow produced exactly it: 20 of 21 CTAs
 * were the same sentence with the verbs swapped.
 *
 * Returns the CTAs that collapse into each other. Compared on content words
 * only, so swapping "book"/"get on"/"grab" does not read as difference.
 */
function ctaCollisions (pieces) {
  const STOP = new Set(['the', 'a', 'an', 'and', 'or', 'to', 'of', 'in', 'on', 'at', 'it', 'is',
    'we', 'you', 'your', 'our', 'us', 'that', 'this', 'with', 'for', 'before', 'after', 'will',
    'can', 'do', 'does', 'get', 'got', 'book', 'grab', 'take', 'see', 'watch', 'read', 'make'])
  const key = t => new Set(String(t || '').toLowerCase().replace(/[^a-z\s]/g, ' ')
    .split(/\s+/).filter(w => w.length > 2 && !STOP.has(w)))
  const overlap = (a, b) => {
    if (!a.size || !b.size) return 0
    let hit = 0
    for (const w of a) if (b.has(w)) hit += 1
    return hit / Math.min(a.size, b.size)
  }
  const keyed = pieces.filter(p => p.cta).map(p => ({ pieceId: p.pieceId, reasonId: p.reasonId, k: key(p.cta) }))
  const collided = new Set()
  for (let i = 0; i < keyed.length; i++) {
    for (let j = i + 1; j < keyed.length; j++) {
      // Two ads built on the same reason may legitimately close alike.
      if (keyed[i].reasonId && keyed[i].reasonId === keyed[j].reasonId) continue
      if (overlap(keyed[i].k, keyed[j].k) >= 0.7) { collided.add(keyed[i].pieceId); collided.add(keyed[j].pieceId) }
    }
  }
  return [...collided]
}

// ---------------------------------------------------------------------------

phase('Angles')
log(`copy for ${CAMPAIGN} as of ${TODAY}`)

const angleSpread = await agent(`Decide the messaging spread BEFORE any copy is written. Deciding
divergence once, deliberately, is what stops twelve writers producing three ideas in twelve hats.

READ THIS FIRST - it decides the whole shape of your answer.

Meta's Andromeda algorithm (fully rolled out ~July 2025) rewards genuinely different MESSAGING,
not creative volume. One argument said many subtly different ways is still ONE argument, and the
source SOP is blunt that those subtle variances are what is currently punishing advertisers. An
account holding steady cost through the rollout did it with FIFTEEN completely unique creatives,
each built around a different reason someone would care.

So you are NOT producing angles to be dressed three ways. You are running the dog food exercise:
write down every SEPARATE REASON a person would buy this, and each reason becomes one complete
ad, filmed end to end, with its hook, body and call to action all built for that one reason.

Two things that do NOT count as different reasons, and will be rejected:
- the same argument restated (a short, mid and long version of one idea is ONE reason)
- the same argument aimed at a different feeling (fear-of-X and desire-for-not-X are ONE reason)

Aim for 15 to 20 distinct reasons. If the offer genuinely only supports fewer, say so and return
what is real rather than padding the list - a padded list is the exact failure this is designed
to prevent.

THE OFFER being sold:
${OFFER.slice(0, 7000)}

THE BUYER:
${AVATAR}

${LANGUAGE_BANK ? `THE MARKET'S OWN WORDS - copy is written from these phrases, not from your own vocabulary. This is owner-set:\n${LANGUAGE_BANK}\n` : ''}
${BURNED.length ? `ANGLES THAT ARE WORN OUT. These are FORBIDDEN. Do not assign any of them:\n${BURNED.map(b => '- ' + (b.angle || b)).join('\n')}\n` : ''}
${OWNER_NOTES ? `CORRECTIONS CHRIS HAS ALREADY MADE - these override everything:\n${OWNER_NOTES}\n` : ''}

For each reason:
- angleId: short kebab-case, reused down the whole chain
- theReason: the reason itself, in the buyer's terms - why THIS person would want this
- audience: "in-market" (already believes this category works, just picking who) or
  "needs-convinced" (believes the outcome is possible, unsure this is the way)
- hookType: one of you-already-know, youre-doing-this-but, circumstance, straight-pain,
  aspirational, urgent
- theSpecificPain: the exact avatar pain or market gap this reason attacks, not a general theme
- whyItIsDifferent: one line naming what this reason has that none of the others do
- ownClosingIdea: how an ad on THIS reason should close. Every reason needs its own ending -
  a shared closing line across the whole set is the single clearest Andromeda failure and the
  script rejects it mechanically.

Lean in-market: they convert cheapest and the offer is already built for them. Mixing the two
messages in one piece is the most common way copy underperforms.`,
  { label: 'reason-spread', phase: 'Angles', effort: 'high',
    schema: { type: 'object', additionalProperties: false, required: ['angles'],
      properties: {
        angles: { type: 'array', items: {
          type: 'object', additionalProperties: false,
          required: ['angleId', 'theReason', 'audience', 'hookType', 'theSpecificPain', 'ownClosingIdea'],
          properties: {
            angleId: { type: 'string' }, theReason: { type: 'string' },
            audience: { type: 'string', enum: ['in-market', 'needs-convinced'] },
            hookType: { type: 'string' }, theSpecificPain: { type: 'string' },
            whyItIsDifferent: { type: 'string' }, ownClosingIdea: { type: 'string' },
          } } },
        fewerThanAskedBecause: { type: 'string' },
      } } })

const angles = ((angleSpread && angleSpread.angles) || []).slice(0, 20)
if (angles.length < 4) return { error: `Only ${angles.length} reasons came back. Too few to write a diverse set from.`, angleSpread }
log(`${angles.length} distinct reasons assigned${angles.length < 15 ? ` - BELOW the Andromeda floor of 15${angleSpread.fewerThanAskedBecause ? `: ${angleSpread.fewerThanAskedBecause}` : ''}` : ''}`)

phase('Write')

const PIECE_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['pieces'],
  properties: {
    pieces: { type: 'array', items: {
      type: 'object', additionalProperties: false,
      required: ['length', 'hook', 'body', 'cta'],
      properties: {
        length: { type: 'string', enum: ['short', 'mid', 'long'] },
        hook: { type: 'string' }, body: { type: 'string' }, cta: { type: 'string' },
      } } },
    emailSubjects: { type: 'array', items: { type: 'string' } },
  },
}

const NO_NEW_FACTS = `HARD RULE: copy may not introduce a single new fact. Every number, result,
testimonial and claim must already appear in the offer document above. If a piece needs a proof
point that is not there, rewrite the piece - do not invent the fact. This is stricter than the
offer stage on purpose: copy is the only thing here a stranger reads.`

// Five at a time, per CLAUDE.md section 5.
const written = []
for (let i = 0; i < angles.length; i += 5) {
  const chunk = angles.slice(i, i + 5)
  const batch = await parallel(chunk.map((a, j) => () => agent(
    `Write ONE complete ad, built end to end around ONE reason someone buys.

This is not a hook to be pasted onto a shared body. Under Meta's Andromeda algorithm, hook,
body and close must all be aligned to your single assigned reason - filming one body and
swapping hooks onto it is the approach that stopped working. Your ad has to be able to stand
completely alone, and it must NOT end the way another ad on a different reason would end.

YOUR REASON (${a.angleId}): ${a.theReason || a.theSpecificPain}
  the pain it attacks: ${a.theSpecificPain}
  audience: ${a.audience}
  hook type: ${a.hookType}
  ${a.whyItIsDifferent ? `what only this reason has: ${a.whyItIsDifferent}` : ''}
  ${a.ownClosingIdea ? `how this one should close: ${a.ownClosingIdea}` : ''}

Write the three lengths as three cuts of THIS one ad - a short, a mid and a long telling of the
same single reason. They are lengths, not different arguments, and they are not diversification.
Diversification came from the assignment you were given.

THE OFFER:
${OFFER.slice(0, 7000)}

THE BUYER:
${AVATAR}

${LANGUAGE_BANK ? `THE MARKET'S OWN WORDS - use these phrases, not your own vocabulary:\n${LANGUAGE_BANK.slice(0, 5000)}\n` : ''}

Structure every piece Hook then Reasons then one CTA:
  short  2-4 lines: call out the pain, introduce the offer, CTA
  mid    5-7 lines: name the belief error, reveal the correction, anchor the offer, CTA
  long   8-12 lines: why most people in this situation stall, establish the offer as the
         blueprint, reframe acting as the smart move rather than the effortful one, CTA

Line breaks between sentences. One CTA, never a menu. Tie the CTA to the payoff, not the click.

YOUR CLOSING LINE MUST BE YOURS. Other agents are writing ads on other reasons right now, and
a generic close - "book the call and we will show you X before you pay" - is what every one of
them would write. The script compares closing lines across the whole set and drops the ones that
collapse into each other. Close on the thing YOUR reason earned, not on the offer's mechanism.

Also give 3 email subject lines for this angle.

Write like a confident founder talking to another founder. No filler. Every sentence earns the
next one. Do not use em dashes. Do not write "it's not X, it's Y".

${NO_NEW_FACTS}`,
    { label: `write-${a.angleId}`, phase: 'Write', schema: PIECE_SCHEMA })))

  batch.filter(Boolean).forEach((r, k) => {
    const a = chunk[k]
    for (const p of (r.pieces || [])) {
      written.push({
        pieceId: `${a.angleId}-${p.length}`.toUpperCase().replace(/[^A-Z0-9-]/g, ''),
        angleId: a.angleId, reasonId: a.angleId, audience: a.audience, hookType: a.hookType,
        length: p.length, hook: p.hook, body: p.body, cta: p.cta,
      })
    }
    ;(r.emailSubjects || []).forEach((s, n) => written.push({
      pieceId: `${a.angleId}-EMAIL${n + 1}`.toUpperCase().replace(/[^A-Z0-9-]/g, ''),
      angleId: a.angleId, reasonId: a.angleId, audience: a.audience, hookType: a.hookType,
      length: 'subject', hook: s, body: '', cta: '',
    }))
  })
  log(`written: ${written.length} pieces so far`)
}

phase('Humanize')

// Concrete tokens the rewrite must not sand off. Voice, not vagueness.
const SPECIFIC_TOKENS = (OFFER.match(/\$[\d,]+|\b\d{2,}%|\b\d+ (?:days?|weeks?|months?)\b/g) || []).slice(0, 12)

const cleaned = []
const dropped = []

for (let i = 0; i < written.length; i += 5) {
  const chunk = written.slice(i, i + 5)
  const results = await parallel(chunk.map(piece => async () => {
    let current = { ...piece }
    let pass = 0
    let hits = banScan([current.hook, current.body, current.cta].filter(Boolean).join('\n\n'))

    while (hits.length && pass < 3) {
      pass += 1
      const full = [current.hook, current.body, current.cta].filter(Boolean).join('\n\n')

      // The attacker handles only what a regex cannot see. One agent per piece:
      // one agent reviewing forty gets lazy by piece twenty.
      const attack = await agent(`Attack this copy for the AI tells a regex cannot catch. The
scanner has already found these, so do NOT repeat them: ${hits.map(h => h.hit).join(', ') || 'none'}

You are looking for:
- rule of three everywhere (three benefits, three adjectives, three of anything, repeatedly)
- every paragraph the same length
- staccato fragments stacked for drama
- ending on a rhetorical question when the point was already made
- anything a real person would not say out loud to another person

THE COPY:
${full}

Report only what you actually found. If it reads human, say so and return an empty list.`,
        { label: `attack-${current.pieceId}-p${pass}`, phase: 'Humanize', effort: 'low',
          schema: { type: 'object', additionalProperties: false, required: ['findings'],
            properties: { findings: { type: 'array', items: { type: 'string' } } } } })

      const rewrite = await agent(`Rewrite this copy to remove every problem listed. Keep the
argument, the offer and the specifics exactly as they are - your job is voice, not vagueness.

MUST STAY IN THE COPY, verbatim: ${SPECIFIC_TOKENS.join(', ') || '(no specific figures in this offer)'}

THE SCANNER FOUND:
${hits.map(h => `- ${h.kind}: ${h.hit}`).join('\n')}

A READER ALSO FOUND:
${((attack && attack.findings) || []).map(f => '- ' + f).join('\n') || '- nothing'}

THE COPY:
${full}

Return the rewritten hook, body and cta separately. Vary sentence length. Real sentences, just
fewer of them - do not answer in clipped fragments to save words.`,
        { label: `rewrite-${current.pieceId}-p${pass}`, phase: 'Humanize',
          schema: { type: 'object', additionalProperties: false, required: ['hook'],
            properties: { hook: { type: 'string' }, body: { type: 'string' }, cta: { type: 'string' } } } })

      if (!rewrite || !rewrite.hook) break
      current = { ...current, hook: rewrite.hook, body: rewrite.body || '', cta: rewrite.cta || '' }
      // Re-scan: a rewrite introduces new violations of its own.
      hits = banScan([current.hook, current.body, current.cta].filter(Boolean).join('\n\n'))
    }

    const finalText = [current.hook, current.body, current.cta].filter(Boolean).join('\n\n')
    current.humanizePasses = pass

    if (hits.length) {
      return { drop: { ...current, violations: hits.map(h => `${h.kind}: ${h.hit}`), reason: `still had AI tells after ${pass} passes` } }
    }
    if (!keepsSpecifics(finalText, SPECIFIC_TOKENS)) {
      return { drop: { ...current, violations: [], reason: 'the rewrite sanded off every concrete number' } }
    }
    return { keep: current }
  }))

  for (const r of results.filter(Boolean)) {
    if (r.keep) cleaned.push(r.keep); else if (r.drop) dropped.push(r.drop)
  }
  log(`humanized ${Math.min(i + 5, written.length)}/${written.length} | clean ${cleaned.length}, dropped ${dropped.length}`)
}

phase('Verify')

// The Andromeda gate. Run by the script BEFORE the review lenses, because a set
// whose ads all close the same way is not a set of ads - it is one ad wearing
// several hats, and Meta now prices it that way. Colliding closes are dropped,
// not flagged, for the same reason a piece that fails banScan three times is
// dropped: shipping it with a warning attached still ships it.
const collided = ctaCollisions(cleaned.filter(p => p.length !== 'subject'))
if (collided.length) {
  const drop = new Set(collided)
  for (let i = cleaned.length - 1; i >= 0; i--) {
    if (drop.has(cleaned[i].pieceId)) {
      dropped.push({ ...cleaned[i], violations: ['andromeda: closing line collides with another reason'], reason: 'its close was interchangeable with an ad on a different reason' })
      cleaned.splice(i, 1)
    }
  }
  log(`ANDROMEDA: dropped ${collided.length} pieces whose closes collided across different reasons`)
}

const distinctReasons = new Set(cleaned.map(p => p.angleId)).size
if (distinctReasons < 15) {
  log(`ANDROMEDA: ${distinctReasons} distinct reasons survived, below the floor of 15. Meta rewards messaging range, and this set is short of it.`)
}

const SET = JSON.stringify(cleaned.map(p => ({ pieceId: p.pieceId, angleId: p.angleId, hook: p.hook, body: p.body, cta: p.cta }))).slice(0, 26000)

const lenses = (await parallel([
  () => agent(`PROMISE VERSUS TERMS. Read the offer, then read every piece of copy. Report any
piece that promises something the offer does not actually deliver, names a term that does not
match, or implies a result the offer never claimed.

THE OFFER:
${OFFER.slice(0, 8000)}

THE COPY:
${SET}`,
    { label: 'verify-promise', phase: 'Verify', effort: 'high',
      schema: { type: 'object', additionalProperties: false, required: ['issues'],
        properties: { issues: { type: 'array', items: { type: 'string' } } } } }),

  () => agent(`HUMAN VOICE. These pieces have all passed a mechanical check, so they break no
rules. Your job is different: which of them are technically clean and still read like ads?
Read each one out loud in your head. Name the pieceIds that a real person would not say, and
say what is wrong with each.

THE COPY:
${SET}`,
    { label: 'verify-voice', phase: 'Verify', effort: 'high',
      schema: { type: 'object', additionalProperties: false, required: ['issues'],
        properties: { issues: { type: 'array', items: { type: 'string' } } } } }),

  () => agent(`SAMENESS. Fan-out promises variety. You are the only thing that checks it.

Across this whole set: is this twenty ads, or three ads wearing twenty hats? Look for near
duplicate hooks, the same sentence structure repeating, the same opening word, the same
rhythm. Name the pieceIds that collapse into each other.

THE COPY:
${SET}`,
    { label: 'verify-sameness', phase: 'Verify', effort: 'high',
      schema: { type: 'object', additionalProperties: false, required: ['issues'],
        properties: { issues: { type: 'array', items: { type: 'string' } }, distinctAngles: { type: 'number' } } } }),
])).filter(Boolean)

const issues = lenses.flatMap(l => l.issues || [])
log(`${cleaned.length} pieces clean, ${dropped.length} dropped, ${issues.length} issues raised`)

const document = await agent(`Write the copy document for ${CAMPAIGN}, as of ${TODAY}.

THE PIECES THAT PASSED (${cleaned.length}):
${SET}

DROPPED (${dropped.length}) - these did not ship:
${JSON.stringify(dropped.map(d => ({ pieceId: d.pieceId, reason: d.reason, violations: d.violations }))).slice(0, 4000)}

ISSUES RAISED BY THE REVIEW LENSES:
${issues.map(i => '- ' + i).join('\n').slice(0, 6000)}

Lay it out so Chris can pick what to run:
1. The three hooks you would run first, and why those three.
2. Every piece, grouped by angle, with its pieceId shown. The pieceId matters - the ad in
   Facebook must be named starting with it, or spend data cannot be matched back later.
3. The email subject lines.
4. What was dropped and why.
5. What the review flagged.

Plain words. Do not rewrite the copy itself - print it as it is.

End with exactly this block, filled in:

## Review card

**What this decided:** <one sentence>

**Three things to check:** Read hook #1 out loud - would you say that? · Does any line promise a credit result or an income number? · Which three hooks do we run?

**What I wasn't sure about:** <or "nothing">

**Say one of:** approve · tweak: <what to change> · redo`,
  { label: 'assemble', phase: 'Verify', effort: 'high' })

return {
  campaign: CAMPAIGN, asOf: TODAY,
  angles, pieces: cleaned, dropped, issues,
  counts: {
    hooks: cleaned.filter(p => p.length !== 'subject').length,
    humanizerPassRun: 1,
    droppedForTells: dropped.length,
    anglesUsed: distinctReasons,
    distinctReasons,
    droppedForCtaCollision: collided.length,
    meetsAndromedaFloor: distinctReasons >= 15 ? 1 : 0,
  },
  document,
}
