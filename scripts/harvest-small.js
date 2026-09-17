// Surgical small-scale harvest: shot3/shot4 (900x600 live crops) strips whose
// TRUE strings are PP-OCR-verified exact reads (see test-ocr runs). Mirrors
// cut-glyphs.js segmentation + cut() pixel-for-pixel (raw COLOR tight crop in
// CROP coords, opaque) but appends to the existing manifest — never rewrites
// it, never overwrites an existing file (_b/_c suffix on collision).
// Count mismatch (after one forced valley-split attempt) skips the strip:
// never mislabel.
// Usage: node scripts/harvest-small.js inspect   (dry run, no writes)
//        node scripts/harvest-small.js cut       (write crops + manifest)
const fs = require('fs'), path = require('path')
const { PNG } = require('pngjs')

const PPOCR_UPSCALE = 2
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

// Strips with PP-OCR-verified TRUE strings. `map` assigns one label per
// segmented part, left-to-right; null marks a part that is skipped WITHOUT a
// label (e.g. the valley-less merged "70" in 13.70B — unrecoverable by
// projection, so both halves stay out rather than risk a mislabel). When
// `combo` is set, one extra trailing part must hold the merged "/s" combo
// (same rule as cut-glyphs.js) and is harvested as ONE '/s' combo template.
const STRIPS = [
  { file: 'shot3.png', box: { x0: 830, y0: 422, x1: 1157, y1: 463 }, text: '115.20K/s', map: ['1', '1', '5', '.', '2', '0', 'K'], combo: true },
  { file: 'shot3.png', box: { x0: 686, y0: 842, x1: 1097, y1: 919 }, text: '13.70B', map: ['1', '3', '.', null, 'B'], combo: false },
  { file: 'shot4.png', box: { x0: 762, y0: 434, x1: 1255, y1: 497 }, text: '115.20K/s', map: ['1', '1', '5', '.', '2', '0', 'K'], combo: true },
]

function segment(mask, W, best) {
  const counts = []
  for (let x = best.x0; x <= best.x1; x++) {
    let c = 0
    for (let y = best.y0; y <= best.y1; y++) c += mask[y * W + x]
    counts.push(c)
  }
  const segs = []
  let sx = -1
  const flush = (ex) => {
    if (sx >= 0 && ex - sx + 1 >= 6) segs.push({ x0: best.x0 + sx, x1: best.x0 + ex })
    sx = -1
  }
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
    for (let x = s.x0; x <= s.x1; x++) {
      const c = counts[x - best.x0]
      if (c < bv) { bv = c; bi = x }
    }
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
  return { parts, counts }
}

const mode = process.argv[2] || 'inspect'
const outDir = path.join(__dirname, '..', 'ocr-glyphs')
const mp = path.join(outDir, 'manifest.json')
const manifest = JSON.parse(fs.readFileSync(mp, 'utf8'))
const cache = {}

function frameOf(file) {
  if (!cache[file]) {
    // shot3/shot4 are 900x600 native: full frame, no center crop.
    const img = PNG.sync.read(fs.readFileSync(path.join(__dirname, '..', file)))
    cache[file] = { raw: Buffer.from(img.data), cw: img.width, ch: img.height }
  }
  return cache[file]
}

function cut(raw, cw, g, ch, tag) {
  const cx0 = Math.floor(g.x0 / PPOCR_UPSCALE), cy0 = Math.floor(g.y0 / PPOCR_UPSCALE)
  const cx1 = Math.ceil(g.x1 / PPOCR_UPSCALE), cy1 = Math.ceil(g.y1 / PPOCR_UPSCALE)
  const gw = cx1 - cx0 + 1, gh = cy1 - cy0 + 1
  const safe = { '/': 'slash', '/s': 'slash-s', '.': 'dot' }[ch] || ch
  let name = `glyph_${safe}_${tag}_${gw}x${gh}.png`
  if (manifest.some(m => m.file === name) || fs.existsSync(path.join(outDir, name))) {
    let k = 98 // 'b'
    do {
      name = `glyph_${safe}_${tag}_${gw}x${gh}_${String.fromCharCode(k)}.png`
      k++
    } while (manifest.some(m => m.file === name) || fs.existsSync(path.join(outDir, name)))
  }
  const out = new PNG({ width: gw, height: gh })
  for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) {
    const si = ((cy0 + y) * cw + (cx0 + x)) * 4, oi = (y * gw + x) * 4
    out.data[oi] = raw[si]; out.data[oi + 1] = raw[si + 1]; out.data[oi + 2] = raw[si + 2]; out.data[oi + 3] = 255
  }
  fs.writeFileSync(path.join(outDir, name), PNG.sync.write(out))
  manifest.push({ char: ch, file: name, set: 'mint', source: 'harvested' })
  console.log(`  CUT '${ch}' ${gw}x${gh} -> ${name}`)
}

for (const { file, box: best, text: want, map, combo } of STRIPS) {
  const { raw, cw, ch } = frameOf(file)
  const { mask, W } = tealMask(raw, cw, ch, PPOCR_UPSCALE)
  const { parts } = segment(mask, W, best)
  const wantParts = map.length + (combo ? 1 : 0)
  console.log(`${file} "${want}": parts=${parts.length} want=${wantParts} widths=[${parts.map(p => p.x1 - p.x0 + 1).join(',')}]`)
  if (parts.length !== wantParts) { console.log(`  SKIP: part-count mismatch (never mislabel)`); continue }
  const tag = file.replace('.png', '')
  const jobs = []
  map.forEach((ch, i) => { if (ch) jobs.push({ ch, g: parts[i] }) })
  if (combo) {
    if (!/\/s$/.test(want)) { console.log('  SKIP: combo set but text has no /s tail'); continue }
    const tail = parts[parts.length - 1]
    jobs.push({ ch: '/s', g: { x0: tail.x0, x1: tail.x1, y0: best.y0, y1: best.y1 } })
  }
  if (mode === 'inspect') {
    for (const { ch, g } of jobs) console.log(`  would cut '${ch}' mask[${g.x0},${g.x1}] w=${g.x1 - g.x0 + 1}`)
  } else {
    for (const { ch, g } of jobs) cut(raw, cw, g, ch, tag)
  }
}
if (mode !== 'inspect') {
  fs.writeFileSync(mp, JSON.stringify(manifest, null, 1) + '\n')
  console.log(`manifest now ${manifest.length} entries`)
}
