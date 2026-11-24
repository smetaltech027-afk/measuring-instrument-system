export interface PublicInstrument {
  instrument_code: string;
  public_token: string;
  name: string;
  size: string | null;
  location: string | null;
  status_text: string;
  compare_date: string | null;
  calibration_date: string | null;
  expiry_date: string | null;
  vendor: string | null;
  has_image: boolean;
  image_url: string | null;
}

export interface Instrument {
  id: string;
  public_token: string;
  instrument_code: string;
  sort_order: number;
  name: string;
  size: string | null;
  location: string | null;
  status_text: string;
  compare_date: string | null;
  calibration_date: string | null;
  expiry_date: string | null;
  vendor: string | null;
  image_key: string | null;
  created_at: string;
  updated_at: string;
}

export interface InstrumentDateHistory {
  id: string;
  instrument_id: string;
  old_compare_date: string | null;
  new_compare_date: string | null;
  old_calibration_date: string | null;
  new_calibration_date: string | null;
  old_expiry_date: string | null;
  new_expiry_date: string | null;
  changed_at: string;
  changed_by: string | null;
}

export interface ReminderLog {
  id: string;
  instrument_id: string;
  expiry_date: string;
  reminder_type: '7_day' | 'catch_up';
  status: 'pending' | 'sent' | 'failed';
  attempt_count: number;
  last_attempt_at: string;
  sent_at: string | null;
  error_summary: string | null;
}

export interface InstrumentFormValues {
  name: string;
  size: string;
  location: string;
  status_text: string;
  compare_date: string;
  calibration_date: string;
  expiry_date: string;
  vendor: string;
}

export type ExpiryStateCode =
  | 'expired'
  | 'expires_today'
  | 'expiring_soon'
  | 'valid'
  | 'unset';

export interface ExpiryStateInfo {
  code: ExpiryStateCode;
  label: string;
  detailText: string;
  daysRemaining: number | null;
}
