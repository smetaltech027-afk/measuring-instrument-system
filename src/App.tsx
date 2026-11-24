import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import { ShieldUserIcon } from './components/Icons';
import { getVerifiedAdminSession } from './lib/supabase';
import { AdminLoginPage } from './pages/AdminLoginPage';
import { HomePage } from './pages/HomePage';
import { InstrumentDetailPage } from './pages/InstrumentDetailPage';
import type { PublicInstrument } from './types/instrument';

const AdminDashboardPage = lazy(() =>
  import('./pages/AdminDashboardPage').then((m) => ({ default: m.AdminDashboardPage }))
);

type AppRoute =
  | { view: 'home' }
  | { view: 'instrument'; token: string }
  | { view: 'admin' };

function parseLocationRoute(): AppRoute {
  const params = new URLSearchParams(window.location.search);
  const token = params.get('instrument')?.trim();
  if (token) {
    return { view: 'instrument', token };
  }
  if (params.get('view') === 'admin') {
    return { view: 'admin' };
  }
  return { view: 'home' };
}

function pushRouteUrl(nextUrl: string): void {
  window.history.pushState({}, '', nextUrl);
}

export function App() {
  const [route, setRoute] = useState<AppRoute>(() => parseLocationRoute());
  const [preloadedInstrument, setPreloadedInstrument] = useState<PublicInstrument | null>(null);
  const [adminSessionEmail, setAdminSessionEmail] = useState<string | null>(null);
  const [checkingSession, setCheckingSession] = useState(false);

  const syncAdminSession = useCallback(async () => {
    setCheckingSession(true);
    try {
      const session = await getVerifiedAdminSession();
      setAdminSessionEmail(session?.user.email ?? null);
    } finally {
      setCheckingSession(false);
    }
  }, []);

  useEffect(() => {
    const handlePopState = () => {
      setRoute(parseLocationRoute());
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  useEffect(() => {
    if (route.view === 'admin') {
      syncAdminSession();
    }
  }, [route.view, syncAdminSession]);

  const navigateHome = useCallback(() => {
    const basePath = import.meta.env.BASE_URL || '/';
    pushRouteUrl(basePath);
    setPreloadedInstrument(null);
    setRoute({ view: 'home' });
  }, []);

  const navigateInstrument = useCallback((token: string, preloaded?: PublicInstrument) => {
    const basePath = import.meta.env.BASE_URL || '/';
    pushRouteUrl(`${basePath}?instrument=${encodeURIComponent(token)}`);
    setPreloadedInstrument(preloaded ?? null);
    setRoute({ view: 'instrument', token });
  }, []);

  const navigateAdmin = useCallback(() => {
    const basePath = import.meta.env.BASE_URL || '/';
    pushRouteUrl(`${basePath}?view=admin`);
    setRoute({ view: 'admin' });
  }, []);

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="topbar-inner">
          <a
            href={import.meta.env.BASE_URL || '/'}
            className="brand-link"
            onClick={(e) => {
              e.preventDefault();
              navigateHome();
            }}
          >
            <span className="brand-mark brand-mark--logo">
              <img
                src={`${import.meta.env.BASE_URL}smt-logo.png`}
                alt="โลโก้บริษัท เอส เมททอล เทค จำกัด"
                width={40}
                height={38}
              />
            </span>
            <span className="brand-text">
              <span className="brand-title">ระบบทะเบียนเครื่องมือวัด</span>
              <span className="brand-subtitle" translate="no">
                S Metal Tech • RG-PD-001
              </span>
            </span>
          </a>

          <nav className="topbar-actions" aria-label="เมนูหลัก">
            {route.view !== 'admin' ? (
              <a
                href={`${import.meta.env.BASE_URL || '/'}?view=admin`}
                className="btn btn--secondary btn--sm"
                onClick={(e) => {
                  e.preventDefault();
                  navigateAdmin();
                }}
              >
                <ShieldUserIcon size={16} />
                Admin
              </a>
            ) : (
              <a
                href={import.meta.env.BASE_URL || '/'}
                className="btn btn--ghost btn--sm"
                onClick={(e) => {
                  e.preventDefault();
                  navigateHome();
                }}
              >
                หน้าสแกน QR
              </a>
            )}
          </nav>
        </div>
      </header>

      {route.view === 'home' ? (
        <HomePage
          onOpenInstrumentByToken={navigateInstrument}
          onNavigateAdmin={navigateAdmin}
        />
      ) : null}

      {route.view === 'instrument' ? (
        <InstrumentDetailPage
          token={route.token}
          preloadedInstrument={preloadedInstrument}
          onBackHome={navigateHome}
          onOpenInstrumentByToken={(tok) => navigateInstrument(tok)}
        />
      ) : null}

      {route.view === 'admin' ? (
        checkingSession ? (
          <main id="main-content" className="page-main">
            <div className="state-panel">
              <div className="spinner" aria-hidden="true" />
              <span>กำลังตรวจสอบสิทธิ์ผู้ดูแลระบบ…</span>
            </div>
          </main>
        ) : adminSessionEmail ? (
          <Suspense
            fallback={
              <main id="main-content" className="page-main">
                <div className="state-panel">
                  <div className="spinner" aria-hidden="true" />
                  <span>กำลังโหลดหน้าจัดการทะเบียน…</span>
                </div>
              </main>
            }
          >
            <AdminDashboardPage
              adminEmail={adminSessionEmail}
              onSignedOut={() => {
                setAdminSessionEmail(null);
                navigateHome();
              }}
            />
          </Suspense>
        ) : (
          <AdminLoginPage onLoginSuccess={syncAdminSession} onBackHome={navigateHome} />
        )
      ) : null}

      <footer className="app-footer">
        บริษัท เอส เมททอล เทค จำกัด • ระบบทะเบียนเครื่องมือวัด (<span translate="no">RG-PD-001</span>)
      </footer>
    </div>
  );
}
