import { test } from "node:test";
import assert from "node:assert/strict";
import { meetingDestination } from "./meeting-link.mjs";

test("meeting destination accepts a real HTTPS room and shows its host", () => {
  assert.deepEqual(meetingDestination("https://meet.google.com/abc-defg-hij"), {
    url: "https://meet.google.com/abc-defg-hij", host: "meet.google.com"
  });
});

test("sign-in, booking, phone, local, and unsafe URLs are not meeting rooms", () => {
  for (const value of [
    "", null, "/portal-login.html", "https://fundhub.ai/portal-login.html",
    "https://apply.fundhub.ai/funding-book-call", "tel:+15551234567",
    "http://meet.google.com/abc", "https://user:pass@meet.google.com/abc",
    "https://localhost/room", "https://127.0.0.1/room", "not a URL"
  ]) assert.equal(meetingDestination(value), null, String(value));
});
