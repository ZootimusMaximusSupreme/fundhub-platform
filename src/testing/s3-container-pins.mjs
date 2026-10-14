// The clauses the containers page's reads depend on (src/finance/containers.mjs and
// src/finance/business-info.mjs), written once so every proof that runs the page
// pins the same words. A stand-in that answers by table name cannot see a lost
// company or client condition; the text it was sent can.
import { assertSqlHas } from "./s3-scoped-rows.mjs";

/** `sqlOf(re)` returns the text of the first statement matching `re`. */
export function assertContainerReads(sqlOf) {
  assertSqlHas(sqlOf(/FROM entities\s+WHERE org_id = \$1 AND client_id = \$2\s+ORDER BY/), {
    "this company and client, live ones first": "WHERE org_id = $1 AND client_id = $2 ORDER BY archived_at NULLS FIRST, kind DESC, name, id"
  });
  assertSqlHas(sqlOf(/FROM bank_accounts\s+WHERE org_id = \$1 AND client_id = \$2\s+ORDER BY name/), {
    "this company and client": "WHERE org_id = $1 AND client_id = $2 ORDER BY name NULLS LAST, id"
  });
  assertSqlHas(sqlOf(/FROM tradelines\s+WHERE org_id = \$1 AND client_id = \$2\s+ORDER BY lender/), {
    "this company and client": "WHERE org_id = $1 AND client_id = $2 ORDER BY lender, id"
  });
  assertSqlHas(sqlOf(/FROM recurring_bills rb/), {
    "the bill lands in its own container, or its account's": "COALESCE(rb.entity_id, ba.entity_id) AS container_id",
    "the account joined inside the company": "LEFT JOIN bank_accounts ba ON ba.id = rb.bank_account_id AND ba.org_id = rb.org_id",
    "this company and client": "WHERE rb.org_id = $1 AND rb.client_id = $2"
  });
  assertSqlHas(sqlOf(/count\(\*\)::int AS n\s+FROM entities e/), {
    "live containers of this company and client that hold something":
      "WHERE e.org_id = $1 AND e.client_id = $2 AND e.archived_at IS NULL AND ( EXISTS (SELECT 1 FROM bank_accounts ba WHERE ba.entity_id = e.id AND ba.org_id = e.org_id AND ba.closed_at IS NULL) OR EXISTS (SELECT 1 FROM tradelines t WHERE t.entity_id = e.id AND t.org_id = e.org_id) )"
  });
}
