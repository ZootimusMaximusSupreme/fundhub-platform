// POST /api/auth/login  { email, password }
// → 200 { ok, token, expiresAt, staff }  + Set-Cookie fundhub_session
// → 400/401/403/429 { ok:false, error }
//
// GET  /api/auth/login
// → 200 { ok, demo: { enabled:false } }                       switch off
// → 200 { ok, demo: { enabled:true, password, logins:[…] } }  switch on
//
// Thin mount over src/auth/login.mjs — all rate limiting, decoy hashing, and
// session minting live there. This file only speaks HTTP.

import { db, dbTarget } from "../../src/db.mjs";
import { login } from "../../src/auth/login.mjs";
import { loginAccount } from "../../src/auth/account-session.mjs";
import { demoLoginsEnabled, DEMO_ENV_VAR } from "../../src/auth/demo-logins.mjs";
import { demoSwitcherOptions, DEMO_PASSWORD } from "../../src/auth/demo-roster.mjs";
import { safeError } from "../../src/http/health.mjs";

function clientIp(req) {
  const xf = req.headers?.["x-forwarded-for"];
  if (typeof xf === "string" && xf.trim()) return xf.split(",")[0].trim();
  return req.socket?.remoteAddress || null;
}

/* ───────────────────────────────────────────────────────────────────────────
   GET — "what sign-in options does this deploy offer?"
   THE SERVER DECIDES WHETHER THE DEMO PANEL EXISTS. THE BROWSER ONLY DRAWS IT.

   WHY THIS IS A SERVER ANSWER AND NOT A CONSTANT IN THE PAGE. public/login.html
   used to carry the nine addresses and the shared password as a JavaScript
   literal, and hide them behind a <details> the browser rendered unconditionally.
   That is a published credential on a static file: `curl https://…/login.html`
   returns it whether or not DEMO_LOGINS_ENABLED is set, and it stays returned on
   the day the flag is switched off in production because nobody redeploys the
   HTML to take a password out of it. Serving the roster from here means the
   whole panel — every address, the password, the buttons — simply is not in the
   response when the switch is off. Off is nothing to read, not something hidden.

   WHY IT LIVES ON THIS FILE RATHER THAN A NEW ONE. netlify/functions/api.mjs
   holds a hardcoded ROUTES map and a handler absent from it 404s (CLAUDE.md §12
   — it has shipped twice). That file belongs to another workflow in this tree
   and is not edited from here, so a new api/auth/demo-logins.mjs would be
   unreachable. `auth/login` is already routed and ROUTES dispatches on PATH
   ONLY, so every method reaches this handler — GET included, where it was
   answering 405. A GET on the login resource returning the ways you may log in
   is the honest reading of that URL anyway.

   IT AUTHENTICATES NOTHING AND TOUCHES NO DATABASE. It reads one environment
   variable and a frozen array. With the switch off it also reveals nothing: the
   reply is the same two words whether or not any demo row was ever seeded.
   ─────────────────────────────────────────────────────────────────────────── */
function demoOptions(req, res) {
  if (!demoLoginsEnabled(process.env)) {
    // No roster, no addresses, no password. `envVar` is the name of the switch
    // and never its value — it is here so the page can say WHICH variable to
    // set instead of making somebody grep for it.
    return res.status(200).json({ ok: true, demo: { enabled: false, envVar: DEMO_ENV_VAR } });
  }
  return res.status(200).json({
    ok: true,
    demo: {
      enabled: true,
      envVar: DEMO_ENV_VAR,
      // Safe to send precisely BECAUSE the switch is on: these credentials only
      // open demo rows, and demo rows only authenticate while it is on. The
      // moment it is unset this branch stops running and the password stops
      // being served.
      password: DEMO_PASSWORD,
      logins: demoSwitcherOptions()
    }
  });
}

