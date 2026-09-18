import { app, BrowserWindow, screen, globalShortcut, ipcMain, Tray, Menu, nativeImage } from 'electron'
import { PNG } from 'pngjs'
import Store from 'electron-store'
import { autoUpdater } from 'electron-updater'
import { join } from 'path'
import { fileURLToPath } from 'url'
import { appendFileSync } from 'fs'
import { captureGameWindow, detectDroids, loadTemplates, getLoadedTemplates, scanBase } from './capture'
import { spotIncomes, warmupOcr } from './ocr'

const __dirname = join(fileURLToPath(import.meta.url), '..')

let windows: BrowserWindow[] = []
let timerWin: BrowserWindow | null = null
let isClickThrough = true
let isVisible = true
const prefs = new Store({ name: 'window-prefs' })

function logPath() {
  try {
    return join(app.getPath('userData'), 'app.log')
  } catch {
    return null
  }
}

function log(msg: string) {
  const p = logPath()
  const line = `[${new Date().toISOString()}] ${msg}\n`
  try {
    if (p) appendFileSync(p, line)
  } catch {}
  console.log(line.trim())
}

function loadTarget(win: BrowserWindow) {
  if (app.isPackaged) {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  } else {
    win.loadURL('http://localhost:5173')
  }
}

function broadcast(channel: string, ...args: unknown[]) {
  for (const w of allWindows()) {
    try {
      w.webContents.send(channel, ...args)
    } catch {}
  }
}

// Force a compositor repaint. Transparent always-on-top windows can keep a
// stale DWM frame after state flips (collapse toggles, click-through
// focus/mouse-event flips, window rebuilds): content shrinks or shifts a few
// px and the old pixels stay painted ("moved but left the original behind").
// Invalidate is cheap and targeted — call after every such transition.
function repaint(w: BrowserWindow) {
  try {
    w.webContents.invalidate()
  } catch {}
}

// ---- In-app updates (electron-updater + GitHub Releases) ----
// Downloads in the background, never force-restarts: the user installs
// from the Setup tab when ready (or it applies on quit).
export type UpdateStatus =
  | { state: 'idle' }
  | { state: 'checking' }
  | { state: 'available'; version: string }
  | { state: 'up-to-date'; version: string }
  | { state: 'downloading'; version: string; percent: number }
  | { state: 'ready'; version: string }
  | { state: 'error'; message: string }
  | { state: 'dev' }

function updateStatus(s: UpdateStatus) {
  broadcast('update-status', s)
}

function setupAutoUpdater() {
  try {
    autoUpdater.autoDownload = true
    autoUpdater.autoInstallOnAppQuit = true
    autoUpdater.logger = { info: (m: unknown) => log(`updater ${m}`), warn: (m: unknown) => log(`updater warn ${m}`), error: (m: unknown) => log(`updater error ${m}`), debug: (m: unknown) => log(`updater dbg ${m}`) } as typeof autoUpdater.logger
    let pendingVersion = ''
    autoUpdater.on('checking-for-update', () => updateStatus({ state: 'checking' }))
    autoUpdater.on('update-available', (info) => {
      pendingVersion = String(info?.version ?? '')
      log(`updater available ${pendingVersion}`)
      updateStatus({ state: 'available', version: pendingVersion })
    })
    autoUpdater.on('update-not-available', (info) => {
      updateStatus({ state: 'up-to-date', version: String(info?.version ?? app.getVersion()) })
    })
    autoUpdater.on('download-progress', (p) => {
      updateStatus({ state: 'downloading', version: pendingVersion, percent: Math.round(p?.percent ?? 0) })
    })
    autoUpdater.on('update-downloaded', (info) => {
      log(`updater downloaded ${info?.version}`)
      updateStatus({ state: 'ready', version: String(info?.version ?? '') })
    })
    autoUpdater.on('error', (e) => {
      log(`updater error: ${e}`)
      updateStatus({ state: 'error', message: String((e as Error)?.message ?? e) })
    })
  } catch (e) {
    log(`updater setup failed: ${e}`)
  }
}

