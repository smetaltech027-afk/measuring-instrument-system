import { useState, type FormEvent } from 'react';
import { BellIcon, CaliperIcon, QrScanIcon, SearchIcon, ShieldUserIcon } from '../components/Icons';
import { QrScannerModal } from '../components/QrScannerModal';
import { isWorkerConfigured, lookupPublicInstrumentByCode } from '../lib/workerApi';
import type { PublicInstrument } from '../types/instrument';

interface HomePageProps {
  onOpenInstrumentByToken: (token: string, preloaded?: PublicInstrument) => void;
  onNavigateAdmin: () => void;
}

export function HomePage({ onOpenInstrumentByToken, onNavigateAdmin }: HomePageProps) {
  const [scannerOpen, setScannerOpen] = useState(false);
  const [codeInput, setCodeInput] = useState('');
  const [lookupLoading, setLookupLoading] = useState(false);
  const [lookupError, setLookupError] = useState<string | null>(null);

  const lookupAndOpenCode = async (rawCode: string) => {
    setLookupError(null);
    const trimmed = rawCode.trim();
    if (!trimmed) {
      setLookupError('กรุณากรอกรหัสเครื่องมือ เช่น MI-001');
      return;
    }

    setLookupLoading(true);
    try {
      const instrument = await lookupPublicInstrumentByCode(trimmed);
      onOpenInstrumentByToken(instrument.public_token, instrument);
    } catch (err) {
      if (err instanceof Error && err.message === 'NOT_FOUND') {
        setLookupError(`ไม่พบเครื่องมือวัดรหัส “${trimmed}” กรุณาตรวจสอบรหัสบนฉลากอีกครั้ง`);
      } else {
        setLookupError(
          err instanceof Error ? err.message : 'ไม่สามารถค้นหารหัสเครื่องมือได้ในขณะนี้'
        );
      }
    } finally {
      setLookupLoading(false);
    }
  };

  const handleCodeLookup = async (event: FormEvent) => {
    event.preventDefault();
    await lookupAndOpenCode(codeInput);
  };

  return (
    <main id="main-content" className="page-main">
      <section className="hero-workshop" aria-labelledby="home-title">
        <div className="hero-banner">
          <div className="hero-ruler" aria-hidden="true" />
          <div className="hero-banner-content">
            <div className="hero-eyebrow">
              <CaliperIcon size={16} />
              <span>บริษัท เอส เมททอล เทค จำกัด • เอกสาร RG-PD-001</span>
            </div>
            <h1 id="home-title" className="hero-heading">
              ระบบทะเบียนเครื่องมือวัด
            </h1>
            <p className="hero-desc">
              ตรวจสอบสถานะเครื่องมือวัด วันที่ Compare / Calibration และวันหมดอายุได้ทันที
              โดยสแกน QR Code บนตัวเครื่อง หรือค้นหาด้วยรหัสเครื่องมือ
            </p>
          </div>
        </div>

        <div className="hero-grid">
          <div className="hero-action-panel">
            <div className="hero-primary-action">
              <button
                type="button"
                className="btn btn--primary-lg"
                onClick={() => setScannerOpen(true)}
              >
                <QrScanIcon size={22} />
                สแกน QR เครื่องมือวัด
              </button>
              <button type="button" className="btn btn--secondary" onClick={onNavigateAdmin}>
                <ShieldUserIcon size={18} />
                เข้าสู่ระบบ Admin
              </button>
            </div>
            <p className="field-hint">
              รองรับฉลาก QR แบบสั้น (<span className="mono">MI-001</span>) และลิงก์ QR เต็มของระบบ
            </p>
          </div>

          <div className="lookup-panel" aria-labelledby="lookup-title">
            <div>
              <h2 id="lookup-title">ค้นหาด้วยรหัสเครื่องมือ</h2>
              <p className="lookup-hint" style={{ marginTop: '6px' }}>
                หากกล้องใช้งานไม่ได้ หรือฉลากสแกนไม่ชัด สามารถพิมพ์รหัสที่พิมพ์อยู่ใต้ QR Code
                เพื่อเปิดดูรายละเอียดเครื่องนั้นได้ทันที
              </p>
            </div>

            <form className="lookup-form" onSubmit={handleCodeLookup} noValidate>
              <label htmlFor="manual-code-input" className="sr-only">
                รหัสเครื่องมือวัด
              </label>
              <input
                id="manual-code-input"
                name="instrument_code"
                type="text"
                className={`input mono ${lookupError ? 'input--error' : ''}`}
                value={codeInput}
                onChange={(e) => {
                  setCodeInput(e.target.value);
                  if (lookupError) setLookupError(null);
                }}
                placeholder="เช่น MI-001…"
                autoComplete="off"
                spellCheck={false}
              />
              <button type="submit" className="btn btn--primary" disabled={lookupLoading}>
                <SearchIcon size={18} />
                {lookupLoading ? 'กำลังค้นหา…' : 'ดูข้อมูล'}
              </button>
            </form>

            <div aria-live="polite">
              {lookupError ? (
                <div className="alert alert--error" role="alert">
                  <span>{lookupError}</span>
                </div>
              ) : !isWorkerConfigured ? (
                <p className="field-hint">
                  หมายเหตุ: ตอนนี้ยังไม่ได้เชื่อมต่อ Worker API ปลายทางในไฟล์ <code>.env</code>{' '}
                  ระบบจะพร้อมค้นหาข้อมูลจริงเมื่อเชื่อมหลังบ้านเรียบร้อย
                </p>
              ) : (
                <p className="field-hint">
                  ระบบแสดงข้อมูลเฉพาะเครื่องมือที่ตรงกับรหัสเท่านั้น ไม่เปิดเผยรายการทะเบียนทั้งหมด
                </p>
              )}
            </div>
          </div>
        </div>
      </section>

      <section className="workshop-notes" aria-label="แนวทางการใช้งาน">
        <article className="note-card">
          <div className="note-icon">
            <QrScanIcon size={18} />
          </div>
          <div>
            <h3>สแกนจากกล้องมือถือได้ทันที</h3>
            <p>
              ผู้มีลิงก์ QR เปิดดูข้อมูลรายละเอียดและสถานะวันหมดอายุได้โดยไม่ต้องเข้าสู่ระบบ
              แต่ไม่สามารถแก้ไขข้อมูลได้
            </p>
          </div>
        </article>

        <article className="note-card">
          <div className="note-icon">
            <BellIcon size={18} />
          </div>
          <div>
            <h3>แยกสถานะทะเบียนและวันหมดอายุ</h3>
            <p>
              ป้ายสีอำพันแจ้งเครื่องมือใกล้หมดอายุ และสีแดงแจ้งเครื่องมือหมดอายุชัดเจน
              แยกจากสถานะ Status เดิมในทะเบียน
            </p>
          </div>
        </article>

        <article className="note-card">
          <div className="note-icon">
            <ShieldUserIcon size={18} />
          </div>
          <div>
            <h3>จัดการทะเบียนสำหรับ Admin</h3>
            <p>
              เพิ่มหรือแก้ไขข้อมูล เก็บประวัติการเปลี่ยนวันที่อัตโนมัติ ส่งออก Excel แบบฟอร์ม{' '}
              <span translate="no">RG-PD-001</span> และพิมพ์ฉลาก QR รวม A4
            </p>
          </div>
        </article>
      </section>

      <QrScannerModal
        open={scannerOpen}
        onClose={() => setScannerOpen(false)}
        onDetectedToken={(token) => {
          setScannerOpen(false);
          onOpenInstrumentByToken(token);
        }}
        onDetectedCode={(code) => {
          setScannerOpen(false);
          setCodeInput(code);
          void lookupAndOpenCode(code);
        }}
      />
    </main>
  );
}
