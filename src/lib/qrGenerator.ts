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

/**
 * Render a compact downloadable PNG label containing ONLY the QR code (encoding MI-xxx)
 * and the human-readable code (MI-xxx) underneath — matching the 9x9 mm A4 cut-sheet style.
 */
export async function downloadInstrumentQrPng(instrument: {
  instrument_code: string;
  public_token: string;
  name: string;
  location: string | null;
}): Promise<string> {
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

  const filename = `QR_${compactPayload}.png`;
  const dataUrl = canvas.toDataURL('image/png');
  const link = document.createElement('a');
  link.href = dataUrl;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();

  return filename;
}
