// Jev slot (TypeSafe AI decision model) for the router. Built, NOT wired, OFF by default.
//
// Owner call 2026-10-20: build the slot, leave it off; Chris does not want to pay for Jev yet.
// It only switches on when BOTH MAC_BRIDGE_JEV=on AND JEV_API_KEY are set.
//
// While off, nothing here touches the network. This file imports no network
// module on purpose, and a test checks that.
//
// STUB: Jev's real API is not written down anywhere in this repo, so nothing is
// invented here. If someone switches Jev on, pick() throws "jev not wired" and the
// router falls back to the repo rules.

export function jevEnabled(env = process.env) {
  return env.MAC_BRIDGE_JEV === 'on' && typeof env.JEV_API_KEY === 'string' && env.JEV_API_KEY.length > 0;
}

/** Pick claude or codex. Returns null when Jev is off. STUB when on. */
export async function jevPick(_prompt, { env = process.env } = {}) {
  if (!jevEnabled(env)) return null;
  throw new Error('jev not wired');
}
