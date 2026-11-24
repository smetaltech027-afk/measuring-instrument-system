const PUBLIC_TOKEN_REGEX = /^[A-Za-z0-9_-]{24,128}$/;

export function getConfiguredPublicBaseUrl(): string {
  const fromEnv = import.meta.env?.VITE_PUBLIC_BASE_URL?.trim();
  if (fromEnv) {
    return fromEnv.replace(/\/+$/, '');
  }
  if (typeof window !== 'undefined' && window.location?.origin) {
    const basePath = (import.meta.env?.BASE_URL ?? '/').replace(/\/+$/, '');
    return `${window.location.origin}${basePath}`;
  }
  return 'https://example.github.io/measuring-instrument-system';
}

/**
 * Build the permanent QR URL using the root query parameter `?instrument={token}`
 * so GitHub Pages serves index.html directly without 404 on SPA subpaths.
 */
export function buildInstrumentQrUrl(
  publicToken: string,
  baseUrl: string = getConfiguredPublicBaseUrl()
): string {
  const cleanBase = baseUrl.replace(/\/+$/, '');
  return `${cleanBase}/?instrument=${encodeURIComponent(publicToken)}`;
}

export type ParsedQrScanResult =
  | { valid: true; token: string }
  | { valid: false; reason: 'empty' | 'not_system_qr' | 'invalid_token' };

/**
 * Validate and extract the `instrument` token from a scanned QR string.
 * Rejects unrelated URLs or malformed tokens cleanly.
 */
export function parseScannedQrValue(
  rawValue: string,
  expectedBaseUrl?: string
): ParsedQrScanResult {
  const trimmed = rawValue.trim();
  if (!trimmed) return { valid: false, reason: 'empty' };

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
    return { valid: true, token };
  } catch {
    // Allow relative query string like "?instrument=..."
    if (trimmed.startsWith('?')) {
      const params = new URLSearchParams(trimmed);
      const token = params.get('instrument')?.trim() ?? '';
      if (!token) return { valid: false, reason: 'not_system_qr' };
      if (!PUBLIC_TOKEN_REGEX.test(token)) return { valid: false, reason: 'invalid_token' };
      return { valid: true, token };
    }
    return { valid: false, reason: 'not_system_qr' };
  }
}
