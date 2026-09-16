// Glyph template matching fallback (no ML, no new deps).
// Reference glyphs are cut from user-confirmed frames (scripts/cut-glyphs.js)
// and versioned in ocr-glyphs/ + manifest.json — every corrected miss becomes
// permanent reference data that ships to all installs. Matching is grayscale
// normalized cross-correlation, multi-sample per char, threshold-gated.
// Unrecognized glyphs decode as '?' so parsers (strict /s + table gate)
// reject the line instead of placing anything wrong.
import { app } from 'electron'
import { join } from 'path'
import { fileURLToPath } from 'url'
import { PNG } from 'pngjs'
import {
  tealMask,
  otsuMask,
  MIN_TEAL_INK,
  findBoxes,
  groupLines,
  PPOCR_UPSCALE,
  type Box,
  type PpOcrLine
} from './ppocr'

const MATCH_THRESHOLD = 0.7

const here = join(fileURLToPath(import.meta.url), '..')

function glyphsBase(): string {
  if (app.isPackaged) return join(process.resourcesPath, 'ocr-glyphs')
  return join(here, '..', '..', 'ocr-glyphs')
}

interface Template {
  char: string
  g: Float32Array
  w: number
  h: number
}

let templatesPromise: Promise<Map<string, Template[]>> | null = null

async function getTemplates(): Promise<Map<string, Template[]>> {
  if (!templatesPromise) {
    templatesPromise = (async () => {
      const fs = await import('fs/promises')
      const base = glyphsBase()
      const manifest = JSON.parse(
        await fs.readFile(join(base, 'manifest.json'), 'utf8')
      ) as Array<{ char: string; file: string }>
      const byChar = new Map<string, Template[]>()
      for (const m of manifest) {
        const buf = await fs.readFile(join(base, m.file))
        const png = PNG.sync.read(buf)
        const g = new Float32Array(png.width * png.height)
        for (let i = 0; i < png.width * png.height; i++) {
          g[i] = (png.data[i * 4] + png.data[i * 4 + 1] + png.data[i * 4 + 2]) / 3
        }
        const t = { char: m.char, g, w: png.width, h: png.height }
        if (!byChar.has(m.char)) byChar.set(m.char, [])
        byChar.get(m.char)!.push(t)
      }
      if (byChar.size === 0) throw new Error('no glyph templates')
      return byChar
    })()
  }
  return templatesPromise
}

function resizeBilinear(g: Float32Array, w: number, h: number, W: number, H: number): Float32Array {
  const out = new Float32Array(W * H)
  for (let y = 0; y < H; y++) {
    const sy = Math.min(h - 1, Math.max(0, (y + 0.5) * h / H - 0.5))
    const yA = Math.floor(sy)
    const yB = Math.min(h - 1, yA + 1)
    const fy = sy - yA
    for (let x = 0; x < W; x++) {
      const sx = Math.min(w - 1, Math.max(0, (x + 0.5) * w / W - 0.5))
      const xA = Math.floor(sx)
      const xB = Math.min(w - 1, xA + 1)
      const fx = sx - xA
      out[y * W + x] =
        (g[yA * w + xA] * (1 - fx) + g[yA * w + xB] * fx) * (1 - fy) +
        (g[yB * w + xA] * (1 - fx) + g[yB * w + xB] * fx) * fy
    }
  }
  return out
}

function ncc(a: Float32Array, b: Float32Array): number {
  const n = a.length
  let ma = 0
  let mb = 0
  for (let i = 0; i < n; i++) {
    ma += a[i]
    mb += b[i]
  }
  ma /= n
  mb /= n
  let sab = 0
  let saa = 0
  let sbb = 0
  for (let i = 0; i < n; i++) {
    const da = a[i] - ma
    const db = b[i] - mb
    sab += da * db
    saa += da * da
    sbb += db * db
  }
  if (saa < 1e-9 || sbb < 1e-9) return -1
  return sab / Math.sqrt(saa * sbb)
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

function sampleGray(src: Buffer, srcW: number, srcH: number, gx: number, gy: number): number {
  const x = Math.max(0, Math.min(srcW - 1, Math.round(gx)))
  const y = Math.max(0, Math.min(srcH - 1, Math.round(gy)))
  const si = (y * srcW + x) * 4
  return (src[si] + src[si + 1] + src[si + 2]) / 3
}

/** Template-match line strips from a raw BGRA crop. Throws on any failure. */
export async function matchLines(src: Buffer, w: number, h: number): Promise<PpOcrLine[]> {
  const byChar = await getTemplates()
  let { mask, W, H, ink } = tealMask(src, w, h, PPOCR_UPSCALE)
  if (ink < MIN_TEAL_INK) {
    ;({ mask, W, H } = otsuMask(src, w, h, PPOCR_UPSCALE))
  }
  const out: PpOcrLine[] = []
  for (const line of groupLines(findBoxes(mask, W, H))) {
    let text = ''
    for (const g of splitGlyphs(mask, W, line)) {
      // glyph box (mask coords) -> raw crop coords for sampling
      const x0 = g.x0 / PPOCR_UPSCALE
      const y0 = g.y0 / PPOCR_UPSCALE
      const gw = (g.x1 - g.x0 + 1) / PPOCR_UPSCALE
      const gh = (g.y1 - g.y0 + 1) / PPOCR_UPSCALE
      const iw = Math.max(2, Math.round(gw))
      const ih = Math.max(2, Math.round(gh))
      const obs = new Float32Array(iw * ih)
      for (let y = 0; y < ih; y++) {
        for (let x = 0; x < iw; x++) {
          obs[y * iw + x] = sampleGray(src, w, h, x0 + (x + 0.5) * (gw / iw), y0 + (y + 0.5) * (gh / ih))
        }
      }
      let best = '?'
      let bestScore = MATCH_THRESHOLD
      for (const [char, list] of byChar) {
        for (const t of list) {
          const s = ncc(obs, resizeBilinear(t.g, t.w, t.h, iw, ih))
          if (s > bestScore) {
            bestScore = s
            best = char
          }
        }
      }
      text += best
    }
    if (text.length > 0) {
      out.push({ text, bbox: { x0: line.x0, y0: line.y0, x1: line.x1, y1: line.y1 } })
    }
  }
  return out
}