async function manualCheckForUpdates(): Promise<void> {
  if (!app.isPackaged) {
    updateStatus({ state: 'dev' })
    return
  }
  try {
    await autoUpdater.checkForUpdates()
  } catch (e) {
    log(`updater check failed: ${e}`)
    updateStatus({ state: 'error', message: String((e as Error)?.message ?? e) })
  }
}

let displayFilter: 'all' | number = 'all'

function buildWindow(x: number, y: number, w: number, h: number): BrowserWindow {
  const win = new BrowserWindow({
    x, y, width: w, height: h,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    focusable: false,
    resizable: false,
    movable: false,
    fullscreenable: false,
    hasShadow: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })
  win.setIgnoreMouseEvents(isClickThrough, { forward: true })
  win.setMenuBarVisibility(false)
  win.setAlwaysOnTop(true, 'screen-saver')
  win.webContents.on('did-finish-load', () => log(`renderer loaded OK (${w}x${h})`))
  win.webContents.on('did-fail-load', (_e, code, desc) => log(`renderer FAILED ${code} ${desc}`))
  loadTarget(win)
  return win
}

function createOverlayWindows() {
  recreateWindows()
}

let appQuitting = false

function destroyWindows() {
  for (const w of windows) {
    try {
      w.removeAllListeners('closed')
      w.destroy()
    } catch {}
  }
  windows = []
}

// Build the new set BEFORE tearing down the old one, so a transient
// display event can never leave zero windows (which would quit the app).
function recreateWindows() {
  const fresh: BrowserWindow[] = []
  try {
    const all = screen.getAllDisplays()
    const displays = displayFilter === 'all' ? all : all.filter(d => d.id === displayFilter)
    const target = displays.length > 0 ? displays : all
    if (target.length === 0) {
      log('recreate skipped: no displays reported')
      return
    }
    for (const d of target) {
      fresh.push(buildWindow(d.bounds.x, d.bounds.y, d.bounds.width, d.bounds.height))
    }
  } catch (e) {
    log(`recreate failed: ${e}`)
    return
  }
  destroyWindows()
  windows = fresh
  applyClickThrough()
  for (const w of windows) repaint(w)
  log(`overlay windows recreated: ${windows.length}`)
}

// Floating timer window: frameless, no chrome, just the 3 rectangles.
// Bounds persist across restarts; drag it anywhere while interactive.
function createTimerWindow() {
  if (timerWin && !timerWin.isDestroyed()) return
  const primary = screen.getPrimaryDisplay()
  const saved = prefs.get('timerBounds', null) as { x: number; y: number; w: number; h: number } | null
  const W = saved?.w ?? 300
  const H = saved?.h ?? 100
  const x = saved?.x ?? Math.round(primary.bounds.x + (primary.bounds.width - W) / 2)
  const y = saved?.y ?? (primary.bounds.y + 24)
  timerWin = new BrowserWindow({
    x, y, width: W, height: H,
    minWidth: 160, minHeight: 60,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    focusable: false,
    resizable: true,
    movable: true,
    fullscreenable: false,
    hasShadow: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })
  timerWin.setIgnoreMouseEvents(isClickThrough, { forward: true })
  timerWin.setMenuBarVisibility(false)
  timerWin.setAlwaysOnTop(true, 'screen-saver')
  if (!isVisible) timerWin.hide()
  let saveT: NodeJS.Timeout | null = null
  const saveBounds = () => {
    if (saveT) clearTimeout(saveT)
    saveT = setTimeout(() => {
      try {
        if (timerWin && !timerWin.isDestroyed()) {
          const [bx, by] = timerWin.getPosition()
          const [bw, bh] = timerWin.getSize()
          prefs.set('timerBounds', { x: bx, y: by, w: bw, h: bh })
        }
      } catch {}
    }, 500)
  }
  timerWin.on('moved', saveBounds)
  timerWin.on('resized', saveBounds)
  timerWin.webContents.on('did-finish-load', () => log('timer window loaded OK'))
  timerWin.webContents.on('did-fail-load', (_e, code, desc) => log(`timer window FAILED ${code} ${desc}`))
  if (app.isPackaged) {
    timerWin.loadFile(join(__dirname, '../renderer/index.html'), { hash: 'timers' })
  } else {
    timerWin.loadURL('http://localhost:5173/#timers')
  }
  log('timer window created')
}

