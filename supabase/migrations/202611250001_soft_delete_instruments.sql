-- Measuring Instrument System — Soft Delete Support (Phase 1.1 Approved Scope)
-- Adds `deleted_at` so Admin can delete instruments from active views, exports, QR lookup,
-- and GAS email alerts while preserving audit history (instrument_date_history & reminder_logs).

ALTER TABLE public.instruments
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

COMMENT ON COLUMN public.instruments.deleted_at IS 'Non-null when soft-deleted by Admin; excluded from active lists, Excel exports, public QR, and GAS reminders.';

CREATE INDEX IF NOT EXISTS idx_instruments_active_sort
  ON public.instruments (sort_order ASC, created_at ASC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_instruments_active_expiry
  ON public.instruments (expiry_date ASC)
  WHERE deleted_at IS NULL AND expiry_date IS NOT NULL;

NOTIFY pgrst, 'reload schema';
