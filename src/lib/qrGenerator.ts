import QRCode from 'qrcode';
import { buildCompactQrPayload } from './qrUrl';

/**
 * Generate a crisp high-contrast Version-1 QR data URL for compact labels (e.g. 9x9 mm).
 * Uses pure black on white with tight 1-module quiet zone for maximum scan clarity.
 */
export async function generateQrDataUrl(payload: string, width = 300): Promise<string> {
  return QRCode.toDataURL(payload, {
    width,
    margin: 1,
    errorCorrectionLevel: 'M',
    color: {
      dark: '#000000',
      light: '#FFFFFF'
    }
  });
}

export interface RenderedQrCard {
  code: string;
  filename: string;
  blob: Blob;
  previewUrl: string;
}

/**
 * Render a compact PNG label Blob containing ONLY the QR code (encoding MI-xxx)
 * and the human-readable code (MI-xxx) underneath — compatible with iOS Safari & Desktop.
 */
export async function renderInstrumentQrCardBlob(instrument: {
  instrument_code: string;
  public_token: string;
  name: string;
  location: string | null;
}): Promise<RenderedQrCard> {
  const compactPayload = buildCompactQrPayload(instrument.instrument_code);
  const qrDataUrl = await generateQrDataUrl(compactPayload, 300);

  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error('สร้างภาพ QR ไม่สำเร็จ'));
    el.src = qrDataUrl;
  });

  // Compact proportion matching 13x16 mm label (at ~300 DPI -> 260x320 px crisp export)
  const canvas = document.createElement('canvas');
  canvas.width = 260;
  canvas.height = 320;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('เบราว์เซอร์ไม่รองรับการสร้างไฟล์ภาพ QR');

  // White background & subtle dashed cut border
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.save();
  ctx.strokeStyle = '#6B8494';
  ctx.lineWidth = 2;
  ctx.setLineDash([6, 4]);
  ctx.strokeRect(8, 8, canvas.width - 16, canvas.height - 16);
  ctx.restore();

  // Crisp QR code (9x9 mm proportion)
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(img, 30, 26, 200, 200);

  // Instrument code only (e.g. MI-001)
  ctx.fillStyle = '#173447';
  ctx.font = '700 34px "IBM Plex Mono", Consolas, monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(compactPayload, canvas.width / 2, 272);

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((result) => {
      if (result) resolve(result);
      else reject(new Error('แปลงภาพ QR เป็นไฟล์ PNG ไม่สำเร็จ'));
    }, 'image/png');
  });

  const filename = `QR_${compactPayload}.png`;
  const previewUrl = URL.createObjectURL(blob);

  return {
    code: compactPayload,
    filename,
    blob,
    previewUrl
  };
}

/**
 * Trigger a Blob-backed file download (avoids iOS Safari's `data:` URI navigation bug).
 * Keeps the object URL alive for 60s so iOS Safari's confirmation dialog ("ดู / ดาวน์โหลด") works reliably.
 */
export function downloadQrBlob(blob: Blob, filename: string): void {
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = objectUrl;
  link.download = filename;
  link.rel = 'noopener';
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
}

export function canUseNativeFileShare(blob: Blob, filename: string): boolean {
  if (typeof navigator === 'undefined' || typeof navigator.share !== 'function') {
    return false;
  }
  try {
    const file = new File([blob], filename, { type: 'image/png' });
    return typeof navigator.canShare === 'function' ? navigator.canShare({ files: [file] }) : false;
  } catch {
    return false;
  }
}

export async function shareQrBlob(blob: Blob, filename: string): Promise<'shared' | 'cancelled'> {
  const file = new File([blob], filename, { type: 'image/png' });
  try {
    await navigator.share({
      files: [file],
      title: filename
    });
    return 'shared';
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      return 'cancelled';
    }
    throw err;
  }
}
