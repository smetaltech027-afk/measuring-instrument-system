import { describe, expect, it } from 'vitest';
import { handleRequest } from '../worker/src/index';
import type { SupabaseDataStore } from '../worker/src/supabase-admin';
import type { Env, InstrumentRow, PhotoBucket, ReminderLogRow } from '../worker/src/types';

function createMockR2() {
  const store = new Map<string, { bytes: Uint8Array<ArrayBuffer>; contentType: string }>();
  const bucket: PhotoBucket = {
    async get(key: string) {
      const entry = store.get(key);
      if (!entry) return null;
      return {
        body: entry.bytes,
        httpMetadata: { contentType: entry.contentType }
      };
    },
    async put(key, value, opts) {
      const bytes: Uint8Array<ArrayBuffer> =
        value instanceof Uint8Array
          ? new Uint8Array(value)
          : value instanceof ArrayBuffer
            ? new Uint8Array(value)
            : new Uint8Array(0);
      store.set(key, {
        bytes,
        contentType: opts?.httpMetadata?.contentType ?? 'application/octet-stream'
      });
    }
  };
  return { bucket, store };
}

function createMockEnv(r2Bucket: PhotoBucket): Env {
  return {
    SUPABASE_URL: 'https://mock.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'mock-service-role-key',
    GAS_REMINDER_SECRET: 'super-strong-gas-secret-value-123456',
    ALLOWED_ORIGINS: 'https://smetaltech.github.io',
    REMINDER_MAX_ATTEMPTS: '3',
    INSTRUMENT_PHOTOS: r2Bucket
  };
}

const VALID_PNG_BYTES = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52
]);

