#!/usr/bin/env node
// Provenance gate for Fundhub animation lay-ons.
//
// A source is not trusted because its filename says "final" or "edited". It is
// trusted only when a human has checked the clean, captioned Submagic export and
// this file has recorded its exact hash. Every protected build checks that hash
// before ffmpeg starts, then records the new animated export so it cannot later
// be registered as a clean source.
//
// Usage:
//   node scripts/animation-clean-source.mjs register --plan <plan-dir> --source <clean.mp4> --verified-clean
//   node scripts/animation-clean-source.mjs build --plan <plan-dir> --source <clean.mp4> --out <animated.mp4> -- <builder> <args...>

import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {validateSchedule} from '../marketing/broll/scripts/validate-overlay-schedule.mjs';

export const CLEAN_SOURCE_STAGE = 'post-submagic-pre-animation';
export const CLEAN_SOURCE_FILE = 'clean-source.json';
export const OUTPUT_REGISTRY_FILE = '.overlay-output-registry.json';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const fail = (message) => {
  throw new Error(message);
};

const asAbsolute = (value, label) => {
  if (typeof value !== 'string' || !value.trim()) fail(`${label} is required.`);
  return path.resolve(value);
};

const existingFile = (value, label) => {
  const absolute = asAbsolute(value, label);
  let stat;
  try {
    stat = fs.statSync(absolute);
  } catch {
    fail(`${label} does not exist: ${absolute}`);
  }
  if (!stat.isFile()) fail(`${label} is not a file: ${absolute}`);
  return fs.realpathSync(absolute);
};

export function sha256File(file) {
  const fd = fs.openSync(file, 'r');
  const hash = createHash('sha256');
  const chunk = Buffer.allocUnsafe(1024 * 1024);
  try {
    let bytes = 0;
    while (true) {
      const count = fs.readSync(fd, chunk, 0, chunk.length, null);
      if (!count) break;
      hash.update(chunk.subarray(0, count));
      bytes += count;
    }
    return {sha256: hash.digest('hex'), bytes};
  } finally {
    fs.closeSync(fd);
  }
}

const json = (file, label) => {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    fail(`${label} is missing or invalid JSON: ${file}`);
  }
};

const writeJson = (file, data) => {
  fs.mkdirSync(path.dirname(file), {recursive: true});
  fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
};

export function animationPlansRoot(planDir) {
  let cursor = asAbsolute(planDir, 'plan directory');
  while (true) {
    if (path.basename(cursor) === 'animation-plans') return cursor;
    const parent = path.dirname(cursor);
    if (parent === cursor) fail(`plan directory is not inside marketing/ads/animation-plans: ${planDir}`);
    cursor = parent;
  }
}

export function readCleanSourceProof(planDir) {
  const plan = asAbsolute(planDir, 'plan directory');
  const file = path.join(plan, CLEAN_SOURCE_FILE);
  const proof = json(file, 'Clean-source proof');
  return {plan, file, proof};
}

const registryPathFor = (planDir) => path.join(animationPlansRoot(planDir), OUTPUT_REGISTRY_FILE);

export function readOutputRegistry(planDir) {
  const file = registryPathFor(planDir);
  if (!fs.existsSync(file)) return {file, registry: {schema_version: 1, outputs: []}};
  const registry = json(file, 'Animated-output registry');
  if (registry.schema_version !== 1 || !Array.isArray(registry.outputs)) {
    fail(`Animated-output registry has the wrong shape: ${file}`);
  }
  return {file, registry};
}

const isRegisteredOutput = (registry, file, sha256) => registry.outputs.some((output) =>
  output && (output.output_path === file || output.sha256 === sha256)
);

/** Check the clean source before any animation renderer is allowed to run. */
export function validateCleanSource({planDir, sourcePath, outputPath}) {
  const {plan, proof} = readCleanSourceProof(planDir);
  const source = existingFile(sourcePath, 'Overlay source');
  const output = asAbsolute(outputPath, 'Overlay output');
  const actual = sha256File(source);
  const {registry} = readOutputRegistry(plan);
  const errors = [];

  if (proof.schema_version !== 1) errors.push('clean-source.json must use schema_version 1.');
  if (proof.stage !== CLEAN_SOURCE_STAGE) errors.push(`clean-source.json stage must be ${CLEAN_SOURCE_STAGE}.`);
  if (proof.verified_no_prior_animation !== true) errors.push('clean-source.json must record verified_no_prior_animation: true.');
  if (proof.source_path !== source) errors.push('The requested source is not the exact path recorded in clean-source.json.');
  if (!/^[a-f0-9]{64}$/i.test(String(proof.sha256 || ''))) errors.push('clean-source.json has no valid SHA-256.');
  if (proof.sha256 !== actual.sha256) errors.push('The clean source changed after it was approved. Register and review the new clean source before building.');
  if (path.resolve(source) === output) errors.push('The overlay output cannot overwrite the clean Submagic source.');
  if (isRegisteredOutput(registry, source, actual.sha256)) errors.push('This source was already recorded as an animated output. Start again from the clean post-Submagic/pre-animation source.');

  return {ok: errors.length === 0, errors, planDir: plan, sourcePath: source, outputPath: output, proof, sourceHash: actual.sha256};
}

