// Real sell-value database for Star Wars: Droid Tycoon
// Rarity tiers: Common, Rare, Epic, Legendary, Mythic
// Paint qualities: Default, Gold, Diamond, Rainbow, Beskar, Galactic, Stellar
// Sell = base * quality multiplier for the droid's tier.

export const QUALITIES = ['Default', 'Gold', 'Diamond', 'Rainbow', 'Beskar', 'Galactic', 'Stellar'] as const
export type Quality = typeof QUALITIES[number]

export const TIERS = ['Common', 'Rare', 'Epic', 'Legendary', 'Mythic', 'Iconic'] as const
export type Tier = typeof TIERS[number]

// Quality multipliers per tier. Index matches QUALITIES order.
// Mythic Rainbow is 24x (verified from data: 126m -> 3.02B).
// LOW-MO has no Stellar (N/A).
export const MULTIPLIERS: Record<Exclude<Tier, 'Iconic'>, number[]> = {
  Common: [1, 4, 8, 12, 16, 20, 24],
  Rare: [1, 4, 8, 12, 16, 20, 24],
  Epic: [1, 4, 8, 12, 125, 300, 750],
  Legendary: [1, 4, 8, 12, 400, 2400, 14500],
  Mythic: [1, 4, 8, 24, 800, 4700, 28000]
}

export interface DroidDef {
  id: string
  name: string
  tier: Tier
  base: number // Default-quality sell value in credits
  fusion?: boolean
  noStellar?: boolean
  // legacy base-area category for the 31-slot map
  area: 'workers' | 'astromechs' | 'battle' | 'special'
  icon: string
}

const C = (id: string, name: string, base: number, area: DroidDef['area'], icon: string, fusion = false): DroidDef =>
  ({ id, name, tier: 'Common', base, area, icon, fusion })
const R = (id: string, name: string, base: number, area: DroidDef['area'], icon: string, fusion = false): DroidDef =>
  ({ id, name, tier: 'Rare', base, area, icon, fusion })
const E = (id: string, name: string, base: number, area: DroidDef['area'], icon: string, fusion = false): DroidDef =>
  ({ id, name, tier: 'Epic', base, area, icon, fusion })
const L = (id: string, name: string, base: number, area: DroidDef['area'], icon: string, fusion = false): DroidDef =>
  ({ id, name, tier: 'Legendary', base, area, icon, fusion })
const M = (id: string, name: string, base: number, area: DroidDef['area'], icon: string, fusion = false, noStellar = false): DroidDef =>
  ({ id, name, tier: 'Mythic', base, area, icon, fusion, noStellar })

