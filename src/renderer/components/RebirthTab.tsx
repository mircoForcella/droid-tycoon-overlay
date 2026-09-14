import { useEffect, useRef, useState } from 'react'
import { useStore } from '../store'
import { REBIRTH_PATHS, RebirthPath } from '../data/rebirths'
import { getDroidDef, getSellValue, formatCredits } from '../data/droidValues'
import { getDroidCard } from '../data/droidCards'

// Sell safety is derived from the data: a requirement is "needed later" if the
// same droid appears in any later rebirth of the same path.
function laterUse(path: RebirthPath, stepN: number, droidId: string): number[] {
  return path.steps
    .filter(s => s.n > stepN && s.requires.some(r => r.droidId === droidId))
    .map(s => s.n)
}

export function RebirthTab() {
  const [path, setPath] = useState(1)
  const [query, setQuery] = useState('')
  const [allPaths, setAllPaths] = useState(false)
  const data = REBIRTH_PATHS.find(p => p.path === path)!
  const progress = useStore(s => s.rebirthProgress[String(path)] ?? 1)
  const setProgress = useStore(s => s.setRebirthProgress)
  const currentRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    // 'nearest' nudges the current card into view only if it's actually
    // hidden — unlike 'start' it never yanks the Path/search/stepper
    // controls out of sight when switching paths or stepping RB +/-.
    currentRef.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [path, progress])

  const q = query.trim().toLowerCase()
  const searchPaths = q.length > 0 ? (allPaths ? REBIRTH_PATHS : [data]) : []
  const searchHits = searchPaths.flatMap(pd =>
    pd.steps.flatMap(s =>
      s.requires
        .map((r, i) => ({ path: pd, step: s, req: r, idx: i }))
        .filter(({ req }) => {
          const def = getDroidDef(req.droidId)
          return def && (def.name.toLowerCase().includes(q) || def.tier.toLowerCase().includes(q))
        })
    )
  )

  const visibleSteps = data.steps.filter(s => s.n >= progress)
  const hiddenCount = data.steps.length > 0 ? progress - 1 : 0

  return (
    <div>
      <div className="section-title">Super Rebirth Paths</div>
      <div className="rebirth-sticky">
      <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
        {REBIRTH_PATHS.map(p => (
          <button key={p.path}
            onClick={() => setPath(p.path)}
            className="icon-btn"
            style={{
              width: 'auto', padding: '6px 12px', fontWeight: 700,
              background: path === p.path ? 'var(--gold)' : 'transparent',
              color: path === p.path ? '#000' : 'var(--text)'
            }}>
            Path {p.path}
          </button>
        ))}
      </div>

      <input
        id="rebirth-search"
        placeholder="Search droid — where is it needed in this path?"
        value={query}
        onChange={e => setQuery(e.target.value)}
        style={{ width: '100%', padding: 8, marginBottom: 4, borderRadius: 6, border: '1px solid var(--border)', background: 'rgba(0,0,0,0.4)', color: 'var(--text)' }}
      />
      {q.length > 0 && (
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--text-dim)', marginBottom: 8, cursor: 'pointer' }}>
          <input type="checkbox" checked={allPaths} onChange={e => setAllPaths(e.target.checked)} style={{ accentColor: 'var(--gold)' }} />
          Search all 5 paths
        </label>
      )}

      {q.length === 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button className="icon-btn" title="Back to previous rebirth" onClick={() => setProgress(path, progress - 1)}>▲</button>
          <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--gold)', whiteSpace: 'nowrap' }}>
            RB {progress} / {data.steps.length || 35}
          </span>
          <button className="icon-btn" title="Forward to next rebirth" onClick={() => setProgress(path, progress + 1)}>▼</button>
          {hiddenCount > 0 && (
            <span style={{ fontSize: 10, color: 'var(--text-dim)' }}>{hiddenCount} earlier hidden</span>
          )}
          {progress > 1 && (
            <button className="icon-btn" style={{ width: 'auto', padding: '2px 10px', fontSize: 11 }} onClick={() => setProgress(path, 1)}>Reset</button>
          )}
        </div>
      )}
      </div>

      {data.steps.length === 0 && (
        <div className="hotkey-hint">
          Path {path} data not filled yet. Paste the sheet tab URL and I'll load all 35 rows.
        </div>
      )}

      {q.length > 0 && (
        searchHits.length === 0 ? (
          <div className="hotkey-hint">No result found — "{query.trim()}" is not needed in {allPaths ? 'any path' : `Path ${path}`}.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {searchHits.map(({ path: pd, step, req }, k) => {
              const def = getDroidDef(req.droidId)!
              const later = laterUse(pd, step.n, req.droidId)
              const done = pd.path === path && step.n < progress
              const card = getDroidCard(req.droidId)
              return (
                <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, padding: '6px 8px', background: 'rgba(0,0,0,0.3)', border: '1px solid var(--border)', borderRadius: 6, opacity: done ? 0.55 : 1 }}>
                  {card ? (
                    <img src={card} alt={def.name} className="rebirth-thumb" width={44} height={52} loading="lazy" />
                  ) : (
                    <span style={{ fontSize: 18, width: 44, textAlign: 'center' }}>{def.icon}</span>
                  )}
                  <span style={{ flex: 1 }}>
                    <strong style={{ color: 'var(--gold)' }}>P{pd.path} · RB {step.n}</strong> — {def.name} <span style={{ color: 'var(--text-dim)' }}>{def.tier} {req.quality}</span>
                    <br />
                    <span style={{ fontSize: 10, color: 'var(--text-dim)' }}>
                      Cost {formatCredits(step.cost)} • Sell {formatCredits(getSellValue(def, req.quality))}
                      {later.length > 0 ? ` • needed again RB ${later.join(', ')}` : ' • not needed later'}
                      {done ? ' • done ✓' : ''}
                    </span>
                  </span>
                </div>
              )
            })}
          </div>
        )
      )}

      {q.length === 0 && visibleSteps.map(s => (
        <div
          key={s.n}
          ref={s.n === progress ? currentRef : undefined}
          style={{
            background: 'rgba(0,0,0,0.3)',
            border: s.n === progress ? '1px solid var(--gold)' : '1px solid var(--border)',
            borderRadius: 8, padding: 10, marginBottom: 8
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
            <strong style={{ color: 'var(--gold)' }}>Rebirth {s.n}</strong>
            <span style={{ color: 'var(--text-dim)', fontSize: 12 }}>Cost: {formatCredits(s.cost)}</span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6 }}>
            {s.requires.map((r, i) => {
              const def = getDroidDef(r.droidId)
              if (!def) return <div key={i} style={{ fontSize: 11, color: 'var(--red)' }}>{r.droidId} (missing)</div>
              const sell = getSellValue(def, r.quality)
              const later = laterUse(data, s.n, r.droidId)
              const needed = later.length > 0
              const card = getDroidCard(r.droidId)
              if (!card) {
                return (
                  <div key={i} style={{ border: `1px solid ${needed ? 'var(--red)' : 'var(--gold)'}`, borderRadius: 6, padding: 6, textAlign: 'center' }}>
                    <div style={{ fontSize: 20 }}>{def.icon}</div>
                    <div style={{ fontSize: 11, fontWeight: 600 }}>{def.name}</div>
                    <div style={{ fontSize: 10, color: 'var(--text-dim)' }}>{def.tier} {r.quality}</div>
                    <div style={{ fontSize: 10, color: 'var(--gold)' }}>{formatCredits(sell)}</div>
                    <div style={{ fontSize: 9, color: needed ? 'var(--red)' : 'var(--gold)' }}>
                      {needed ? `KEEP — RB ${later.join(', ')}` : 'SELL ✔'}
                    </div>
                  </div>
                )
              }
              return (
                <div key={i} className="rebirth-card" style={{ borderColor: needed ? 'var(--red)' : 'var(--gold)' }}>
                  <img src={card} alt={def.name} className="rebirth-card-bg" loading="lazy" />
                  <div className="rebirth-card-scrim" />
                  <div className="rebirth-card-body">
                    <div className="rebirth-card-name">{def.name}</div>
                    <div>
                      <div className="rebirth-card-sub">{def.tier} {r.quality}</div>
                      <div className="rebirth-card-sell">{formatCredits(sell)}</div>
                      <div className={`rebirth-card-flag ${needed ? 'keep' : 'sell'}`}>
                        {needed ? `KEEP — RB ${later.join(', ')}` : 'SELL ✔'}
                      </div>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}
