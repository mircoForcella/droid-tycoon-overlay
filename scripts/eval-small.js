// Small-scale admission eval: verify the 20 shot3/shot4 harvests already in the
// pool (54 entries) under the variant protocol — utility per new exemplar,
// confusion (fails / new-steals / margins) over all regression ROIs, and
// full-frame exact-decode on all 4 frames.
// Usage: node scripts/eval-small.js
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
    if (ix1 < ix0) return { char: m.char, file: m.file, blank: true, isNew: /shot[34]/.test(m.file) }
    const tw = ix1 - ix0 + 1, th = iy1 - iy0 + 1
    return { char: m.char, file: m.file, aspect: tw / th, canon: canonicalize(ink, ix0, iy0, ix1, iy1, p.width), isNew: /shot[34]/.test(m.file) }
  })
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
  return { rAspect: rw / rh, rCanon: canonicalize(obs, 0, 0, rw - 1, rh - 1, rw), w: rw, h: rh }
}
function classify(pool, rAspect, rCanon) {
  const perChar = new Map()
  for (const t of pool) {
    if (!t.canon) continue
    if (Math.abs(t.aspect - rAspect) > ASPECT_GATE) continue
    const s = canonMismatch(t.canon, rCanon)
    const e = perChar.get(t.char)
    if (!e || s < e.score) perChar.set(t.char, { score: s, file: t.file, isNew: t.isNew })
  }
  const ranked = [...perChar.entries()].sort((a, b) => a[1].score - b[1].score)
  if (ranked.length === 0) return { best: '?', bestScore: Infinity, margin: 0, winnerFile: null, winnerNew: false }
  const [bc, b] = ranked[0]
  if (b.score > CANON_GATE) return { best: '?', bestScore: b.score, margin: 0, winnerFile: b.file, winnerNew: b.isNew }
  const margin = ranked.length > 1 ? ranked[1][1].score - b.score : 1 - b.score
  return { best: bc, bestScore: b.score, margin, winnerFile: b.file, winnerNew: b.isNew }
}

// Regression strips: shot1/shot2 legacy `use` + shot3/shot4 explicit `map`
// (null = valley-less merged part, skipped by design) + /s combo tails.
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
  // shot5 = live spot.png (2026-09-17 23:42Z F9 crop): PP-OCR reads 637.50K/s
  // exact. Dot+5 touch valley-less (null-skip); first harvested 6 and 7.
  { file: 'shot5.png', lines: [
    { text: '637.50K/s', map: ['6', '3', '7', '.5', '0', 'K'], combo: true, box: { x0: 722, y0: 462, x1: 1209, y1: 523 } },
  ] },
]

const pool = loadPool()
const isNew = (f) => /shot[34]/.test(f)
console.log(`pool=${pool.length} new=${pool.filter(t => t.isNew).length}`)

// ---- per-ROI classification over every regression strip ----
const rois = []
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
    jobs.forEach(({ truth, g }, i) => {
      if (!g) { rois.push({ frame: file, strip: want, truth, best: 'MISSING-PART', bestScore: Infinity, margin: 0 }); return }
      const r = roiOf(mask, W, g)
      if (!r) { rois.push({ frame: file, strip: want, truth, best: 'NO-INK', bestScore: Infinity, margin: 0 }); return }
      const c = classify(pool, r.rAspect, r.rCanon)
      rois.push({ frame: file, strip: want, truth, ...c, w: r.w, h: r.h })
    })
  }
}
let fails = 0, newSteals = 0, minMargin = Infinity
const winsByFile = {}, stealsByFile = {}
for (const r of rois) {
  const ok = r.best === r.truth
  if (!ok) fails++
  else {
    if (r.margin < minMargin) minMargin = r.margin
    if (r.winnerNew) winsByFile[r.winnerFile] = (winsByFile[r.winnerFile] || 0) + 1
  }
  if (r.winnerNew && !ok && r.best !== '?') {
    newSteals++
    stealsByFile[r.winnerFile] = (stealsByFile[r.winnerFile] || 0) + 1
  }
  const flag = ok ? (r.margin < 0.05 ? ' THIN' : ' OK') : ' FAIL'
  console.log(`${ok ? 'ok ' : 'FAIL'} ${r.frame} [${r.strip}] truth='${r.truth}' got='${r.best}' score=${r.bestScore === Infinity ? 'inf' : r.bestScore.toFixed(3)} margin=${r.margin.toFixed(3)} via=${r.winnerFile || '-'}${r.winnerNew ? ' (NEW)' : ''}${flag}`)
}
console.log(`\nCONFUSION fails=${fails}/${rois.length} new-steals=${newSteals} minMarginOnCorrect=${minMargin === Infinity ? 'n/a' : minMargin.toFixed(3)}`)

// ---- utility per new exemplar: which ROIs does it win, and did it fix a FAIL? ----
console.log('\nUTILITY per new exemplar (wins on correct ROIs):')
for (const t of pool.filter(t => t.isNew && !t.blank)) {
  const w = winsByFile[t.file] || 0
  const s = stealsByFile[t.file] || 0
  console.log(`  ${t.char} ${t.file}: wins=${w} steals=${s} ${w > 0 && s === 0 ? 'KEEP' : (w === 0 ? 'NO-WINS?' : 'REVIEW')}`)
}
// new files that never win anything are dead weight — list for removal review
const dead = pool.filter(t => t.isNew && !t.blank && !winsByFile[t.file] && !stealsByFile[t.file]).map(t => t.file)
console.log(`\nDEAD (never wins, never steals): ${dead.length ? dead.join(', ') : 'none'}`)

// ---- full-frame exact decode on all 4 frames ----
function decodeFrame(imgPath) {
  const { raw, cw, ch } = frameOf(imgPath)
  const { mask, W, H } = tealMask(raw, cw, ch, PPOCR_UPSCALE)
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
  const sorted = [...boxes].sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0)
  const lines = []
  for (const b of sorted) {
    const cy = (b.y0 + b.y1) / 2
    let ln = lines.find(L => Math.abs(((L.y0 + L.y1) / 2) - cy) < 18)
    if (!ln) { ln = { x0: 1e9, y0: 1e9, x1: -1, y1: -1 }; lines.push(ln) }
    ln.x0 = Math.min(ln.x0, b.x0); ln.y0 = Math.min(ln.y0, b.y0)
    ln.x1 = Math.max(ln.x1, b.x1); ln.y1 = Math.max(ln.y1, b.y1)
  }
  const out = []
  for (const line of lines.filter(L => (L.x1 - L.x0) >= 20)) {
    let text = ''
    for (const gbox of splitParts(mask, W, line)) {
      const r = roiOf(mask, W, gbox)
      if (!r) continue
      text += classify(pool, r.rAspect, r.rCanon).best
    }
    if (text.length > 0) out.push(text)
  }
  return out
}
console.log('\nFULL-FRAME glyph lines (pool-60):')
const EXPECT = {
  'shot1.png': ['92.80K/s', '15.50B'],
  'shot2.png': ['92.80K/s', '1.30B'],
  'shot3.png': ['115.20K/s'], // 13.70B blocked on valley-less 70 merge (known gap)
  'shot4.png': ['115.20K/s'],
  'shot5.png': ['637.50K/s'],
}
for (const [f, want] of Object.entries(EXPECT)) {
  const got = decodeFrame(f)
  const missing = want.filter(s => !got.includes(s))
  console.log(`  ${f}: ${JSON.stringify(got)} expect=${JSON.stringify(want)} ${missing.length === 0 ? 'EXACT' : 'MISSING ' + missing.join(',')}`)
}