export default async function handler(req, res) {
  if (req.method === "GET") return demoOptions(req, res);

  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }
  res.setHeader("Cache-Control", "no-store");
  const { email, password } = req.body || {};
  const ip = clientIp(req);
  const userAgent = req.headers?.["user-agent"] || null;

  /* LOG THE REAL CAUSE BEFORE IT BECOMES A GENERIC 500.
     netlify/functions/api.mjs:501 already catches any thrown error here,
     scrubs it (safeError — never a host, DSN or password) and answers a
     clean internal_error to the caller. What it does NOT do is put the cause
     anywhere an operator can find it — nothing in this repo has metrics or
     error reporting (CLAUDE.md §12), so a thrown error was previously visible
     nowhere at all. This try/catch adds exactly that, to Netlify's function
     logs only, and then RE-THROWS unchanged so the dispatcher's existing
     scrub-and-500 behaviour is the one and only thing that decides what the
     caller sees. Nothing about the HTTP response changes here. */
  let out;
  try {
    out = await login(db, { email, password, ip, userAgent });
  } catch (err) {
    console.error(
      `auth/login: staff lookup failed — ${safeError(err)}` +
      (err && err.code ? ` (code ${err.code})` : "") +
      ` — connected to ${dbTarget()}`
    );
    throw err;
  }

  // Not a staff member? Try the accounts table. Client, affiliate and partner
  // principals sign in through the SAME endpoint so the frontend has one form,
  // and the response carries `principal` so it knows where to route.
  //
  // Order matters only for speed, not for correctness: the two token spaces are
  // separate tables. A 429 is NOT retried against accounts — a rate limit that
  // can be sidestepped by having the second lookup answer is not a rate limit.
  if (!out.ok && out.status !== 429 && out.status !== 503) {
    let acct;
    try {
      acct = await loginAccount(db, { email, password, ip, userAgent });
    } catch (err) {
      console.error(
        `auth/login: account lookup failed — ${safeError(err)}` +
        (err && err.code ? ` (code ${err.code})` : "") +
        ` — connected to ${dbTarget()}`
      );
      throw err;
    }
    if (acct.ok) {
      return res.status(200).json({
        ok: true,
        token: acct.token,
        expiresAt: acct.expiresAt,
        principal: acct.principal.kind,
        account: acct.principal
      });
    }

    // ONE REFUSAL IS ALLOWED TO OVERTAKE THE STAFF ONE: the demo switch.
    //
    // A demo principal (client/affiliate/partner) has no staff row, so `out` is
    // always the generic 401 from the staff lookup. Returning that would tell
    // the owner "wrong email or password" when the password was in fact right
    // and the only thing missing is DEMO_LOGINS_ENABLED — an hour spent
    // resetting a password that was never wrong. Naming it costs nothing: the
    // demo roster and its password are published in this repo and printed on
    // public/login.html, so this reveals nothing an attacker cannot read.
    //
    // Nothing else is promoted. `account_not_active` and `invalid_credentials`
    // stay swallowed behind the staff 401 exactly as before, because those WOULD
    // turn this form into a membership oracle for real customers.
    if (acct.error === "demo_logins_disabled") {
      return res.status(acct.status || 403).json({
        ok: false, error: acct.error, message: acct.message
      });
    }
  }

  if (!out.ok) {
    if (out.status === 429 && out.retryAfterMinutes) {
      res.setHeader("Retry-After", String(out.retryAfterMinutes * 60));
    }
    // `message` is only ever present on refusals that are safe to explain — at
    // time of writing, the demo switch and nothing else. It is spread rather
    // than always sent so no future refusal leaks detail by default.
    return res.status(out.status || 401).json({
      ok: false, error: out.error, ...(out.message ? { message: out.message } : {})
    });
  }


  const maxAge = Math.max(60, Math.floor((new Date(out.expiresAt).getTime() - Date.now()) / 1000));
  res.setHeader(
    "Set-Cookie",
    `fundhub_session=${encodeURIComponent(out.token)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`
  );
  return res.status(200).json({
    ok: true, token: out.token, expiresAt: out.expiresAt,
    principal: "staff", staff: out.staff
  });
}
