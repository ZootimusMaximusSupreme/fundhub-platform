import assert from "node:assert/strict";
import test from "node:test";

import {
  AUTH_HEADER,
  TAKES_PER_PASS,
  makeHandler,
} from "../../netlify/functions/ad-video-worker-background.mjs";

test("the authorized background worker saves and announces one finished fake take", async () => {
  const patches = [];
  const notifications = [];
  const row = {
    id: "11111111-1111-4111-8111-111111111111",
    org_id: "22222222-2222-4222-8222-222222222222",
    status: "rendered",
    ad_id: "84",
    take_no: 1,
    video_kind: "ad",
    height: 1080,
    finished_version: 1,
    finished_url: "https://submagic.example.test/final.mp4",
  };
  const store = {
    async listPending(_db, options = {}) {
      return options.states ? [] : [row];
    },
    async patch(_db, id, fields) {
      patches.push({ id, fields });
      return { id, ...fields };
    },
    async mintApprovalLink() {
      return { token: "fake-approval-token" };
    },
  };
  const env = {
    AD_VIDEO_WORKER_SECRET: "fake-worker-secret",
    PUBLIC_SITE_URL: "https://fundhub.test",
  };
  const handler = makeHandler({
    database: { query: async () => ({ rows: [] }) },
    env,
    sweepOptions: {
      env,
      store,
      naming: {},
      ports: {
        env,
        async saveFinished(savedRow) {
          assert.equal(savedRow.id, row.id);
          return { ok: true, key: "drive:finished-file-1" };
        },
        notify: {
          async send(message) {
            notifications.push(message);
            return { status: "sent" };
          },
        },
      },
    },
  });

  const response = await handler({
    headers: new Headers({ [AUTH_HEADER]: env.AD_VIDEO_WORKER_SECRET }),
  });
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(TAKES_PER_PASS, 10);
  assert.equal(result.ok, true);
  assert.equal(result.detected, 0);
  assert.equal(result.advanced, 1);
  assert.deepEqual(result.per.map(({ from, step, to, ok }) => ({ from, step, to, ok })), [{
    from: "rendered",
    step: "saveFinishedAndNotify",
    to: "awaiting_approval",
    ok: true,
  }]);
  const final = patches.at(-1).fields;
  assert.equal(final.status, "awaiting_approval");
  assert.equal(final.storage_final_key, "drive:finished-file-1");
  assert.match(final.notified_at, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(notifications.length, 1);
  assert.equal(notifications[0].notification.click, row.finished_url);
  assert.deepEqual(
    notifications[0].notification.actions.map((action) => action.label),
    ["Approve", "Reject"],
  );
  assert.match(notifications[0].notification.actions[0].url, /token=fake-approval-token&decision=approve$/);
});
