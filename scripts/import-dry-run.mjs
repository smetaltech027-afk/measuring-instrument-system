import fs from 'node:fs';
import path from 'node:path';
import { parseInstrumentsFromWorkbook } from './excel-parser.mjs';

const ROOT = process.cwd();
const SOURCE_XLSX = path.join(ROOT, 'Book1.xlsx');
const REPORT_DIR = path.join(ROOT, 'reports');

async function main() {
  const result = await parseInstrumentsFromWorkbook(SOURCE_XLSX);
  fs.mkdirSync(REPORT_DIR, { recursive: true });

  const jsonPath = path.join(REPORT_DIR, 'import-dry-run-report.json');
  const mdPath = path.join(REPORT_DIR, 'import-dry-run-summary.md');

  fs.writeFileSync(
    jsonPath,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        sourceFile: 'Book1.xlsx',
        ...result
      },
      null,
      2
    ),
    'utf8'
  );

  const lines = [
    '# Dry-Run Import Report (Local Only — Do NOT Commit)',
    '',
    `- Generated At: ${new Date().toISOString()}`,
    `- Sheet: \`${result.sheetName}\``,
    `- Total Records: **${result.stats.total}**`,
    `- Compare Date Count: **${result.stats.withCompareDate}**`,
    `- Calibration Date Count: **${result.stats.withCalibrationDate}**`,
    `- Expiry Date Count: **${result.stats.withExpiryDate}**`,
    `- Vendor Empty (null): **${result.stats.emptyVendorCount}**`,
    `- Vendor Dash ("-"): **${result.stats.dashVendorCount}**`,
    '',
    '## Notes / Anomalies',
    ...(result.anomalies.length > 0 ? result.anomalies.map((a) => `- ${a}`) : ['- None']),
    '',
    '## Mapped 74 Records',
    '| No. | Code | Name | Size | Location (User) | Status | Compare | Calibration | Expiry | Vendor |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
    ...result.records.map(
      (r) =>
        `| ${r.originalNo} | ${r.instrument_code} | ${r.name} | ${r.size ?? ''} | ${r.location ?? ''} | ${r.status_text} | ${r.compare_date ?? '-'} | ${r.calibration_date ?? '-'} | ${r.expiry_date ?? '-'} | ${r.vendor ?? '(ว่าง)'} |`
    )
  ];

  fs.writeFileSync(mdPath, lines.join('\n') + '\n', 'utf8');

  console.log('Dry-run import report written (gitignored):');
  console.log(`- ${path.relative(ROOT, jsonPath)}`);
  console.log(`- ${path.relative(ROOT, mdPath)}`);
  console.log('Stats:', result.stats);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
