import { describe, expect, it } from 'vitest';
import { buildInstrumentQrUrl, parseScannedQrValue } from '../src/lib/qrUrl';

describe('qrUrl', () => {
  const sampleToken = 'AbCdEfGhIjKlMnOpQrStUvWxYz012345';

  it('builds permanent root query-parameter QR URL suitable for GitHub Pages', () => {
    const url = buildInstrumentQrUrl(
      sampleToken,
      'https://smetaltech.github.io/measuring-instrument-system/'
    );
    expect(url).toBe(
      `https://smetaltech.github.io/measuring-instrument-system/?instrument=${sampleToken}`
    );
  });

  it('extracts valid token from system QR URLs and relative queries', () => {
    const full = parseScannedQrValue(
      `https://smetaltech.github.io/measuring-instrument-system/?instrument=${sampleToken}`
    );
    expect(full).toEqual({ valid: true, token: sampleToken });

    const rel = parseScannedQrValue(`?instrument=${sampleToken}`);
    expect(rel).toEqual({ valid: true, token: sampleToken });
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
        'https://smetaltech.github.io/measuring-instrument-system'
      )
    ).toEqual({ valid: false, reason: 'not_system_qr' });
    expect(parseScannedQrValue('https://smetaltech.github.io/?instrument=short')).toEqual({
      valid: false,
      reason: 'invalid_token'
    });
  });
});
