-- Measuring Instrument System — Initial Database Schema
-- NOTE: Do NOT apply to production Supabase until approved separately.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Sequence for human-readable permanent label codes (MI-001, MI-002, ...)
CREATE SEQUENCE IF NOT EXISTS public.instrument_code_seq START WITH 1 INCREMENT BY 1;

-- Generate URL-safe 192-bit random public token (32 chars, no + / =)
CREATE OR REPLACE FUNCTION public.generate_public_token()
RETURNS text
LANGUAGE sql
VOLATILE
AS $$
  SELECT replace(replace(replace(encode(gen_random_bytes(24), 'base64'), '+', '-'), '/', '_'), '=', '');
$$;

-- Generate next permanent label code (e.g. MI-001, MI-075)
CREATE OR REPLACE FUNCTION public.generate_instrument_code()
RETURNS text
LANGUAGE sql
VOLATILE
AS $$
  SELECT 'MI-' || lpad(nextval('public.instrument_code_seq')::text, 3, '0');
$$;

-- 1. Authorized Admins (Single admin initially: smetaltech027@gmail.com)
-- Admin registration from web UI is intentionally disabled.
CREATE TABLE IF NOT EXISTS public.app_admins (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE RESTRICT,
  email text NOT NULL UNIQUE CHECK (email = lower(trim(email))),
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.app_admins IS 'Allow-list of Supabase Auth users permitted to administer the instrument registry.';

-- 2. Measuring Instruments Registry
CREATE TABLE IF NOT EXISTS public.instruments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_token text NOT NULL UNIQUE DEFAULT public.generate_public_token()
    CHECK (length(public_token) >= 24 AND public_token ~ '^[A-Za-z0-9_-]+$'),
  instrument_code text NOT NULL UNIQUE DEFAULT public.generate_instrument_code()
    CHECK (length(trim(instrument_code)) > 0),
  sort_order integer NOT NULL DEFAULT 0 CHECK (sort_order >= 0),
  name text NOT NULL CHECK (length(trim(name)) > 0),
  size text,
  location text,
  status_text text NOT NULL DEFAULT 'available' CHECK (length(trim(status_text)) > 0),
  compare_date date,
  calibration_date date,
  expiry_date date,
  vendor text,
  image_key text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.instruments IS 'Master measuring instrument registry. status_text is preserved separately from computed expiry state.';
COMMENT ON COLUMN public.instruments.location IS 'Displayed in UI as สถานที่ใช้งาน/หน่วยงาน and exported to Excel column User.';
COMMENT ON COLUMN public.instruments.public_token IS 'Immutable opaque token embedded in physical QR labels.';

CREATE INDEX IF NOT EXISTS idx_instruments_sort_order
  ON public.instruments (sort_order ASC, created_at ASC);

CREATE INDEX IF NOT EXISTS idx_instruments_expiry_date
  ON public.instruments (expiry_date ASC)
  WHERE expiry_date IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_instruments_code_lower
  ON public.instruments (lower(instrument_code));

-- 3. Audit Trail for Date Changes (compare_date, calibration_date, expiry_date)
CREATE TABLE IF NOT EXISTS public.instrument_date_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  instrument_id uuid NOT NULL REFERENCES public.instruments(id) ON DELETE RESTRICT,
  old_compare_date date,
  new_compare_date date,
  old_calibration_date date,
  new_calibration_date date,
  old_expiry_date date,
  new_expiry_date date,
  changed_at timestamptz NOT NULL DEFAULT now(),
  changed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL
);

COMMENT ON TABLE public.instrument_date_history IS 'Immutable log of changes to compare_date, calibration_date, or expiry_date.';

CREATE INDEX IF NOT EXISTS idx_date_history_instrument_changed
  ON public.instrument_date_history (instrument_id, changed_at DESC);

-- 4. Email Reminder Delivery Log & Deduplication Lock
CREATE TABLE IF NOT EXISTS public.reminder_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  instrument_id uuid NOT NULL REFERENCES public.instruments(id) ON DELETE RESTRICT,
  expiry_date date NOT NULL,
  reminder_type text NOT NULL CHECK (reminder_type IN ('7_day', 'catch_up')),
  status text NOT NULL CHECK (status IN ('pending', 'sent', 'failed')),
  attempt_count integer NOT NULL DEFAULT 1 CHECK (attempt_count >= 1),
  locked_until timestamptz,
  last_attempt_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  error_summary text CHECK (error_summary IS NULL OR length(error_summary) <= 500),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_reminder_instrument_expiry UNIQUE (instrument_id, expiry_date)
);

COMMENT ON TABLE public.reminder_logs IS 'Tracks GAS email reminder attempts per (instrument_id, expiry_date). Changing expiry_date starts a fresh cycle.';

CREATE INDEX IF NOT EXISTS idx_reminder_logs_status_expiry
  ON public.reminder_logs (status, expiry_date);

-- Triggers: default sort_order on insert
CREATE OR REPLACE FUNCTION public.fn_instruments_before_insert()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.sort_order IS NULL OR NEW.sort_order <= 0 THEN
    SELECT COALESCE(MAX(sort_order), 0) + 1
      INTO NEW.sort_order
      FROM public.instruments;
  END IF;
  NEW.name := trim(NEW.name);
  NEW.status_text := COALESCE(NULLIF(trim(NEW.status_text), ''), 'available');
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_instruments_before_insert ON public.instruments;
CREATE TRIGGER trg_instruments_before_insert
  BEFORE INSERT ON public.instruments
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_instruments_before_insert();

-- Triggers: enforce immutable public_token and auto-update updated_at
CREATE OR REPLACE FUNCTION public.fn_instruments_before_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.public_token IS DISTINCT FROM OLD.public_token THEN
    RAISE EXCEPTION 'public_token is immutable and cannot be modified after creation';
  END IF;
  NEW.name := trim(NEW.name);
  NEW.status_text := COALESCE(NULLIF(trim(NEW.status_text), ''), OLD.status_text);
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_instruments_before_update ON public.instruments;
CREATE TRIGGER trg_instruments_before_update
  BEFORE UPDATE ON public.instruments
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_instruments_before_update();

-- Triggers: record date changes automatically into instrument_date_history
CREATE OR REPLACE FUNCTION public.fn_instruments_log_date_changes()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF OLD.compare_date IS DISTINCT FROM NEW.compare_date
     OR OLD.calibration_date IS DISTINCT FROM NEW.calibration_date
     OR OLD.expiry_date IS DISTINCT FROM NEW.expiry_date THEN
    INSERT INTO public.instrument_date_history (
      instrument_id,
      old_compare_date,
      new_compare_date,
      old_calibration_date,
      new_calibration_date,
      old_expiry_date,
      new_expiry_date,
      changed_at,
      changed_by
    ) VALUES (
      NEW.id,
      OLD.compare_date,
      NEW.compare_date,
      OLD.calibration_date,
      NEW.calibration_date,
      OLD.expiry_date,
      NEW.expiry_date,
      now(),
      auth.uid()
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_instruments_log_date_changes ON public.instruments;
CREATE TRIGGER trg_instruments_log_date_changes
  AFTER UPDATE ON public.instruments
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_instruments_log_date_changes();

-- Trigger: keep reminder_logs.updated_at current
CREATE OR REPLACE FUNCTION public.fn_reminder_logs_touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_reminder_logs_updated_at ON public.reminder_logs;
CREATE TRIGGER trg_reminder_logs_updated_at
  BEFORE UPDATE ON public.reminder_logs
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_reminder_logs_touch_updated_at();
