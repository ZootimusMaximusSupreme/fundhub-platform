#!/usr/bin/env node
// Mac Bridge helper: serves Claude Code and Codex chats on the network (read only).
// Contract: docs/specs/mac-bridge-protocol-v1.md
import os from 'node:os';
import { createBridge, lanAddress, pairingLink } from '../src/server.mjs';
import { advertise } from '../src/bonjour.mjs';
import { encodeQR, renderQR } from '../src/qr.mjs';

const args = process.argv.slice(2);
if (args.includes('--help') || args.includes('-h')) {
  console.log(`Mac Bridge helper (read only)

Usage: node tools/mac-bridge/agent/bin/mac-bridge.mjs [--port 7878] [--no-bonjour] [--no-qr]

Env:   MAC_BRIDGE_PORT   port to listen on (default 7878)
       MAC_BRIDGE_HOME   use this folder instead of your home folder (tests, trials)
Token: ~/.mac-bridge/token (made on first run, mode 0600)`);
  process.exit(0);
}
const flag = (name) => args.includes(name);
const portArg = args.indexOf('--port');
const port = Number(portArg >= 0 ? args[portArg + 1] : process.env.MAC_BRIDGE_PORT || 7878);
if (!Number.isInteger(port) || port < 0 || port > 65535) {
  console.error('Bad port.');
  process.exit(1);
}

const { defaultPaths } = await import('../src/server.mjs');
const home = process.env.MAC_BRIDGE_HOME || os.homedir();
const bridge = createBridge({ ...defaultPaths(home), port });

let actualPort;
try {
  actualPort = await bridge.start();
} catch (e) {
  console.error(e && e.code === 'EADDRINUSE' ? `Port ${port} is already in use.` : `Could not start: ${e.message}`);
  process.exit(1);
}

const name = bridge.hostname;
const link = pairingLink({ host: lanAddress(), port: actualPort, token: bridge.token, name });
const stopBonjour = flag('--no-bonjour') ? () => {} : advertise({ name, port: actualPort });

console.log(`Mac Bridge is running on port ${actualPort} as "${name}". Read only.`);
console.log('');
console.log('Pair the iPhone app with this link (or scan the code):');
console.log(link);
if (!flag('--no-qr')) {
  try {
    console.log('');
    console.log(renderQR(encodeQR(link)));
  } catch {
    console.log('(Link is too long for the built-in QR code. Use the link above.)');
  }
}
console.log('');
console.log('Press Ctrl+C to stop.');

let stopping = false;
async function shutdown() {
  if (stopping) return;
  stopping = true;
  stopBonjour();
  try {
    await bridge.stop();
  } catch {}
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
