// Heartbeat law. A new workflow id in src/workflows/index.mjs needs a pulse
// coverage note. The note list is src/pulse/coverage/INDEX.md. Other agents
// own that file and src/pulse/coverage/slice-*.mjs. Until INDEX.md exists,
// this test only checks the law files name the 3 times schedule rule.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../..");
const INDEX = path.join(HERE, "coverage/INDEX.md");
const WORKFLOWS = path.join(ROOT, "src/workflows/index.mjs");
const RULES = [
  path.join(ROOT, ".cursor/rules/heartbeat-on-every-build.mdc"),
  path.join(ROOT, ".claude/rules/heartbeat-on-every-build.md")
];

const THREE_TIMES = /3 times its schedule/;

test("heartbeat law: rule files exist and name the 3 times schedule rule", () => {
  for (const file of RULES) {
    assert.ok(fs.existsSync(file), `missing ${path.relative(ROOT, file)}`);
    const text = fs.readFileSync(file, "utf8");
    assert.match(
      text,
      THREE_TIMES,
      `${path.relative(ROOT, file)} must name the 3 times schedule rule`
    );
  }
});

test("heartbeat law: a workflow id with no pulse coverage note fails", () => {
  if (!fs.existsSync(INDEX)) return;

  const ids = registeredWorkflowIds(WORKFLOWS);
  assert.ok(ids.length > 0, "src/workflows/index.mjs listed no workflow ids");
  const notes = coverageNotes(INDEX);
  const missing = ids.filter((id) => !hasCoverageNote(notes, id));
  assert.deepEqual(
    missing,
    [],
    `workflow ids with no pulse coverage note:\n  ${missing.join("\n  ")}\n` +
    `Name each id in src/pulse/coverage/INDEX.md, or in a slice-*.mjs file that INDEX.md names.`
  );
});

function coverageNotes(indexPath) {
  const indexText = fs.readFileSync(indexPath, "utf8");
  const dir = path.dirname(indexPath);
  const parts = [indexText];
  const named = indexText.match(/slice-[A-Za-z0-9._-]+\.mjs/g) || [];
  for (const name of named) {
    const slicePath = path.join(dir, name);
    if (fs.existsSync(slicePath)) parts.push(fs.readFileSync(slicePath, "utf8"));
  }
  return parts.join("\n");
}

function hasCoverageNote(notes, id) {
  const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|[^A-Za-z0-9-])${escaped}(?=$|[^A-Za-z0-9-])`).test(notes);
}

function registeredWorkflowIds(indexPath) {
  const text = fs.readFileSync(indexPath, "utf8");
  const imports = new Map();
  const importRe = /^import\s+\{([^}]+)\}\s+from\s+["'](\.\/[^"']+)["'];/gm;
  let match;
  while ((match = importRe.exec(text))) {
    const from = match[2];
    for (const part of match[1].split(",")) {
      const trimmed = part.trim();
      if (!trimmed) continue;
      const asMatch = trimmed.match(/^(\w+)\s+as\s+(\w+)$/);
      const exported = asMatch ? asMatch[1] : trimmed;
      const local = asMatch ? asMatch[2] : trimmed;
      if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(local)) imports.set(local, { from, exported });
    }
  }

  const header = "export const functions = [";
  const start = text.indexOf(header);
  assert.ok(start >= 0, "src/workflows/index.mjs has no functions array");
  const open = start + header.length - 1;
  let depth = 0;
  let end = -1;
  for (let i = open; i < text.length; i++) {
    if (text[i] === "[") depth += 1;
    else if (text[i] === "]") {
      depth -= 1;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  assert.ok(end > open, "src/workflows/index.mjs functions array does not close");

  const body = text
    .slice(open + 1, end)
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\/\/.*$/gm, " ");
  const names = body
    .split(",")
    .map((part) => part.trim())
    .filter((part) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(part));

  const dir = path.dirname(indexPath);
  const ids = [];
  for (const name of names) {
    const imported = imports.get(name);
    assert.ok(imported, `no import for registered workflow ${name}`);
    const file = path.resolve(dir, imported.from);
    const src = fs.readFileSync(file, "utf8");
    const id = functionId(src, imported.exported);
    assert.ok(id, `no workflow id for ${name} in ${imported.from}`);
    ids.push(id);
  }
  return ids;
}

function functionId(src, exportName) {
  const marker = `export const ${exportName} = inngest.createFunction(`;
  const at = src.indexOf(marker);
  if (at < 0) return null;
  const window = src.slice(at, at + 800);
  const idMatch = window.match(/id:\s*["']([^"']+)["']/);
  return idMatch ? idMatch[1] : null;
}
