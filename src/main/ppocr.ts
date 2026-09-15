// PP-OCRv5 recognition pass (onnxruntime-node, offline).
// The teal-chroma mask already segments income text far better than any
// generic detector on this 3D background, so we skip text DETECTION entirely:
// connected components on the mask -> line strips -> PP-OCRv5 rec model ->
// greedy CTC decode. Returns OcrLine-compatible boxes in mask coords.
// Anything that throws (missing models, no native binding) must propagate —
// callers fall back to the Tesseract pass. Never partially degrade.

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

let sessionPromise: Promise<{ ort: OrtLike; session: OrtSession; dict: string[] }> | null = null

async function getSession() {
  if (!sessionPromise) {
    sessionPromise = (async () => {
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
  return sessionPromise
}

function tealMask(src: Buffer, w: number, h: number): { mask: Uint8Array; W: number; H: number } {
  const scale = PPOCR_UPSCALE
  const W = w * scale
  const H = h * scale
  const mask = new Uint8Array(W * H)
  for (let y = 0; y < H; y++) {
    const sy = Math.min(h - 1, (y / scale) | 0)
    for (let x = 0; x < W; x++) {
      const sx = Math.min(w - 1, (x / scale) | 0)
      const si = (sy * w + sx) * 4
      const r = src[si]
      const g = src[si + 1]
      const b = src[si + 2]
      mask[y * W + x] = g > 110 && g - r > 45 && b - r > 15 ? 1 : 0
    }
  }
  return { mask, W, H }
}

interface Box {
  x0: number
  y0: number
  x1: number
  y1: number
}

function findBoxes(mask: Uint8Array, W: number, H: number): Box[] {
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

function groupLines(boxes: Box[]): Box[] {
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

// Bilinear render of a mask patch to Float32 HxW ink map (1 = ink).
function renderStrip(
  mask: Uint8Array,
  W: number,
  H: number,
  L: Box,
  outH: number,
  outW: number
): Float32Array {
  const pad = 6
  const x0 = Math.max(0, L.x0 - pad)
  const y0 = Math.max(0, L.y0 - pad)
  const x1 = Math.min(W - 1, L.x1 + pad)
  const y1 = Math.min(H - 1, L.y1 + pad)
  const sw = x1 - x0 + 1
  const sh = y1 - y0 + 1
  const out = new Float32Array(outH * outW)
  for (let y = 0; y < outH; y++) {
    const sy = ((y + 0.5) * sh) / outH - 0.5
    const yA = Math.max(0, Math.min(sh - 1, Math.floor(sy)))
    const yB = Math.min(sh - 1, yA + 1)
    const fy = Math.max(0, Math.min(1, sy - Math.floor(sy)))
    for (let x = 0; x < outW; x++) {
      const sx = ((x + 0.5) * sw) / outW - 0.5
      const xA = Math.max(0, Math.min(sw - 1, Math.floor(sx)))
      const xB = Math.min(sw - 1, xA + 1)
      const fx = Math.max(0, Math.min(1, sx - Math.floor(sx)))
      const v00 = mask[(y0 + yA) * W + (x0 + xA)]
      const v10 = mask[(y0 + yA) * W + (x0 + xB)]
      const v01 = mask[(y0 + yB) * W + (x0 + xA)]
      const v11 = mask[(y0 + yB) * W + (x0 + xB)]
      out[y * outW + x] = (v00 * (1 - fx) + v10 * fx) * (1 - fy) + (v01 * (1 - fx) + v11 * fx) * fy
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
export async function recognizeLines(src: Buffer, w: number, h: number): Promise<PpOcrLine[]> {
  const { ort, session, dict } = await getSession()
  const { mask, W, H } = tealMask(src, w, h)
  const lines = groupLines(findBoxes(mask, W, H))
  const inName = session.inputNames[0]
  const outName = session.outputNames[0]
  const out: PpOcrLine[] = []
  for (const L of lines) {
    const stripH = L.y1 - L.y0 + 1
    const stripW = L.x1 - L.x0 + 1
    const outW = Math.max(32, Math.min(960, Math.round((stripW * 48) / stripH)))
    const gray = renderStrip(mask, W, H, L, 48, outW)
    const data = new Float32Array(3 * 48 * outW)
    for (let c = 0; c < 3; c++) {
      for (let y = 0; y < 48; y++) {
        for (let x = 0; x < outW; x++) {
          data[(c * 48 + y) * outW + x] = (gray[y * outW + x] - 0.5) / 0.5
        }
      }
    }
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
