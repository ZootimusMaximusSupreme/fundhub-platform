// Small helpers the slice 1 route proofs share. Tests only; nothing here is
// product code and nothing here reaches a database or a vendor.
//
// WHY THESE TWO EXIST. A stand-in database cannot run SQL, so a test that only
// checks the parameters it was handed cannot tell whether the SQL still carries
// the company or client condition. And a role gate that is tried with one
// allowed role and one denied role cannot tell a gate that was widened to some
// other role. These two helpers close both holes:
//
//   shelf(rows, clauses)   a stand-in table that answers like the SQL it is
//                          asked: a row is kept only when the SQL TEXT carries
//                          that row's condition. Take the condition out of the
//                          SQL and the other company's row comes back.
//   rolesLetIn(call)       tries every staff role and says which ones got in.

/** Every staff role the app knows (ROLE_SETS.STAFF in src/http/read-api.mjs). */
export const STAFF_ROLES = Object.freeze([
  "owner", "admin", "sales_manager", "closer", "funding_advisor", "csm", "setter", "inquiry_specialist",
]);

/**
 * clause(re, keep): one condition of a stand-in table.
 *   re    matches the SQL text where the condition is written
 *   keep  (row, params, match) => true when the row passes that condition
 * When `re` is not in the SQL, the condition is not applied: the row is kept.
 */
export function clause(re, keep) {
  return { re, keep };
}

/** shelf(rows, clauses) -> a fakeDb answer function (sql, params) => rows. */
export function shelf(rows, clauses) {
  return (sql, params = []) => rows.filter((row) => clauses.every(({ re, keep }) => {
    const match = re.exec(sql);
    return !match || keep(row, params, match);
  }));
}

/** The staff roles whose call was not refused for their role (not 401, not 403), sorted. */
export async function rolesLetIn(call, roles = STAFF_ROLES) {
  const letIn = [];
  for (const role of roles) {
    const status = await call(role);
    if (status !== 401 && status !== 403) letIn.push(role);
  }
  return letIn.sort();
}
