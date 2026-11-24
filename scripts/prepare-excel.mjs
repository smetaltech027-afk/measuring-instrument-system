import fs from 'node:fs';
import path from 'node:path';
import ExcelJS from 'exceljs';
import { readWorkbookBufferSafely } from './excel-parser.mjs';

const ROOT = process.cwd();
const SOURCE_XLSX = path.join(ROOT, 'Book1.xlsx');
const OUTPUT_TEMPLATE = path.join(ROOT, 'public', 'templates', 'RG-PD-001-template.xlsx');

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

  // Clear all real instrument data in rows 10..83 while preserving cell styles, borders, column widths,
  // merged headers (B2:H3, B4:H5, B7:I7), footer (H86:I86, B87), and A4 portrait print layout.
  for (let rowNum = 10; rowNum <= 83; rowNum += 1) {
    const row = sheet.getRow(rowNum);
    for (let colNum = 2; colNum <= 10; colNum += 1) {
      row.getCell(colNum).value = null;
    }
  }

  // Remove AutoFilter defined name pointing to old data range if present
  if (sheet.autoFilter) {
    sheet.autoFilter = undefined;
  }

  fs.mkdirSync(path.dirname(OUTPUT_TEMPLATE), { recursive: true });
  await workbook.xlsx.writeFile(OUTPUT_TEMPLATE);

  // Verify the generated blank template contains zero real instrument rows and keeps all layout metadata
  const verifyWb = new ExcelJS.Workbook();
  await verifyWb.xlsx.readFile(OUTPUT_TEMPLATE);
  const verifySheet = verifyWb.getWorksheet('sheet1') ?? verifyWb.worksheets[0];

  let nonEmptyDataCells = 0;
  for (let rowNum = 10; rowNum <= 83; rowNum += 1) {
    const row = verifySheet.getRow(rowNum);
    for (let colNum = 2; colNum <= 10; colNum += 1) {
      if (row.getCell(colNum).value !== null && row.getCell(colNum).value !== undefined) {
        nonEmptyDataCells += 1;
      }
    }
  }

  if (nonEmptyDataCells > 0) {
    throw new Error(`Template verification failed: found ${nonEmptyDataCells} non-empty cells in B10:J83`);
  }

  const summary = {
    templatePath: path.relative(ROOT, OUTPUT_TEMPLATE),
    sheetName: verifySheet.name,
    companyHeader: verifySheet.getCell('B2').value,
    docNumber: verifySheet.getCell('J2').value,
    titleHeader: verifySheet.getCell('B4').value,
    tableTitle: verifySheet.getCell('B7').value,
    footerCheckBy: verifySheet.getCell('H86').value,
    footerApprovedBy: verifySheet.getCell('I86').value,
    footerDate: verifySheet.getCell('B87').value,
    pageSetup: {
      paperSize: verifySheet.pageSetup.paperSize,
      orientation: verifySheet.pageSetup.orientation,
      scale: verifySheet.pageSetup.scale
    },
    nonEmptyDataCells
  };

  console.log('Blank Excel template created and verified:');
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
