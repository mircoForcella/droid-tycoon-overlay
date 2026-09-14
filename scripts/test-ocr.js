// Local OCR pipeline test: replicates src/main/ocr.ts exactly.
// Usage: node scripts/test-ocr.js <image.png>
const fs = require('fs')
const { PNG } = require('pngjs')
const { createWorker } = require('tesseract.js')

function binarizeUpscale(src, w, h) {
  const n = w * h
  const lum = new Uint8Array(n)
  for (let i = 0; i < n; i++) {
    lum[i] = (src[i * 4] * 77 + src[i * 4 + 1] * 150 + src[i * 4 + 2] * 29) >> 8
  }
  const hist = new Array(256).fill(0)
  for (let i = 0; i < n; i++) hist[lum[i]]++
  let sum = 0
  for (let t = 0; t < 256; t++) sum += t * hist[t]
  let sumB = 0, wB = 0, best = -1, thresh = 128
  for (let t = 0; t < 256; t++) {
    wB += hist[t]
    if (wB === 0) continue
    const wF = n - wB
    if (wF === 0) break
    sumB += t * hist[t]
    const mB = sumB / wB, mF = (sum - sumB) / wF
    const between = wB * wF * (mB - mF) * (mB - mF)
    if (between > best) { best = between; thresh = t }
  }
  console.log('otsu-threshold=' + thresh)
  const scale = 2, W = w * scale, H = h * scale
  const png = new PNG({ width: W, height: H })
  for (let y = 0; y < H; y++) {
    const sy = Math.min(h - 1, (y / scale) | 0)
    for (let x = 0; x < W; x++) {
      const sx = Math.min(w - 1, (x / scale) | 0)
      const v = lum[sy * w + sx] > thresh ? 255 : 0
      const o = (y * W + x) * 4
      png.data[o] = v; png.data[o + 1] = v; png.data[o + 2] = v; png.data[o + 3] = 255
    }
  }
  return PNG.sync.write(png)
}

function parseIncomeText(text) {
  const m = text.toLowerCase().replace(/\/s\s*$/, '').trim().match(/^([\d.]+)\s*([kmb])?$/)
  if (!m) return null
  const mult = m[2] === 'k' ? 1e3 : m[2] === 'm' ? 1e6 : m[2] === 'b' ? 1e9 : 1
  const v = parseFloat(m[1]) * mult
  return v > 0 ? v : null
}

function parseFuzzyIncome(text) {
  const m = text.trim().match(/^([\d.]+)\s*([kKmMbB])\s*[/lI17|]\s*[sS5]?$/)
  if (!m) return null
  const mult = m[2].toLowerCase() === 'k' ? 1e3 : m[2].toLowerCase() === 'm' ? 1e6 : 1e9
  const v = parseFloat(m[1]) * mult
  return v > 0 ? v : null
}

function extractSpots(lines) {
  const spots = []
  const push = (raw) => {
    const value = parseIncomeText(raw) ?? parseFuzzyIncome(raw)
    if (value === null) return
    if (spots.some(s => Math.abs(s.value - value) / value < 0.001)) return
    spots.push({ text: raw.trim(), value })
  }
  for (const line of lines) {
    const strict = /([\d.]+\s*[kmb]?\s*\/s)/gi
    let m, found = false
    while ((m = strict.exec(line)) !== null) { found = true; push(m[1]) }
    if (!found && /[\d]/.test(line) && line.length < 24) push(line)
  }
  return spots.sort((a, b) => a.value - b.value)
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
  const t1 = Date.now()
  const { data } = await worker.recognize(cooked)
  console.log('recognize in=' + (Date.now() - t1) + 'ms')
  const lines = []
  for (const b of (data.blocks || [])) for (const p of (b.paragraphs || [])) for (const l of (p.lines || [])) lines.push(l.text)
  if (lines.length === 0 && (data.text || '').trim()) {
    for (const t of data.text.split('\n')) if (t.trim()) lines.push(t)
  }
  console.log('lines=' + lines.length)
  lines.slice(0, 15).forEach((t, i) => console.log('L' + i + ': ' + JSON.stringify(t)))
  const spots = extractSpots(lines)
  console.log('SPOTS=' + JSON.stringify(spots))
  await worker.terminate()
})().catch(e => { console.error('FATAL', e); process.exit(1) })
