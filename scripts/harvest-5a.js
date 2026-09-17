// One-off surgical harvest: leading 5 (5a) of the 15.50B strip in shot1.png.
// The two 5s share crop dims so the original harvest kept only the trailing
// 5b (overwrite); this adds 5a as its own exemplar. Mirrors cut-glyphs.js
// cut() pixel-for-pixel (raw COLOR tight crop in CROP coords, opaque).
// Usage: node scripts/harvest-5a.js
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
const img = PNG.sync.read(fs.readFileSync(path.join(__dirname, '..', 'shot1.png')))
const cw = Math.min(900, img.width), ch = Math.min(600, img.height)
const cx = Math.floor((img.width - cw) / 2), cy = Math.floor((img.height - ch) / 2)
const crop = new PNG({ width: cw, height: ch })
PNG.bitblt(img, crop, cx, cy, cw, ch, 0, 0)
const raw = Buffer.from(crop.data)
const { mask, W } = tealMask(raw, cw, ch, PPOCR_UPSCALE)
const best = { x0: 800, y0: 902, x1: 1133, y1: 965 } // 15.50B verified box
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
console.log('parts=' + JSON.stringify(parts.map(p => [p.x0, p.x1])))
const g = parts[1] // leading 5 (5a): '1'=0, '5a'=1, '.'=2, '5b'=3, '0'=4, 'B'=5
const cx0 = Math.floor(g.x0 / PPOCR_UPSCALE), cy0 = Math.floor(g.y0 / PPOCR_UPSCALE)
const cx1 = Math.ceil(g.x1 / PPOCR_UPSCALE), cy1 = Math.ceil(g.y1 / PPOCR_UPSCALE)
const gw = cx1 - cx0 + 1, gh = cy1 - cy0 + 1
const outDir = path.join(__dirname, '..', 'ocr-glyphs')
let name = `glyph_5_shot1_${gw}x${gh}.png`
if (fs.existsSync(path.join(outDir, name))) name = `glyph_5_shot1_${gw}x${gh}_b.png`
const out = new PNG({ width: gw, height: gh })
for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) {
  const si = ((cy0 + y) * cw + (cx0 + x)) * 4, oi = (y * gw + x) * 4
  out.data[oi] = raw[si]; out.data[oi + 1] = raw[si + 1]; out.data[oi + 2] = raw[si + 2]; out.data[oi + 3] = 255
}
fs.writeFileSync(path.join(outDir, name), PNG.sync.write(out))
console.log(`5a ${gw}x${gh} -> ${name}`)
// Append manifest entry (harvested gold-standard, NOT manual variant)
const mp = path.join(outDir, 'manifest.json')
const manifest = JSON.parse(fs.readFileSync(mp, 'utf8'))
if (!manifest.some(m => m.file === name)) {
  manifest.push({ char: '5', file: name, set: 'mint', source: 'harvested' })
  fs.writeFileSync(mp, JSON.stringify(manifest, null, 1) + '\n')
  console.log('manifest appended')
} else console.log('manifest already has entry')
