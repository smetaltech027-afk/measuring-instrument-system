import { describe, expect, it } from 'vitest';
import {
  buildCompactQrPayload,
  buildInstrumentQrUrl,
  parseScannedQrValue
} from '../src/lib/qrUrl';

describe('qrUrl', () => {
  const sampleToken = 'AbCdEfGhIjKlMnOpQrStUvWxYz012345';

  it('builds compact MI-xxx payload for 9x9 mm labels', () => {
    expect(buildCompactQrPayload('mi-001')).toBe('MI-001');
    expect(buildCompactQrPayload('  MI-074  ')).toBe('MI-074');
  });

  it('builds permanent root query-parameter URL suitable for GitHub Pages sharing', () => {
    const url = buildInstrumentQrUrl(
      sampleToken,
      'https://smetaltech027-afk.github.io/measuring-instrument-system/'
    );
    expect(url).toBe(
      `https://smetaltech027-afk.github.io/measuring-instrument-system/?instrument=${sampleToken}`
    );
  });

  it('extracts compact instrument codes and legacy full QR URLs cleanly', () => {
    expect(parseScannedQrValue('MI-001')).toEqual({ valid: true, kind: 'code', code: 'MI-001' });
    expect(parseScannedQrValue('  mi-074 ')).toEqual({ valid: true, kind: 'code', code: 'MI-074' });

    const full = parseScannedQrValue(
      `https://smetaltech027-afk.github.io/measuring-instrument-system/?instrument=${sampleToken}`
    );
    expect(full).toEqual({ valid: true, kind: 'token', token: sampleToken });

    const rel = parseScannedQrValue(`?instrument=${sampleToken}`);
    expect(rel).toEqual({ valid: true, kind: 'token', token: sampleToken });
  });

  it('rejects non-system QR codes, wrong origins, and malformed tokens', () => {
    expect(parseScannedQrValue('https://google.com')).toEqual({
      valid: false,
      reason: 'not_system_qr'
    });
    expect(parseScannedQrValue('plain-text-barcode-123')).toEqual({
      valid: false,
      reason: 'not_system_qr'
    });
    expect(
      parseScannedQrValue(
        `https://evil.example/?instrument=${sampleToken}`,
        'https://smetaltech027-afk.github.io/measuring-instrument-system'
      )
    ).toEqual({ valid: false, reason: 'not_system_qr' });
    expect(
      parseScannedQrValue('https://smetaltech027-afk.github.io/?instrument=short')
    ).toEqual({ valid: false, reason: 'invalid_token' });
  });
});