function destroyTimerWindow() {
  try {
    timerWin?.destroy()
  } catch {}
  timerWin = null
  log('timer window destroyed')
}

function setTimersDetached(detached: boolean) {
  if (detached) createTimerWindow()
  else destroyTimerWindow()
  broadcast('timers-detached-changed', detached)
}

// ---- Spot match popup: its own centered window (never inside the panel) ----
// Opens only when an F9/Button read matches table entries. Transparent and
// chromeless like the timer float: just cards + station buttons floating.
interface SpotPayload {
  text: string
  value: number
  rx: number
  ry: number
}

let spotWin: BrowserWindow | null = null
let pendingSpots: SpotPayload[] = []
let spotReqSeq = 0
const spotReqs = new Map<number, (res: { ok: boolean; message: string }) => void>()

function openSpotWindow(spots: SpotPayload[]) {
  pendingSpots = spots
  // The popup stands alone: it is its own focusable window with mouse events
  // enabled, its own focus() call below, and popup-scoped digit/Enter/Escape
  // keys via globalShortcut (they fire no matter which window has focus).
  // The overlay panels are deliberately left untouched — flipping them to
  // interactive here used to yank every panel window to the foreground on
  // every monitor (w.focus() per window) on each F9 match, which reads as
  // "the overlay opening on both monitors". Panels stay click-through and
  // exactly as they were (minimized stays minimized) while the popup works.
  if (spotWin && !spotWin.isDestroyed()) {
    try {
      spotWin.setIgnoreMouseEvents(false)
      spotWin.setFocusable(true)
      spotWin.webContents.send('spot-data', spots)
      spotWin.showInactive()
      spotWin.moveTop()
      spotWin.focus()
      registerSpotKeys()
    } catch {}
    return
  }
  // Center the popup on the display the user is AIMING at (cursor position),
  // not the Windows primary. F9 UX is "aim at the droid": the cursor is on
  // the game screen by definition, while the primary is often the other
  // monitor — the old primary-always code opened the popup on the wrong
  // screen with no way to reach it mid-game.
  const anchor = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
  const W = 600
  const H = 700
  const x = Math.round(anchor.bounds.x + (anchor.bounds.width - W) / 2)
  const y = Math.max(anchor.bounds.y, Math.round(anchor.bounds.y + (anchor.bounds.height - H) / 2))
  spotWin = new BrowserWindow({
    x, y, width: W, height: H,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    focusable: true,
    resizable: false,
    movable: true,
    fullscreenable: false,
    hasShadow: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })
  spotWin.setMenuBarVisibility(false)
  spotWin.setAlwaysOnTop(true, 'screen-saver')
  spotWin.on('closed', () => {
    spotWin = null
  })
  spotWin.webContents.on('did-finish-load', () => {
    log('spot window loaded OK')
    try {
      spotWin?.webContents.send('spot-data', pendingSpots)
    } catch {}
  })
  spotWin.webContents.on('did-fail-load', (_e, code, desc) => log(`spot window FAILED ${code} ${desc}`))
  if (app.isPackaged) {
    spotWin.loadFile(join(__dirname, '../renderer/index.html'), { hash: 'spot' })
  } else {
    spotWin.loadURL('http://localhost:5173/#spot')
  }
  try {
    spotWin.showInactive()
  } catch {}
  try {
    spotWin.setIgnoreMouseEvents(false)
    spotWin.setFocusable(true)
    spotWin.focus()
    registerSpotKeys()
  } catch {}
  log('spot window created')
}

