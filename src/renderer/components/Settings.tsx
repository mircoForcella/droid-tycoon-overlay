import { useEffect, useState } from 'react'
import { useStore } from '../store'

type UpdateState = { state: string; version?: string; percent?: number; message?: string }

function UpdatesSection() {
  const [version, setVersion] = useState('')
  const [status, setStatus] = useState<UpdateState>({ state: 'idle' })

  useEffect(() => {
    window.electronAPI?.getVersion?.()?.then(v => setVersion(v)).catch(() => {})
    const unsub = window.electronAPI?.onUpdateStatus?.((s) => setStatus(s))
    return () => { try { unsub?.() } catch {} }
  }, [])

  const label =
    status.state === 'checking' ? 'Checking for updates…' :
    status.state === 'available' ? `v${status.version} found — downloading…` :
    status.state === 'downloading' ? `Downloading v${status.version}… ${status.percent ?? 0}%` :
    status.state === 'ready' ? `v${status.version} ready to install` :
    status.state === 'up-to-date' ? 'You are on the latest version' :
    status.state === 'error' ? `Update check failed: ${status.message ?? 'unknown error'}` :
    status.state === 'dev' ? 'Updates are checked in the installed app (not in dev mode)' :
    'Tap to check for a newer version'

  return (
    <>
      <div className="settings-row">
        <span className="settings-label">App Updates {version && <span style={{ color: 'var(--text-dim)' }}>v{version}</span>}</span>
        {status.state === 'ready' ? (
          <button className="icon-btn" style={{ width: 'auto', padding: '0 12px', borderColor: 'var(--green)', color: 'var(--green)' }}
            onClick={() => window.electronAPI?.quitAndInstall()}>
            ↻ Restart to install
          </button>
        ) : (
          <button className="icon-btn" style={{ width: 'auto', padding: '0 12px' }}
            disabled={status.state === 'checking' || status.state === 'downloading'}
            onClick={() => window.electronAPI?.checkForUpdates()}>
            {status.state === 'checking' || status.state === 'downloading' ? '⏳ Working…' : '⟳ Check now'}
          </button>
        )}
      </div>
      <div style={{ fontSize: 11, color: 'var(--text-dim)', marginBottom: 16 }}>{label}</div>
    </>
  )
}

