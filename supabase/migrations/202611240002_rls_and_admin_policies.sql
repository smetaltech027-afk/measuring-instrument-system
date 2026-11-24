-- Measuring Instrument System — Row Level Security & Least-Privilege Grants
-- NOTE: Do NOT apply to production Supabase until approved separately.

-- Helper function to verify Admin membership cleanly without recursive RLS issues
CREATE OR REPLACE FUNCTION public.is_app_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.app_admins
    WHERE user_id = auth.uid()
  );
$$;

REVOKE ALL ON FUNCTION public.is_app_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_app_admin() TO authenticated, service_role;

-- Revoke all direct privileges from anon & public
REVOKE ALL ON TABLE public.app_admins FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.instruments FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.instrument_date_history FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.reminder_logs FROM PUBLIC, anon, authenticated;
REVOKE ALL ON SEQUENCE public.instrument_code_seq FROM PUBLIC, anon, authenticated;

-- Grant only minimal required privileges to authenticated role (still gated by RLS)
-- Note: DELETE is intentionally NOT granted to authenticated in Phase 1 scope.
GRANT SELECT ON TABLE public.app_admins TO authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.instruments TO authenticated;
GRANT SELECT ON TABLE public.instrument_date_history TO authenticated;
GRANT SELECT ON TABLE public.reminder_logs TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.instrument_code_seq TO authenticated;

-- Ensure server-side service_role (used strictly inside Cloudflare Worker / live import) retains access
GRANT ALL ON TABLE public.app_admins TO service_role;
GRANT ALL ON TABLE public.instruments TO service_role;
GRANT ALL ON TABLE public.instrument_date_history TO service_role;
GRANT ALL ON TABLE public.reminder_logs TO service_role;
GRANT ALL ON SEQUENCE public.instrument_code_seq TO service_role;

-- Enable & Force RLS on all application tables
ALTER TABLE public.app_admins ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_admins FORCE ROW LEVEL SECURITY;

ALTER TABLE public.instruments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.instruments FORCE ROW LEVEL SECURITY;

ALTER TABLE public.instrument_date_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.instrument_date_history FORCE ROW LEVEL SECURITY;

ALTER TABLE public.reminder_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reminder_logs FORCE ROW LEVEL SECURITY;

-- Policies for app_admins: authenticated users can only check their own row
DROP POLICY IF EXISTS app_admins_select_self ON public.app_admins;
CREATE POLICY app_admins_select_self
  ON public.app_admins
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

-- Policies for instruments: only verified app_admins can SELECT / INSERT / UPDATE
DROP POLICY IF EXISTS instruments_admin_select ON public.instruments;
CREATE POLICY instruments_admin_select
  ON public.instruments
  FOR SELECT
  TO authenticated
  USING (public.is_app_admin());

DROP POLICY IF EXISTS instruments_admin_insert ON public.instruments;
CREATE POLICY instruments_admin_insert
  ON public.instruments
  FOR INSERT
  TO authenticated
  WITH CHECK (public.is_app_admin());

DROP POLICY IF EXISTS instruments_admin_update ON public.instruments;
CREATE POLICY instruments_admin_update
  ON public.instruments
  FOR UPDATE
  TO authenticated
  USING (public.is_app_admin())
  WITH CHECK (public.is_app_admin());

-- Policies for instrument_date_history: read-only for verified app_admins
-- Inserts happen strictly via SECURITY DEFINER trigger on public.instruments
DROP POLICY IF EXISTS date_history_admin_select ON public.instrument_date_history;
CREATE POLICY date_history_admin_select
  ON public.instrument_date_history
  FOR SELECT
  TO authenticated
  USING (public.is_app_admin());

-- Policies for reminder_logs: read-only for verified app_admins
-- Writes happen strictly via Cloudflare Worker using service_role key
DROP POLICY IF EXISTS reminder_logs_admin_select ON public.reminder_logs;
CREATE POLICY reminder_logs_admin_select
  ON public.reminder_logs
  FOR SELECT
  TO authenticated
  USING (public.is_app_admin());

-- Refresh PostgREST schema cache immediately
NOTIFY pgrst, 'reload schema';
