// Runs scripts/sell-planner.test.ts with zero new dependencies: compiles the
// test plus its src graph with the project's own tsc into a temp dir, runs
// the result with node, then cleans up. Exit code mirrors the test outcome.
const { execFileSync } = require('child_process')
const fs = require('fs')
const path = require('path')

const ROOT = path.join(__dirname, '..')
const TMP = path.join(__dirname, '.tmp-planner-test')

let code = 0
try {
  fs.rmSync(TMP, { recursive: true, force: true })
  execFileSync(
    process.execPath,
    [
      path.join(ROOT, 'node_modules', 'typescript', 'bin', 'tsc'),
      path.join(__dirname, 'sell-planner.test.ts'),
      '--outDir', TMP,
      '--module', 'commonjs',
      '--target', 'es2022',
      '--moduleResolution', 'node',
      '--strict',
      '--skipLibCheck',
    ],
    { cwd: ROOT, stdio: 'inherit' }
  )
  require(path.join(TMP, 'scripts', 'sell-planner.test.js'))
} catch (err) {
  console.error(err && err.message ? err.message : err)
  code = 1
}
try {
  fs.rmSync(TMP, { recursive: true, force: true })
} catch {
  /* ignore cleanup failures */
}
process.exit(code)
