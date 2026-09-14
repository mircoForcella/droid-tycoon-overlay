// Offline OCR income spotter (tesseract.js, eng only).
// Tuned for Fortnite's chunky outlined display font:
//   1. grayscale -> Otsu auto-threshold -> 2x upscale (pure JS, no new runtime deps)
//   2. pass 1 on the binarized image, pass 2 on the raw frame as fallback
//   3. strict `/s` match plus a fallback for common glyph confusions (/ -> l, s -> 5)
// On-demand only. Never runs continuously.
//
// Packaging note: the tesseract worker thread + wasm engine are shipped as
// plain files (see scripts/copy-ocr-assets.js) and referenced by explicit
// paths, because the vite-bundled main process cannot resolve them inside app.asar.

import { app, nativeImage } from 'electron'
import { join } from 'path'
import { fileURLToPath } from 'url'
import { createWorker, Worker } from 'tesseract.js'
import { PNG } from 'pngjs'

export interface IncomeSpot {
  text: string // raw matched text, e.g. "1.44k/s"
  value: number // parsed credits/sec
  rx: number // 0..1 relative frame position (line box center)
  ry: number
}

const here = join(fileURLToPath(import.meta.url), '..')

// Packaged: <resources>/ocr | Dev: <project-root>/ocr-assets
function ocrBase(): string {
  if (app.isPackaged) return join(process.resourcesPath, 'ocr')
  return join(here, '..', '..', 'ocr-assets')
}

let workerPromise: Promise<Worker> | null = null

async function getWorker(): Promise<Worker> {
  if (!workerPromise) {
    workerPromise = (async () => {
      const { appendFileSync } = await import('fs')
      const dbg = (m: string) => {
        try {
          appendFileSync(join(app.getPath('userData'), 'app.log'), `[${new Date().toISOString()}] [ocr-engine] ${m}\n`)
        } catch {}
      }
      const t0 = Date.now()
      const base = ocrBase()
      const tessdata = join(app.getPath('userData'), 'tessdata')
      const fs = await import('fs/promises')
      await fs.mkdir(tessdata, { recursive: true })
      dbg(`init start workerPath=${join(base, 'tesseract.js', 'src', 'worker-script', 'node', 'index.js')}`)
      const worker = await createWorker('eng', undefined, {
        workerPath: join(base, 'tesseract.js', 'src', 'worker-script', 'node', 'index.js'),
        cachePath: tessdata
      } as Parameters<typeof createWorker>[2])
      dbg(`init done in=${Date.now() - t0}ms (includes one-time language download if first run)`)
      return worker
    })()
  }
  return workerPromise
}

// Binarize bright display text away from busy 3D backgrounds:
// luminance -> Otsu threshold -> 2x nearest-neighbor upscale -> PNG.
function binarizeUpscale(src: Buffer, w: number, h: number): Buffer {
  const n = w * h
  const lum = new Uint8Array(n)
  for (let i = 0; i < n; i++) {
    lum[i] = (src[i * 4] * 77 + src[i * 4 + 1] * 150 + src[i * 4 + 2] * 29) >> 8
  }
  const hist = new Array<number>(256).fill(0)
  for (let i = 0; i < n; i++) hist[lum[i]]++
  let sum = 0
  for (let t = 0; t < 256; t++) sum += t * hist[t]
  let sumB = 0
  let wB = 0
  let best = -1
  let thresh = 128
  for (let t = 0; t < 256; t++) {
    wB += hist[t]
    if (wB === 0) continue
    const wF = n - wB
    if (wF === 0) break
    sumB += t * hist[t]
    const mB = sumB / wB
    const mF = (sum - sumB) / wF
    const between = wB * wF * (mB - mF) * (mB - mF)
    if (between > best) {
      best = between
      thresh = t
    }
  }
  const scale = 2
  const W = w * scale
  const H = h * scale
  const png = new PNG({ width: W, height: H })
  for (let y = 0; y < H; y++) {
    const sy = Math.min(h - 1, (y / scale) | 0)
    for (let x = 0; x < W; x++) {
      const sx = Math.min(w - 1, (x / scale) | 0)
      const v = lum[sy * w + sx] > thresh ? 255 : 0
      const o = (y * W + x) * 4
      png.data[o] = v
      png.data[o + 1] = v
      png.data[o + 2] = v
      png.data[o + 3] = 255
    }
  }
  return PNG.sync.write(png)
}

interface OcrLine {
  text: string
  bbox: { x0: number; y0: number; x1: number; y1: number }
}

function parseIncomeText(text: string): number | null {
  const m = text.toLowerCase().replace(/\/s\s*$/, '').trim().match(/^([\d.]+)\s*([kmb])?$/)
  if (!m) return null
  const mult = m[2] === 'k' ? 1e3 : m[2] === 'm' ? 1e6 : m[2] === 'b' ? 1e9 : 1
  const v = parseFloat(m[1]) * mult
  return v > 0 ? v : null
}

// Fallback for glyph confusions on outlined fonts: "900Kl5" -> 900K.
// Only trusted with a K/M/B magnitude suffix (bare numbers are everywhere in UI).
function parseFuzzyIncome(text: string): number | null {
  const m = text.trim().match(/^([\d.]+)\s*([kKmMbB])\s*[/lI17|]\s*[sS5]?$/)
  if (!m) return null
  const mult = m[2].toLowerCase() === 'k' ? 1e3 : m[2].toLowerCase() === 'm' ? 1e6 : 1e9
  const v = parseFloat(m[1]) * mult
  return v > 0 ? v : null
}

