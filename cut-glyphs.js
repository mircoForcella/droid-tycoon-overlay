// One-off: cut labeled glyph templates from verified shot strips.
// Ground truth (proven by test-ocr runs): each entry maps a shot to the
// strips it contains, in top-to-bottom order, with their TRUE strings.
// CC boxes within a strip are assigned left-to-right; count mismatch skips
// the strip (never mislabel). Run: node cut-glyphs.js
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
function findBoxes(mask, W, H, minH = 8, minW = 3, minArea = 30) {
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
    if ((y1 - y0 + 1) >= minH && (x1 - x0 + 1) >= minW && area >= minArea) boxes.push({ x0, y0, x1, y1 })
  }
  return boxes
}
function groupLines(boxes) {
  const sorted = [...boxes].sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0)
  const lines = []
  for (const b of sorted) {
    const cy = (b.y0 + b.y1) / 2
    let ln = lines.find(L => Math.abs(((L.y0 + L.y1) / 2) - cy) < 18)
    if (!ln) { ln = { x0: 1e9, y0: 1e9, x1: -1, y1: -1, parts: [] }; lines.push(ln) }
    ln.parts.push(b)
    ln.x0 = Math.min(ln.x0, b.x0); ln.y0 = Math.min(ln.y0, b.y0)
    ln.x1 = Math.max(ln.x1, b.x1); ln.y1 = Math.max(ln.y1, b.y1)
  }
  return lines
}

