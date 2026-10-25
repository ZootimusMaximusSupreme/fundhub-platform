---
description: How parallel workflows coordinate on a shared board after the split.
alwaysApply: true
---

# Orchestration

The split proposal is section 0. It happens before anything else. This section covers how the workflows behave once running. Law: split-and-proceed (.ai/rules/split-and-proceed.md).

## Rules

* Fan out only on independent units — one workflow per screen or module. Never parallelize steps that depend on each other's output.
* Ground once, fan out. One agent reads shared context and writes a brief. Other agents consume the brief. Never have four agents independently read the same modules.
* Pipeline, don't barrier. Each unit runs ground → build → verify on its own. Do not hold a whole phase for the slowest agent.
* Cap at 5 concurrent agents. Past that: rate limits and merge conflicts, not speed.

## How workflows coordinate

Agents do not message each other. They coordinate through a shared file. That file is the communication layer.

Every multi-workflow batch gets `ops/workflows/<batch-name>.md` containing:

* The task list — every unit, its owner, its status (`pending` / `claimed` / `done` / `blocked`)
* The shared context brief from the ground phase
* Change manifests — files touched, exports added, props changed, routes affected, journeys impacted
* Blockers and open questions

Protocol:

* Claim a task by marking it `claimed` before starting. Never work an unclaimed or already-claimed task.
* Write your manifest to the file when done, before reporting complete.
* Read the file before starting. Another workflow may have already changed something you depend on.
* Verify agents read manifests. They never rediscover changes by re-reading the tree.
* Blocked? Mark it `blocked`, write why, and stop. Do not work around another workflow's unfinished output.

Keep this file human-readable. I use it to see what is happening without opening a single code file.
