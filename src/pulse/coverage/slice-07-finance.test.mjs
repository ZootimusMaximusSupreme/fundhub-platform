import test from "node:test";
import assert from "node:assert/strict";

import {
  SWEEP_CRON as PULL_CRON,
  SOURCE_WORKFLOW as PULL_ID
} from "../../workflows/finance-os-pull-sweeper.mjs";
import {
  SWEEP_CRON as CARD_DUE_CRON,
  SOURCE_WORKFLOW as CARD_DUE_ID
} from "../../workflows/finance-os-card-due-reminders.mjs";
import {
  SWEEP_CRON as MONEY_AGENT_CRON,
  SOURCE_WORKFLOW as MONEY_AGENT_ID
} from "../../workflows/finance-os-money-agent.mjs";
import {
  SWEEP_CRON as TRENDS_CRON,
  SOURCE_WORKFLOW as TRENDS_ID
} from "../../workflows/finance-os-trend-snapshots.mjs";
import {
  SWEEP_CRON as TRANSFERS_CRON,
  SOURCE_WORKFLOW as TRANSFERS_ID
} from "../../workflows/finance-os-money-transfers.mjs";
import {
  SWEEP_CRON as BLUEPRINT_ALERTS_CRON,
  SOURCE_WORKFLOW as BLUEPRINT_ALERTS_ID
} from "../../workflows/blueprint-finance-os-alerts.mjs";

import { CHECKS, SLICE_ID, gaps } from "./slice-07-finance.mjs";

const EXPECTED_IDS = [
  PULL_ID,
  CARD_DUE_ID,
  MONEY_AGENT_ID,
  TRENDS_ID,
  TRANSFERS_ID,
  BLUEPRINT_ALERTS_ID
];

test("slice 07-finance: slice id and six Finance OS workflows", () => {
  assert.equal(SLICE_ID, "07-finance");
  assert.deepEqual(CHECKS.map((row) => row.id), EXPECTED_IDS);
});

test("slice 07-finance: every id is set and redAfter is 3x schedule", () => {
  assert.equal(CHECKS.length, 6);
  for (const row of CHECKS) {
    assert.equal(typeof row.id, "string");
    assert.ok(row.id.length > 0);
    assert.equal(typeof row.schedule, "string");
    assert.equal(typeof row.redAfter, "string");
    assert.match(row.redAfter, /^3x \S+$/);
    assert.equal(row.redAfter, `3x ${row.schedule}`);
    assert.equal(typeof row.alreadyInRegistry, "boolean");
    assert.equal(typeof row.proof, "string");
    assert.ok(row.proof.length > 0);
  }
});

test("slice 07-finance: crons match workflow modules", () => {
  assert.equal(PULL_CRON, "0 6 * * *");
  assert.equal(CARD_DUE_CRON, "0 16 * * *");
  assert.equal(MONEY_AGENT_CRON, "30 16 * * *");
  assert.equal(TRENDS_CRON, "30 7 * * *");
  assert.equal(TRANSFERS_CRON, "*/15 * * * *");
  assert.equal(BLUEPRINT_ALERTS_CRON, "30 7 * * *");
});

test("slice 07-finance: every job has a registry door; gaps is empty", () => {
  for (const row of CHECKS) {
    assert.equal(row.alreadyInRegistry, true, row.id);
    assert.equal(row.proof, "PASS", row.id);
  }
  assert.deepEqual(gaps(), []);
});
