// Offline OCR income spotter (tesseract.js, eng only).
// Tuned for Fortnite's chunky outlined display font:
//   1. teal-chroma isolate -> black-on-white -> 3x upscale (pure JS, no new runtime deps)
//   2. single pass with PSM SINGLE_BLOCK + rate-token whitelist
//   3. strict `/s` match (K/M/B/T) plus a fallback for common glyph confusions (/ -> l, s -> 5)
//      gated on an /s marker so accumulations like "15.50B" never become spots.
//   4. spots ranked by distance to screen center (crosshair) — closest first.
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

// Income popups use a distinctive bright teal fill (sampled ~57,244,188 on
// shot1.png) over dark pipes / bright sky. Luminance-only Otsu keeps the sky
// and fragments the thin outlined glyphs, so Tesseract sees nothing.
// Filter by chroma instead: black-on-white where the pixel is teal-ish,
// then 3x nearest-neighbor upscale (pure JS, no new runtime deps).
// 3x, not 2x: at 2x Tesseract drops leading digits ("92.80K/s" -> "2.80K/s"
// on shot2.png); at 3x both test frames read correctly. ~2x the pixels,
// still well under a second for on-demand F9.
function binarizeUpscale(src: Buffer, w: number, h: number): Buffer {
  const scale = 3
  const W = w * scale
  const H = h * scale
  const png = new PNG({ width: W, height: H })
  for (let y = 0; y < H; y++) {
    const sy = Math.min(h - 1, (y / scale) | 0)
    for (let x = 0; x < W; x++) {
      const sx = Math.min(w - 1, (x / scale) | 0)
      const si = (sy * w + sx) * 4
      const r = src[si]
      const g = src[si + 1]
      const b = src[si + 2]
      // Teal fill: high green, green well above red, blue above red.
      // Rejects dark pipes (low saturation) and bright sky (R≈G≈B).
      const isText = g > 110 && g - r > 45 && b - r > 15
      const v = isText ? 0 : 255
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
  const m = text.toLowerCase().replace(/\/s\s*$/, '').trim().match(/^([\d.]+)\s*([kmbt])?$/)
  if (!m) return null
  const mult = m[2] === 'k' ? 1e3 : m[2] === 'm' ? 1e6 : m[2] === 'b' ? 1e9 : m[2] === 't' ? 1e12 : 1
  const v = parseFloat(m[1]) * mult
  return v > 0 ? v : null
}

// Fallback for glyph confusions on outlined fonts: "900Kl5" -> 900K.
// Only trusted with a K/M/B/T magnitude suffix (bare numbers are everywhere in UI).
function parseFuzzyIncome(text: string): number | null {
  const m = text.trim().match(/^([\d.]+)\s*([kKmMbBtT])\s*[/lI17|]\s*[sS5]?$/)
  if (!m) return null
  const c = m[2].toLowerCase()
  const mult = c === 'k' ? 1e3 : c === 'm' ? 1e6 : c === 'b' ? 1e9 : 1e12
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
    // Strict rate match: a target rate ALWAYS ends in /s. Accumulated totals
    // like "15.50B" or "128.48T" have no /s and must never become spots.
    const strict = /([\d.]+\s*[kmbt]?\s*\/s)/gi
    let m: RegExpExecArray | null
    let found = false
    while ((m = strict.exec(line.text)) !== null) {
      found = true
      push(m[1], line)
    }
    // Whole-line fallback: catches "900Kl5" style misreads ONLY.
    // Requires an /s marker at END of line (or its OCR-mangled variants);
    // otherwise bare accumulations ("15.50B") and HUD numbers leak in.
    // Anchored: a bare "15" (1+5) must not count as l/1 + s/5.
    // Unsupported suffixes are rejected by the parsers (K/M/B/T only).
    const hasRateMarker = /\/\s*s\s*$/i.test(line.text) || /[/lI17|]\s*[sS5]\s*$/.test(line.text)
    if (!found && hasRateMarker && /[\d]/.test(line.text) && line.text.length < 24) {
      push(line.text, line)
    }
  }
  // F9 UX is "aim at the droid": the crosshair-adjacent popup is near screen
  // center (0.5, 0.5). Try the closest spot first — value-ascending order
  // picks whatever happens to be smallest, ignoring where you aim.
  const dist2 = (s: IncomeSpot) => (s.rx - 0.5) * (s.rx - 0.5) + (s.ry - 0.5) * (s.ry - 0.5)
  return spots.sort((a, b) => dist2(a) - dist2(b) || a.value - b.value)
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
      const W = size.width * 3
      const H = size.height * 3
      for (const t of d.text.split('\n')) {
        if (t.trim().length === 0) continue
        out.push({ text: t, bbox: { x0: 0, y0: 0, x1: W, y1: H } })
      }
    }
    return out
  }

  // Single fast pass: binarized + 3x upscaled center crop.
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
  // Sparse floating labels on a busy 3D background: SINGLE_BLOCK (6) beats
  // fully-automatic segmentation, and a tight whitelist stops the engine
  // wasting effort on pipes/sky glyphs. Verified on shot1.png:
  // default PSM+charset reads nothing; this reads "92.80K/s" cleanly.
  try {
    await (worker as unknown as { setParameters: (p: Record<string, string>) => Promise<void> }).setParameters({
      tessedit_pageseg_mode: '6',
      tessedit_char_whitelist: '0123456789.KkMmBbTtSs/ '
    })
  } catch {}
  // blocks:true is required — without it tesseract.js returns text only
  // (blocks=null) and every spot collapses to the crop center, making
  // crosshair-distance ranking impossible. Verified on shot1.png.
  const recognized = await (worker as unknown as {
    recognize: (img: Buffer, opts?: object, output?: object) => Promise<unknown>
  }).recognize(cooked, {}, { blocks: true })
  const lines = linesOf((recognized as { data: unknown }).data)
  const spots = extractSpots(lines, {
    frameW: crop.frameW,
    frameH: crop.frameH,
    originX: crop.originX,
    originY: crop.originY,
    scale: crop.scale,
    upscale: 3
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
