import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { formatDateShortNumeric, getBangkokTodayIso } from '../lib/dateRules';
import { generateQrDataUrl } from '../lib/qrGenerator';
import { buildInstrumentQrUrl, getConfiguredPublicBaseUrl } from '../lib/qrUrl';
import type { Instrument } from '../types/instrument';
import { PrinterIcon } from './Icons';
import { Modal } from './Modal';

interface QrPrintSheetModalProps {
  open: boolean;
  instruments: Instrument[];
  onClose: () => void;
}

interface GeneratedTile {
  id: string;
  code: string;
  name: string;
  location: string | null;
  dataUrl: string;
}

export function QrPrintSheetModal({ open, instruments, onClose }: QrPrintSheetModalProps) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [tiles, setTiles] = useState<GeneratedTile[]>([]);
  const [generating, setGenerating] = useState(false);

  const orderedInstruments = useMemo(
    () =>
      [...instruments].sort((a, b) => {
        if (a.sort_order !== b.sort_order) return a.sort_order - b.sort_order;
        return a.instrument_code.localeCompare(b.instrument_code);
      }),
    [instruments]
  );

  // Default to selecting all instruments when opened
  useEffect(() => {
    if (open) {
      setSelectedIds(new Set(orderedInstruments.map((i) => i.id)));
    }
  }, [open, orderedInstruments]);

  const selectedItems = useMemo(
    () => orderedInstruments.filter((inst) => selectedIds.has(inst.id)),
    [orderedInstruments, selectedIds]
  );

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setGenerating(true);

    async function renderAll() {
      const baseUrl = getConfiguredPublicBaseUrl();
      const out: GeneratedTile[] = [];
      for (const inst of selectedItems) {
        if (cancelled) return;
        const url = buildInstrumentQrUrl(inst.public_token, baseUrl);
        const dataUrl = await generateQrDataUrl(url, 260);
        out.push({
          id: inst.id,
          code: inst.instrument_code,
          name: inst.name,
          location: inst.location,
          dataUrl
        });
      }
      if (!cancelled) {
        setTiles(out);
        setGenerating(false);
      }
    }

    renderAll();
    return () => {
      cancelled = true;
    };
  }, [open, selectedItems]);

  const toggleItem = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const todayDisplay = formatDateShortNumeric(getBangkokTodayIso());
  const baseUrlDisplay = getConfiguredPublicBaseUrl();

  return (
    <>
      <Modal
        open={open}
        title={`พิมพ์ฉลาก QR รวมบนกระดาษ A4 (${selectedItems.length} รายการ)`}
        onClose={onClose}
        wide
        footer={
          <>
            <button type="button" className="btn btn--secondary" onClick={onClose}>
              ปิดหน้าต่าง
            </button>
            <button
              type="button"
              className="btn btn--primary"
              disabled={generating || tiles.length === 0}
              onClick={() => window.print()}
            >
              <PrinterIcon size={18} />
              พิมพ์แผ่น A4 ({tiles.length} ฉลาก)
            </button>
          </>
        }
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div className="alert alert--info">
            <div>
              <strong>คำแนะนำก่อนพิมพ์ฉลากจริง:</strong> ตั้งค่าหน้ากระดาษเป็น{' '}
              <strong>A4 แนวตั้ง</strong> และกำหนดมาตราส่วนเป็น <strong>100% (Actual Size)</strong>{' '}
              ไม่ย่อหน้าอัตโนมัติ เพื่อให้กรอบเส้นประตัดตรงขนาด
              <div className="field-hint mono" style={{ marginTop: '4px' }}>
                ลิงก์ปลายทางใน QR: {baseUrlDisplay}/?instrument=…
              </div>
            </div>
          </div>

          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: '8px',
              alignItems: 'center',
              justifyContent: 'space-between'
            }}
          >
            <span className="field-label">เลือกรายการที่ต้องการพิมพ์ ({selectedItems.length}/{orderedInstruments.length})</span>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                type="button"
                className="btn btn--secondary btn--sm"
                onClick={() => setSelectedIds(new Set(orderedInstruments.map((i) => i.id)))}
              >
                เลือกทั้งหมด
              </button>
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                onClick={() => setSelectedIds(new Set())}
              >
                ล้างการเลือก
              </button>
            </div>
          </div>

          <div
            style={{
              maxHeight: '150px',
              overflowY: 'auto',
              border: '1px solid var(--border-default)',
              borderRadius: 'var(--radius-sm)',
              padding: '8px 10px',
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(210px, 1fr))',
              gap: '6px'
            }}
          >
            {orderedInstruments.map((inst) => (
              <label
                key={inst.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  fontSize: '0.84rem',
                  cursor: 'pointer'
                }}
              >
                <input
                  type="checkbox"
                  checked={selectedIds.has(inst.id)}
                  onChange={() => toggleItem(inst.id)}
                />
                <span className="mono" translate="no" style={{ fontWeight: 600 }}>
                  {inst.instrument_code}
                </span>
                <span
                  style={{
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap'
                  }}
                >
                  {inst.name}
                </span>
              </label>
            ))}
          </div>

          {generating ? (
            <div className="state-panel">
              <div className="spinner" aria-hidden="true" />
              <span>กำลังสร้างภาพ QR สำหรับหน้าพิมพ์ A4…</span>
            </div>
          ) : tiles.length === 0 ? (
            <div className="state-panel">
              <span>กรุณาเลือกเครื่องมืออย่างน้อย 1 รายการเพื่อสร้างแผ่นพิมพ์ QR</span>
            </div>
          ) : (
            <div className="qr-sheet-preview">
              {tiles.map((tile) => (
                <div key={tile.id} className="qr-label-tile">
                  <img
                    className="qr-label-img"
                    src={tile.dataUrl}
                    alt={`QR ${tile.code}`}
                    width={112}
                    height={112}
                  />
                  <div className="qr-label-code" translate="no">
                    {tile.code}
                  </div>
                  <div className="qr-label-name">{tile.name}</div>
                  {tile.location ? <div className="qr-label-loc">{tile.location}</div> : null}
                </div>
              ))}
            </div>
          )}
        </div>
      </Modal>

      {/* Dedicated A4 Print Container rendered at body level */}
      {open && tiles.length > 0
        ? createPortal(
            <div className="print-only-sheet" aria-hidden="true">
              <div className="print-sheet-header">
                <strong>บริษัท เอส เมททอล เทค จำกัด — ฉลาก QR ทะเบียนเครื่องมือวัด (RG-PD-001)</strong>
                <span className="mono">
                  พิมพ์วันที่ {todayDisplay} • จำนวน {tiles.length} ฉลาก
                </span>
              </div>
              <div className="print-sheet-grid">
                {tiles.map((tile) => (
                  <div key={tile.id} className="qr-label-tile">
                    <img
                      className="qr-label-img"
                      src={tile.dataUrl}
                      alt=""
                      width={113}
                      height={113}
                    />
                    <div className="qr-label-code">{tile.code}</div>
                    <div className="qr-label-name">{tile.name}</div>
                    {tile.location ? <div className="qr-label-loc">{tile.location}</div> : null}
                  </div>
                ))}
              </div>
            </div>,
            document.body
          )
        : null}
    </>
  );
}
