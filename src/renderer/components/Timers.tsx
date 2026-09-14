import { useEffect, useState } from 'react'
import { useStore } from '../store'

// Spawn schedule (local time):
// - Stellar: top of every hour (:00) — YELLOW
// - Mythic: every hour at :55 — PINK/RED
// - Galactic: chained 45-min cadence that dodges Stellar. After a :15 spawn,
//   +45 would land on :00, so it fires at :45 instead (30-min hop, e.g.
//   02:15 -> 02:45); every other hop is 45 min (02:45 -> 03:30). Net cycle
//   repeats every 2 h: :15 + :45 on even hours, :30 on odd hours — flip
//   GALACTIC_PARITY if double spawns ever show in odd hours.
//   Hops are only ever 30/45 min. Never collides with :00 or :55.

function nextOccurrence(minutes: number[]): Date {
  const now = new Date()
  const candidate = new Date(now)
  candidate.setSeconds(0, 0)
  for (const m of minutes) {
    candidate.setMinutes(m)
    if (candidate.getTime() > now.getTime()) return candidate
  }
  candidate.setHours(candidate.getHours() + 1)
  candidate.setMinutes(minutes[0])
  return candidate
}

function fmt(ms: number): string {
  if (ms <= 0) return 'NOW'
  const s = Math.floor(ms / 1000)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  const mm = m.toString().padStart(2, '0')
  const ss = sec.toString().padStart(2, '0')
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`
}

function fmtClock(d: Date): string {
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

const GALACTIC_CYCLE_MS = 120 * 60 * 1000
// 0 = double spawns (:15 + :45) in even hours, single :30 in odd hours.
// Flip to 1 if double spawns are ever observed in odd hours.
const GALACTIC_PARITY = 0
const GALACTIC_MARKS = GALACTIC_PARITY === 0 ? [15, 45, 90] : [30, 75, 105]

// Next Galactic spawn after `nowMs`: chained 45-min hops, except a hop from
// :15 goes to :45 same hour (30 min) instead of colliding with Stellar :00.
function nextGalactic(nowMs: number): Date {
  const midnight = new Date(nowMs)
  midnight.setHours(0, 0, 0, 0)
  const t0 = midnight.getTime()
  const k = Math.floor((nowMs - t0) / GALACTIC_CYCLE_MS)
  // Current + next cycle cover every case (a cycle holds 3 spawns).
  for (let i = 0; i < 2; i++) {
    const base = t0 + (k + i) * GALACTIC_CYCLE_MS
    for (const m of GALACTIC_MARKS) {
      const cand = new Date(base + m * 60 * 1000)
      if (cand.getTime() > nowMs) return cand
    }
  }
  return new Date(t0 + (k + 2) * GALACTIC_CYCLE_MS + GALACTIC_MARKS[0] * 60 * 1000)
}

export function Timers({ bare = false, showGrip = false }: { bare?: boolean; showGrip?: boolean }) {
  const [, tick] = useState(0)

  useEffect(() => {
    const id = setInterval(() => tick(t => t + 1), 1000)
    return () => clearInterval(id)
  }, [])

  const now = Date.now()
  const stellar = nextOccurrence([0])
  const mythic = nextOccurrence([55])
  const galactic = nextGalactic(now)

  const cards = [
    { name: 'Stellar', at: stellar, cls: 'stellar', label: 'Top of hour' },
    { name: 'Mythic', at: mythic, cls: 'mythic', label: 'At :55 hourly' },
    { name: 'Galactic', at: galactic, cls: 'galactic', label: 'Every 45 min (dodges :00)' }
  ]

  const opacity = useStore(s => s.timerBgOpacity) / 100
  // Fill is always neutral black — only border + font carry the tier color,
  // so contrast stays high at any opacity.
  const bg = `rgba(0,0,0,${opacity})`

  if (bare) {
    return (
      <div className="timer-float-cards">
        {showGrip && <span className="timer-grip" title="Drag to move">⋮⋮</span>}
        {cards.map(c => {
          const left = c.at.getTime() - now
          return (
            <div key={c.name} className={`timer-chip ${c.cls}`} title={`${c.name} — ${c.label}, next ${fmtClock(c.at)}`} style={{ backgroundColor: bg }}>
              <span className="timer-chip-name">{c.name}</span>
              <span className={`timer-chip-value${left <= 0 ? ' now-flash' : ''}`}>{fmt(left)}</span>
            </div>
          )
        })}
      </div>
    )
  }

  return (
    <div>
      <div className="section-title">Spawn Timers</div>
      <div style={{ marginBottom: 12 }}>
        <button className="icon-btn" style={{ width: 'auto', padding: '4px 12px' }} onClick={() => useStore.getState().setTimersDetached(true)}>
          ⧉ Pop out to floating window
        </button>
      </div>
      <div className="timer-grid" style={{ gridTemplateColumns: '1fr' }}>
        {cards.map(c => {
          const left = c.at.getTime() - now
          return (
            <div key={c.name} className={`timer-card ${c.cls}`}>
              <div className="timer-name">{c.name} — {c.label}</div>
              <div className={`timer-value ${c.cls}${left <= 0 ? ' now-flash' : ''}`}>{fmt(left)}</div>
              <div className="timer-label">Next: {fmtClock(c.at)}</div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
