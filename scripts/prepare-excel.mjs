import fs from 'node:fs';
import path from 'node:path';
import ExcelJS from 'exceljs';
import { readWorkbookBufferSafely } from './excel-parser.mjs';

const ROOT = process.cwd();
const SOURCE_XLSX = path.join(ROOT, 'Book1.xlsx');
const OUTPUT_TEMPLATE = path.join(ROOT, 'public', 'templates', 'RG-PD-001-template.xlsx');

function cloneStyle(style) {
  return JSON.parse(JSON.stringify(style ?? {}));
}

async function main() {
  if (!fs.existsSync(SOURCE_XLSX)) {
    throw new Error(`Source file not found: ${SOURCE_XLSX}`);
  }

  const buffer = readWorkbookBufferSafely(SOURCE_XLSX);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);

  const sheet = workbook.getWorksheet('sheet1') ?? workbook.worksheets[0];
  if (!sheet) {
    throw new Error('Could not find sheet1 in Book1.xlsx');
  }

  // Unmerge existing header ranges before shifting columns right to insert column C ("รหัส")
  for (const range of ['B2:H3', 'B4:H5', 'B7:I7']) {
    try {
      sheet.unMergeCells(range);
    } catch {
      // Ignore if already unmerged
    }
  }

  // Capture original column widths (cols 1..10 -> A..J)
  const origWidths = {};
  for (let c = 1; c <= 10; c += 1) {
    origWidths[c] = sheet.getColumn(c).width;
  }

  // Shift columns C..J (3..10) one column right -> D..K (4..11) for rows 1..88
  for (let rowNum = 1; rowNum <= 88; rowNum += 1) {
    const row = sheet.getRow(rowNum);
    for (let colNum = 10; colNum >= 3; colNum -= 1) {
      const src = row.getCell(colNum);
      const dst = row.getCell(colNum + 1);
      dst.value = src.value;
      dst.style = cloneStyle(src.style);
    }
    // Clear shifted source column C (col 3) cleanly before styling it
    const colC = row.getCell(3);
    colC.value = null;
  }

  // Style & label the newly inserted column C ("รหัส")
  const headerC9 = sheet.getCell('C9');
  headerC9.value = 'รหัส';
  headerC9.style = cloneStyle(sheet.getCell('B9').style);

  const sampleB10Style = cloneStyle(sheet.getCell('B10').style);
  for (let rowNum = 10; rowNum <= 83; rowNum += 1) {
    const row = sheet.getRow(rowNum);
    // Clear all real instrument data across B..K (cols 2..11)
    for (let colNum = 2; colNum <= 11; colNum += 1) {
      row.getCell(colNum).value = null;
    }
    // Apply centered grid border style from column B (No.) to column C (รหัส)
    row.getCell(3).style = cloneStyle(sampleB10Style);
  }

  // Preserve top-box borders for column C in rows 2..5 (inside merged B2:I3 and B4:I5)
  for (const r of [2, 3, 4, 5, 7]) {
    sheet.getCell(`C${r}`).style = cloneStyle(sheet.getCell(`D${r}`).style);
  }

  // Re-merge header ranges expanded by +1 column to match B..K layout
  sheet.mergeCells('B2:I3');
  sheet.mergeCells('B4:I5');
  sheet.mergeCells('B7:J7');

  // Set column widths (A, B=No., C=รหัส, D=เครื่องมือ, ..., K=Vendor)
  sheet.getColumn(1).width = origWidths[1] ?? 0.86;
  sheet.getColumn(2).width = origWidths[2] ?? 5.14;
  sheet.getColumn(3).width = 10.5; // รหัส (MI-XXX)
  for (let c = 3; c <= 10; c += 1) {
    if (origWidths[c]) {
      sheet.getColumn(c + 1).width = origWidths[c];
    }
  }

  // Ensure A4 portrait fits all 10 table columns cleanly on 1 page width
  sheet.pageSetup.paperSize = 9; // A4
  sheet.pageSetup.orientation = 'portrait';
  sheet.pageSetup.fitToPage = true;
  sheet.pageSetup.fitToWidth = 1;
  sheet.pageSetup.fitToHeight = 0;

  if (sheet.autoFilter) {
    sheet.autoFilter = undefined;
  }

  fs.mkdirSync(path.dirname(OUTPUT_TEMPLATE), { recursive: true });
  await workbook.xlsx.writeFile(OUTPUT_TEMPLATE);

  // Verify generated blank template
  const verifyWb = new ExcelJS.Workbook();
  await verifyWb.xlsx.readFile(OUTPUT_TEMPLATE);
  const verifySheet = verifyWb.getWorksheet('sheet1') ?? verifyWb.worksheets[0];

  let nonEmptyDataCells = 0;
  for (let rowNum = 10; rowNum <= 83; rowNum += 1) {
    const row = verifySheet.getRow(rowNum);
    for (let colNum = 2; colNum <= 11; colNum += 1) {
      if (row.getCell(colNum).value !== null && row.getCell(colNum).value !== undefined) {
        nonEmptyDataCells += 1;
      }
    }
  }

  if (nonEmptyDataCells > 0) {
    throw new Error(
      `Template verification failed: found ${nonEmptyDataCells} non-empty cells in B10:K83`
    );
  }

  const headers = [];
  for (let col = 2; col <= 11; col += 1) {
    headers.push(verifySheet.getRow(9).getCell(col).value);
  }

  const summary = {
    templatePath: path.relative(ROOT, OUTPUT_TEMPLATE),
    sheetName: verifySheet.name,
    companyHeader: verifySheet.getCell('B2').value,
    docNumber: verifySheet.getCell('K2').value,
    titleHeader: verifySheet.getCell('B4').value,
    tableTitle: verifySheet.getCell('B7').value,
    headers,
    footerCheckBy: verifySheet.getCell('I86').value,
    footerApprovedBy: verifySheet.getCell('J86').value,
    footerDate: verifySheet.getCell('B87').value,
    pageSetup: {
      paperSize: verifySheet.pageSetup.paperSize,
      orientation: verifySheet.pageSetup.orientation,
      fitToPage: verifySheet.pageSetup.fitToPage,
      fitToWidth: verifySheet.pageSetup.fitToWidth
    },
    nonEmptyDataCells
  };

  console.log('Blank Excel template (with รหัส column) created and verified:');
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
