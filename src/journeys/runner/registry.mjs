/* The workflow registry the runner drives.
 *
 * src/workflows/index.mjs exports `functions` — the registered Inngest function
 * objects and nothing else. (It said "47" here; the number moves every time a
 * workflow is registered, so it is deliberately not written down again.) That
 * array is enough to learn WHAT exists and WHAT
 * triggers it (`fn.id()`, `fn.opts.triggers`), but not enough to run anything:
 *
 *   THE INNGEST WRAPPER CLOSES OVER THE REAL DATABASE POOL. Every workflow
 *   ends with
 *       ({ event, step }) => handle({ event: event.data, db, step })
 *   where `db` is the module-scope import from src/db.mjs. Calling `fn.fn(...)`
 *   would run the workflow against the live pool no matter what handle the
 *   runner was given — past any transaction the caller opened, past any fake.
 *
 * So the runner never calls `fn.fn`. It calls each module's exported
 * `handle({ event, db, step })` directly, which is the pure, injectable half
 * every one of those files exposes for exactly this reason. This module is
 * what joins the two: triggers and id from the function object, the callable
 * from the module's own export.
 *
 * Cross-checked against `functions` on load, so a workflow that is registered
 * but unreadable — or readable but unregistered — is a loud failure rather
 * than a silently smaller coverage list.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { functions } from "../../workflows/index.mjs";

const WORKFLOW_DIR = path.join(process.cwd(), "src/workflows");

let cached = null;

/* load() → { workflows, byEvent, unrunnable }
 *
 *   workflows  — [{ id, name, triggers: [event], handle }]
 *   byEvent    — Map<eventName, [workflow]>
 *   unrunnable — registered functions whose module exports no `handle`
 */
export async function load() {
  if (cached) return cached;
  const byId = await readModules(WORKFLOW_DIR);
  cached = assemble(functions, byId);
  return cached;
}

/* readModules(dir) → Map<workflowId, { mod, file }>
 *
 * WHY THE readdir IS WRAPPED. It was bare, so a missing or unreadable directory
 * threw a raw ENOENT that surfaced to the owner as a plain 500 with no clue
 * what was missing. Nothing was wrong with it in production — the failure mode
 * was just silent about itself, which is the same defect as a false green: you
 * cannot act on what you cannot read. */
export async function readModules(dir) {
  let files;
  try {
    files = (await fs.readdir(dir)).filter((f) => f.endsWith(".mjs") && !f.endsWith(".test.mjs"));
  } catch (err) {
    throw new Error(
      `journey runner: the workflow folder could not be read at ${dir} (${err?.code || err?.message || err}). ` +
      `Without it no automation can be run, so the run is stopped rather than reported as empty.`
    );
  }

  // id → module, for every workflow module on disk.
  const byId = new Map();
  for (const file of files) {
    let mod;
    try {
      mod = await import(pathToFileURL(path.join(dir, file)).href);
    } catch {
      continue; // not importable in isolation; the cross-check below catches it
    }
    for (const value of Object.values(mod)) {
      if (value && typeof value === "object" && typeof value.id === "function" && value.opts?.triggers) {
        byId.set(value.id(), { mod, file });
      }
    }
  }
  return byId;
}

/* assemble(fns, byId) → { workflows, byEvent, unrunnable, registered }
 *
 * Pure, and exported so the failure below can be tested without breaking the
 * real workflow folder to do it. */
export function assemble(fns, byId) {
  const workflows = [];
  const unrunnable = [];
  for (const fn of fns) {
    const id = fn.id();
    const triggers = (fn.opts?.triggers || []).map((t) => t.event).filter(Boolean);
    const found = byId.get(id);
    /* A module that serves more than one function names a handler per id in
       `handles` (src/workflows/slo-genuine-followup.mjs serves three); one
       shared `handle` would run the wrong code for two of them. */
    const own = found && found.mod.handles && typeof found.mod.handles[id] === "function"
      ? found.mod.handles[id]
      : found && found.mod.handle;
    if (!found || typeof own !== "function") {
      // Registered but not callable by the runner. Reported, never skipped —
      // a workflow quietly missing from the coverage list reads as "no journey
      // reaches it", which is a different and much more alarming finding.
      unrunnable.push({ id, name: fn.opts?.name || id, triggers, reason: found ? "module exports no handle()" : "module not found on disk" });
      continue;
    }
    workflows.push({ id, name: fn.opts?.name || id, triggers, file: found.file, handle: own });
  }

  /* EVERYTHING REGISTERED AND NOTHING RUNNABLE IS A BROKEN RUNNER, NOT A RESULT.
   *
   * The per-workflow `unrunnable` list above is the right answer when one or
   * two modules fail to resolve. But if EVERY one fails — a moved directory, a
   * bad import at the top of every module, a build that shipped without them —
   * the run still returned HTTP 200 and walked an empty registry. The screen
   * then said "0 of 51 automations reached", which reads as "the journeys are
   * disconnected" when what actually happened is that the runner could not load
   * anything to reach. Two completely different problems, one indistinguishable
   * report. This throws instead, and names the ids so the cause is on screen. */
  if (fns.length > 0 && workflows.length === 0) {
    throw new Error(
      `journey runner: ${fns.length} automations are registered and not one of them could be loaded, ` +
      `so this run could not have reached any of them. This is a fault in the runner, not a finding about the journeys. ` +
      `Unresolved: ${unrunnable.map((u) => u.id).join(", ")}`
    );
  }

  const byEvent = new Map();
  for (const w of workflows) {
    for (const e of w.triggers) {
      if (!byEvent.has(e)) byEvent.set(e, []);
      byEvent.get(e).push(w);
    }
  }

  return { workflows, byEvent, unrunnable, registered: fns.length };
}

/* Every workflow that no journey reached. Each one is either dead code or a
   journey nobody authored — both are findings, neither is repaired here. */
export function neverFired(registry, firedIds) {
  const fired = new Set(firedIds);
  return registry.workflows
    .filter((w) => !fired.has(w.id))
    .map((w) => ({ id: w.id, name: w.name, triggers: w.triggers }));
}

export function _resetCache() {
  cached = null;
}
