// Glyph template matching — Pass 1 primary for Class I (floating income
// strips). Closed vocabulary from harvested frames; templates are pixel-exact
// color crops versioned in ocr-glyphs/ + manifest.json. Unrecognized glyphs
// decode as '?' so parsers reject the line instead of placing anything wrong.
//
// Scope-split invariants:
// - Runs ONLY on the mint/teal color-keyed mask. No Otsu fallback: white UI
//   text must never reach the template matcher.
// - The "/s" combo template has char "/s" and emits two characters per match.
import { app } from 'electron'
import { join } from 'path'
import { fileURLToPath } from 'url'
import { PNG } from 'pngjs'
import {
  tealMask,
  MIN_TEAL_INK,
  findBoxes,
  groupLines,
  PPOCR_UPSCALE,
  type Box,
  type PpOcrLine
} from './ppocr'

const here = join(fileURLToPath(import.meta.url), '..')

function glyphsBase(): string {
  if (app.isPackaged) return join(process.resourcesPath, 'ocr-glyphs')
  return join(here, '..', '..', 'ocr-glyphs')
}

interface Template {
  char: string
  aspect: number // tight-ink width / height — pre-gate before canonical compare
  canon: Uint8Array // 32x32 binary shape, box-average resampled + rethresholded
}

// Template fill rule — MUST be pixel-identical to tealMask in ppocr.ts:
// harvested crops keep full color precisely so both sides share one fill
// definition.
function templateInk(
  data: Buffer, w: number, h: number
): { ink: Uint8Array; ix0: number; iy0: number; ix1: number; iy1: number } {
  const ink = new Uint8Array(w * h)
  let ix0 = w
  let iy0 = h
  let ix1 = -1
  let iy1 = -1
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4
      const r = data[i]
      const g = data[i + 1]
      const b = data[i + 2]
      const hit = g > 110 && g - r > 45 && b - r > 15
      if (hit) {
        ink[y * w + x] = 1
        if (x < ix0) ix0 = x
        if (x > ix1) ix1 = x
        if (y < iy0) iy0 = y
        if (y > iy1) iy1 = y
      }
    }
  }
  return { ink, ix0, iy0, ix1, iy1 }
}

let templatesPromise: Promise<Map<string, Template[]>> | null = null

async function getTemplates(): Promise<Map<string, Template[]>> {
  if (!templatesPromise) {
    templatesPromise = (async () => {
      const fs = await import('fs/promises')
      const base = glyphsBase()
      const manifest = JSON.parse(
        await fs.readFile(join(base, 'manifest.json'), 'utf8')
      ) as Array<{ char: string; file: string; set?: string }>
      const byChar = new Map<string, Template[]>()
      for (const m of manifest) {
        const buf = await fs.readFile(join(base, m.file))
        const png = PNG.sync.read(buf)
        const { ink, ix0, iy0, ix1, iy1 } = templateInk(png.data, png.width, png.height)
        if (ix1 < ix0) continue // blank template — never load emptiness
        const w = ix1 - ix0 + 1
        const h = iy1 - iy0 + 1
        const t: Template = {
          char: m.char,
          aspect: w / h,
          canon: canonicalize(ink, ix0, iy0, ix1, iy1, png.width)
        }
        if (!byChar.has(m.char)) byChar.set(m.char, [])
        byChar.get(m.char)!.push(t)
      }
      if (byChar.size === 0) throw new Error('no glyph templates')
      return byChar
    })()
  }
  return templatesPromise
}

// Scale-invariant shape matching: tight ink bboxes are resampled to a fixed
// 32x32 canonical grid (box-average, rethreshold 0.5) and compared there.
// Score = mismatched cells / union cells. Accept gate: CANON_GATE (0.10).
// An aspect pre-gate (|Δaspect| ≤ 0.15) keeps narrow/wide glyphs apart before
// the square grid erases proportions. NCC is diagnostic-only, never the gate.
const CANON = 32
const ASPECT_GATE = 0.15
const CANON_GATE = 0.1

