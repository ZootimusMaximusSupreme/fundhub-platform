import { spawn } from 'node:child_process';

/**
 * Advertise _macbridge._tcp with the macOS dns-sd tool. Returns a stop()
 * function. Any failure (tool missing, not macOS) is ignored quietly.
 */
export function advertise({ name, port }) {
  let child = null;
  try {
    child = spawn('dns-sd', ['-R', name, '_macbridge._tcp', 'local', String(port), `name=${name}`], {
      stdio: 'ignore',
    });
    child.on('error', () => {
      child = null;
    });
    child.unref();
  } catch {
    child = null;
  }
  const stop = () => {
    if (child) {
      try {
        child.kill();
      } catch {}
      child = null;
    }
  };
  process.once('exit', stop);
  return stop;
}