function closeSpotWindow() {
  unregisterSpotKeys()
  try {
    spotWin?.destroy()
  } catch {}
  spotWin = null
}

// Ephemeral drive for the spot window: digits pick, Enter confirms,
// Backspace/Esc step back out. Registered only while the popup is open so
// game keys are untouched the rest of the time.
function registerSpotKeys() {
  unregisterSpotKeys()
  const fwd = (key: string) => {
    try {
      spotWin?.webContents.send('spot-key', key)
    } catch {}
  }
  const bindings: Array<[string, string]> = [
    ['1', '1'], ['2', '2'], ['3', '3'], ['4', '4'], ['5', '5'],
    ['6', '6'], ['7', '7'], ['8', '8'], ['9', '9'],
    ['Enter', 'Enter'], ['Escape', 'Escape'], ['Backspace', 'Backspace']
  ]
  for (const [accel, key] of bindings) {
    try {
      globalShortcut.register(accel, () => fwd(key))
    } catch {}
  }
}

function unregisterSpotKeys() {
  for (const accel of ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'Enter', 'Escape', 'Backspace']) {
    try {
      globalShortcut.unregister(accel)
    } catch {}
  }
}

// Placement runs in ONE panel window (first on the primary display) —
// broadcasting the request to every panel would place N times.
function spotPanelTarget(): BrowserWindow | null {
  const alive = windows.filter(w => !w.isDestroyed())
  if (alive.length === 0) return null
  try {
    const primaryId = screen.getPrimaryDisplay().id
    return alive.find(w => screen.getDisplayMatching(w.getBounds()).id === primaryId) ?? alive[0]
  } catch {
    return alive[0]
  }
}

function allWindows(): BrowserWindow[] {
  return timerWin ? [...windows, timerWin] : windows
}

function applyClickThrough() {
  for (const w of allWindows()) {
    try {
      w.setIgnoreMouseEvents(isClickThrough, { forward: true })
      w.setFocusable(!isClickThrough)
    } catch {}
  }
}

// Interactive mode = mouse AND keyboard go to the overlay.
// focusable:false windows can never receive keystrokes, so typing
// requires flipping focusable + focusing the window (borderless-safe).
function setInteractive(enabled: boolean) {
  isClickThrough = !enabled
  for (const w of allWindows()) {
    try {
      if (enabled) {
        w.setFocusable(true)
        w.setIgnoreMouseEvents(false)
        w.focus()
      } else {
        // Hand focus back to the game explicitly: no click needed,
        // overlay stays exactly as it is.
        w.blur()
        w.setFocusable(false)
        w.setIgnoreMouseEvents(true, { forward: true })
      }
    } catch (e) {
      log(`interactive error: ${e}`)
    }
  }
  broadcast('click-through-changed', isClickThrough)
  for (const w of allWindows()) repaint(w)
  log(`interactive=${enabled}`)
}

function toggleClickThrough() {
  setInteractive(isClickThrough)
}

function toggleVisibility() {
  isVisible = !isVisible
  for (const w of allWindows()) {
    try {
      if (isVisible) {
        w.show()
        w.moveTop()
        repaint(w)
      } else {
        w.hide()
      }
    } catch {}
  }
  log(`visible=${isVisible}`)
}

let tray: Tray | null = null

// Gold rounded-square "D" glyph, generated at runtime (no asset files needed).
function makeTrayIcon(): Electron.NativeImage {
  const S = 32
  const png = new PNG({ width: S, height: S })
  const gold: [number, number, number] = [255, 200, 50]
  const dark: [number, number, number] = [10, 10, 20]
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const edge = x < 2 || y < 2 || x >= S - 2 || y >= S - 2
      // Letter "D": left bar + right curve approximation
      const inBar = x >= 8 && x < 13 && y >= 7 && y < 25
      const dx = x - 13
      const dy = y - 16
      const inCurve = !inBar && dx >= 0 && dx * dx * 1.4 + dy * dy * 0.55 < 64 && dx * dx * 1.4 + dy * dy * 0.55 > 18
      const fg = edge || inBar || inCurve
      const [r, g, b] = fg ? (edge ? dark : gold) : dark
      const o = (y * S + x) * 4
      png.data[o] = r
      png.data[o + 1] = g
      png.data[o + 2] = b
      png.data[o + 3] = edge ? 255 : fg ? 255 : 160
    }
  }
  return nativeImage.createFromBuffer(PNG.sync.write(png))
}

