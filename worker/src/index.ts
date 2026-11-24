import { evaluateDueReminders, getBangkokDateString } from './reminder-rules';
import {
  ALLOWED_IMAGE_MIME,
  MAX_IMAGE_BYTES,
  buildCorsHeaders,
  detectImageMimeFromBytes,
  isImageKeyOwnedByInstrument,
  isValidInstrumentCode,
  isValidPublicToken,
  isValidUuid,
  sanitizeErrorSummary,
  timingSafeEqual
} from './security';
import { createSupabaseDataStore, type SupabaseDataStore } from './supabase-admin';
import type { Env, InstrumentRow, PublicInstrumentResponse } from './types';

function jsonResponse(
  body: unknown,
  status: number,
  corsHeaders?: Headers
): Response {
  const headers = new Headers(corsHeaders);
  headers.set('Content-Type', 'application/json; charset=utf-8');
  headers.set('Cache-Control', 'no-store');
  headers.set('X-Content-Type-Options', 'nosniff');
  return new Response(JSON.stringify(body), { status, headers });
}

function toPublicDto(row: InstrumentRow, requestUrl: URL): PublicInstrumentResponse {
  const hasValidImage = Boolean(row.image_key && isImageKeyOwnedByInstrument(row.image_key, row.id));
  const imageUrl = hasValidImage
    ? `${requestUrl.origin}/api/public/instruments/${encodeURIComponent(row.public_token)}/image`
    : null;

  return {
    instrument_code: row.instrument_code,
    public_token: row.public_token,
    name: row.name,
    size: row.size,
    location: row.location,
    status_text: row.status_text,
    compare_date: row.compare_date,
    calibration_date: row.calibration_date,
    expiry_date: row.expiry_date,
    vendor: row.vendor,
    has_image: hasValidImage,
    image_url: imageUrl
  };
}

function verifyGasSecret(request: Request, env: Env): boolean {
  if (!env.GAS_REMINDER_SECRET || env.GAS_REMINDER_SECRET.length < 16) return false;
  const headerSecret = request.headers.get('X-Reminder-Secret') ?? '';
  return headerSecret.length > 0 && timingSafeEqual(headerSecret, env.GAS_REMINDER_SECRET);
}

