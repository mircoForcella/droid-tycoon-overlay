// PP-OCRv5 passes (onnxruntime-node, offline).
// Segmentation order per frame:
//   1. teal-chroma mask + connected components (fast, exact on game frames)
//   2. DB text DETECTION on raw pixels (color-independent: survives washed-out
//      live thumbnails where the teal filter finds nothing)
// Recognition always reads RAW color strips via the rec model + greedy CTC.
// Boxes are returned in 2x mask coords (maskScale = PPOCR_UPSCALE) so the
// existing position math is untouched. Anything that throws (missing models,
// no native binding) must propagate — callers fall back to Tesseract.
// Never partially degrade.

import { app } from 'electron'
import { join } from 'path'
import { fileURLToPath } from 'url'

export interface PpOcrLine {
  text: string
  bbox: { x0: number; y0: number; x1: number; y1: number }
}

// Mask scale for the recognizer. Proven on shot1/shot2: at this scale
// PP-OCRv5 reads "92.80K/s" exactly where Tesseract dropped the 9.
export const PPOCR_UPSCALE = 2

const here = join(fileURLToPath(import.meta.url), '..')

function modelsBase(): string {
  if (app.isPackaged) return join(process.resourcesPath, 'ocr-models', 'ppocrv5')
  return join(here, '..', '..', 'ocr-models', 'ppocrv5')
}

interface OrtLike {
  Tensor: new (type: string, data: Float32Array, dims: number[]) => unknown
  InferenceSession: { create(path: string, opts?: object): Promise<OrtSession> }
}
interface OrtSession {
  inputNames: string[]
  outputNames: string[]
  run(feeds: Record<string, unknown>): Promise<Record<string, { data: Float32Array; dims: number[] }>>
}

let recPromise: Promise<{ ort: OrtLike; session: OrtSession; dict: string[] }> | null = null

async function getRecSession() {
  if (!recPromise) {
    recPromise = (async () => {
      // Dynamic import: a missing/broken native binding must throw HERE so
      // callers can fall back — never at main-process startup.
      const ort = (await Function('return import("onnxruntime-node")')()) as unknown as {
        default?: OrtLike
      } & OrtLike
      const o: OrtLike = ort.default ?? ort
      const base = modelsBase()
      const fs = await import('fs/promises')
      const rawDict = await fs.readFile(join(base, 'ppocrv5_dict.txt'), 'utf8')
      const dict = rawDict.split('\n').filter(s => s.length > 0)
      const session = await o.InferenceSession.create(join(base, 'rec', 'rec.onnx'), {
        logSeverityLevel: 3
      })
      return { ort: o, session, dict }
    })()
  }
  return recPromise
}

// Pre-load the recognizer + native binding (called ~10s after launch while
// idle). F9 must never pay first-use init. Safe to call repeatedly.
export async function warmup(): Promise<void> {
  await getRecSession()
}

// Fraction of teal pixels below which the mask is declared empty (wrong
// monitor, washed-out thumbnail). Game frames measure ~1%; a chat window
// leaves only specks (~0.01%). Callers fall back to Otsu in that case.
export const MIN_TEAL_INK = 0.001

export interface BinaryMask {
  mask: Uint8Array // 1 = ink (black), 0 = paper (white)
  W: number
  H: number
  ink: number // fraction of ink pixels
}

export function tealMask(src: Buffer, w: number, h: number, scale: number): BinaryMask {  const W = w * scale
  const H = h * scale
  const mask = new Uint8Array(W * H)
  let ink = 0
  for (let y = 0; y < H; y++) {
    const sy = Math.min(h - 1, (y / scale) | 0)
    for (let x = 0; x < W; x++) {
      const sx = Math.min(w - 1, (x / scale) | 0)
      const si = (sy * w + sx) * 4
      const r = src[si]
      const g = src[si + 1]
      const b = src[si + 2]
      const isText = g > 110 && g - r > 45 && b - r > 15
      mask[y * W + x] = isText ? 1 : 0
      ink += isText ? 1 : 0
    }
  }
  return { mask, W, H, ink: ink / (W * H) }
}

