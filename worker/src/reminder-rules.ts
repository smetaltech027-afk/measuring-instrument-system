import type { InstrumentRow, ReminderLogRow } from './types';

export interface DueReminderCandidate {
  instrument_id: string;
  instrument_code: string;
  name: string;
  size: string | null;
  location: string | null;
  expiry_date: string;
  days_remaining: number;
  reminder_type: '7_day' | 'catch_up';
  previous_attempts: number;
}

export interface ReminderEvaluationResult {
  todayBangkok: string;
  due: DueReminderCandidate[];
  skippedAlreadySent: number;
  skippedLocked: number;
  manualReviewRequired: Array<{
    instrument_id: string;
    instrument_code: string;
    name: string;
    expiry_date: string;
    attempt_count: number;
    last_error: string | null;
  }>;
}

export function getBangkokDateString(now: Date = new Date()): string {
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

export function diffDaysIso(fromIso: string, toIso: string): number {
  const [fy, fm, fd] = fromIso.split('-').map(Number);
  const [ty, tm, td] = toIso.split('-').map(Number);
  const fromUtc = Date.UTC(fy, fm - 1, fd);
  const toUtc = Date.UTC(ty, tm - 1, td);
  return Math.round((toUtc - fromUtc) / 86_400_000);
}

/**
 * Evaluate which instruments require a 7-day or 1..6-day catch-up reminder on `todayBangkok`.
 * - Expired (<= 0 days) or missing expiry_date: NEVER sent.
 * - > 7 days: not yet due.
 * - Already sent for the exact (instrument_id, expiry_date): skipped.
 * - Active lock (pending & locked_until > now): skipped to prevent overlapping GAS triggers.
 * - Exceeded maxAttempts: surfaced in manualReviewRequired for Admin visibility.
 */
export function evaluateDueReminders(
  instruments: InstrumentRow[],
  logs: ReminderLogRow[],
  todayBangkok: string,
  now: Date = new Date(),
  maxAttempts = 3
): ReminderEvaluationResult {
  const logByKey = new Map<string, ReminderLogRow>();
  for (const log of logs) {
    logByKey.set(`${log.instrument_id}::${log.expiry_date}`, log);
  }

  const due: DueReminderCandidate[] = [];
  const manualReviewRequired: ReminderEvaluationResult['manualReviewRequired'] = [];
  let skippedAlreadySent = 0;
  let skippedLocked = 0;

  for (const inst of instruments) {
    if (!inst.expiry_date) continue;
    const daysRemaining = diffDaysIso(todayBangkok, inst.expiry_date);
    if (daysRemaining <= 0 || daysRemaining > 7) continue;

    const existing = logByKey.get(`${inst.id}::${inst.expiry_date}`);
    if (existing) {
      if (existing.status === 'sent') {
        skippedAlreadySent += 1;
        continue;
      }
      if (existing.status === 'pending' && existing.locked_until) {
        const lockTime = Date.parse(existing.locked_until);
        if (!Number.isNaN(lockTime) && lockTime > now.getTime()) {
          skippedLocked += 1;
          continue;
        }
      }
      if (existing.attempt_count >= maxAttempts) {
        manualReviewRequired.push({
          instrument_id: inst.id,
          instrument_code: inst.instrument_code,
          name: inst.name,
          expiry_date: inst.expiry_date,
          attempt_count: existing.attempt_count,
          last_error: existing.error_summary
        });
        continue;
      }
    }

    due.push({
      instrument_id: inst.id,
      instrument_code: inst.instrument_code,
      name: inst.name,
      size: inst.size,
      location: inst.location,
      expiry_date: inst.expiry_date,
      days_remaining: daysRemaining,
      reminder_type: daysRemaining === 7 ? '7_day' : 'catch_up',
      previous_attempts: existing?.attempt_count ?? 0
    });
  }

  due.sort((a, b) => {
    if (a.expiry_date !== b.expiry_date) return a.expiry_date.localeCompare(b.expiry_date);
    return a.instrument_code.localeCompare(b.instrument_code);
  });

  return {
    todayBangkok,
    due,
    skippedAlreadySent,
    skippedLocked,
    manualReviewRequired
  };
}
