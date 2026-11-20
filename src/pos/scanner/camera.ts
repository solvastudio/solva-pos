export interface CameraBarcodeMatch {
  rawValue: string
  format?: string
}

interface DetectorLike {
  detect: (source: ImageBitmapSource) => Promise<CameraBarcodeMatch[]>
}

type DetectorConstructor = new (opts?: { formats?: string[] }) => DetectorLike

const DEFAULT_FORMATS = [
  'ean_13',
  'ean_8',
  'upc_a',
  'upc_e',
  'code_128',
  'code_39',
  'qr_code',
]

export function isCameraScanSupported(): boolean {
  if (typeof navigator === 'undefined') return false
  return typeof navigator.mediaDevices?.getUserMedia === 'function'
}

async function resolveDetector(formats: string[]): Promise<DetectorLike> {
  const nativeCtor = (globalThis as { BarcodeDetector?: DetectorConstructor }).BarcodeDetector
  if (typeof nativeCtor === 'function') {
    return new nativeCtor({ formats })
  }
  const mod = await import('barcode-detector')
  const PolyfillCtor = mod.BarcodeDetector as unknown as DetectorConstructor
  return new PolyfillCtor({ formats })
}

export interface StartCameraScanOptions {
  video: HTMLVideoElement
  formats?: string[]
  onDetected: (rawValue: string) => void
  onError?: (err: Error) => void
}

export interface CameraScanHandle {
  stop: () => void
}

/**
 * Starts rear camera barcode/QR scanning with lazy `barcode-detector` fallback.
 * Never loaded on POS boot unless the user opens the camera modal.
 */
export async function startCameraScan(
  opts: StartCameraScanOptions,
): Promise<CameraScanHandle> {
  if (!isCameraScanSupported()) {
    throw new Error('CAMERA_UNSUPPORTED')
  }

  let stopped = false
  let rafId = 0
  let stream: MediaStream | null = null

  const stop = () => {
    stopped = true
    if (rafId) {
      cancelAnimationFrame(rafId)
      rafId = 0
    }
    if (stream) {
      for (const track of stream.getTracks()) {
        track.stop()
      }
      stream = null
    }
    opts.video.pause()
    opts.video.srcObject = null
  }

  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment' },
      audio: false,
    })
    if (stopped) {
      stop()
      return { stop }
    }

    opts.video.srcObject = stream
    opts.video.setAttribute('playsinline', 'true')
    await opts.video.play()

    const detector = await resolveDetector(opts.formats ?? DEFAULT_FORMATS)
    let lastDetectAt = 0

    const tick = (now: number) => {
      if (stopped) return
      if (now - lastDetectAt >= 150 && opts.video.readyState >= 2) {
        lastDetectAt = now
        void detector
          .detect(opts.video)
          .then((matches) => {
            if (stopped) return
            const hit = matches.find((m) => m.rawValue && m.rawValue.trim().length > 0)
            if (hit) {
              opts.onDetected(hit.rawValue.trim())
            }
          })
          .catch((err: unknown) => {
            if (!stopped && opts.onError) {
              opts.onError(err instanceof Error ? err : new Error(String(err)))
            }
          })
      }
      rafId = requestAnimationFrame(tick)
    }

    rafId = requestAnimationFrame(tick)
    return { stop }
  } catch (err) {
    stop()
    throw err instanceof Error ? err : new Error(String(err))
  }
}
