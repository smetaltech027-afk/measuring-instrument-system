import { useCallback, useEffect, useRef, useState } from 'react';
import { BrowserQRCodeReader, type IScannerControls } from '@zxing/browser';
import { parseScannedQrValue } from '../lib/qrUrl';
import { Modal } from './Modal';
import { QrScanIcon } from './Icons';

interface QrScannerModalProps {
  open: boolean;
  onClose: () => void;
  onDetectedToken: (token: string) => void;
  onDetectedCode: (code: string) => void;
}

type ScannerState =
  | { status: 'starting' }
  | { status: 'scanning' }
  | { status: 'error'; message: string; kind: 'permission' | 'no_camera' | 'invalid_qr' | 'other' };

export function QrScannerModal({
  open,
  onClose,
  onDetectedToken,
  onDetectedCode
}: QrScannerModalProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const controlsRef = useRef<IScannerControls | null>(null);
  const detectedOnceRef = useRef(false);
  const [scanState, setScanState] = useState<ScannerState>({ status: 'starting' });
  const [attemptKey, setAttemptKey] = useState(0);

  const stopCamera = useCallback(() => {
    try {
      controlsRef.current?.stop();
    } catch {
      // Ignore cleanup errors
    }
    controlsRef.current = null;

    const video = videoRef.current;
    if (video && video.srcObject instanceof MediaStream) {
      for (const track of video.srcObject.getTracks()) {
        track.stop();
      }
      video.srcObject = null;
    }
  }, []);

  useEffect(() => {
    if (!open) {
      stopCamera();
      return;
    }

    let cancelled = false;
    detectedOnceRef.current = false;
    setScanState({ status: 'starting' });

    async function startScanner() {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        setScanState({
          status: 'error',
          kind: 'no_camera',
          message:
            'เบราว์เซอร์นี้ไม่รองรับการเปิดกล้อง หรือไม่ได้เข้าผ่าน HTTPS กรุณากรอกรหัสเครื่องมือที่หน้าแรกแทนค่ะ'
        });
        return;
      }

      try {
        const reader = new BrowserQRCodeReader(undefined, {
          delayBetweenScanAttempts: 200,
          delayBetweenScanSuccess: 500
        });

        const videoEl = videoRef.current;
        if (!videoEl || cancelled) return;

        // Request rear camera at higher resolution so compact 9x9 mm QR labels resolve sharply
        const controls = await reader.decodeFromConstraints(
          {
            video: {
              facingMode: { ideal: 'environment' },
              width: { ideal: 1280 },
              height: { ideal: 720 }
            }
          },
          videoEl,
          (result) => {
            if (cancelled || detectedOnceRef.current || !result) return;
            const parsed = parseScannedQrValue(result.getText());
            if (parsed.valid) {
              detectedOnceRef.current = true;
              stopCamera();
              if (parsed.kind === 'code') {
                onDetectedCode(parsed.code);
              } else {
                onDetectedToken(parsed.token);
              }
            } else {
              detectedOnceRef.current = true;
              stopCamera();
              setScanState({
                status: 'error',
                kind: 'invalid_qr',
                message:
                  'QR Code นี้ไม่ใช่รหัสของระบบทะเบียนเครื่องมือวัด กรุณาตรวจสอบฉลากแล้วลองสแกนใหม่อีกครั้งค่ะ'
              });
            }
          }
        );

        if (cancelled) {
          controls.stop();
          return;
        }
        controlsRef.current = controls;
        setScanState({ status: 'scanning' });
      } catch (err) {
        if (cancelled) return;
        const name = err instanceof Error ? err.name : '';
        if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
          setScanState({
            status: 'error',
            kind: 'permission',
            message:
              'ไม่ได้รับอนุญาตให้ใช้กล้อง กรุณาอนุญาตสิทธิ์กล้องในแถบที่อยู่เบราว์เซอร์แล้วกดลองใหม่ หรือปิดหน้าต่างนี้เพื่อกรอกรหัสเครื่องมือแทนค่ะ'
          });
        } else if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
          setScanState({
            status: 'error',
            kind: 'no_camera',
            message: 'ไม่พบกล้องในอุปกรณ์นี้ กรุณาใช้ช่องกรอกรหัสเครื่องมือที่หน้าแรกแทนค่ะ'
          });
        } else {
          setScanState({
            status: 'error',
            kind: 'other',
            message: 'ไม่สามารถเปิดกล้องได้ในขณะนี้ กรุณาลองใหม่อีกครั้ง หรือกรอกรหัสเครื่องมือแทนค่ะ'
          });
        }
      }
    }

    startScanner();

    return () => {
      cancelled = true;
      stopCamera();
    };
  }, [open, attemptKey, onDetectedToken, onDetectedCode, stopCamera]);

  return (
    <Modal
      open={open}
      title="สแกน QR เครื่องมือวัด"
      onClose={() => {
        stopCamera();
        onClose();
      }}
      footer={
        <>
          {scanState.status === 'error' ? (
            <button
              type="button"
              className="btn btn--primary"
              onClick={() => setAttemptKey((k) => k + 1)}
            >
              <QrScanIcon size={18} />
              สแกนใหม่อีกครั้ง
            </button>
          ) : null}
          <button
            type="button"
            className="btn btn--secondary"
            onClick={() => {
              stopCamera();
              onClose();
            }}
          >
            ปิดกล้อง
          </button>
        </>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
        <div className="scanner-stage">
          <video
            ref={videoRef}
            className="scanner-video"
            muted
            playsInline
            aria-label="ภาพจากกล้องสำหรับสแกน QR"
          />
          {scanState.status === 'scanning' ? (
            <div className="scanner-reticle" aria-hidden="true" />
          ) : null}
          {scanState.status === 'starting' ? (
            <div
              style={{
                position: 'absolute',
                inset: 0,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '10px',
                color: '#ffffff',
                backgroundColor: 'rgba(14, 31, 43, 0.72)'
              }}
            >
              <div className="spinner" aria-hidden="true" />
              <span>กำลังเปิดกล้องหลัง…</span>
            </div>
          ) : null}
        </div>

        <div aria-live="polite">
          {scanState.status === 'scanning' ? (
            <p className="field-hint" style={{ textAlign: 'center' }}>
              วาง QR Code ที่ติดอยู่บนเครื่องมือวัดให้อยู่ในกรอบ ระบบจะเปิดรายละเอียดให้อัตโนมัติค่ะ
            </p>
          ) : null}

          {scanState.status === 'error' ? (
            <div className="alert alert--error" role="alert">
              <span>{scanState.message}</span>
            </div>
          ) : null}
        </div>
      </div>
    </Modal>
  );
}
