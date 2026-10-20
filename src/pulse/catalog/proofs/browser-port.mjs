import { randomInt } from "node:crypto";
import fs from "node:fs";
import { createServer } from "node:net";
import os from "node:os";
import path from "node:path";

const FIRST_PORT = 12_000;
const LAST_PORT = 30_000;

async function portIsFree(port) {
  const server = createServer();
  try {
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(port, "127.0.0.1", resolve);
    });
    return true;
  } catch {
    return false;
  } finally {
    if (server.listening) {
      await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  }
}

function removeStaleLock(lockPath) {
  let owner = 0;
  try { owner = Number(fs.readFileSync(lockPath, "utf8").trim()); } catch { return false; }
  if (Number.isInteger(owner) && owner > 0) {
    try {
      process.kill(owner, 0);
      return false;
    } catch (error) {
      if (error?.code !== "ESRCH") return false;
    }
  }
  fs.rmSync(lockPath, { force: true });
  return true;
}

async function reserveBrowserPort() {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const port = randomInt(FIRST_PORT, LAST_PORT);
    const lockPath = path.join(os.tmpdir(), `fundhub-playwright-${port}.lock`);
    let lock;
    try {
      lock = fs.openSync(lockPath, "wx", 0o600);
    } catch (error) {
      if (error?.code === "EEXIST") {
        removeStaleLock(lockPath);
        continue;
      }
      throw error;
    }

    fs.writeFileSync(lock, `${process.pid}\n`);
    let available = false;
    try { available = await portIsFree(port); } catch (error) {
      fs.closeSync(lock);
      fs.rmSync(lockPath, { force: true });
      throw error;
    }
    if (!available) {
      fs.closeSync(lock);
      fs.rmSync(lockPath, { force: true });
      continue;
    }

    let released = false;
    return {
      port,
      release() {
        if (released) return;
        released = true;
        fs.closeSync(lock);
        fs.rmSync(lockPath, { force: true });
      },
    };
  }
  throw new Error("Could not reserve a local browser port");
}

// Hold the cross-process lock until the nested Playwright process exits. This
// closes the gap where two parallel node:test processes could both receive the
// same just-freed port before either static server had time to bind it.
export async function withBrowserPort(run) {
  const lease = await reserveBrowserPort();
  try {
    return await run(lease.port);
  } finally {
    lease.release();
  }
}
