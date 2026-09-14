// Copies tesseract runtime files into ocr-assets/ for packaging.
// Layout mirrors node resolution so the shipped worker finds its deps:
//   ocr-assets/tesseract.js/src/**            (worker script + relatives)
//   ocr-assets/node_modules/tesseract.js-core (engine js+wasm)
//   ocr-assets/node_modules/wasm-feature-detect
// Run: node scripts/copy-ocr-assets.js (also chained in `npm run build`).
const fs = require('fs')
const path = require('path')

const root = path.join(__dirname, '..')
const out = path.join(root, 'ocr-assets')

function copyDir(src, dest, filter) {
  fs.mkdirSync(dest, { recursive: true })
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name)
    const d = path.join(dest, entry.name)
    if (entry.isDirectory()) {
      copyDir(s, d, filter)
    } else if (!filter || filter(entry.name)) {
      fs.copyFileSync(s, d)
    }
  }
}

function copyFile(src, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true })
  fs.copyFileSync(src, dest)
}

const nm = path.join(root, 'node_modules')

// 1. worker script tree (relative requires stay intact)
copyDir(path.join(nm, 'tesseract.js', 'src'), path.join(out, 'tesseract.js', 'src'))

// 2. engine (js glue + wasm, all simd variants; getCore picks at runtime)
const coreSrc = path.join(nm, 'tesseract.js-core')
const coreDest = path.join(out, 'node_modules', 'tesseract.js-core')
for (const f of fs.readdirSync(coreSrc)) {
  if (f === 'package.json' || /^tesseract-core.*\.(js|wasm)$/.test(f)) {
    copyFile(path.join(coreSrc, f), path.join(coreDest, f))
  }
}

// 3. wasm-feature-detect (resolves via its package.json exports)
const wfdSrc = path.join(nm, 'wasm-feature-detect')
const wfdDest = path.join(out, 'node_modules', 'wasm-feature-detect')
copyFile(path.join(wfdSrc, 'package.json'), path.join(wfdDest, 'package.json'))
copyDir(path.join(wfdSrc, 'dist'), path.join(wfdDest, 'dist'))

// 4. small worker deps (bare requires on the node worker path)
const extraPkgs = ['regenerator-runtime', 'is-url', 'bmp-js']
for (const pkg of extraPkgs) {
  copyDir(path.join(nm, pkg), path.join(out, 'node_modules', pkg))
}

console.log('ocr-assets ready at', out)
