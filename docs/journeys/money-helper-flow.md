# FinanceOS Money Helper — flow

FinanceOS wave 5, unit W6 (`ops/workflows/finance-os-wave5-2026-10-06.md`). Spec:
`docs/finance/client-finance-os-build-spec-2026-09-19.md` §6. Owner (2026-10-06): "Really set
up the AI agent… so we can role-play and see it work simulated." "AI tells you exactly what to
do; press Do task to assign actions to AI agents."

The agent is `agents` row **FOS-01** (migration 465), status **shadow**: it answers in the app
and never texts. It thinks through the shared model client (`callModel`,
`src/agents/model.mjs`) — Claude Code on Chris's Mac today, the API later, same code.

Code: `src/finance/money-agent-ai.mjs` (the brain and its checks), `src/finance/money-helper.mjs`
(turns, routing, writes), `src/finance/money-agent-tasks.mjs` (W5's Do-task rows),
`src/finance/money-helper-runner.mjs` + `scripts/money-agent-run-queue.mjs` (the Mac runner),
`api/money/helper.mjs`, `public/app/money-helper.js`.

## One message

```mermaid
flowchart TD
    M[Client types a message] --> C{What did they say?}
    C -->|STOP| S[Rules: one fixed answer<br/>SMS opt-out via recordOptOut<br/>helper stopped]
    C -->|a lawyer| L[Rules: one fixed answer<br/>CSM task, helper stopped]
    C -->|a person| P[Rules: askForPerson — one CSM task a day]
    C -->|a bank's decline letter| DL[Read it: FACTS.decline_analysis<br/>letter masked; the bank's notices<br/>are not the client's words<br/>see 'A pasted bank decline']
    DL --> R
    C -->|anything else| R{MONEY_HELPER_RUNNER}
    R -->|rules| RB[Rules brain answers now]
    R -->|server| AI[AI answers inside the request]
    R -->|mac, default| B{Mac runner heartbeat fresh?}
    B -->|no| RB
    B -->|yes| Q[Turn queued — Thinking…]
    Q --> MAC[Mac runner claims it<br/>callModel routed to claude -p]
    MAC --> AI
    AI --> V{Answer passes every check?}
    V -->|yes| DONE[Reply + checked actions written<br/>brain = ai]
    V -->|no| BLOCK[Blocked: rules brain answers<br/>blocked text to agent_shadow_log]
    V -->|no model reached| RB
    RB --> DONER[Reply written, brain = rules, reason says why]
```

Every answered turn also writes the text it **would have texted** to `agent_shadow_log`
(reason `shadow_status`, or `guardrail_halt` for STOP / a lawyer, `guardrail_block` for a
blocked AI answer) and one row to `agent_runs`. Nothing is texted while FOS-01 is shadow.

A turn left queued when the Mac stops is answered by rules on the client's next read
(`answerOrphans`), so nobody waits on a computer that is off.

## The checks an AI answer must pass (`validateAnswer`)

- Actions only from the closed set: `create_reminder`, `create_csm_task`,
  `mark_task_in_progress`, `schedule_pin`, `propose_transfer`, `record_decline`, `no_action`;
  every field checked against the client's own records.
- Every number in the reply is in the facts it was handed or in the client's own words.
- No promised outcome; never "I moved your money"; UnderwriteIQ only word for word.
- A transfer is a **proposal** (W5's `proposeTransfer`, a `money_agent_tasks` row at
  `needs_approval`) and the reply says it needs the client's approval.
- A client who says they cannot pay gets a CSM task (once per chat).
- An answer that talks about a lesson it was handed names that lesson's doc
  (`From: <doc>.`); no answer names Net 30 accounts, DUNS, D&B or Nav without saying they are
  not part of the client's Fundhub plan (`topicReplyProblems`, see "A question about a money topic").

## A question about a money topic (Finance OS wave 4, unit ED)

Owner order (Chris, 2026-11-07, `ops/workflows/finance-os-wave4-brief.txt`): give the helper an
education source drawn from Fundhub's own material, for ChexSystems, opening accounts, seasoning,
card use, inquiries, business credit and gas cards, with short answers that cite the doc they come
from. Code: `src/finance/money-education.mjs` (the lessons, pure), wired in
`src/finance/money-agent-ai.mjs`; the screen's buttons in `public/app/money-helper.js`.

```mermaid
flowchart TD
    Q[Client asks, or taps a Learn the basics button] --> T{matchTopics: does the question<br/>name a lesson? at most two}
    T -->|no, or a task press, a pasted letter,<br/>or a question about a decline in this chat| OLD[Answered exactly as before]
    T -->|yes| F[FACTS.topic_guidance: each lesson's words<br/>and its from_line, no ids, no file paths]
    F --> R{Who answers}
    R -->|rules brain, intent question| RB[The lesson's own words,<br/>then From: doc on its own line]
    R -->|AI| AI[The prompt adds a LESSONS note:<br/>answer from it, end with its from_line]
    AI --> V{Talks about a lesson it was handed<br/>without its From line? Names Net 30,<br/>DUNS, D&B or Nav without saying not part<br/>of your Fundhub plan?}
    V -->|yes| BL[Blocked: the rules brain answers with the lesson]
    V -->|no| OK[AI answer used]
```

- **Where the words come from.** Each lesson rests on lines from the repo: the Blueprint's own
  lessons (`src/blueprint/preparation-guidance.mjs`), Chris's lesson talk tracks
  (`marketing/slideshows/talk/card-paydown.txt`, `apply-yourself.txt`, `business-one-two.txt`),
  `docs/finance/file-protection-alerts.md`, the bank book (`docs/legacy-strong/lenders-legacy-strong.csv`)
  and `docs/journeys/capital-blueprint-intended.md` R12. `src/finance/money-education.test.mjs` opens
  each file and finds the backing words in it. Owner calls on the board are kept with their date.
- **What the client reads.** "From: Blueprint lessons.", "From: Card Paydown lesson.", "From: Applying
  On Your Own lesson.", "From: Business One, Two lesson.", "From: Fundhub bank book." or "From: Capital
  Blueprint plan." on its own small line under the answer. A ChexSystems answer also gets one
  "Open chexsystems.com" button whose address is fixed in the screen's code.
- **Numbers.** A lesson's numbers (30, 60 and 90 days, 10%) are in FACTS only on a turn that carries
  that lesson, so the helper may say them there and nowhere else.
- **Not changed.** The agent row's prompt (migrations 465 and 468, word for word), the decline path,
  STOP / a lawyer / a person, a task press, and every answer to a question about the client's own money.
  No route, no migration, no new table.

## A pasted bank decline (Capital Blueprint launch, unit B1b, migration 468)

Owner, 2026-10-06: "The decline defense is something I can just copy into the agent. If they get
declined, they copy it and it determines what the reason could be, then finds the reconsideration
steps an agent can take as a process." Contract of the reading: `docs/finance/decline-defense.md`
(the `analyze_decline` TOOL, `src/blueprint/decline-analyze.mjs`). The helper's half is
`src/finance/money-decline.mjs`.

```mermaid
flowchart TD
    P[Client pastes a bank's letter or email] --> D{A decline?<br/>long enough, application wording,<br/>decline-analyze reads it as a decline<br/>with a reason-shaped signal}
    D -->|no: a short 'Chase declined me', a store decline,<br/>an approval, a request for papers| N[Answered as any message.<br/>The prompt says: do not guess why,<br/>ask them to paste the whole letter]
    D -->|yes| M[Letter masked the way decline-analyze masks it<br/>stored masked, with its line breaks]
    M --> F[FACTS.decline_analysis: reasons with the bank's words,<br/>steps in order with who and source,<br/>what to fix first, timing, the bank's phone]
    F --> A[The AI says it, or the rules brain does]
    A --> V{Checks}
    V -->|a phone the letter did not give · a quote nobody wrote ·<br/>a reason not found · a promise about the bank| BL[Blocked — the rules brain answers<br/>from decline_analysis alone]
    V -->|ok| W{record_decline?}
    W -->|not a paid Capital Blueprint buyer| X[Explain the reasons and the steps they can<br/>take on their own, one line about the Blueprint team.<br/>Nothing saved]
    W -->|paid buyer, bank and product in the letter,<br/>letter not yet saved| S[recordDecline — the Blueprint screen's own paste path:<br/>one decline per letter, its plan, one ops task]
```

What the helper may and may not do with it:

- **Detection is conservative.** Never a guess on a short message. A card declined at a store, an
  approval, a counteroffer and a request for papers are not pastes.
- **The client's numbers stay masked** in the prompt, in FACTS, in what the thread keeps, in the
  shadow log and in the saved decline. The reply cannot say a number the letter hid.
- **The bank's notices are not the client.** A bank email ends in "unsubscribe" and "opt out" lines
  and sometimes names an Attorney General. STOP, a lawyer and "a person" are read from the client's
  own short first paragraph only. A STOP above the letter still stops the helper.
- **Only what `decline_analysis` says.** No phone number the bank's letter did not give (a credit
  bureau's number is not the bank's), no words in quotation marks that nobody wrote, no reason the
  reader did not find, no promise about the bank ("the bank will approve", "they have to reconsider").
  A line no source covers stays a blank for a person.
