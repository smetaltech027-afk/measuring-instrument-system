import QRCode from 'qrcode';
import { buildInstrumentQrUrl } from './qrUrl';

export async function generateQrDataUrl(url: string, width = 360): Promise<string> {
  return QRCode.toDataURL(url, {
    width,
    margin: 2,
    errorCorrectionLevel: 'M',
    color: {
      dark: '#173447',
      light: '#FFFFFF'
    }
  });
}

function wrapCanvasText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  maxLines: number
): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = '';

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (ctx.measureText(candidate).width <= maxWidth) {
      current = candidate;
    } else {
      if (current) lines.push(current);
      // Handle single long Thai/English token exceeding maxWidth
      if (ctx.measureText(word).width > maxWidth) {
        let chunk = '';
        for (const ch of word) {
          if (ctx.measureText(chunk + ch).width > maxWidth && chunk) {
            lines.push(chunk);
            chunk = ch;
          } else {
            chunk += ch;
          }
        }
        current = chunk;
      } else {
        current = word;
      }
    }
    if (lines.length >= maxLines) break;
  }

  if (current && lines.length < maxLines) {
    lines.push(current);
  }

  if (lines.length === maxLines) {
    const last = lines[maxLines - 1];
    if (ctx.measureText(last).width > maxWidth - 16) {
      lines[maxLines - 1] = `${last.slice(0, Math.max(1, last.length - 2))}…`;
    }
  }

  return lines;
}

/**
 * Render a crisp downloadable PNG label card containing the QR code,
 * human-readable permanent code (MI-xxx), and instrument name (supports Thai & long names).
 */
export async function downloadInstrumentQrPng(instrument: {
  instrument_code: string;
  public_token: string;
  name: string;
  location: string | null;
}): Promise<string> {
  const qrUrl = buildInstrumentQrUrl(instrument.public_token);
  const qrDataUrl = await generateQrDataUrl(qrUrl, 480);

  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error('สร้างภาพ QR ไม่สำเร็จ'));
    el.src = qrDataUrl;
  });

  const canvas = document.createElement('canvas');
  canvas.width = 640;
  canvas.height = 820;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('เบราว์เซอร์ไม่รองรับการสร้างไฟล์ภาพ QR');

  // Card background & outer border
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.strokeStyle = '#173447';
  ctx.lineWidth = 4;
  ctx.strokeRect(18, 18, canvas.width - 36, canvas.height - 36);

  // Header strip
  ctx.fillStyle = '#173447';
  ctx.fillRect(18, 18, canvas.width - 36, 76);

  ctx.fillStyle = '#FFFFFF';
  ctx.font = '600 24px "IBM Plex Sans Thai", sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('S METAL TECH — ทะเบียนเครื่องมือวัด', canvas.width / 2, 65);

  // QR image
  ctx.drawImage(img, 80, 118, 480, 480);

  // Code badge
  ctx.fillStyle = '#EAF3F6';
  ctx.fillRect(140, 612, 360, 56);
  ctx.strokeStyle = '#246A82';
  ctx.lineWidth = 2;
  ctx.strokeRect(140, 612, 360, 56);

  ctx.fillStyle = '#173447';
  ctx.font = '600 32px "IBM Plex Mono", monospace';
  ctx.fillText(instrument.instrument_code, canvas.width / 2, 651);

  // Instrument name (up to 2 wrapped lines)
  ctx.fillStyle = '#173447';
  ctx.font = '600 24px "IBM Plex Sans Thai", sans-serif';
  const nameLines = wrapCanvasText(ctx, instrument.name, 540, 2);
  nameLines.forEach((line, index) => {
    ctx.fillText(line, canvas.width / 2, 712 + index * 34);
  });

  // Location sub-caption
  if (instrument.location) {
    ctx.fillStyle = '#4B6475';
    ctx.font = '500 20px "IBM Plex Sans Thai", sans-serif';
    ctx.fillText(instrument.location, canvas.width / 2, 782);
  }

  const filename = `QR_${instrument.instrument_code}.png`;
  const dataUrl = canvas.toDataURL('image/png');
  const link = document.createElement('a');
  link.href = dataUrl;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();

  return filename;
}
