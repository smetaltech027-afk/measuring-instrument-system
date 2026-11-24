import fs from 'node:fs';
import path from 'node:path';
import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { buildExportWorkbookBuffer } from '../src/lib/excelExport';
import type { Instrument } from '../src/types/instrument';
// @ts-expect-error ESM script module without .d.ts
import { parseInstrumentsFromWorkbook } from '../scripts/excel-parser.mjs';

const ROOT = process.cwd();
const SOURCE_XLSX = path.join(ROOT, 'Book1.xlsx');
const TEMPLATE_XLSX = path.join(ROOT, 'public', 'templates', 'RG-PD-001-template.xlsx');

function toInstrumentEntity(row: Record<string, unknown>, idx: number): Instrument {
  return {
    id: `00000000-0000-4000-8000-${String(idx + 1).padStart(12, '0')}`,
    public_token: `token_${String(idx + 1).padStart(3, '0')}_abcdefghijklmnopqrstuv`,
    instrument_code: String(row.instrument_code),
    sort_order: Number(row.sort_order),
    name: String(row.name),
    size: (row.size as string | null) ?? null,
    location: (row.location as string | null) ?? null,
    status_text: String(row.status_text),
    compare_date: (row.compare_date as string | null) ?? null,
    calibration_date: (row.calibration_date as string | null) ?? null,
    expiry_date: (row.expiry_date as string | null) ?? null,
    vendor: (row.vendor as string | null) ?? null,
    image_key: null,
    created_at: '2026-11-24T00:00:00.000Z',
    updated_at: '2026-11-24T00:00:00.000Z'
  };
}

describe('Book1.xlsx import mapping and RG-PD-001 Excel export', () => {
  it('reads all 74 records accurately from Book1.xlsx without mutating source values', async () => {
    const parsed = await parseInstrumentsFromWorkbook(SOURCE_XLSX);

    expect(parsed.stats.total).toBe(74);
    expect(parsed.stats.withCompareDate).toBe(47);
    expect(parsed.stats.withCalibrationDate).toBe(27);
    expect(parsed.stats.withExpiryDate).toBe(74);
    expect(parsed.stats.emptyVendorCount).toBe(1);

    const no63 = parsed.records.find((r: { originalNo: number }) => r.originalNo === 63);
    expect(no63.name).toBe('T- Point No. 012 (Holtest)');
    expect(no63.expiry_date).toBe('2026-07-02');
    expect(no63.vendor).toBe('JSR');

    const no67 = parsed.records.find((r: { originalNo: number }) => r.originalNo === 67);
    expect(no67.name).toBe('Dial Gauge No. 006');
    expect(no67.vendor).toBeNull();
  });

  it('exports all 74 instruments preserving RG-PD-001 layout, headers, dates, and signature block', async () => {
    const parsed = await parseInstrumentsFromWorkbook(SOURCE_XLSX);
    const entities: Instrument[] = parsed.records.map(toInstrumentEntity);
    const templateBuf = fs.readFileSync(TEMPLATE_XLSX);

    const outBuf = await buildExportWorkbookBuffer(
      templateBuf,
      entities,
      new Date('2026-11-24T03:00:00Z')
    );

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(outBuf);
    const sheet = wb.getWorksheet('sheet1')!;

    expect(sheet.getCell('B2').value).toBe('บริษัท เอส เมททอล เทค จำกัด');
    expect(sheet.getCell('J2').value).toBe('RG-PD-001');
    expect(sheet.getCell('J5').value).toBe('1/1');
    expect(sheet.getCell('B10').value).toBe(1);
    expect(sheet.getCell('C10').value).toBe('Vernier Caliper No. 001');
    expect(sheet.getCell('H10').value).toBe(' -');
    expect(sheet.getCell('B83').value).toBe(74);
    expect(sheet.getCell('C83').value).toBe('Micro meter No.009');
    expect(sheet.getCell('H86').value).toBe('Check by');
    expect(sheet.getCell('I86').value).toBe('Approved by');
    expect(sheet.getCell('B87').value).toBe('Date 24/11/2026');
    expect(sheet.pageSetup.paperSize).toBe(9);
    expect(sheet.pageSetup.orientation).toBe('portrait');
  });

  it('expands smoothly past 74 rows without overlapping signature block and updates page count', async () => {
    const parsed = await parseInstrumentsFromWorkbook(SOURCE_XLSX);
    const entities: Instrument[] = parsed.records.map(toInstrumentEntity);

    // Add 6 extra instruments (total 80 rows -> 6 rows beyond base capacity 74)
    for (let i = 75; i <= 80; i += 1) {
      entities.push({
        ...entities[0],
        id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
        public_token: `token_${String(i).padStart(3, '0')}_abcdefghijklmnopqrstuv`,
        instrument_code: `MI-${String(i).padStart(3, '0')}`,
        sort_order: i,
        name: `New Precision Gauge ${i}`
      });
    }

    const templateBuf = fs.readFileSync(TEMPLATE_XLSX);
    const outBuf = await buildExportWorkbookBuffer(
      templateBuf,
      entities,
      new Date('2026-11-24T03:00:00Z')
    );

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(outBuf);
    const sheet = wb.getWorksheet('sheet1')!;

    expect(sheet.getCell('J5').value).toBe('1/2');
    expect(sheet.getCell('B89').value).toBe(80);
    expect(sheet.getCell('C89').value).toBe('New Precision Gauge 80');
    // Footer shifted cleanly by +6 rows (86 -> 92, 87 -> 93)
    expect(sheet.getCell('H92').value).toBe('Check by');
    expect(sheet.getCell('I92').value).toBe('Approved by');
    expect(sheet.getCell('B93').value).toBe('Date 24/11/2026');
  });
});
