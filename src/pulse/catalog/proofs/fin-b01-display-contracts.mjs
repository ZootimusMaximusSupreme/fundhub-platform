// Finish-the-853, batch 01: live saved-result checks for the Agent Editor's money
// authority controls. The pulse runs each statement, read only, against the company's
// own agents. A row is "wrong" when the saved authority holds something the editor's
// own Save can never write (a switch that is not on or off, a discount that is not a
// number from 0 to 100). With no agent holding an authority block yet the check is
// green and says so, and it goes red on the first wrong one (emptyAs "quiet").
//
// Nothing here imports the registry (display-saved-result.mjs imports this file).
// The statements are shaped for src/pulse/catalog/proofs/fin-b01-sql-mini.mjs, which
// runs the same text over made-up rows in fin-b01-display-contracts.test.mjs.

function check(control, requirement, key, body) {
  return Object.freeze({
    control,
    mode: "query",
    emptyAs: "quiet",
    requirement,
    sql: `/* display-result:${key} */\n${body.trim()}`,
  });
}

function switchSql(field) {
  return `
SELECT count(*)::int AS sample_count,
       count(*) FILTER (WHERE jsonb_typeof(guardrails->'authority'->'${field}') IS NOT NULL
         AND jsonb_typeof(guardrails->'authority'->'${field}') <> 'boolean')::int AS bad_count
  FROM agents
 WHERE org_id = $1::uuid AND status <> 'retired'
   AND jsonb_typeof(guardrails->'authority') = 'object'`;
}

const DISCOUNT_SQL = `
SELECT count(*)::int AS sample_count,
       count(*) FILTER (WHERE jsonb_typeof(guardrails->'authority'->'disc') IS NOT NULL
         AND (jsonb_typeof(guardrails->'authority'->'disc') <> 'number'
           OR (guardrails->'authority'->>'disc') !~ '^(100([.]0+)?|[0-9]{1,2}([.][0-9]+)?)$'))::int AS bad_count
  FROM agents
 WHERE org_id = $1::uuid AND status <> 'retired'
   AND jsonb_typeof(guardrails->'authority') = 'object'`;

export const FIN_B01_DISPLAY_RESULT_CONTRACTS = Object.freeze([
  check(
    "Authority switch: May take a payment",
    "Every saved agent authority block must hold the take-a-payment switch as a true or false value, never text, a number or null.",
    "agent-authority-pay",
    switchSql("pay"),
  ),
  check(
    "Authority switch: May run a soft pull",
    "Every saved agent authority block must hold the run-a-soft-pull switch as a true or false value, never text, a number or null.",
    "agent-authority-pull",
    switchSql("pull"),
  ),
  check(
    "Authority: Max discount input (percent)",
    "Every saved agent authority block must hold the maximum discount as a number from 0 to 100 percent, never text or more than a full price.",
    "agent-authority-discount",
    DISCOUNT_SQL,
  ),
]);