function setupTray() {
  if (tray) return
  try {
    tray = new Tray(makeTrayIcon())
  } catch (e) {
    log(`tray failed: ${e}`)
    return
  }
  tray.setToolTip('Droid Tycoon Overlay (F1 minimize/restore)')
  const menu = Menu.buildFromTemplate([
    {
      label: 'Show overlay',
      click: () => {
        if (!isVisible) toggleVisibility()
        if (windows.length === 0) createOverlayWindows()
      }
    },
    {
      label: 'Hide overlay',
      click: () => {
        if (isVisible) toggleVisibility()
      }
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        appQuitting = true
        app.quit()
      }
    }
  ])
  tray.setContextMenu(menu)
  tray.on('click', () => toggleVisibility())
  log('tray ready')
}

// Single instance: a second launch (double-clicked shortcut while running)
// used to boot a FULL second app — its own overlay windows on every monitor
// (filter defaults to 'all' until the saved primary-only pref re-applies,
// and the second renderer sometimes never gets that far), its own tray icon,
// and stolen/duplicated global hotkeys. Hand off to the running instance
// instead: nudge its windows to the top so the launch visibly "did something".
const gotSingleLock = app.requestSingleInstanceLock()
if (!gotSingleLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    log('second launch ignored (single instance)')
    for (const w of allWindows()) {
      try {
        if (!w.isDestroyed() && w.isVisible()) w.moveTop()
      } catch {}
    }
  })
}

