import { app, BrowserWindow, screen, globalShortcut, ipcMain, Tray, Menu, nativeImage } from 'electron'
import { PNG } from 'pngjs'
import Store from 'electron-store'
import { autoUpdater } from 'electron-updater'
import { join } from 'path'
import { fileURLToPath } from 'url'
import { appendFileSync } from 'fs'
import { captureGameWindow, detectDroids, loadTemplates, getLoadedTemplates, scanBase } from './capture'
import { spotIncomes } from './ocr'

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
  tray.setToolTip('Droid Tycoon Overlay (F1 show/hide)')
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

  globalShortcut.register('F1', () => toggleVisibility())
  globalShortcut.register('F2', () => toggleClickThrough())
  // Tabs left-to-right: F3 Droids, F4 Rebirth, F5 Calculator, F6 Setup, F7 Timers (last)
  globalShortcut.register('F3', () => broadcast('open-tab', 'droids'))
  globalShortcut.register('F4', () => broadcast('open-tab', 'rebirth'))
  globalShortcut.register('F5', () => broadcast('open-tab', 'calculator'))
  globalShortcut.register('F6', () => broadcast('open-tab', 'settings'))
  globalShortcut.register('F7', () => broadcast('open-tab', 'timers'))
  globalShortcut.register('F8', () => broadcast('toggle-collapse'))
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

  globalShortcut.register('F9', async () => {
    broadcast('spot-status', 'started')
    log('ocr spot started (F9)')
    try {
      const { spots, meta } = await spotIncomes(displayFilter === 'all' ? null : displayFilter)
      broadcast('income-spots', spots)
      log(`ocr spots=${spots.length} pass=${meta.pass} frame=${meta.frameW}x${meta.frameH} lines=${meta.lines} sample=${meta.sample}`)
    } catch (e) {
      log(`ocr error: ${e}`)
      broadcast('income-spots', [])
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
  // Press again to hand control back to the game.
  ipcMain.on('toggle-type-mode', () => {
    const toInteractive = isClickThrough
    setInteractive(toInteractive)
    if (toInteractive) broadcast('focus-input')
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
