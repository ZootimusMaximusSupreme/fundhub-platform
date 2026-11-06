BEGIN;

-- Verified full-package provider callbacks carry this SKU, not the vendor's
-- shared checkout title. resolve_product_id resolves names and aliases.
INSERT INTO product_aliases (org_id,product_id,alias,source)
SELECT org_id,id,code,'manual' FROM products WHERE code='blueprint-self-funding'
ON CONFLICT (org_id,lower(alias)) DO NOTHING;

-- Recover only an already-granted, still-active, exact full SKU receipt that
-- predated the alias. A generic provider display title never qualifies here.
INSERT INTO blueprint_fulfillment_engagements(org_id,client_id,source_transaction_id,source_entitlement_id)
SELECT e.org_id,e.client_id,t.id,e.id FROM entitlements e
JOIN transactions t ON t.id=e.source_transaction_id AND t.org_id=e.org_id AND t.client_id=e.client_id
JOIN products p ON p.id=resolve_product_id(t.org_id,t.product_name) AND p.org_id=t.org_id
WHERE e.entitlement_code='blueprint-client-fulfillment' AND e.revoked_at IS NULL
  AND t.product_name='blueprint-self-funding' AND p.code=t.product_name AND lower(btrim(t.status))='succeeded'
ON CONFLICT DO NOTHING;

COMMIT;
