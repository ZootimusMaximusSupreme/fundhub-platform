import { test } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../..");

test("invite and suspend are owner/admin gates and use the existing auth module", () => {
  const invite = fs.readFileSync(path.join(ROOT, "api/auth/invite.mjs"), "utf8");
  const suspend = fs.readFileSync(path.join(ROOT, "api/auth/suspend.mjs"), "utf8");
  const routes = fs.readFileSync(path.join(ROOT, "netlify/functions/api.mjs"), "utf8");
  assert.ok(invite.includes('requireRole("owner", "admin")'));
  assert.ok(invite.includes("inviteStaff"));
  assert.ok(invite.includes("suggestCompanyEmail"));
  assert.ok(invite.includes("cannot_invite_owner"));
  assert.ok(suspend.includes('requireRole("owner", "admin")'));
  assert.ok(suspend.includes("suspendStaff"));
  assert.ok(suspend.includes("staff.org_id") || suspend.includes("actor: staff"));
  assert.ok(routes.includes('"auth/invite"'));
  assert.ok(routes.includes('"auth/staff-role"'));
  assert.ok(routes.includes('"auth/staff-update"'));
  assert.ok(routes.includes('"auth/suspend"'));
});

test("staff-update is owner/admin and uses updateStaffProfile", () => {
  const update = fs.readFileSync(path.join(ROOT, "api/auth/staff-update.mjs"), "utf8");
  assert.ok(update.includes('requireRole("owner", "admin")'));
  assert.ok(update.includes("updateStaffProfile"));
});

test("staff-role is owner/admin and uses setStaffRole", () => {
  const role = fs.readFileSync(path.join(ROOT, "api/auth/staff-role.mjs"), "utf8");
  assert.ok(role.includes('requireRole("owner", "admin")'));
  assert.ok(role.includes("setStaffRole"));
});

test("reset confirm accepts invite tokens so the copy-link works", () => {
  const reset = fs.readFileSync(path.join(ROOT, "api/auth/reset.mjs"), "utf8");
  assert.ok(reset.includes("setPasswordWithToken"));
});

test("staff roster hides seed furniture", () => {
  const src = fs.readFileSync(path.join(ROOT, "api/read/staff.mjs"), "utf8");
  assert.ok(src.includes("SEED_FURNITURE_EMAILS"));
  assert.ok(src.includes("DEMO %"));
  assert.ok(src.includes("hiddenCount"));
});

test("staff-teams persists a role change and tells how many people are hidden", () => {
  const html = fs.readFileSync(path.join(ROOT, "public/app/staff-teams.html"), "utf8");
  assert.ok(html.includes("/api/auth/staff-role"));
  assert.ok(html.includes("/api/auth/staff-update"));
  assert.ok(html.includes("hiddenLine"));
  assert.ok(html.includes("notify_email"));
  assert.ok(html.includes("Lead alerts"));
  assert.ok(!html.includes("ed_booked_sms"));
  assert.ok(html.includes("7 days"));
  assert.ok(html.includes("1 hour"));
});

test("invite and reset send through Resend and keep the copy-link", () => {
  const invite = fs.readFileSync(path.join(ROOT, "api/auth/invite.mjs"), "utf8");
  const reset = fs.readFileSync(path.join(ROOT, "api/auth/reset.mjs"), "utf8");
  assert.ok(invite.includes("sendStaffCredentialEmail"));
  assert.ok(invite.includes("mailed"));
  assert.ok(reset.includes("sendStaffCredentialEmail"));
  assert.ok(reset.includes("mailed"));
});

test("login forgot-password does not claim a link is on its way", () => {
  const html = fs.readFileSync(path.join(ROOT, "public/login.html"), "utf8");
  assert.ok(!/on its way/.test(html));
  assert.ok(html.includes("Nothing was sent. Ask an owner or admin for a reset link."));
  assert.ok(html.includes("Reset links last 1 hour"));
});

test("reset-password page names both link lifetimes", () => {
  const html = fs.readFileSync(path.join(ROOT, "public/reset-password.html"), "utf8");
  assert.ok(html.includes("Invite links last 7 days"));
  assert.ok(html.includes("Reset links last 1 hour"));
});