export function Settings() {
  const { clickThrough, setClickThrough, clearAll } = useStore()
  const overlayDisplay = useStore(s => s.overlayDisplay)
  const panelSize = useStore(s => s.panelSize ?? 'M')
  const hasCustomSize = useStore(s => s.panelW !== null && s.panelW !== undefined || s.panelH !== null && s.panelH !== undefined)
  const [displays, setDisplays] = useState<Array<{ id: number; label: string; primary: boolean }>>([])
  const [confirmClear, setConfirmClear] = useState(false)

  useEffect(() => {
    window.electronAPI?.getDisplays?.()?.then?.((d) => { if (d) setDisplays(d) }).catch(() => {})
  }, [])

  return (
    <div>
      <div className="section-title">Overlay Settings</div>
      
      <div className="settings-row">
        <span className="settings-label">Click-Through Mode</span>
        <label className="toggle">
          <input type="checkbox" checked={clickThrough} onChange={e => setClickThrough(e.target.checked)} />
          <span className="toggle-slider"></span>
        </label>
      </div>
      <div style={{fontSize: 11, color: 'var(--text-dim)', marginBottom: 16}}>
        When ON: clicks pass through to game. When OFF: overlay is interactive.
      </div>

      <div className="settings-row">
        <span className="settings-label">Overlay Monitor</span>
        <select
          value={overlayDisplay}
          onChange={e => useStore.getState().setOverlayDisplayPref(e.target.value)}
          style={{ background: 'rgba(0,0,0,0.4)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 4, padding: 6, fontSize: 12, maxWidth: 220 }}
        >
          <option value="all">All displays</option>
          {displays.map(d => (
            <option key={d.id} value={String(d.id)}>{d.label}{d.primary ? ' (primary)' : ''}</option>
          ))}
        </select>
      </div>
      <div style={{fontSize: 11, color: 'var(--text-dim)', marginBottom: 16}}>
        Restrict the overlay to the monitor Fortnite runs on.
      </div>

      <div className="settings-row">
        <span className="settings-label">Panel Size</span>
        <span style={{ display: 'inline-flex', gap: 4 }}>
          {(['S', 'M', 'L'] as const).map(s => (
            <button
              key={s}
              onClick={() => { useStore.getState().setPanelSize(s); useStore.getState().setPanelW(null) }}
              title={s === 'S' ? 'Small (340px)' : s === 'M' ? 'Medium (400px)' : 'Large (480px)'}
              style={{
                padding: '4px 12px', borderRadius: 4, cursor: 'pointer', fontSize: 12, fontWeight: 700,
                background: panelSize === s ? 'var(--gold)' : 'transparent',
                color: panelSize === s ? '#000' : 'var(--text-dim)',
                border: '1px solid var(--border)'
              }}
            >{s}</button>
          ))}
        </span>
      </div>
      <div style={{fontSize: 11, color: 'var(--text-dim)', marginBottom: 16}}>
        Small (340px) covers the least game. Medium (400px) is the new default. Large (480px) is the old size.
        You can also drag the panel's left edge (width) or bottom edge (height) directly — S/M/L jump back to presets.
        {(hasCustomSize) && (
          <button className="icon-btn" style={{ width: 'auto', padding: '2px 10px', fontSize: 11, marginLeft: 8 }}
            onClick={() => { useStore.getState().setPanelW(null); useStore.getState().setPanelH(null) }}>
            Reset manual size
          </button>
        )}
      </div>

      <div className="settings-row">
        <span className="settings-label">Timer Background (0–100%)</span>
        <input
          type="range" min={0} max={100}
          value={useStore(s => s.timerBgOpacity)}
          onChange={e => useStore.getState().setTimerBgOpacity(Number(e.target.value))}
          style={{ width: 120, accentColor: 'var(--gold)' }}
        />
      </div>
      <div style={{fontSize: 11, color: 'var(--text-dim)', marginBottom: 16}}>
        No preview here — set a value, go back to the game (F2), and judge it on the real timers.
      </div>

      <div className="section-title" style={{ marginTop: 20 }}>Updates</div>
      <UpdatesSection />

      <div className="settings-row">
        <span className="settings-label">Hotkeys</span>
      </div>
      <div className="hotkey-hint">
        <kbd>F1</kbd> Minimize to tab, mouse back to game / Expand (restores pre-minimize mode)<br/>
        <kbd>F2</kbd> Toggle Click-Through<br/>
        <kbd>F3</kbd> Droids Tab<br/>
        <kbd>F4</kbd> Rebirth Tab<br/>
        <kbd>F5</kbd> Calculator Tab<br/>
        <kbd>F6</kbd> Setup Tab<br/>
        <kbd>F7</kbd> Timers Tab (last)<br/>
        <kbd>F9</kbd> Spot hover income/s (no mouse move needed)<br/>
        <kbd>F10</kbd> Research (focus search / press again to clear)<br/>
        <kbd>↑</kbd><kbd>↓</kbd> Rebirth step back/forward (Rebirth tab) • <kbd>1</kbd>–<kbd>5</kbd> Path buttons (Rebirth tab)<br/>
        <kbd>Ctrl+Z</kbd> Undo last placement
      </div>

      <div className="section-title" style={{marginTop: 20}}>Data Management</div>

      <div className="settings-row">
        <span className="settings-label">Undo Last Placement</span>
        <button className="icon-btn" style={{width: 'auto', padding: '0 12px'}} onClick={() => useStore.getState().undo()} title="Ctrl+Z">
          ↩ Undo <kbd>Ctrl+Z</kbd>
        </button>
      </div>

      <div className="settings-row">
        <span className="settings-label">Export Placements</span>
        <button className="icon-btn" style={{width: 'auto', padding: '0 12px'}} onClick={() => {
          const blob = new Blob([useStore.getState().exportData()], { type: 'application/json' })
          const a = document.createElement('a')
          a.href = URL.createObjectURL(blob)
          a.download = 'droid-tycoon-overlay.json'
          a.click()
          setTimeout(() => URL.revokeObjectURL(a.href), 5000)
        }}>
          ⬇ Export
        </button>
      </div>

      <div className="settings-row">
        <span className="settings-label">Import Placements</span>
        <label className="icon-btn" style={{width: 'auto', padding: '0 12px', cursor: 'pointer'}}>
          ⬆ Import
          <input type="file" accept="application/json,.json" style={{ display: 'none' }} onChange={async (e) => {
            const f = e.target.files?.[0]
            if (!f) return
            const ok = useStore.getState().importData(await f.text())
            useStore.getState().showToast(ok ? '✅ Placements imported' : '❌ Invalid backup file')
            e.target.value = ''
          }} />
        </label>
      </div>

      <div className="settings-row">
        <span className="settings-label">Clear All Droids</span>
        {confirmClear ? (
          <span style={{ display: 'inline-flex', gap: 6 }}>
            <button className="icon-btn" style={{width: 'auto', padding: '0 12px', borderColor: 'var(--red)', color: 'var(--red)'}} onClick={() => { clearAll(); setConfirmClear(false) }}>
              Sure?
            </button>
            <button className="icon-btn" style={{width: 'auto', padding: '0 12px'}} onClick={() => setConfirmClear(false)}>
              Keep
            </button>
          </span>
        ) : (
          <button className="icon-btn" style={{width: 'auto', padding: '0 12px', borderColor: 'var(--red)', color: 'var(--red)'}} onClick={() => {
            setConfirmClear(true)
            setTimeout(() => setConfirmClear(false), 4000)
          }}>
            🗑️ Clear
          </button>
        )}
      </div>

      <div className="section-title" style={{marginTop: 20}}>Station Scan (Best-Effort Assist)</div>
      <div style={{fontSize: 12, color: 'var(--text-dim)', lineHeight: 1.6}}>
        <p>3D models can't be ID'd like flat cards, so scanning proposes <strong>suggestions</strong> you confirm with one tap:</p>
        <ol style={{marginLeft: 20, marginTop: 8}}>
          <li>Crop each droid's in-game look into <code>templates/</code> (named by droid id)</li>
          <li>Open the Droids tab → toggle <strong>Live scan</strong> (default OFF to save CPU) or <strong>📸 Once</strong></li>
          <li>Confirm suggestions; set paint quality manually</li>
        </ol>
        <p style={{marginTop: 8}}>Tip: aim at a droid and press <strong>F9</strong> — spotted income values identify it via the loaded income table.</p>
        <button className="icon-btn" style={{marginTop: 8, width: 'auto', padding: '0 16px'}} onClick={() => useStore.getState().setActiveTab('droids')}>
          Open Droids Tab
        </button>
      </div>

      <div className="section-title" style={{marginTop: 20}}>About</div>
      <div style={{fontSize: 12, color: 'var(--text-dim)', lineHeight: 1.6}}>
        <p><strong>Droid Tycoon Overlay</strong> (see Updates above for version)</p>
        <p>Built for Fortnite Creative - Star Wars Droid Tycoon</p>
        <p>No game injection • No memory reading • ToS compliant</p>
      </div>
    </div>
  )
}