import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from 'react';
import {
  validateImageFileClient,
  validateInstrumentForm,
  type ValidationErrors
} from '../lib/validation';
import type { Instrument, InstrumentFormValues } from '../types/instrument';
import { AlertTriangleIcon } from './Icons';
import { InstrumentPlaceholder } from './InstrumentPlaceholder';
import { Modal } from './Modal';

const CUSTOM_LOCATION_VALUE = '__CUSTOM__';

interface InstrumentFormModalProps {
  open: boolean;
  mode: 'create' | 'edit';
  initialInstrument: Instrument | null;
  currentImageUrl?: string | null;
  locationSuggestions: string[];
  vendorSuggestions: string[];
  onClose: () => void;
  onSubmit: (values: InstrumentFormValues, selectedPhoto: File | null) => Promise<void>;
}

function toInitialValues(inst: Instrument | null): InstrumentFormValues {
  if (!inst) {
    return {
      name: '',
      size: '',
      location: '',
      status_text: 'available',
      compare_date: '',
      calibration_date: '',
      expiry_date: '',
      vendor: ''
    };
  }
  return {
    name: inst.name ?? '',
    size: inst.size ?? '',
    location: inst.location ?? '',
    status_text: inst.status_text ?? 'available',
    compare_date: inst.compare_date ?? '',
    calibration_date: inst.calibration_date ?? '',
    expiry_date: inst.expiry_date ?? '',
    vendor: inst.vendor ?? ''
  };
}

