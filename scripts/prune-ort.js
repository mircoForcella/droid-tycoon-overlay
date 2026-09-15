// Prunes onnxruntime-node binaries to win32-x64 before packaging.
// The npm package ships every platform (~287MB); this app only ever runs
// the Windows x64 build, and electron-builder would otherwise bundle it all.
// Safe: the loader resolves the current platform path only.
// Run: node scripts/prune-ort.js (chained in `npm run build`, after fetch).
const fs = require('fs')
const path = require('path')

const bin = path.join(__dirname, '..', 'node_modules', 'onnxruntime-node', 'bin', 'napi-v6')
if (!fs.existsSync(bin)) {
  console.log('onnxruntime-node binaries not found, skipping prune')
  process.exit(0)
}
let freed = 0
for (const entry of fs.readdirSync(bin, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue
  const platformDir = path.join(bin, entry.name)
  if (entry.name === 'win32') {
    for (const arch of fs.readdirSync(platformDir, { withFileTypes: true })) {
      if (arch.isDirectory() && arch.name !== 'x64') {
        const p = path.join(platformDir, arch.name)
        const size = dirSize(p)
        fs.rmSync(p, { recursive: true, force: true })
        freed += size
        console.log(`pruned ${entry.name}/${arch.name} (${(size / 1048576).toFixed(1)}MB)`)
      }
    }
    continue
  }
  const size = dirSize(platformDir)
  fs.rmSync(platformDir, { recursive: true, force: true })
  freed += size
  console.log(`pruned ${entry.name}/ (${(size / 1048576).toFixed(1)}MB)`)
}
console.log(`prune done, freed ${(freed / 1048576).toFixed(1)}MB`)

function dirSize(p) {
  let total = 0
  for (const e of fs.readdirSync(p, { withFileTypes: true })) {
    const full = path.join(p, e.name)
    if (e.isDirectory()) total += dirSize(full)
    else {
      try {
        total += fs.statSync(full).size
      } catch {}
    }
  }
  return total
}
