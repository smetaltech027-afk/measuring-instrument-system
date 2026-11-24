import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  BellIcon,
  DownloadIcon,
  EditIcon,
  LogoutIcon,
  PlusIcon,
  PrinterIcon,
  QrScanIcon
} from '../components/Icons';
import { InstrumentDetailCard } from '../components/InstrumentDetailCard';
import { InstrumentFormModal } from '../components/InstrumentFormModal';
import { Modal } from '../components/Modal';
import { QrPrintSheetModal } from '../components/QrPrintSheetModal';
import { ExpiryBadge, RegistryStatusTag } from '../components/StatusBadge';
import {
  evaluateExpiryState,
  formatDateShortNumeric,
  formatDateTimeBangkok,
  getBangkokTodayIso
} from '../lib/dateRules';
import { downloadInstrumentQrPng } from '../lib/qrGenerator';
import {
  createInstrument,
  getVerifiedAdminSession,
  listAllInstruments,
  listInstrumentDateHistory,
  listRecentReminderLogs,
  signOutAdmin,
  updateInstrument
} from '../lib/supabase';
import { buildWorkerImageUrl, uploadInstrumentImage } from '../lib/workerApi';
import type {
  ExpiryStateCode,
  Instrument,
  InstrumentDateHistory,
  InstrumentFormValues,
  PublicInstrument,
  ReminderLog
} from '../types/instrument';

interface AdminDashboardPageProps {
  adminEmail: string;
  onSignedOut: () => void;
}

type ExpiryFilterValue = 'all' | 'expired_group' | 'expiring_soon' | 'valid' | 'unset';

function toDetailCardModel(inst: Instrument): PublicInstrument {
  const imageUrl = inst.image_key
    ? buildWorkerImageUrl(inst.public_token, inst.updated_at)
    : null;
  return {
    instrument_code: inst.instrument_code,
    public_token: inst.public_token,
    name: inst.name,
    size: inst.size,
    location: inst.location,
    status_text: inst.status_text,
    compare_date: inst.compare_date,
    calibration_date: inst.calibration_date,
    expiry_date: inst.expiry_date,
    vendor: inst.vendor,
    has_image: Boolean(inst.image_key),
    image_url: imageUrl
  };
}

