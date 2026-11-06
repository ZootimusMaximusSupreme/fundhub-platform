-- The full package has its own immutable agreement identity and price.
-- Clone the current approved base wording. Existing sent agreements are untouched.
INSERT INTO contract_templates (
  org_id, template_key, name, kind, subtype, body, manual_fields,
  signature_required, signature_statement, created_by
)
SELECT org_id, 'BLUEPRINT-SELF-FUNDING-AGREEMENT', 'Capital Blueprint Full Agreement',
  kind, 'blueprint_self_funding',
  replace(body, 'CAPITAL BLUEPRINT AGREEMENT', 'CAPITAL BLUEPRINT FULL AGREEMENT') || E'\n\n'
  || E'FULL PACKAGE SERVICE SCOPE\n'
  || E'This section governs the full-package service and replaces any preparation-only scope in this agreement. '
  || E'Your agreed package fee is {{field.package_fee}}, charged one time. '
  || E'Fundhub provides client access to its repair, inquiry-removal, optimization and funding workflows for your purchased funding engagement. '
  || E'You perform the required actions, submit your documents and disputes, and apply directly to lenders using your own device and account. '
  || E'Your current file and the system\'s evidence checks determine the next permitted step, lender and waiting period. '
  || E'You may authorize the available AI agents to contact a bureau about your own supported case. '
  || E'I authorize Fundhub to prepare repair and inquiry dispute letters and to make AI-assisted bureau calls on my behalf. '
  || E'The Fundhub team monitors progress and handles exceptions. '
  || E'The package includes one soft credit report per 30-day allowance window while this engagement is active. '
  || E'Additional reports and optional team-run repair, inquiry-removal or funding services require a separate price, accepted terms and confirmed payment. '
  || E'Financing, when offered, is governed by the payment provider\'s separately accepted terms. '
  || E'The active full-package funding service and its included report schedule end when the purchased funding engagement is completed. '
  || E'Your saved application, bureau and service history remains available under the account\'s record-access rules. '
  || E'There is no automatic purchase or charge for another funding engagement. '
  || E'Fundhub does not promise lender approval, a funding amount, removal of an item, or a credit-score change.\n'
  || E'Total agreed full-package fee: {{field.package_fee}}.\n',
  '[]'::jsonb, signature_required, signature_statement, created_by
FROM contract_templates
WHERE template_key = 'CAPITAL-BLUEPRINT-AGREEMENT'
ON CONFLICT (org_id, template_key) DO NOTHING;
