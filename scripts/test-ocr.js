// Local OCR pipeline test: replicates src/main/ocr.ts + src/main/ppocr.ts exactly.
// Usage: node scripts/test-ocr.js <image.png>
const fs = require('fs')
const path = require('path')
const { PNG } = require('pngjs')
const { createWorker } = require('tesseract.js')

const PPOCR_UPSCALE = 2
const MIN_TEAL_INK = 0.001

// ---------- shared parsers (mirror ocr.ts) ----------
function parseIncomeText(text) {
  const m = text.toLowerCase().replace(/\/s\s*$/, '').trim().match(/^([\d.]+)\s*([kmbt])?$/)
  if (!m) return null
  const mult = m[2] === 'k' ? 1e3 : m[2] === 'm' ? 1e6 : m[2] === 'b' ? 1e9 : m[2] === 't' ? 1e12 : 1
  const v = parseFloat(m[1]) * mult
  return v > 0 ? v : null
}

function parseFuzzyIncome(text) {
  const m = text.trim().match(/^([\d.]+)\s*([kKmMbBtT])\s*[/lI17|]\s*[sS5]?$/)
  if (!m) return null
  const c = m[2].toLowerCase()
  const mult = c === 'k' ? 1e3 : c === 'm' ? 1e6 : c === 'b' ? 1e9 : 1e12
  const v = parseFloat(m[1]) * mult
  return v > 0 ? v : null
}

function extractSpots(lines, frame) {
  const spots = []
  const push = (raw, line) => {
    const value = parseIncomeText(raw) ?? parseFuzzyIncome(raw)
    if (value === null) return
    if (spots.some(s => Math.abs(s.value - value) / value < 0.001)) return
    const cx = (line.bbox.x0 + line.bbox.x1) / 2 / frame.upscale
    const cy = (line.bbox.y0 + line.bbox.y1) / 2 / frame.upscale
    spots.push({
      text: raw.trim(),
      value,
      rx: (frame.originX + cx) / frame.frameW,
      ry: (frame.originY + cy) / frame.frameH,
    })
  }
  for (const line of lines) {
    const strict = /([\d.]+\s*[kmbt]?\s*\/s)/gi
    let m, found = false
    while ((m = strict.exec(line.text)) !== null) { found = true; push(m[1], line) }
    const hasRateMarker = /\/\s*s\s*$/i.test(line.text) || /[/lI17|]\s*[sS5]\s*$/.test(line.text)
    if (!found && hasRateMarker && /[\d]/.test(line.text) && line.text.length < 24) push(line.text, line)
  }
  const dist2 = (s) => (s.rx - 0.5) * (s.rx - 0.5) + (s.ry - 0.5) * (s.ry - 0.5)
  return spots.sort((a, b) => dist2(a) - dist2(b) || a.value - b.value)
}

// ---------- pass 1: PP-OCRv5 (mirror ppocr.ts) ----------
function tealMask(src, w, h, scale) {
  const W = w * scale, H = h * scale
  const mask = new Uint8Array(W * H)
  let ink = 0
  for (let y = 0; y < H; y++) {
    const sy = Math.min(h - 1, (y / scale) | 0)
    for (let x = 0; x < W; x++) {
      const sx = Math.min(w - 1, (x / scale) | 0)
      const si = (sy * w + sx) * 4
      const r = src[si], g = src[si + 1], b = src[si + 2]
      const isText = (g > 110 && g - r > 45 && b - r > 15) ? 1 : 0
      mask[y * W + x] = isText
      ink += isText
    }
  }
  return { mask, W, H, ink: ink / (W * H) }
}