// Luminance Otsu fallback for frames with no teal (wrong monitor, odd
// thumbnail colors). Polarity follows the background: bright bg -> dark ink,
// dark bg (chat UI) -> bright text becomes the ink. Either way the engines
// get black-on-white instead of a blank page.
export function otsuMask(src: Buffer, w: number, h: number, scale: number): BinaryMask {
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
  let bright = 0
  for (let i = 0; i < n; i++) if (lum[i] > thresh) bright++
  const darkBg = bright / n <= 0.5
  const W = w * scale
  const H = h * scale
  const mask = new Uint8Array(W * H)
  let ink = 0
  for (let y = 0; y < H; y++) {
    const sy = Math.min(h - 1, (y / scale) | 0)
    for (let x = 0; x < W; x++) {
      const sx = Math.min(w - 1, (x / scale) | 0)
      const isInk = darkBg ? lum[sy * w + sx] > thresh : lum[sy * w + sx] <= thresh
      mask[y * W + x] = isInk ? 1 : 0
      ink += isInk ? 1 : 0
    }
  }
  return { mask, W, H, ink: ink / (W * H) }
}

interface Box {
  x0: number
  y0: number
  x1: number
  y1: number
}

export type { Box }

export function findBoxes(mask: Uint8Array, W: number, H: number): Box[] {
  const seen = new Uint8Array(W * H)
  const boxes: Box[] = []
  const stack: number[] = []
  for (let i = 0; i < W * H; i++) {
    if (!mask[i] || seen[i]) continue
    let x0 = W
    let y0 = H
    let x1 = -1
    let y1 = -1
    let area = 0
    stack.push(i)
    seen[i] = 1
    while (stack.length > 0) {
      const p = stack.pop() as number
      const x = p % W
      const y = (p / W) | 0
      if (x < x0) x0 = x
      if (x > x1) x1 = x
      if (y < y0) y0 = y
      if (y > y1) y1 = y
      area++
      if (x > 0 && mask[p - 1] && !seen[p - 1]) {
        seen[p - 1] = 1
        stack.push(p - 1)
      }
      if (x < W - 1 && mask[p + 1] && !seen[p + 1]) {
        seen[p + 1] = 1
        stack.push(p + 1)
      }
      if (y > 0 && mask[p - W] && !seen[p - W]) {
        seen[p - W] = 1
        stack.push(p - W)
      }
      if (y < H - 1 && mask[p + W] && !seen[p + W]) {
        seen[p + W] = 1
        stack.push(p + W)
      }
    }
    const w = x1 - x0 + 1
    const h = y1 - y0 + 1
    if (h >= 8 && w >= 3 && area >= 30) boxes.push({ x0, y0, x1, y1 })
  }
  return boxes
}

export function groupLines(boxes: Box[]): Box[] {
  const sorted = [...boxes].sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0)
  const lines: Array<Box & { cy: number }> = []
  for (const b of sorted) {
    const cy = (b.y0 + b.y1) / 2
    let ln: (Box & { cy: number }) | null = null
    for (const L of lines) {
      if (Math.abs(L.cy - cy) < 18) {
        ln = L
        break
      }
    }
    if (!ln) {
      ln = { x0: 1e9, y0: 1e9, x1: -1, y1: -1, cy: 0 }
      lines.push(ln)
    }
    ln.x0 = Math.min(ln.x0, b.x0)
    ln.y0 = Math.min(ln.y0, b.y0)
    ln.x1 = Math.max(ln.x1, b.x1)
    ln.y1 = Math.max(ln.y1, b.y1)
    ln.cy = (ln.y0 + ln.y1) / 2
  }
  return lines.filter(L => L.x1 - L.x0 >= 20)
}

