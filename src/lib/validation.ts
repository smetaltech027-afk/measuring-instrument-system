import type { InstrumentFormValues } from '../types/instrument';

export interface ValidationErrors {
  name?: string;
  compare_date?: string;
  calibration_date?: string;
  expiry_date?: string;
  status_text?: string;
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isValidCalendarDate(iso: string): boolean {
  if (!ISO_DATE_RE.test(iso)) return false;
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return (
    dt.getUTCFullYear() === y &&
    dt.getUTCMonth() === m - 1 &&
    dt.getUTCDate() === d
  );
}

/**
 * Validate instrument form input.
 * Only `name` is strictly required so real workshop records with optional dates/vendor are never blocked.
 */
export function validateInstrumentForm(values: InstrumentFormValues): ValidationErrors {
  const errors: ValidationErrors = {};

  if (!values.name.trim()) {
    errors.name = 'กรุณากรอกชื่อเครื่องมือวัด';
  } else if (values.name.trim().length > 160) {
    errors.name = 'ชื่อเครื่องมือต้องไม่เกิน 160 ตัวอักษร';
  }

  if (values.compare_date.trim() && !isValidCalendarDate(values.compare_date.trim())) {
    errors.compare_date = 'รูปแบบวันที่ Compare ไม่ถูกต้อง';
  }

  if (values.calibration_date.trim() && !isValidCalendarDate(values.calibration_date.trim())) {
    errors.calibration_date = 'รูปแบบวันที่ Calibration ไม่ถูกต้อง';
  }

  if (values.expiry_date.trim() && !isValidCalendarDate(values.expiry_date.trim())) {
    errors.expiry_date = 'รูปแบบวันที่หมดอายุไม่ถูกต้อง';
  }

  if (values.status_text.trim().length > 60) {
    errors.status_text = 'สถานะต้องไม่เกิน 60 ตัวอักษร';
  }

  return errors;
}

export function normalizeFormPayload(values: InstrumentFormValues) {
  const nullable = (v: string) => {
    const trimmed = v.trim();
    return trimmed === '' ? null : trimmed;
  };
  return {
    name: values.name.trim(),
    size: nullable(values.size),
    location: nullable(values.location),
    status_text: values.status_text.trim() || 'available',
    compare_date: nullable(values.compare_date),
    calibration_date: nullable(values.calibration_date),
    expiry_date: nullable(values.expiry_date),
    vendor: nullable(values.vendor)
  };
}

export const ALLOWED_UPLOAD_MIMES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export const MAX_UPLOAD_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB

export function validateImageFileClient(file: File): string | null {
  if (!ALLOWED_UPLOAD_MIMES.includes(file.type as (typeof ALLOWED_UPLOAD_MIMES)[number])) {
    return 'รองรับเฉพาะไฟล์ภาพ JPG, PNG หรือ WebP (หากเป็นไฟล์ HEIC จาก iPhone กรุณาแปลงเป็น JPG ก่อนค่ะ)';
  }
  if (file.size > MAX_UPLOAD_SIZE_BYTES) {
    return 'ขนาดไฟล์รูปต้องไม่เกิน 5 MB';
  }
  if (file.size === 0) {
    return 'ไฟล์รูปว่างเปล่า กรุณาเลือกไฟล์ใหม่';
  }
  return null;
}

/**
 * Resize large photos on the client (max edge 1600px) before upload to save bandwidth & R2 storage.
 */
export async function compressImageIfNeeded(file: File): Promise<File> {
  if (typeof document === 'undefined' || file.size <= 900 * 1024) {
    return file;
  }

  const bitmap = await createImageBitmap(file);
  const maxDimension = 1600;
  const scale = Math.min(1, maxDimension / Math.max(bitmap.width, bitmap.height));

  if (scale === 1 && file.size <= 1.5 * 1024 * 1024) {
    bitmap.close();
    return file;
  }

  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    bitmap.close();
    return file;
  }
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  const outputType = file.type === 'image/png' ? 'image/png' : 'image/jpeg';
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, outputType, 0.84)
  );
  if (!blob || blob.size >= file.size) return file;

  const ext = outputType === 'image/png' ? 'png' : 'jpg';
  const baseName = file.name.replace(/\.[^.]+$/, '');
  return new File([blob], `${baseName}.${ext}`, { type: outputType });
}
