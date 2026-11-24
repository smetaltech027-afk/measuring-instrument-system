import { createClient, type Session, type SupabaseClient } from '@supabase/supabase-js';
import type {
  Instrument,
  InstrumentDateHistory,
  InstrumentFormValues,
  ReminderLog
} from '../types/instrument';
import { normalizeFormPayload } from './validation';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL?.trim() ?? '';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim() ?? '';

export const isSupabaseConfigured = Boolean(
  supabaseUrl &&
    supabaseAnonKey &&
    !supabaseUrl.includes('your-project-ref') &&
    !supabaseAnonKey.includes('your-supabase-anon-key')
);

let clientInstance: SupabaseClient | null = null;

export function getSupabaseClient(): SupabaseClient {
  if (!isSupabaseConfigured) {
    throw new Error('ยังไม่ได้ตั้งค่าการเชื่อมต่อฐานข้อมูล Supabase ในไฟล์สภาพแวดล้อม (.env)');
  }
  if (!clientInstance) {
    clientInstance = createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false
      }
    });
  }
  return clientInstance;
}

export async function signInAdmin(email: string, password: string): Promise<Session> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.auth.signInWithPassword({
    email: email.trim().toLowerCase(),
    password
  });

  if (error || !data.session) {
    throw new Error('อีเมลหรือรหัสผ่านไม่ถูกต้อง กรุณาตรวจสอบอีกครั้ง');
  }

  // Verify the signed-in user is explicitly listed in app_admins (RLS allows selecting own row)
  const { data: adminRow, error: adminErr } = await supabase
    .from('app_admins')
    .select('user_id, email')
    .eq('user_id', data.session.user.id)
    .maybeSingle();

  if (adminErr || !adminRow) {
    await supabase.auth.signOut();
    throw new Error('บัญชีนี้ไม่ได้รับสิทธิ์ผู้ดูแลระบบ (Admin)');
  }

  return data.session;
}

export async function getVerifiedAdminSession(): Promise<Session | null> {
  if (!isSupabaseConfigured) return null;
  const supabase = getSupabaseClient();
  const {
    data: { session }
  } = await supabase.auth.getSession();
  if (!session) return null;

  const { data: adminRow } = await supabase
    .from('app_admins')
    .select('user_id')
    .eq('user_id', session.user.id)
    .maybeSingle();

  if (!adminRow) {
    await supabase.auth.signOut();
    return null;
  }
  return session;
}

export async function signOutAdmin(): Promise<void> {
  if (!isSupabaseConfigured) return;
  const supabase = getSupabaseClient();
  await supabase.auth.signOut();
}

export async function listAllInstruments(): Promise<Instrument[]> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('instruments')
    .select('*')
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true });

  if (error) {
    throw new Error(`ไม่สามารถโหลดข้อมูลทะเบียนเครื่องมือวัดได้ (${error.message})`);
  }
  return (data ?? []) as Instrument[];
}

export async function createInstrument(values: InstrumentFormValues): Promise<Instrument> {
  const supabase = getSupabaseClient();
  const payload = normalizeFormPayload(values);
  const { data, error } = await supabase
    .from('instruments')
    .insert(payload)
    .select('*')
    .single();

  if (error || !data) {
    throw new Error(`ไม่สามารถเพิ่มเครื่องมือวัดได้ (${error?.message ?? 'unknown error'})`);
  }
  return data as Instrument;
}

export async function updateInstrument(
  id: string,
  values: InstrumentFormValues
): Promise<Instrument> {
  const supabase = getSupabaseClient();
  const payload = normalizeFormPayload(values);
  const { data, error } = await supabase
    .from('instruments')
    .update(payload)
    .eq('id', id)
    .select('*')
    .single();

  if (error || !data) {
    throw new Error(`ไม่สามารถบันทึกการแก้ไขได้ (${error?.message ?? 'unknown error'})`);
  }
  return data as Instrument;
}

export async function listInstrumentDateHistory(
  instrumentId: string
): Promise<InstrumentDateHistory[]> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('instrument_date_history')
    .select('*')
    .eq('instrument_id', instrumentId)
    .order('changed_at', { ascending: false })
    .limit(50);

  if (error) {
    throw new Error(`ไม่สามารถโหลดประวัติการแก้ไขวันที่ได้ (${error.message})`);
  }
  return (data ?? []) as InstrumentDateHistory[];
}

export async function listRecentReminderLogs(): Promise<ReminderLog[]> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('reminder_logs')
    .select('*')
    .order('last_attempt_at', { ascending: false })
    .limit(30);

  if (error) {
    throw new Error(`ไม่สามารถโหลดประวัติการแจ้งเตือนอีเมลได้ (${error.message})`);
  }
  return (data ?? []) as ReminderLog[];
}
