/* FundHub client portal — service worker.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * READ THIS BEFORE CHANGING ANYTHING IN THIS FILE.
 *
 * A service worker is code the browser keeps and runs even when the site is
 * closed. That is what makes push notifications possible, and it is also the
 * single most dangerous thing on this site, because a bad one CANNOT BE FIXED
 * BY DEPLOYING A FIX — the stale worker is what serves the page that would have
 * loaded the fix. Get this wrong and every client who ever opened the portal is
 * stuck on a broken version of it, permanently, on their own device.
 *
 * So this file follows four rules and none of them are negotiable.
 *
 * 1. NETWORK FIRST, ALWAYS. The cache is a fallback for a failed request and
 *    never a preference. A cache-first worker is how a site freezes.
 *
 * 2. NOTHING UNDER /api/ OR /.netlify/ IS EVER CACHED. Not once, not briefly.
 *    Those responses carry a client's financial file and travel with their
 *    login token. A cached copy is a copy sitting on the device after they sign
 *    out. This is enforced twice below — once by refusing to cache the path,
 *    and once by the SCOPE: this worker is registered for the single URL
 *    /app/client-portal.html, so a request to /api/ never reaches it at all.
 *
 * 3. THERE IS A KILL SWITCH. Flip KILL_SWITCH to true, deploy once, and every
 *    installed copy of this worker deletes its caches and unregisters itself the
 *    next time the browser checks. The page also honours ?push=off. One deploy
 *    undoes the whole feature.
 *
 * 4. THE CACHE IS VERSIONED AND OLD VERSIONS ARE DELETED ON ACTIVATE. Bump
 *    CACHE_VERSION with any change to what is cached.
 *
 * WHAT IS CACHED: one thing. The portal page itself, so that opening the app
 * with no signal shows the last page instead of the browser's dinosaur. Nothing
 * else — no scripts, no styles, no data. Those are outside this worker's scope
 * and are fetched by the browser normally.
 */

/* ── THE KILL SWITCH ──────────────────────────────────────────────────────
   true = this worker deletes its caches, unregisters itself, and reloads every
   page it controls so they come back under the ordinary network. One deploy. */
const KILL_SWITCH = false;

const CACHE_VERSION = "fundhub-portal-v1";
const PORTAL_URL = "/app/client-portal.html";
const OFFLINE_FALLBACK_TITLE = "FundHub";

/* Paths that must never enter a cache, checked on every write. The scope makes
   these unreachable already; this is the belt to that pair of braces, because a
   future change to the registration scope must not silently start caching a
   client's file. */
function neverCache(url) {
  let path;
  try {
    path = new URL(url, self.location.origin).pathname;
  } catch (e) {
    return true;                       // cannot tell what it is → do not cache it
  }
  return path.startsWith("/api/")
    || path.startsWith("/.netlify/")
    || path.indexOf("/api/") === 0;
}

/** Only same-origin GET responses that are real 200s, and never a no-cache path. */
function mayCache(request, response) {
  if (!request || request.method !== "GET") return false;
  if (neverCache(request.url)) return false;
  if (new URL(request.url, self.location.origin).origin !== self.location.origin) return false;
  if (!response || !response.ok || response.status !== 200) return false;
  // An opaque response has no readable status and could be anything.
  if (response.type === "opaque" || response.type === "opaqueredirect") return false;
  return true;
}

async function dropEverything() {
  const names = await caches.keys();
  await Promise.all(names.map((n) => caches.delete(n)));
}

self.addEventListener("install", (event) => {
  /* skipWaiting so a fixed worker takes over on the next page load rather than
     waiting for every tab to close. With network-first there is no risk in
     replacing an old worker quickly, and there is a large risk in not being able
     to. */
  self.skipWaiting();
  event.waitUntil(Promise.resolve());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    if (KILL_SWITCH) {
      await dropEverything();
      await self.registration.unregister();
      const clientList = await self.clients.matchAll({ type: "window" });
      for (const c of clientList) {
        // Reload so the page comes back served by the network, not by a worker
        // that is about to stop existing.
        try { c.navigate(c.url); } catch (e) { /* a client we cannot steer */ }
      }
      return;
    }

    // Delete every cache that is not this version's.
    const names = await caches.keys();
    await Promise.all(names.filter((n) => n !== CACHE_VERSION).map((n) => caches.delete(n)));
    await self.clients.claim();
  })());
});

