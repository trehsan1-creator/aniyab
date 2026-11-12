'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Camera, CameraOff, Loader2, QrCode, Sparkles } from 'lucide-react';

/**
 * ScannerCard — Flow D entry point.
 *
 *  Real path:  getUserMedia → BarcodeDetector (Chrome/Android) → jsQR fallback.
 *  Demo path:  «شبیه‌سازی اسکن» — always available, never fails on stage.
 *
 *  Permission is requested on an explicit tap (not on mount), which is both a
 *  privacy requirement and what iOS Safari expects.
 */

export function ScannerCard({
  onDetected,
  onSimulate,
}: {
  onDetected: (payload: { kind: 'qr' | 'serial'; value: string }) => void;
  onSimulate: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);

  const [state, setState] = useState<'idle' | 'starting' | 'scanning' | 'error'>('idle');
  const [errorFa, setErrorFa] = useState<string | null>(null);

  const stop = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setState('idle');
  }, []);

  useEffect(() => stop, [stop]);

  async function start() {
    setErrorFa(null);
    setState('starting');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
        audio: false,
      });
      streamRef.current = stream;
      const video = videoRef.current;
      if (!video) throw new Error('no video element');
      video.srcObject = stream;
      await video.play();
      setState('scanning');
      void loop();
    } catch {
      setState('error');
      setErrorFa('دسترسی به دوربین ممکن نشد. از دکمهٔ «شبیه‌سازی اسکن» استفاده کنید.');
    }
  }

  async function loop() {
    const video = videoRef.current;
    if (!video) return;

    type DetectorCtor = new (opts: { formats: string[] }) => {
      detect: (source: CanvasImageSource) => Promise<Array<{ rawValue?: string }>>;
    };
    const Detector = (window as unknown as { BarcodeDetector?: DetectorCtor }).BarcodeDetector;
    const detector = Detector ? new Detector({ formats: ['qr_code'] }) : null;

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    let jsQR: ((data: Uint8ClampedArray, w: number, h: number) => { data: string } | null) | null = null;

    const tick = async () => {
      if (state !== 'scanning' && !streamRef.current) return;
      if (video.readyState === video.HAVE_ENOUGH_DATA) {
        try {
          if (detector) {
            const codes = await detector.detect(video);
            const value = codes[0]?.rawValue;
            if (value) {
              stop();
              onDetected({ kind: 'qr', value });
              return;
            }
          } else {
            if (!jsQR) {
              const mod = (await import('jsqr')).default;
              jsQR = mod as unknown as typeof jsQR;
            }
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
            ctx?.drawImage(video, 0, 0, canvas.width, canvas.height);
            const image = ctx?.getImageData(0, 0, canvas.width, canvas.height);
            if (image && jsQR) {
              const found = jsQR(image.data, image.width, image.height);
              if (found?.data) {
                stop();
                onDetected({ kind: 'qr', value: found.data });
                return;
              }
            }
          }
        } catch {
          /* a frame can fail for many benign reasons — keep scanning */
        }
      }
      rafRef.current = requestAnimationFrame(() => void tick());
    };

    void tick();
  }

  return (
    <div className="rounded-2xl border border-white/10 bg-deep-900/60 p-3">
      <div className="mb-2 flex items-center gap-1.5">
        <QrCode className="size-3.5 text-signal" aria-hidden />
        <p className="text-[11.5px] font-semibold text-white">اسکن برچسب</p>
      </div>

      <div className="relative mb-2 aspect-[4/3] overflow-hidden rounded-xl border border-white/10 bg-midnight-900">
        <video
          ref={videoRef}
          playsInline
          muted
          className={`size-full object-cover ${state === 'scanning' ? 'opacity-100' : 'opacity-0'}`}
        />
        {state !== 'scanning' ? (
          <div className="absolute inset-0 grid place-items-center p-3 text-center">
            <div>
              <QrCode className="mx-auto mb-1.5 size-7 text-slate-600" aria-hidden />
              <p className="text-[10.5px] leading-5 text-slate-400">
                {state === 'starting' ? 'در حال روشن کردن دوربین…' : 'دوربین خاموش است'}
              </p>
            </div>
          </div>
        ) : (
          <span className="pointer-events-none absolute inset-6 rounded-lg border-2 border-signal/70" aria-hidden />
        )}
      </div>

      {errorFa ? (
        <p role="alert" className="mb-2 text-[10px] leading-5 text-amber-200">
          {errorFa}
        </p>
      ) : null}

      <div className="flex gap-2">
        {state === 'scanning' ? (
          <button
            type="button"
            onClick={stop}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-white/12 px-3 py-2 text-[11px] text-slate-200"
          >
            <CameraOff className="size-3.5" aria-hidden /> توقف
          </button>
        ) : (
          <button
            type="button"
            onClick={() => void start()}
            disabled={state === 'starting'}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-white/12 bg-white/[0.04] px-3 py-2 text-[11px] text-slate-100 disabled:opacity-50"
          >
            {state === 'starting' ? (
              <Loader2 className="size-3.5 animate-spin" aria-hidden />
            ) : (
              <Camera className="size-3.5" aria-hidden />
            )}
            روشن کردن دوربین
          </button>
        )}

        <button
          type="button"
          onClick={onSimulate}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-gradient-to-l from-[#FF7A00] to-[#f05327] px-3 py-2 text-[11px] font-bold text-white shadow-signal-sm"
        >
          <Sparkles className="size-3.5" aria-hidden /> شبیه‌سازی اسکن
        </button>
      </div>

      <p className="mt-2 text-[9px] leading-4 text-slate-500">
        تصویر دوربین فقط در همین دستگاه پردازش می‌شود و جایی ارسال نمی‌شود.
      </p>
    </div>
  );
}
