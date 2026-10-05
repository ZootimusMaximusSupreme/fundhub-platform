// fhconsulting.online is a domain alias on the Fundhub Netlify site.
// The address bar on this host is / , /terms/ , /privacy/ , and /refund/ .
// Those URLs are served from public/consulting/ with a 200 rewrite, so
// fundhub.ai/consulting/ is unchanged. Old /consulting/ URLs on this host
// 301 to the clean address. Other hosts pass through.

const HOSTS = new Set(["fhconsulting.online", "www.fhconsulting.online"]);
const REWRITE_MARK = "x-fh-consulting-rewrite";

const PASS = new Set([
  "/favicon.ico",
  "/favicon.svg",
  "/apple-touch-icon.png",
  "/funnel/rb2b.js",
  "/consulting/site.css",
]);

const CLEAN = {
  "/consulting": "/",
  "/consulting/": "/",
  "/consulting/index.html": "/",
  "/consulting/terms": "/terms/",
  "/consulting/terms/": "/terms/",
  "/consulting/terms/index.html": "/terms/",
  "/consulting/privacy": "/privacy/",
  "/consulting/privacy/": "/privacy/",
  "/consulting/privacy/index.html": "/privacy/",
  "/consulting/refund": "/refund/",
  "/consulting/refund/": "/refund/",
  "/consulting/refund/index.html": "/refund/",
};

const SLASH = {
  "/terms": "/terms/",
  "/privacy": "/privacy/",
  "/refund": "/refund/",
};

const REWRITE = {
  "/": "/consulting/",
  "/terms/": "/consulting/terms/",
  "/privacy/": "/consulting/privacy/",
  "/refund/": "/consulting/refund/",
};

const ROBOTS = `# fhconsulting.online — search and AI crawlers welcome
User-agent: *
Allow: /

User-agent: Googlebot
Allow: /

User-agent: Bingbot
Allow: /

User-agent: GPTBot
Allow: /

User-agent: ChatGPT-User
Allow: /

User-agent: OAI-SearchBot
Allow: /

User-agent: ClaudeBot
Allow: /

User-agent: anthropic-ai
Allow: /

User-agent: Google-Extended
Allow: /

User-agent: PerplexityBot
Allow: /

Sitemap: https://fhconsulting.online/sitemap.xml
`;

const SITEMAP = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>https://fhconsulting.online/</loc>
  </url>
</urlset>
`;

function textResponse(body, contentType) {
  return new Response(body, {
    status: 200,
    headers: { "content-type": contentType },
  });
}

function redirectTo(pathname, search, status) {
  const dest = new URL(pathname, "https://fhconsulting.online");
  dest.search = search;
  return Response.redirect(dest, status);
}

export default async (request, context) => {
  const url = new URL(request.url);
  const host = url.hostname.toLowerCase();
  if (!HOSTS.has(host)) return context.next();

  if (host === "www.fhconsulting.online") {
    url.hostname = "fhconsulting.online";
    return Response.redirect(url, 301);
  }

  // A rewrite calls this function again on /consulting/... . The mark says
  // "already rewritten" so that second pass serves the file instead of 301ing.
  if (request.headers.get(REWRITE_MARK) === "1") return context.next();

  const path = url.pathname || "/";
  if (PASS.has(path)) return context.next();

  if (path === "/robots.txt") return textResponse(ROBOTS, "text/plain; charset=utf-8");
  if (path === "/sitemap.xml") return textResponse(SITEMAP, "application/xml; charset=utf-8");

  if (path === "/consulting" || path.startsWith("/consulting/")) {
    return redirectTo(CLEAN[path] || "/", url.search, 301);
  }

  if (SLASH[path]) return redirectTo(SLASH[path], url.search, 301);

  const file = REWRITE[path];
  if (file) {
    const dest = new URL(request.url);
    dest.pathname = file;
    const headers = new Headers(request.headers);
    headers.set(REWRITE_MARK, "1");
    // context.next(new Request) returns that file as a 200. The address bar
    // stays on the clean path, and this function does not 301 the rewrite.
    return context.next(new Request(dest, {
      method: request.method,
      headers,
      redirect: "manual",
    }));
  }

  return redirectTo("/", url.search, 302);
};

export const config = { path: "/*" };
