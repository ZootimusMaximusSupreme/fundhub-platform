// fhconsulting.online is a domain alias on the Fundhub Netlify site.
// Without this, the bare domain would show the Fundhub funding homepage.
// Consulting paths stay. Everything else on this host goes to the consulting home.

const HOSTS = new Set(["fhconsulting.online", "www.fhconsulting.online"]);

function allowed(path) {
  return (
    path === "/consulting" ||
    path.startsWith("/consulting/") ||
    path === "/favicon.ico" ||
    path === "/favicon.svg" ||
    path === "/apple-touch-icon.png" ||
    path === "/funnel/rb2b.js"
  );
}

export default async (request, context) => {
  const url = new URL(request.url);
  const host = url.hostname.toLowerCase();
  if (!HOSTS.has(host)) return context.next();

  if (host === "www.fhconsulting.online") {
    url.hostname = "fhconsulting.online";
    return Response.redirect(url, 301);
  }

  const path = url.pathname || "/";
  if (path === "/") {
    return Response.redirect("https://fhconsulting.online/consulting/", 301);
  }
  if (allowed(path)) return context.next();
  return Response.redirect("https://fhconsulting.online/consulting/", 302);
};

export const config = { path: "/*" };
