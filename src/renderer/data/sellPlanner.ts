// Rebirth Sell Route Planner — solver module (pure: no UI, no game-rate terms).
//
// Model (v1):
// - req(R) = the 3 (id, paint) entries of rebirth R; all matching copies must
//   be owned simultaneously at the moment R is performed. Performing a
//   rebirth never consumes droids.
// - A copy is protected at step R while any rebirth R' in [R, 35] requires
//   its exact (id, paint) — the filter always spans to 35, regardless of the
//   plan target. Only copies beyond the max-simultaneous need are sell
//   candidates (surplus), plus paint-mismatched copies and valued fusions.
// - Cash resets every step: carry-in is cash-on-hand at the first step only,
//   0 afterwards. Nothing carries across a rebirth.
// - Waste(R) = sales(R) + carryIn(R) − cost(R), minimized per step.
// - Strategy v1 (solveStep, swappable): exact branch-and-bound over
//   integer-scaled values when candidates ≤ 20, else greedy descending +
//   drop-smallest-while-covered improvement. Tie-break: fewer items, then
//   deterministic caller order (callers sort candidates by id, paint).

import { getDroidDef } from './droidValues'
import type { Quality } from './droidValues'
import type { RebirthStep } from './rebirths'
import { formatScaled, scaledSellValue, toScaledCredits } from './sellTable'
import type { PerkLevel } from './sellTable'

export interface RosterCopy {
  id: string
  paint: Quality
}

/** Unit solver value for one copy (default: the compiled sell table). */
export type UnitValueFn = (id: string, paint: Quality) => bigint | undefined

export interface PlannerOptions {
  /** Full path steps (1..35). Requirement spans are computed over these. */
  steps: RebirthStep[]
  /** Current rebirth: first step to perform. */
  fromN: number
  /** Last step to perform. Clamped to 35. */
  targetT: number
  perk: PerkLevel
  c3po: boolean
  /** Credits in hand. Applies to the first step only. */
  cashOnHand: number
  /** Droids-tab multiset: one entry per owned copy. */
  roster: RosterCopy[]
  /** Test seam for synthetic values. Production always uses the table. */
  unitValue?: UnitValueFn
}

export interface SaleLine {
  id: string
  paint: Quality
  qty: number
  unit: bigint
  total: bigint
}

export interface FreedEntry {
  id: string
  paint: Quality
  qty: number
}

export interface MissingReq {
  id: string
  paint: Quality
  need: number
  have: number
}

export interface CoverOption {
  id: string
  paint: Quality
  unit: bigint
  /** Earliest upcoming rebirth needing this copy — selling it breaks this. */
  breaksR: number | null
}

export interface PlanStep {
  r: number
  cost: bigint
  carryIn: bigint
  sales: SaleLine[]
  salesSum: bigint
  cashAfter: bigint
  reqOk: boolean
  performed: boolean
  missing: MissingReq[]
  shortfall: bigint
  nearestCover: CoverOption[]
  waste: bigint
  freed: FreedEntry[]
}

export interface KeepEntry {
  id: string
  paint: Quality
  keepUntil: number
  owned: number
}

export interface PlanResult {
  fromN: number
  targetT: number
  steps: PlanStep[]
  /** Last rebirth actually performed (fromN − 1 when the first step fails). */
  furthest: number
  totalWaste: bigint
  totalCost: bigint
  /** Total waste as % of total performed-step costs. */
  wastePct: number
  /** Sale value of the unsold remainder under the same perk/companion terms. */
  endingValue: bigint
  keepList: KeepEntry[]
  warnings: string[]
}

const copyKey = (id: string, paint: Quality): string => `${id}|${paint}`

function splitKey(k: string): [string, Quality] {
  const i = k.lastIndexOf('|')
  return [k.slice(0, i), k.slice(i + 1) as Quality]
}

function countBy(copies: readonly RosterCopy[]): Map<string, number> {
  const m = new Map<string, number>()
  for (const c of copies) {
    const k = copyKey(c.id, c.paint)
    m.set(k, (m.get(k) ?? 0) + 1)
  }
  return m
}

/** Copies of (id, paint) required simultaneously by one step. */
function reqCountOf(step: RebirthStep): Map<string, number> {
  const m = new Map<string, number>()
  for (const r of step.requires) {
    const k = copyKey(r.droidId, r.quality)
    m.set(k, (m.get(k) ?? 0) + 1)
  }
  return m
}

/**
 * Max simultaneous copies of each (id, paint) required by any step in
 * [fromR, 35]. The span always runs to 35 regardless of the plan target.
 */
