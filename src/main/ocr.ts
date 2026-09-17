// Offline OCR income spotter (glyph templates + PP-OCRv5 + tesseract.js).
// Scope-split two-pass pipeline over ONE F9 frame:
//   Pass 1 (primary for Class I): glyph template matching on the
//     mint/teal color-keyed mask -> claimed boxes + decoded strings.
//     Only lines that parse as income rates are claimed; anything else
//     ('?', fragments, non-income) returns to the Pass 2 pool — never drop.
//   Pass 2 (Class U + backup): PP-OCRv5 on the frame with gate-accepted
//     Pass 1 boxes excluded at proposal level (no pixel surgery), so neon
//     glow stops polluting text proposals. OCR never runs inside claimed
//     regions; glyphs never run outside color-keyed regions.
//   Pass 3 (fallback): Tesseract on RAW upscale when merged spots are empty.
// Merged result: income fields from Pass 1 take priority, everything else
// from Pass 2. No schema change for consumers (spot popup, sell mode).
// Rollback: GLYPH_EXCLUDE=0 restores the legacy order exactly
// (PP-OCR -> glyphs-if-empty -> Tesseract-if-empty, no exclusion).
//
// Packaging note: the tesseract worker thread + wasm engine are shipped as
// plain files (see scripts/copy-ocr-assets.js) and referenced by explicit
// paths, because the vite-bundled main process cannot resolve them inside app.asar.

import { app, nativeImage } from 'electron'
import { join } from 'path'
import { fileURLToPath } from 'url'
import { createWorker, Worker } from 'tesseract.js'
import { PNG } from 'pngjs'
import { PPOCR_UPSCALE } from './ppocr'

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

