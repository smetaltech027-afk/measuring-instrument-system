import { useState, type FormEvent } from 'react';
import { ArrowLeftIcon, ShieldUserIcon } from '../components/Icons';
import { isSupabaseConfigured, signInAdmin } from '../lib/supabase';

interface AdminLoginPageProps {
  onLoginSuccess: () => void;
  onBackHome: () => void;
}

const DEFAULT_ADMIN_EMAIL =
  import.meta.env.VITE_ADMIN_EMAIL?.trim() || 'smetaltech027@gmail.com';

export function AdminLoginPage({ onLoginSuccess, onBackHome }: AdminLoginPageProps) {
  const [email, setEmail] = useState(DEFAULT_ADMIN_EMAIL);
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);

    if (!email.trim() || !password) {
      setError('กรุณากรอกอีเมลและรหัสผ่านให้ครบถ้วน');
      return;
    }

    setLoading(true);
    try {
      await signInAdmin(email, password);
      onLoginSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'เข้าสู่ระบบไม่สำเร็จ กรุณาลองใหม่');
      setLoading(false);
    }
  };

  return (
    <main id="main-content" className="page-main page-main--auth">
      <div style={{ marginBottom: '16px' }}>
        <button type="button" className="btn btn--ghost btn--sm" onClick={onBackHome}>
          <ArrowLeftIcon size={16} />
          กลับหน้าแรก
        </button>
      </div>

      <section className="card" aria-labelledby="admin-login-title">
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
            marginBottom: '16px'
          }}
        >
          <div className="brand-mark">
            <ShieldUserIcon size={20} />
          </div>
          <div>
            <h1 id="admin-login-title" style={{ fontSize: '1.2rem' }}>
              เข้าสู่ระบบผู้ดูแล (Admin)
            </h1>
            <p className="field-hint">สำหรับจัดการทะเบียนเครื่องมือวัด บริษัท เอส เมททอล เทค จำกัด</p>
          </div>
        </div>

        {!isSupabaseConfigured ? (
          <div className="alert alert--warning" style={{ marginBottom: '16px' }}>
            <span>
              ยังไม่ได้ตั้งค่า <code>VITE_SUPABASE_URL</code> และ{' '}
              <code>VITE_SUPABASE_ANON_KEY</code> ในไฟล์สภาพแวดล้อม ระบบจึงยังไม่สามารถตรวจสอบสิทธิ์เข้าสู่ระบบจริงได้ค่ะ
            </span>
          </div>
        ) : null}

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          {error ? (
            <div className="alert alert--error" role="alert" aria-live="polite">
              <span>{error}</span>
            </div>
          ) : null}

          <div className="field">
            <label className="field-label" htmlFor="admin-email">
              อีเมลผู้ดูแลระบบ
            </label>
            <input
              id="admin-email"
              name="email"
              type="email"
              className="input"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="username"
              spellCheck={false}
              required
            />
          </div>

          <div className="field">
            <label className="field-label" htmlFor="admin-password">
              รหัสผ่าน
            </label>
            <input
              id="admin-password"
              name="password"
              type="password"
              className="input"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="กรอกรหัสผ่านผู้ดูแลระบบ…"
              autoComplete="current-password"
              required
            />
          </div>

          <button
            type="submit"
            className="btn btn--primary"
            disabled={loading || !isSupabaseConfigured}
            style={{ width: '100%', marginTop: '4px' }}
          >
            {loading ? 'กำลังตรวจสอบสิทธิ์…' : 'เข้าสู่ระบบ Admin'}
          </button>

          <p className="field-hint" style={{ textAlign: 'center' }}>
            สิทธิ์ Admin ถูกกำหนดเฉพาะบัญชีที่ได้รับอนุมัติ ไม่เปิดสมัครสมาชิกจากหน้าเว็บ
          </p>
        </form>
      </section>
    </main>
  );
}
