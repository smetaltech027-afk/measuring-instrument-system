import type { PublicInstrument } from '../types/instrument';
import { compressImageIfNeeded } from './validation';

const rawWorkerUrl = import.meta.env.VITE_WORKER_API_URL?.trim() ?? '';

export const isWorkerConfigured = Boolean(
  rawWorkerUrl && !rawWorkerUrl.includes('your-subdomain.workers.dev')
);

export function getWorkerApiBaseUrl(): string {
  return rawWorkerUrl.replace(/\/+$/, '');
}

export function buildWorkerImageUrl(publicToken: string, cacheBust?: string | number): string | null {
  if (!isWorkerConfigured) return null;
  const base = `${getWorkerApiBaseUrl()}/api/public/instruments/${encodeURIComponent(publicToken)}/image`;
  return cacheBust ? `${base}?v=${encodeURIComponent(String(cacheBust))}` : base;
}

export async function fetchPublicInstrumentByToken(token: string): Promise<PublicInstrument> {
  if (!isWorkerConfigured) {
    throw new Error('ยังไม่ได้เชื่อมต่อ Worker API สำหรับอ่านข้อมูลจาก QR');
  }
  const res = await fetch(
    `${getWorkerApiBaseUrl()}/api/public/instruments/${encodeURIComponent(token)}`,
    { method: 'GET', headers: { Accept: 'application/json' } }
  );
  if (res.status === 404) {
    throw new Error('NOT_FOUND');
  }
  if (!res.ok) {
    throw new Error(`ไม่สามารถดึงข้อมูลเครื่องมือวัดได้ (รหัส ${res.status})`);
  }
  return (await res.json()) as PublicInstrument;
}

export async function lookupPublicInstrumentByCode(code: string): Promise<PublicInstrument> {
  if (!isWorkerConfigured) {
    throw new Error('ยังไม่ได้เชื่อมต่อ Worker API สำหรับค้นหารหัสเครื่องมือ');
  }
  const res = await fetch(
    `${getWorkerApiBaseUrl()}/api/public/lookup?code=${encodeURIComponent(code.trim())}`,
    { method: 'GET', headers: { Accept: 'application/json' } }
  );
  if (res.status === 404) {
    throw new Error('NOT_FOUND');
  }
  if (res.status === 400) {
    throw new Error('รูปแบบรหัสเครื่องมือไม่ถูกต้อง (ตัวอย่าง: MI-001)');
  }
  if (!res.ok) {
    throw new Error(`ไม่สามารถค้นหาข้อมูลเครื่องมือวัดได้ (รหัส ${res.status})`);
  }
  return (await res.json()) as PublicInstrument;
}

export async function uploadInstrumentImage(
  instrumentId: string,
  file: File,
  accessToken: string
): Promise<{ image_key: string; image_url: string }> {
  if (!isWorkerConfigured) {
    throw new Error('ยังไม่ได้เชื่อมต่อ Worker API สำหรับอัปโหลดรูปภาพ');
  }
  const preparedFile = await compressImageIfNeeded(file);
  const formData = new FormData();
  formData.append('file', preparedFile);

  const res = await fetch(
    `${getWorkerApiBaseUrl()}/api/admin/instruments/${encodeURIComponent(instrumentId)}/image`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`
      },
      body: formData
    }
  );

  const payload = (await res.json().catch(() => ({}))) as {
    error?: string;
    image_key?: string;
    image_url?: string;
  };

  if (!res.ok || !payload.image_key || !payload.image_url) {
    throw new Error(payload.error ?? `อัปโหลดรูปไม่สำเร็จ (รหัส ${res.status})`);
  }

  return {
    image_key: payload.image_key,
    image_url: payload.image_url
  };
}
