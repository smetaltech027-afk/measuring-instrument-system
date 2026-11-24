import type { Env, InstrumentRow, ReminderLogRow } from './types';

export interface SupabaseDataStore {
  getInstrumentByToken(token: string): Promise<InstrumentRow | null>;
  getInstrumentByCode(code: string): Promise<InstrumentRow | null>;
  getInstrumentById(id: string): Promise<InstrumentRow | null>;
  updateInstrumentImageKey(id: string, imageKey: string): Promise<void>;
  verifyAdminJwt(jwt: string): Promise<{ userId: string; email: string } | null>;
  listInstrumentsWithExpiry(): Promise<InstrumentRow[]>;
  listReminderLogs(): Promise<ReminderLogRow[]>;
  upsertReminderLock(entry: {
    instrument_id: string;
    expiry_date: string;
    reminder_type: '7_day' | 'catch_up';
    attempt_count: number;
    locked_until: string;
  }): Promise<void>;
  recordReminderOutcome(entry: {
    instrument_id: string;
    expiry_date: string;
    status: 'sent' | 'failed';
    sent_at: string | null;
    error_summary: string | null;
  }): Promise<void>;
}

const PUBLIC_SELECT =
  'id,public_token,instrument_code,sort_order,name,size,location,status_text,compare_date,calibration_date,expiry_date,vendor,image_key';

export function createSupabaseDataStore(env: Env): SupabaseDataStore {
  const baseUrl = env.SUPABASE_URL.replace(/\/+$/, '');
  const serviceHeaders = {
    apikey: env.SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    'Content-Type': 'application/json'
  };

  async function restGet<T>(query: string): Promise<T> {
    const res = await fetch(`${baseUrl}/rest/v1/${query}`, {
      method: 'GET',
      headers: serviceHeaders
    });
    if (!res.ok) {
      throw new Error(`Supabase REST GET failed (${res.status})`);
    }
    return (await res.json()) as T;
  }

  return {
    async getInstrumentByToken(token: string): Promise<InstrumentRow | null> {
      const rows = await restGet<InstrumentRow[]>(
        `instruments?select=${PUBLIC_SELECT}&public_token=eq.${encodeURIComponent(token)}&limit=1`
      );
      return rows[0] ?? null;
    },

    async getInstrumentByCode(code: string): Promise<InstrumentRow | null> {
      const rows = await restGet<InstrumentRow[]>(
        `instruments?select=${PUBLIC_SELECT}&instrument_code=ilike.${encodeURIComponent(code)}&limit=1`
      );
      return rows[0] ?? null;
    },

    async getInstrumentById(id: string): Promise<InstrumentRow | null> {
      const rows = await restGet<InstrumentRow[]>(
        `instruments?select=${PUBLIC_SELECT}&id=eq.${encodeURIComponent(id)}&limit=1`
      );
      return rows[0] ?? null;
    },

    async updateInstrumentImageKey(id: string, imageKey: string): Promise<void> {
      const res = await fetch(`${baseUrl}/rest/v1/instruments?id=eq.${encodeURIComponent(id)}`, {
        method: 'PATCH',
        headers: { ...serviceHeaders, Prefer: 'return=minimal' },
        body: JSON.stringify({ image_key: imageKey })
      });
      if (!res.ok) {
        throw new Error(`Failed to update image_key (${res.status})`);
      }
    },

    async verifyAdminJwt(jwt: string): Promise<{ userId: string; email: string } | null> {
      const userRes = await fetch(`${baseUrl}/auth/v1/user`, {
        method: 'GET',
        headers: {
          apikey: env.SUPABASE_SERVICE_ROLE_KEY,
          Authorization: `Bearer ${jwt}`
        }
      });
      if (!userRes.ok) return null;
      const user = (await userRes.json()) as { id?: string; email?: string };
      if (!user.id || !user.email) return null;

      const adminRows = await restGet<Array<{ user_id: string; email: string }>>(
        `app_admins?select=user_id,email&user_id=eq.${encodeURIComponent(user.id)}&limit=1`
      );
      if (adminRows.length === 0) return null;
      return { userId: adminRows[0].user_id, email: adminRows[0].email };
    },

    async listInstrumentsWithExpiry(): Promise<InstrumentRow[]> {
      return restGet<InstrumentRow[]>(
        `instruments?select=${PUBLIC_SELECT}&expiry_date=not.is.null&order=expiry_date.asc`
      );
    },

    async listReminderLogs(): Promise<ReminderLogRow[]> {
      return restGet<ReminderLogRow[]>('reminder_logs?select=*');
    },

    async upsertReminderLock(entry): Promise<void> {
      const res = await fetch(`${baseUrl}/rest/v1/reminder_logs?on_conflict=instrument_id,expiry_date`, {
        method: 'POST',
        headers: {
          ...serviceHeaders,
          Prefer: 'resolution=merge-duplicates,return=minimal'
        },
        body: JSON.stringify({
          instrument_id: entry.instrument_id,
          expiry_date: entry.expiry_date,
          reminder_type: entry.reminder_type,
          status: 'pending',
          attempt_count: entry.attempt_count,
          locked_until: entry.locked_until,
          last_attempt_at: new Date().toISOString()
        })
      });
      if (!res.ok) {
        throw new Error(`Failed to acquire reminder lock (${res.status})`);
      }
    },

    async recordReminderOutcome(entry): Promise<void> {
      const url = `${baseUrl}/rest/v1/reminder_logs?instrument_id=eq.${encodeURIComponent(
        entry.instrument_id
      )}&expiry_date=eq.${encodeURIComponent(entry.expiry_date)}`;
      const res = await fetch(url, {
        method: 'PATCH',
        headers: { ...serviceHeaders, Prefer: 'return=minimal' },
        body: JSON.stringify({
          status: entry.status,
          sent_at: entry.sent_at,
          locked_until: null,
          error_summary: entry.error_summary
        })
      });
      if (!res.ok) {
        throw new Error(`Failed to record reminder outcome (${res.status})`);
      }
    }
  };
}