function otsuMask(src, w, h, scale) {
  const n = w * h
  const lum = new Uint8Array(n)
  for (let i = 0; i < n; i++) lum[i] = (src[i * 4] * 77 + src[i * 4 + 1] * 150 + src[i * 4 + 2] * 29) >> 8
  const hist = new Array(256).fill(0)
  for (let i = 0; i < n; i++) hist[lum[i]]++
  let sum = 0
  for (let t = 0; t < 256; t++) sum += t * hist[t]
  let sumB = 0, wB = 0, best = -1, thresh = 128
  for (let t = 0; t < 256; t++) {
    wB += hist[t]
    if (wB === 0) continue
    const wF = n - wB
    if (wF === 0) break
    sumB += t * hist[t]
    const mB = sumB / wB, mF = (sum - sumB) / wF
    const between = wB * wF * (mB - mF) * (mB - mF)
    if (between > best) { best = between; thresh = t }
  }
  let bright = 0
  for (let i = 0; i < n; i++) if (lum[i] > thresh) bright++
  const darkBg = bright / n <= 0.5
  const W = w * scale, H = h * scale
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

function findBoxes(mask, W, H) {
  const seen = new Uint8Array(W * H)
  const boxes = [], stack = []
  for (let i = 0; i < W * H; i++) {
    if (!mask[i] || seen[i]) continue
    let x0 = W, y0 = H, x1 = -1, y1 = -1, area = 0
    stack.push(i); seen[i] = 1
    while (stack.length) {
      const p = stack.pop(), x = p % W, y = (p / W) | 0
      if (x < x0) x0 = x; if (x > x1) x1 = x
      if (y < y0) y0 = y; if (y > y1) y1 = y
      area++
      if (x > 0 && mask[p - 1] && !seen[p - 1]) { seen[p - 1] = 1; stack.push(p - 1) }
      if (x < W - 1 && mask[p + 1] && !seen[p + 1]) { seen[p + 1] = 1; stack.push(p + 1) }
      if (y > 0 && mask[p - W] && !seen[p - W]) { seen[p - W] = 1; stack.push(p - W) }
      if (y < H - 1 && mask[p + W] && !seen[p + W]) { seen[p + W] = 1; stack.push(p + W) }
    }
    if ((y1 - y0 + 1) >= 8 && (x1 - x0 + 1) >= 3 && area >= 30) boxes.push({ x0, y0, x1, y1 })
  }
  return boxes
}

function groupLines(boxes) {
  const sorted = [...boxes].sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0)
  const lines = []
  for (const b of sorted) {
    const cy = (b.y0 + b.y1) / 2
    let ln = lines.find(L => Math.abs(((L.y0 + L.y1) / 2) - cy) < 18)
    if (!ln) { ln = { x0: 1e9, y0: 1e9, x1: -1, y1: -1 }; lines.push(ln) }
    ln.x0 = Math.min(ln.x0, b.x0); ln.y0 = Math.min(ln.y0, b.y0)
    ln.x1 = Math.max(ln.x1, b.x1); ln.y1 = Math.max(ln.y1, b.y1)
  }
  return lines.filter(L => (L.x1 - L.x0) >= 20)
}

function renderStripColor(src, srcW, srcH, maskScale, L, outH, outW) {
  const pad = 6
  const mx0 = Math.max(0, L.x0 - pad), my0 = Math.max(0, L.y0 - pad)
  const mx1 = L.x1 + pad, my1 = L.y1 + pad
  const mw = mx1 - mx0 + 1, mh = my1 - my0 + 1
  const sample = (gx, gy, ch) => {
    const x = Math.max(0, Math.min(srcW - 1, gx)), y = Math.max(0, Math.min(srcH - 1, gy))
    const xA = Math.floor(x), yA = Math.floor(y)
    const xB = Math.min(srcW - 1, xA + 1), yB = Math.min(srcH - 1, yA + 1)
    const fx = x - xA, fy = y - yA
    const v00 = src[(yA * srcW + xA) * 4 + ch], v10 = src[(yA * srcW + xB) * 4 + ch]
    const v01 = src[(yB * srcW + xA) * 4 + ch], v11 = src[(yB * srcW + xB) * 4 + ch]
    return (v00 * (1 - fx) + v10 * fx) * (1 - fy) + (v01 * (1 - fx) + v11 * fx) * fy
  }
  const out = new Float32Array(3 * outH * outW)
  for (let y = 0; y < outH; y++)
    for (let x = 0; x < outW; x++) {
      const gx = (mx0 + ((x + 0.5) * mw) / outW - 0.5) / maskScale
      const gy = (my0 + ((y + 0.5) * mh) / outH - 0.5) / maskScale
      for (let c = 0; c < 3; c++) out[(c * outH + y) * outW + x] = (sample(gx, gy, c) / 255 - 0.5) / 0.5
    }
  return out
}

async function ppocrLines(raw, cw, ch) {
  const ort = require('onnxruntime-node')
  const base = path.join(__dirname, '..', 'ocr-models', 'ppocrv5')
  const dict = fs.readFileSync(path.join(base, 'ppocrv5_dict.txt'), 'utf8').split('\n').filter(s => s.length > 0)
  const session = await ort.InferenceSession.create(path.join(base, 'rec', 'rec.onnx'), { logSeverityLevel: 3 })
  const inName = session.inputNames[0], outName = session.outputNames[0]
  const { mask, W, H } = (() => {
    const t = tealMask(raw, cw, ch, PPOCR_UPSCALE)
    if (t.ink < MIN_TEAL_INK) {
      console.log(`teal ink ${(t.ink * 100).toFixed(3)}% -> OTSU fallback`)
      return otsuMask(raw, cw, ch, PPOCR_UPSCALE)
    }
    console.log(`teal ink ${(t.ink * 100).toFixed(3)}%`)
    return t
  })()
  const out = []
  for (const L of groupLines(findBoxes(mask, W, H))) {
    const stripH = L.y1 - L.y0 + 1, stripW = L.x1 - L.x0 + 1
    const outW = Math.max(32, Math.min(960, Math.round(stripW * 48 / stripH)))
    const data = renderStripColor(raw, cw, ch, PPOCR_UPSCALE, L, 48, outW)
    const feeds = {}
    feeds[inName] = new ort.Tensor('float32', data, [1, 3, 48, outW])
    const res = await session.run(feeds)
    const t = res[outName], T = t.dims[1], C = t.dims[2]
    let text = '', prev = -1
    for (let s = 0; s < T; s++) {
      let best = 0, bv = -Infinity
      for (let c = 0; c < C; c++) { const v = t.data[s * C + c]; if (v > bv) { bv = v; best = c } }
      if (best !== 0 && best !== prev) text += dict[best - 1] ?? ''
      prev = best
    }
    if (text.length > 0) out.push({ text, bbox: { x0: L.x0, y0: L.y0, x1: L.x1, y1: L.y1 } })
  }
  return out
}