/** Register an operator-reviewed clean Submagic export. Never auto-register a video. */
export function registerCleanSource({planDir, sourcePath, verifiedClean = false}) {
  if (!verifiedClean) fail('Refusing to register a source without --verified-clean after a visual check that it has captions and no prior animations.');
  const plan = asAbsolute(planDir, 'plan directory');
  if (!fs.existsSync(plan) || !fs.statSync(plan).isDirectory()) fail(`plan directory does not exist: ${plan}`);
  const source = existingFile(sourcePath, 'Clean Submagic source');
  const actual = sha256File(source);
  const {registry} = readOutputRegistry(plan);
  if (isRegisteredOutput(registry, source, actual.sha256)) {
    fail('Refusing to register a file already recorded as an animated output. Pick the clean post-Submagic/pre-animation export.');
  }
  const proof = {
    schema_version: 1,
    stage: CLEAN_SOURCE_STAGE,
    source_path: source,
    sha256: actual.sha256,
    bytes: actual.bytes,
    verified_no_prior_animation: true,
    registered_by: 'animation-clean-source.mjs',
    registered_at: new Date().toISOString(),
  };
  const file = path.join(plan, CLEAN_SOURCE_FILE);
  writeJson(file, proof);
  return {file, proof};
}

/** Record an output only after the builder exited successfully. That output can never become a clean source. */
export function recordAnimatedOutput({planDir, sourcePath, outputPath}) {
  const checked = validateCleanSource({planDir, sourcePath, outputPath});
  if (!checked.ok) fail(`Clean-source gate failed:\n- ${checked.errors.join('\n- ')}`);
  const output = existingFile(checked.outputPath, 'Animated output');
  const actual = sha256File(output);
  const {file, registry} = readOutputRegistry(checked.planDir);
  const outputs = registry.outputs.filter((entry) => entry && entry.output_path !== output);
  outputs.push({
    output_path: output,
    sha256: actual.sha256,
    bytes: actual.bytes,
    plan_path: checked.planDir,
    source_path: checked.sourcePath,
    source_sha256: checked.sourceHash,
    recorded_at: new Date().toISOString(),
  });
  writeJson(file, {schema_version: 1, outputs});
  return {file, outputPath: output, sha256: actual.sha256};
}

const flag = (args, name) => {
  const index = args.indexOf(name);
  if (index < 0 || !args[index + 1] || args[index + 1].startsWith('--')) fail(`${name} is required.`);
  return args[index + 1];
};

const usesExactPath = (args, wanted) => args.some((arg) => {
  if (typeof arg !== 'string') return false;
  const value = arg.includes('=') ? arg.slice(arg.lastIndexOf('=') + 1) : arg;
  if (value === wanted) return true;
  try {
    const resolved = path.resolve(value);
    return resolved === wanted || (fs.existsSync(resolved) && fs.realpathSync(resolved) === wanted);
  } catch {
    return false;
  }
});

export function protectedBuild({planDir, sourcePath, outputPath, command}) {
  const checked = validateCleanSource({planDir, sourcePath, outputPath});
  if (!checked.ok) fail(`Clean-source gate failed:\n- ${checked.errors.join('\n- ')}`);
  const schedulePath = path.join(checked.planDir, 'schedule.json');
  if (!fs.existsSync(schedulePath)) fail(`Overlay schedule is missing: ${schedulePath}`);
  const {fails} = validateSchedule(json(schedulePath, 'Overlay schedule'), {repoRoot: ROOT});
  if (fails.length) fail(`Overlay schedule failed:\n- ${fails.join('\n- ')}`);
  if (!Array.isArray(command) || !command.length) fail('A build command after -- is required.');
  if (!usesExactPath(command, checked.sourcePath)) fail('The builder command must use the exact clean source path from clean-source.json.');
  if (!usesExactPath(command, checked.outputPath)) fail('The builder command must use the requested output path.');

  const result = spawnSync(command[0], command.slice(1), {cwd: ROOT, stdio: 'inherit'});
  if (result.error) fail(`Overlay builder could not start: ${result.error.message}`);
  if (result.status !== 0) fail(`Overlay builder exited ${result.status ?? 'without a status'}. No output was registered.`);
  return recordAnimatedOutput({planDir: checked.planDir, sourcePath: checked.sourcePath, outputPath: checked.outputPath});
}

export function main(argv = process.argv.slice(2)) {
  const mode = argv[0];
  const rest = argv.slice(1);
  const planDir = flag(rest, '--plan');
  const sourcePath = flag(rest, '--source');
  if (mode === 'register') {
    const result = registerCleanSource({planDir, sourcePath, verifiedClean: rest.includes('--verified-clean')});
    process.stdout.write(`Registered clean source: ${result.file}\n`);
    return result;
  }
  if (mode === 'build') {
    const outputPath = flag(rest, '--out');
    const split = rest.indexOf('--');
    if (split < 0) fail('Build mode needs -- before the existing build command.');
    const result = protectedBuild({planDir, sourcePath, outputPath, command: rest.slice(split + 1)});
    process.stdout.write(`Recorded animated output: ${result.file}\n`);
    return result;
  }
  fail('Use register or build.');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
