// Fictional local-only staff. No production service, mailbox, or database is connected.
export const fixtureNames = [
  "Alex Morgan", "Jordan Lee", "Sam Rivera", "Taylor Brooks", "Casey Chen",
  "Riley Patel", "Avery Williams", "Drew Thompson", "Morgan Davis", "Blake Wilson",
  "Cameron Anderson", "Reese Martin", "Quinn Garcia", "Parker Robinson", "Hayden Clark",
  "Skyler Rodriguez", "Jamie Lewis", "Rowan Walker", "Finley Hall", "Emerson Allen",
  "Dakota Young", "Harper Hernandez", "Sage King", "Charlie Wright", "Logan Lopez",
  "Sydney Scott", "Alexandria Montgomery-Richardson",
];

export function createFixture() {
  const roles = ["owner", "sales_manager", "closer", "funding_advisor", "inquiry_specialist", "setter", "admin"];
  const staff = fixtureNames.map((name, index) => ({
    id: `preview-${String(index + 1).padStart(2, "0")}`,
    name,
    email: `${name.toLowerCase().replace(/[^a-z]+/g, ".")}@example.test`,
    role: index === 0 ? "owner" : roles[1 + ((index - 1) % 6)],
    status: index > 24 ? "suspended" : index > 20 ? "invited" : "active",
    employee_code: `PREVIEW-${String(index + 1).padStart(2, "0")}`,
    phone: "5550100",
    start_date: "2026-01-12",
    notify_booked_call_sms: index % 3 === 0,
    monitoring_consent_at: index % 4 === 0 ? null : "2026-10-01T15:00:00Z",
    open_shift: index % 3 === 1 ? 1 : 0,
    monitor_events_today: index % 5,
  }));
  return { staff, writes: [], shift: null };
}

export function fixtureResponse(fixture, pathname, method, body = {}, state = "full") {
  if (method === "GET") {
    if (pathname === "/api/auth/session") return { ok: true, principal: "staff", staff: fixture.staff[0] };
    if (pathname === "/api/read/staff") {
      if (state === "error") return { ok: false, error: "Preview roster is unavailable. Refresh to try again.", __status: 503 };
      return { ok: true, items: state === "empty" ? [] : fixture.staff, hiddenCount: 0 };
    }
    if (pathname === "/api/shifts") return { ok: true, shift: fixture.shift };
    if (pathname === "/api/staff/telemetry") return {
      ok: true,
      staff: { monitoring_on: true, monitoring_consent_at: "2026-10-01T15:00:00Z" },
      hours: { payable_hours: 6.25 },
      activity: { avg_overall: 82, activity_samples: 3, screenshot_samples: 1, recent: [{ kind: "monitor_activity", created_at: "2026-10-20T10:00:00Z", detail: { overall: 82 } }] },
      shifts: [{ started_at: "2026-10-20T08:00:00Z", ended_at: null, open: true }],
    };
    return { ok: true, items: [] };
  }
  // Every mutation below is restricted to these in-memory, fictional rows.
  fixture.writes.push({ pathname, body });
  const person = fixture.staff.find(row => row.id === body.staff_id);
  if (pathname === "/api/auth/staff-update" && person) {
    for (const key of ["name", "email", "phone", "start_date", "notify_booked_call_sms"]) {
      if (Object.hasOwn(body, key)) person[key] = body[key];
    }
    return { ok: true, staff: person };
  }
  if (pathname === "/api/auth/staff-role" && person) {
    person.role = body.role;
    return { ok: true, staff: person };
  }
  if (pathname === "/api/staff/monitoring-consent" && person) {
    person.monitoring_consent_at = body.action === "grant" ? "2026-10-20T12:00:00Z" : null;
    return { ok: true, staff: { monitoring_on: !!person.monitoring_consent_at, monitoring_consent_at: person.monitoring_consent_at } };
  }
  if (pathname === "/api/shifts") {
    fixture.shift = body.action === "clock_in" ? { id: "preview-shift", started_at: "2026-10-20T12:00:00Z" } : null;
    return { ok: true, shift: fixture.shift };
  }
  if (pathname === "/api/auth/suspend" && person) {
    person.status = "suspended";
    return { ok: true };
  }
  if (pathname === "/api/auth/admin-reset") return { ok: true, resetPath: "/__comparison/preview-reset-only" };
  if (pathname === "/api/auth/invite") return { ok: true, email: "new.person@example.test", invitePath: "/__comparison/preview-invite-only", mailed: false };
  return { ok: false, error: "This action is not connected in the local design preview.", __status: 405 };
}
