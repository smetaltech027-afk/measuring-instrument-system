import { useEffect, useState } from 'react';
import {
  evaluateExpiryState,
  formatDateShortNumeric,
  formatDateThai,
  formatDateTimeBangkok,
  getPopulatedInspectionDates
} from '../lib/dateRules';
import type { InstrumentDateHistory, PublicInstrument } from '../types/instrument';
import { InstrumentPlaceholder } from './InstrumentPlaceholder';
import { ExpiryBadge, RegistryStatusTag } from './StatusBadge';

interface InstrumentDetailCardProps {
  instrument: PublicInstrument;
  dateHistory?: InstrumentDateHistory[];
  historyLoading?: boolean;
  historyError?: string | null;
  showAdminMetadata?: boolean;
}

export function InstrumentDetailCard({
  instrument,
  dateHistory,
  historyLoading = false,
  historyError = null,
  showAdminMetadata = false
}: InstrumentDetailCardProps) {
  const [imageFailed, setImageFailed] = useState(false);

  useEffect(() => {
    setImageFailed(false);
  }, [instrument.image_url, instrument.public_token]);

  const expiryState = evaluateExpiryState(instrument.expiry_date);
  const inspectionDates = getPopulatedInspectionDates(instrument);
  const shouldShowImage = Boolean(instrument.image_url && !imageFailed);

  return (
    <div>
      <div className="detail-layout">
        <div className="detail-photo-frame">
          {shouldShowImage ? (
            <img
              src={instrument.image_url!}
              alt={`รูปเครื่องมือวัด ${instrument.name} (${instrument.instrument_code})`}
              width={320}
              height={240}
              onError={() => setImageFailed(true)}
            />
          ) : (
            <InstrumentPlaceholder name={instrument.name} code={instrument.instrument_code} />
          )}
        </div>

        <div style={{ minWidth: 0 }}>
          <div className="detail-header-row">
            <span className="code-chip" translate="no">
              {instrument.instrument_code}
            </span>
            <ExpiryBadge state={expiryState} showDetail />
            <RegistryStatusTag statusText={instrument.status_text} />
          </div>

          <h2 className="detail-name">{instrument.name}</h2>

          <div className="spec-grid">
            <div className="spec-item">
              <div className="spec-label">ขนาด (Size)</div>
              <div className="spec-value tabular-nums">
                {instrument.size && instrument.size.trim() !== '' ? instrument.size : 'ไม่ระบุ'}
              </div>
            </div>

            <div className="spec-item">
              <div className="spec-label">สถานที่ใช้งาน / หน่วยงาน</div>
              <div className="spec-value">
                {instrument.location && instrument.location.trim() !== ''
                  ? instrument.location
                  : 'ไม่ระบุ'}
              </div>
            </div>

            <div className="spec-item">
              <div className="spec-label">สถานะในทะเบียน (Status)</div>
              <div className="spec-value" translate="no">
                {instrument.status_text}
              </div>
              <div className="spec-sub">แยกจากสถานะวันหมดอายุ</div>
            </div>

            <div className="spec-item">
              <div className="spec-label">ผู้ให้บริการสอบเทียบ (Vendor)</div>
              <div className="spec-value">
                {instrument.vendor && instrument.vendor.trim() !== ''
                  ? instrument.vendor
                  : 'ไม่ระบุ'}
              </div>
            </div>

            {inspectionDates.length > 0 ? (
              inspectionDates.map((item) => (
                <div key={item.field} className="spec-item spec-item--highlight">
                  <div className="spec-label">วันที่ {item.label}</div>
                  <div className="spec-value tabular-nums">{formatDateThai(item.value)}</div>
                  <div className="spec-sub mono">{formatDateShortNumeric(item.value)}</div>
                </div>
              ))
            ) : (
              <div className="spec-item">
                <div className="spec-label">วันที่ Compare / Calibration</div>
                <div className="spec-value">ยังไม่กำหนด</div>
              </div>
            )}

            <div className="spec-item spec-item--highlight">
              <div className="spec-label">วันหมดอายุ (EXPIRED)</div>
              <div className="spec-value tabular-nums">
                {formatDateThai(instrument.expiry_date)}
              </div>
              <div className="spec-sub mono">
                {instrument.expiry_date
                  ? `${formatDateShortNumeric(instrument.expiry_date)} • ${expiryState.detailText}`
                  : 'ยังไม่กำหนดวันหมดอายุ'}
              </div>
            </div>
          </div>
        </div>
      </div>

      {showAdminMetadata ? (
        <section className="history-section" aria-label="ประวัติการแก้ไขวันที่">
          <h3>ประวัติการเปลี่ยนวันที่ (Compare / Calibration / Expire)</h3>
          {historyLoading ? (
            <p className="field-hint">กำลังโหลดประวัติการแก้ไข…</p>
          ) : historyError ? (
            <div className="alert alert--error" role="alert">
              <span>{historyError}</span>
            </div>
          ) : !dateHistory || dateHistory.length === 0 ? (
            <p className="field-hint">ยังไม่มีประวัติการเปลี่ยนวันที่สำหรับเครื่องมือนี้</p>
          ) : (
            <ul className="history-list">
              {dateHistory.map((h) => {
                const changes: string[] = [];
                if (h.old_compare_date !== h.new_compare_date) {
                  changes.push(
                    `Compare: ${formatDateShortNumeric(h.old_compare_date)} → ${formatDateShortNumeric(
                      h.new_compare_date
                    )}`
                  );
                }
                if (h.old_calibration_date !== h.new_calibration_date) {
                  changes.push(
                    `Calibration: ${formatDateShortNumeric(
                      h.old_calibration_date
                    )} → ${formatDateShortNumeric(h.new_calibration_date)}`
                  );
                }
                if (h.old_expiry_date !== h.new_expiry_date) {
                  changes.push(
                    `Expire: ${formatDateShortNumeric(h.old_expiry_date)} → ${formatDateShortNumeric(
                      h.new_expiry_date
                    )}`
                  );
                }
                return (
                  <li key={h.id} className="history-item">
                    <div className="history-time tabular-nums">
                      {formatDateTimeBangkok(h.changed_at)}
                    </div>
                    <div className="tabular-nums">{changes.join(' | ') || 'มีการอัปเดตวันที่'}</div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      ) : null}
    </div>
  );
}
