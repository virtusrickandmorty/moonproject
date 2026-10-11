/**
 * Scanning a QR code (the owner's request, Oct 2026: the production board's search finds a job order from its job ticket):
 * - a camera: live on a phone or PC where the browser allows it (https, or the PC the server runs on); elsewhere (a phone
 *   on the shop's Wi-Fi over http) the phone's camera takes a photo of the code, which is read the same way;
 * - a USB or Bluetooth QR scanner: it types the code like a keyboard and presses Enter (useScannerKeys).
 * The code is read in the browser (BarcodeDetector where there is one, else jsQR); nothing is sent anywhere.
 */
import { useEffect, useRef, useState } from 'react';
import jsQR from 'jsqr';
import { Button, Dialog, Notice } from './ui.tsx';

type Detector = { detect(source: CanvasImageSource): Promise<{ rawValue: string }[]> };
const nativeDetector = (): Detector | null => {
  const D = (globalThis as { BarcodeDetector?: new (o: { formats: string[] }) => Detector }).BarcodeDetector;
  try { return D ? new D({ formats: ['qr_code'] }) : null; } catch { return null; }
};

/** Reads a QR code from what a canvas shows, or null. */
async function readCanvas(canvas: HTMLCanvasElement, detector: Detector | null): Promise<string | null> {
  if (detector) {
    try { const found = await detector.detect(canvas); if (found[0]?.rawValue) return found[0].rawValue; } catch { /* fall back to jsQR */ }
  }
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx || canvas.width === 0) return null;
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  return jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' })?.data ?? null;
}

/** Live camera where the browser allows it (a secure page: https or localhost). */
const liveCameraAllowed = () => typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia && (globalThis.isSecureContext ?? false);

/** A "Scan QR" button: opens the camera, and calls onScan with what the code says. */
export function ScanQrButton({ onScan, label = 'Scan QR' }: { onScan: (text: string) => void; label?: string }) {
  const [open, setOpen] = useState(false);
  const photo = useRef<HTMLInputElement>(null);
  const [error, setError] = useState('');
  // Without a live camera, the phone's own camera takes a photo of the code.
  const fromPhoto = async (file: File | undefined) => {
    setError('');
    if (!file) return;
    const bitmap = await createImageBitmap(file).catch(() => null);
    if (!bitmap) return setError('That photo could not be opened. Try again.');
    const canvas = document.createElement('canvas');
    const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
    canvas.width = Math.round(bitmap.width * scale); canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const text = await readCanvas(canvas, nativeDetector());
    if (text) onScan(text); else setError('No QR code was found in the photo. Hold the job ticket flat and closer, then try again.');
  };
  return (
    <>
      <button type="button" aria-label={label} title={label} onClick={() => (liveCameraAllowed() ? setOpen(true) : photo.current?.click())}
        className="flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium text-slate-700 ring-1 ring-slate-300 hover:bg-indigo-50 hover:text-indigo-700">
        <svg viewBox="0 0 24 24" aria-hidden="true" className="size-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3M7 12h10" />
        </svg>
        <span className="max-sm:sr-only">{label}</span>
      </button>
      <input ref={photo} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => { void fromPhoto(e.target.files?.[0]); e.target.value = ''; }} />
      {error && <div className="basis-full"><Notice tone="warning">{error}</Notice></div>}
      {open && <CameraDialog onClose={() => setOpen(false)} onScan={(t) => { setOpen(false); onScan(t); }} onPhoto={() => { setOpen(false); photo.current?.click(); }} />}
    </>
  );
}

function CameraDialog({ onScan, onClose, onPhoto }: { onScan: (text: string) => void; onClose: () => void; onPhoto: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let stream: MediaStream | null = null;
    let stop = false;
    const detector = nativeDetector();
    const canvas = document.createElement('canvas');
    const tick = async () => {
      if (stop) return;
      const v = video.current;
      if (v && v.readyState >= 2 && v.videoWidth) {
        canvas.width = v.videoWidth; canvas.height = v.videoHeight;
        canvas.getContext('2d', { willReadFrequently: true })!.drawImage(v, 0, 0);
        const text = await readCanvas(canvas, detector);
        if (text && !stop) { stop = true; onScan(text); return; }
      }
      setTimeout(() => void tick(), 200);
    };
    navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false }).then((s) => {
      if (stop) { s.getTracks().forEach((t) => t.stop()); return; }
      stream = s;
      if (video.current) { video.current.srcObject = s; void video.current.play(); }
      void tick();
    }, () => setError('The camera could not be opened. Allow the camera for this page, or take a photo of the code instead.'));
    return () => { stop = true; stream?.getTracks().forEach((t) => t.stop()); };
  }, []);
  return (
    <Dialog title="Scan the job ticket's QR code" onClose={onClose}>
      <div className="space-y-3">
        {error ? <Notice tone="warning">{error}</Notice> : (
          <div className="relative overflow-hidden rounded-xl bg-slate-900">
            <video ref={video} playsInline muted className="aspect-[4/3] w-full object-cover" />
            <div aria-hidden="true" className="pointer-events-none absolute inset-[18%] rounded-xl border-2 border-white/80 shadow-[0_0_0_999px_rgba(15,23,42,0.35)]" />
          </div>
        )}
        <p className="text-sm text-slate-600">Hold the QR code inside the square. It is read on its own.</p>
        <div className="flex justify-between gap-2"><Button onClick={onPhoto}>Take a photo instead</Button><Button onClick={onClose}>Close</Button></div>
      </div>
    </Dialog>
  );
}

/**
 * A USB or Bluetooth QR scanner types like a keyboard, fast, then presses Enter. Outside a text box, keys that arrive
 * that fast and end with Enter are taken as a scan (typing by hand is far slower). In a text box the box handles it.
 */
export function useScannerKeys(onScan: (text: string) => void): void {
  const handler = useRef(onScan);
  handler.current = onScan;
  useEffect(() => {
    let buffer = '';
    let last = 0;
    const key = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName))) return;
      const now = performance.now();
      if (now - last > 60) buffer = '';
      last = now;
      if (e.key === 'Enter') {
        if (buffer.length >= 4) { e.preventDefault(); handler.current(buffer); }
        buffer = '';
      } else if (e.key.length === 1) buffer += e.key;
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, []);
}

/** The job order a scanned code names: its id (a job ticket or release slip QR links /docs/jo.job_order/<id>) or its number. */
export function jobOrderFromScan(text: string): { id?: string; number?: string } | null {
  const t = text.trim();
  const link = /\/docs\/jo\.job_order\/([0-9a-f-]{36})/i.exec(t);
  if (link) return { id: link[1]!.toLowerCase() };
  const number = /\bJO-?(\d{1,10})\b/i.exec(t);
  if (number) return { number: `JO-${number[1]!.padStart(6, '0')}` };
  return null;
}
