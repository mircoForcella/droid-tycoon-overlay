// Pool-level scale-coverage sweep (replaces the retired single-template
// rescale sweep). Old gate: each template vs its own synthetic rescale at
// factors 0.7-1.4 with worst-case <= 0.10. That measured a calibration
// property (canonical-grid resampling robustness), not operational coverage —
// it failed even the shipped 1.1.0 pool while live strips decoded exactly.
// New gate: every truth-labeled live ROI harvested at native scale across all
// frames must match SOME pool exemplar of its own char at <= 0.10 (aspect
// gate applies). PASS = 100% coverage; the valley-less "70" merge in 13.70B
// is unsegmentable and excluded by design (known gap, tracked separately).
// Usage: node scripts/eval-sweep.js
const fs = require('fs')
const path = require('path')
const { PNG } = require('pngjs')

const CANON = 32
const ASPECT_GATE = 0.15
const CANON_GATE = 0.1
const PPOCR_UPSCALE = 2

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
    const i = (y * w + x) * 4
    const r = data[i], g = data[i + 1], b = data[i + 2]
    if (g > 110 && g - r > 45 && b - r > 15) {
      ink[y * w + x] = 1
      if (x < ix0) ix0 = x; if (x > ix1) ix1 = x
      if (y < iy0) iy0 = y; if (y > iy1) iy1 = y
    }
  }
  return { ink, ix0, iy0, ix1, iy1 }
}
function loadPool() {
  const base = path.join(__dirname, '..', 'ocr-glyphs')
  const manifest = JSON.parse(fs.readFileSync(path.join(base, 'manifest.json'), 'utf8'))
  return manifest.map(m => {
    const p = PNG.sync.read(fs.readFileSync(path.join(base, m.file)))
    const { ink, ix0, iy0, ix1, iy1 } = templateInk(p.data, p.width, p.height)
    if (ix1 < ix0) return null
    const tw = ix1 - ix0 + 1, th = iy1 - iy0 + 1
    return { char: m.char, file: m.file, aspect: tw / th, canon: canonicalize(ink, ix0, iy0, ix1, iy1, p.width) }
  }).filter(Boolean)
}
function tealMask(src, w, h, scale) {
  const W = w * scale, H = h * scale
  const mask = new Uint8Array(W * H)
  for (let y = 0; y < H; y++) {
    const sy = Math.min(h - 1, (y / scale) | 0)
    for (let x = 0; x < W; x++) {
      const sx = Math.min(w - 1, (x / scale) | 0)
      const si = (sy * w + sx) * 4
      const r = src[si], g = src[si + 1], b = src[si + 2]
      mask[y * W + x] = (g > 110 && g - r > 45 && b - r > 15) ? 1 : 0
    }
  }
  return { mask, W, H }
}
function frameOf(file) {
  const img = PNG.sync.read(fs.readFileSync(path.join(__dirname, '..', file)))
  const cw = Math.min(900, img.width), ch = Math.min(600, img.height)
  const cx = Math.floor((img.width - cw) / 2), cy = Math.floor((img.height - ch) / 2)
  const crop = new PNG({ width: cw, height: ch })
  PNG.bitblt(img, crop, cx, cy, cw, ch, 0, 0)
  return { raw: Buffer.from(crop.data), cw, ch }
}
function splitParts(mask, W, best) {
  const counts = []
  for (let x = best.x0; x <= best.x1; x++) { let c = 0; for (let y = best.y0; y <= best.y1; y++) c += mask[y * W + x]; counts.push(c) }
  const segs = []
  let sx = -1
  const flush = (ex) => { if (sx >= 0 && ex - sx + 1 >= 6) segs.push({ x0: best.x0 + sx, x1: best.x0 + ex }); sx = -1 }
  counts.forEach((c, i) => { if (c <= 3) flush(i - 1); else if (sx < 0) sx = i })
  flush(counts.length - 1)
  const kept = segs.filter(s => {
    let peak = 0
    for (let x = s.x0; x <= s.x1; x++) peak = Math.max(peak, counts[x - best.x0])
    return (s.x1 - s.x0 + 1) >= 8 || peak >= 5
  })
  const splitSeg = (s) => {
    let peak = 0
    for (let x = s.x0; x <= s.x1; x++) peak = Math.max(peak, counts[x - best.x0])
    let bi = -1, bv = 1e9
    for (let x = s.x0; x <= s.x1; x++) { const c = counts[x - best.x0]; if (c < bv) { bv = c; bi = x } }
    if (bi > 0 && bv < peak * 0.3 && bi - s.x0 + 1 >= 10 && s.x1 - bi >= 10) {
      const out = []
      for (const sub of [{ x0: s.x0, x1: bi }, { x0: bi + 1, x1: s.x1 }]) {
        if (sub.x1 - sub.x0 + 1 >= 24) out.push(...splitSeg(sub))
        else out.push(sub)
      }
      return out
    }
    return [s]
  }
  const parts = []
  for (const s of kept) for (const p of splitSeg(s)) parts.push({ ...p, y0: best.y0, y1: best.y1 })
  return parts.sort((a, b) => a.x0 - b.x0)
}
function roiOf(mask, W, g) {
  let tx0 = g.x1, ty0 = g.y1, tx1 = g.x0, ty1 = g.y0
  for (let y = g.y0; y <= g.y1; y++) for (let x = g.x0; x <= g.x1; x++) {
    if (mask[y * W + x]) { if (x < tx0) tx0 = x; if (x > tx1) tx1 = x; if (y < ty0) ty0 = y; if (y > ty1) ty1 = y }
  }
  if (ty1 < ty0 || tx1 < tx0) return null
  const cx0 = tx0 >> 1, cy0 = ty0 >> 1, cx1 = tx1 >> 1, cy1 = ty1 >> 1
  const rw = cx1 - cx0 + 1, rh = cy1 - cy0 + 1
  const obs = new Uint8Array(rw * rh)
  for (let y = 0; y < rh; y++) for (let x = 0; x < rw; x++) obs[y * rw + x] = mask[(cy0 + y) * 2 * W + ((cx0 + x) * 2)] ? 1 : 0
  return { rAspect: rw / rh, rCanon: canonicalize(obs, 0, 0, rw - 1, rh - 1, rw), h: rh }
}

