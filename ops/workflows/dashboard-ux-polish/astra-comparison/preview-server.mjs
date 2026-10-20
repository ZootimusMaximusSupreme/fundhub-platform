import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { createFixture, fixtureResponse } from "./fixtures.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../../../..");
const PUBLIC = path.join(ROOT, "public");
const BASELINE = execFileSync("git", ["show", "f1ab024ee0fca5b236ecac50957ec0286c628101:public/app/staff-teams.html"], { cwd: ROOT, encoding: "utf8" });
const MIME = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".mjs": "text/javascript", ".json": "application/json", ".png": "image/png", ".webp": "image/webp", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".ico": "image/x-icon" };

function previewHtml(html) {
  const bootstrap = '<script>localStorage.setItem("fh_token","local-design-preview");localStorage.setItem("fh_role","owner");</script>';
  const notice = '<div id="__comparison_notice" style="position:fixed;bottom:32px;left:8px;z-index:2147483647;max-width:calc(100% - 16px);padding:8px 12px;background:#fff;border:1px solid #a16207;border-radius:4px;color:#713f12;font:600 11px system-ui;pointer-events:none">LOCAL DESIGN PREVIEW · FICTIONAL TEAM · NO LIVE CONNECTION</div>';
  return html.replace("<head>", `<head>${bootstrap}`).replace(/<body\b[^>]*>/i, body => body + notice);
}

export async function startPreviewServer(port = 0) {
  // A separate fixture per browser variant keeps a local click from altering the other version.
  const fixtures = new Map();
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    const referer = new URL(req.headers.referer || "http://127.0.0.1");
    const version = referer.searchParams.get("variant") || "current";
    const state = referer.searchParams.get("state") || "full";
    const fixtureKey = `${version}:${state}`;
    if (!fixtures.has(fixtureKey)) fixtures.set(fixtureKey, createFixture());
    res.setHeader("cache-control", "no-store");
    // Local app scripts can only call this local fixture server, never production.
    res.setHeader("content-security-policy", "connect-src 'self'; form-action 'self'; object-src 'none'");
    if (url.pathname.startsWith("/api/")) {
      if (url.pathname === "/api/read/staff" && state === "loading") {
        const timer = setTimeout(() => res.end(JSON.stringify({ ok: true, items: [] })), 30_000);
        req.on("close", () => clearTimeout(timer));
        return;
      }
      let body = {};
      if (req.method !== "GET" && req.method !== "HEAD") {
        let raw = "";
        for await (const chunk of req) raw += chunk;
        try { body = JSON.parse(raw || "{}"); } catch { res.writeHead(400).end(); return; }
      }
      const result = fixtureResponse(fixtures.get(fixtureKey), url.pathname, req.method, body, state);
      const status = result.__status || 200;
      delete result.__status;
      res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(result));
      return;
    }
    let file;
    if (url.pathname === "/" || url.pathname === "/comparison") file = path.join(HERE, "comparison.html");
    else if (url.pathname.startsWith("/__comparison/")) file = path.resolve(HERE, "." + url.pathname.slice("/__comparison".length));
    else file = path.resolve(PUBLIC, "." + decodeURIComponent(url.pathname));
    if (!file.startsWith(PUBLIC + path.sep) && !file.startsWith(HERE + path.sep)) {
      res.writeHead(403).end(); return;
    }
    if (url.pathname === "/app/staff-teams.html" && url.searchParams.get("variant") === "astra") {
      file = path.join(HERE, "team-access.html");
    }
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
      res.writeHead(404, { "content-type": "text/plain" }).end("Comparison draft is not ready yet."); return;
    }
    const type = MIME[path.extname(file)] || "application/octet-stream";
    res.writeHead(200, { "content-type": type });
    if (url.pathname === "/app/staff-teams.html") {
      const version = url.searchParams.get("variant");
      const html = version === "astra" || version === "rollout" ? fs.readFileSync(file, "utf8") : BASELINE;
      res.end(previewHtml(html));
    }
    else fs.createReadStream(file).pipe(res);
  });
  await new Promise(resolve => server.listen(port, "127.0.0.1", resolve));
  return { server, origin: `http://127.0.0.1:${server.address().port}`, fixtures };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { origin } = await startPreviewServer(Number(process.env.COMPARISON_PORT || 43229));
  console.log(`Team & Access comparison: ${origin}/comparison`);
}
