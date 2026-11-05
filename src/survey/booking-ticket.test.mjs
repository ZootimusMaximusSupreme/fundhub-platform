import { test } from "node:test";
import assert from "node:assert/strict";
import { BOOKING_TICKET_TTL_MS, mintBookingTicket, validBookingTicket } from "./booking-ticket.mjs";

const SECRET = "unit-test-booking-ticket-secret-0123456789abcdef";
const NOW = Date.parse("2026-11-05T08:00:00Z");

test("a saved-completion ticket is opaque, short-lived and separate from an email resume code", () => {
  const token = mintBookingTicket({ now: NOW, secret: SECRET, random: () => Buffer.alloc(12, 7) });
  assert.match(token, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(validBookingTicket(token, { now: NOW, secret: SECRET }), true);
  assert.equal(validBookingTicket(token, { now: NOW + BOOKING_TICKET_TTL_MS, secret: SECRET }), true);
  assert.equal(validBookingTicket(token, { now: NOW + BOOKING_TICKET_TTL_MS + 1000, secret: SECRET }), false);
  assert.equal(validBookingTicket(token, { now: NOW - 1000, secret: SECRET }), false);
  assert.equal(validBookingTicket(token, { now: NOW, secret: `${SECRET}-wrong` }), false);
  assert.equal(validBookingTicket(token.slice(0, -1) + (token.at(-1) === "A" ? "B" : "A"),
    { now: NOW, secret: SECRET }), false);
  assert.equal(validBookingTicket(token + "x", { now: NOW, secret: SECRET }), false);
  assert.equal(validBookingTicket("", { now: NOW, secret: SECRET }), false);
  assert.equal(validBookingTicket(token, { now: NOW, env: {} }), false);
});

test("each new completion gets a different ticket", () => {
  assert.notEqual(mintBookingTicket({ now: NOW, secret: SECRET }), mintBookingTicket({ now: NOW, secret: SECRET }));
});
