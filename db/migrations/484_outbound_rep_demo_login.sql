-- Add the outreach seat to the existing gated demo roster. Applied seeds 094,
-- 112 and 290 remain unchanged. DEMO_LOGINS_ENABLED still fails closed in both
-- login paths; this file never enables it or changes an existing credential.
DO $$
DECLARE
  v_org uuid;
  v_hash text;
BEGIN
  SELECT id INTO v_org FROM orgs WHERE is_default LIMIT 1;
  IF v_org IS NULL THEN RETURN; END IF;

  SELECT password_hash INTO v_hash FROM staff
   WHERE org_id = v_org AND is_demo = true
     AND lower(email) = 'owner@demo.fundhub.local'
     AND password_hash IS NOT NULL
   LIMIT 1;
  IF v_hash IS NULL THEN RETURN; END IF;

  INSERT INTO staff(org_id,email,name,role,status,password_hash,is_demo)
  SELECT v_org,'outbound@demo.fundhub.local','DEMO Outbound Rep',
         'outbound_rep','active',v_hash,true
   WHERE NOT EXISTS (
     SELECT 1 FROM staff
      WHERE org_id = v_org AND lower(email) = 'outbound@demo.fundhub.local'
   );
END $$;
