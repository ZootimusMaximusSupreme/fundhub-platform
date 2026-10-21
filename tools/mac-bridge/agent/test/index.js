// Lets `node --test tools/mac-bridge/agent/test/` work: Node 22 treats a folder
// argument as a module, so this loads every *.test.mjs in this folder.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
for (const name of fs.readdirSync(dir).filter((f) => f.endsWith('.test.mjs')).sort()) {
  await import(pathToFileURL(path.join(dir, name)).href);
}
