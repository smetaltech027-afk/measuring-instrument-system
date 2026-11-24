export interface PhotoBucketObject {
  body: ReadableStream | ArrayBuffer | Uint8Array<ArrayBuffer> | string | null;
  httpMetadata?: {
    contentType?: string;
  };
}

export interface PhotoBucket {
  get(key: string): Promise<PhotoBucketObject | null>;
  put(
    key: string,
    value: ArrayBuffer | ArrayBufferView | ReadableStream | string,
    options?: {
      httpMetadata?: { contentType?: string };
      customMetadata?: Record<string, string>;
    }
  ): Promise<unknown>;
}

export interface Env {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  GAS_REMINDER_SECRET: string;
  ALLOWED_ORIGINS?: string;
  REMINDER_TIMEZONE?: string;
  REMINDER_MAX_ATTEMPTS?: string;
  INSTRUMENT_PHOTOS: PhotoBucket;
}

export interface InstrumentRow {
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
}

export interface PublicInstrumentResponse {
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

export interface ReminderLogRow {
  id: string;
  instrument_id: string;
  expiry_date: string;
  reminder_type: '7_day' | 'catch_up';
  status: 'pending' | 'sent' | 'failed';
  attempt_count: number;
  locked_until: string | null;
  last_attempt_at: string;
  sent_at: string | null;
  error_summary: string | null;
}
