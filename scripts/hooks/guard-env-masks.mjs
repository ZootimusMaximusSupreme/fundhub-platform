#!/usr/bin/env node
// PreToolUse hook for Write, Edit, MultiEdit, apply_patch and Bash.
// Denies writing a Netlify mask (8 or more stars) into .env, .env.*, or
// credentials/, and denies sending netlify env:list or env:get output into
// those files. That is how 39 keys were overwritten with stars.
//
//   Mask or env-list dump into .env / credentials/  -> prints the "deny" answer.
//   Read of .env, a normal line, .env.example       -> prints nothing (allow).
//
// It never crashes. On any error it prints nothing and exits 0.
// Node built-ins only.

import os from "node:os";
import path from "node:path";

const EDIT_TOOLS = /^(Write|Edit|MultiEdit|NotebookEdit|apply_patch|ApplyPatch|Bash|Shell)$/i;
const MASK_RE = /\*{8,}/;
const NETLIFY_ENV_CMD = /netlify\s+env:(list|get)\b/i;
const NETLIFY_DUMP = /(?:^|\n)\s*(?:Loaded (?:config|environment)|Environment variables for|netlify env:(?:list|get))\b/i;

function deny(reason) {
  process.stdout.write(JSON.stringify({
    decision: "block",
    reason,
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: reason
    }
  }));
}

async function readInput() {
  if (process.stdin.isTTY) return {};
  const chunks = [];
  const timer = setTimeout(() => process.stdin.destroy(), 3000);
  try {
    for await (const chunk of process.stdin) chunks.push(chunk);
  } catch { /* a closed or broken pipe is fine */ }
  clearTimeout(timer);
  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function resolvePath(raw, cwd) {
  const base = typeof cwd === "string" && cwd ? cwd : process.cwd();
  const trimmed = String(raw || "").trim().replace(/^['"]|['"]$/g, "");
  if (!trimmed) return "";
  const given = trimmed.startsWith("~/") ? path.join(os.homedir(), trimmed.slice(2)) : trimmed;
  return path.resolve(base, given);
}

function isExampleEnv(name) {
  return /^\.env\.example$/i.test(name);
}

function isProtectedAbs(abs) {
  if (!abs) return false;
  const name = path.basename(abs);
  if (isExampleEnv(name)) return false;
  if (/^\.env(\..+)?$/i.test(name)) return true;
  return abs.split(path.sep).includes("credentials");
}

function namedPaths(input) {
  const ti = input.tool_input && typeof input.tool_input === "object" ? input.tool_input : {};
  const cwd = input.cwd;
  const out = [];
  for (const key of ["file_path", "path", "notebook_path", "filePath"]) {
    if (typeof ti[key] === "string" && ti[key]) out.push(resolvePath(ti[key], cwd));
  }
  if (/^(apply_patch|ApplyPatch)$/i.test(String(input.tool_name || ""))) {
    for (const value of Object.values(ti)) {
      if (typeof value !== "string" || !value.includes("*** ")) continue;
      for (const m of value.matchAll(/^\*\*\* (?:Add File|Update File|Delete File|Move to):\s*(.+?)\s*$/gm)) {
        out.push(resolvePath(m[1], cwd));
      }
    }
  }
  if (typeof ti.command === "string") {
    for (const m of ti.command.matchAll(/(?:>>?|tee(?:\s+-a)?)\s+([^\s;|&]+)/g)) {
      out.push(resolvePath(m[1], cwd));
    }
  }
  return out;
}

function writtenText(input) {
  const ti = input.tool_input && typeof input.tool_input === "object" ? input.tool_input : {};
  const parts = [];
  for (const key of ["content", "contents", "new_string", "new_src", "newString"]) {
    if (typeof ti[key] === "string") parts.push(ti[key]);
  }
  if (Array.isArray(ti.edits)) {
    for (const e of ti.edits) {
      if (e && typeof e.new_string === "string") parts.push(e.new_string);
    }
  }
  if (/^(apply_patch|ApplyPatch)$/i.test(String(input.tool_name || ""))) {
    for (const value of Object.values(ti)) {
      if (typeof value !== "string") continue;
      for (const line of value.split(/\r?\n/)) {
        if (line.startsWith("+") && !line.startsWith("+++")) parts.push(line.slice(1));
      }
    }
  }
  if (typeof ti.command === "string") parts.push(ti.command);
  return parts.join("\n");
}

function commandSendsNetlify(command) {
  if (typeof command !== "string" || !NETLIFY_ENV_CMD.test(command)) return false;
  return /(?:>>?|tee(?:\s+-a)?)\s+/.test(command);
}

async function main() {
  const input = await readInput();
  if (typeof input.tool_name === "string" && input.tool_name && !EDIT_TOOLS.test(input.tool_name)) return;

  const paths = namedPaths(input);
  const hitsProtected = paths.some((p) => isProtectedAbs(p));
  const text = writtenText(input);
  const ti = input.tool_input && typeof input.tool_input === "object" ? input.tool_input : {};
  const command = typeof ti.command === "string" ? ti.command : "";

  const netlifySend = commandSendsNetlify(command) && hitsProtected;
  const netlifyDump = hitsProtected && NETLIFY_DUMP.test(text);
  if (netlifySend || netlifyDump) {
    deny("Do not send netlify env:list or env:get output into .env, .env.* or credentials/. Read .env. Put the full value from the vendor.");
    return;
  }
  if (hitsProtected && MASK_RE.test(text)) {
    deny("Do not write a Netlify mask (8 or more stars) into .env, .env.* or credentials/. Put the full value from the vendor.");
  }
}

main().catch(() => { /* a broken hook must never block an edit */ });
