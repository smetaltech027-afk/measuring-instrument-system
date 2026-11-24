/**
 * Live Import Script — Inserts all 74 records from Book1.xlsx into Supabase Postgres.
 * Safety guard: requires BOTH `--confirm-live-import` flag and SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY env vars.
 * Never runs automatically; only run after schema approval and dry-run review.
 */
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { parseInstrumentsFromWorkbook } from './excel-parser.mjs';

const ROOT = process.cwd();
const SOURCE_XLSX = path.join(ROOT, 'Book1.xlsx');

async function main() {
  if (!process.argv.includes('--confirm-live-import')) {
    console.error('Refusing to write to Supabase without --confirm-live-import flag.');
    console.error('Run `npm run import:dry-run` first to inspect all 74 rows.');
    process.exit(1);
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variable.');
    process.exit(1);
  }

  const parsed = await parseInstrumentsFromWorkbook(SOURCE_XLSX);
  if (parsed.stats.total !== 74) {
    throw new Error(`Expected 74 rows from Book1.xlsx, found ${parsed.stats.total}. Aborting.`);
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });

  // Check if instruments already exist to avoid accidental duplicate seeding
  const { count: existingCount, error: countError } = await supabase
    .from('instruments')
    .select('id', { count: 'exact', head: true });
  if (countError) throw countError;
  if ((existingCount ?? 0) > 0 && !process.argv.includes('--upsert-by-code')) {
    throw new Error(
      `Database already has ${existingCount} instruments. Pass --upsert-by-code only if intentionally syncing.`
    );
  }

  const payload = parsed.records.map((r) => ({
    instrument_code: r.instrument_code,
    sort_order: r.sort_order,
    name: r.name,
    size: r.size,
    location: r.location,
    status_text: r.status_text,
    compare_date: r.compare_date,
    calibration_date: r.calibration_date,
    expiry_date: r.expiry_date,
    vendor: r.vendor
  }));

  const { data, error } = await supabase
    .from('instruments')
    .upsert(payload, { onConflict: 'instrument_code' })
    .select('instrument_code, sort_order, compare_date, calibration_date, expiry_date');

  if (error) throw error;

  console.log(`Imported ${data.length} records successfully.`);
  console.log('Post-import verification:', {
    total: data.length,
    compareCount: data.filter((r) => r.compare_date).length,
    calibrationCount: data.filter((r) => r.calibration_date).length,
    expiryCount: data.filter((r) => r.expiry_date).length
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