- **`record_decline` is code-checked:** `decline_analysis` in FACTS, a paid Capital Blueprint buyer
  (`isCapitalBlueprintBuyer`; unknown counts as not a buyer), the bank and product written in the
  letter, the letter not already saved in this chat. `recordDecline` checks the buyer again, caps a
  client's pastes at 5 a day, masks again, and answers a repeat as a duplicate. The saved text is the
  client's masked paste, never the model's words.
- **Follow-ups keep the analysis.** "What should I fix first?" a message later is answered from the
  same letter (read again from the earlier message); a saved letter is not saved twice.
- **A longer message is allowed for a letter only.** A chat message stays under 2000 characters; a
  pasted decline may run to the reader's cap (20000, `MAX_PASTE_CHARS`). Migration 468 widens the turn
  table's input check to match.

Role-play: persona (g) in `src/finance/money-agent-sim.mjs`, scored for the reasons said, the steps in
order, no invented phone, and a save only for a buyer (`--buyer=yes|no`, `--prompt=code`).

For the screen (not built here): `public/app/money-helper.js` caps the box at 2000 characters
(`MAX_CHARS`) and names no word for the new action (`ACT_WORD` has no `record_decline`).

## A turn

```mermaid
stateDiagram-v2
    [*] --> queued: message while the Mac runner is on
    [*] --> running: message answered now (rules, server, or a STOP/lawyer/person)
    queued --> running: Mac runner claims it (FOR UPDATE SKIP LOCKED)
    queued --> running: Mac off for 20 s — answered by rules on the next read
    running --> answered: reply + actions written
    running --> halted: STOP or a lawyer — the helper stops for this client
    running --> failed: the client's records could not be read
    running --> queued: runner stopped (Ctrl-C) or went quiet 10 min with tries left
    answered --> [*]
    halted --> [*]
    failed --> [*]
```

