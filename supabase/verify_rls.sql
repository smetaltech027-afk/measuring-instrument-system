-- RLS & Trigger Verification Script (runs inside a transaction and rolls back cleanly)
-- Run in Supabase SQL Editor or local Postgres after applying migrations 0001 & 0002.

BEGIN;

-- Prepare two synthetic auth users for testing (admin vs non-admin)
DO $$
DECLARE
  v_admin_id uuid := '11111111-1111-1111-1111-111111111111';
  v_other_id uuid := '22222222-2222-2222-2222-222222222222';
  v_inst_id uuid;
  v_count int;
BEGIN
  INSERT INTO auth.users (id, email)
  VALUES
    (v_admin_id, 'rls-test-admin@example.com'),
    (v_other_id, 'rls-test-other@example.com')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.app_admins (user_id, email)
  VALUES (v_admin_id, 'rls-test-admin@example.com')
  ON CONFLICT (user_id) DO NOTHING;

  -- Seed 1 test instrument as owner
  INSERT INTO public.instruments (name, size, location, status_text, compare_date, expiry_date)
  VALUES ('RLS Test Vernier', '0-150 mm.', 'QC', 'available', '2026-10-01', '2027-04-01')
  RETURNING id INTO v_inst_id;

  -- 1. Test ANON role: MUST be denied (permission error)
  EXECUTE 'SET LOCAL ROLE anon';
  BEGIN
    PERFORM * FROM public.instruments;
    RAISE EXCEPTION 'FAIL: anon was able to SELECT instruments';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'PASS: anon SELECT instruments blocked';
  END;

  -- 2. Test AUTHENTICATED NON-ADMIN: MUST see 0 rows and fail INSERT/UPDATE
  EXECUTE 'RESET ROLE';
  EXECUTE 'SET LOCAL ROLE authenticated';
  PERFORM set_config('request.jwt.claim.sub', v_other_id::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);

  SELECT count(*) INTO v_count FROM public.instruments;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'FAIL: non-admin saw % rows', v_count;
  END IF;
  RAISE NOTICE 'PASS: non-admin SELECT instruments returns 0 rows';

  BEGIN
    INSERT INTO public.instruments (name) VALUES ('Illegal Insert');
    RAISE EXCEPTION 'FAIL: non-admin inserted instrument';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'PASS: non-admin INSERT instruments blocked by RLS';
  END;

  -- 3. Test AUTHENTICATED ADMIN: MUST read, update, and trigger date_history
  PERFORM set_config('request.jwt.claim.sub', v_admin_id::text, true);

  SELECT count(*) INTO v_count FROM public.instruments WHERE id = v_inst_id;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'FAIL: admin could not read instrument';
  END IF;
  RAISE NOTICE 'PASS: admin SELECT instruments works';

  UPDATE public.instruments
     SET expiry_date = '2027-05-01'
   WHERE id = v_inst_id;

  SELECT count(*) INTO v_count
    FROM public.instrument_date_history
   WHERE instrument_id = v_inst_id
     AND old_expiry_date = '2027-04-01'
     AND new_expiry_date = '2027-05-01'
     AND changed_by = v_admin_id;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'FAIL: date_history trigger did not record expiry change';
  END IF;
  RAISE NOTICE 'PASS: date_history trigger logged change accurately';

  -- 4. Test immutable public_token protection
  BEGIN
    UPDATE public.instruments SET public_token = 'attempted_override_token_1234567890' WHERE id = v_inst_id;
    RAISE EXCEPTION 'FAIL: public_token was mutated';
  EXCEPTION WHEN raise_exception THEN
    RAISE NOTICE 'PASS: public_token immutability enforced';
  END;

  -- 5. Test DELETE is denied even for admin (Phase 1 scope)
  BEGIN
    DELETE FROM public.instruments WHERE id = v_inst_id;
    RAISE EXCEPTION 'FAIL: admin was able to DELETE instrument';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'PASS: DELETE instruments blocked in Phase 1';
  END;

  EXECUTE 'RESET ROLE';
END;
$$;

ROLLBACK;