// Verified line boxes (2x mask coords) from passing test-ocr runs.
// `use` assigns leading boxes when the trailing box holds merged glyphs
// ("/s" never separates); the merged tail is skipped, never mislabeled.
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
const outDir = path.join(__dirname, 'ocr-glyphs')
fs.mkdirSync(outDir, { recursive: true })
const manifest = []
const seen = new Set()
for (const { file, lines } of SHOTS) {
  const img = PNG.sync.read(fs.readFileSync(path.join(__dirname, file)))
  const cw = Math.min(900, img.width), ch = Math.min(600, img.height)
  const cx = Math.floor((img.width - cw) / 2), cy = Math.floor((img.height - ch) / 2)
  const crop = new PNG({ width: cw, height: ch })
  PNG.bitblt(img, crop, cx, cy, cw, ch, 0, 0)
  const raw = Buffer.from(crop.data)
  const { mask, W, H } = tealMask(raw, cw, ch, PPOCR_UPSCALE)
  // line-level boxes first (coarse), then CC parts within each
  const coarse = findBoxes(mask, W, H, 12, 20, 200).sort((a, b) => a.y0 - b.y0)
  console.log(`${file}: coarse line boxes=${coarse.length}`)
  for (const { text: want, box: best, use } of lines) {
    // Projection segmentation: hard splits at empty columns, then split
    // oversized runs at their deepest internal valley (merged glyphs).
    const counts = []
    for (let x = best.x0; x <= best.x1; x++) {
      let c = 0
      for (let y = best.y0; y <= best.y1; y++) c += mask[y * W + x]
      counts.push(c)
    }
    const segs = []
    let sx = -1
    // Split at near-empty columns (thin bridges between touching italic
    // glyphs read 1-4px, never 0). Interior glyph columns always carry the
    // full stroke height, so they never dip this low.
    const empty = (c) => c <= 3
    const flush = (ex) => {
      if (sx >= 0 && ex - sx + 1 >= 6) segs.push({ x0: best.x0 + sx, x1: best.x0 + ex })
      sx = -1
    }
    counts.forEach((c, i) => { if (empty(c)) flush(i - 1); else if (sx < 0) sx = i })
    flush(counts.length - 1)
    // drop speck runs (tiny + faint), e.g. edge dust
    const kept = segs.filter(s => {
      let peak = 0
      for (let x = s.x0; x <= s.x1; x++) peak = Math.max(peak, counts[x - best.x0])
      return (s.x1 - s.x0 + 1) >= 8 || peak >= 5
    })
    // Split at every deep valley (merged italic glyphs), not just in
    // oversized runs: both sides must stay viable glyphs, valley below 30%
    // of the segment peak. Holes inside 9/0/8/B keep tall flanks, so they
    // never qualify.
    const widths = kept.map(s => s.x1 - s.x0 + 1).sort((a, b) => a - b)
    void widths
    const splitSeg = (s) => {
      let peak = 0
      for (let x = s.x0; x <= s.x1; x++) peak = Math.max(peak, counts[x - best.x0])
      let bi = -1, bv = 1e9
      for (let x = s.x0; x <= s.x1; x++) {
        const c = counts[x - best.x0]
        if (c < bv) { bv = c; bi = x }
      }
      // Split only if both resulting parts stay viable glyphs.
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
    for (const s of kept) {
      for (const p of splitSeg(s)) parts.push({ ...p, y0: best.y0, y1: best.y1 })
    }
    parts.sort((a, b) => a.x0 - b.x0)
    const assign = use || want
    // `use` may cover only leading boxes (merged tail skipped by design).
    if (parts.length < assign.length) {
      console.log(`  SKIP "${want}": ${parts.length} glyph boxes < ${assign.length} assign chars`)
      continue
    }
    if (parts.length > assign.length) {
      console.log(`  "${want}": assigning leading ${assign.length}, skipping ${parts.length - assign.length} trailing (merged) box(es)`)
    }
    // Raw COLOR tight crop in CROP coords (opaque). Color is preserved so the
    // matcher applies the IDENTICAL chroma fill rule on template pixels and
    // live-mask pixels — same fill definition, self-match mismatch ≈ 0.
    // Grayscale would force a second threshold and re-introduce
    // outline-vs-fill disagreement.
    // All harvests come from the teal fill mask => set 'mint'. Dimensions in
    // the name: the same char repeats at different UI scales (rate strips
    // ~20px vs accumulations ~30px) and must not collide/overwrite.
    const cut = (g, ch, tag) => {
      const cx0 = Math.floor(g.x0 / PPOCR_UPSCALE), cy0 = Math.floor(g.y0 / PPOCR_UPSCALE)
      const cx1 = Math.ceil(g.x1 / PPOCR_UPSCALE), cy1 = Math.ceil(g.y1 / PPOCR_UPSCALE)
      const gw = cx1 - cx0 + 1, gh = cy1 - cy0 + 1
      const safe = { '/': 'slash', '/s': 'slash-s', '.': 'dot' }[ch] || ch
      // Same-char/same-dims repeats (e.g. the two 5s in 15.50B) must NEVER
      // collide: later writes used to silently overwrite earlier crops while
      // the manifest kept a single entry. Suffix _b/_c… so every harvest is
      // its own exemplar file + manifest entry (variant coverage, not dedupe).
      let name = `glyph_${safe}_${tag}_${gw}x${gh}.png`
      if (seen.has(ch + name) || fs.existsSync(path.join(outDir, name))) {
        let k = 98 // 'b'
        while (seen.has(ch + name) || fs.existsSync(path.join(outDir, name))) {
          name = `glyph_${safe}_${tag}_${gw}x${gh}_${String.fromCharCode(k)}.png`
          k++
        }
      }
      const out = new PNG({ width: gw, height: gh })
      for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) {
        const si = ((cy0 + y) * cw + (cx0 + x)) * 4
        const oi = (y * gw + x) * 4
        out.data[oi] = raw[si]; out.data[oi + 1] = raw[si + 1]; out.data[oi + 2] = raw[si + 2]; out.data[oi + 3] = 255
      }
      fs.writeFileSync(path.join(outDir, name), PNG.sync.write(out))
      if (!seen.has(ch + name)) { seen.add(ch + name); manifest.push({ char: ch, file: name, set: 'mint', source: 'harvested' }) }
      console.log(`  "${want}" '${ch}' ${gw}x${gh} -> ${name}`)
      return name
    }
    assign.split('').forEach((ch, i) => {
      cut(parts[i], ch, file.replace('.png', ''))
    })
    // Trailing merged tail: for "/s" lines the tail boxes hold the inseparable
    // "/s" combo — harvest it as ONE combo template at native scale instead
    // of skipping it, so full-strip decode can claim the whole rate string.
    if (parts.length > assign.length && /\/s$/.test(want)) {
      const tail = parts.slice(assign.length)
      const combo = {
        x0: Math.min(...tail.map(p => p.x0)),
        x1: Math.max(...tail.map(p => p.x1)),
        y0: best.y0, y1: best.y1
      }
      cut(combo, '/s', file.replace('.png', ''))
    }
  }
}
fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 1))
const cov = [...new Set(manifest.map(m => m.char))].sort().join(' ')
console.log(`glyph coverage: ${cov}`)
