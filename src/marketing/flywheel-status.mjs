// Flywheel status for the Marketing Command Center — the same answer as
// `npm run flywheel:status`, as data.
//
// A THIN WRAPPER, ON PURPOSE. scripts/flywheel/status.mjs owns the rules
// (which file each stage is, what makes it STALE, BLOCKED or FAILED). Nothing
// here re-decides a state. evaluate() decides; render() words it.
//
// WORD FOR WORD WITH THE COMMAND. Each stage row carries `line`, cut out of
// render()'s own output, so the page can never print a different sentence from
// the one Chris sees in the terminal. A second copy of the wording here would
// drift the first time somebody edits the script.
//
// WHERE THE FILES ARE. Locally they sit under the repo. On Netlify they are only
// there when netlify.toml ships them (`included_files` has
// "marketing/flywheel/**"), and the bundle's own path is not the repo's. So a
// short list of places is tried in order. None found means the caller gets
// null and says the flywheel is waiting — never a made-up row.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { evaluate, render } from "../../scripts/flywheel/status.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));

/* Places a deployed or local copy of the repo might be. First hit wins.
   - two folders up from this file: the repo root locally, and the function
     root on Netlify (the bundle sits at netlify/functions/, also two deep)
   - LAMBDA_TASK_ROOT: where Netlify's runtime unpacks the function zip
   - the working directory: a script run from the repo root */
export function candidateRoots(env = process.env) {
  const out = [path.resolve(HERE, "../.."), env.LAMBDA_TASK_ROOT, process.cwd()]
    .filter((p) => typeof p === "string" && p.length > 0);
  return [...new Set(out)];
}

/* findFlywheelDir — the marketing/flywheel folder, or null. */
export function findFlywheelDir(roots = candidateRoots()) {
  for (const root of roots) {
    const dir = path.join(root, "marketing", "flywheel");
    try {
      if (fs.statSync(dir).isDirectory()) return dir;
    } catch { /* not here — try the next place */ }
  }
  return null;
}

/* The state words render() prints in its middle column. Same rule as render():
   a READY stage reads "ready" plus whether its front matter says approved. */
function stateText(row) {
  if (row.state !== "READY") return row.state;
  return row.meta && row.meta.status === "approved"
    ? "ready       approved"
    : "ready       not reviewed";
}

/* campaignStatus(dir, campaign) → { campaign, stages, advice }

   stages[i].line is render()'s line for that stage, trimmed and otherwise
   untouched. `why` is the text after the state column, cut by the same widths
   render() pads to, so it is render's words too. */
export function campaignStatus(dir, campaign) {
  const rows = evaluate(dir);
  const text = render(rows, campaign).split("\n");
  // render(): "", "Flywheel: <campaign>", "", one line per stage, "", advice?, ""
  const stageLines = text.slice(3, 3 + rows.length);
  const advice = text.slice(3 + rows.length).map((s) => s.trim()).filter(Boolean).join(" ") || null;

  const stages = rows.map((row, i) => {
    const raw = stageLines[i] || "";
    const status = stateText(row);
    // "  " + n + " " + label padded to 14 + " " + state padded to 22 + " " + why
    const whyAt = 2 + String(row.n).length + 1 + Math.max(14, row.label.length) + 1 +
      Math.max(22, status.length) + 1;
    return {
      n: row.n,
      key: row.key,
      label: row.label,
      file: row.file,
      state: row.state,
      approved: row.state === "READY" && Boolean(row.meta && row.meta.status === "approved"),
      status: status.replace(/\s+/g, " "),
      why: raw.slice(whyAt).trim() || null,
      reasons: [...row.reasons],
      line: raw.trim()
    };
  });

  return { campaign, stages, advice };
}

/* flywheelStatus({ roots }) → { campaigns: [...] } | null

   Every folder under marketing/flywheel/ is a campaign ("partner" today), so a
   second one (for example the $147 roadmap) shows up with no code change.
   null when the folder is not on this server at all. */
export function flywheelStatus({ roots } = {}) {
  const base = findFlywheelDir(roots || candidateRoots());
  if (!base) return null;
  const campaigns = fs.readdirSync(base, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !e.name.startsWith("."))
    .map((e) => e.name)
    .sort();
  return {
    campaigns: campaigns.map((c) => campaignStatus(path.join(base, c), c))
  };
}

export default flywheelStatus;
