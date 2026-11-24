import { useCallback, useEffect, useState } from 'react';
import { ArrowLeftIcon, QrScanIcon } from '../components/Icons';
import { InstrumentDetailCard } from '../components/InstrumentDetailCard';
import { QrScannerModal } from '../components/QrScannerModal';
import { fetchPublicInstrumentByToken } from '../lib/workerApi';
import type { PublicInstrument } from '../types/instrument';

interface InstrumentDetailPageProps {
  token: string;
  preloadedInstrument?: PublicInstrument | null;
  onBackHome: () => void;
  onOpenInstrumentByToken: (token: string) => void;
}

export function InstrumentDetailPage({
  token,
  preloadedInstrument = null,
  onBackHome,
  onOpenInstrumentByToken
}: InstrumentDetailPageProps) {
  const [instrument, setInstrument] = useState<PublicInstrument | null>(
    preloadedInstrument && preloadedInstrument.public_token === token ? preloadedInstrument : null
  );
  const [loading, setLoading] = useState(
    !(preloadedInstrument && preloadedInstrument.public_token === token)
  );
  const [error, setError] = useState<{ kind: 'not_found' | 'network'; message: string } | null>(
    null
  );
  const [scannerOpen, setScannerOpen] = useState(false);

  const loadInstrument = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchPublicInstrumentByToken(token);
      setInstrument(data);
    } catch (err) {
      setInstrument(null);
      if (err instanceof Error && err.message === 'NOT_FOUND') {
        setError({
          kind: 'not_found',
          message:
            'ไม่พบข้อมูลเครื่องมือวัดตามลิงก์ QR นี้ ลิงก์อาจไม่ถูกต้องหรือยังไม่ถูกลงทะเบียนในระบบ'
        });
      } else {
        setError({
          kind: 'network',
          message:
            err instanceof Error
              ? err.message
              : 'ไม่สามารถโหลดข้อมูลเครื่องมือวัดได้ กรุณาลองใหม่อีกครั้ง'
        });
      }
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    if (preloadedInstrument && preloadedInstrument.public_token === token) {
      setInstrument(preloadedInstrument);
      setLoading(false);
      setError(null);
      return;
    }
    loadInstrument();
  }, [token, preloadedInstrument, loadInstrument]);

  return (
    <main id="main-content" className="page-main page-main--narrow">
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: '10px',
          marginBottom: '16px'
        }}
      >
        <button type="button" className="btn btn--secondary btn--sm" onClick={onBackHome}>
          <ArrowLeftIcon size={16} />
          กลับหน้าแรก
        </button>
        <button type="button" className="btn btn--primary btn--sm" onClick={() => setScannerOpen(true)}>
          <QrScanIcon size={16} />
          สแกนเครื่องอื่น
        </button>
      </div>

      <section className="card" aria-live="polite">
        {loading ? (
          <div className="state-panel">
            <div className="spinner" aria-hidden="true" />
            <span>กำลังโหลดข้อมูลเครื่องมือวัด…</span>
          </div>
        ) : error ? (
          <div className="state-panel">
            <h1 style={{ fontSize: '1.15rem' }}>
              {error.kind === 'not_found'
                ? 'ไม่พบเครื่องมือวัดตามลิงก์นี้'
                : 'เกิดข้อผิดพลาดในการเชื่อมต่อ'}
            </h1>
            <p style={{ maxWidth: '46ch' }}>{error.message}</p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginTop: '8px' }}>
              {error.kind === 'network' ? (
                <button type="button" className="btn btn--primary" onClick={loadInstrument}>
                  ลองโหลดใหม่
                </button>
              ) : null}
              <button type="button" className="btn btn--secondary" onClick={() => setScannerOpen(true)}>
                <QrScanIcon size={18} />
                สแกน QR ใหม่
              </button>
            </div>
          </div>
        ) : instrument ? (
          <>
            <h1 className="sr-only">รายละเอียดเครื่องมือวัด {instrument.name}</h1>
            <InstrumentDetailCard instrument={instrument} />
          </>
        ) : null}
      </section>

      <QrScannerModal
        open={scannerOpen}
        onClose={() => setScannerOpen(false)}
        onDetectedToken={(nextToken) => {
          setScannerOpen(false);
          onOpenInstrumentByToken(nextToken);
        }}
      />
    </main>
  );
}
