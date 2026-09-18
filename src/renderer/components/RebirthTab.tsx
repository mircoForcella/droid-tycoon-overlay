import { useEffect, useRef } from 'react'
import { useStore } from '../store'
import { REBIRTH_PATHS } from '../data/rebirths'
import { DROIDS, getDroidDef, getSellValue, formatCredits } from '../data/droidValues'
import { getDroidCard } from '../data/droidCards'
import { PaintTag, TierTag } from './RarityTags'
import type { DroidDef } from '../data/droidValues'

// Per-step KEEP/SELL for the browse cards below: a requirement is "needed
// later" if the same droid appears in any later rebirth of the same path.
function laterUse(path: { steps: Array<{ n: number; requires: Array<{ droidId: string }> }> }, stepN: number, droidId: string): number[] {
  return path.steps
    .filter(s => s.n > stepN && s.requires.some(r => r.droidId === droidId))
    .map(s => s.n)
}

export function RebirthTab() {
  // Query + path live in the store (session-only): F1-minimize unmounts this
  // tab, and local state would take the research with it.
  const path = useStore(s => s.rebirthPath)
  const setPath = useStore(s => s.setRebirthPath)
  const query = useStore(s => s.rebirthQuery)
  const setQuery = useStore(s => s.setRebirthQuery)
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
  // "sell epic" (or bare "sell") = safe-seller mode for a tier. Anything
  // else is a droid/tier search, grouped one row per droid.
  const SELL_TIERS = ['common', 'rare', 'epic', 'legendary', 'mythic']
  const sellWord = q === 'sell' ? 'any' : q.startsWith('sell ') ? q.slice(5).trim() : null
  const sellTier = sellWord !== null && (sellWord === 'any' || SELL_TIERS.includes(sellWord)) ? sellWord : null
  const isSellQuery = sellTier !== null

  interface Use { n: number; quality: string; cost: number }
  interface Group { def: DroidDef; uses: Use[] }
  const groups = new Map<string, Group>()
  if (q.length > 0 && !isSellQuery) {
    for (const s of data.steps) {
      for (const r of s.requires) {
        const def = getDroidDef(r.droidId)
        if (!def) continue
        if (!(def.name.toLowerCase().includes(q) || def.tier.toLowerCase().includes(q))) continue
        let g = groups.get(r.droidId)
        if (!g) {
          g = { def, uses: [] }
          groups.set(r.droidId, g)
        }
        g.uses.push({ n: s.n, quality: r.quality, cost: s.cost })
      }
    }
  }
  const grouped = [...groups.values()]
    .map(g => ({ ...g, uses: g.uses.sort((a, b) => a.n - b.n) }))
    .sort((a, b) => a.def.name.localeCompare(b.def.name))

  // Safe sellers: every roster droid of the tier with no requirement at or
  // after progress in this path — including droids the path never needs at
  // all ("useless" ones). Fusion-result droids are never sell candidates
  // (17 of them), so they're excluded outright. Paint is irrelevant, one
  // row per droid, never Iconic.
  const sellList = isSellQuery
    ? DROIDS.filter(def => def.tier !== 'Iconic' && !def.fusion)
        .filter(def => sellTier === 'any' || def.tier.toLowerCase() === sellTier)
        .filter(def => !data.steps.some(s => s.n >= progress && s.requires.some(r => r.droidId === def.id)))
        .sort((a, b) => a.name.localeCompare(b.name))
    : []

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
        placeholder="Search droid, or 'sell epic' for safe sellers…"
        value={query}
        onChange={e => setQuery(e.target.value)}
        style={{ width: '100%', padding: 8, marginBottom: 4, borderRadius: 6, border: '1px solid var(--border)', background: 'rgba(0,0,0,0.4)', color: 'var(--text)' }}
      />
      <div className="hotkey-hint" style={{ marginBottom: 4 }}>F10 to type • F10 again starts a fresh search (F2 back to game)</div>

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
        isSellQuery ? (
          sellList.length === 0 ? (
            <div className="hotkey-hint">Nothing safe to sell{sellTier !== 'any' ? ` in ${sellTier}` : ''} from RB {progress} on — everything left is needed again.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div style={{ fontSize: 11, color: 'var(--green)' }}>
                {sellList.length} safe to sell{sellTier !== 'any' ? ` (${sellTier})` : ''} — never needed again from RB {progress}
              </div>
              {sellList.map(def => {
                const card = getDroidCard(def.id)
                return (
                  <div key={def.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, padding: '6px 8px', background: 'rgba(0,0,0,0.3)', border: '1px solid var(--green)', borderRadius: 6 }}>
                    {card ? (
                      <img src={card} alt={def.name} className="rebirth-thumb" width={44} height={52} loading="lazy" />
                    ) : (
                      <span style={{ fontSize: 18, width: 44, textAlign: 'center' }}>{def.icon}</span>
                    )}
                    <span style={{ flex: 1 }}>
                      <strong>{def.name}</strong> <TierTag tier={def.tier} />
                      <br />
                      <span style={{ fontSize: 10, color: 'var(--green)' }}>SAFE TO SELL ✔</span>
                    </span>
                  </div>
                )
              })}
            </div>
          )
        ) : grouped.length === 0 ? (
          <div className="hotkey-hint">No result found — "{query.trim()}" is not needed in Path {path}.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {grouped.map(({ def, uses }) => {
              const next = uses.find(u => u.n >= progress)
              const done = !next
              const card = getDroidCard(def.id)
              return (
                <div key={def.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, padding: '6px 8px', background: 'rgba(0,0,0,0.3)', border: '1px solid var(--border)', borderRadius: 6, opacity: done ? 0.55 : 1 }}>
                  {card ? (
                    <img src={card} alt={def.name} className="rebirth-thumb" width={44} height={52} loading="lazy" />
                  ) : (
                    <span style={{ fontSize: 18, width: 44, textAlign: 'center' }}>{def.icon}</span>
                  )}
                  <span style={{ flex: 1 }}>
                    <strong>{def.name}</strong> <TierTag tier={def.tier} />
                    <br />
                    <span style={{ fontSize: 10, color: 'var(--text-dim)' }}>
                      {uses.map((u, i) => (
                        <span key={i}>
                          {i > 0 && ' · '}
                          <strong style={{ color: u.n < progress ? 'var(--text-dim)' : u.n === progress ? 'var(--gold)' : 'var(--text)' }}>
                            RB {u.n}
                          </strong>{' '}
                          <PaintTag quality={u.quality} />{' '}
                          <span style={{ color: 'var(--text-dim)' }}>{formatCredits(u.cost)}</span>
                        </span>
                      ))}
                    </span>
                    <br />
                    <span style={{ fontSize: 10, color: next ? 'var(--red)' : 'var(--green)' }}>
                      {next ? `KEEP — next RB ${next.n}` : 'SELL ✔ — never needed again'}
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
                      <div><TierTag tier={def.tier} /> <PaintTag quality={r.quality} /></div>
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