// ---------- pass 2: Tesseract fallback on RAW upscale (mirror ocr.ts) ----------
function upscaleRaw(src, w, h) {
  const scale = 2, W = w * scale, H = h * scale
  const png = new PNG({ width: W, height: H })
  for (let y = 0; y < H; y++) {
    const gy = (y + 0.5) / scale - 0.5
    const yA = Math.max(0, Math.min(h - 1, Math.floor(gy))), yB = Math.min(h - 1, yA + 1)
    const fy = Math.max(0, Math.min(1, gy - yA))
    for (let x = 0; x < W; x++) {
      const gx = (x + 0.5) / scale - 0.5
      const xA = Math.max(0, Math.min(w - 1, Math.floor(gx))), xB = Math.min(w - 1, xA + 1)
      const fx = Math.max(0, Math.min(1, gx - xA))
      const o = (y * W + x) * 4
      for (let c = 0; c < 3; c++) {
        const v00 = src[(yA * w + xA) * 4 + c], v10 = src[(yA * w + xB) * 4 + c]
        const v01 = src[(yB * w + xA) * 4 + c], v11 = src[(yB * w + xB) * 4 + c]
        png.data[o + c] = Math.round((v00 * (1 - fx) + v10 * fx) * (1 - fy) + (v01 * (1 - fx) + v11 * fx) * fy)
      }
      png.data[o + 3] = 255
    }
  }
  return PNG.sync.write(png)
}

(async () => {
  const imgPath = process.argv[2]
  const img = PNG.sync.read(fs.readFileSync(imgPath))
  console.log(`input ${img.width}x${img.height}`)
  const cw = Math.min(900, img.width), ch = Math.min(600, img.height)
  const cx = Math.floor((img.width - cw) / 2), cy = Math.floor((img.height - ch) / 2)
  const crop = new PNG({ width: cw, height: ch })
  PNG.bitblt(img, crop, cx, cy, cw, ch, 0, 0)
  const raw = Buffer.from(crop.data)
  console.log(`crop ${cw}x${ch} at ${cx},${cy}`)
  const frame = { frameW: img.width, frameH: img.height, originX: cx, originY: cy }

  // Pass 1: PP-OCRv5
  let lines = [], upscale = PPOCR_UPSCALE, pass = 'ppocr'
  try {
    const t0 = Date.now()
    lines = await ppocrLines(raw, cw, ch)
    console.log(`ppocr in=${Date.now() - t0}ms lines=${lines.length}`)
  } catch (e) {
    console.log('ppocr failed, falling back: ' + String(e.message || e).slice(0, 160))
    lines = []
  }
  let spots = extractSpots(lines, { ...frame, upscale })

  // Pass 2: Tesseract fallback on raw upscale when no usable spots
  if (spots.length === 0) {
    const cooked = upscaleRaw(raw, cw, ch)
    fs.writeFileSync(path.join(__dirname, '..', 'test-cooked.png'), cooked)
    const worker = await createWorker('eng')
    await worker.setParameters({
      tessedit_pageseg_mode: '6',
      tessedit_char_whitelist: '0123456789.KkMmBbTtSs/ ',
    })
    const t1 = Date.now()
    const { data } = await worker.recognize(cooked, {}, { blocks: true })
    console.log('tesseract in=' + (Date.now() - t1) + 'ms')
    lines = []
    for (const b of (data.blocks || [])) for (const p of (b.paragraphs || [])) for (const l of (p.lines || [])) lines.push(l)
    if (lines.length === 0 && (data.text || '').trim()) {
      const W = cw * 2, H = ch * 2
      for (const t of data.text.split('\n')) {
        if (t.trim().length === 0) continue
        lines.push({ text: t, bbox: { x0: 0, y0: 0, x1: W, y1: H } })
      }
    }
    await worker.terminate()
    upscale = 2
    pass = 'center-crop'
    spots = extractSpots(lines, { ...frame, upscale })
  }

  console.log(`pass=${pass} lines=` + lines.length)
  lines.slice(0, 15).forEach((l, i) => console.log('L' + i + ': ' + JSON.stringify(l.text) + ' bbox=' + JSON.stringify(l.bbox)))
  console.log('SPOTS=' + JSON.stringify(spots))
  spots.forEach((s, i) => {
    const d = Math.hypot(s.rx - 0.5, s.ry - 0.5)
    console.log(`rank${i}: ${s.text} = ${s.value} rx=${s.rx.toFixed(3)} ry=${s.ry.toFixed(3)} distCenter=${d.toFixed(3)}`)
  })
})().catch(e => { console.error('FATAL', e); process.exit(1) })