// Box-average resample of a binary mask bbox to the 32x32 canonical grid.
// Pure TS, area-weighted, rethresholded at 0.5 — no dependencies.
function canonicalize(
  ink: Uint8Array, x0: number, y0: number, x1: number, y1: number, w: number
): Uint8Array {
  const sw = x1 - x0 + 1
  const sh = y1 - y0 + 1
  const out = new Uint8Array(CANON * CANON)
  for (let oy = 0; oy < CANON; oy++) {
    const yA = (oy * sh) / CANON
    const yB = ((oy + 1) * sh) / CANON
    const ya = Math.max(0, Math.floor(yA))
    const yb = Math.min(sh - 1, Math.ceil(yB) - 1)
    for (let ox = 0; ox < CANON; ox++) {
      const xA = (ox * sw) / CANON
      const xB = ((ox + 1) * sw) / CANON
      const xa = Math.max(0, Math.floor(xA))
      const xb = Math.min(sw - 1, Math.ceil(xB) - 1)
      let sum = 0
      let area = 0
      for (let sy = ya; sy <= yb; sy++) {
        const wy = Math.min(sy + 1, yB) - Math.max(sy, yA)
        if (wy <= 0) continue
        for (let sx = xa; sx <= xb; sx++) {
          const wx = Math.min(sx + 1, xB) - Math.max(sx, xA)
          if (wx <= 0) continue
          area += wx * wy
          if (ink[(y0 + sy) * w + (x0 + sx)]) sum += wx * wy
        }
      }
      out[oy * CANON + ox] = area > 0 && sum / area >= 0.5 ? 1 : 0
    }
  }
  return out
}

function canonMismatch(a: Uint8Array, b: Uint8Array): number {
  let mismatch = 0
  let union = 0
  for (let i = 0; i < CANON * CANON; i++) {
    if (a[i] || b[i]) {
      union++
      if (a[i] !== b[i]) mismatch++
    }
  }
  return union === 0 ? 1 : mismatch / union
}

interface MatchStats {
  comparisons: number
  aspectSkipped: number
}

let lastStats: MatchStats = { comparisons: 0, aspectSkipped: 0 }

/** Counters from the most recent matchLines() call (diagnostics). */
export function lastMatchStats(): MatchStats {
  return { ...lastStats }
}

// Split a mask-space line box into glyph boxes via projection valleys
// (same proven rules as scripts/cut-glyphs.js: split at near-empty columns,
// then at deep internal valleys with viable glyphs both sides).
function splitGlyphs(
  mask: Uint8Array,
  W: number,
  line: { x0: number; y0: number; x1: number; y1: number }
): Box[] {
  const counts: number[] = []
  for (let x = line.x0; x <= line.x1; x++) {
    let c = 0
    for (let y = line.y0; y <= line.y1; y++) c += mask[y * W + x]
    counts.push(c)
  }
  const segs: Box[] = []
  let sx = -1
  const flush = (ex: number) => {
    if (sx >= 0 && ex - sx + 1 >= 6) segs.push({ x0: line.x0 + sx, x1: line.x0 + ex, y0: line.y0, y1: line.y1 })
    sx = -1
  }
  counts.forEach((c, i) => {
    if (c <= 3) flush(i - 1)
    else if (sx < 0) sx = i
  })
  flush(counts.length - 1)
  const kept = segs.filter(s => {
    let peak = 0
    for (let x = s.x0; x <= s.x1; x++) peak = Math.max(peak, counts[x - line.x0])
    return s.x1 - s.x0 + 1 >= 8 || peak >= 5
  })
  const splitSeg = (s: Box): Box[] => {
    let peak = 0
    for (let x = s.x0; x <= s.x1; x++) peak = Math.max(peak, counts[x - line.x0])
    let bi = -1
    let bv = Infinity
    for (let x = s.x0; x <= s.x1; x++) {
      const c = counts[x - line.x0]
      if (c < bv) {
        bv = c
        bi = x
      }
    }
    if (bi > 0 && bv < peak * 0.3 && bi - s.x0 + 1 >= 10 && s.x1 - bi >= 10) {
      const out: Box[] = []
      for (const sub of [
        { x0: s.x0, x1: bi },
        { x0: bi + 1, x1: s.x1 }
      ]) {
        if (sub.x1 - sub.x0 + 1 >= 24) out.push(...splitSeg({ ...sub, y0: s.y0, y1: s.y1 }))
        else out.push({ ...sub, y0: s.y0, y1: s.y1 })
      }
      return out
    }
    return [s]
  }
  const parts: Box[] = []
  for (const s of kept) {
    for (const p of splitSeg(s)) parts.push(p)
  }
  return parts.sort((a, b) => a.x0 - b.x0)
}

