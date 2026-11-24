import ExcelJS from 'exceljs';
import type { Instrument } from '../types/instrument';
import { getBangkokTodayIso } from './dateRules';

const DATA_START_ROW = 10;
const BASE_TEMPLATE_CAPACITY = 74; // Rows 10..83 in Book1.xlsx / RG-PD-001-template.xlsx
const TEMPLATE_FOOTER_DATE_ROW = 87;

function isoToUtcDate(iso: string | null): Date | null {
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function formatThaiGregorianDate(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

function copyRowStyle(sourceRow: ExcelJS.Row, targetRow: ExcelJS.Row): void {
  targetRow.height = sourceRow.height ?? 15;
  for (let col = 2; col <= 10; col += 1) {
    const srcCell = sourceRow.getCell(col);
    const dstCell = targetRow.getCell(col);
    dstCell.style = JSON.parse(JSON.stringify(srcCell.style));
  }
}

/**
 * Populate the blank RG-PD-001 template with ALL registry instruments (unfiltered, ordered by sort_order).
 * Preserves company header, document number, column widths, borders, signature block, and A4 portrait layout.
 * Automatically shifts signature block downward and updates page count when instrument count exceeds 74.
 */
export async function buildExportWorkbookBuffer(
  templateBuffer: ArrayBuffer | Uint8Array,
  instruments: Instrument[],
  exportDate: Date = new Date()
): Promise<ArrayBuffer> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(templateBuffer as ArrayBuffer);

  const sheet = workbook.getWorksheet('sheet1') ?? workbook.worksheets[0];
  if (!sheet) {
    throw new Error('ไม่พบชีต sheet1 ในไฟล์ต้นแบบ RG-PD-001');
  }

  const ordered = [...instruments].sort((a, b) => {
    if (a.sort_order !== b.sort_order) return a.sort_order - b.sort_order;
    return a.created_at.localeCompare(b.created_at);
  });

  const extraRows = Math.max(0, ordered.length - BASE_TEMPLATE_CAPACITY);
  const styleReferenceRow = sheet.getRow(DATA_START_ROW);

  if (extraRows > 0) {
    const insertPosition = DATA_START_ROW + BASE_TEMPLATE_CAPACITY;
    const blanks = Array.from({ length: extraRows }, () => []);
    sheet.spliceRows(insertPosition, 0, ...blanks);
    for (let offset = 0; offset < extraRows; offset += 1) {
      const addedRow = sheet.getRow(insertPosition + offset);
      copyRowStyle(styleReferenceRow, addedRow);
    }
    // Repeat table header row on subsequent printed pages
    sheet.pageSetup.printTitlesRow = '1:9';
  }

  const totalDataSlots = BASE_TEMPLATE_CAPACITY + extraRows;
  for (let idx = 0; idx < totalDataSlots; idx += 1) {
    const rowNum = DATA_START_ROW + idx;
    const row = sheet.getRow(rowNum);
    const item = ordered[idx];

    if (!item) {
      for (let col = 2; col <= 10; col += 1) {
        row.getCell(col).value = null;
      }
      continue;
    }

    row.getCell(2).value = idx + 1; // Dynamic No. 1..N (permanent code & QR token remain untouched)
    row.getCell(3).value = item.name;
    row.getCell(4).value = item.size ?? null;
    row.getCell(5).value = item.location ?? null; // Export keeps original "User" column header
    row.getCell(6).value = item.status_text;

    const cmpDate = isoToUtcDate(item.compare_date);
    const calDate = isoToUtcDate(item.calibration_date);
    const expDate = isoToUtcDate(item.expiry_date);

    row.getCell(7).value = cmpDate;
    row.getCell(8).value = calDate ?? (cmpDate ? ' -' : null);
    row.getCell(9).value = expDate;
    row.getCell(10).value = item.vendor ?? null;
  }

  // Update print date and page count
  const todayIso = getBangkokTodayIso(exportDate);
  const todayDateObj = isoToUtcDate(todayIso);
  sheet.getCell('J3').value = todayDateObj;

  const totalPages = Math.max(1, Math.ceil(Math.max(1, ordered.length) / BASE_TEMPLATE_CAPACITY));
  sheet.getCell('J5').value = `1/${totalPages}`;

  const footerDateRowNum = TEMPLATE_FOOTER_DATE_ROW + extraRows;
  sheet.getCell(`B${footerDateRowNum}`).value = `Date ${formatThaiGregorianDate(todayIso)}`;

  const out = await workbook.xlsx.writeBuffer();
  return out as ArrayBuffer;
}

export async function exportFullRegistryExcel(instruments: Instrument[]): Promise<string> {
  const baseUrl = import.meta.env.BASE_URL || '/';
  const templateUrl = `${baseUrl.replace(/\/+$/, '')}/templates/RG-PD-001-template.xlsx`;

  const response = await fetch(templateUrl);
  if (!response.ok) {
    throw new Error(`ไม่สามารถโหลดไฟล์ต้นแบบ Excel ได้ (${response.status})`);
  }

  const templateBuffer = await response.arrayBuffer();
  const outputBuffer = await buildExportWorkbookBuffer(templateBuffer, instruments, new Date());

  const todayIso = getBangkokTodayIso(new Date());
  const filename = `RG-PD-001_Measuring-Instruments_${todayIso}.xlsx`;

  const blob = new Blob([outputBuffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  });
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = objectUrl;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);

  return filename;
}