export function neededCounts(steps: readonly RebirthStep[], fromR: number): Map<string, number> {
  const need = new Map<string, number>()
  for (const s of steps) {
    if (s.n < fromR || s.n > 35) continue
    for (const [k, v] of reqCountOf(s)) {
      if (v > (need.get(k) ?? 0)) need.set(k, v)
    }
  }
  return need
}

/** Last rebirth in 1..35 requiring (id, paint), or null when never required. */
export function lastRequirement(steps: readonly RebirthStep[], id: string, paint: Quality): number | null {
  let last: number | null = null
  for (const s of steps) {
    if (s.n < 1 || s.n > 35) continue
    if (s.requires.some(r => r.droidId === id && r.quality === paint)) {
      if (last === null || s.n > last) last = s.n
    }
  }
  return last
}

/** Earliest rebirth in [fromR, 35] requiring (id, paint), or null. */
export function nextRequirement(
  steps: readonly RebirthStep[],
  id: string,
  paint: Quality,
  fromR: number
): number | null {
  let next: number | null = null
  for (const s of steps) {
    if (s.n < fromR || s.n > 35) continue
    if (s.requires.some(r => r.droidId === id && r.quality === paint)) {
      if (next === null || s.n < next) next = s.n
    }
  }
  return next
}

/**
 * Exact minimum-sum subset with sum ≥ target. Returns caller-order indices,
 * or null when the values cannot cover the target ([] when target ≤ 0).
 * Tie-break: fewer items, then lexicographically smallest index list.
 */
export function chooseSubset(values: readonly bigint[], target: bigint): number[] | null {
  if (target <= 0n) return []
  const n = values.length
  let total = 0n
  for (const v of values) total += v
  if (total < target) return null
  const suffix = new Array<bigint>(n + 1).fill(0n)
  for (let i = n - 1; i >= 0; i--) suffix[i] = suffix[i + 1] + values[i]
  // Best cover so far; sum < 0 means none yet. Values are assumed ≥ 0, so
  // extensions never improve the sum — property mutation (never
  // reassignment) keeps narrowing sound across the closure.
  const best = { sum: -1n, idx: [] as number[] }
  const chosen: number[] = []
  const lexLess = (a: readonly number[], b: readonly number[]): boolean => {
    const m = Math.min(a.length, b.length)
    for (let i = 0; i < m; i++) {
      if (a[i] !== b[i]) return a[i] < b[i]
    }
    return a.length < b.length
  }
  const dfs = (i: number, sum: bigint): void => {
    if (sum >= target) {
      if (
        best.sum < 0n ||
        sum < best.sum ||
        (sum === best.sum &&
          (chosen.length < best.idx.length ||
            (chosen.length === best.idx.length && lexLess(chosen, best.idx))))
      ) {
        best.sum = sum
        best.idx = [...chosen]
      }
      return
    }
    if (i >= n) return
    if (sum + suffix[i] < target) return
    // Adding copies never lowers the sum, so a partial sum already at or
    // past the best can only tie (more items) or lose — prune it.
    if (best.sum >= 0n && sum >= best.sum) return
    chosen.push(i)
    dfs(i + 1, sum + values[i])
    chosen.pop()
    dfs(i + 1, sum)
  }
  dfs(0, 0n)
  return best.sum < 0n ? null : best.idx
}

/**
 * Greedy descending cover + improvement: repeatedly drop the smallest sold
 * copy while the remainder still covers the target. Null when uncovered.
 */
export function greedyImprove(values: readonly bigint[], target: bigint): number[] | null {
  if (target <= 0n) return []
  const order = values
    .map((v, i) => ({ v, i }))
    .sort((a, b) => {
      if (a.v !== b.v) return a.v > b.v ? -1 : 1
      return a.i - b.i
    })
  const taken: Array<{ v: bigint; i: number }> = []
  let sum = 0n
  for (const o of order) {
    if (sum >= target) break
    taken.push(o)
    sum += o.v
  }
  if (sum < target) return null
  for (;;) {
    let drop = -1
    for (let k = taken.length - 1; k >= 0; k--) {
      if (sum - taken[k].v >= target) {
        drop = k
        break
      }
    }
    if (drop < 0) break
    sum -= taken[drop].v
    taken.splice(drop, 1)
  }
  taken.sort((a, b) => a.i - b.i)
  return taken.map(t => t.i)
}

/** Strategy v1 entry point (swappable): exact at ≤ 20, greedy above. */
export function solveStep(values: readonly bigint[], target: bigint): number[] | null {
  if (values.length <= 20) return chooseSubset(values, target)
  return greedyImprove(values, target)
}

function freedAfter(steps: readonly RebirthStep[], step: RebirthStep): FreedEntry[] {
  const out: FreedEntry[] = []
  for (const [k, qty] of reqCountOf(step)) {
    const [id, paint] = splitKey(k)
    if (lastRequirement(steps, id, paint) === step.n) {
      out.push({ id, paint, qty })
    }
  }
  return out
}

