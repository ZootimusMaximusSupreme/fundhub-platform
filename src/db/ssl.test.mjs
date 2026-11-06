import test from "node:test";
import assert from "node:assert/strict";
import tls from "node:tls";
import { X509Certificate } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { once } from "node:events";
import pg from "pg";
import { databaseConnectionOptions } from "./ssl.mjs";
import { SUPABASE_PRODUCTION_CA } from "./ssl-ca.mjs";

test("remote pool options retain credentials and strict TLS despite URL/pg environment overrides", () => {
  const source = "postgres://user:p%40ss@aws-1-us-west-2.pooler.supabase.com:6543/postgres?application_name=proof&sslmode=no-verify&ssl=0&sslrootcert=/must/not/read&sslcert=/must/not/read&sslkey=/must/not/read&uselibpqcompat=true";
  const config = databaseConnectionOptions(source);
  const previous = process.env.PGSSLMODE;
  let client;
  try { process.env.PGSSLMODE = "disable"; client = new pg.Client(config); }
  finally { if (previous === undefined) delete process.env.PGSSLMODE; else process.env.PGSSLMODE = previous; }
  assert.equal(client.user, "user"); assert.equal(client.password, "p@ss");
  assert.equal(client.host, "aws-1-us-west-2.pooler.supabase.com");
  assert.equal(client.connectionParameters.application_name, "proof");
  assert.equal(client.ssl.rejectUnauthorized, true); assert.equal(client.ssl.minVersion, "TLSv1.2");
  assert.equal(client.ssl.ca, SUPABASE_PRODUCTION_CA);
  assert.equal(client.ssl.servername, client.host);
  assert.equal(new URL(config.connectionString).searchParams.has("sslmode"), false);
});

test("only explicit loopback scratch databases retain plaintext, never production names, lookalike hosts or target overrides", () => {
  for (const host of ["localhost", "127.0.0.1", "[::1]"]) {
    assert.equal(databaseConnectionOptions(`postgres://u:p@${host}/scratch`).ssl, false);
  }
  for (const host of ["localhost.example.test", "127.0.0.1.example.test", "10.0.0.1", "database.example.test"]) {
    assert.equal(databaseConnectionOptions(`postgres://u:p@${host}/prod`).ssl.rejectUnauthorized, true);
  }
  for (const host of ["localhost", "127.0.0.1"]) {
    for (const name of ["postgres", "fundhub_prod", "financial"]) {
      assert.equal(databaseConnectionOptions(`postgres://u:p@${host}/${name}`).ssl.rejectUnauthorized, true);
    }
  }
  for (const source of ["postgres://u:p@localhost/prod?host=remote.example.test", "postgres://u:p@localhost/prod?hostaddr=10.0.0.1", "postgres://u:p@%2Ftmp/db", "postgres://u:p@%64atabase.example.test/db", "postgres://u:p@bad_host/db", "postgres:///prod", "not-a-connection", "https://u:private@database.example.test/prod"]) {
    assert.throws(() => databaseConnectionOptions(source), error => !error.message.includes("private") && /DATABASE_URL/.test(error.message));
  }
});

test("bundled public Supabase CA matches official fingerprint and remains valid", () => {
  const cert = new X509Certificate(SUPABASE_PRODUCTION_CA);
  assert.equal(cert.fingerprint256, "80:70:25:AD:50:D4:ED:21:9D:2C:9C:7D:29:9C:00:4F:82:4E:B0:0C:F7:F6:5A:FE:F6:07:D0:7B:72:E6:CA:FA");
  assert.ok(cert.ca); assert.ok(new Date(cert.validTo).getTime() > Date.now());
});

// A real local TLS server and synthetic certificate exercise the same client
// policy without needing Supabase's private signing key. The separate read-only
// production receipt proves the bundled provider CA against the actual pool.
test("real handshakes accept trusted matching TLS and reject wrong CA, hostname and old protocols", async t => {
  const dir = mkdtempSync(join(tmpdir(), "fundhub-db-ssl-"));
  const keyFile = join(dir, "key.pem"), certFile = join(dir, "cert.pem"), configFile = join(dir, "openssl.cnf");
  writeFileSync(configFile, "[req]\nprompt=no\ndistinguished_name=dn\nx509_extensions=v3\n[dn]\nCN=database.example.test\n[v3]\nsubjectAltName=DNS:database.example.test\nbasicConstraints=critical,CA:TRUE\n");
  execFileSync("openssl", ["req", "-x509", "-nodes", "-newkey", "rsa:2048", "-days", "1", "-keyout", keyFile, "-out", certFile, "-config", configFile], { stdio: "ignore" });
  const key = readFileSync(keyFile), cert = readFileSync(certFile);
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  async function server(extra = {}) {
    const sockets = new Set();
    const s = tls.createServer({ key, cert, ...extra }, socket => { sockets.add(socket); socket.on("close", () => sockets.delete(socket)); });
    s.on("tlsClientError", () => {});
    s.listen(0, "127.0.0.1"); await once(s, "listening");
    t.after(async () => { for (const socket of sockets) socket.destroy(); await new Promise(resolve => s.close(resolve)); });
    return s.address().port;
  }
  async function connect(port, ssl) {
    return new Promise((resolve, reject) => {
      const socket = tls.connect({ host: "127.0.0.1", port, ...ssl });
      socket.setTimeout(3000, () => socket.destroy(new Error("TLS proof timed out")));
      socket.once("error", reject);
      socket.once("secureConnect", () => {
        const proof = { authorized: socket.authorized, protocol: socket.getProtocol(), servername: socket.servername };
        socket.end(); resolve(proof);
      });
    });
  }
  const policy = databaseConnectionOptions("postgres://u:p@database.example.test/db").ssl;
  const port = await server({ minVersion: "TLSv1.2" });
  const proof = await connect(port, { ...policy, ca: cert });
  assert.equal(proof.authorized, true); assert.ok(["TLSv1.2", "TLSv1.3"].includes(proof.protocol));
  assert.equal(proof.servername, "database.example.test");
  await assert.rejects(connect(port, { ...policy, ca: SUPABASE_PRODUCTION_CA }), /certificate|self.signed/i);
  const wrongHost = databaseConnectionOptions("postgres://u:p@wrong.example.test/db").ssl;
  await assert.rejects(connect(port, { ...wrongHost, ca: cert }), { code: "ERR_TLS_CERT_ALTNAME_INVALID" });
  const oldPort = await server({ minVersion: "TLSv1.1", maxVersion: "TLSv1.1" });
  await assert.rejects(connect(oldPort, { ...policy, ca: cert }), /protocol|version|alert/i);
});