describe('Cloudflare Worker API security & GAS reminder rules', () => {
  const instA: InstrumentRow = {
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    public_token: 'PublicTokenA_12345678901234567890',
    instrument_code: 'MI-001',
    sort_order: 1,
    name: 'Vernier Caliper No. 001',
    size: '0-200 mm.',
    location: 'CNC Machine',
    status_text: 'available',
    compare_date: '2026-10-03',
    calibration_date: null,
    expiry_date: '2026-12-01', // 7 days from 2026-11-24
    vendor: '-',
    image_key: 'instruments/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/photo.png'
  };

  const instB: InstrumentRow = {
    id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    public_token: 'PublicTokenB_12345678901234567890',
    instrument_code: 'MI-063',
    sort_order: 63,
    name: 'T- Point No. 012 (Holtest)',
    size: '4-5 mm.',
    location: 'CNC Machine',
    status_text: 'available',
    compare_date: null,
    calibration_date: '2025-07-02',
    expiry_date: '2026-07-02', // Expired
    vendor: 'JSR',
    // Intentionally pointing to instA's path to verify ownership block
    image_key: 'instruments/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/photo.png'
  };

  const instCatchUp: InstrumentRow = {
    id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    public_token: 'PublicTokenC_12345678901234567890',
    instrument_code: 'MI-028',
    sort_order: 28,
    name: 'Micro meter No.003',
    size: '0-25 mm.',
    location: 'QC',
    status_text: 'available',
    compare_date: '2026-06-06',
    calibration_date: null,
    expiry_date: '2026-11-30', // 6 days remaining -> catch_up
    vendor: '-',
    image_key: null
  };

  function createHarness(initialLogs: ReminderLogRow[] = []) {
    const instruments = [structuredClone(instA), structuredClone(instB), structuredClone(instCatchUp)];
    const logs = structuredClone(initialLogs);
    const { bucket, store: r2Store } = createMockR2();
    r2Store.set(instA.image_key!, { bytes: VALID_PNG_BYTES, contentType: 'image/png' });

    const dataStore: SupabaseDataStore = {
      async getInstrumentByToken(token) {
        return instruments.find((i) => i.public_token === token) ?? null;
      },
      async getInstrumentByCode(code) {
        return (
          instruments.find((i) => i.instrument_code.toLowerCase() === code.toLowerCase()) ?? null
        );
      },
      async getInstrumentById(id) {
        return instruments.find((i) => i.id === id) ?? null;
      },
      async updateInstrumentImageKey(id, key) {
        const target = instruments.find((i) => i.id === id);
        if (target) target.image_key = key;
      },
      async verifyAdminJwt(jwt) {
        if (jwt === 'valid-admin-jwt') {
          return { userId: '11111111-1111-1111-1111-111111111111', email: 'smetaltech027@gmail.com' };
        }
        return null;
      },
      async listInstrumentsWithExpiry() {
        return instruments.filter((i) => i.expiry_date !== null);
      },
      async listReminderLogs() {
        return logs;
      },
      async upsertReminderLock(entry) {
        const idx = logs.findIndex(
          (l) => l.instrument_id === entry.instrument_id && l.expiry_date === entry.expiry_date
        );
        const next: ReminderLogRow = {
          id: `log-${logs.length + 1}`,
          instrument_id: entry.instrument_id,
          expiry_date: entry.expiry_date,
          reminder_type: entry.reminder_type,
          status: 'pending',
          attempt_count: entry.attempt_count,
          locked_until: entry.locked_until,
          last_attempt_at: '2026-11-24T01:00:00.000Z',
          sent_at: null,
          error_summary: null
        };
        if (idx >= 0) logs[idx] = next;
        else logs.push(next);
      },
      async recordReminderOutcome(entry) {
        const found = logs.find(
          (l) => l.instrument_id === entry.instrument_id && l.expiry_date === entry.expiry_date
        );
        if (found) {
          found.status = entry.status;
          found.sent_at = entry.sent_at;
          found.locked_until = null;
          found.error_summary = entry.error_summary;
        }
      }
    };

    return { env: createMockEnv(bucket), dataStore, r2Store, logs, instruments };
  }

  it('returns only public fields for valid QR token and 404 for unknown/invalid tokens', async () => {
    const { env, dataStore } = createHarness();

    const okRes = await handleRequest(
      new Request(`https://api.example.com/api/public/instruments/${instA.public_token}`, {
        headers: { Origin: 'https://smetaltech.github.io' }
      }),
      env,
      { store: dataStore }
    );
    expect(okRes.status).toBe(200);
    expect(okRes.headers.get('Access-Control-Allow-Origin')).toBe('https://smetaltech.github.io');
    const body = (await okRes.json()) as Record<string, unknown>;
    expect(body.instrument_code).toBe('MI-001');
    expect(body.id).toBeUndefined(); // Internal UUID is never exposed publicly

    const badRes = await handleRequest(
      new Request('https://api.example.com/api/public/instruments/UnknownToken_12345678901234567'),
      env,
      { store: dataStore }
    );
    expect(badRes.status).toBe(404);
  });

  it('serves private R2 photo only when image_key belongs to the requested instrument', async () => {
    const { env, dataStore } = createHarness();

    const okImg = await handleRequest(
      new Request(`https://api.example.com/api/public/instruments/${instA.public_token}/image`),
      env,
      { store: dataStore }
    );
    expect(okImg.status).toBe(200);
    expect(okImg.headers.get('Content-Type')).toBe('image/png');

    // instB has a mismatched image_key pointing to instA's folder -> must be rejected with 404
    const crossImg = await handleRequest(
      new Request(`https://api.example.com/api/public/instruments/${instB.public_token}/image`),
      env,
      { store: dataStore }
    );
    expect(crossImg.status).toBe(404);
  });

  it('enforces Admin JWT and real image magic bytes on photo upload without deleting old files', async () => {
    const { env, dataStore, r2Store, instruments } = createHarness();

    // No auth -> 401
    const noAuth = await handleRequest(
      new Request(`https://api.example.com/api/admin/instruments/${instA.id}/image`, {
        method: 'POST',
        headers: { 'Content-Type': 'image/png' },
        body: VALID_PNG_BYTES
      }),
      env,
      { store: dataStore }
    );
    expect(noAuth.status).toBe(401);

    // Invalid/non-admin JWT -> 403
    const nonAdmin = await handleRequest(
      new Request(`https://api.example.com/api/admin/instruments/${instA.id}/image`, {
        method: 'POST',
        headers: { Authorization: 'Bearer non-admin-token', 'Content-Type': 'image/png' },
        body: VALID_PNG_BYTES
      }),
      env,
      { store: dataStore }
    );
    expect(nonAdmin.status).toBe(403);

    // Fake file masquerading as PNG -> 415
    const fakeFile = await handleRequest(
      new Request(`https://api.example.com/api/admin/instruments/${instA.id}/image`, {
        method: 'POST',
        headers: { Authorization: 'Bearer valid-admin-jwt', 'Content-Type': 'image/png' },
        body: new TextEncoder().encode('not-actually-a-png-file')
      }),
      env,
      { store: dataStore }
    );
    expect(fakeFile.status).toBe(415);

    // Valid Admin JWT + valid PNG bytes -> 200, keeps old object in R2
    const oldKey = instA.image_key!;
    const okUpload = await handleRequest(
      new Request(`https://api.example.com/api/admin/instruments/${instA.id}/image`, {
        method: 'POST',
        headers: { Authorization: 'Bearer valid-admin-jwt', 'Content-Type': 'image/png' },
        body: VALID_PNG_BYTES
      }),
      env,
      { store: dataStore, now: () => new Date('2026-11-24T05:00:00Z') }
    );
    expect(okUpload.status).toBe(200);
    expect(r2Store.has(oldKey)).toBe(true); // Old file preserved in Phase 1
    expect(instruments[0].image_key).not.toBe(oldKey);
  });

  it('handles GAS reminders: secret auth, no CORS, -7, 1-6 catch-up, expired skip, dedupe, lock, and new expiry date', async () => {
    const { env, dataStore, logs, instruments } = createHarness();
    const fixedNow = () => new Date('2026-11-24T01:00:00.000Z'); // 08:00 Asia/Bangkok

    // Browser CORS preflight must be blocked for GAS routes
    const corsPreflight = await handleRequest(
      new Request('https://api.example.com/api/gas/reminders/prepare', {
        method: 'OPTIONS',
        headers: { Origin: 'https://smetaltech.github.io' }
      }),
      env,
      { store: dataStore, now: fixedNow }
    );
    expect(corsPreflight.status).toBe(403);

    // Wrong GAS secret -> 401
    const badSecret = await handleRequest(
      new Request('https://api.example.com/api/gas/reminders/prepare', {
        method: 'POST',
        headers: { 'X-Reminder-Secret': 'wrong-secret' },
        body: JSON.stringify({ dryRun: true })
      }),
      env,
      { store: dataStore, now: fixedNow }
    );
    expect(badSecret.status).toBe(401);

    // Dry run: evaluates instA (7_day) + instCatchUp (catch_up), skips expired instB, writes 0 locks
    const dryRes = await handleRequest(
      new Request('https://api.example.com/api/gas/reminders/prepare', {
        method: 'POST',
        headers: { 'X-Reminder-Secret': env.GAS_REMINDER_SECRET },
        body: JSON.stringify({ dryRun: true })
      }),
      env,
      { store: dataStore, now: fixedNow }
    );
    expect(dryRes.status).toBe(200);
    const dryJson = (await dryRes.json()) as {
      due: Array<{ instrument_code: string; reminder_type: string; days_remaining: number }>;
    };
    expect(dryJson.due.map((d) => [d.instrument_code, d.reminder_type, d.days_remaining])).toEqual([
      ['MI-028', 'catch_up', 6],
      ['MI-001', '7_day', 7]
    ]);
    expect(logs.length).toBe(0);

    // Live prepare acquires locks -> overlapping trigger immediately sees 0 due and skippedLocked=2
    const liveRes = await handleRequest(
      new Request('https://api.example.com/api/gas/reminders/prepare', {
        method: 'POST',
        headers: { 'X-Reminder-Secret': env.GAS_REMINDER_SECRET },
        body: JSON.stringify({ dryRun: false })
      }),
      env,
      { store: dataStore, now: fixedNow }
    );
    expect(liveRes.status).toBe(200);
    expect(logs.length).toBe(2);

    const overlapRes = await handleRequest(
      new Request('https://api.example.com/api/gas/reminders/prepare', {
        method: 'POST',
        headers: { 'X-Reminder-Secret': env.GAS_REMINDER_SECRET },
        body: JSON.stringify({ dryRun: false })
      }),
      env,
      { store: dataStore, now: fixedNow }
    );
    const overlapJson = (await overlapRes.json()) as { due: unknown[]; skippedLocked: number };
    expect(overlapJson.due).toHaveLength(0);
    expect(overlapJson.skippedLocked).toBe(2);

    // Mark both as sent -> repeat run skips them as already sent
    const reportRes = await handleRequest(
      new Request('https://api.example.com/api/gas/reminders/report', {
        method: 'POST',
        headers: { 'X-Reminder-Secret': env.GAS_REMINDER_SECRET },
        body: JSON.stringify({
          results: [
            { instrument_id: instA.id, expiry_date: instA.expiry_date, status: 'sent' },
            { instrument_id: instCatchUp.id, expiry_date: instCatchUp.expiry_date, status: 'sent' }
          ]
        })
      }),
      env,
      { store: dataStore, now: fixedNow }
    );
    expect(reportRes.status).toBe(200);

    const repeatRes = await handleRequest(
      new Request('https://api.example.com/api/gas/reminders/prepare', {
        method: 'POST',
        headers: { 'X-Reminder-Secret': env.GAS_REMINDER_SECRET },
        body: JSON.stringify({ dryRun: true })
      }),
      env,
      { store: dataStore, now: fixedNow }
    );
    const repeatJson = (await repeatRes.json()) as { due: unknown[]; skippedAlreadySent: number };
    expect(repeatJson.due).toHaveLength(0);
    expect(repeatJson.skippedAlreadySent).toBe(2);

    // Admin updates expiry_date on instA to a new date 7 days from 2026-11-25 -> starts fresh reminder cycle
    instruments[0].expiry_date = '2026-12-02';
    const renewedRes = await handleRequest(
      new Request('https://api.example.com/api/gas/reminders/prepare', {
        method: 'POST',
        headers: { 'X-Reminder-Secret': env.GAS_REMINDER_SECRET },
        body: JSON.stringify({ dryRun: true, todayOverride: '2026-11-25' })
      }),
      env,
      { store: dataStore, now: fixedNow }
    );
    const renewedJson = (await renewedRes.json()) as {
      due: Array<{ instrument_code: string; expiry_date: string }>;
    };
    expect(renewedJson.due).toHaveLength(1);
    expect(renewedJson.due[0].instrument_code).toBe('MI-001');
    expect(renewedJson.due[0].expiry_date).toBe('2026-12-02');
  });
});
