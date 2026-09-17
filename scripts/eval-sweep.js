// Fair scale sweep: area-weighted (box-average) resample + rethreshold 0.5,
// i.e. the same sampling model canonicalize() itself uses and the closest
// proxy to GPU bilinear + teal threshold. Nearest-neighbor binary scaling
// aliases thin strokes and is NOT representative (documented in report).
// Usage: node scripts/eval-sweep.js
const fs = require('fs')
const path = require('path')
const { PNG } = require('pngjs')
const CANON = 32
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
// Area-weighted scale of a binary bbox by factor f (float coverage, then caller rethresholds at 0.5)
function scaleArea(ink, x0, y0, x1, y1, w, f) {
  const sw = x1 - x0 + 1, sh = y1 - y0 + 1
  const nw = Math.max(1, Math.round(sw * f)), nh = Math.max(1, Math.round(sh * f))
  const cov = new Float32Array(nw * nh)
  for (let oy = 0; oy < nh; oy++) {
    const yA = (oy * sh) / nh, yB = ((oy + 1) * sh) / nh
    for (let ox = 0; ox < nw; ox++) {
      const xA = (ox * sw) / nw, xB = ((ox + 1) * sw) / nw
      let sum = 0, area = 0
      const ya = Math.max(0, Math.floor(yA)), yb = Math.min(sh - 1, Math.ceil(yB) - 1)
      const xa = Math.max(0, Math.floor(xA)), xb = Math.min(sw - 1, Math.ceil(xB) - 1)
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
      cov[oy * nw + ox] = area > 0 ? sum / area : 0
    }
  }
  const out = new Uint8Array(nw * nh)
  for (let i = 0; i < cov.length; i++) out[i] = cov[i] >= 0.5 ? 1 : 0
  return { ink: out, w: nw, h: nh }
}
const base = path.join(__dirname, '..', 'ocr-glyphs')
const manifest = JSON.parse(fs.readFileSync(path.join(base, 'manifest.json'), 'utf8'))
const items = manifest.map(m => {
  const p = PNG.sync.read(fs.readFileSync(path.join(base, m.file)))
  return { file: m.file, char: m.char, ...templateInk(p.data, p.width, p.height), w: p.width }
}).filter(t => t.ix1 >= t.ix0)
for (const f of [0.7, 0.8, 0.9, 1.0, 1.1, 1.2, 1.3, 1.4]) {
  let worst = 0, worstFile = '', rows = []
  for (const t of items) {
    const orig = canonicalize(t.ink, t.ix0, t.iy0, t.ix1, t.iy1, t.w)
    const sc = scaleArea(t.ink, t.ix0, t.iy0, t.ix1, t.iy1, t.w, f)
    const rc = canonicalize(sc.ink, 0, 0, sc.w - 1, sc.h - 1, sc.w)
    const mm = canonMismatch(orig, rc)
    rows.push({ f: t.file, mm })
    if (mm > worst) { worst = mm; worstFile = t.file }
  }
  rows.sort((a, b) => b.mm - a.mm)
  console.log(`f=${f.toFixed(1)} worst=${worst.toFixed(3)} (${worstFile}) ${worst <= 0.10 ? 'PASS' : 'FAIL'} | top3: ${rows.slice(0, 3).map(r => `${r.f}=${r.mm.toFixed(3)}`).join(', ')}`)
}
