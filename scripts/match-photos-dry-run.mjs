/**
 * Photo Matching Dry-Run Utility
 * Usage: node scripts/match-photos-dry-run.mjs [photos_directory]
 * Generates a human-reviewable mapping table ("photo file -> No. -> name -> MI-xxx").
 * Flags ambiguous matches and unsupported formats (e.g. HEIC) for manual confirmation.
 */
import fs from 'node:fs';
import path from 'node:path';
import { parseInstrumentsFromWorkbook } from './excel-parser.mjs';

const ROOT = process.cwd();
const SOURCE_XLSX = path.join(ROOT, 'Book1.xlsx');
const PHOTOS_DIR = process.argv[2] ? path.resolve(process.argv[2]) : path.join(ROOT, 'photos');
const REPORT_PATH = path.join(ROOT, 'reports', 'photo-matching-report.md');

const SUPPORTED_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp']);
const NEEDS_CONVERSION_EXT = new Set(['.heic', '.heif', '.tif', '.tiff', '.bmp']);

function normalizeForMatch(str) {
  return str
    .toLowerCase()
    .replace(/\.[a-z0-9]+$/i, '')
    .replace(/[^a-z0-9ก-๙]+/g, ' ')
    .trim();
}

async function main() {
  if (!fs.existsSync(PHOTOS_DIR)) {
    console.log(`Photos folder not found at: ${PHOTOS_DIR}`);
    console.log('Place photos in ./photos or pass a folder path when ready.');
    return;
  }

  const { records } = await parseInstrumentsFromWorkbook(SOURCE_XLSX);
  const files = fs
    .readdirSync(PHOTOS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));

  const rows = [];
  const conversionWarnings = [];

  for (const filename of files) {
    const ext = path.extname(filename).toLowerCase();
    if (NEEDS_CONVERSION_EXT.has(ext)) {
      conversionWarnings.push(`${filename} (${ext} — browser cannot render natively; convert non-destructively to JPEG/WebP)`);
    } else if (!SUPPORTED_EXT.has(ext)) {
      continue;
    }

    const stem = normalizeForMatch(filename);
    const exactCode = records.filter(
      (r) => stem === r.instrument_code.toLowerCase() || stem === String(r.originalNo)
    );
    const exactName = records.filter((r) => normalizeForMatch(r.name) === stem);
    const partialMatches =
      exactCode.length > 0
        ? exactCode
        : exactName.length > 0
          ? exactName
          : records.filter((r) => {
              const norm = normalizeForMatch(r.name);
              return norm.includes(stem) || stem.includes(norm);
            });

    if (partialMatches.length === 1) {
      const m = partialMatches[0];
      rows.push({
        file: filename,
        status: exactCode.length === 1 || exactName.length === 1 ? 'MATCH_EXACT' : 'REVIEW_SINGLE',
        originalNo: m.originalNo,
        name: m.name,
        code: m.instrument_code
      });
    } else if (partialMatches.length > 1) {
      rows.push({
        file: filename,
        status: 'AMBIGUOUS_WAIT_CONFIRM',
        originalNo: partialMatches.map((m) => m.originalNo).join(', '),
        name: partialMatches.map((m) => m.name).join(' / '),
        code: partialMatches.map((m) => m.instrument_code).join(', ')
      });
    } else {
      rows.push({
        file: filename,
        status: 'UNMATCHED_WAIT_CONFIRM',
        originalNo: '-',
        name: '-',
        code: '-'
      });
    }
  }

  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  const md = [
    '# Photo Matching Dry-Run Report',
    '',
    `- Photos directory: \`${PHOTOS_DIR}\``,
    `- Total image files inspected: **${rows.length}**`,
    '',
    '## Format Warnings',
    ...(conversionWarnings.length > 0 ? conversionWarnings.map((w) => `- ${w}`) : ['- None']),
    '',
    '## Proposed Mapping (Do NOT upload ambiguous/unmatched rows without confirmation)',
    '| ไฟล์รูป | สถานะ | No. เดิม | ชื่อเครื่องมือ | รหัสใหม่ |',
    '| --- | --- | --- | --- | --- |',
    ...rows.map((r) => `| ${r.file} | ${r.status} | ${r.originalNo} | ${r.name} | ${r.code} |`)
  ].join('\n');

  fs.writeFileSync(REPORT_PATH, md + '\n', 'utf8');
  console.log(`Photo matching report saved to ${path.relative(ROOT, REPORT_PATH)}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
