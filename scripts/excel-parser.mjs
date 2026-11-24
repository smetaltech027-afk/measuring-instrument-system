import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import ExcelJS from 'exceljs';

/**
 * Safely read Book1.xlsx into a Buffer even if Microsoft Excel currently holds a lock on Windows.
 */
export function readWorkbookBufferSafely(xlsxPath) {
  try {
    return fs.readFileSync(xlsxPath);
  } catch (err) {
    if (process.platform !== 'win32') throw err;
    const tmpFile = path.join(os.tmpdir(), `mi-xlsx-read-${Date.now()}.xlsx`);
    const psScript = [
      `$in = [System.IO.File]::Open('${xlsxPath.replace(/'/g, "''")}', 'Open', 'Read', 'ReadWrite')`,
      `$out = [System.IO.File]::Create('${tmpFile.replace(/'/g, "''")}')`,
      `$in.CopyTo($out); $out.Close(); $in.Close()`
    ].join('; ');
    execFileSync('powershell', ['-NoProfile', '-Command', psScript], { stdio: 'pipe' });
    try {
      return fs.readFileSync(tmpFile);
    } finally {
      if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
    }
  }
}

/**
 * Convert an ExcelJS cell value to an ISO date string (YYYY-MM-DD) or null.
 * Dash placeholders like "-", " -", " - " are normalized to null.
 */
export function parseExcelDateCell(value) {
  if (value === null || value === undefined) return null;

  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const yyyy = value.getUTCFullYear();
    const mm = String(value.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(value.getUTCDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    const ms = Math.round((value - 25569) * 86400 * 1000);
    const d = new Date(ms);
    if (Number.isNaN(d.getTime())) return null;
    const yyyy = d.getUTCFullYear();
    const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(d.getUTCDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed || trimmed === '-') return null;
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
    throw new Error(`Unexpected string in date cell: ${JSON.stringify(value)}`);
  }

  if (typeof value === 'object' && 'result' in value) {
    return parseExcelDateCell(value.result);
  }

  throw new Error(`Unsupported date cell value: ${JSON.stringify(value)}`);
}

export function normalizeTextPreserveOriginal(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'object' && 'richText' in value && Array.isArray(value.richText)) {
    const joined = value.richText.map((part) => part.text ?? '').join('');
    return joined === '' ? null : joined;
  }
  const str = String(value);
  return str === '' ? null : str;
}

/**
 * Parse all instrument rows (B10:J83 or until first empty row before footer) from Book1.xlsx.
 */
export async function parseInstrumentsFromWorkbook(xlsxPath) {
  const buffer = readWorkbookBufferSafely(xlsxPath);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);

  const sheet = workbook.getWorksheet('sheet1') ?? workbook.worksheets[0];
  if (!sheet) {
    throw new Error('Worksheet "sheet1" not found in workbook');
  }

  const records = [];
  const anomalies = [];

  for (let rowNum = 10; rowNum <= sheet.rowCount; rowNum += 1) {
    const row = sheet.getRow(rowNum);
    const rawNo = row.getCell('B').value;
    const rawName = row.getCell('C').value;

    // Stop when reaching empty gap / footer rows (Check by / Date ...)
    if (
      (rawNo === null || rawNo === undefined || rawNo === '') &&
      (rawName === null || rawName === undefined || rawName === '')
    ) {
      if (records.length > 0) break;
      continue;
    }

    const sortOrder = Number(rawNo);
    if (!Number.isInteger(sortOrder) || sortOrder <= 0) {
      break;
    }

    const name = normalizeTextPreserveOriginal(rawName);
    const size = normalizeTextPreserveOriginal(row.getCell('D').value);
    const location = normalizeTextPreserveOriginal(row.getCell('E').value);
    const statusText = normalizeTextPreserveOriginal(row.getCell('F').value) ?? 'available';
    const rawCompare = row.getCell('G').value;
    const rawCalib = row.getCell('H').value;
    const rawExpire = row.getCell('I').value;
    const vendor = normalizeTextPreserveOriginal(row.getCell('J').value);

    const compareDate = parseExcelDateCell(rawCompare);
    const calibrationDate = parseExcelDateCell(rawCalib);
    const expiryDate = parseExcelDateCell(rawExpire);

    const instrumentCode = `MI-${String(sortOrder).padStart(3, '0')}`;

    if (!name) anomalies.push(`Row ${rowNum} (No.${sortOrder}): missing instrument name`);
    if (compareDate && calibrationDate) {
      anomalies.push(`Row ${rowNum} (No.${sortOrder}): both compare_date and calibration_date present`);
    }
    if (!compareDate && !calibrationDate) {
      anomalies.push(`Row ${rowNum} (No.${sortOrder}): neither compare_date nor calibration_date present`);
    }
    if (!expiryDate) {
      anomalies.push(`Row ${rowNum} (No.${sortOrder}): missing expiry_date`);
    }
    if (vendor === null) {
      anomalies.push(`Row ${rowNum} (No.${sortOrder}, "${name}"): vendor is empty (preserved as null)`);
    }
    if (typeof rawCalib === 'string' && rawCalib.trim() === '-') {
      // Expected placeholder dash in source file; tracked in stats instead of error
    }

    records.push({
      excelRow: rowNum,
      originalNo: sortOrder,
      sort_order: sortOrder,
      instrument_code: instrumentCode,
      name,
      size,
      location,
      status_text: statusText,
      compare_date: compareDate,
      calibration_date: calibrationDate,
      expiry_date: expiryDate,
      vendor
    });
  }

  return {
    sheetName: sheet.name,
    records,
    anomalies,
    stats: {
      total: records.length,
      withCompareDate: records.filter((r) => r.compare_date !== null).length,
      withCalibrationDate: records.filter((r) => r.calibration_date !== null).length,
      withExpiryDate: records.filter((r) => r.expiry_date !== null).length,
      emptyVendorCount: records.filter((r) => r.vendor === null).length,
      dashVendorCount: records.filter((r) => r.vendor === '-').length
    }
  };
}
