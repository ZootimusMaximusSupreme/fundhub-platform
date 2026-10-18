import { test } from "node:test";
import assert from "node:assert/strict";
import { meetingDestination } from "./meeting-link.mjs";

test("meeting destination accepts Fundhub's Google Meet and Zoom room shapes", () => {
  assert.deepEqual(meetingDestination("https://meet.google.com/abc-defg-hij"), {
    url: "https://meet.google.com/abc-defg-hij", host: "meet.google.com"
  });
  assert.deepEqual(meetingDestination("https://us02web.zoom.us/j/8841720394?pwd=test-room"), {
    url: "https://us02web.zoom.us/j/8841720394?pwd=test-room", host: "us02web.zoom.us"
  });
  assert.deepEqual(meetingDestination("https://zoom.us/j/9920117744"), {
    url: "https://zoom.us/j/9920117744", host: "zoom.us"
  });
});

test("sign-in, booking, unrelated, and malformed room URLs are not meeting rooms", () => {
  for (const value of [
    "", null, "/portal-login.html", "https://fundhub.ai/portal-login.html",
    "https://apply.fundhub.ai/funding-book-call", "tel:+15551234567",
    "https://calendly.com/advisor/book-a-call", "https://example.com/room",
    "https://zoom.us/signin", "https://zoom.us/j/current-room",
    "https://us02web.zoom.us/profile", "https://evil.zoom.us/j/8841720394",
    "https://meet.google.com/landing", "https://meet.google.com/abc-defg-hij/booking",
    "http://meet.google.com/abc-defg-hij", "https://user:pass@meet.google.com/abc-defg-hij",
    "https://meet.google.com:444/abc-defg-hij",
    "https://localhost/room", "https://127.0.0.1/room", "not a URL"
  ]) assert.equal(meetingDestination(value), null, String(value));
});
