import { useStore, formatCredits } from '../store'
import { getIncome, formatIncome } from '../data/income'
import { getDroidCard } from '../data/droidCards'
import { SellRoutePlanner } from './SellRoutePlanner'

export function Calculator() {
  const { hasC3PO, toggleC3PO, getTotalSellValue, getTotalIncome, getDroidsByCategory } = useStore()

  const workers = getDroidsByCategory('workers')
  const astromechs = getDroidsByCategory('astromechs')
  const battle = getDroidsByCategory('battle')
  const totalValue = getTotalSellValue()
  const baseTotal = hasC3PO ? totalValue / 2 : totalValue
  const totalIncome = getTotalIncome()

  const sum = (arr: typeof workers) => arr.reduce((s, p) => s + p.sell, 0)
  const sumIncome = (arr: typeof workers) => arr.reduce((s, p) => s + getIncome(p.def, p.quality), 0)

  return (
    <div>
      <div className="section-title">Sell Calculator</div>

      <div className="c3po-toggle">
        <input type="checkbox" id="c3po-toggle" checked={hasC3PO} onChange={toggleC3PO} />
        <label htmlFor="c3po-toggle">C-3PO Active (2x Sell Value)</label>
        <span className="desc">Doubles ALL droid sell prices</span>
      </div>

      <div className="calculator-summary">
        <div className="calc-row"><span>Workers ({workers.length})</span><span>{formatCredits(sum(workers))}</span></div>
        <div className="calc-row"><span>Astromechs ({astromechs.length})</span><span>{formatCredits(sum(astromechs))}</span></div>
        <div className="calc-row"><span>Battle ({battle.length})</span><span>{formatCredits(sum(battle))}</span></div>
        <div className="calc-row"><span>Base total</span><span>{formatCredits(baseTotal)}</span></div>
        {hasC3PO && <div className="calc-row c3po"><span>C-3PO ×2</span><span>×2</span></div>}
        <div className="calc-row total"><span>TOTAL</span><span>{formatCredits(totalValue)}</span></div>
      </div>

      <div className="section-title" style={{ marginTop: 16 }}>Rebirth Sell Route Planner</div>
      <SellRoutePlanner />

      <div className="section-title" style={{ marginTop: 16 }}>Income / second (base, before boosts)</div>
      <div className="calculator-summary">
        <div className="calc-row"><span>Workers ({workers.length})</span><span>{formatIncome(sumIncome(workers))}</span></div>
        <div className="calc-row"><span>Astromechs ({astromechs.length})</span><span>{formatIncome(sumIncome(astromechs))}</span></div>
        <div className="calc-row"><span>Battle ({battle.length})</span><span>{formatIncome(sumIncome(battle))}</span></div>
        <div className="calc-row total"><span>TOTAL</span><span>{formatIncome(totalIncome)}</span></div>
      </div>

      <div className="section-title">Breakdown</div>
      {[
        { label: 'Workers', droids: workers },
        { label: 'Astromechs', droids: astromechs },
        { label: 'Battle', droids: battle }
      ].map(({ label, droids }) => droids.length > 0 && (
        <div key={label} className="section" style={{ marginTop: 8 }}>
          <div className="section-title">{label} ({droids.length})</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {droids.map(({ slotId, def, quality, sell }) => (
              <div key={slotId} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, padding: '4px 8px', background: 'rgba(0,0,0,0.2)', borderRadius: 4 }}>
                <span>{getDroidCard(def.id) ? <img src={getDroidCard(def.id)} alt={def.name} className="calc-card" /> : def.icon} {def.name} <span style={{ color: 'var(--text-dim)' }}>{def.tier} {quality}</span></span>
                <span style={{ color: 'var(--gold)', fontWeight: 600 }}>{formatCredits(hasC3PO ? sell * 2 : sell)}</span>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