// Bilinear render of a RAW COLOR patch to normalized NCHW-ready floats.
// The engines always read unprocessed pixels now: thresholding proved lossy
// on live thumbnails (washed teal -> blank page). The mask only decides
// WHERE to look (boxes), never what the text looks like.
// Box coords are in mask space (maskScale); src is the raw BGRA crop.
function renderStripColor(
  src: Buffer,
  srcW: number,
  srcH: number,
  maskScale: number,
  L: Box,
  outH: number,
  outW: number
): Float32Array {
  const pad = 6
  const mx0 = Math.max(0, L.x0 - pad)
  const my0 = Math.max(0, L.y0 - pad)
  const mx1 = L.x1 + pad
  const my1 = L.y1 + pad
  const mw = mx1 - mx0 + 1
  const mh = my1 - my0 + 1
  const sample = (gx: number, gy: number, ch: number): number => {
    const x = Math.max(0, Math.min(srcW - 1, gx))
    const y = Math.max(0, Math.min(srcH - 1, gy))
    const xA = Math.floor(x)
    const yA = Math.floor(y)
    const xB = Math.min(srcW - 1, xA + 1)
    const yB = Math.min(srcH - 1, yA + 1)
    const fx = x - xA
    const fy = y - yA
    const si = (yA * srcW + xA) * 4 + ch
    const v00 = src[si]
    const v10 = src[(yA * srcW + xB) * 4 + ch]
    const v01 = src[(yB * srcW + xA) * 4 + ch]
    const v11 = src[(yB * srcW + xB) * 4 + ch]
    return (v00 * (1 - fx) + v10 * fx) * (1 - fy) + (v01 * (1 - fx) + v11 * fx) * fy
  }
  const out = new Float32Array(3 * outH * outW)
  for (let y = 0; y < outH; y++) {
    for (let x = 0; x < outW; x++) {
      // Output pixel -> mask coords -> raw crop coords.
      const gx = ((mx0 + ((x + 0.5) * mw) / outW - 0.5) / maskScale)
      const gy = ((my0 + ((y + 0.5) * mh) / outH - 0.5) / maskScale)
      for (let c = 0; c < 3; c++) {
        out[(c * outH + y) * outW + x] = (sample(gx, gy, c) / 255 - 0.5) / 0.5
      }
    }
  }
  return out
}

function ctcDecode(logits: Float32Array, T: number, C: number, dict: string[]): string {
  let text = ''
  let prev = -1
  for (let s = 0; s < T; s++) {
    let best = 0
    let bv = -Infinity
    for (let c = 0; c < C; c++) {
      const v = logits[s * C + c]
      if (v > bv) {
        bv = v
        best = c
      }
    }
    if (best !== 0 && best !== prev) text += dict[best - 1] ?? ''
    prev = best
  }
  return text
}

/** Recognize income-text line strips in a raw BGRA crop. Throws on any failure. */
export async function recognizeLines(
  src: Buffer,
  w: number,
  h: number
): Promise<{ lines: PpOcrLine[]; ink: number; otsu: boolean }> {
  const { ort, session, dict } = await getRecSession()
  let { mask, W, H, ink } = tealMask(src, w, h, PPOCR_UPSCALE)
  let otsu = false
  if (ink < MIN_TEAL_INK) {
    // No teal (wrong monitor, washed-out thumbnail): Otsu instead of blank.
    ;({ mask, W, H } = otsuMask(src, w, h, PPOCR_UPSCALE))
    otsu = true
  }
  const lines = groupLines(findBoxes(mask, W, H))
  const out = await runStrips(ort, session, dict, src, w, h, lines)
  return { lines: out, ink, otsu }
}

// Shared recognizer: line boxes in 2x mask coords -> raw color strips -> texts.
async function runStrips(
  ort: OrtLike,
  session: OrtSession,
  dict: string[],
  src: Buffer,
  w: number,
  h: number,
  lines: Box[]
): Promise<PpOcrLine[]> {
  const inName = session.inputNames[0]
  const outName = session.outputNames[0]
  const out: PpOcrLine[] = []
  for (const L of lines) {
    const stripH = L.y1 - L.y0 + 1
    const stripW = L.x1 - L.x0 + 1
    const outW = Math.max(32, Math.min(960, Math.round((stripW * 48) / stripH)))
    // Raw color pixels: the mask only located the strip, the engine reads
    // the unprocessed game frame.
    const data = renderStripColor(src, w, h, PPOCR_UPSCALE, L, 48, outW)
    const feeds: Record<string, unknown> = {}
    feeds[inName] = new ort.Tensor('float32', data, [1, 3, 48, outW])
    const res = await session.run(feeds)
    const t = res[outName]
    const T = t.dims[1]
    const C = t.dims[2]
    const text = ctcDecode(t.data, T, C, dict)
    if (text.length > 0) {
      out.push({ text, bbox: { x0: L.x0, y0: L.y0, x1: L.x1, y1: L.y1 } })
    }
  }
  return out
}