export async function handleRequest(
  request: Request,
  env: Env,
  deps?: { store?: SupabaseDataStore; now?: () => Date }
): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, '') || '/';
  const store = deps?.store ?? createSupabaseDataStore(env);
  const now = deps?.now ? deps.now() : new Date();

  const isGasRoute = path.startsWith('/api/gas/');

  // CORS preflight for browser-facing routes only (GAS routes deliberately disallow browser CORS)
  if (request.method === 'OPTIONS') {
    if (isGasRoute) {
      return new Response(null, { status: 403 });
    }
    const cors = buildCorsHeaders(request, env.ALLOWED_ORIGINS);
    return new Response(null, { status: 204, headers: cors });
  }

  const cors = isGasRoute ? undefined : buildCorsHeaders(request, env.ALLOWED_ORIGINS);

  // Health check
  if (request.method === 'GET' && path === '/api/health') {
    return jsonResponse({ ok: true, service: 'measuring-instrument-api' }, 200, cors);
  }

  // 1. Public lookup by permanent QR token (single instrument only)
  const publicTokenMatch = path.match(/^\/api\/public\/instruments\/([^/]+)$/);
  if (request.method === 'GET' && publicTokenMatch) {
    const token = decodeURIComponent(publicTokenMatch[1]);
    if (!isValidPublicToken(token)) {
      return jsonResponse({ error: 'Not found' }, 404, cors);
    }
    const inst = await store.getInstrumentByToken(token);
    if (!inst) {
      return jsonResponse({ error: 'Not found' }, 404, cors);
    }
    return jsonResponse(toPublicDto(inst, url), 200, cors);
  }

  // 2. Public lookup by label code (fallback when camera is unavailable — single instrument only)
  if (request.method === 'GET' && path === '/api/public/lookup') {
    const code = (url.searchParams.get('code') ?? '').trim();
    if (!isValidInstrumentCode(code)) {
      return jsonResponse({ error: 'Invalid instrument code' }, 400, cors);
    }
    const inst = await store.getInstrumentByCode(code);
    if (!inst) {
      return jsonResponse({ error: 'Not found' }, 404, cors);
    }
    return jsonResponse(toPublicDto(inst, url), 200, cors);
  }

  // 3. Public image streaming from private R2 bucket (strictly verified against token + instrument ownership)
  const publicImageMatch = path.match(/^\/api\/public\/instruments\/([^/]+)\/image$/);
  if (request.method === 'GET' && publicImageMatch) {
    const token = decodeURIComponent(publicImageMatch[1]);
    if (!isValidPublicToken(token)) {
      return jsonResponse({ error: 'Not found' }, 404, cors);
    }
    const inst = await store.getInstrumentByToken(token);
    if (!inst || !inst.image_key || !isImageKeyOwnedByInstrument(inst.image_key, inst.id)) {
      return jsonResponse({ error: 'Image not found' }, 404, cors);
    }
    const object = await env.INSTRUMENT_PHOTOS.get(inst.image_key);
    if (!object) {
      return jsonResponse({ error: 'Image not found' }, 404, cors);
    }
    const headers = new Headers(cors);
    headers.set('Content-Type', object.httpMetadata?.contentType ?? 'image/jpeg');
    headers.set('Cache-Control', 'private, max-age=300');
    headers.set('X-Content-Type-Options', 'nosniff');
    return new Response(object.body, { status: 200, headers });
  }

  // 4. Admin image upload / replacement (verifies Supabase JWT + app_admins membership)
  const adminImageMatch = path.match(/^\/api\/admin\/instruments\/([^/]+)\/image$/);
  if (request.method === 'POST' && adminImageMatch) {
    const instrumentId = decodeURIComponent(adminImageMatch[1]);
    if (!isValidUuid(instrumentId)) {
      return jsonResponse({ error: 'Invalid instrument ID' }, 400, cors);
    }

    const authHeader = request.headers.get('Authorization') ?? '';
    const jwt = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
    if (!jwt) {
      return jsonResponse({ error: 'Unauthorized' }, 401, cors);
    }
    const admin = await store.verifyAdminJwt(jwt);
    if (!admin) {
      return jsonResponse({ error: 'Forbidden' }, 403, cors);
    }

    const inst = await store.getInstrumentById(instrumentId);
    if (!inst) {
      return jsonResponse({ error: 'Instrument not found' }, 404, cors);
    }

    const contentType = request.headers.get('Content-Type') ?? '';
    let bytes: Uint8Array;
    let declaredMime = '';

    if (contentType.includes('multipart/form-data')) {
      const form = await request.formData();
      const file = form.get('file');
      if (!(file instanceof File)) {
        return jsonResponse({ error: 'Missing image file field' }, 400, cors);
      }
      if (file.size === 0 || file.size > MAX_IMAGE_BYTES) {
        return jsonResponse({ error: 'ไฟล์รูปต้องมีขนาดไม่เกิน 5 MB' }, 413, cors);
      }
      declaredMime = file.type;
      bytes = new Uint8Array(await file.arrayBuffer());
    } else {
      declaredMime = contentType.split(';')[0].trim().toLowerCase();
      const buf = await request.arrayBuffer();
      if (buf.byteLength === 0 || buf.byteLength > MAX_IMAGE_BYTES) {
        return jsonResponse({ error: 'ไฟล์รูปต้องมีขนาดไม่เกิน 5 MB' }, 413, cors);
      }
      bytes = new Uint8Array(buf);
    }

    const detectedMime = detectImageMimeFromBytes(bytes);
    if (!detectedMime || !(detectedMime in ALLOWED_IMAGE_MIME)) {
      return jsonResponse(
        { error: 'รองรับเฉพาะไฟล์ภาพ JPG, PNG หรือ WebP เท่านั้น' },
        415,
        cors
      );
    }
    if (declaredMime && declaredMime !== detectedMime) {
      return jsonResponse(
        { error: 'ชนิดไฟล์ไม่ตรงกับเนื้อหาภาพจริง' },
        415,
        cors
      );
    }

    const ext = ALLOWED_IMAGE_MIME[detectedMime];
    const randomSuffix = crypto.randomUUID().replace(/-/g, '').slice(0, 12);
    const imageKey = `instruments/${instrumentId}/${now.getTime()}-${randomSuffix}.${ext}`;

    // Store new photo in private R2 bucket (Phase 1 intentionally keeps old objects untouched)
    await env.INSTRUMENT_PHOTOS.put(imageKey, bytes, {
      httpMetadata: { contentType: detectedMime },
      customMetadata: {
        instrumentId,
        uploadedBy: admin.email,
        uploadedAt: now.toISOString()
      }
    });

    await store.updateInstrumentImageKey(instrumentId, imageKey);

    return jsonResponse(
      {
        ok: true,
        image_key: imageKey,
        image_url: `${url.origin}/api/public/instruments/${encodeURIComponent(inst.public_token)}/image?v=${now.getTime()}`
      },
      200,
      cors
    );
  }

  // 5. GAS Reminder API — Prepare due list (no CORS; secret header required)
  if (request.method === 'POST' && path === '/api/gas/reminders/prepare') {
    if (!verifyGasSecret(request, env)) {
      return jsonResponse({ error: 'Unauthorized' }, 401);
    }
    let body: { dryRun?: boolean; todayOverride?: string } = {};
    try {
      body = (await request.json()) as { dryRun?: boolean; todayOverride?: string };
    } catch {
      // Allow empty JSON body (defaults to dryRun: false)
    }

    const dryRun = body.dryRun === true;
    const todayBangkok =
      body.todayOverride && /^\d{4}-\d{2}-\d{2}$/.test(body.todayOverride)
        ? body.todayOverride
        : getBangkokDateString(now);

    const maxAttempts = Math.max(1, Number(env.REMINDER_MAX_ATTEMPTS ?? '3') || 3);
    const [instruments, logs] = await Promise.all([
      store.listInstrumentsWithExpiry(),
      store.listReminderLogs()
    ]);

    const evaluation = evaluateDueReminders(instruments, logs, todayBangkok, now, maxAttempts);

    if (!dryRun && evaluation.due.length > 0) {
      const lockedUntil = new Date(now.getTime() + 15 * 60 * 1000).toISOString();
      for (const item of evaluation.due) {
        await store.upsertReminderLock({
          instrument_id: item.instrument_id,
          expiry_date: item.expiry_date,
          reminder_type: item.reminder_type,
          attempt_count: item.previous_attempts + 1,
          locked_until: lockedUntil
        });
      }
    }

    return jsonResponse(
      {
        dryRun,
        ...evaluation
      },
      200
    );
  }

  // 6. GAS Reminder API — Record delivery outcome (no CORS; secret header required)
  if (request.method === 'POST' && path === '/api/gas/reminders/report') {
    if (!verifyGasSecret(request, env)) {
      return jsonResponse({ error: 'Unauthorized' }, 401);
    }
    const body = (await request.json()) as {
      results?: Array<{
        instrument_id: string;
        expiry_date: string;
        status: 'sent' | 'failed';
        error_summary?: string;
      }>;
    };
    if (!Array.isArray(body.results)) {
      return jsonResponse({ error: 'results array is required' }, 400);
    }

    let recorded = 0;
    for (const item of body.results) {
      if (!isValidUuid(item.instrument_id) || !/^\d{4}-\d{2}-\d{2}$/.test(item.expiry_date)) {
        continue;
      }
      if (item.status !== 'sent' && item.status !== 'failed') continue;
      await store.recordReminderOutcome({
        instrument_id: item.instrument_id,
        expiry_date: item.expiry_date,
        status: item.status,
        sent_at: item.status === 'sent' ? now.toISOString() : null,
        error_summary: item.status === 'failed' ? sanitizeErrorSummary(item.error_summary) : null
      });
      recorded += 1;
    }

    return jsonResponse({ ok: true, recorded }, 200);
  }

  return jsonResponse({ error: 'Not found' }, 404, cors);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      return await handleRequest(request, env);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Internal server error';
      return jsonResponse({ error: sanitizeErrorSummary(msg) ?? 'Internal server error' }, 500);
    }
  }
};