/** Template-match Class I line strips in a raw BGRA crop. Throws on failure.
 * Color-keyed only: the mint/teal mask (no Otsu — UI text stays in Pass 2).
 * Scale-invariant: tight ink bboxes go through the 32x32 canonical grid with
 * an aspect pre-gate (|Δ| ≤ 0.15); best exemplar per character wins, best
 * character wins the ROI at mismatch/union ≤ 0.10.
 * The "/s" manifest entry emits two characters per single-template match. */
export async function matchLines(_src: Buffer, _w: number, _h: number): Promise<PpOcrLine[]> {
  const byChar = await getTemplates()
  lastStats = { comparisons: 0, aspectSkipped: 0 }
  const decode = (
    mask: Uint8Array, W: number, H: number
  ): PpOcrLine[] => {
    const out: PpOcrLine[] = []
    for (const line of groupLines(findBoxes(mask, W, H))) {
      let text = ''
      for (const g of splitGlyphs(mask, W, line)) {
        // Tighten to the ink bbox in mask space, then step down to crop
        // coords: the 2x mask replicates each raw pixel into a 2x2 block
        // (nearest), so sampling stride-2 recovers the exact per-pixel fill
        // with no interpolation.
        let tx0 = g.x1
        let ty0 = g.y1
        let tx1 = g.x0
        let ty1 = g.y0
        for (let y = g.y0; y <= g.y1; y++) {
          for (let x = g.x0; x <= g.x1; x++) {
            if (mask[y * W + x]) {
              if (x < tx0) tx0 = x
              if (x > tx1) tx1 = x
              if (y < ty0) ty0 = y
              if (y > ty1) ty1 = y
            }
          }
        }
        if (ty1 < ty0 || tx1 < tx0) continue // no ink — never claim emptiness
        const cx0 = tx0 >> 1
        const cy0 = ty0 >> 1
        const cx1 = tx1 >> 1
        const cy1 = ty1 >> 1
        const rw = cx1 - cx0 + 1
        const rh = cy1 - cy0 + 1
        const obs = new Uint8Array(rw * rh)
        for (let y = 0; y < rh; y++) {
          for (let x = 0; x < rw; x++) {
            obs[y * rw + x] = mask[(cy0 + y) * 2 * W + ((cx0 + x) * 2)] ? 1 : 0
          }
        }
        const rAspect = rw / rh
        const rCanon = canonicalize(obs, 0, 0, rw - 1, rh - 1, rw)
        let best = '?'
        let bestScore = CANON_GATE
        for (const [, list] of byChar) {
          // Best exemplar per character first.
          let charBest = Infinity
          for (const t of list) {
            if (Math.abs(t.aspect - rAspect) > ASPECT_GATE) {
              lastStats.aspectSkipped++
              continue
            }
            lastStats.comparisons++
            const s = canonMismatch(t.canon, rCanon)
            if (s < charBest) charBest = s
          }
          // Then best character wins the ROI.
          if (charBest < bestScore) {
            bestScore = charBest
            best = list[0].char
          }
        }
        text += best // "/s" entries contribute two chars here by design
      }
      if (text.length > 0) {
        out.push({ text, bbox: { x0: line.x0, y0: line.y0, x1: line.x1, y1: line.y1 } })
      }
    }
    return out
  }
  const lines: PpOcrLine[] = []
  const teal = tealMask(_src, _w, _h, PPOCR_UPSCALE)
  if (teal.ink >= MIN_TEAL_INK) lines.push(...decode(teal.mask, teal.W, teal.H))
  return lines.sort((a, b) => a.bbox.y0 - b.bbox.y0 || a.bbox.x0 - b.bbox.x0)
}
