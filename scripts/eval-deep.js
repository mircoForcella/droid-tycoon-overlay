// Deep-dive: failing-5 ROI forensics + cross-scale same-char + pair margins.
// Usage: node scripts/eval-deep.js
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
function loadPool() {
  const base = path.join(__dirname, '..', 'ocr-glyphs')
  const manifest = JSON.parse(fs.readFileSync(path.join(base, 'manifest.json'), 'utf8'))
  return manifest.map(m => {
    const p = PNG.sync.read(fs.readFileSync(path.join(base, m.file)))
    const { ink, ix0, iy0, ix1, iy1 } = templateInk(p.data, p.width, p.height)
    const tw = ix1 - ix0 + 1, th = iy1 - iy0 + 1
    return { char: m.char, file: m.file, aspect: tw / th, canon: canonicalize(ink, ix0, iy0, ix1, iy1, p.width), w: tw, h: th }
  })
}
function tealMask(src, w, h, s) {
  const W = w * s, H = h * s, mask = new Uint8Array(W * H)
  for (let y = 0; y < H; y++) { const sy = Math.min(h - 1, (y / s) | 0)
    for (let x = 0; x < W; x++) { const sx = Math.min(w - 1, (x / s) | 0), si = (sy * w + sx) * 4
      mask[y * W + x] = (src[si + 1] > 110 && src[si + 1] - src[si] > 45 && src[si + 2] - src[si] > 15) ? 1 : 0 } }
  return { mask, W, H }
}
const pool = loadPool()
// 1) cross-scale same-char pairs (real game renders at ~20px vs ~30px)
console.log('CROSS-SCALE same-char mismatches (real renders, aspect-gate noted):')
for (const ch of [...new Set(pool.map(t => t.char))]) {
  const ts = pool.filter(t => t.char === ch)
  if (ts.length < 2) { console.log(`  '${ch}': single exemplar (${ts[0].file})`); continue }
  for (let i = 0; i < ts.length; i++) for (let j = i + 1; j < ts.length; j++) {
    const dA = Math.abs(ts[i].aspect - ts[j].aspect)
    console.log(`  '${ch}': ${ts[i].file} (${ts[i].w}x${ts[i].h}) vs ${ts[j].file} (${ts[j].w}x${ts[j].h}) dAspect=${dA.toFixed(3)}${dA > ASPECT_GATE ? ' GATED' : ''} mismatch=${canonMismatch(ts[i].canon, ts[j].canon).toFixed(3)}`)
  }
}
// 2) the two 5 ROIs in the 15.50B strip: segment, mutual mismatch, per-char scores
function centerCrop(f) {
  const img = PNG.sync.read(fs.readFileSync(path.join(__dirname, '..', f)))
  const cw = Math.min(900, img.width), ch = Math.min(600, img.height)
  const cx = Math.floor((img.width - cw) / 2), cy = Math.floor((img.height - ch) / 2)
  const crop = new PNG({ width: cw, height: ch })
  PNG.bitblt(img, crop, cx, cy, cw, ch, 0, 0)
  return { raw: Buffer.from(crop.data), cw, ch }
}
{
  const { raw, cw, ch } = centerCrop('shot1.png')
  const { mask, W } = tealMask(raw, cw, ch, PPOCR_UPSCALE)
  const best = { x0: 800, y0: 902, x1: 1133, y1: 965 } // 15.50B verified box
  const counts = []
  for (let x = best.x0; x <= best.x1; x++) { let c = 0; for (let y = best.y0; y <= best.y1; y++) c += mask[y * W + x]; counts.push(c) }
  console.log('\n15.50B column profile around valleys (x,count):')
  console.log('  ' + counts.map((c, i) => `${best.x0 + i}:${c}`).join(' '))
  const segs = []
  let sx = -1
  const flush = (ex) => { if (sx >= 0 && ex - sx + 1 >= 6) segs.push({ x0: best.x0 + sx, x1: best.x0 + ex }); sx = -1 }
  counts.forEach((c, i) => { if (c <= 3) flush(i - 1); else if (sx < 0) sx = i })
  flush(counts.length - 1)
  console.log('  segs: ' + JSON.stringify(segs))
}
function roiOf(frame, box, idx) {
  const { raw, cw, ch } = centerCrop(frame)
  const { mask, W } = tealMask(raw, cw, ch, PPOCR_UPSCALE)
  // replicate splitGlyphs then pick idx-th part
  const counts = []
  for (let x = box.x0; x <= box.x1; x++) { let c = 0; for (let y = box.y0; y <= box.y1; y++) c += mask[y * W + x]; counts.push(c) }
  const segs = []
  let sx = -1
  const flush = (ex) => { if (sx >= 0 && ex - sx + 1 >= 6) segs.push({ x0: box.x0 + sx, x1: box.x0 + ex, y0: box.y0, y1: box.y1 }); sx = -1 }
  counts.forEach((c, i) => { if (c <= 3) flush(i - 1); else if (sx < 0) sx = i })
  flush(counts.length - 1)
  const kept = segs.filter(s => { let p = 0; for (let x = s.x0; x <= s.x1; x++) p = Math.max(p, counts[x - box.x0]); return (s.x1 - s.x0 + 1) >= 8 || p >= 5 })
  const parts = []
  const splitSeg = (s) => {
    let p = 0; for (let x = s.x0; x <= s.x1; x++) p = Math.max(p, counts[x - box.x0])
    let bi = -1, bv = Infinity
    for (let x = s.x0; x <= s.x1; x++) { const c = counts[x - box.x0]; if (c < bv) { bv = c; bi = x } }
    if (bi > 0 && bv < p * 0.3 && bi - s.x0 + 1 >= 10 && s.x1 - bi >= 10) {
      const out = []
      for (const sub of [{ x0: s.x0, x1: bi }, { x0: bi + 1, x1: s.x1 }]) {
        if (sub.x1 - sub.x0 + 1 >= 24) out.push(...splitSeg({ ...sub, y0: s.y0, y1: s.y1 }))
        else out.push({ ...sub, y0: s.y0, y1: s.y1 })
      }
      return out
    }
    return [s]
  }
  for (const s of kept) for (const p of splitSeg(s)) parts.push(p)
  parts.sort((a, b) => a.x0 - b.x0)
  const g = parts[idx]
  let tx0 = g.x1, ty0 = g.y1, tx1 = g.x0, ty1 = g.y0
  for (let y = g.y0; y <= g.y1; y++) for (let x = g.x0; x <= g.x1; x++)
    if (mask[y * W + x]) { if (x < tx0) tx0 = x; if (x > tx1) tx1 = x; if (y < ty0) ty0 = y; if (y > ty1) ty1 = y }
  const cx0 = tx0 >> 1, cy0 = ty0 >> 1, cx1 = tx1 >> 1, cy1 = ty1 >> 1
  const rw = cx1 - cx0 + 1, rh = cy1 - cy0 + 1
  const obs = new Uint8Array(rw * rh)
  for (let y = 0; y < rh; y++) for (let x = 0; x < rw; x++) obs[y * rw + x] = mask[(cy0 + y) * 2 * W + ((cx0 + x) * 2)] ? 1 : 0
  return { rAspect: rw / rh, rCanon: canonicalize(obs, 0, 0, rw - 1, rh - 1, rw), w: rw, h: rh, segBox: g, inkBox: { tx0, ty0, tx1, ty1 } }
}
{
  const box = { x0: 800, y0: 902, x1: 1133, y1: 965 }
  const fiveA = roiOf('shot1.png', box, 1), fiveB = roiOf('shot1.png', box, 3)
  console.log('\nTWO 5s in 15.50B:')
  console.log(`  5a(idx1): ${fiveA.w}x${fiveA.h} aspect=${fiveA.rAspect.toFixed(3)} seg=${JSON.stringify(fiveA.segBox)} ink=${JSON.stringify(fiveA.inkBox)}`)
  console.log(`  5b(idx3): ${fiveB.w}x${fiveB.h} aspect=${fiveB.rAspect.toFixed(3)} seg=${JSON.stringify(fiveB.segBox)} ink=${JSON.stringify(fiveB.inkBox)}`)
  console.log(`  mutual mismatch 5a-vs-5b = ${canonMismatch(fiveA.rCanon, fiveB.rCanon).toFixed(3)}`)
  const man5 = (() => { const p = PNG.sync.read(fs.readFileSync(path.join(__dirname, '..', 'ocr-glyphs-manual', 'five.png')))
    const { ink, ix0, iy0, ix1, iy1 } = templateInk(p.data, p.width, p.height)
    return { aspect: (ix1 - ix0 + 1) / (iy1 - iy0 + 1), canon: canonicalize(ink, ix0, iy0, ix1, iy1, p.width) } })()
  for (const [nm, r] of [['5a', fiveA], ['5b', fiveB]]) {
    console.log(`  --- ${nm} per-char best (base pool + manual5) ---`)
    const rows = []
    for (const ch of [...new Set(pool.map(t => t.char))]) {
      let bestS = Infinity, bestF = ''
      for (const t of pool.filter(t => t.char === ch)) {
        if (Math.abs(t.aspect - r.rAspect) > ASPECT_GATE) continue
        const s = canonMismatch(t.canon, r.rCanon)
        if (s < bestS) { bestS = s; bestF = t.file }
      }
      rows.push({ ch, bestS, bestF })
    }
    rows.sort((a, b) => a.bestS - b.bestS)
    for (const x of rows.slice(0, 6)) console.log(`    '${x.ch}' ${x.bestS === Infinity ? 'GATED-ALL' : x.bestS.toFixed(3)} via ${x.bestF}`)
    const dA = Math.abs(man5.aspect - r.rAspect)
    console.log(`    manual five.png: dAspect=${dA.toFixed(3)} mismatch=${canonMismatch(man5.canon, r.rCanon).toFixed(3)}`)
  }
}
// 3) pair margins (5,6)(3,8)(6,8)(1,7)(0,6) on base pool over regression ROIs
{
  console.log('\nPAIR margins on base pool (truth ROI: score(pair)-score(truth); PASS if >=0.05):')
  const { execSync } = require('child_process')
  // rebuild ROIs quickly via eval-variants harvest? inline minimal: reuse roiOf over SHOTS
  const SHOTS = [
    { file: 'shot1.png', list: [ ['92.80K/s', { x0: 808, y0: 492, x1: 1091, y1: 531 }, ['9', '2', '.', '8', '0', 'K', '/s']], ['15.50B', { x0: 800, y0: 902, x1: 1133, y1: 965 }, ['1', '5', '.', '5', '0', 'B']] ] },
    { file: 'shot2.png', list: [ ['92.80K/s', { x0: 862, y0: 514, x1: 1123, y1: 551 }, ['9', '2', '.', '8', '0', 'K', '/s']], ['1.30B', { x0: 928, y0: 922, x1: 1165, y1: 979 }, ['1', '.', '3', '0', 'B']] ] },
  ]
  const scoreAs = (r, ch) => {
    let b = Infinity
    for (const t of pool.filter(t => t.char === ch)) {
      if (Math.abs(t.aspect - r.rAspect) > ASPECT_GATE) continue
      const s = canonMismatch(t.canon, r.rCanon)
      if (s < b) b = s
    }
    return b
  }
  const pairs = [['5', '6'], ['3', '8'], ['6', '8'], ['1', '7'], ['0', '6']]
  for (const [a, b] of pairs) {
    // ROIs whose truth is a or b
    for (const sh of SHOTS) for (const [strip, box, truths] of sh.list) {
      truths.forEach((truth, i) => {
        if (truth !== a && truth !== b) return
        const other = truth === a ? b : a
        // combo /s tail index: truths has 7 entries but parts has 6+combo; handle: if truth=='/s' use tail combo
        const r = truth === '/s'
          ? (() => { const { raw, cw, ch } = centerCrop(sh.file); const { mask, W } = tealMask(raw, cw, ch, PPOCR_UPSCALE)
              // rough: re-derive tail like harvestROIs would; skip detailed, use roiOf with idx = parts-1 is unknown here
              return null })()
          : roiOf(sh.file, box, i > 5 ? i : i)
        if (!r) return
        const sT = scoreAs(r, truth), sO = scoreAs(r, other)
        const mg = sO - sT
        console.log(`  (${a},${b}) ${sh.file} [${strip}] truth='${truth}' score=${sT === Infinity ? 'GATED' : sT.toFixed(3)} other('${other}')=${sO === Infinity ? 'GATED' : sO.toFixed(3)} margin=${Number.isFinite(mg) ? mg.toFixed(3) : 'n/a'} ${Number.isFinite(mg) && mg >= 0.05 ? 'PASS' : (truth === '5' && strip === '15.50B' ? 'FAIL(pre-existing 5b)' : 'CHECK')}`)
      })
    }
  }
}