export const DROIDS: DroidDef[] = [
  // ---- Common ----
  C('mouse', 'Mouse', 665, 'workers', '🐭'),
  C('pit', 'Pit', 770, 'workers', '🔧'),
  C('gonk', 'Gonk', 2100, 'workers', '🔋'),
  C('cb', 'CB', 1400, 'astromechs', '⚪'),
  C('r3', 'R3', 1400, 'astromechs', '⚪'),
  C('r5', 'R5', 1400, 'astromechs', '🔴'),
  C('r8', 'R8', 2100, 'astromechs', '⚪'),
  C('imp-probe', 'Imperial Probe', 3500, 'workers', '👁️'),
  C('b1-battle', 'B1 Battle', 2800, 'battle', '🤖'),
  C('drk1-probe', 'DRK-1 Probe', 2100, 'workers', '🔍'),
  C('id10', 'ID10', 2800, 'workers', '🛸'),
  // ---- Rare ----
  R('bdx-explorer', 'BDX Explorer', 17500, 'workers', '🧭'),
  R('arg', 'ARG', 61600, 'workers', '🏗️'),
  R('senate-hovercam', 'Senate Hovercam', 70000, 'workers', '📷'),
  R('b-u4d', 'B-U4D', 91000, 'workers', '🤖'),
  R('bal-core', 'BAL-Core', 30100, 'astromechs', '🔵'),
  R('roll-r', 'ROLL-R', 43400, 'astromechs', '⚪'),
  R('whl-ex', 'WHL-EX', 227500, 'workers', '⚙️', true),
  R('2bb', '2BB', 21000, 'astromechs', '💗'),
  R('a-lt', 'A-LT', 51800, 'astromechs', '⚪'),
  R('r4', 'R4', 77000, 'astromechs', '🔴'),
  R('r9', 'R9', 84000, 'astromechs', '🟡'),
  R('zro-tec', 'ZRO-TEC', 227500, 'workers', '⚙️', true),
  R('b1-security', 'B1 Security', 105000, 'battle', '🛡️'),
  R('nav-ex', 'NAV-EX', 25200, 'astromechs', '🧭'),
  R('vect-arm', 'Vect-Arm', 36400, 'workers', '🦾'),
  R('hov-r', 'HOV-R', 98000, 'workers', '🛸'),
  R('btl-r', 'BTL-R', 227500, 'battle', '⚙️', true),
  // ---- Epic ----
  E('groundmech', 'Groundmech', 630000, 'workers', '🚜'),
  E('l0', 'L0', 1470000, 'workers', '🤖'),
  E('amp-walker', 'AMP Walker', 3780000, 'workers', '🚶'),
  E('sen-tri', 'Sen-Tri', 3360000, 'workers', '🔱'),
  E('opti-pod', 'Opti-Pod', 2520000, 'workers', '👁️'),
  E('gunrunner', 'Gunrunner', 4410000, 'workers', '🔫'),
  E('n-ul', 'N-UL', 9520000, 'workers', '⚙️', true),
  E('bb', 'BB', 840000, 'astromechs', '⚪'),
  E('r2', 'R2', 2310000, 'astromechs', '🔵'),
  E('r6', 'R6', 1890000, 'astromechs', '🟢'),
  E('trak-r', 'Trak-R', 2100000, 'astromechs', '🟠'),
  E('orb-walker', 'Orb-Walker', 1050000, 'astromechs', '🔮'),
  E('util-tec', 'Util-Tec', 1260000, 'workers', '🔧'),
  E('scrp-r', 'SCRP-R', 9520000, 'workers', '⚙️', true),
  E('b1-heavy', 'B1 Heavy', 4200000, 'battle', '🤖'),
  E('b2-super', 'B2 Super', 2730000, 'battle', '🤖'),
  E('b2-heavy', 'B2 Heavy', 3150000, 'battle', '🤖'),
  E('strike-orb', 'Strike-Orb', 3570000, 'battle', '🔮'),
  E('haul-r', 'Haul-R', 1680000, 'workers', '🚚'),
  E('lng-shot', 'LNG-Shot', 2940000, 'battle', '🔫'),
  E('arm-core', 'ARM-Core', 9200000, 'workers', '⚙️', true),
  E('opt-ar', 'OPT-AR', 9520000, 'workers', '⚙️', true),
  // ---- Legendary ----
  L('proto-roller', 'Proto-Roller', 15400000, 'workers', '🛞'),
  L('mecha-droid', 'Mecha-Droid', 20300000, 'workers', '🤖'),
  L('mono-wlkr', 'Mono-WLKR', 25900000, 'workers', '🚶'),
  L('ro-tor', 'RO-TOR', 50400000, 'workers', '⚙️', true),
  L('fus-3', 'FUS-3', 56000000, 'workers', '⚙️', true),
  L('bb9', 'BB9', 19600000, 'astromechs', '⚫'),
  L('r7', 'R7', 25900000, 'astromechs', '🔵'),
  L('qik-bit', 'QIK-BIT', 56000000, 'astromechs', '⚙️', true),
  L('b2-rp', 'B2-RP', 21700000, 'battle', '🤖'),
  L('cyclo-grav', 'Cyclo-Grav', 21000000, 'battle', '🌀'),
  L('opti-strk', 'Opti-STRK', 25900000, 'battle', '🎯'),
  L('orb-xl', 'ORB-XL', 56000000, 'battle', '⚙️', true),
  // ---- Mythic ----
  M('snow-mouse', 'Snow Mouse', 126000000, 'workers', '🐭'),
  M('ric', 'RIC', 142800000, 'workers', '🤖'),
  M('loadlifter', 'Loadlifter', 210000000, 'workers', '🏗️'),
  M('lep', 'LEP', 176400000, 'workers', '🐰'),
  M('ric-1200', 'RIC-1200', 159600000, 'astromechs', '🔵'),
  M('riv-3t', 'RIV-3T', 252000000, 'astromechs', '⚙️', true),
  M('lug-g', 'LUG-G', 224000000, 'astromechs', '⚙️', true),
  M('low-mo', 'LOW-MO', 238000000, 'astromechs', '⚙️', true, true),
  M('drft-r', 'DRFT-R', 159600000, 'battle', '🏎️'),
  M('cyclens', 'Cyclens', 126000000, 'battle', '🌀'),
  M('mo-trak', 'MO-Trak', 210000000, 'battle', '🚚'),
  M('tri-tek', 'Tri-Tek', 176400000, 'battle', '🔱'),
  M('axi-pod', 'AXI-POD', 252000000, 'battle', '⚙️', true),
  M('ig', 'IG', 159600000, 'battle', '🤖'),
  M('kx', 'KX', 210000000, 'battle', '🛡️'),
  M('srv-o', 'SRV-O', 224000000, 'battle', '⚙️', true),
  M('x-onk', 'X-ONK', 252000000, 'battle', '⚙️', true),
  // ---- Iconic (no credit sell value, global buffs) ----
  ...[
    ['c3po', 'C-3PO', '2x Droid Sell Value'],
    ['r2-d2', 'R2-D2', 'Global buff'],
    ['bb-8', 'BB-8', 'Global buff'],
    ['chopper', 'Chopper', 'Global buff'],
    ['dj-r3x', 'DJ R-3X', 'Global buff'],
    ['d-o', 'D-O', 'Global buff'],
    ['cb-23', 'CB-23', 'Global buff'],
    ['ig11-marshal', 'IG-11 Marshal', 'Global buff'],
    ['mister-bones', 'Mister Bones', 'Global buff']
  ].map(([id, name]): DroidDef => ({ id, name, tier: 'Iconic', base: 0, area: 'special', icon: '⭐' }))
]

export function getSellValue(droid: DroidDef, quality: Quality): number {
  if (droid.tier === 'Iconic') return 0
  const qi = QUALITIES.indexOf(quality)
  if (droid.noStellar && quality === 'Stellar') return 0
  const mult = MULTIPLIERS[droid.tier as Exclude<Tier, 'Iconic'>][qi]
  return Math.round(droid.base * mult)
}

const DROID_MAP: Map<string, DroidDef> = new Map(DROIDS.map(d => [d.id, d]))

export function getDroidDef(id: string): DroidDef | undefined {
  return DROID_MAP.get(id)
}

export function formatCredits(n: number): string {
  if (n <= 0) return 'N/A'
  if (n >= 1e12) return `${trim(n / 1e12)}T`
  if (n >= 1e9) return `${trim(n / 1e9)}B`
  if (n >= 1e6) return `${trim(n / 1e6)}M`
  if (n >= 1e3) return `${trim(n / 1e3)}K`
  return `${Math.round(n)}`
}

function trim(n: number): string {
  return n >= 100 ? `${Math.round(n)}` : n >= 10 ? n.toFixed(1) : n.toFixed(2)
}
