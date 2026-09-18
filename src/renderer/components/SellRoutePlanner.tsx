// Rebirth Sell Route Planner (Calc tab).
//
// Given path + current rebirth + sell-perk level + C-3PO companion state,
// computes a per-rebirth sell/keep route through a target rebirth: paint-
// specific requirements are protected through rebirth 35, each step's cash
// cost is covered by the minimum-waste sale subset, and cash resets every
// step (cash on hand applies to the first step only). Recomputes live on
// any input change. By design there are no game-rate terms here.

import { useMemo, useState } from 'react'
import { useStore } from '../store'
import { REBIRTH_PATHS } from '../data/rebirths'
import { PERK_MULT, formatScaled, parseCashInput } from '../data/sellTable'
import type { PerkLevel } from '../data/sellTable'
import { planRoute } from '../data/sellPlanner'
import { getDroidCard } from '../data/droidCards'
import { getDroidDef } from '../data/droidValues'

const copyName = (id: string): string => getDroidDef(id)?.name ?? id

export function SellRoutePlanner() {
  const placedDroids = useStore(s => s.placedDroids)
  const hasC3PO = useStore(s => s.hasC3PO)
  const toggleC3PO = useStore(s => s.toggleC3PO)
  const storePath = useStore(s => s.rebirthPath)
  const storeProgress = useStore(s => s.rebirthProgress[String(storePath)] ?? 1)

  const [path, setPath] = useState(storePath)
  const [fromN, setFromN] = useState(storeProgress)
  const [targetT, setTargetT] = useState(35)
  const [perk, setPerk] = useState<PerkLevel>(0)
  const [cashText, setCashText] = useState('0')

  const cashParsed = parseCashInput(cashText)
  const cashInvalid = Number.isNaN(cashParsed)

  const plan = useMemo(() => {
    const pathData = REBIRTH_PATHS.find(p => p.path === path)
    if (!pathData) return null
    return planRoute({
      steps: pathData.steps,
      fromN,
      targetT,
      perk,
      c3po: hasC3PO,
      cashOnHand: cashInvalid ? 0 : cashParsed,
      roster: placedDroids.map(p => ({ id: p.droidId, paint: p.quality })),
    })
  }, [path, fromN, targetT, perk, hasC3PO, cashParsed, cashInvalid, placedDroids])

  const num = (v: string, fallback: number): number => {
    const n = parseInt(v, 10)
    return Number.isNaN(n) ? fallback : n
  }

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 8 }}>
        <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>Path</span>
        {[1, 2, 3, 4, 5].map(p => (
          <button key={p} className="icon-btn" style={{
            width: 'auto', padding: '4px 10px', fontWeight: 700,
            background: path === p ? 'var(--gold)' : 'transparent',
            color: path === p ? '#000' : 'var(--text)'
          }} onClick={() => setPath(p)}>{p}</button>
        ))}
        <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>Current RB</span>
        <input value={fromN} onChange={e => setFromN(num(e.target.value, 1))}
          style={{ width: 52, padding: 4, borderRadius: 4, border: '1px solid var(--border)', background: 'rgba(0,0,0,0.4)', color: 'var(--text)' }} />
        <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>Target RB</span>
        <input value={targetT} onChange={e => setTargetT(num(e.target.value, 35))}
          style={{ width: 52, padding: 4, borderRadius: 4, border: '1px solid var(--border)', background: 'rgba(0,0,0,0.4)', color: 'var(--text)' }} />
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 8 }}>
        <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>Sell perk</span>
        {([0, 1, 2, 3] as PerkLevel[]).map(p => (
          <button key={p} className="icon-btn" style={{
            width: 'auto', padding: '4px 10px', fontWeight: 700,
            background: perk === p ? 'var(--gold)' : 'transparent',
            color: perk === p ? '#000' : 'var(--text)'
          }} onClick={() => setPerk(p)} title={`Sell value ×${PERK_MULT[p]}`}>P{p} ×{PERK_MULT[p]}</button>
        ))}
        <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>Cash on hand</span>
        <input value={cashText} onChange={e => setCashText(e.target.value)} placeholder="e.g. 1.5T"
          style={{ width: 90, padding: 4, borderRadius: 4, border: `1px solid ${cashInvalid ? 'var(--red, #ff5555)' : 'var(--border)'}`, background: 'rgba(0,0,0,0.4)', color: 'var(--text)' }} />
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, cursor: 'pointer' }}>
          <input type="checkbox" checked={hasC3PO} onChange={toggleC3PO} style={{ accentColor: 'var(--gold)' }} />
          C-3PO ×2
        </label>
      </div>
      {cashInvalid && <div style={{ fontSize: 11, color: '#ff5555', marginBottom: 8 }}>Cash not understood — treated as 0 (try e.g. 1.5T, 300K).</div>}
      <div style={{ fontSize: 11, color: 'var(--text-dim)', marginBottom: 8 }}>
        Roster: {placedDroids.length} cop{placedDroids.length === 1 ? 'y' : 'ies'} from the Droids tab
        {placedDroids.length === 0 && ' — place droids there first'}
      </div>

      {!plan ? (
        <div style={{ fontSize: 12, color: 'var(--text-dim)' }}>No path data.</div>
      ) : (
        <>
          {plan.warnings.length > 0 && (
            <div style={{ fontSize: 11, color: 'var(--gold)', background: 'rgba(255,200,50,0.08)', border: '1px solid var(--border)', borderRadius: 4, padding: '6px 8px', marginBottom: 8 }}>
              {plan.warnings.map((w, i) => <div key={i}>⚠ {w}</div>)}
            </div>
          )}

          <table className="plan-table">
            <thead>
              <tr>
                <th>R</th>
                <th className="num">Cost</th>
                <th>Sales</th>
                <th className="num">Cash after</th>
                <th>Req</th>
                <th className="num">Waste</th>
                <th>Freed next</th>
              </tr>
            </thead>
            <tbody>
              {plan.steps.map(st => (
                <tr key={st.r}>
                  <td style={{ fontWeight: 700 }}>{st.r}</td>
                  <td className="num">{formatScaled(st.cost)}</td>
                  <td>
                    {st.sales.length === 0 && <span style={{ color: 'var(--text-dim)' }}>—</span>}
                    {st.sales.map((s, i) => {
                      const card = getDroidCard(s.id)
                      return (
                        <div key={i} className="plan-sale">
                          {card ? <img src={card} alt="" className="calc-card" /> : null}
                          <span>{s.qty}× {copyName(s.id)} <span style={{ color: 'var(--text-dim)' }}>{s.paint}</span> — {formatScaled(s.unit)} • {formatScaled(s.total)}</span>
                        </div>
                      )
                    })}
                    {!st.performed && st.reqOk && st.shortfall > 0n && (
                      <div style={{ color: '#ff5555' }}>
                        Shortfall {formatScaled(st.shortfall)}
                        {st.nearestCover.map((c, i) => (
                          <div key={i} style={{ color: 'var(--gold)' }}>
                            …or sell {copyName(c.id)} {c.paint} ({formatScaled(c.unit)}) — would break RB {c.breaksR ?? '?'}
                          </div>
                        ))}
                      </div>
                    )}
                  </td>
                  <td className="num">{st.performed ? formatScaled(st.cashAfter) : '—'}</td>
                  <td>
                    {st.reqOk
                      ? <span style={{ color: 'var(--green)' }}>✓</span>
                      : <span style={{ color: '#ff5555' }}>✗ {st.missing.map(m => `${copyName(m.id)} ${m.paint} (need ${m.need}, own ${m.have})`).join(', ')}</span>}
                  </td>
                  <td className="num">{st.performed ? formatScaled(st.waste) : '—'}</td>
                  <td>
                    {st.freed.length === 0 && <span style={{ color: 'var(--text-dim)' }}>—</span>}
                    {st.freed.map((f, i) => (
                      <div key={i}>{f.qty}× {copyName(f.id)} <span style={{ color: 'var(--text-dim)' }}>{f.paint}</span></div>
                    ))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="calculator-summary" style={{ marginTop: 8 }}>
            <div className="calc-row"><span>Furthest reachable</span><span>RB {plan.furthest}{plan.furthest < plan.targetT ? ` — stuck at RB ${plan.furthest + 1}` : ''}</span></div>
            <div className="calc-row"><span>Total waste</span><span>{formatScaled(plan.totalWaste)} ({plan.wastePct.toFixed(2)}% of {formatScaled(plan.totalCost)})</span></div>
            <div className="calc-row total"><span>Ending roster value</span><span>{formatScaled(plan.endingValue)}</span></div>
          </div>

          {plan.keepList.length > 0 && (
            <>
              <div className="section-title" style={{ marginTop: 12 }}>Keep list</div>
              <table className="plan-table">
                <thead>
                  <tr>
                    <th>Droid</th>
                    <th className="num">Keep until RB</th>
                    <th>Then</th>
                    <th className="num">Owned</th>
                  </tr>
                </thead>
                <tbody>
                  {plan.keepList.map((k, i) => (
                    <tr key={i}>
                      <td>{copyName(k.id)} <span style={{ color: 'var(--text-dim)' }}>{k.paint}</span></td>
                      <td className="num">{k.keepUntil}</td>
                      <td>{k.keepUntil >= 35 ? <span style={{ color: 'var(--gold)', fontWeight: 700 }}>never sell</span> : `sellable from ${k.keepUntil + 1}`}</td>
                      <td className="num">{k.owned}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </>
      )}
    </div>
  )
}
