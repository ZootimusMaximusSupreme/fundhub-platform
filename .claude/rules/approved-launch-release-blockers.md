# Approved launch includes the release checks

**Owner law (2026-10-17):** If Chris has approved a launch, said “ship,” or said “go live after checks pass,” each failure in the required release checks is part of that named task. Do not ask again whether to repair it, even if the failing code or test is in an adjacent file.

- Reproduce the failure, make the smallest real fix, and rerun the check. Preserve failing evidence until the check genuinely passes.
- A new file, route, field, or test fixture needed for that repair is included in the approval if it preserves the approved behavior. Do not weaken, skip, or delete checks to make them green.
- Keep unrelated warnings, optional improvements, and backlog work out of the launch. Put those on the shared board as leftovers.
- This rule does not approve changes to live customer data, money, credentials, or a new product decision. Routine in-scope account access follows the standing owner authorization in `owner-authorized-account-ops.md`; ask only for truly missing authority or information.
- Once the checks pass and go-live was approved, continue through the release and verify the live result. Never call an unverified release live.

Example: a browser check for the approved app fails in another screen. Repair that failure and rerun the check; do not send Chris “May I fix this other test?”
