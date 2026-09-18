// Rebirth Sell Route Planner — sell-value module (single source of truth).
//
// Pure function sellValue(id, paint, perk, c3po) = perk-0 base value from
// droidValues.ts × perk multiplier × (c3po ? 2 : 1).
// Perk multipliers: [1, 3.5, 6, 8.5].
//
// An in-memory table over every (droid, paint) × perk 0–3 × companion
// on/off is compiled once at module load from droidValues.ts — never a
// committed generated file. The solver, the UI, and the tests all read
// through this module. Solver math uses the integer-scaled (×100) bigint
// column so subset-sums stay free of float dust; display uses 2-decimal
// suffixes.
//
// By design this module (like the whole planner) has no game-rate terms.

import { DROIDS, QUALITIES, getDroidDef, getSellValue } from './droidValues'
import type { Quality } from './droidValues'

export const PERK_MULT = [1, 3.5, 6, 8.5] as const
export type PerkLevel = 0 | 1 | 2 | 3

// Exact integer ratios for the perk multipliers (3.5 = 7/2, 8.5 = 17/2)
// so scaled math never touches floats. Index matches PERK_MULT order.
const PERK_RATIO: ReadonlyArray<readonly [bigint, bigint]> = [
  [1n, 1n],
  [7n, 2n],
  [6n, 1n],
  [17n, 2n],
]

// Solver money unit: hundredths of a credit, as bigint.
export const MONEY_SCALE = 100n

export interface SellTableEntry {
  /** Display/comparison value in credits (float). */
  value: number
  /** Exact solver value in hundredths of a credit (bigint). */
  scaled: bigint
}

function tableKey(id: string, paint: Quality, perk: PerkLevel, c3po: boolean): string {
  return `${id}|${paint}|${perk}|${c3po ? 1 : 0}`
}

function buildTable(): Map<string, SellTableEntry> {
  const table = new Map<string, SellTableEntry>()
  for (const def of DROIDS) {
    for (const paint of QUALITIES) {
      const perk0 = getSellValue(def, paint)
      for (let p = 0; p <= 3; p++) {
        const [num, den] = PERK_RATIO[p]
        for (const c3po of [false, true] as const) {
          const value = perk0 * PERK_MULT[p] * (c3po ? 2 : 1)
          // perk0 is an integer (Math.round inside getSellValue) and
          // perk0 × 100 is always divisible by den (den is 1 or 2).
          const scaled = ((BigInt(perk0) * MONEY_SCALE * num) / den) * (c3po ? 2n : 1n)
          if (!Number.isFinite(value)) {
            throw new Error(`sell table: non-finite value for ${def.id} ${paint} perk ${p}`)
          }
          table.set(tableKey(def.id, paint, p as PerkLevel, c3po), { value, scaled })
        }
      }
    }
  }
  return table
}

// Compiled once at module load (= app startup for the renderer, import
// time for tests). No committed generated file — drops of new droids or
// paints in droidValues.ts flow through automatically.
const TABLE: Map<string, SellTableEntry> = buildTable()

export function lookupSell(id: string, paint: Quality, perk: PerkLevel, c3po: boolean): SellTableEntry | undefined {
  return TABLE.get(tableKey(id, paint, perk, c3po))
}

/** Credits (float). NaN when the (id, paint) pair has no table entry. */
export function sellValue(id: string, paint: Quality, perk: PerkLevel, c3po: boolean): number {
  return lookupSell(id, paint, perk, c3po)?.value ?? NaN
}

/** Hundredths of a credit (bigint). undefined when no table entry exists. */
export function scaledSellValue(id: string, paint: Quality, perk: PerkLevel, c3po: boolean): bigint | undefined {
  return lookupSell(id, paint, perk, c3po)?.scaled
}

/** A copy has usable sale data when its perk-0 base value is positive. */
export function hasSaleValue(id: string, paint: Quality): boolean {
  const def = getDroidDef(id)
  if (!def) return false
  return getSellValue(def, paint) > 0
}

export function sellTableSize(): number {
  return TABLE.size
}

/** Credits (float) → solver units (bigint hundredths). */
export function toScaledCredits(n: number): bigint {
  if (!Number.isFinite(n) || n <= 0) return 0n
  return BigInt(Math.round(n * 100))
}

const SUFFIXES: ReadonlyArray<readonly [bigint, string]> = [
  [1000000000000n, 'T'],
  [1000000000n, 'B'],
  [1000000n, 'M'],
  [1000n, 'K'],
]

/** Display a solver-scaled value with exactly 2 decimals + suffix. */
export function formatScaled(scaled: bigint): string {
  const sign = scaled < 0n ? '-' : ''
  const rest = scaled < 0n ? -scaled : scaled
  const credits = rest / MONEY_SCALE
  let idx = SUFFIXES.length // plain credits
  for (let i = 0; i < SUFFIXES.length; i++) {
    if (credits >= SUFFIXES[i][0]) {
      idx = i
      break
    }
  }
  const div = idx === SUFFIXES.length ? 1n : SUFFIXES[idx][0]
  const unitBase = div * MONEY_SCALE
  let hundredths = (rest * 100n + unitBase / 2n) / unitBase
  // Rounding carry (e.g. 999.999K) bumps one suffix up.
  if (hundredths >= 100000n && idx > 0 && idx < SUFFIXES.length) {
    idx -= 1
    hundredths = 100n
  }
  const suffix = idx === SUFFIXES.length ? '' : SUFFIXES[idx][1]
  const whole = hundredths / 100n
  const frac = hundredths % 100n
  return `${sign}${whole}.${frac.toString().padStart(2, '0')}${suffix}`
}

/** Parse a cash field: plain credits or a K/M/B/T suffix. NaN when invalid. */
export function parseCashInput(text: string): number {
  const t = text.trim().toUpperCase()
  if (t === '') return 0
  const m = /^([0-9]+(?:\.[0-9]+)?)\s*([KMBT])?$/.exec(t)
  if (!m) return NaN
  const mult = m[2] === 'T' ? 1e12 : m[2] === 'B' ? 1e9 : m[2] === 'M' ? 1e6 : m[2] === 'K' ? 1e3 : 1
  return parseFloat(m[1]) * mult
}