## A "Do task" row (W5's queue, migration 464)

```mermaid
flowchart LR
    W5[Do task on W5's list] -->|payment| PROP[proposeTransfer → needs_approval<br/>waits on the client]
    W5 -->|person step| CSM[CSM task, W5]
    W5 -->|agent, no money| Q[queued]
    Q --> CL[Mac runner claims it — claimed]
    CL --> T[A 'task' turn on the helper thread]
    T -->|helper did its part, a step is still the client's| IP[stays claimed — in progress]
    T -->|finished| D[done + task_done in money_agent_log]
    T -->|helper off / stopped / no answer| F[failed + task_failed, plain words]
    APP[approved money row] -.->|only W7's engine, not wired here| ENG[sent by W7]
```

W6 never claims an approved money row without W7's engine and never moves money.

## Where it shows

- The chat: `/app/money-helper.html` (section `FinanceOS.sections.helper`). Above the box to type
  in, "Learn the basics" holds seven topic buttons; each one sends its question (none show when
  the helper is stopped or off).
- Reminders and plan steps: the Plan, through plan source `agent`
  (`src/finance/plan-sources/agent.mjs`, registered by the orchestrator).
- The daily ladder (`src/finance/money-agent.mjs`) holds its texts for a client who stopped the
  chat helper, and uses the AI brain only when `MONEY_HELPER_RUNNER=server`.

## Not covered by an intended journey

No `*-intended.md` describes the money helper chat. The role-play
(`npm run money:roleplay`) scores spec §6 and the agent's own prompt; its sequence check is
**UNVERIFIED** until Chris writes one.
