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
function tealMask(src, w, h, scale) {  const W = w * scale, H = h * scale
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

// ---------- glyph template pass (mirror glyphs.ts) ----------
const CANON = 32
const ASPECT_GATE = 0.15
const CANON_GATE = 0.1
function canonicalize(ink, x0, y0, x1, y1, w) {
  const sw = x1 - x0 + 1, sh = y1 - y0 + 1
  const out = new Uint8Array(CANON * CANON)
  for (let oy = 0; oy < CANON; oy++) {
    const yA = (oy * sh) / CANON, yB = ((oy + 1) * sh) / CANON
    const ya = Math.max(0, Math.floor(yA)), yb = Math.min(sh - 1, Math.ceil(yB) - 1)
    for (let ox = 0; ox < CANON; ox++) {
      const xA = (ox * sw) / CANON, xB = ((ox + 1) * sw) / CANON
      const xa = Math.max(0, Math.floor(xA)), xb = Math.min(sw - 1, Math.ceil(xB) - 1)
      let sum = 0, area = 0
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
function canonMismatch(a, b) {
  let mismatch = 0, union = 0
  for (let i = 0; i < CANON * CANON; i++) {
    if (a[i] || b[i]) { union++; if (a[i] !== b[i]) mismatch++ }
  }
  return union === 0 ? 1 : mismatch / union
}
function templateInk(data, w, h) {
  const ink = new Uint8Array(w * h)
  let ix0 = w, iy0 = h, ix1 = -1, iy1 = -1
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4
    const r = data[i], g = data[i + 1], b = data[i + 2]
    const hit = g > 110 && g - r > 45 && b - r > 15
    if (hit) {
      ink[y * w + x] = 1
      if (x < ix0) ix0 = x; if (x > ix1) ix1 = x
      if (y < iy0) iy0 = y; if (y > iy1) iy1 = y
    }
  }
  return { ink, ix0, iy0, ix1, iy1 }
}
let _glyphs = null
function loadGlyphs() {
  if (_glyphs) return _glyphs
  const base = path.join(__dirname, '..', 'ocr-glyphs')
  const manifest = JSON.parse(fs.readFileSync(path.join(base, 'manifest.json'), 'utf8'))
  const byChar = new Map()
  for (const m of manifest) {
    const p = PNG.sync.read(fs.readFileSync(path.join(base, m.file)))
    const { ink, ix0, iy0, ix1, iy1 } = templateInk(p.data, p.width, p.height)
    if (ix1 < ix0) continue
    // luminance kept for NCC diagnostics only (never the gate)
    const n = p.width * p.height
    const lum = new Float32Array(n)
    for (let i = 0; i < n; i++) lum[i] = (p.data[i * 4] + p.data[i * 4 + 1] + p.data[i * 4 + 2]) / 3
    const tw = ix1 - ix0 + 1, th = iy1 - iy0 + 1
    if (!byChar.has(m.char)) byChar.set(m.char, [])
    byChar.get(m.char).push({
      char: m.char, aspect: tw / th, canon: canonicalize(ink, ix0, iy0, ix1, iy1, p.width), lum,
      w: p.width, h: p.height, file: m.file,
    })
  }
  if (byChar.size === 0) throw new Error('no glyph templates')
  _glyphs = byChar
  return byChar
}
function resizeGray(g, w, h, W, H) {
  const out = new Float32Array(W * H)
  for (let y = 0; y < H; y++) {
    const sy = Math.min(h - 1, Math.max(0, (y + 0.5) * h / H - 0.5))
    const yA = Math.floor(sy), yB = Math.min(h - 1, yA + 1), fy = sy - yA
    for (let x = 0; x < W; x++) {
      const sx = Math.min(w - 1, Math.max(0, (x + 0.5) * w / W - 0.5))
      const xA = Math.floor(sx), xB = Math.min(w - 1, xA + 1), fx = sx - xA
      out[y * W + x] =
        (g[yA * w + xA] * (1 - fx) + g[yA * w + xB] * fx) * (1 - fy) +
        (g[yB * w + xA] * (1 - fx) + g[yB * w + xB] * fx) * fy
    }
  }
  return out
}
function ncc(a, b) {
  const n = a.length
  let ma = 0, mb = 0
  for (let i = 0; i < n; i++) { ma += a[i]; mb += b[i] }
  ma /= n; mb /= n
  let sab = 0, saa = 0, sbb = 0
  for (let i = 0; i < n; i++) { const da = a[i] - ma, db = b[i] - mb; sab += da * db; saa += da * da; sbb += db * db }
  if (saa < 1e-9 || sbb < 1e-9) return -1
  return sab / Math.sqrt(saa * sbb)
}
function splitGlyphs(mask, W, line) {
  const counts = []
  for (let x = line.x0; x <= line.x1; x++) {
    let c = 0
    for (let y = line.y0; y <= line.y1; y++) c += mask[y * W + x]
    counts.push(c)
  }
  const segs = []
  let sx = -1
  const flush = (ex) => {
    if (sx >= 0 && ex - sx + 1 >= 6) segs.push({ x0: line.x0 + sx, x1: line.x0 + ex, y0: line.y0, y1: line.y1 })
    sx = -1
  }
  counts.forEach((c, i) => { if (c <= 3) flush(i - 1); else if (sx < 0) sx = i })
  flush(counts.length - 1)
  const kept = segs.filter(s => {
    let peak = 0
    for (let x = s.x0; x <= s.x1; x++) peak = Math.max(peak, counts[x - line.x0])
    return s.x1 - s.x0 + 1 >= 8 || peak >= 5
  })
  const splitSeg = (s) => {
    let peak = 0
    for (let x = s.x0; x <= s.x1; x++) peak = Math.max(peak, counts[x - line.x0])
    let bi = -1, bv = Infinity
    for (let x = s.x0; x <= s.x1; x++) { const c = counts[x - line.x0]; if (c < bv) { bv = c; bi = x } }
    if (bi > 0 && bv < peak * 0.3 && bi - s.x0 + 1 >= 10 && s.x1 - bi >= 10) {
      const out = []
      for (const sub of [{ x0: s.x0, x1: bi }, { x0: bi + 1, x1: s.x1 }]) {
        if (sub.x1 - sub.x0 + 1 >= 24) out.push(...splitSeg({ ...sub, y0: s.y0, y1: s.y1 }))
        else out.push({ ...sub, y0: s.y0, y1: s.y1 })
      }
      return out
    }
    return [s]
  }
  const parts = []
  for (const s of kept) for (const p of splitSeg(s)) parts.push(p)
  return parts.sort((a, b) => a.x0 - b.x0)
}
function matchGlyphLines(raw, cw, ch) {
  const byChar = loadGlyphs()
  const stats = { comparisons: 0, aspectSkipped: 0 }
  const decode = (m) => {
    const out = []
    for (const line of groupLines(findBoxes(m.mask, m.W, m.H))) {
      let text = ''
      for (const gbox of splitGlyphs(m.mask, m.W, line)) {
      // Mask-space ink bbox -> stride-2 exact downsample (the 2x mask
      // replicates raw pixels; no interpolation) -> crop-space compare.
      let tx0 = gbox.x1, ty0 = gbox.y1, tx1 = gbox.x0, ty1 = gbox.y0
      for (let y = gbox.y0; y <= gbox.y1; y++) {
        for (let x = gbox.x0; x <= gbox.x1; x++) {
          if (m.mask[y * m.W + x]) {
            if (x < tx0) tx0 = x; if (x > tx1) tx1 = x
            if (y < ty0) ty0 = y; if (y > ty1) ty1 = y
          }
        }
      }
      if (ty1 < ty0 || tx1 < tx0) continue
      const cx0 = tx0 >> 1, cy0 = ty0 >> 1, cx1 = tx1 >> 1, cy1 = ty1 >> 1
      const cw2 = cx1 - cx0 + 1, ch2 = cy1 - cy0 + 1
      const obs = new Uint8Array(cw2 * ch2)
      for (let y = 0; y < ch2; y++) for (let x = 0; x < cw2; x++) {
        obs[y * cw2 + x] = m.mask[(cy0 + y) * 2 * m.W + ((cx0 + x) * 2)] ? 1 : 0
      }
      const rAspect = cw2 / ch2
      const rCanon = canonicalize(obs, 0, 0, cw2 - 1, ch2 - 1, cw2)
      let best = '?', bs = CANON_GATE
      for (const [ch, list] of byChar) {
        let charBest = Infinity
        for (const t of list) {
          if (Math.abs(t.aspect - rAspect) > ASPECT_GATE) { stats.aspectSkipped++; continue }
          stats.comparisons++
          const s = canonMismatch(t.canon, rCanon)
          if (s < charBest) charBest = s
        }
        if (charBest < bs) { bs = charBest; best = ch }
      }
      text += best
    }
      if (text.length > 0) out.push({ text, bbox: { x0: line.x0, y0: line.y0, x1: line.x1, y1: line.y1 } })
    }
    return out
  }
  const lines = []
  const teal = tealMask(raw, cw, ch, PPOCR_UPSCALE)
  if (teal.ink >= MIN_TEAL_INK) lines.push(...decode(teal))
  const sorted = lines.sort((a, b) => a.bbox.y0 - b.bbox.y0 || a.bbox.x0 - b.bbox.x0)
  console.log(`glyph stats cmp=${stats.comparisons} aspectSkip=${stats.aspectSkipped}`)
  return sorted
}
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

  // Scope-split mirror of src/main/ocr.ts. GLYPH_EXCLUDE=0 restores legacy
  // order (PP-OCR -> glyphs-if-empty -> Tesseract-if-empty).
  const splitOff = process.env.GLYPH_EXCLUDE === '0'
  const claimedBoxes = (glyphLines) => {
    const claimed = []
    for (const line of glyphLines) {
      let ok = false
      const strict = /([\d.]+\s*[kmbt]?\s*\/s)/gi
      let m
      while ((m = strict.exec(line.text)) !== null) {
        if (parseIncomeText(m[1]) !== null) { ok = true; break }
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
  const excludeClaimed = (ls, claimed) => {
    if (claimed.length === 0) return { kept: ls, dropped: 0 }
    const kept = []
    let dropped = 0
    for (const l of ls) {
      const cx = (l.bbox.x0 + l.bbox.x1) / 2, cy = (l.bbox.y0 + l.bbox.y1) / 2
      if (claimed.some(b => cx >= b.x0 && cx <= b.x1 && cy >= b.y0 && cy <= b.y1)) dropped++
      else kept.push(l)
    }
    return { kept, dropped }
  }
  const mergeSpots = (first, second) => {
    const out = [...first]
    for (const s of second) {
      if (!out.some(k => Math.abs(k.value - s.value) / s.value < 0.001)) out.push(s)
    }
    const dist2 = (s) => (s.rx - 0.5) * (s.rx - 0.5) + (s.ry - 0.5) * (s.ry - 0.5)
    return out.sort((a, b) => dist2(a) - dist2(b) || a.value - b.value)
  }

  let lines = [], upscale = PPOCR_UPSCALE, pass = splitOff ? 'ppocr' : 'glyphs'
  let claimed = [], glyphLines = [], glyphSpots = []
  if (splitOff) {
    // Legacy order
    try {
      const t0 = Date.now()
      lines = await ppocrLines(raw, cw, ch)
      console.log(`${pass} in=${Date.now() - t0}ms lines=${lines.length}`)
    } catch (e) {
      console.log('ppocr failed, falling back: ' + String(e.message || e).slice(0, 160))
      lines = []
    }
    var spots = extractSpots(lines, { ...frame, upscale })

    if (spots.length === 0) {
      try {
        const t0 = Date.now()
        lines = matchGlyphLines(raw, cw, ch)
        pass = 'glyphs'
        console.log(`glyphs in=${Date.now() - t0}ms lines=${lines.length}`)
      } catch (e) {
        console.log('glyphs failed: ' + String(e.message || e).slice(0, 120))
        lines = []
      }
      spots = extractSpots(lines, { ...frame, upscale })
    }
  } else {
    // Pass 1 (Class I): glyph matcher on color-keyed regions
    try {
      const t0 = Date.now()
      glyphLines = matchGlyphLines(raw, cw, ch)
      console.log(`glyphs in=${Date.now() - t0}ms lines=${glyphLines.length}`)
    } catch (e) {
      console.log('glyphs failed: ' + String(e.message || e).slice(0, 120))
      glyphLines = []
    }
    glyphSpots = extractSpots(glyphLines, { ...frame, upscale })
    claimed = claimedBoxes(glyphLines)
    console.log(`glyphs claimed=${claimed.length} spots=${glyphSpots.length}`)

    // Pass 2 (Class U + backup): PP-OCRv5 minus claimed regions
    let ppLines = []
    try {
      const t0 = Date.now()
      ppLines = await ppocrLines(raw, cw, ch)
      const { kept, dropped } = excludeClaimed(ppLines, claimed)
      console.log(`ppocr in=${Date.now() - t0}ms lines=${ppLines.length} excluded=${dropped} kept=${kept.length}`)
      ppLines = kept
    } catch (e) {
      console.log('ppocr failed: ' + String(e.message || e).slice(0, 160))
      ppLines = []
    }
    const ppSpots = extractSpots(ppLines, { ...frame, upscale })
    var spots = mergeSpots(glyphSpots, ppSpots)
    lines = [...glyphLines, ...ppLines]
    pass = glyphSpots.length > 0 ? (ppSpots.length > 0 ? 'glyphs+ppocr' : 'glyphs') : 'ppocr'
  }

  // Pass 3: Tesseract fallback on raw upscale when no usable spots
  if (spots.length === 0) {
    const cooked = upscaleRaw(raw, cw, ch)
    fs.writeFileSync(path.join(__dirname, '..', 'test-cooked.png'), cooked)
    const worker = await createWorker('eng')
    await worker.setParameters({
      tessedit_pageseg_mode: '6',
      tessedit_char_whitelist: '0123456789.KkMmBbTtSs/ ',
    })
    const t1 = Date.now()
    // Mirror ocr.ts: hard-timeout the fallback (live proved 30-47s grinds).
    let data = null
    try {
      const res = await Promise.race([
        worker.recognize(cooked, {}, { blocks: true }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('tesseract-timeout')), 12000)),
      ])
      data = res.data
    } catch (e) {
      console.log('tesseract ' + String((e && e.message) || e).slice(0, 60) + ' — fallback skipped')
    }
    console.log('tesseract in=' + (Date.now() - t1) + 'ms')
    lines = []
    for (const b of ((data && data.blocks) || [])) for (const p of (b.paragraphs || [])) for (const l of (p.lines || [])) lines.push(l)
    if (lines.length === 0 && ((data && data.text) || '').trim()) {
      const W = cw * 2, H = ch * 2
      for (const t of data.text.split('\n')) {
        if (t.trim().length === 0) continue
        lines.push({ text: t, bbox: { x0: 0, y0: 0, x1: W, y1: H } })
      }
    }
    await worker.terminate()
    upscale = 2
    if (!splitOff && claimed.length > 0) {
      const { kept, dropped } = excludeClaimed(lines, claimed)
      console.log(`tesseract excluded=${dropped} kept=${kept.length}`)
      lines = [...glyphLines, ...kept]
      pass = `${pass}+center-crop`
      spots = mergeSpots(glyphSpots, extractSpots(kept, { ...frame, upscale }))
    } else {
      pass = 'center-crop'
      spots = extractSpots(lines, { ...frame, upscale })
    }
  }

  console.log(`pass=${pass} lines=` + lines.length)
  lines.slice(0, 15).forEach((l, i) => console.log('L' + i + ': ' + JSON.stringify(l.text) + ' bbox=' + JSON.stringify(l.bbox)))
  console.log('SPOTS=' + JSON.stringify(spots))
  spots.forEach((s, i) => {
    const d = Math.hypot(s.rx - 0.5, s.ry - 0.5)
    console.log(`rank${i}: ${s.text} = ${s.value} rx=${s.rx.toFixed(3)} ry=${s.ry.toFixed(3)} distCenter=${d.toFixed(3)}`)
  })
})().catch(e => { console.error('FATAL', e); process.exit(1) })