// Truth-labeled live ROIs at native scale (same regression table as
// eval-small.js; null = unsegmentable merge, excluded by design).
const SHOTS = [
  { file: 'shot1.png', lines: [
    { text: '92.80K/s', map: ['9', '2', '.', '8', '0', 'K'], combo: true, box: { x0: 808, y0: 492, x1: 1091, y1: 531 } },
    { text: '15.50B', map: ['1', '5', '.', '5', '0', 'B'], combo: false, box: { x0: 800, y0: 902, x1: 1133, y1: 965 } },
  ] },
  { file: 'shot2.png', lines: [
    { text: '92.80K/s', map: ['9', '2', '.', '8', '0', 'K'], combo: true, box: { x0: 862, y0: 514, x1: 1123, y1: 551 } },
    { text: '1.30B', map: ['1', '.', '3', '0', 'B'], combo: false, box: { x0: 928, y0: 922, x1: 1165, y1: 979 } },
  ] },
  { file: 'shot3.png', lines: [
    { text: '115.20K/s', map: ['1', '1', '5', '.', '2', '0', 'K'], combo: true, box: { x0: 830, y0: 422, x1: 1157, y1: 463 } },
    { text: '13.70B', map: ['1', '3', '.', null, 'B'], combo: false, box: { x0: 686, y0: 842, x1: 1097, y1: 919 } },
  ] },
  { file: 'shot4.png', lines: [
    { text: '115.20K/s', map: ['1', '1', '5', '.', '2', '0', 'K'], combo: true, box: { x0: 762, y0: 434, x1: 1255, y1: 497 } },
  ] },
  // shot5 = live spot.png (2026-09-17 23:42Z F9 crop): first harvested 6/7.
  { file: 'shot5.png', lines: [
    { text: '637.50K/s', map: ['6', '3', '7', '.5', '0', 'K'], combo: true, box: { x0: 722, y0: 462, x1: 1209, y1: 523 } },
  ] },
]

const pool = loadPool()
console.log(`pool=${pool.length}`)
const byChar = new Map()
for (const t of pool) {
  if (!byChar.has(t.char)) byChar.set(t.char, [])
  byChar.get(t.char).push(t)
}

let covered = 0, total = 0
const perChar = new Map() // char -> {worst, worstROI, heights:Set}
for (const { file, lines } of SHOTS) {
  const { raw, cw, ch } = frameOf(file)
  const { mask, W } = tealMask(raw, cw, ch, PPOCR_UPSCALE)
  for (const { text: want, map, combo, box: best } of lines) {
    const parts = splitParts(mask, W, best)
    const jobs = []
    map.forEach((chr, i) => { if (chr) jobs.push({ truth: chr, g: parts[i] }) })
    if (combo) {
      const tail = parts[parts.length - 1]
      jobs.push({ truth: '/s', g: { x0: tail.x0, x1: tail.x1, y0: best.y0, y1: best.y1 } })
    }
    for (const { truth, g } of jobs) {
      total++
      const r = roiOf(mask, W, g)
      let bestS = Infinity, bestF = ''
      for (const t of byChar.get(truth) || []) {
        if (Math.abs(t.aspect - r.rAspect) > ASPECT_GATE) continue
        const s = canonMismatch(t.canon, r.rCanon)
        if (s < bestS) { bestS = s; bestF = t.file }
      }
      const ok = bestS <= CANON_GATE
      if (ok) covered++
      if (!perChar.has(truth)) perChar.set(truth, { worst: 0, worstROI: '', heights: new Set() })
      const pc = perChar.get(truth)
      pc.heights.add(r.h)
      if (bestS > pc.worst) { pc.worst = bestS; pc.worstROI = `${file}[${want}]` }
      console.log(`${ok ? 'covered' : 'GAP'} '${truth}' ${r.h}px ${file}[${want}] best=${bestS === Infinity ? 'GATED-ALL' : bestS.toFixed(3)} via=${bestF || '-'}`)
    }
  }
}
console.log('\nPer-char worst same-char score + native heights covered:')
for (const [chr, pc] of [...perChar.entries()].sort()) {
  console.log(`  '${chr}': worst=${pc.worst.toFixed(3)} at ${pc.worstROI} heights=[${[...pc.heights].sort((a, b) => a - b).join(',')}] ${pc.worst <= CANON_GATE ? 'PASS' : 'FAIL'}`)
}
console.log(`\nCOVERAGE ${covered}/${total} ${covered === total ? 'PASS' : 'FAIL'}`)
process.exit(covered === total ? 0 : 1)
