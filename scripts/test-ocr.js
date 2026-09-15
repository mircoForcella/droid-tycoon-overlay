// Local OCR pipeline test: replicates src/main/ocr.ts exactly.
// Usage: node scripts/test-ocr.js <image.png>
const fs = require('fs')
const { PNG } = require('pngjs')
const { createWorker } = require('tesseract.js')

// Teal-chroma isolate (see src/main/ocr.ts): income popups are bright teal
// (~57,244,188) over dark pipes / bright sky. Luminance Otsu keeps the sky
// and fragments glyphs; this keeps only teal as black-on-white, 3x upscale.
function binarizeUpscale(src, w, h) {
  const scale = 3, W = w * scale, H = h * scale
  const png = new PNG({ width: W, height: H })
  for (let y = 0; y < H; y++) {
    const sy = Math.min(h - 1, (y / scale) | 0)
    for (let x = 0; x < W; x++) {
      const sx = Math.min(w - 1, (x / scale) | 0)
      const si = (sy * w + sx) * 4
      const r = src[si], g = src[si + 1], b = src[si + 2]
      const isText = g > 110 && g - r > 45 && b - r > 15
      const v = isText ? 0 : 255
      const o = (y * W + x) * 4
      png.data[o] = v; png.data[o + 1] = v; png.data[o + 2] = v; png.data[o + 3] = 255
    }
  }
  return PNG.sync.write(png)
}

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

// lines: [{text, bbox:{x0,y0,x1,y1}}] in cooked (2x) coords.
// frame: full-image geometry for rx/ry (0..1 relative). Mirrors ocr.ts.
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
    // Strict rate match: target rates ALWAYS end in /s. Accumulations like
    // "15.50B" or "128.48T" must never become spots.
    const strict = /([\d.]+\s*[kmbt]?\s*\/s)/gi
    let m, found = false
    while ((m = strict.exec(line.text)) !== null) { found = true; push(m[1], line) }
    // Whole-line fallback for "900Kl5"-style misreads ONLY: requires an /s
    // marker at END of line (or OCR-mangled l/I/1 + s/5). Blocks bare totals + HUD numbers.
    // Anchored: a bare "15" (1+5) must not count as l/1 + s/5.
    const hasRateMarker = /\/\s*s\s*$/i.test(line.text) || /[/lI17|]\s*[sS5]\s*$/.test(line.text)
    if (!found && hasRateMarker && /[\d]/.test(line.text) && line.text.length < 24) push(line.text, line)
  }
  const dist2 = (s) => (s.rx - 0.5) * (s.rx - 0.5) + (s.ry - 0.5) * (s.ry - 0.5)
  return spots.sort((a, b) => dist2(a) - dist2(b) || a.value - b.value)
}

(async () => {
  const imgPath = process.argv[2]
  const img = PNG.sync.read(fs.readFileSync(imgPath))
  console.log(`input ${img.width}x${img.height}`)
  // App-equivalent center crop 900x600 (clamped to image)
  const cw = Math.min(900, img.width), ch = Math.min(600, img.height)
  const cx = Math.floor((img.width - cw) / 2), cy = Math.floor((img.height - ch) / 2)
  const crop = new PNG({ width: cw, height: ch })
  PNG.bitblt(img, crop, cx, cy, cw, ch, 0, 0)
  const raw = Buffer.from(crop.data)
  console.log(`crop ${cw}x${ch} at ${cx},${cy}`)
  const cooked = binarizeUpscale(raw, cw, ch)
  fs.writeFileSync(require('path').join(__dirname, '..', 'test-cooked.png'), cooked)

  const t0 = Date.now()
  const worker = await createWorker('eng')
  console.log('worker-ready in=' + (Date.now() - t0) + 'ms')
  await worker.setParameters({
    tessedit_pageseg_mode: '6',
    tessedit_char_whitelist: '0123456789.KkMmBbTtSs/ ',
  })
  const t1 = Date.now()
  // blocks:true is required for bboxes (else all spots collapse to center)
  const { data } = await worker.recognize(cooked, {}, { blocks: true })
  console.log('recognize in=' + (Date.now() - t1) + 'ms')
  const lines = []
  for (const b of (data.blocks || [])) for (const p of (b.paragraphs || [])) for (const l of (p.lines || [])) lines.push(l)
  if (lines.length === 0 && (data.text || '').trim()) {
    const W = cw * 3, H = ch * 3
    for (const t of data.text.split('\n')) {
      if (t.trim().length === 0) continue
      lines.push({ text: t, bbox: { x0: 0, y0: 0, x1: W, y1: H } })
    }
  }
  console.log('lines=' + lines.length)
  lines.slice(0, 15).forEach((l, i) => console.log('L' + i + ': ' + JSON.stringify(l.text) + ' bbox=' + JSON.stringify(l.bbox)))
  const spots = extractSpots(lines, { frameW: img.width, frameH: img.height, originX: cx, originY: cy, upscale: 3 })
  console.log('SPOTS=' + JSON.stringify(spots))
  // Explain winner like App.tsx does (closest-first, first unique table match)
  spots.forEach((s, i) => {
    const d = Math.hypot(s.rx - 0.5, s.ry - 0.5)
    console.log(`rank${i}: ${s.text} = ${s.value} rx=${s.rx.toFixed(3)} ry=${s.ry.toFixed(3)} distCenter=${d.toFixed(3)}`)
  })
  await worker.terminate()
})().catch(e => { console.error('FATAL', e); process.exit(1) })