// Raw upscale for the Tesseract fallback pass: bilinear 2x of the untouched
// crop. Tesseract does its own adaptive thresholding internally — our old
// hard-binarized "cooked" image destroyed washed-out live thumbnails (blank
// white page), so the engines now always read raw pixels. The mask only
// locates strips for the PP-OCR pass, never what the text looks like.
// (3x kept the leading 9 on files, but raw 2x reads at least as well and
// halves the fallback time; verified on shot1/shot2.)
function upscaleRaw(src: Buffer, w: number, h: number): Buffer {
  const scale = 2
  const W = w * scale
  const H = h * scale
  const png = new PNG({ width: W, height: H })
  for (let y = 0; y < H; y++) {
    const gy = (y + 0.5) / scale - 0.5
    const yA = Math.max(0, Math.min(h - 1, Math.floor(gy)))
    const yB = Math.min(h - 1, yA + 1)
    const fy = Math.max(0, Math.min(1, gy - yA))
    for (let x = 0; x < W; x++) {
      const gx = (x + 0.5) / scale - 0.5
      const xA = Math.max(0, Math.min(w - 1, Math.floor(gx)))
      const xB = Math.min(w - 1, xA + 1)
      const fx = Math.max(0, Math.min(1, gx - xA))
      const o = (y * W + x) * 4
      for (let c = 0; c < 3; c++) {
        const v00 = src[(yA * w + xA) * 4 + c]
        const v10 = src[(yA * w + xB) * 4 + c]
        const v01 = src[(yB * w + xA) * 4 + c]
        const v11 = src[(yB * w + xB) * 4 + c]
        png.data[o + c] = Math.round((v00 * (1 - fx) + v10 * fx) * (1 - fy) + (v01 * (1 - fx) + v11 * fx) * fy)
      }
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

// Rollback flag for the scope-split pipeline. GLYPH_EXCLUDE=0 reproduces the
// legacy order exactly (PP-OCR -> glyphs-if-empty -> Tesseract-if-empty with
// no box exclusion). Any other value (including unset) enables scope-split.
export let glyphExclusionEnabled = process.env.GLYPH_EXCLUDE !== '0'
export function setGlyphExclusion(v: boolean): void {
  glyphExclusionEnabled = v
}

type ClaimBox = { x0: number; y0: number; x1: number; y1: number }

// Claimed regions: glyph lines that decode to at least one parseable income
// token (same gates as extractSpots). Rejection routing: lines that fire but
// fail the parse ('?', fragments,_accumulations without /s) are NOT claimed
// and stay in the Pass 2 pool — a color-mask false positive degrades to
// current OCR behavior, never to silence.
function claimedGlyphBoxes(glyphLines: OcrLine[]): ClaimBox[] {
  const claimed: ClaimBox[] = []
  for (const line of glyphLines) {
    let ok = false
    const strict = /([\d.]+\s*[kmbt]?\s*\/s)/gi
    let m: RegExpExecArray | null
    while ((m = strict.exec(line.text)) !== null) {
      if (parseIncomeText(m[1]) !== null) {
        ok = true
        break
      }
    }
    if (!ok) {
      const hasRateMarker = /\/\s*s\s*$/i.test(line.text) || /[/lI17|]\s*[sS5]\s*$/.test(line.text)
      if (hasRateMarker && /[\d]/.test(line.text) && line.text.length < 24) {
        if (parseIncomeText(line.text) ?? parseFuzzyIncome(line.text)) ok = true
      }
    }
    if (ok) claimed.push({ ...line.bbox })
  }
  return claimed
}

// Proposal-level exclusion: drop OCR lines whose center falls inside a
// claimed Pass 1 box (all boxes share the 2x mask coord space). Everything
// else passes through untouched, so Class U text is fully preserved.
function excludeClaimed(
  lines: OcrLine[],
  claimed: ClaimBox[]
): { kept: OcrLine[]; dropped: number } {
  if (claimed.length === 0) return { kept: lines, dropped: 0 }
  const kept: OcrLine[] = []
  let dropped = 0
  for (const l of lines) {
    const cx = (l.bbox.x0 + l.bbox.x1) / 2
    const cy = (l.bbox.y0 + l.bbox.y1) / 2
    if (claimed.some(b => cx >= b.x0 && cx <= b.x1 && cy >= b.y0 && cy <= b.y1)) {
      dropped++
    } else {
      kept.push(l)
    }
  }
  return { kept, dropped }
}

// Merge Pass 1 + Pass 2 spots: Pass 1 wins value ties (same income read by
// both), then center-distance ranking as before. Stable: glyph order kept.
function mergeSpots(first: IncomeSpot[], second: IncomeSpot[]): IncomeSpot[] {
  const out = [...first]
  for (const s of second) {
    if (!out.some(k => Math.abs(k.value - s.value) / s.value < 0.001)) out.push(s)
  }
  const dist2 = (s: IncomeSpot) => (s.rx - 0.5) * (s.rx - 0.5) + (s.ry - 0.5) * (s.ry - 0.5)
  return out.sort((a, b) => dist2(a) - dist2(b) || a.value - b.value)
}

export interface SpotResult {
  spots: IncomeSpot[]
  meta: { frameW: number; frameH: number; lines: number; sample: string; pass: string }
}

import type { DisplayCrop } from './capture'

// Pre-load all OCR engines (PP-OCR sessions + Tesseract worker) while idle
// after launch, so the first F9 never pays init. Same sessions F9 uses;
// zero effect on what gets detected.
export async function warmupOcr(): Promise<void> {
  const { warmup } = await import('./ppocr')
  await warmup()
  await getWorker()
}

export async function spotIncomes(displayId: number | null = null): Promise<SpotResult> {  const { captureAllCenterCrops, captureFortniteWindowCrop } = await import('./capture')
  const fs = await import('fs/promises')
  const capDir = join(app.getPath('userData'), 'captures')
  try {
    await fs.mkdir(capDir, { recursive: true })
  } catch {}
  const { appendFileSync } = await import('fs')
  const dbg = (m: string) => {
    try {
      appendFileSync(join(app.getPath('userData'), 'app.log'), `[${new Date().toISOString()}] [ocr-spot] ${m}\n`)
    } catch {}
  }
  // Lazy capture: game window first (the common path screenshots nothing
  // else). Screens are only captured at all when the window is missing.
  const crops: DisplayCrop[] = []
  // Game window first: screenshots ONLY Fortnite (no monitor guessing).
  // This block is proven correct; do not touch it.
  try {
    const { crop: win, candidates } = await captureFortniteWindowCrop()
    dbg(`windows seen: ${candidates.slice(0, 12).join(' | ').slice(0, 300)}`)
    if (win) {
      dbg(`game-window crop ${win.frameW}x${win.frameH}`)
      crops.push(win)
    } else {
      dbg('game window not found, using display crops')
    }
  } catch (e) {
    dbg(`game-window capture failed: ${String((e as Error)?.message ?? e).slice(0, 120)}`)
  }
  // ONE capture per F9: the game window if found, else a single display
  // crop (explicit choice, then primary, then brightest). Screens are only
  // captured when the game window is missing — never speculatively.
  // The game-window block above is proven correct; do not touch it.
  let attempt = crops.find(c => c.displayId === -1) ?? null
  if (!attempt) {
    const screenCrops = await captureAllCenterCrops()
    const preferred = displayId ?? screenCrops.find(c => c.primary)?.displayId ?? null
    attempt = [...screenCrops].sort((a, b) =>
      ((b.displayId === preferred) ? 1 : 0) - ((a.displayId === preferred) ? 1 : 0) ||
      Number(b.primary) - Number(a.primary) ||
      b.brightness - a.brightness
    )[0] ?? null
  }
  if (!attempt) return { spots: [], meta: { frameW: 0, frameH: 0, lines: 0, sample: 'no-frame', pass: 'none' } }
  const crop = attempt

  // Page shape: blocks[] -> paragraphs[] -> lines[] (there is NO top-level `lines`).
  const linesOf = (data: unknown, size: { width: number; height: number }): OcrLine[] => {
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

  // ONE frame, both engine passes on RAW pixels. Single debug file:
  // spot.png is always the exact frame that was read. Legacy spot-raw.png
  // / spot-cooked.png from the multi-crop era are deleted so the folder
  // never shows stale frames again.
  const t0 = Date.now()

  let lines: OcrLine[] = []
  let spots: IncomeSpot[] = []
  let upscale = PPOCR_UPSCALE
  let pass = 'ppocr'
  let size = { width: 0, height: 0 }

  {
    const thumb = nativeImage.createFromBuffer(crop.png)
    size = thumb.getSize()
    const raw = thumb.toBitmap()
    for (const stale of ['spot-raw.png', 'spot-cooked.png', 'spot-gamewin.png']) {
      try {
        await fs.unlink(join(capDir, stale))
      } catch {}
    }
    try {
      await fs.writeFile(join(capDir, 'spot.png'), crop.png)
    } catch {}
    dbg(`read display=${crop.displayId === -1 ? 'game-window' : crop.displayId} crop=${size.width}x${size.height} origin=${Math.round(crop.originX)},${Math.round(crop.originY)}`)

    // Shared frame geometry for both passes.
    const frame = {
      frameW: crop.frameW,
      frameH: crop.frameH,
      originX: crop.originX,
      originY: crop.originY,
      scale: crop.scale
    }

    // SCOPE-SPLIT pipeline (flag on): glyphs claim Class I first, PP-OCR
    // reads everything else with claimed boxes excluded, Tesseract backs up
    // only when the merge is empty. LEGACY path (flag off) preserves the old
    // order exactly: PP-OCR -> glyphs-if-empty -> Tesseract-if-empty.
    lines = []
    upscale = PPOCR_UPSCALE
    pass = glyphExclusionEnabled ? 'glyphs' : 'ppocr'
    let claimed: ClaimBox[] = []
    let glyphLines: OcrLine[] = []
    let glyphSpots: IncomeSpot[] = []

    if (!glyphExclusionEnabled) {
      // ---- Legacy order (GLYPH_EXCLUDE=0): unchanged behavior ----
      try {
      const { recognizeLines } = await import('./ppocr')
      const tPp = Date.now()
      const res = await recognizeLines(raw, size.width, size.height)
      lines = res.lines
      dbg(`ppocr in=${Date.now() - tPp}ms ink=${(res.ink * 100).toFixed(2)}%${res.otsu ? ' OTSU-FALLBACK' : ''} lines=${lines.length} sample=${lines.map(l => l.text).join(' | ').slice(0, 160)}`)
      } catch (e) {
        dbg(`ppocr failed, falling back to tesseract: ${String((e as Error)?.message ?? e).slice(0, 160)}`)
        lines = []
      }
      spots = extractSpots(lines, { ...frame, upscale })

      if (spots.length === 0) {
        try {
          const { matchLines } = await import('./glyphs')
          const tT = Date.now()
          lines = await matchLines(raw, size.width, size.height)
          pass = 'glyphs'
          dbg(`glyphs in=${Date.now() - tT}ms lines=${lines.length} sample=${lines.map(l => l.text).join(' | ').slice(0, 160)}`)
        } catch (e) {
          dbg(`glyphs failed: ${String((e as Error)?.message ?? e).slice(0, 120)}`)
          lines = []
        }
        spots = extractSpots(lines, { ...frame, upscale })
      }
    } else {
      // ---- Pass 1 (Class I): glyph matcher on color-keyed regions ----
      try {
        const { matchLines } = await import('./glyphs')
        const tG = Date.now()
        glyphLines = await matchLines(raw, size.width, size.height)
        dbg(`glyphs in=${Date.now() - tG}ms lines=${glyphLines.length} sample=${glyphLines.map(l => l.text).join(' | ').slice(0, 160)}`)
      } catch (e) {
        dbg(`glyphs failed: ${String((e as Error)?.message ?? e).slice(0, 120)}`)
        glyphLines = []
      }
      glyphSpots = extractSpots(glyphLines, { ...frame, upscale })
      claimed = claimedGlyphBoxes(glyphLines)
      try {
        const { lastMatchStats } = await import('./glyphs')
        const st = lastMatchStats()
        dbg(`glyphs claimed=${claimed.length} spots=${glyphSpots.length} cmp=${st.comparisons} aspectSkip=${st.aspectSkipped}`)
      } catch {
        dbg(`glyphs claimed=${claimed.length} spots=${glyphSpots.length}`)
      }

      // ---- Pass 2 (Class U + backup): PP-OCRv5 minus claimed regions ----
      let ppLines: OcrLine[] = []
      try {
        const { recognizeLines } = await import('./ppocr')
        const tPp = Date.now()
        const res = await recognizeLines(raw, size.width, size.height)
        const { kept, dropped } = excludeClaimed(res.lines, claimed)
        ppLines = kept
        dbg(`ppocr in=${Date.now() - tPp}ms ink=${(res.ink * 100).toFixed(2)}%${res.otsu ? ' OTSU-FALLBACK' : ''} lines=${res.lines.length} excluded=${dropped} kept=${kept.length} sample=${kept.map(l => l.text).join(' | ').slice(0, 160)}`)
      } catch (e) {
        dbg(`ppocr failed: ${String((e as Error)?.message ?? e).slice(0, 160)}`)
        ppLines = []
      }
      const ppSpots = extractSpots(ppLines, { ...frame, upscale })
      spots = mergeSpots(glyphSpots, ppSpots)
      lines = [...glyphLines, ...ppLines]
      pass = glyphSpots.length > 0 ? (ppSpots.length > 0 ? 'glyphs+ppocr' : 'glyphs') : 'ppocr'
    }

    if (spots.length === 0) {
      // Pass 3 (fallback): Tesseract on the RAW upscaled crop — it does its
      // own adaptive thresholding internally. No second debug file: spot.png
      // above is already the exact frame being read.
      // Worker spins up lazily here so earlier hits never pay for it.
      // Live proved Tesseract can grind 30-47s on noisy frames while the
      // user mashes F9: hard-timeout the fallback so one bad frame can never
      // wedge the pipeline (fail fast, keep glyph+PP-OCR lines for the log).
      const TESS_TIMEOUT_MS = 12000
    const worker = await getWorker()
    const cooked = upscaleRaw(raw, size.width, size.height)
      // Sparse floating labels on a busy 3D background: SINGLE_BLOCK (6) beats
      // fully-automatic segmentation, and a tight whitelist stops the engine
      // wasting effort on pipes/sky glyphs.
      try {
        await (worker as unknown as { setParameters: (p: Record<string, string>) => Promise<void> }).setParameters({
          tessedit_pageseg_mode: '6',
          tessedit_char_whitelist: '0123456789.KkMmBbTtSs/ '
        })
      } catch {}
      // blocks:true is required — without it tesseract.js returns text only
      // (blocks=null) and every spot collapses to the crop center, making
      // crosshair-distance ranking impossible. Verified on shot1.png.
      let recognized: unknown = null
      try {
        recognized = await Promise.race([
          (worker as unknown as {
            recognize: (img: Buffer, opts?: object, output?: object) => Promise<unknown>
          }).recognize(cooked, {}, { blocks: true }),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('tesseract-timeout')), TESS_TIMEOUT_MS)
          )
        ])
      } catch (e) {
        // Timeout (or worker fault): do NOT retry — fall through with empty
        // fallback lines. spots stays empty and the F9 toast reports no text.
        dbg(`tesseract ${String((e as Error)?.message ?? e).slice(0, 60)} after ${TESS_TIMEOUT_MS}ms — fallback skipped`)
        pass = `${pass}+tesseract-timeout`
      }
      const tessLines = recognized ? linesOf((recognized as { data: unknown }).data, size) : []
      upscale = 2
      if (!recognized) {
        // Timed-out fallback: lines keeps the merged glyph+PP-OCR set for
        // the log sample, spots stays empty, pass keeps the timeout marker.
      } else if (glyphExclusionEnabled && claimed.length > 0) {
        // Same 2x coord space as the claimed boxes: exclude, never drop
        // silently — the filter only removes centers inside claimed strips.
        const { kept, dropped } = excludeClaimed(tessLines, claimed)
        lines = [...glyphLines, ...kept]
        dbg(`tesseract excluded=${dropped} kept=${kept.length}`)
        pass = `${pass}+center-crop`
        spots = mergeSpots(glyphSpots, extractSpots(kept, { ...frame, upscale }))
      } else {
        lines = tessLines
        pass = 'center-crop'
        spots = extractSpots(lines, { ...frame, upscale })
      }
    }
  }
  dbg(`done in=${Date.now() - t0}ms pass=${pass} lines=${lines.length} spots=${spots.length} sample=${lines.map(l => l.text).join(' | ').slice(0, 160)}`)

  return {
    spots,
    meta: {
      frameW: size.width,
      frameH: size.height,
      lines: lines.length,
      sample: lines.map(l => l.text).join(' | ').slice(0, 200),
      pass
    }
  }
}
