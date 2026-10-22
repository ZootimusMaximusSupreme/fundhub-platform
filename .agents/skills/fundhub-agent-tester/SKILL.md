---
name: fundhub-agent-tester
description: >-
  Roleplay plus prompt fulfillment for a live FundHub AI agent. Two AIs talk —
  one is the live agent (its real prompt), one is the client — then score
  whether the agent did what the prompt said and whether events ran in intended
  journey order. Use when Chris says agent test, roleplay the AI, did the agent
  follow its prompt, prompt fulfillment, or talk-sequence check. Not a
  read-only desk audit (that is fundhub-auditor). Not Full End-To-End Audit.
---

# Fundhub Agent Tester

Two AIs talk. One is the live FundHub agent (its real prompt). One is the client.
You score whether the agent fulfilled its prompt and the intended journey.
That is real validation. A desk glance is not.

**Not this skill:** `fundhub-auditor` (read-only desk / journey glance). Full
End-To-End Audit (send + walk every live path). Fixer (named repair).

You do not fix the agent in the same pass. Score. Write the board. Stop.

## Hard rules

- Read `docs/journeys/<name>-intended.md` before the talk. Correct order comes from that file, not memory.
- Load the live agent prompt from Agent Editor / `src/agents` — do not invent the script.
- Roleplay the full event sequence (not one hello).
- Score PASS only if the agent did what the prompt said AND events fired in intended order.
- One 8-second or 0.1s Bland call is FAIL for “call sequence.”
- Do not ask Chris to listen. Do not charge cards. Do not live CRS. Do not paper mail.
- Plus-tag sims only. Agent phone +16616054248. Never his personal prove phone.
- After a named fix: run the roleplay twice.

## Load the script (never invent it)

1. Pick the named live agent (code + name). If Chris did not name one, pick the one this thread already touched. Do not mint a new agent.
2. Read the Agent Editor row: `agents.prompt` for that `code` (via `src/agents/registry.mjs` `byCode`, or `GET /api/read/agents` / Agent Editor). That string is the script.
3. If the live row is empty or not ready, say so. A vendor fallback (`vendor/inquiry-remover/src/agents/*.js`) may be what production actually dials (Josh does this in `src/workflows/ai-set-01-josh-setter.mjs`). Load that file only as the **fallback the code uses**, and write `source: vendor_prompt` on the board. Do not paste a script from memory.
4. Read `src/agents` for how this agent is selected, triggered, and sent (`runtime.mjs`, `select.mjs`, the workflow that fires it). Trigger order is code + intended journey, not a guess.

Common map (still read the intended file — do not skip it):

| Agent | Code | Intended journey |
|---|---|---|
| Setter Josh | `AG-04` | `docs/journeys/client-intended.md` |
| Inquiry Removal AI | `AG-09` | `docs/journeys/role-inquiry-remover-intended.md` |
| Doc-chase / Document Check | `GHL-DOC` / `AG-06` / `f-02-doc-chase` | `docs/journeys/client-intended.md` |

If the intended file has **no talk or event sequence** for this agent, journey-sequence is **UNVERIFIED**. Overall cannot be PASS. Write that gap. Do not invent steps to make a green score.

## Before the talk

Copy this list and check it:

```
- [ ] Intended journey read
- [ ] Ordered events copied from that file (verbatim)
- [ ] Live prompt loaded (source named)
- [ ] Sim identity ready (plus-tag + agent phone only)
- [ ] Client AI briefed on the event list only
```

Sim identity:

- Email: plus-tag only (`+sim-…@` or `e2e+…@`)
- Phone: `+16616054248` only
- Never Chris’s personal prove phone
- Never a real client’s file

Fill prompt `{{placeholders}}` from the sim’s survey / file only. Skip empty. Never invent credit, dollars, or docs.

## Roleplay

Two seats. Do not mix them.

**Agent seat.** System = the live prompt, word for word. Same model path the product uses (`src/agents/model.mjs` `callModel`). No extra coaching. No “remember to hit every beat.”

**Client seat.** A second model (or a second `callModel` with a **client** system). The client walks the intended event list, one event at a time. Answers like a real person. Does not remind the agent what to say.

Run the **full** event sequence. One hello is not a run.

Stop when the intended list is done, or the agent ends the call / thread for a reason the prompt allows (reschedule-and-end, opt-out, client hang-up).

Do **not** place a live Bland call to “prove” talk. If a live Bland call already happened and it lasted 8 seconds or 0.1s, that row is FAIL for call sequence. Do not ask Chris to listen.

Do not send extra SMS. Do not charge a card. Do not live CRS. Do not paper mail.

## Score

Per turn:

| Turn | Event (from intended) | Agent said (short) | Prompt required | Prompt | Sequence |
|---|---|---|---|---|---|
| 1 | … | … | … | PASS/FAIL | PASS/FAIL |

- **Prompt PASS** = this turn did what the live prompt said (job, order, guardrails). Quote the prompt line you checked.
- **Sequence PASS** = this event is the next one in the intended file. Skip, swap, or invent = FAIL.
- A greeting-only run with later beats missing = FAIL.
- Agent quotes a pre-approval, pulled credit, or a dollar the prompt forbids = FAIL.
- Agent asks Chris to listen, or you score a hang-up as a full call = FAIL.

Overall **PASS** only if every required turn is Prompt PASS **and** Sequence PASS.

Otherwise overall **FAIL**. Partial greens do not become done.

After a **named fix**: run this whole roleplay **twice**. One run is not enough.

## Board

Write `ops/workflows/agent-tester-YYYY-MM-DD.md` (add `-2` if the date file exists).

Must include:

- Agent code, name, prompt source (`ag-XX` / `vendor_prompt` / empty)
- Intended file path
- Ordered events copied from that file
- Sim email (plus-tag) and agent phone
- Per-turn PASS/FAIL table
- One line: did the sequence match the intended journey? yes / no / UNVERIFIED
- Overall PASS or FAIL
- Left undone

Do not claim done in chat if the board is overall FAIL.

## Never

- Invent the script
- Score from memory of the journey
- Audit the Specialist desk and call it an agent test
- Fix the prompt or the workflow in the same pass
- Use a real client, a real card, live CRS, or paper mail
- Call a 8s / 0.1s Bland dial a talk-sequence PASS
