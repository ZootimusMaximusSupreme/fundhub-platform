// A small queue for the S4 browser proofs. The focused proof run starts every test file at
// once, and each S4 file opens its own Chromium. Left alone they crowd out the other
// browser specs in that run, whose 5 second waits then fail. Importing this module holds
// back the file (before any test timer starts) until one of a few places is free, and
// gives the place back when the process ends. A place left by a killed process is
// taken over once its process is gone.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const PLACES = Number(process.env.S4_BROWSER_PLACES || 3);
const DIR = path.join(os.tmpdir(), "fundhub-s4-browser-places");

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
}

function ownerGone(place) {
  try {
    const pid = Number(fs.readFileSync(path.join(place, "pid"), "utf8"));
    return Number.isInteger(pid) && pid > 0 && !alive(pid);
  } catch {
    // no pid written yet: the owner is mid-way through taking it, unless it has sat that way for a while
    try { return Date.now() - fs.statSync(place).mtimeMs > 10_000; } catch { return false; }
  }
}

async function takePlace() {
  fs.mkdirSync(DIR, { recursive: true });
  for (;;) {
    for (let i = 0; i < PLACES; i += 1) {
      const place = path.join(DIR, `place-${i}`);
      try {
        fs.mkdirSync(place);
      } catch (error) {
        if (error.code !== "EEXIST") throw error;
        if (ownerGone(place)) fs.rmSync(place, { recursive: true, force: true });
        continue;
      }
      fs.writeFileSync(path.join(place, "pid"), String(process.pid));
      process.on("exit", () => { try { fs.rmSync(place, { recursive: true, force: true }); } catch { /* already gone */ } });
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
}

await takePlace();