function extractSpots(
  lines: OcrLine[],
  frame: { frameW: number; frameH: number; originX: number; originY: number; scale: number; upscale: number }
): IncomeSpot[] {
  const spots: IncomeSpot[] = []
  const push = (raw: string, line: OcrLine) => {
    const value = parseIncomeText(raw) ?? parseFuzzyIncome(raw)
    if (value === null) return
    if (spots.some(s => Math.abs(s.value - value) / value < 0.001)) return
    const cx = (line.bbox.x0 + line.bbox.x1) / 2 / frame.upscale
    const cy = (line.bbox.y0 + line.bbox.y1) / 2 / frame.upscale
    spots.push({
      text: raw.trim(),
      value,
      rx: (frame.originX + cx / frame.scale) / frame.frameW,
      ry: (frame.originY + cy / frame.scale) / frame.frameH
    })
  }
  for (const line of lines) {
    const strict = /([\d.]+\s*[kmb]?\s*\/s)/gi
    let m: RegExpExecArray | null
    let found = false
    while ((m = strict.exec(line.text)) !== null) {
      found = true
      push(m[1], line)
    }
    // Whole-line fallback: catches "900Kl5" style misreads
    if (!found && /[\d]/.test(line.text) && line.text.length < 24) {
      push(line.text, line)
    }
  }
  return spots.sort((a, b) => a.value - b.value)
}

export interface SpotResult {
  spots: IncomeSpot[]
  meta: { frameW: number; frameH: number; lines: number; sample: string; pass: string }
}

export async function spotIncomes(displayId: number | null = null): Promise<SpotResult> {
  const { captureAllCenterCrops } = await import('./capture')
  const fs = await import('fs/promises')
  const capDir = join(app.getPath('userData'), 'captures')
  try {
    await fs.mkdir(capDir, { recursive: true })
  } catch {}
  const crops = await captureAllCenterCrops()
  if (crops.length === 0) return { spots: [], meta: { frameW: 0, frameH: 0, lines: 0, sample: 'no-frame', pass: 'none' } }
  // Preferred display (user's Fortnite monitor) first, then brightest.
  // Single crop keeps reads near-instant.
  const ordered = displayId !== null
    ? [...crops].sort((a, b) => (b.displayId === displayId ? 1 : 0) - (a.displayId === displayId ? 1 : 0))
    : crops
  const crop = ordered[0]
  const thumb = nativeImage.createFromBuffer(crop.png)
  const size = thumb.getSize()
  try {
    await fs.writeFile(join(capDir, 'spot-raw.png'), crop.png)
  } catch {}

  const worker = await getWorker()
  // Page shape: blocks[] -> paragraphs[] -> lines[] (there is NO top-level `lines`).
  const linesOf = (data: unknown): OcrLine[] => {
    const d = data as {
      text?: string
      blocks?: Array<{ paragraphs?: Array<{ lines?: OcrLine[] }> }> | null
    }
    const out: OcrLine[] = []
    for (const b of d.blocks ?? []) {
      for (const p of b.paragraphs ?? []) {
        for (const l of p.lines ?? []) out.push(l)
      }
    }
    // Fallback: raw text without layout (positions span the crop).
    if (out.length === 0 && d.text && d.text.trim().length > 0) {
      const W = size.width * 2
      const H = size.height * 2
      for (const t of d.text.split('\n')) {
        if (t.trim().length === 0) continue
        out.push({ text: t, bbox: { x0: 0, y0: 0, x1: W, y1: H } })
      }
    }
    return out
  }

  // Single fast pass: binarized + 2x upscaled center crop.
  const { appendFileSync } = await import('fs')
  const dbg = (m: string) => {
    try {
      appendFileSync(join(app.getPath('userData'), 'app.log'), `[${new Date().toISOString()}] [ocr-spot] ${m}\n`)
    } catch {}
  }
  const t0 = Date.now()
  const raw = thumb.toBitmap()
  const cooked = binarizeUpscale(raw, size.width, size.height)
  try {
    await fs.writeFile(join(capDir, 'spot-cooked.png'), cooked)
  } catch {}
  dbg(`start crop=${size.width}x${size.height} origin=${Math.round(crop.originX)},${Math.round(crop.originY)}`)
  const recognized = await worker.recognize(cooked)
  const lines = linesOf((recognized as { data: unknown }).data)
  const spots = extractSpots(lines, {
    frameW: crop.frameW,
    frameH: crop.frameH,
    originX: crop.originX,
    originY: crop.originY,
    scale: crop.scale,
    upscale: 2
  })
  dbg(`done in=${Date.now() - t0}ms lines=${lines.length} spots=${spots.length} sample=${lines.map(l => l.text).join(' | ').slice(0, 160)}`)

  return {
    spots,
    meta: {
      frameW: size.width,
      frameH: size.height,
      lines: lines.length,
      sample: lines.map(l => l.text).join(' | ').slice(0, 200),
      pass: 'center-crop'
    }
  }
}