export function InstrumentFormModal({
  open,
  mode,
  initialInstrument,
  currentImageUrl,
  locationSuggestions,
  vendorSuggestions,
  onClose,
  onSubmit
}: InstrumentFormModalProps) {
  const formId = useId();
  const vendorListId = useId();
  const customLocationInputRef = useRef<HTMLInputElement | null>(null);

  const initialSnapshot = useMemo(() => toInitialValues(initialInstrument), [initialInstrument]);
  const [values, setValues] = useState<InstrumentFormValues>(initialSnapshot);
  const [isCustomLocation, setIsCustomLocation] = useState(false);
  const [errors, setErrors] = useState<ValidationErrors>({});
  const [selectedPhoto, setSelectedPhoto] = useState<File | null>(null);
  const [photoPreviewUrl, setPhotoPreviewUrl] = useState<string | null>(null);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [discardConfirmOpen, setDiscardConfirmOpen] = useState(false);

  const locationChoices = useMemo(() => {
    const set = new Set<string>(locationSuggestions);
    const currentInitial = initialInstrument?.location?.trim();
    if (currentInitial) {
      set.add(currentInitial);
    }
    return [...set].sort((a, b) => a.localeCompare(b, 'th'));
  }, [locationSuggestions, initialInstrument]);

  useEffect(() => {
    if (open) {
      setValues(toInitialValues(initialInstrument));
      setIsCustomLocation(false);
      setErrors({});
      setSelectedPhoto(null);
      setPhotoError(null);
      setSubmitError(null);
      setSaving(false);
      setDiscardConfirmOpen(false);
    }
  }, [open, initialInstrument]);

  useEffect(() => {
    if (!selectedPhoto) {
      setPhotoPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(selectedPhoto);
    setPhotoPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [selectedPhoto]);

  const isDirty = useMemo(() => {
    if (selectedPhoto) return true;
    return (Object.keys(initialSnapshot) as Array<keyof InstrumentFormValues>).some(
      (key) => values[key] !== initialSnapshot[key]
    );
  }, [values, initialSnapshot, selectedPhoto]);

  // Browser tab close warning when editing with unsaved changes
  useEffect(() => {
    if (!open || !isDirty) return;
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [open, isDirty]);

  const handleRequestClose = () => {
    if (saving || discardConfirmOpen) return;
    if (isDirty) {
      setDiscardConfirmOpen(true);
      return;
    }
    onClose();
  };

  const handleFieldChange = (field: keyof InstrumentFormValues, value: string) => {
    setValues((prev) => ({ ...prev, [field]: value }));
    if (errors[field as keyof ValidationErrors]) {
      setErrors((prev) => ({ ...prev, [field]: undefined }));
    }
  };

  const handleFileChange = (fileList: FileList | null) => {
    setPhotoError(null);
    const file = fileList?.[0] ?? null;
    if (!file) {
      setSelectedPhoto(null);
      return;
    }
    const validationMsg = validateImageFileClient(file);
    if (validationMsg) {
      setPhotoError(validationMsg);
      setSelectedPhoto(null);
      return;
    }
    setSelectedPhoto(file);
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitError(null);

    const validationErrors = validateInstrumentForm(values);
    setErrors(validationErrors);
    const firstErrKey = Object.keys(validationErrors)[0];
    if (firstErrKey) {
      const el = document.getElementById(`${formId}-${firstErrKey}`);
      el?.focus();
      return;
    }

    setSaving(true);
    try {
      await onSubmit(values, selectedPhoto);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'บันทึกข้อมูลไม่สำเร็จ กรุณาลองใหม่');
      setSaving(false);
    }
  };

  const previewSrc = photoPreviewUrl ?? currentImageUrl ?? null;

  return (
    <>
      <Modal
        open={open}
        title={
          mode === 'create'
            ? 'เพิ่มเครื่องมือวัดใหม่'
            : `แก้ไขเครื่องมือวัด ${initialInstrument?.instrument_code ?? ''}`
        }
        onClose={handleRequestClose}
      footer={
        <>
          <button
            type="button"
            className="btn btn--secondary"
            onClick={handleRequestClose}
            disabled={saving}
          >
            ยกเลิก
          </button>
          <button type="submit" form={formId} className="btn btn--primary" disabled={saving}>
            {saving
              ? 'กำลังบันทึก…'
              : mode === 'create'
                ? 'บันทึกเครื่องมือใหม่'
                : 'บันทึกการแก้ไข'}
          </button>
        </>
      }
    >
      <form id={formId} onSubmit={handleSubmit} noValidate>
        <div className="form-grid">
          {submitError ? (
            <div className="field field--full">
              <div className="alert alert--error" role="alert">
                <span>{submitError}</span>
              </div>
            </div>
          ) : null}

          <div className="field field--full">
            <label className="field-label" htmlFor={`${formId}-name`}>
              ชื่อเครื่องมือวัด
              <span className="field-required" aria-hidden="true">
                *
              </span>
            </label>
            <input
              id={`${formId}-name`}
              name="name"
              type="text"
              className={`input ${errors.name ? 'input--error' : ''}`}
              value={values.name}
              onChange={(e) => handleFieldChange('name', e.target.value)}
              placeholder="เช่น Vernier Caliper No. 037…"
              autoComplete="off"
              required
              aria-invalid={Boolean(errors.name)}
            />
            {errors.name ? <span className="field-error">{errors.name}</span> : null}
          </div>

          <div className="field">
            <label className="field-label" htmlFor={`${formId}-size`}>
              ขนาด (Size)
            </label>
            <input
              id={`${formId}-size`}
              name="size"
              type="text"
              className="input"
              value={values.size}
              onChange={(e) => handleFieldChange('size', e.target.value)}
              placeholder="เช่น 0-150 mm., M10X1.25…"
              autoComplete="off"
            />
          </div>

          <div className="field">
            <label className="field-label" htmlFor={`${formId}-location`}>
              สถานที่ใช้งาน / หน่วยงาน
            </label>
            <select
              id={`${formId}-location`}
              name="location"
              className="select"
              value={isCustomLocation ? CUSTOM_LOCATION_VALUE : values.location}
              onChange={(e) => {
                const next = e.target.value;
                if (next === CUSTOM_LOCATION_VALUE) {
                  setIsCustomLocation(true);
                  handleFieldChange('location', '');
                  window.requestAnimationFrame(() => {
                    customLocationInputRef.current?.focus();
                  });
                } else {
                  setIsCustomLocation(false);
                  handleFieldChange('location', next);
                }
              }}
            >
              <option value="">-- เลือกสถานที่ใช้งาน / หน่วยงาน --</option>
              {locationChoices.map((loc) => (
                <option key={loc} value={loc}>
                  {loc}
                </option>
              ))}
              <option value={CUSTOM_LOCATION_VALUE}>+ ระบุสถานที่ / หน่วยงานใหม่…</option>
            </select>
            {isCustomLocation ? (
              <input
                ref={customLocationInputRef}
                id={`${formId}-location-custom`}
                name="location_custom"
                type="text"
                className="input"
                style={{ marginTop: '6px' }}
                value={values.location}
                onChange={(e) => handleFieldChange('location', e.target.value)}
                placeholder="พิมพ์ชื่อสถานที่ใช้งาน / หน่วยงานใหม่…"
                aria-label="ระบุสถานที่ใช้งานหรือหน่วยงานใหม่"
                autoComplete="off"
              />
            ) : null}
            <span className="field-hint">ตอน Export Excel จะแสดงในคอลัมน์ User</span>
          </div>

          <div className="field">
            <label className="field-label" htmlFor={`${formId}-status_text`}>
              สถานะในทะเบียน (Status)
            </label>
            <input
              id={`${formId}-status_text`}
              name="status_text"
              type="text"
              className={`input ${errors.status_text ? 'input--error' : ''}`}
              value={values.status_text}
              onChange={(e) => handleFieldChange('status_text', e.target.value)}
              placeholder="available…"
              autoComplete="off"
              spellCheck={false}
            />
            {errors.status_text ? <span className="field-error">{errors.status_text}</span> : null}
          </div>

          <div className="field">
            <label className="field-label" htmlFor={`${formId}-vendor`}>
              Vendor (ผู้ให้บริการสอบเทียบ)
            </label>
            <input
              id={`${formId}-vendor`}
              name="vendor"
              type="text"
              list={vendorListId}
              className="input"
              value={values.vendor}
              onChange={(e) => handleFieldChange('vendor', e.target.value)}
              placeholder="เช่น Isocal, JSR, Protool หรือเว้นว่าง…"
              autoComplete="off"
            />
            <datalist id={vendorListId}>
              {vendorSuggestions.map((v) => (
                <option key={v} value={v} />
              ))}
            </datalist>
          </div>

          <div className="field">
            <label className="field-label" htmlFor={`${formId}-compare_date`}>
              วันที่ Compare Block / Ring Gauge
            </label>
            <input
              id={`${formId}-compare_date`}
              name="compare_date"
              type="date"
              className={`input tabular-nums ${errors.compare_date ? 'input--error' : ''}`}
              value={values.compare_date}
              onChange={(e) => handleFieldChange('compare_date', e.target.value)}
            />
            {errors.compare_date ? (
              <span className="field-error">{errors.compare_date}</span>
            ) : null}
          </div>

          <div className="field">
            <label className="field-label" htmlFor={`${formId}-calibration_date`}>
              วันที่ Calibration
            </label>
            <input
              id={`${formId}-calibration_date`}
              name="calibration_date"
              type="date"
              className={`input tabular-nums ${errors.calibration_date ? 'input--error' : ''}`}
              value={values.calibration_date}
              onChange={(e) => handleFieldChange('calibration_date', e.target.value)}
            />
            {errors.calibration_date ? (
              <span className="field-error">{errors.calibration_date}</span>
            ) : null}
          </div>

          <div className="field field--full">
            <label className="field-label" htmlFor={`${formId}-expiry_date`}>
              วันหมดอายุ (EXPIRED)
            </label>
            <input
              id={`${formId}-expiry_date`}
              name="expiry_date"
              type="date"
              className={`input tabular-nums ${errors.expiry_date ? 'input--error' : ''}`}
              value={values.expiry_date}
              onChange={(e) => handleFieldChange('expiry_date', e.target.value)}
            />
            {errors.expiry_date ? (
              <span className="field-error">{errors.expiry_date}</span>
            ) : (
              <span className="field-hint">
                หากเว้นว่าง ระบบจะแสดงเป็น “ยังไม่กำหนด” และไม่เข้าเงื่อนไขแจ้งเตือนอีเมล;
                การแก้ไขวันที่จะถูกเก็บประวัติค่าก่อนและหลังโดยอัตโนมัติ
              </span>
            )}
          </div>

          <div className="field field--full">
            <label className="field-label" htmlFor={`${formId}-photo`}>
              รูปภาพเครื่องมือวัด (ไม่บังคับ)
            </label>
            <div className="photo-upload-box">
              <div className="photo-preview-thumb">
                {previewSrc ? (
                  <img
                    src={previewSrc}
                    alt="ตัวอย่างรูปเครื่องมือวัด"
                    width={96}
                    height={72}
                  />
                ) : (
                  <InstrumentPlaceholder
                    name={values.name || 'เครื่องมือวัด'}
                    code={initialInstrument?.instrument_code ?? 'NEW'}
                  />
                )}
              </div>
              <div style={{ flex: '1 1 200px', minWidth: 0 }}>
                <input
                  id={`${formId}-photo`}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  onChange={(e) => handleFileChange(e.target.files)}
                  style={{ width: '100%', fontSize: '0.86rem' }}
                />
                <p className="field-hint" style={{ marginTop: '6px' }}>
                  รองรับ JPG, PNG, WebP ไม่เกิน 5&nbsp;MB (ระบบย่อขนาดให้อัตโนมัติหากภาพใหญ่)
                  {initialInstrument?.image_key
                    ? ' • การอัปโหลดรูปใหม่จะใช้รูปใหม่เป็นรูปหลักโดยคงไฟล์เก่าไว้ในระบบ'
                    : ''}
                </p>
                {photoError ? (
                  <p className="field-error" style={{ marginTop: '4px' }}>
                    {photoError}
                  </p>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      </form>
      </Modal>

      <Modal
        open={discardConfirmOpen}
        title="ยืนยันการปิดหน้าต่าง"
        onClose={() => setDiscardConfirmOpen(false)}
        footer={
          <>
            <button
              type="button"
              className="btn btn--secondary"
              onClick={() => setDiscardConfirmOpen(false)}
            >
              ยกเลิก
            </button>
            <button
              type="button"
              className="btn btn--danger"
              onClick={() => {
                setDiscardConfirmOpen(false);
                onClose();
              }}
            >
              ปิดโดยไม่บันทึก
            </button>
          </>
        }
      >
        <div className="dialog-feedback">
          <div className="dialog-icon dialog-icon--warning" aria-hidden="true">
            <AlertTriangleIcon size={26} />
          </div>
          <div className="dialog-heading">มีข้อมูลที่ยังไม่ได้บันทึก</div>
          <p className="dialog-desc">
            ต้องการปิดหน้าต่างนี้และยกเลิกข้อมูลที่เพิ่งแก้ไขใช่หรือไม่?
          </p>
        </div>
      </Modal>
    </>
  );
}