app.whenReady().then(async () => {
  log(`app ready, packaged=${app.isPackaged}`)
  setupAutoUpdater()

  const fs = await import('fs/promises')
  const userTemplates = join(app.getPath('userData'), 'templates')
  try {
    await fs.mkdir(userTemplates, { recursive: true })
    await fs.writeFile(
      join(userTemplates, 'PUT_CROPS_HERE.txt'),
      'Crop each droid as seen in-game (~64x64px) and save here as <droid-id>.png\n',
      { flag: 'wx' }
    ).catch(() => {})
  } catch {}
  await loadTemplates(userTemplates)
  await loadTemplates(join(__dirname, '../../templates'))

  createOverlayWindows()
  // Timers live detached by default; renderer sends its saved pref on load.
  createTimerWindow()

  globalShortcut.register('F1', () => {
    broadcast('toggle-collapse')
    // Collapse swaps the full panel for a 44px pull-tab (or back): repaint
    // so the old large frame can't linger as a ghost.
    for (const w of allWindows()) repaint(w)
  })
  globalShortcut.register('F2', () => toggleClickThrough())
  // Tabs left-to-right: F3 Droids, F4 Rebirth, F5 Calculator, F6 Setup, F7 Timers (last)
  globalShortcut.register('F3', () => broadcast('open-tab', 'droids'))
  globalShortcut.register('F4', () => broadcast('open-tab', 'rebirth'))
  globalShortcut.register('F5', () => broadcast('open-tab', 'calculator'))
  globalShortcut.register('F6', () => broadcast('open-tab', 'settings'))
  globalShortcut.register('F7', () => broadcast('open-tab', 'timers'))
  globalShortcut.register('F8', () => {
    broadcast('toggle-collapse')
    for (const w of allWindows()) repaint(w)
  })
  globalShortcut.register('F10', () => {
    const toInteractive = isClickThrough
    setInteractive(toInteractive)
    if (!toInteractive) return
    broadcast('focus-input')
    // Games often reclaim foreground instantly; re-assert a couple of times.
    for (const ms of [200, 500]) {
      setTimeout(() => {
        if (isClickThrough) return
        for (const w of windows) {
          try {
            w.focus()
          } catch {}
        }
        broadcast('focus-input')
      }, ms)
    }
  })
  // Spot incomes without moving the mouse: hover the droid in-game
  // (click-through ON so the game sees the cursor), press F9.
  setupTray()

  // F9 overlap guard: Tesseract fallback can take 12s+ on noisy frames and
  // users mash F9. Without this, concurrent spotIncomes runs pile up (each
  // re-running glyphs + PP-OCR + Tesseract) and the log fills with
  // interleaved passes. One flight at a time; extra presses are ignored.
  let spotRunning = false
  globalShortcut.register('F9', async () => {
    if (spotRunning) {
      log('ocr spot ignored (F9): previous read still running')
      return
    }
    spotRunning = true
    broadcast('spot-status', 'started')
    log('ocr spot started (F9)')
    try {
      const { spots, meta } = await spotIncomes(displayFilter === 'all' ? null : displayFilter)
      broadcast('income-spots', spots)
      log(`ocr spots=${spots.length} pass=${meta.pass} frame=${meta.frameW}x${meta.frameH} lines=${meta.lines} sample=${meta.sample}`)
    } catch (e) {
      log(`ocr error: ${e}`)
      broadcast('income-spots', [])
    } finally {
      spotRunning = false
    }
  })
  log('hotkeys registered')

  screen.on('display-added', () => recreateWindows())
  screen.on('display-removed', () => recreateWindows())

  // Background update check shortly after launch (packaged builds only).
  // Never interrupts the game: new versions download silently and wait.
  if (app.isPackaged) {
    setTimeout(() => { manualCheckForUpdates() }, 20000)
  }
  // Warm up OCR engines while idle so the first F9 pays no init cost.
  setTimeout(() => {
    warmupOcr().catch(e => log(`ocr warmup failed (first F9 will be slower): ${e}`))
  }, 10000)

  ipcMain.handle('get-version', () => app.getVersion())
  ipcMain.handle('check-for-updates', () => manualCheckForUpdates())
  ipcMain.on('quit-and-install', () => {
    try {
      autoUpdater.quitAndInstall(false, true)
    } catch (e) {
      log(`quit-and-install failed: ${e}`)
    }
  })

  ipcMain.on('set-click-through', (_, value: boolean) => {
    setInteractive(!value)
  })

  ipcMain.on('set-visible', (_, value: boolean) => {
    if (isVisible === value) return
    toggleVisibility()
  })
  // F10 "type now": go interactive and focus whatever input is relevant.
  // Press again to wipe the inputs and hand control back to the game.
  ipcMain.on('toggle-type-mode', () => {
    const toInteractive = isClickThrough
    setInteractive(toInteractive)
    if (toInteractive) broadcast('focus-input')
    else broadcast('clear-inputs')
  })

  ipcMain.handle('get-displays', () => {
    const primaryId = screen.getPrimaryDisplay().id
    return screen.getAllDisplays().map((d, i) => ({
      id: d.id,
      label: `Display ${i + 1} (${d.bounds.width}x${d.bounds.height})`,
      primary: d.id === primaryId
    }))
  })

  ipcMain.on('set-overlay-display', (_, value: 'all' | number) => {
    if (displayFilter === value) return // fresh panels re-send the saved choice; no rebuild needed
    displayFilter = value
    recreateWindows()
    log(`overlay display filter=${value}`)
  })

  // Live Scan loop (user-toggled, overlap-guarded)
  let scanTimer: NodeJS.Timeout | null = null
  let scanRunning = false
  const runScan = async () => {
    if (scanRunning) return
    scanRunning = true
    try {
      const matches = await scanBase()
      broadcast('detection-update', { at: Date.now(), matches })
    } catch (e) {
      log(`scan error: ${e}`)
    } finally {
      scanRunning = false
    }
  }
  const setLiveScan = (enabled: boolean, intervalMs = 5000) => {
    if (scanTimer) { clearInterval(scanTimer); scanTimer = null }
    if (enabled) {
      const ms = Math.max(2000, Math.min(30000, intervalMs || 5000))
      runScan()
      scanTimer = setInterval(runScan, ms)
    }
    broadcast('live-scan-changed', enabled)
    log(`live-scan=${enabled}`)
  }

  ipcMain.on('set-timers-detached', (_, detached: boolean) => setTimersDetached(detached))

  ipcMain.on('set-timer-opacity', (_, value: number) => broadcast('timer-opacity-changed', value))

  ipcMain.on('set-live-scan', (_, enabled: boolean, intervalMs: number) => setLiveScan(enabled, intervalMs))
  ipcMain.on('scan-once', () => { runScan() })

  ipcMain.handle('ocr-spot-income', async () => {
    try {
      const { spots, meta } = await spotIncomes(displayFilter === 'all' ? null : displayFilter)
      log(`ocr spots=${spots.length} pass=${meta.pass} frame=${meta.frameW}x${meta.frameH} lines=${meta.lines} sample=${meta.sample}`)
      return { spots, meta }
    } catch (e) {
      log(`ocr error: ${e}`)
      return { spots: [], meta: { frameW: 0, frameH: 0, lines: 0, sample: `error: ${e}` } }
    }
  })

  ipcMain.handle('open-spot-window', (_, spots: SpotPayload[]) => {
    openSpotWindow(Array.isArray(spots) ? spots : [])
  })
  ipcMain.handle('get-spot-data', () => pendingSpots)
  ipcMain.handle('spot-place', async (_, payload: { droidId: string; quality: string; station: string }) => {
    const target = spotPanelTarget()
    if (!target) return { ok: false, message: 'Overlay panel is not running.' }
    const reqId = ++spotReqSeq
    const res = await new Promise<{ ok: boolean; message: string }>(resolve => {
      spotReqs.set(reqId, resolve)
      try {
        target.webContents.send('spot-place-request', { ...payload, reqId })
      } catch {
        spotReqs.delete(reqId)
        resolve({ ok: false, message: 'Could not reach the overlay panel.' })
        return
      }
      setTimeout(() => {
        if (spotReqs.has(reqId)) {
          spotReqs.delete(reqId)
          resolve({ ok: false, message: 'Panel did not respond in time.' })
        }
      }, 8000)
    })
    return res
  })
  ipcMain.on('spot-place-done', (_, res: { reqId: number; ok: boolean; message: string }) => {
    const r = spotReqs.get(res?.reqId)
    if (r) {
      spotReqs.delete(res.reqId)
      r({ ok: !!res.ok, message: String(res.message ?? '') })
    }
  })
  ipcMain.on('spot-close', () => closeSpotWindow())

  ipcMain.handle('capture-game-window', async () => {
    const png = await captureGameWindow()
    return png ? png.toString('base64') : null
  })

  ipcMain.handle('detect-droids', async (_, region: { x: number; y: number; width: number; height: number }) => {
    return detectDroids(region)
  })

  ipcMain.handle('get-droid-templates', () => {
    return getLoadedTemplates().map(t => ({ id: t.id, name: t.name, category: t.category }))
  })

  ipcMain.handle('save-droid-template', async (_, name: string, data: string) => {
    const f = await import('fs/promises')
    await f.mkdir(userTemplates, { recursive: true })
    const buffer = Buffer.from(data, 'base64')
    await f.writeFile(join(userTemplates, `${name}.png`), buffer)
    await loadTemplates(userTemplates)
    return true
  })

  app.on('activate', () => {
    if (windows.length === 0) createOverlayWindows()
  })
})

app.on('window-all-closed', () => {
  // This is a persistent overlay: windows are code-managed (display
  // changes, monitor filter), so never treat "no windows" as quit intent.
  // The app exits via Task Manager / installer uninstall.
  if (appQuitting) {
    globalShortcut.unregisterAll()
    if (process.platform !== 'darwin') app.quit()
    return
  }
  log('all windows closed unexpectedly — recreating')
  createOverlayWindows()
})
