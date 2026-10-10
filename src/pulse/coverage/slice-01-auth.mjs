// Auth doors for the 7:00 a.m. pulse. Report only. Never auto-fix.
// A job is red after 3 times its schedule. A GET door is red when its
// morning ping is missing from the registry.

import { coverageKey, PULSE_REGISTRY } from "../registry.mjs";

export const SLICE_ID = "01-auth";

const listed = new Set(PULSE_REGISTRY.map((row) => coverageKey(row)));

function door(id) {
  const alreadyInRegistry = listed.has(id);
  return {
    id,
    schedule: "daily",
    redAfter: "3x daily",
    alreadyInRegistry,
    proof: alreadyInRegistry
      ? "PASS"
      : `Add route key ${id}.`
  };
}

export const CHECKS = [
  door("auth/login"),
  door("auth/logout"),
  door("auth/session"),
  door("auth/magic-link"),
  door("auth/magic-link-verify"),
  door("auth/invite"),
  door("auth/reset"),
  door("auth/admin-reset"),
  door("auth/staff-role"),
  door("auth/suspend")
];
