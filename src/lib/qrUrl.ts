const PUBLIC_TOKEN_REGEX = /^[A-Za-z0-9_-]{24,128}$/;
const INSTRUMENT_CODE_REGEX = /^[A-Za-z]{1,10}-[0-9]{1,6}$/;

export function getConfiguredPublicBaseUrl(): string {
  const fromEnv = import.meta.env?.VITE_PUBLIC_BASE_URL?.trim();
  if (fromEnv) {
    return fromEnv.replace(/\/+$/, '');
  }
  if (typeof window !== 'undefined' && window.location?.origin) {
    const basePath = (import.meta.env?.BASE_URL ?? '/').replace(/\/+$/, '');
    return `${window.location.origin}${basePath}`;
  }
  return 'https://smetaltech027-afk.github.io/measuring-instrument-system';
}

/**
 * Build the compact QR payload containing only the permanent instrument code (e.g. "MI-001").
 * Keeps QR at Version 1 (21x21 modules) so 9x9 mm physical labels scan reliably in-app.
 */
export function buildCompactQrPayload(instrumentCode: string): string {
  return instrumentCode.trim().toUpperCase();
}

/**
 * Build the full HTTPS detail URL using root query parameter `?instrument={token}`
 * (used for browser sharing / direct links).
 */
export function buildInstrumentQrUrl(
  publicToken: string,
  baseUrl: string = getConfiguredPublicBaseUrl()
): string {
  const cleanBase = baseUrl.replace(/\/+$/, '');
  return `${cleanBase}/?instrument=${encodeURIComponent(publicToken)}`;
}

export type ParsedQrScanResult =
  | { valid: true; kind: 'code'; code: string }
  | { valid: true; kind: 'token'; token: string }
  | { valid: false; reason: 'empty' | 'not_system_qr' | 'invalid_token' };

/**
 * Validate and extract either a compact instrument code (e.g. "MI-001")
 * or a legacy full URL (`?instrument={token}`) from a scanned QR string.
 */
export function parseScannedQrValue(
  rawValue: string,
  expectedBaseUrl?: string
): ParsedQrScanResult {
  const trimmed = rawValue.trim();
  if (!trimmed) return { valid: false, reason: 'empty' };

  // 1. Compact label code (e.g. MI-001)
  if (INSTRUMENT_CODE_REGEX.test(trimmed)) {
    return { valid: true, kind: 'code', code: trimmed.toUpperCase() };
  }

  // 2. Full system URL (?instrument={token})
  try {
    const parsed = new URL(trimmed);
    const token = parsed.searchParams.get('instrument')?.trim() ?? '';
    if (!token) {
      return { valid: false, reason: 'not_system_qr' };
    }
    if (expectedBaseUrl) {
      const expected = new URL(expectedBaseUrl);
      if (parsed.origin !== expected.origin) {
        return { valid: false, reason: 'not_system_qr' };
      }
    }
    if (!PUBLIC_TOKEN_REGEX.test(token)) {
      return { valid: false, reason: 'invalid_token' };
    }
    return { valid: true, kind: 'token', token };
  } catch {
    if (trimmed.startsWith('?')) {
      const params = new URLSearchParams(trimmed);
      const token = params.get('instrument')?.trim() ?? '';
      if (!token) return { valid: false, reason: 'not_system_qr' };
      if (!PUBLIC_TOKEN_REGEX.test(token)) return { valid: false, reason: 'invalid_token' };
      return { valid: true, kind: 'token', token };
    }
    return { valid: false, reason: 'not_system_qr' };
  }
}
