#!/usr/bin/env node
// Install the repo-owned iOS release recovery job after this change reaches main.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { releaseHome } from "./ios-release-intent.mjs";
import { seedAutoState } from "./ios-release-auto.mjs";

const execFileAsync = promisify(execFile);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const LABEL = "ai.fundhub.ios-release-watchdog";

function xml(value) {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

export function makePlist(root, home, runner = root, node = process.execPath, executablePath = process.env.PATH) {
  const args = [node, path.join(runner, "scripts", "ios-release-watchdog.mjs")];
  const output = path.join(home, "logs", "watchdog.stdout.log");
  const errors = path.join(home, "logs", "watchdog.stderr.log");
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>${LABEL}</string>
<key>ProgramArguments</key><array>${args.map((arg) => `<string>${xml(arg)}</string>`).join("")}</array>
<key>WorkingDirectory</key><string>${xml(root)}</string>
<key>EnvironmentVariables</key><dict>
<key>FUNDHUB_IOS_RELEASE_HOME</key><string>${xml(home)}</string>
<key>FUNDHUB_IOS_MAIN_REPO</key><string>${xml(root)}</string>
<key>HOME</key><string>${xml(os.homedir())}</string>
<key>PATH</key><string>${xml(executablePath || "/usr/bin:/bin:/usr/sbin:/sbin")}</string>
</dict>
<key>RunAtLoad</key><true/>
<key>StartInterval</key><integer>120</integer>
<key>StandardOutPath</key><string>${xml(output)}</string>
<key>StandardErrorPath</key><string>${xml(errors)}</string>
</dict></plist>\n`;
}

export async function installWatchdog({ sourceRoot = ROOT, mainRepo = null, home = releaseHome(), command = execFileAsync,
  launchAgents = path.join(os.homedir(), "Library", "LaunchAgents") } = {}) {
  if (!mainRepo) {
    const common = String((await command("git", ["-C", sourceRoot, "rev-parse", "--path-format=absolute",
      "--git-common-dir"])).stdout).trim();
    mainRepo = path.dirname(common);
  }
  if (!fs.existsSync(path.join(mainRepo, ".env"))) throw new Error("Fundhub .env is missing from the main repository");
  await command("git", ["-C", mainRepo, "fetch", "origin", "main"]);
  const head = String((await command("git", ["-C", mainRepo, "rev-parse", "origin/main"])).stdout).trim();
  if (!/^[a-f0-9]{40}$/.test(head)) throw new Error("Remote main did not return a commit SHA");
  await command("git", ["-C", mainRepo, "cat-file", "-e", `${head}:scripts/ios-release-watchdog.mjs`]);
  const runner = path.join(home, "runner");
  let baseline = head;
  if (!fs.existsSync(runner)) {
    fs.mkdirSync(home, { recursive: true, mode: 0o700 });
  } else {
    const actual = String((await command("git", ["-C", runner, "rev-parse", "--show-toplevel"])).stdout).trim();
    const dirty = String((await command("git", ["-C", runner, "status", "--porcelain"])).stdout).trim();
    if (actual !== runner || dirty) throw new Error("Existing iOS release runner checkout is not clean");
    baseline = String((await command("git", ["-C", runner, "rev-parse", "HEAD"])).stdout).trim();
  }
  const baselineProject = String((await command("git", ["-C", mainRepo, "show",
    `${baseline}:tools/fundhub-ios/Fundhub.xcodeproj/project.pbxproj`], { maxBuffer: 1_000_000 })).stdout);
  seedAutoState(home, baseline, baselineProject);
  if (!fs.existsSync(runner)) {
    await command("git", ["-C", mainRepo, "worktree", "add", "--detach", runner, head]);
  } else {
    await command("git", ["-C", runner, "checkout", "--detach", head]);
  }
  fs.mkdirSync(path.join(home, "logs"), { recursive: true, mode: 0o700 });
  fs.mkdirSync(launchAgents, { recursive: true, mode: 0o700 });
  const plist = path.join(launchAgents, `${LABEL}.plist`);
  fs.writeFileSync(plist, makePlist(mainRepo, home, runner), { mode: 0o600 });
  const target = `gui/${process.getuid()}/${LABEL}`;
  await command("launchctl", ["bootout", target]).catch(() => {});
  await command("launchctl", ["bootstrap", `gui/${process.getuid()}`, plist]);
  await command("launchctl", ["kickstart", target]);
  return { plist, label: LABEL, intervalSeconds: 120, releaseHome: home, runner, sha: head };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  if (process.argv.slice(2).join(" ") !== "--apply") {
    console.error("Use --apply to install the iOS release watchdog from published main");
    process.exitCode = 2;
  } else {
    installWatchdog().then((result) => console.log(JSON.stringify(result)))
      .catch((error) => { console.error(`ios-release-watchdog-install: ${error.message}`); process.exitCode = 1; });
  }
}