export function AdminDashboardPage({ adminEmail, onSignedOut }: AdminDashboardPageProps) {
  const [instruments, setInstruments] = useState<Instrument[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);

  // Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [locationFilter, setLocationFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [expiryFilter, setExpiryFilter] = useState<ExpiryFilterValue>('all');

  // Active modals
  const [selectedInstrument, setSelectedInstrument] = useState<Instrument | null>(null);
  const [dateHistory, setDateHistory] = useState<InstrumentDateHistory[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);

  const [formModalState, setFormModalState] = useState<{
    open: boolean;
    mode: 'create' | 'edit';
    instrument: Instrument | null;
  }>({ open: false, mode: 'create', instrument: null });

  const [printSheetOpen, setPrintSheetOpen] = useState(false);
  const [reminderModalOpen, setReminderModalOpen] = useState(false);
  const [reminderLogs, setReminderLogs] = useState<ReminderLog[]>([]);
  const [reminderLoading, setReminderLoading] = useState(false);
  const [reminderError, setReminderError] = useState<string | null>(null);

  const [exportingExcel, setExportingExcel] = useState(false);
  const [downloadingQrId, setDownloadingQrId] = useState<string | null>(null);

  const todayIso = getBangkokTodayIso();

  const fetchInstruments = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const rows = await listAllInstruments();
      setInstruments(rows);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'ไม่สามารถโหลดข้อมูลทะเบียนได้');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchInstruments();
  }, [fetchInstruments]);

  const enriched = useMemo(() => {
    return instruments.map((inst) => ({
      inst,
      expiry: evaluateExpiryState(inst.expiry_date, todayIso)
    }));
  }, [instruments, todayIso]);

  const kpi = useMemo(() => {
    let expired = 0;
    let soon = 0;
    let valid = 0;
    for (const item of enriched) {
      if (item.expiry.code === 'expired' || item.expiry.code === 'expires_today') expired += 1;
      else if (item.expiry.code === 'expiring_soon') soon += 1;
      else if (item.expiry.code === 'valid') valid += 1;
    }
    return { total: enriched.length, expired, soon, valid };
  }, [enriched]);

  const locationOptions = useMemo(() => {
    const set = new Set<string>();
    for (const i of instruments) {
      if (i.location && i.location.trim()) set.add(i.location.trim());
    }
    return [...set].sort((a, b) => a.localeCompare(b, 'th'));
  }, [instruments]);

  const statusOptions = useMemo(() => {
    const set = new Set<string>();
    for (const i of instruments) {
      if (i.status_text && i.status_text.trim()) set.add(i.status_text.trim());
    }
    return [...set].sort((a, b) => a.localeCompare(b, 'en'));
  }, [instruments]);

  const vendorSuggestions = useMemo(() => {
    const set = new Set<string>(['Isocal', 'JSR', 'Protool', '-']);
    for (const i of instruments) {
      if (i.vendor && i.vendor.trim()) set.add(i.vendor.trim());
    }
    return [...set];
  }, [instruments]);

  const filteredRows = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return enriched.filter(({ inst, expiry }) => {
      if (locationFilter !== 'all' && (inst.location ?? '') !== locationFilter) return false;
      if (statusFilter !== 'all' && inst.status_text !== statusFilter) return false;
      if (expiryFilter !== 'all') {
        const code: ExpiryStateCode = expiry.code;
        if (expiryFilter === 'expired_group' && code !== 'expired' && code !== 'expires_today') {
          return false;
        }
        if (expiryFilter === 'expiring_soon' && code !== 'expiring_soon') return false;
        if (expiryFilter === 'valid' && code !== 'valid') return false;
        if (expiryFilter === 'unset' && code !== 'unset') return false;
      }
      if (q) {
        const haystack = [
          inst.instrument_code,
          inst.name,
          inst.size ?? '',
          inst.location ?? '',
          inst.vendor ?? '',
          inst.status_text
        ]
          .join(' ')
          .toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  }, [enriched, searchQuery, locationFilter, statusFilter, expiryFilter]);

  const openDetailModal = async (inst: Instrument) => {
    setSelectedInstrument(inst);
    setDateHistory([]);
    setHistoryError(null);
    setHistoryLoading(true);
    try {
      const history = await listInstrumentDateHistory(inst.id);
      setDateHistory(history);
    } catch (err) {
      setHistoryError(err instanceof Error ? err.message : 'โหลดประวัติไม่สำเร็จ');
    } finally {
      setHistoryLoading(false);
    }
  };

  const handleOpenReminderLogs = async () => {
    setReminderModalOpen(true);
    setReminderLoading(true);
    setReminderError(null);
    try {
      const logs = await listRecentReminderLogs();
      setReminderLogs(logs);
    } catch (err) {
      setReminderError(err instanceof Error ? err.message : 'โหลดประวัติแจ้งเตือนไม่สำเร็จ');
    } finally {
      setReminderLoading(false);
    }
  };

  const handleFormSubmit = async (values: InstrumentFormValues, selectedPhoto: File | null) => {
    let saved: Instrument;
    if (formModalState.mode === 'create') {
      saved = await createInstrument(values);
    } else if (formModalState.instrument) {
      saved = await updateInstrument(formModalState.instrument.id, values);
    } else {
      throw new Error('ไม่พบข้อมูลเครื่องมือที่จะแก้ไข');
    }

    let photoWarning: string | null = null;
    if (selectedPhoto) {
      try {
        const session = await getVerifiedAdminSession();
        if (!session?.access_token) {
          throw new Error('Session หมดอายุ กรุณาเข้าสู่ระบบใหม่เพื่ออัปโหลดรูป');
        }
        const uploaded = await uploadInstrumentImage(saved.id, selectedPhoto, session.access_token);
        saved = { ...saved, image_key: uploaded.image_key, updated_at: new Date().toISOString() };
      } catch (err) {
        // Keep the saved instrument data intact even if photo upload fails (Plan Section 11)
        photoWarning =
          err instanceof Error
            ? `บันทึกข้อมูลเครื่องมือเรียบร้อยแล้ว แต่อัปโหลดรูปไม่สำเร็จ: ${err.message}`
            : 'บันทึกข้อมูลเครื่องมือเรียบร้อยแล้ว แต่อัปโหลดรูปไม่สำเร็จ';
      }
    }

    await fetchInstruments();
    setFormModalState({ open: false, mode: 'create', instrument: null });

    if (selectedInstrument && selectedInstrument.id === saved.id) {
      openDetailModal(saved);
    }

    if (photoWarning) {
      setNotice({ kind: 'error', text: photoWarning });
    } else {
      setNotice({
        kind: 'success',
        text:
          formModalState.mode === 'create'
            ? `เพิ่มเครื่องมือวัด “${saved.name}” (${saved.instrument_code}) เรียบร้อยแล้วค่ะ`
            : `บันทึกการแก้ไข “${saved.name}” (${saved.instrument_code}) เรียบร้อยแล้วค่ะ`
      });
    }
  };

  const handleExportExcel = async () => {
    setExportingExcel(true);
    setNotice(null);
    try {
      // Always export ALL instruments regardless of active UI filters
      const [{ exportFullRegistryExcel }, allLatest] = await Promise.all([
        import('../lib/excelExport'),
        listAllInstruments()
      ]);
      const filename = await exportFullRegistryExcel(allLatest);
      setNotice({
        kind: 'success',
        text: `ส่งออกไฟล์ Excel ฉบับเต็ม (${allLatest.length} รายการ) ชื่อ ${filename} เรียบร้อยแล้วค่ะ`
      });
    } catch (err) {
      setNotice({
        kind: 'error',
        text: err instanceof Error ? err.message : 'ส่งออกไฟล์ Excel ไม่สำเร็จ'
      });
    } finally {
      setExportingExcel(false);
    }
  };

  const handleDownloadSingleQr = async (inst: Instrument) => {
    setDownloadingQrId(inst.id);
    try {
      const filename = await downloadInstrumentQrPng(inst);
      setNotice({ kind: 'success', text: `ดาวน์โหลดภาพ QR (${filename}) เรียบร้อยแล้วค่ะ` });
    } catch (err) {
      setNotice({
        kind: 'error',
        text: err instanceof Error ? err.message : 'ดาวน์โหลดภาพ QR ไม่สำเร็จ'
      });
    } finally {
      setDownloadingQrId(null);
    }
  };

  const handleSignOut = async () => {
    await signOutAdmin();
    onSignedOut();
  };

  const hasActiveFilters =
    searchQuery.trim() !== '' ||
    locationFilter !== 'all' ||
    statusFilter !== 'all' ||
    expiryFilter !== 'all';

  return (
    <main id="main-content" className="page-main">
      <div className="dashboard-header">
        <div className="dashboard-title-group">
          <h1>ทะเบียนเครื่องมือวัด (Admin)</h1>
          <p className="dashboard-subtitle">
            ผู้ดูแลระบบ: <span className="mono">{adminEmail}</span> • ฟอร์มมาตรฐาน{' '}
            <span translate="no">RG-PD-001</span>
          </p>
        </div>

        <div className="dashboard-actions">
          <button
            type="button"
            className="btn btn--primary"
            onClick={() => setFormModalState({ open: true, mode: 'create', instrument: null })}
          >
            <PlusIcon size={18} />
            เพิ่มเครื่องมือวัด
          </button>
          <button
            type="button"
            className="btn btn--secondary"
            onClick={handleExportExcel}
            disabled={exportingExcel || loading}
          >
            <DownloadIcon size={18} />
            {exportingExcel ? 'กำลังสร้าง Excel…' : 'Export Excel ทั้งหมด'}
          </button>
          <button
            type="button"
            className="btn btn--secondary"
            onClick={() => setPrintSheetOpen(true)}
            disabled={loading || instruments.length === 0}
          >
            <PrinterIcon size={18} />
            พิมพ์ QR รวม A4
          </button>
          <button type="button" className="btn btn--secondary" onClick={handleOpenReminderLogs}>
            <BellIcon size={18} />
            ประวัติอีเมลเตือน
          </button>
          <button type="button" className="btn btn--ghost" onClick={handleSignOut}>
            <LogoutIcon size={18} />
            ออกจากระบบ
          </button>
        </div>
      </div>

      {notice ? (
        <div
          className={`alert ${notice.kind === 'success' ? 'alert--success' : 'alert--error'}`}
          role="status"
          aria-live="polite"
          style={{ marginBottom: '16px' }}
        >
          <span>{notice.text}</span>
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={() => setNotice(null)}
            aria-label="ปิดการแจ้งเตือน"
          >
            ปิด
          </button>
        </div>
      ) : null}

      {/* KPI Summary Strip (live counts from database only) */}
      <section className="kpi-strip" aria-label="สรุปจำนวนเครื่องมือวัด">
        <button
          type="button"
          className={`kpi-card ${expiryFilter === 'all' ? 'kpi-card--active' : ''}`}
          onClick={() => setExpiryFilter('all')}
        >
          <div className="kpi-label">เครื่องมือทั้งหมด</div>
          <div className="kpi-value tabular-nums">{loading ? '—' : kpi.total}</div>
          <div className="kpi-hint">คลิกเพื่อดูทุกรายการ</div>
        </button>

        <button
          type="button"
          className={`kpi-card kpi-card--amber ${
            expiryFilter === 'expiring_soon' ? 'kpi-card--active' : ''
          }`}
          onClick={() => setExpiryFilter('expiring_soon')}
        >
          <div className="kpi-label">ใกล้หมดอายุ (≤ 30 วัน)</div>
          <div className="kpi-value tabular-nums">{loading ? '—' : kpi.soon}</div>
          <div className="kpi-hint">อีเมลเตือนอัตโนมัติที่ 7 วัน</div>
        </button>

        <button
          type="button"
          className={`kpi-card kpi-card--red ${
            expiryFilter === 'expired_group' ? 'kpi-card--active' : ''
          }`}
          onClick={() => setExpiryFilter('expired_group')}
        >
          <div className="kpi-label">หมดอายุแล้ว / วันนี้</div>
          <div className="kpi-value tabular-nums">{loading ? '—' : kpi.expired}</div>
          <div className="kpi-hint">ต้องตรวจสอบก่อนใช้งาน</div>
        </button>

        <button
          type="button"
          className={`kpi-card kpi-card--green ${
            expiryFilter === 'valid' ? 'kpi-card--active' : ''
          }`}
          onClick={() => setExpiryFilter('valid')}
        >
          <div className="kpi-label">ปกติ (&gt; 30 วัน)</div>
          <div className="kpi-value tabular-nums">{loading ? '—' : kpi.valid}</div>
          <div className="kpi-hint">ยังไม่ใกล้ครบกำหนด</div>
        </button>
      </section>

      {/* Filter Bar */}
      <section className="filter-bar" aria-label="ค้นหาและกรองทะเบียน">
        <div className="field">
          <label className="field-label" htmlFor="dashboard-search">
            ค้นหาเครื่องมือวัด
          </label>
          <input
            id="dashboard-search"
            type="search"
            className="input"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="ค้นหาชื่อ, รหัส MI-001, Size, สถานที่, Vendor…"
            autoComplete="off"
          />
        </div>

        <div className="field">
          <label className="field-label" htmlFor="filter-location">
            สถานที่ใช้งาน / หน่วยงาน
          </label>
          <select
            id="filter-location"
            className="select"
            value={locationFilter}
            onChange={(e) => setLocationFilter(e.target.value)}
          >
            <option value="all">ทุกสถานที่</option>
            {locationOptions.map((loc) => (
              <option key={loc} value={loc}>
                {loc}
              </option>
            ))}
          </select>
        </div>

        <div className="field">
          <label className="field-label" htmlFor="filter-status">
            Status ในทะเบียน
          </label>
          <select
            id="filter-status"
            className="select"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
          >
            <option value="all">ทุก Status</option>
            {statusOptions.map((st) => (
              <option key={st} value={st}>
                {st}
              </option>
            ))}
          </select>
        </div>

        <div className="field">
          <label className="field-label" htmlFor="filter-expiry">
            สถานะวันหมดอายุ
          </label>
          <select
            id="filter-expiry"
            className="select"
            value={expiryFilter}
            onChange={(e) => setExpiryFilter(e.target.value as ExpiryFilterValue)}
          >
            <option value="all">ทั้งหมด</option>
            <option value="expired_group">หมดอายุแล้ว / หมดอายุวันนี้</option>
            <option value="expiring_soon">ใกล้หมดอายุ (≤ 30 วัน)</option>
            <option value="valid">ปกติ (&gt; 30 วัน)</option>
            <option value="unset">ยังไม่กำหนดวันหมดอายุ</option>
          </select>
        </div>

        {hasActiveFilters ? (
          <button
            type="button"
            className="btn btn--ghost"
            onClick={() => {
              setSearchQuery('');
              setLocationFilter('all');
              setStatusFilter('all');
              setExpiryFilter('all');
            }}
          >
            ล้างตัวกรอง
          </button>
        ) : null}
      </section>

      {/* Main Registry Table / Mobile List */}
      <section className="table-surface" aria-live="polite">
        {loading ? (
          <div className="state-panel">
            <div className="spinner" aria-hidden="true" />
            <span>กำลังโหลดทะเบียนเครื่องมือวัด…</span>
          </div>
        ) : loadError ? (
          <div className="state-panel">
            <p>{loadError}</p>
            <button type="button" className="btn btn--primary" onClick={fetchInstruments}>
              ลองโหลดใหม่
            </button>
          </div>
        ) : filteredRows.length === 0 ? (
          <div className="state-panel">
            <p>
              {instruments.length === 0
                ? 'ยังไม่มีข้อมูลเครื่องมือวัดในระบบ กดปุ่ม “เพิ่มเครื่องมือวัด” เพื่อเริ่มต้น'
                : 'ไม่พบเครื่องมือวัดที่ตรงกับเงื่อนไขการค้นหา'}
            </p>
            {hasActiveFilters ? (
              <button
                type="button"
                className="btn btn--secondary btn--sm"
                onClick={() => {
                  setSearchQuery('');
                  setLocationFilter('all');
                  setStatusFilter('all');
                  setExpiryFilter('all');
                }}
              >
                แสดงทุกรายการ
              </button>
            ) : null}
          </div>
        ) : (
          <>
            <div className="table-scroll">
              <table className="registry-table">
                <thead>
                  <tr>
                    <th scope="col">รหัส</th>
                    <th scope="col">เครื่องมือวัด / Size</th>
                    <th scope="col">สถานที่ใช้งาน</th>
                    <th scope="col">Status</th>
                    <th scope="col">Compare / Calibration</th>
                    <th scope="col">วันหมดอายุ</th>
                    <th scope="col">สถานะวันหมดอายุ</th>
                    <th scope="col">จัดการ</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRows.map(({ inst, expiry }) => (
                    <tr key={inst.id}>
                      <td>
                        <span className="code-chip" translate="no">
                          {inst.instrument_code}
                        </span>
                      </td>
                      <td>
                        <button
                          type="button"
                          className="row-title-btn"
                          onClick={() => openDetailModal(inst)}
                        >
                          <span className="row-name">{inst.name}</span>
                          <span className="row-meta tabular-nums">
                            {inst.size ? `Size: ${inst.size}` : 'ไม่ระบุ Size'}
                            {inst.vendor ? ` • Vendor: ${inst.vendor}` : ''}
                          </span>
                        </button>
                      </td>
                      <td>{inst.location ?? '—'}</td>
                      <td>
                        <RegistryStatusTag statusText={inst.status_text} />
                      </td>
                      <td className="tabular-nums">
                        {inst.compare_date ? (
                          <div>
                            <div style={{ fontSize: '0.75rem', color: 'var(--ink-muted)' }}>
                              Compare
                            </div>
                            <span className="mono">{formatDateShortNumeric(inst.compare_date)}</span>
                          </div>
                        ) : null}
                        {inst.calibration_date ? (
                          <div>
                            <div style={{ fontSize: '0.75rem', color: 'var(--ink-muted)' }}>
                              Calibration
                            </div>
                            <span className="mono">
                              {formatDateShortNumeric(inst.calibration_date)}
                            </span>
                          </div>
                        ) : null}
                        {!inst.compare_date && !inst.calibration_date ? 'ยังไม่กำหนด' : null}
                      </td>
                      <td className="mono">{formatDateShortNumeric(inst.expiry_date)}</td>
                      <td>
                        <ExpiryBadge state={expiry} />
                      </td>
                      <td>
                        <div style={{ display: 'flex', gap: '6px' }}>
                          <button
                            type="button"
                            className="btn btn--secondary btn--sm"
                            onClick={() =>
                              setFormModalState({ open: true, mode: 'edit', instrument: inst })
                            }
                            aria-label={`แก้ไข ${inst.name}`}
                          >
                            <EditIcon size={15} />
                            แก้
                          </button>
                          <button
                            type="button"
                            className="btn btn--ghost btn--sm"
                            onClick={() => handleDownloadSingleQr(inst)}
                            disabled={downloadingQrId === inst.id}
                            aria-label={`ดาวน์โหลด QR ของ ${inst.name}`}
                          >
                            <QrScanIcon size={15} />
                            QR
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile Card List */}
            <div className="mobile-list">
              {filteredRows.map(({ inst, expiry }) => (
                <article key={inst.id} className="mobile-row">
                  <div className="mobile-row-top">
                    <button
                      type="button"
                      className="row-title-btn"
                      onClick={() => openDetailModal(inst)}
                    >
                      <span className="code-chip" translate="no" style={{ width: 'fit-content' }}>
                        {inst.instrument_code}
                      </span>
                      <span className="row-name" style={{ marginTop: '4px' }}>
                        {inst.name}
                      </span>
                    </button>
                    <ExpiryBadge state={expiry} />
                  </div>

                  <div className="mobile-row-meta">
                    <div>
                      <span className="spec-label">สถานที่: </span>
                      <span>{inst.location ?? '—'}</span>
                    </div>
                    <div>
                      <span className="spec-label">Status: </span>
                      <span translate="no">{inst.status_text}</span>
                    </div>
                    <div>
                      <span className="spec-label">
                        {inst.calibration_date ? 'Calibration: ' : 'Compare: '}
                      </span>
                      <span className="mono">
                        {formatDateShortNumeric(inst.calibration_date ?? inst.compare_date)}
                      </span>
                    </div>
                    <div>
                      <span className="spec-label">หมดอายุ: </span>
                      <span className="mono">{formatDateShortNumeric(inst.expiry_date)}</span>
                    </div>
                  </div>

                  <div className="mobile-row-actions">
                    <button
                      type="button"
                      className="btn btn--secondary btn--sm"
                      onClick={() => openDetailModal(inst)}
                    >
                      ดูรายละเอียด
                    </button>
                    <button
                      type="button"
                      className="btn btn--secondary btn--sm"
                      onClick={() =>
                        setFormModalState({ open: true, mode: 'edit', instrument: inst })
                      }
                    >
                      <EditIcon size={15} />
                      แก้ไข
                    </button>
                    <button
                      type="button"
                      className="btn btn--ghost btn--sm"
                      onClick={() => handleDownloadSingleQr(inst)}
                      disabled={downloadingQrId === inst.id}
                    >
                      <QrScanIcon size={15} />
                      ดาวน์โหลด QR
                    </button>
                  </div>
                </article>
              ))}
            </div>
          </>
        )}
      </section>

      {/* Detail Modal */}
      <Modal
        open={Boolean(selectedInstrument)}
        title={
          selectedInstrument
            ? `รายละเอียด ${selectedInstrument.instrument_code}`
            : 'รายละเอียดเครื่องมือวัด'
        }
        onClose={() => setSelectedInstrument(null)}
        wide
        footer={
          selectedInstrument ? (
            <>
              <button
                type="button"
                className="btn btn--secondary"
                onClick={() => handleDownloadSingleQr(selectedInstrument)}
                disabled={downloadingQrId === selectedInstrument.id}
              >
                <QrScanIcon size={18} />
                ดาวน์โหลด QR รายเครื่อง
              </button>
              <button
                type="button"
                className="btn btn--primary"
                onClick={() => {
                  const target = selectedInstrument;
                  setFormModalState({ open: true, mode: 'edit', instrument: target });
                }}
              >
                <EditIcon size={18} />
                แก้ไขข้อมูล
              </button>
            </>
          ) : null
        }
      >
        {selectedInstrument ? (
          <InstrumentDetailCard
            instrument={toDetailCardModel(selectedInstrument)}
            dateHistory={dateHistory}
            historyLoading={historyLoading}
            historyError={historyError}
            showAdminMetadata
          />
        ) : null}
      </Modal>

      {/* Create / Edit Form Modal */}
      <InstrumentFormModal
        open={formModalState.open}
        mode={formModalState.mode}
        initialInstrument={formModalState.instrument}
        currentImageUrl={
          formModalState.instrument?.image_key
            ? buildWorkerImageUrl(
                formModalState.instrument.public_token,
                formModalState.instrument.updated_at
              )
            : null
        }
        locationSuggestions={locationOptions}
        vendorSuggestions={vendorSuggestions}
        onClose={() => setFormModalState({ open: false, mode: 'create', instrument: null })}
        onSubmit={handleFormSubmit}
      />

      {/* A4 QR Print Modal */}
      <QrPrintSheetModal
        open={printSheetOpen}
        instruments={instruments}
        onClose={() => setPrintSheetOpen(false)}
      />

      {/* Reminder Delivery Log Modal */}
      <Modal
        open={reminderModalOpen}
        title="ประวัติการแจ้งเตือนอีเมล (GAS Reminder Log)"
        onClose={() => setReminderModalOpen(false)}
        wide
        footer={
          <button
            type="button"
            className="btn btn--secondary"
            onClick={() => setReminderModalOpen(false)}
          >
            ปิดหน้าต่าง
          </button>
        }
      >
        {reminderLoading ? (
          <div className="state-panel">
            <div className="spinner" aria-hidden="true" />
            <span>กำลังโหลดประวัติการส่งอีเมล…</span>
          </div>
        ) : reminderError ? (
          <div className="alert alert--error" role="alert">
            <span>{reminderError}</span>
          </div>
        ) : reminderLogs.length === 0 ? (
          <div className="state-panel">
            <span>ยังไม่มีรายการแจ้งเตือนอีเมลที่ถูกบันทึกในระบบ</span>
          </div>
        ) : (
          <ul className="history-list">
            {reminderLogs.map((log) => {
              const matched = instruments.find((i) => i.id === log.instrument_id);
              return (
                <li key={log.id} className="history-item">
                  <div
                    style={{
                      display: 'flex',
                      flexWrap: 'wrap',
                      justifyContent: 'space-between',
                      gap: '8px',
                      marginBottom: '4px'
                    }}
                  >
                    <strong>
                      {matched ? `${matched.instrument_code} — ${matched.name}` : log.instrument_id}
                    </strong>
                    <span
                      className={`badge ${
                        log.status === 'sent'
                          ? 'badge--valid'
                          : log.status === 'failed'
                            ? 'badge--expired'
                            : 'badge--expiring_soon'
                      }`}
                    >
                      {log.status === 'sent'
                        ? 'ส่งสำเร็จ'
                        : log.status === 'failed'
                          ? 'ส่งไม่สำเร็จ'
                          : 'กำลังดำเนินการ'}
                    </span>
                  </div>
                  <div className="field-hint tabular-nums">
                    วันหมดอายุรอบนี้: {formatDateShortNumeric(log.expiry_date)} • ประเภท:{' '}
                    {log.reminder_type === '7_day' ? 'ครบ 7 วัน' : 'ส่งชดเชย (1–6 วัน)'} • ลองครั้งที่{' '}
                    {log.attempt_count} • ล่าสุด {formatDateTimeBangkok(log.last_attempt_at)}
                  </div>
                  {log.error_summary ? (
                    <div className="field-error" style={{ marginTop: '4px' }}>
                      รายละเอียดข้อผิดพลาด: {log.error_summary}
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </Modal>
    </main>
  );
}
