import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const root = new URL("../../", import.meta.url);
const source = (path) => readFileSync(new URL(path, root), "utf8");

test("archived clients stay off active staff work screens", () => {
  const routes = [
    "api/dashboard/clients.mjs",
    "api/read/csm-queue.mjs",
    "api/read/documents.mjs",
    "api/read/inbox.mjs",
    "api/read/inquiries.mjs",
    "api/read/invoices.mjs",
    "api/read/search.mjs",
    "api/repair/exceptions.mjs",
    "api/tasks.mjs",
    "src/bookings/store.mjs",
    "src/chat/internal.mjs",
    "src/sales/call-outcomes.mjs",
    "src/sales/closer-deck.mjs",
    "src/sales/closer-now.mjs",
    "src/sales/cockpit.mjs",
    "src/setter/dashboard.mjs",
    "src/repair/cases.mjs",
    "src/inquiry-ops/cases.mjs",
    "src/trials/dashboard.mjs"
  ];

  for (const route of routes) {
    assert.match(source(route), /crm_archived_at/, `${route} must filter archived clients`);
  }
});

test("tasks and bookings keep unlinked rows but exclude archived-client rows", () => {
  const tasks = source("api/tasks.mjs");
  assert.match(tasks, /t\.client_id IS NULL OR c\.id IS NOT NULL/);
  assert.match(tasks, /c\.custom_fields->>'crm_archived_at' IS NULL/);

  const bookings = source("src/bookings/store.mjs");
  assert.match(bookings, /b\.client_id IS NULL OR c\.id IS NOT NULL/);
  assert.match(bookings, /c\.custom_fields->>'crm_archived_at' IS NULL/);
});

test("archived client detail is unavailable to active CRM routes", () => {
  assert.match(source("api/dashboard/client.mjs"), /rows\.client\.custom_fields\?\.crm_archived_at/);
  assert.match(source("src/sales/cockpit.mjs"), /WHERE c\.id = \$1 AND c\.org_id = \$2\s+AND c\.custom_fields->>'crm_archived_at' IS NULL/);
});
