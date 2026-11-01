# Readability Modules

Keep measurement and rewriting separate.

## Complexity Grader

Use this module to measure readability without editing the copy.

### Source counting rules

1. Count words. Treat contractions, hyphenated words, abbreviations, figures, symbols, and combinations of these as one word each.
2. Count syllables as normally pronounced. Treat abbreviations, figures, symbols, and combinations as one syllable. If a word has two accepted pronunciations, use the one with fewer syllables; use a dictionary when unsure.
3. Count full units of speech as sentences. A period, colon, semicolon, question mark, exclamation point, or dash may end a unit, but do not count punctuation mechanically. Ignore paragraph breaks and punctuation occurring inside a continuing sentence.
4. Calculate average syllables per word: total syllables / total words.
5. Calculate average words per sentence: total words / total sentences.

Use a reliable Flesch Reading Ease calculation for the score and disclose the implementation or tool used. Report counts and limitations when automated tokenization or syllable estimation could differ from human counting.

### Source score bands

| Score | Approximate reading level |
|---:|---|
| 0-30 | College graduate |
| 30-50 | College |
| 50-60 | Grades 10-12 |
| 60-70 | Grades 8-9 |
| 70-80 | Grade 7 |
| 80-90 | Grade 6 |
| 90-100 | Grade 5 |

Higher is easier. Do not rewrite unless requested.

## Clarity and rhythm editing

Repair the thought's arrangement before replacing its words. Work selectively:

1. Put the core action or point where readers can grasp it before interruptions and qualifications. Move necessary detail close to what it modifies.
2. Make sentence relationships clear: cause, contrast, sequence, condition, or example. Use connectors where helpful; not every sentence needs an explicit conjunction.
3. Replace ambiguous pronouns with the actual referent. Repetition is better than an elegant synonym that changes meaning or loses the subject.
4. Unload a crowded sentence by grouping related ideas, ordering steps, or splitting it. Keep a longer sentence when its clauses remain easy to follow.
5. Resolve double meanings, missing words, vague referents, and misplaced modifiers. Add words when necessary for clarity.
6. Develop one paragraph focus before changing it. Paragraph breaks can also provide emphasis and breathing room; do not impose a fixed sentence count.
7. Vary length and structure. Short sentences can emphasize or slow the reader; constant fragments can become monotonous.
8. Sharpen memorable lines with contrast, parallel structure, concrete imagery, or a strong ending when they reinforce the point. Do not decorate every sentence.
9. Reread as someone without the writer's background knowledge. Preserve conditions, uncertainty, causality, and important distinctions.

### Worked repairs (illustrative, not customer evidence)

- Ambiguous: "Maya sent Lena the draft after she changed the opening." If Maya made the change: "After changing the opening, Maya sent the draft to Lena." If the actor is unknown, ask or flag the ambiguity rather than guessing.
- Buried action: "You can, after you upload the file and select a format, download the result." → "Upload the file, select a format, then download the result." Use only if those steps and their order are supplied facts.
- Harmful shortening: "It may reduce preparation time for teams using the template" must not become "It saves every team time." Preserve the condition and uncertainty.
- Empty bridge: "The file is editable. Here's the thing: export it as a PDF." If these are instructions, make the relation explicit: "Make your changes in the editable file, then export a PDF." Do not invent missing product functionality.

Cashvertising's numerical sentence/word guides are historical heuristics, not acceptance criteria. Optimize immediate understanding and natural rhythm rather than an 11-word average, a monosyllable percentage, or a fixed paragraph length. Measure only when requested.