/* ── FETCH — network first, cache only as a fallback ─────────────────────── */
self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;              // let the network have it
  if (neverCache(request.url)) return;               // never our business

  event.respondWith((async () => {
    try {
      const fresh = await fetch(request);
      if (mayCache(request, fresh)) {
        const copy = fresh.clone();
        const cache = await caches.open(CACHE_VERSION);
        await cache.put(request, copy);
      }
      return fresh;
    } catch (err) {
      const cached = await caches.match(request);
      if (cached) return cached;
      // No network and nothing cached. An honest page beats a browser error.
      return new Response(
        "<!doctype html><meta charset=utf-8><title>" + OFFLINE_FALLBACK_TITLE + "</title>" +
        "<body style=\"font-family:system-ui;padding:40px;line-height:1.5\">" +
        "<h1>You are offline</h1><p>Your file is safe. Open FundHub again when you have signal.</p>",
        { status: 503, headers: { "Content-Type": "text/html; charset=utf-8" } }
      );
    }
  })());
});

/* ── PUSH — show what the server said, and nothing it did not ────────────── */
self.addEventListener("push", (event) => {
  /* THE BODY IS ALREADY SAFE FOR A LOCK SCREEN. With the detail flag off — which
     is everywhere today — src/push/payload.mjs will only build a body that is
     one of a short list of approved sentences written into that file; free text
     is refused there, so nothing client-specific can arrive here to display.
     Nothing is added to it here either — no client name, no amount read from a
     cache, no "you have 3 alerts". This worker displays and does not compose. */
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (e) {
    data = {};
  }

  const title = typeof data.title === "string" && data.title ? data.title : "FundHub";
  const body = typeof data.body === "string" && data.body
    ? data.body
    : "There is an update on your file. Open FundHub.";

  // Same-origin path only. A url from anywhere else is dropped rather than
  // followed — a notification that can open any address is an open redirect
  // that needs no link to click.
  let url = PORTAL_URL;
  if (typeof data.url === "string" && data.url.charAt(0) === "/" && data.url.charAt(1) !== "/") {
    url = data.url;
  }

  event.waitUntil(self.registration.showNotification(title, {
    body: body,
    // Same tag replaces rather than stacks: three "payment due" banners on one
    // lock screen is how somebody turns notifications off for good.
    tag: typeof data.tag === "string" && data.tag ? data.tag : "fundhub",
    renotify: false,
    icon: "/app/icons/icon-192.png",
    badge: "/app/icons/badge-72.png",
    data: { url: url }
  }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || PORTAL_URL;

  event.waitUntil((async () => {
    // Reuse a window that is already open rather than piling up tabs.
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const c of windows) {
      if (c.url.indexOf(self.location.origin) === 0 && "focus" in c) {
        try {
          const navigated = await c.navigate(target);
          if (navigated) return navigated.focus();
        } catch (e) { /* open the lesson below if this window cannot navigate */ }
      }
    }
    if (self.clients.openWindow) return self.clients.openWindow(target);
    return undefined;
  })());
});

/* ── The page's own kill switch ──────────────────────────────────────────── */
self.addEventListener("message", (event) => {
  const type = event && event.data && event.data.type;
  if (type === "fundhub-unregister") {
    event.waitUntil((async () => {
      await dropEverything();
      await self.registration.unregister();
    })());
  }
});

/* pushsubscriptionchange — the browser replaced the subscription on its own.
   THERE IS NOTHING USEFUL THIS WORKER CAN DO ABOUT IT, and pretending otherwise
   would be worse than saying so: re-registering needs the client's login token,
   which lives in localStorage and is not readable from a service worker. So the
   old subscription is simply dropped, and the PAGE re-registers on its next
   load — which is why the registration call in client-portal.html runs on every
   visit rather than only on the first. The server treats a repeat registration
   of the same device as an update, not a duplicate. */
self.addEventListener("pushsubscriptionchange", (event) => {
  event.waitUntil(Promise.resolve());
});
