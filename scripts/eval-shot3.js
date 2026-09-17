// shot3 forensics: per-ROI scores at small scale (900x600 frame).
// Usage: node scripts/eval-shot3.js
const fs = require('fs')
const path = require('path')
const { PNG } = require('pngjs')
const CANON = 32, ASPECT_GATE = 0.15, CANON_GATE = 0.1, PPOCR_UPSCALE = 2
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
  let m = 0, u = 0
  for (let i = 0; i < CANON * CANON; i++) { if (a[i] || b[i]) { u++; if (a[i] !== b[i]) m++ } }
  return u === 0 ? 1 : m / u
}
function templateInk(data, w, h) {
  const ink = new Uint8Array(w * h)
  let ix0 = w, iy0 = h, ix1 = -1, iy1 = -1
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4, r = data[i], g = data[i + 1], b = data[i + 2]
    if (g > 110 && g - r > 45 && b - r > 15) {
      ink[y * w + x] = 1
      if (x < ix0) ix0 = x; if (x > ix1) ix1 = x
      if (y < iy0) iy0 = y; if (y > iy1) iy1 = y
    }
  }
  return { ink, ix0, iy0, ix1, iy1 }
}
const pool = (() => {
  const base = path.join(__dirname, '..', 'ocr-glyphs')
  const manifest = JSON.parse(fs.readFileSync(path.join(base, 'manifest.json'), 'utf8'))
  return manifest.map(m => {
    const p = PNG.sync.read(fs.readFileSync(path.join(base, m.file)))
    const { ink, ix0, iy0, ix1, iy1 } = templateInk(p.data, p.width, p.height)
    const tw = ix1 - ix0 + 1, th = iy1 - iy0 + 1
    return { char: m.char, file: m.file, aspect: tw / th, canon: canonicalize(ink, ix0, iy0, ix1, iy1, p.width) }
  })
})()
function tealMask(src, w, h, s) {
  const W = w * s, H = h * s, mask = new Uint8Array(W * H)
  for (let y = 0; y < H; y++) { const sy = Math.min(h - 1, (y / s) | 0)
    for (let x = 0; x < W; x++) { const sx = Math.min(w - 1, (x / s) | 0), si = (sy * w + sx) * 4
      mask[y * W + x] = (src[si + 1] > 110 && src[si + 1] - src[si] > 45 && src[si + 2] - src[si] > 15) ? 1 : 0 } }
  return { mask, W, H }
}
const img = PNG.sync.read(fs.readFileSync(path.join(__dirname, '..', 'shot3.png')))
console.log(`shot3 ${img.width}x${img.height}`)
// shot3 is already 900x600 so the harness crop is the full frame
const raw = Buffer.from(img.data)
const { mask, W, H } = tealMask(raw, img.width, img.height, PPOCR_UPSCALE)
let ink = 0
for (let i = 0; i < mask.length; i++) ink += mask[i]
console.log(`teal ink ${(100 * ink / mask.length).toFixed(3)}%`)
// Segment one strip box into ROIs and score each against the pool
function roisOf(box, label) {
  const counts = []
  for (let x = box.x0; x <= box.x1; x++) { let c = 0; for (let y = box.y0; y <= box.y1; y++) c += mask[y * W + x]; counts.push(c) }
  const segs = []
  let sx = -1
  const flush = (ex) => { if (sx >= 0 && ex - sx + 1 >= 6) segs.push({ x0: box.x0 + sx, x1: box.x0 + ex, y0: box.y0, y1: box.y1 }); sx = -1 }
  counts.forEach((c, i) => { if (c <= 3) flush(i - 1); else if (sx < 0) sx = i })
  flush(counts.length - 1)
  console.log(`\n${label}: ${segs.length} raw segs`)
  const out = []
  for (const g of segs) {
    let tx0 = g.x1, ty0 = g.y1, tx1 = g.x0, ty1 = g.y0
    for (let y = g.y0; y <= g.y1; y++) for (let x = g.x0; x <= g.x1; x++)
      if (mask[y * W + x]) { if (x < tx0) tx0 = x; if (x > tx1) tx1 = x; if (y < ty0) ty0 = y; if (y > ty1) ty1 = y }
    if (ty1 < ty0 || tx1 < tx0) continue
    const cx0 = tx0 >> 1, cy0 = ty0 >> 1, cx1 = tx1 >> 1, cy1 = ty1 >> 1
    const rw = cx1 - cx0 + 1, rh = cy1 - cy0 + 1
    const obs = new Uint8Array(rw * rh)
    for (let y = 0; y < rh; y++) for (let x = 0; x < rw; x++) obs[y * rw + x] = mask[(cy0 + y) * 2 * W + ((cx0 + x) * 2)] ? 1 : 0
    out.push({ w: rw, h: rh, aspect: rw / rh, canon: canonicalize(obs, 0, 0, rw - 1, rh - 1, rw) })
  }
  return out
}
for (const [box, label, truth] of [
  [{ x0: 830, y0: 422, x1: 1157, y1: 463 }, 'strip 115.20K/s', ['1', '1', '5', '.', '2', '0', 'K', '/s']],
  [{ x0: 686, y0: 842, x1: 1097, y1: 919 }, 'strip 13.70B', ['1', '3', '.', '7', '0', 'B']],
]) {
  const rs = roisOf(box, label)
  console.log(`truth ${truth.join(' ')} — ${rs.length} ROIs vs ${truth.length} chars`)
  rs.forEach((r, i) => {
    const rows = []
    for (const ch of [...new Set(pool.map(t => t.char))]) {
      let b = Infinity, bf = ''
      for (const t of pool.filter(t => t.char === ch)) {
        if (Math.abs(t.aspect - r.aspect) > ASPECT_GATE) continue
        const s = canonMismatch(t.canon, r.canon)
        if (s < b) { b = s; bf = t.file }
      }
      rows.push({ ch, b, bf })
    }
    rows.sort((a, b) => a.b - b.b)
    const top = rows.slice(0, 3).map(x => `'${x.ch}'=${x.b === Infinity ? 'GATED' : x.b.toFixed(3)}`).join(' ')
    const want = truth[i] || '?'
    console.log(`  ROI${i} ${r.w}x${r.h} asp=${r.aspect.toFixed(2)} truth='${want}' -> ${top} ${rows[0].ch === want && rows[0].b <= 0.10 ? 'OK' : 'FAIL'}`)
  })
}
