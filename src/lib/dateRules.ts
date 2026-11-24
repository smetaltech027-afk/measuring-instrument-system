import type { ExpiryStateInfo } from '../types/instrument';

/**
 * UI threshold (days) for displaying the amber "ใกล้หมดอายุ" badge.
 * Note: GAS email alerts separately trigger at 7 days (and 1..6 days catch-up).
 */
export const EXPIRING_SOON_DAYS_UI = 30;

export function getBangkokTodayIso(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Bangkok',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(now);

  const year = parts.find((p) => p.type === 'year')?.value;
  const month = parts.find((p) => p.type === 'month')?.value;
  const day = parts.find((p) => p.type === 'day')?.value;
  return `${year}-${month}-${day}`;
}

export function diffDaysBangkok(fromIso: string, toIso: string): number {
  const [fy, fm, fd] = fromIso.split('-').map(Number);
  const [ty, tm, td] = toIso.split('-').map(Number);
  const fromUtc = Date.UTC(fy, fm - 1, fd);
  const toUtc = Date.UTC(ty, tm - 1, td);
  return Math.round((toUtc - fromUtc) / 86_400_000);
}

/**
 * Compute expiry status from expiry_date in Asia/Bangkok timezone.
 * Strictly independent from registry status_text (e.g. "available").
 */
export function evaluateExpiryState(
  expiryDate: string | null | undefined,
  todayBangkok: string = getBangkokTodayIso(),
  soonThresholdDays: number = EXPIRING_SOON_DAYS_UI
): ExpiryStateInfo {
  if (!expiryDate || !/^\d{4}-\d{2}-\d{2}$/.test(expiryDate)) {
    return {
      code: 'unset',
      label: 'ยังไม่กำหนด',
      detailText: 'ยังไม่ได้กำหนดวันหมดอายุ',
      daysRemaining: null
    };
  }

  const days = diffDaysBangkok(todayBangkok, expiryDate);

  if (days < 0) {
    const overdue = Math.abs(days);
    return {
      code: 'expired',
      label: 'หมดอายุแล้ว',
      detailText: `เกินกำหนด ${overdue} วัน`,
      daysRemaining: days
    };
  }

  if (days === 0) {
    return {
      code: 'expires_today',
      label: 'หมดอายุวันนี้',
      detailText: 'ครบกำหนดวันนี้',
      daysRemaining: 0
    };
  }

  if (days <= soonThresholdDays) {
    return {
      code: 'expiring_soon',
      label: 'ใกล้หมดอายุ',
      detailText: `เหลืออีก ${days} วัน`,
      daysRemaining: days
    };
  }

  return {
    code: 'valid',
    label: 'ปกติ',
    detailText: `เหลืออีก ${days} วัน`,
    daysRemaining: days
  };
}

const thaiDateFormatter = new Intl.DateTimeFormat('th-TH', {
  timeZone: 'UTC',
  day: '2-digit',
  month: 'short',
  year: 'numeric'
});

const thaiDateTimeFormatter = new Intl.DateTimeFormat('th-TH', {
  timeZone: 'Asia/Bangkok',
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit'
});

/**
 * Format YYYY-MM-DD for readable Thai display (e.g. 02 ก.ค. 2569) with fallback "ยังไม่กำหนด".
 */
export function formatDateThai(isoDate: string | null | undefined): string {
  if (!isoDate || !/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) return 'ยังไม่กำหนด';
  const [y, m, d] = isoDate.split('-').map(Number);
  return thaiDateFormatter.format(new Date(Date.UTC(y, m - 1, d)));
}

/**
 * Format YYYY-MM-DD as technical Gregorian DD/MM/YYYY (used alongside Thai date or tables).
 */
export function formatDateShortNumeric(isoDate: string | null | undefined): string {
  if (!isoDate || !/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) return 'ยังไม่กำหนด';
  const [y, m, d] = isoDate.split('-');
  return `${d}/${m}/${y}`;
}

export function formatDateTimeBangkok(isoTimestamp: string): string {
  const parsed = new Date(isoTimestamp);
  if (Number.isNaN(parsed.getTime())) return isoTimestamp;
  return `${thaiDateTimeFormatter.format(parsed)} น.`;
}

export interface InspectionDateDisplay {
  field: 'compare_date' | 'calibration_date';
  label: string;
  value: string;
}

/**
 * Return only populated inspection dates with their exact source column labels.
 */
export function getPopulatedInspectionDates(record: {
  compare_date: string | null;
  calibration_date: string | null;
}): InspectionDateDisplay[] {
  const list: InspectionDateDisplay[] = [];
  if (record.compare_date) {
    list.push({
      field: 'compare_date',
      label: 'Compare Block / Ring Gauge',
      value: record.compare_date
    });
  }
  if (record.calibration_date) {
    list.push({
      field: 'calibration_date',
      label: 'Calibration',
      value: record.calibration_date
    });
  }
  return list;
}
