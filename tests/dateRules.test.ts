import { describe, expect, it } from 'vitest';
import {
  diffDaysBangkok,
  evaluateExpiryState,
  getPopulatedInspectionDates
} from '../src/lib/dateRules';

describe('dateRules', () => {
  it('calculates exact calendar day differences in ISO format', () => {
    expect(diffDaysBangkok('2026-11-24', '2026-12-01')).toBe(7);
    expect(diffDaysBangkok('2026-11-24', '2026-11-24')).toBe(0);
    expect(diffDaysBangkok('2026-11-24', '2026-07-02')).toBe(-145);
  });

  it('classifies all 5 expiry states accurately', () => {
    const today = '2026-11-24';

    expect(evaluateExpiryState('2026-07-02', today).code).toBe('expired');
    expect(evaluateExpiryState('2026-11-24', today).code).toBe('expires_today');
    expect(evaluateExpiryState('2026-12-01', today).code).toBe('expiring_soon');
    expect(evaluateExpiryState('2026-12-24', today).code).toBe('expiring_soon');
    expect(evaluateExpiryState('2026-12-25', today).code).toBe('valid');
    expect(evaluateExpiryState(null, today).code).toBe('unset');
    expect(evaluateExpiryState('', today).code).toBe('unset');
  });

  it('returns only populated inspection dates with original source labels', () => {
    const cmpOnly = getPopulatedInspectionDates({
      compare_date: '2026-10-03',
      calibration_date: null
    });
    expect(cmpOnly).toEqual([
      { field: 'compare_date', label: 'Compare Block / Ring Gauge', value: '2026-10-03' }
    ]);

    const calOnly = getPopulatedInspectionDates({
      compare_date: null,
      calibration_date: '2026-06-09'
    });
    expect(calOnly).toEqual([
      { field: 'calibration_date', label: 'Calibration', value: '2026-06-09' }
    ]);

    expect(
      getPopulatedInspectionDates({ compare_date: null, calibration_date: null })
    ).toEqual([]);
  });
});
