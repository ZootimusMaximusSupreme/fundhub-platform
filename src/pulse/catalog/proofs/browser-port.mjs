import { createServer } from "node:net";

// Nested browser proofs run in parallel node:test processes. A PID-derived
// port can collide across them; ask the OS for an unused local port instead.
export async function freeBrowserPort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const port = server.address().port;
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return port;
}
