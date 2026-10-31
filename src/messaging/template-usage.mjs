/* What is using a message template — the check that stops the editor breaking a
 * live message.
 *
 * A template is referenced from two directions, and they are NOT the same kind
 * of reference:
 *
 *   WORKFLOW CODE — a file in src/workflows names the key as a string, exactly.
 *     `const EMAIL_TEMPLATE_KEY = "EMAIL-F03-ROUND-SUBMITTED"`. This is the one
 *     that really sends. If the key stops matching a row, sendTemplated finds
 *     nothing and returns { sent: false, reason: "template_pending" } — a silent
 *     no-op. The client simply never hears from us and nothing reports an error.
 *
 *   JOURNEY STEPS — a step in the `journeys` table carries a short nickname,
 *     `["Template", "S-01"]`, which src/journeys/runner/diff.mjs resolves by
 *     fuzzy substring. Journeys are a picture of the plan; nothing executes
 *     them, so breaking one of these breaks the health report rather than a
 *     send. It is still a break, and the editor still refuses it — a report that
 *     has gone quietly wrong is how a real gap survives for months.
 *
 * READ-ONLY ON JOURNEYS, ABSOLUTELY. This module reads the journeys table and
 * mirrors diff.mjs's matching rule. It does not import from src/journeys, does
 * not write there, and does not attempt to fix the two known problems with that
 * matching (the fuzzy substring, and the single-brace inline copy the editor
 * stores alongside each step). Both are real and both are separate tickets, by
 * owner decision 2026-08-01.
 */

import { listWorkflowFiles, findTemplateKeyRefs, REPO_ROOT } from "./seed/workflow-audit.mjs";
import { baseKeyOf } from "./experiments.mjs";
import fs from "node:fs";
import path from "node:path";

/* MIRRORS src/journeys/runner/diff.mjs:45. Copied rather than imported because
   diff.mjs does not export it and this module must not reach into the journey
   runner's internals — journeys are read-only from here, including their code.
   If diff.mjs's rule changes, this copy has to change with it, or the editor
   will refuse renames the report would have tolerated (or worse, allow ones it
   will not). */
const norm = (s) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const squash = (s) => norm(s).replace(/\s+/g, "");

/* The workflow scan walks the tree and reads every file, so it is cached for the
   life of the process. A template list is 176 rows and the scan is the same for
   all of them; doing it per row turned one screen open into 176 tree walks.
   Keyed by root so a test passing a fixture directory does not poison the cache
   for the real one. */
const scanCache = new Map();

/** scanWorkflowRefs — every template key named anywhere in workflow/handler/api
    code, mapped to the places that name it. */
export function scanWorkflowRefs(root = REPO_ROOT, { fresh = false } = {}) {
  if (!fresh && scanCache.has(root)) return scanCache.get(root);
  const byKey = new Map();
  for (const rel of listWorkflowFiles(root)) {
    let source;
    try {
      source = fs.readFileSync(path.join(root, rel), "utf8");
    } catch {
      // A file that vanished between listing and reading is not this module's
      // problem to report; skipping it is right. It cannot cause a FALSE
      // "nothing uses this" for a key, only a missing line number for a key
      // some other file also names.
      continue;
    }
    for (const { key, line } of findTemplateKeyRefs(source)) {
      if (!byKey.has(key)) byKey.set(key, []);
      byKey.get(key).push({ file: rel, line });
    }
  }
  scanCache.set(root, byKey);
  return byKey;
}

/* journeyRefsFor — which journey steps point at this template key.

   `journeyRows` are rows from the `journeys` table: { key, name, nodes }. The
   node tree nests — a condition step carries branches, each holding more steps —
   so this walks it the same way the editor does.

   THE MATCH IS THE JOURNEY'S RULE, NOT OURS. diff.mjs squashes the step's
   nickname ("S-01" -> "s01") and asks whether the template key contains it. So
   "S-01" matches SMS-S01-SURVEY and also, uncomfortably, anything else with s01
   in it. We reproduce that exactly. Being stricter here would let the editor
   approve a rename that then breaks the report; being looser would block
   renames for no reason. */
export function journeyRefsFor(templateKey, journeyRows = []) {
  const haystack = squash(templateKey);
  if (!haystack) return [];
  const hits = [];

  const walk = (nodes, journey, trail) => {
    for (const node of nodes || []) {
      const here = [...trail, node.title || node.type || "step"];
      for (const [category, label] of node.touches || []) {
        if (category !== "Template") continue;
        const needle = squash(label);
        if (needle && haystack.includes(needle)) {
          hits.push({
            journeyKey: journey.key,
            journeyName: journey.name || journey.key,
            label,
            step: node.title || node.type || "step",
            path: here.join(" › ")
          });
        }
      }
      for (const branch of node.branches || []) walk(branch.nodes, journey, [...here, branch.label]);
    }
  };

  for (const j of journeyRows) walk(j.nodes, j, []);
  return hits;
}

/** workflowRefsFor — the code references for one key. A version B of a tested message
    (src/messaging/experiments.mjs, key + "-B") is never named in code; the workflow names
    its base key and the sender picks B. So B is used by whatever uses its base key. */
export function workflowRefsFor(templateKey, { root = REPO_ROOT } = {}) {
  return scanWorkflowRefs(root).get(baseKeyOf(templateKey)) || [];
}

/* referencesFor — the whole picture for one template, and the single answer the
   editor asks before it will allow a key to change.

   `blocked` is the field that decides. It is true when ANYTHING points at this
   key, from either direction. */
export function referencesFor(templateKey, { journeyRows = [], root = REPO_ROOT } = {}) {
  const workflows = workflowRefsFor(templateKey, { root });
  const journeys = journeyRefsFor(templateKey, journeyRows);
  return {
    templateKey,
    workflows,
    journeys,
    blocked: workflows.length > 0 || journeys.length > 0
  };
}

/* annotateTemplates — attach usage to a whole list of rows in one pass. What the
   read endpoint calls, so the screen gets "used by" on every row without N
   round trips.

   `liveJourneyKeys` marks which journeys are saved in the database as opposed to
   being the editor's built-in example. A template a saved journey uses is one a
   person has actually committed to, and the list says so out loud. */
export function annotateTemplates(rows = [], { journeyRows = [], root = REPO_ROOT } = {}) {
  const workflowIndex = scanWorkflowRefs(root);
  return rows.map((row) => {
    const workflows = workflowIndex.get(baseKeyOf(row.template_key)) || [];
    const journeys = journeyRefsFor(row.template_key, journeyRows);
    return {
      ...row,
      used_by: {
        workflows,
        journeys,
        // Plain-language summary the list column renders directly, so the screen
        // is not reimplementing this sentence in three places.
        summary: describeUsage(workflows, journeys),
        locked: workflows.length > 0 || journeys.length > 0
      }
    };
  });
}

/** describeUsage — the one-line "who needs this" a non-technical reader sees. */
export function describeUsage(workflows = [], journeys = []) {
  const parts = [];
  if (journeys.length) {
    const names = [...new Set(journeys.map((j) => j.journeyName))];
    parts.push(`used by the ${names.join(" and ")} journey${names.length > 1 ? "s" : ""}`);
  }
  if (workflows.length) {
    const files = [...new Set(workflows.map((w) => w.file))];
    parts.push(`sent by ${files.length} automation${files.length > 1 ? "s" : ""}`);
  }
  if (!parts.length) return "nothing points at this yet";
  return parts.join(", ");
}
