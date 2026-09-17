// Variant admission eval: re-evaluate 5 quarantined rejects under utility gates.
// Usage: node scripts/eval-variants.js
// Mirrors src/main/glyphs.ts canonical matcher exactly (32x32 box-average,
// rethreshold 0.5, mismatch/union, aspect pre-gate 0.15, gate 0.10).
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
    if (g > 110 && g - r > 45 && b - r > 15) {
      ink[y * w + x] = 1
      if (x < ix0) ix0 = x; if (x > ix1) ix1 = x
      if (y < iy0) iy0 = y; if (y > iy1) iy1 = y
    }
  }
  return { ink, ix0, iy0, ix1, iy1 }
}
function loadPool(extraFiles) {
  // extraFiles: [{char,file,dir}] trial additions (Q)
  const base = path.join(__dirname, '..', 'ocr-glyphs')
  const manifest = JSON.parse(fs.readFileSync(path.join(base, 'manifest.json'), 'utf8'))
  const all = []
  for (const m of manifest) {
    const p = PNG.sync.read(fs.readFileSync(path.join(base, m.file)))
    const { ink, ix0, iy0, ix1, iy1 } = templateInk(p.data, p.width, p.height)
    if (ix1 < ix0) continue
    const tw = ix1 - ix0 + 1, th = iy1 - iy0 + 1
    all.push({ char: m.char, file: m.file, aspect: tw / th, canon: canonicalize(ink, ix0, iy0, ix1, iy1, p.width), trial: false })
  }
  for (const q of (extraFiles || [])) {
    const p = PNG.sync.read(fs.readFileSync(path.join(q.dir, q.file)))
    const { ink, ix0, iy0, ix1, iy1 } = templateInk(p.data, p.width, p.height)
    if (ix1 < ix0) { all.push({ char: q.char, file: q.file, aspect: NaN, canon: null, trial: true, blank: true }); continue }
    const tw = ix1 - ix0 + 1, th = iy1 - iy0 + 1
    all.push({ char: q.char, file: q.file, aspect: tw / th, canon: canonicalize(ink, ix0, iy0, ix1, iy1, p.width), trial: true })
  }
  return all
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
// Classify one ROI (crop-space binary obs) against a pool; returns per-char best + winner + margin + winning exemplar identity
function classify(pool, rAspect, rCanon) {
  const perChar = new Map()
  for (const t of pool) {
    if (!t.canon) continue
    if (Math.abs(t.aspect - rAspect) > ASPECT_GATE) continue
    const s = canonMismatch(t.canon, rCanon)
    const e = perChar.get(t.char)
    if (!e || s < e.score) perChar.set(t.char, { score: s, file: t.file, trial: t.trial })
  }
  const ranked = [...perChar.entries()].sort((a, b) => a[1].score - b[1].score)
  if (ranked.length === 0) return { best: '?', bestScore: Infinity, margin: 0, perChar, winnerFile: null, winnerTrial: false }
  const [bc, b] = ranked[0]
  if (b.score > CANON_GATE) return { best: '?', bestScore: b.score, margin: 0, perChar, winnerFile: b.file, winnerTrial: b.trial, runnerUp: ranked[1] || null }
  const margin = ranked.length > 1 ? ranked[1][1].score - b.score : 1 - b.score
  return { best: bc, bestScore: b.score, margin, perChar, winnerFile: b.file, winnerTrial: b.trial, runnerUp: ranked[1] || null }
}
function centerCrop(imgPath) {
  const img = PNG.sync.read(fs.readFileSync(imgPath))
  const cw = Math.min(900, img.width), ch = Math.min(600, img.height)
  const cx = Math.floor((img.width - cw) / 2), cy = Math.floor((img.height - ch) / 2)
  const crop = new PNG({ width: cw, height: ch })
  PNG.bitblt(img, crop, cx, cy, cw, ch, 0, 0)
  return { raw: Buffer.from(crop.data), cw, ch }
}
// Full-frame glyph decode (mirror matchGlyphLines)
function decodeFrame(pool, imgPath) {
  const { raw, cw, ch } = centerCrop(imgPath)
  const { mask, W, H } = tealMask(raw, cw, ch, PPOCR_UPSCALE)
  const out = []
  for (const line of groupLines(findBoxes(mask, W, H))) {
    let text = ''
    for (const gbox of splitGlyphs(mask, W, line)) {
      let tx0 = gbox.x1, ty0 = gbox.y1, tx1 = gbox.x0, ty1 = gbox.y0
      for (let y = gbox.y0; y <= gbox.y1; y++) for (let x = gbox.x0; x <= gbox.x1; x++) {
        if (mask[y * W + x]) { if (x < tx0) tx0 = x; if (x > tx1) tx1 = x; if (y < ty0) ty0 = y; if (y > ty1) ty1 = y }
      }
      if (ty1 < ty0 || tx1 < tx0) continue
      const cx0 = tx0 >> 1, cy0 = ty0 >> 1, cx1 = tx1 >> 1, cy1 = ty1 >> 1
      const rw = cx1 - cx0 + 1, rh = cy1 - cy0 + 1
      const obs = new Uint8Array(rw * rh)
      for (let y = 0; y < rh; y++) for (let x = 0; x < rw; x++) obs[y * rw + x] = mask[(cy0 + y) * 2 * W + ((cx0 + x) * 2)] ? 1 : 0
      const r = classify(pool, rw / rh, canonicalize(obs, 0, 0, rw - 1, rh - 1, rw))
      text += r.best
    }
    if (text.length > 0) out.push(text)
  }
  return out
}
// Verified regression ROIs with ground truth (same boxes/strings as cut-glyphs.js SHOTS)
const SHOTS = [
  { file: 'shot1.png', lines: [
    { text: '92.80K/s', use: '92.80K', box: { x0: 808, y0: 492, x1: 1091, y1: 531 } },
    { text: '15.50B', use: '15.50B', box: { x0: 800, y0: 902, x1: 1133, y1: 965 } },
  ] },
  { file: 'shot2.png', lines: [
    { text: '92.80K/s', use: '92.80K', box: { x0: 862, y0: 514, x1: 1123, y1: 551 } },
    { text: '1.30B', use: '1.30B', box: { x0: 928, y0: 922, x1: 1165, y1: 979 } },
  ] },
]
function harvestROIs() {
  const rois = []
  for (const { file, lines } of SHOTS) {
    const { raw, cw, ch } = centerCrop(path.join(__dirname, '..', file))
    const { mask, W } = tealMask(raw, cw, ch, PPOCR_UPSCALE)
    for (const { text: want, box: best, use } of lines) {
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
      parts.sort((a, b) => a.x0 - b.x0)
      const assign = use || want
      // per-char ROIs for leading chars
      assign.split('').forEach((ch, i) => {
        const g = parts[i]
        if (!g) return
        let tx0 = g.x1, ty0 = g.y1, tx1 = g.x0, ty1 = g.y0
        for (let y = g.y0; y <= g.y1; y++) for (let x = g.x0; x <= g.x1; x++) {
          if (mask[y * W + x]) { if (x < tx0) tx0 = x; if (x > tx1) tx1 = x; if (y < ty0) ty0 = y; if (y > ty1) ty1 = y }
        }
        if (ty1 < ty0 || tx1 < tx0) return
        const cx0 = tx0 >> 1, cy0 = ty0 >> 1, cx1 = tx1 >> 1, cy1 = ty1 >> 1
        const rw = cx1 - cx0 + 1, rh = cy1 - cy0 + 1
        const obs = new Uint8Array(rw * rh)
        for (let y = 0; y < rh; y++) for (let x = 0; x < rw; x++) obs[y * rw + x] = mask[(cy0 + y) * 2 * W + ((cx0 + x) * 2)] ? 1 : 0
        rois.push({ frame: file, strip: want, truth: ch, rAspect: rw / rh, rCanon: canonicalize(obs, 0, 0, rw - 1, rh - 1, rw), w: rw, h: rh })
      })
      if (parts.length > assign.length && /\/s$/.test(want)) {
        const tail = parts.slice(assign.length)
        const combo = { x0: Math.min(...tail.map(p => p.x0)), x1: Math.max(...tail.map(p => p.x1)), y0: best.y0, y1: best.y1 }
        let tx0 = combo.x1, ty0 = combo.y1, tx1 = combo.x0, ty1 = combo.y0
        for (let y = combo.y0; y <= combo.y1; y++) for (let x = combo.x0; x <= combo.x1; x++) {
          if (mask[y * W + x]) { if (x < tx0) tx0 = x; if (x > tx1) tx1 = x; if (y < ty0) ty0 = y; if (y > ty1) ty1 = y }
        }
        const cx0 = tx0 >> 1, cy0 = ty0 >> 1, cx1 = tx1 >> 1, cy1 = ty1 >> 1
        const rw = cx1 - cx0 + 1, rh = cy1 - cy0 + 1
        const obs = new Uint8Array(rw * rh)
        for (let y = 0; y < rh; y++) for (let x = 0; x < rw; x++) obs[y * rw + x] = mask[(cy0 + y) * 2 * W + ((cx0 + x) * 2)] ? 1 : 0
        rois.push({ frame: file, strip: want, truth: '/s', rAspect: rw / rh, rCanon: canonicalize(obs, 0, 0, rw - 1, rh - 1, rw), w: rw, h: rh })
      }
    }
  }
  return rois
}

const QSET = [
  { char: '2', file: 'two.png' },
  { char: '5', file: 'five.png' },
  { char: '9', file: 'nine.png' },
  { char: '.', file: 'dot.png' },
  { char: '/s', file: 'symbol and letter s go together.png' },
]
const manualDir = path.join(__dirname, '..', 'ocr-glyphs-manual')

const pool = loadPool()
const rois = harvestROIs()
console.log(`pool=${pool.length} rois=${rois.length}`)

// ---- Gate 0: Q vs each same-char exemplar ----
for (const q of QSET) {
  const p = PNG.sync.read(fs.readFileSync(path.join(manualDir, q.file)))
  const { ink, ix0, iy0, ix1, iy1 } = templateInk(p.data, p.width, p.height)
  const blank = ix1 < ix0
  const qAspect = blank ? NaN : (ix1 - ix0 + 1) / (iy1 - iy0 + 1)
  const qCanon = blank ? null : canonicalize(ink, ix0, iy0, ix1, iy1, p.width)
  console.log(`\nQ '${q.char}' ${q.file} ${p.width}x${p.height} aspect=${blank ? 'BLANK' : qAspect.toFixed(3)} mintInk=${blank ? 0 : 'non-empty'}`)
  const same = pool.filter(t => t.char === q.char)
  console.log(`  same-char exemplars in pool: ${same.length}`)
  let best = Infinity
  for (const t of same) {
    const dA = Math.abs(t.aspect - qAspect)
    const mm = canonMismatch(t.canon, qCanon)
    if (mm < best) best = mm
    console.log(`    vs ${t.file} aspect=${t.aspect.toFixed(3)} dAspect=${dA.toFixed(3)}${dA > ASPECT_GATE ? ' GATED' : ''} mismatch=${mm.toFixed(3)}`)
  }
  console.log(`  BEST vs same-char = ${best.toFixed(3)} (gate-b ${best <= 0.10 ? 'PASS' : 'FAIL'})`)
}

// ---- Utility + confusion per Q (trial pool) ----
const baseLines = { 'shot1.png': decodeFrame(pool, path.join(__dirname, '..', 'shot1.png')), 'shot2.png': decodeFrame(pool, path.join(__dirname, '..', 'shot2.png')) }
console.log('\nBASE full-frame glyph lines:')
for (const [f, ls] of Object.entries(baseLines)) console.log(`  ${f}: ${JSON.stringify(ls)}`)
const baseHas = (s) => Object.values(baseLines).some(ls => ls.includes(s))

for (const q of QSET) {
  const trial = loadPool([{ char: q.char, file: q.file, dir: manualDir }])
  const tl = { 'shot1.png': decodeFrame(trial, path.join(__dirname, '..', 'shot1.png')), 'shot2.png': decodeFrame(trial, path.join(__dirname, '..', 'shot2.png')) }
  console.log(`\nTRIAL +Q '${q.char}' ${q.file}:`)
  for (const [f, ls] of Object.entries(tl)) console.log(`  ${f}: ${JSON.stringify(ls)}`)
  const exact9280 = Object.values(tl).every(ls => ls.includes('92.80K/s'))
  const exact1550 = tl['shot1.png'].includes('15.50B')
  const exact130 = tl['shot2.png'].includes('1.30B')
  const reg9280 = baseHas('92.80K/s') ? exact9280 : true
  console.log(`  exact 92.80K/s(all frames)=${exact9280} 15.50B=${exact1550} 1.30B=${exact130} no-regression=${reg9280}`)
  const utility = (!baseLines['shot1.png'].includes('15.50B') && exact1550) ? 'YES(15.50B fixed)' : 'no'
  console.log(`  UTILITY=${utility}`)
  // confusion per ROI
  let minMargin = Infinity, fails = 0, steals = 0
  const confPairs = {}
  for (const r of rois) {
    const c = classify(trial, r.rAspect, r.rCanon)
    if (c.best !== r.truth) fails++
    if (c.winnerTrial && r.truth !== q.char) steals++
    if (c.best === r.truth && c.margin < minMargin) minMargin = c.margin
    const key = `${r.truth}->${c.best}`
    confPairs[key] = (confPairs[key] || 0) + 1
    if (c.best !== r.truth || c.margin < 0.05) {
      console.log(`    ROI ${r.frame} [${r.strip}] truth='${r.truth}' got='${c.best}' score=${c.bestScore === Infinity ? 'inf' : c.bestScore.toFixed(3)} margin=${c.margin.toFixed(3)} via=${c.winnerFile}${c.winnerTrial ? ' (Q!)' : ''}`)
    }
  }
  console.log(`  CONFUSION fails=${fails} Q-steals=${steals} minMarginOnCorrect=${minMargin === Infinity ? 'n/a' : minMargin.toFixed(3)} pairs=${JSON.stringify(confPairs)}`)
}

// ---- Self-match + scale sweep on base pool ----
let selfBad = 0
for (const t of pool) {
  const mm = canonMismatch(t.canon, t.canon)
  if (mm !== 0) { selfBad++; console.log(`SELF-MISMATCH ${t.file} ${mm}`) }
}
console.log(`\nSELF-MATCH bad=${selfBad}/${pool.length} (expect 0)`)
const factors = [0.7, 0.8, 0.9, 1.0, 1.1, 1.2, 1.3, 1.4]
function scaleCanonNearest(ink, x0, y0, x1, y1, w, f) {
  const sw = x1 - x0 + 1, sh = y1 - y0 + 1
  const nw = Math.max(1, Math.round(sw * f)), nh = Math.max(1, Math.round(sh * f))
  const scaled = new Uint8Array(nw * nh)
  for (let y = 0; y < nh; y++) for (let x = 0; x < nw; x++) {
    const sx = Math.min(sw - 1, Math.floor(x / f)), sy = Math.min(sh - 1, Math.floor(y / f))
    scaled[y * nw + x] = ink[(y0 + sy) * w + (x0 + sx)] ? 1 : 0
  }
  return canonicalize(scaled, 0, 0, nw - 1, nh - 1, nw)
}
const poolInks = (() => {
  const base = path.join(__dirname, '..', 'ocr-glyphs')
  const manifest = JSON.parse(fs.readFileSync(path.join(base, 'manifest.json'), 'utf8'))
  return manifest.map(m => {
    const p = PNG.sync.read(fs.readFileSync(path.join(base, m.file)))
    const t = templateInk(p.data, p.width, p.height)
    return { file: m.file, ...t, w: p.width }
  })
})()
for (const f of factors) {
  let worst = 0, worstFile = ''
  for (const t of poolInks) {
    if (t.ix1 < t.ix0) continue
    const sc = scaleCanonNearest(t.ink, t.ix0, t.iy0, t.ix1, t.iy1, t.w, f)
    const orig = canonicalize(t.ink, t.ix0, t.iy0, t.ix1, t.iy1, t.w)
    const mm = canonMismatch(orig, sc)
    if (mm > worst) { worst = mm; worstFile = t.file }
  }
  console.log(`SWEEP f=${f.toFixed(1)} worstMismatch=${worst.toFixed(3)} (${worstFile}) ${worst <= 0.10 ? 'PASS' : 'FAIL'}`)
}
