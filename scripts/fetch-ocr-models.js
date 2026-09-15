// Fetches PP-OCRv5 recognition model + dict into ocr-models/ for packaging.
// Skips files that already exist (dev machines keep them; CI downloads fresh).
// Run: node scripts/fetch-ocr-models.js (also chained in `npm run build`).
// Models load at runtime from <resources>/ocr-models (packaged) or <root>/ocr-models (dev).
const fs = require('fs')
const path = require('path')
const https = require('https')

const BASE = 'https://raw.githubusercontent.com/SotaTne/OnnxOcrJS/main/models/ppocrv5'
const FILES = [
  { url: `${BASE}/rec/rec.onnx`, dest: 'rec/rec.onnx', minBytes: 10_000_000 },
  { url: `${BASE}/det/det.onnx`, dest: 'det/det.onnx', minBytes: 1_000_000 },
  { url: `${BASE}/ppocrv5_dict.txt`, dest: 'ppocrv5_dict.txt', minBytes: 10_000 }
]

function fetchTo(url, dest) {
  return new Promise((resolve, reject) => {
    const go = (u) => {
      https.get(u, { headers: { 'User-Agent': 'droid-tycoon-overlay' } }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume()
          go(res.headers.location)
          return
        }
        if (res.statusCode !== 200) {
          res.resume()
          reject(new Error(`HTTP ${res.statusCode} for ${u}`))
          return
        }
        const chunks = []
        res.on('data', (c) => chunks.push(c))
        res.on('end', () => resolve(Buffer.concat(chunks)))
        res.on('error', reject)
      }).on('error', reject)
    }
    go(url)
  })
}

;(async () => {
  const out = path.join(__dirname, '..', 'ocr-models', 'ppocrv5')
  for (const f of FILES) {
    const dest = path.join(out, f.dest)
    try {
      const st = fs.statSync(dest)
      if (st.size >= f.minBytes) {
        console.log(`ok (cached): ${f.dest} ${st.size}B`)
        continue
      }
      console.log(`too small, re-fetching: ${f.dest}`)
    } catch {}
    console.log(`fetching ${f.url}`)
    const buf = await fetchTo(f.url, dest)
    if (buf.length < f.minBytes) throw new Error(`suspiciously small ${f.dest}: ${buf.length}B`)
    fs.mkdirSync(path.dirname(dest), { recursive: true })
    fs.writeFileSync(dest, buf)
    console.log(`saved: ${f.dest} ${buf.length}B`)
  }
  console.log('ocr-models ready at', out)
})().catch((e) => { console.error('FATAL', e.message); process.exit(1) })