export function planRoute(opts: PlannerOptions): PlanResult {
  const warnings: string[] = []
  const steps = [...opts.steps].sort((a, b) => a.n - b.n)
  let fromN = Number.isFinite(opts.fromN) ? Math.floor(opts.fromN) : 1
  let targetT = Number.isFinite(opts.targetT) ? Math.floor(opts.targetT) : 35
  fromN = Math.max(1, Math.min(35, fromN))
  targetT = Math.max(1, Math.min(35, targetT))
  if (targetT < fromN) {
    return {
      fromN,
      targetT,
      steps: [],
      furthest: fromN - 1,
      totalWaste: 0n,
      totalCost: 0n,
      wastePct: 0,
      endingValue: 0n,
      keepList: [],
      warnings: [`target rebirth ${targetT} is below current rebirth ${fromN} — nothing to plan`],
    }
  }

  const valueOf: UnitValueFn =
    opts.unitValue ?? ((id, paint) => scaledSellValue(id, paint, opts.perk, opts.c3po))
  const cashRaw = opts.cashOnHand
  const cash0 = Number.isFinite(cashRaw) && cashRaw > 0 ? cashRaw : 0
  if (cashRaw !== 0 && !(Number.isFinite(cashRaw) && cashRaw > 0)) {
    warnings.push('cash on hand is not a positive number — treated as 0')
  }

  const remaining: RosterCopy[] = opts.roster.map(c => ({ id: c.id, paint: c.paint }))
  const planSteps: PlanStep[] = []
  let totalWaste = 0n
  let totalCost = 0n
  let furthest = fromN - 1
  const warnedMissing = new Set<string>()

  for (let r = fromN; r <= targetT; r++) {
    const step = steps.find(s => s.n === r)
    if (!step) {
      warnings.push(`no path data for rebirth ${r} — plan stops here`)
      break
    }
    const cost = toScaledCredits(step.cost)
    const carryIn = r === fromN ? toScaledCredits(cash0) : 0n

    // Requirement check against the still-owned roster.
    const need = reqCountOf(step)
    const have = countBy(remaining)
    const missing: MissingReq[] = []
    for (const [k, v] of need) {
      const h = have.get(k) ?? 0
      if (h < v) {
        const [id, paint] = splitKey(k)
        missing.push({ id, paint, need: v, have: h })
      }
    }
    if (missing.length > 0) {
      planSteps.push({
        r,
        cost,
        carryIn,
        sales: [],
        salesSum: 0n,
        cashAfter: 0n,
        reqOk: false,
        performed: false,
        missing,
        shortfall: 0n,
        nearestCover: [],
        waste: 0n,
        freed: [],
      })
      warnings.push(
        `rebirth ${r} cannot be performed — missing requirements: ` +
          missing.map(m => `${m.id} ${m.paint} (need ${m.need}, own ${m.have})`).join(', ')
      )
      break
    }

    // Candidates: owned copies beyond the max-simultaneous need in [r, 35].
    const protect = neededCounts(steps, r)
    const byKey = new Map<string, number[]>()
    remaining.forEach((c, i) => {
      const k = copyKey(c.id, c.paint)
      const arr = byKey.get(k)
      if (arr) arr.push(i)
      else byKey.set(k, [i])
    })
    const retainedIdx = new Set<number>()
    const candIdx: number[] = []
    for (const [k, idxs] of byKey) {
      const prot = protect.get(k) ?? 0
      idxs.forEach((ri, j) => {
        if (j < prot) retainedIdx.add(ri)
        else candIdx.push(ri)
      })
    }

    // Value the candidates; copies without sale data are excluded + warned.
    interface Cand {
      ri: number
      id: string
      paint: Quality
      unit: bigint
    }
    const cands: Cand[] = []
    for (const ri of candIdx) {
      const c = remaining[ri]
      const unit = valueOf(c.id, c.paint)
      if (unit === undefined || unit <= 0n) {
        const wk = copyKey(c.id, c.paint)
        if (!warnedMissing.has(wk)) {
          warnedMissing.add(wk)
          const def = getDroidDef(c.id)
          warnings.push(
            def?.fusion || !def
              ? `missing value data: ${c.id} ${c.paint} excluded from sale candidates`
              : `no sale value: ${c.id} ${c.paint} excluded from sale candidates`
          )
        }
        retainedIdx.add(ri)
        continue
      }
      cands.push({ ri, id: c.id, paint: c.paint, unit })
    }
    // Deterministic order (id, then paint) — drives the solver tie-break.
    cands.sort((a, b) => {
      if (a.id !== b.id) return a.id < b.id ? -1 : 1
      if (a.paint !== b.paint) return a.paint < b.paint ? -1 : 1
      return 0
    })

    const needCash = cost - carryIn
    if (needCash <= 0n) {
      const cashAfter = carryIn - cost
      totalWaste += cashAfter
      totalCost += cost
      planSteps.push({
        r,
        cost,
        carryIn,
        sales: [],
        salesSum: 0n,
        cashAfter,
        reqOk: true,
        performed: true,
        missing: [],
        shortfall: 0n,
        nearestCover: [],
        waste: cashAfter,
        freed: freedAfter(steps, step),
      })
      furthest = r
      continue
    }

    const pick = solveStep(
      cands.map(c => c.unit),
      needCash
    )
    if (!pick) {
      const total = cands.reduce((a, c) => a + c.unit, 0n)
      const shortfall = needCash - total
      // Nearest covering options from protected copies (explicitly marked).
      const retained: Cand[] = []
      for (const ri of retainedIdx) {
        const c = remaining[ri]
        const unit = valueOf(c.id, c.paint)
        if (unit === undefined || unit <= 0n) continue
        retained.push({ ri, id: c.id, paint: c.paint, unit })
      }
      retained.sort((a, b) => {
        if (a.unit !== b.unit) return a.unit > b.unit ? -1 : 1
        return a.id < b.id ? -1 : 1
      })
      const nearestCover: CoverOption[] = []
      let acc = 0n
      for (const rc of retained) {
        if (acc >= shortfall) break
        nearestCover.push({
          id: rc.id,
          paint: rc.paint,
          unit: rc.unit,
          breaksR: nextRequirement(steps, rc.id, rc.paint, r),
        })
        acc += rc.unit
      }
      warnings.push(
        `rebirth ${r}: sales ${formatScaled(total)} + cash ${formatScaled(carryIn)} ` +
          `against cost ${formatScaled(cost)} — shortfall ${formatScaled(shortfall)}`
      )
      if (acc < shortfall) {
        warnings.push(`rebirth ${r}: even selling every protected copy still falls short`)
      }
      planSteps.push({
        r,
        cost,
        carryIn,
        sales: [],
        salesSum: 0n,
        cashAfter: 0n,
        reqOk: true,
        performed: false,
        missing: [],
        shortfall,
        nearestCover,
        waste: 0n,
        freed: [],
      })
      break
    }

    const chosenSet = new Set(pick.map(pi => cands[pi].ri))
    const groups = new Map<string, SaleLine>()
    for (const pi of pick) {
      const c = cands[pi]
      const k = copyKey(c.id, c.paint)
      const g = groups.get(k)
      if (g) {
        g.qty += 1
        g.total += c.unit
      } else {
        groups.set(k, { id: c.id, paint: c.paint, qty: 1, unit: c.unit, total: c.unit })
      }
    }
    const sales = [...groups.values()]
    const salesSum = sales.reduce((a, s) => a + s.total, 0n)
    for (const ri of [...chosenSet].sort((a, b) => b - a)) {
      remaining.splice(ri, 1)
    }
    const cashAfter = salesSum + carryIn - cost
    totalWaste += cashAfter
    totalCost += cost
    planSteps.push({
      r,
      cost,
      carryIn,
      sales,
      salesSum,
      cashAfter,
      reqOk: true,
      performed: true,
      missing: [],
      shortfall: 0n,
      nearestCover: [],
      waste: cashAfter,
      freed: freedAfter(steps, step),
    })
    furthest = r
  }

  let endingValue = 0n
  for (const c of remaining) {
    const u = valueOf(c.id, c.paint)
    if (u !== undefined && u > 0n) endingValue += u
  }
  const wastePct = totalCost > 0n ? Number((totalWaste * 10000n + totalCost / 2n) / totalCost) / 100 : 0

  // Keep list: every (id, paint) required in [fromN, 35] with its last use.
  // Fusion droids are never requirements, so they never appear here.
  const keepList: KeepEntry[] = []
  const seenKeep = new Set<string>()
  const endHave = countBy(remaining)
  for (const s of steps) {
    if (s.n < fromN || s.n > 35) continue
    for (const rq of s.requires) {
      const k = copyKey(rq.droidId, rq.quality)
      if (seenKeep.has(k)) continue
      seenKeep.add(k)
      keepList.push({
        id: rq.droidId,
        paint: rq.quality,
        keepUntil: lastRequirement(steps, rq.droidId, rq.quality) ?? s.n,
        owned: endHave.get(k) ?? 0,
      })
    }
  }
  keepList.sort((a, b) => a.keepUntil - b.keepUntil || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))

  return {
    fromN,
    targetT,
    steps: planSteps,
    furthest,
    totalWaste,
    totalCost,
    wastePct,
    endingValue,
    keepList,
    warnings,
  }
}
