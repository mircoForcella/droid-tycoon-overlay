// Base income (credits/sec at Default quality) + income multipliers per tier.
// Reverse lookup: hover income/s number -> candidate droid+quality pairs.

import { DROIDS, DroidDef, Quality, QUALITIES, Tier } from './droidValues'

export const INCOME_MULTIPLIERS: Record<Exclude<Tier, 'Iconic'>, number[]> = {
  Common: [1, 2, 4, 8, 12, 24, 32],
  Rare: [1, 2, 4, 8, 12, 24, 32],
  Epic: [1, 2, 4, 8, 34, 52, 80],
  Legendary: [1, 2, 4, 8, 24, 60, 150],
  Mythic: [1, 2, 4, 8, 16, 44, 125]
}

export const INCOME_BASE: Record<string, number> = {
  // TODO: real credits/sec for protocol droids (roster confirmed by sheet)
  'sa-5': 0, lom: 0, pz: 0, tda: 0,
  // Common
  mouse: 2, pit: 2, gonk: 4, cb: 3, r3: 3, r5: 3, r8: 4,
  'imp-probe': 6, 'b1-battle': 5, 'drk1-probe': 3, id10: 4,
  // Rare
  'bdx-explorer': 15, arg: 42, 'senate-hovercam': 46, 'b-u4d': 58,
  'bal-core': 23, 'roll-r': 31, 'whl-ex': 72, '2bb': 17, 'a-lt': 36,
  r4: 50, r9: 54, 'zro-tec': 72, 'b1-security': 66, 'nav-ex': 18,
  'vect-arm': 27, 'hov-r': 62, 'btl-r': 72,
  // Epic
  groundmech: 120, l0: 240, 'amp-walker': 570, 'sen-tri': 510,
  'opti-pod': 390, gunrunner: 660, 'n-ul': 720, bb: 150, r2: 360,
  r6: 300, 'trak-r': 330, 'orb-walker': 180, 'util-tec': 210,
  'scrp-r': 720, 'b1-heavy': 630, 'b2-super': 420, 'b2-heavy': 480,
  'strike-orb': 540, 'haul-r': 270, 'lng-shot': 450, 'arm-core': 690, 'opt-ar': 720,
  // Legendary
  'proto-roller': 972, 'mecha-droid': 1240, 'mono-wlkr': 1500, 'ro-tor': 1500,
  'fus-3': 1600, bb9: 1300, r7: 1500, 'qik-bit': 1600, 'b2-rp': 1300,
  'cyclo-grav': 1260, 'opti-strk': 1500, 'orb-xl': 1600,
  // Mythic
  'snow-mouse': 4400, ric: 5100, loadlifter: 7200, lep: 6500,
  'ric-1200': 5800, 'riv-3t': 8400, 'lug-g': 7600, 'low-mo': 7800,
  'drft-r': 5800, cyclens: 4400, 'mo-trak': 7200, 'tri-tek': 6500,
  'axi-pod': 8000, ig: 5800, kx: 7200, 'srv-o': 7600, 'x-onk': 8000
}

export function getIncome(d: DroidDef, q: Quality): number {
  if (d.tier === 'Iconic') return 0
  const base = INCOME_BASE[d.id] ?? 0
  return base * INCOME_MULTIPLIERS[d.tier as Exclude<Tier, 'Iconic'>][QUALITIES.indexOf(q)]
}

function strip(n: number): string {
  return n >= 100 ? `${Math.round(n)}` : n >= 10 ? n.toFixed(1) : n.toFixed(2)
}

export function formatIncome(n: number): string {
  if (n <= 0) return '—'
  if (n >= 1e6) return `${strip(n / 1e6)}m/s`
  if (n >= 1e3) return `${strip(n / 1e3)}k/s`
  return `${Math.round(n)}/s`
}

// Accepts "1440", "1.44k", "1.44k/s", "550", "128.48t/s" ...
// K/M/B/T only — anything else returns null (unsupported suffix blocked).
export function parseIncome(text: string): number | null {
  const m = text.toLowerCase().replace(/\/s\s*$/, '').trim().match(/^([\d.]+)\s*([kmbt])?$/)
  if (!m) return null
  const mult = m[2] === 'k' ? 1e3 : m[2] === 'm' ? 1e6 : m[2] === 'b' ? 1e9 : m[2] === 't' ? 1e12 : 1
  const v = parseFloat(m[1]) * mult
  return v > 0 ? v : null
}

export interface IncomeHit {
  def: DroidDef
  quality: Quality
  income: number
}

// All droid+quality combos whose income matches within tolerance.
export function findByIncome(value: number, tol = 0.02): IncomeHit[] {
  const out: IncomeHit[] = []
  for (const d of DROIDS) {
    if (d.tier === 'Iconic') continue
    for (const q of QUALITIES) {
      if (d.noStellar && q === 'Stellar') continue
      const inc = getIncome(d, q)
      if (inc > 0 && Math.abs(inc - value) / value <= tol) out.push({ def: d, quality: q, income: inc })
    }
  }
  return out.sort((a, b) => a.income - b.income)
}
