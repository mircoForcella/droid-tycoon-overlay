// Rebirth Sell Route Planner — verification tests (run via npm run test:planner).
// Reads entirely through src/renderer/data/sellTable.ts + sellPlanner.ts
// (the single source); synthetic routes use the unitValue test seam.
// Spec example numbers are illustrative only — real reqs/costs come from
// rebirths.ts, and gates assert true optima (see the waste note below).
import * as assert from 'node:assert/strict'
import { DROIDS, QUALITIES, getDroidDef, getSellValue } from '../src/renderer/data/droidValues'
import {
  PERK_MULT,
  formatScaled,
  lookupSell,
  parseCashInput,
  scaledSellValue,
  sellTableSize,
  sellValue,
  toScaledCredits,
} from '../src/renderer/data/sellTable'
import type { PerkLevel } from '../src/renderer/data/sellTable'
import {
  chooseSubset,
  greedyImprove,
  lastRequirement,
  neededCounts,
  nextRequirement,
  planRoute,
  solveStep,
} from '../src/renderer/data/sellPlanner'
import type { RosterCopy, UnitValueFn } from '../src/renderer/data/sellPlanner'
import { REBIRTH_PATHS } from '../src/renderer/data/rebirths'
import type { RebirthRequirement, RebirthStep } from '../src/renderer/data/rebirths'
import type { Quality } from '../src/renderer/data/droidValues'

// ---------- synthetic-route helpers ----------

const rq = (id: string, paint: Quality): RebirthRequirement => ({ droidId: id, quality: paint, sell: 'safe' })
const r3 = (
  a: RebirthRequirement,
  b: RebirthRequirement,
  c: RebirthRequirement
): [RebirthRequirement, RebirthRequirement, RebirthRequirement] => [a, b, c]
const syn = (
  n: number,
  cost: number,
  requires: [RebirthRequirement, RebirthRequirement, RebirthRequirement]
): RebirthStep => ({ n, cost, requires })

// Filler copies: owned (so req checks pass) but worth 0 (so they never
// pollute subset selection and are excluded with a data warning).
const F1 = 'zz-f1'
const F2 = 'zz-f2'
const F3 = 'zz-f3'
const FILL_REQS = r3(rq(F1, 'Default'), rq(F2, 'Default'), rq(F3, 'Default'))
const FILL_ROSTER: RosterCopy[] = [
  { id: F1, paint: 'Default' },
  { id: F2, paint: 'Default' },
  { id: F3, paint: 'Default' },
]
const zeroFill: UnitValueFn = id => (id.startsWith('zz-') ? 0n : undefined)

// ---------- 1. hard anchors ----------

{
  assert.equal(sellValue('kx', 'Stellar', 0, false), 5880000000000)
  assert.equal(sellValue('kx', 'Stellar', 3, false), 49980000000000)
  assert.equal(sellValue('kx', 'Stellar', 3, true), 99960000000000)
  assert.equal(sellValue('kx', 'Stellar', 1, false) / sellValue('kx', 'Stellar', 0, false), PERK_MULT[1])
  assert.equal(sellValue('kx', 'Stellar', 2, false) / sellValue('kx', 'Stellar', 0, false), PERK_MULT[2])
  assert.equal(scaledSellValue('kx', 'Stellar', 3, false), 4998000000000000n)
  assert.equal(formatScaled(4998000000000000n), '49.98T')
  assert.equal(formatScaled(9996000000000000n), '99.96T')
  assert.equal(formatScaled(588000000000000n), '5.88T')
  console.log('ok anchors')
}

// ---------- 2. table coverage: every droid × paint × perk × companion ----------

{
  let count = 0
  for (const d of DROIDS) {
    for (const q of QUALITIES) {
      for (let p = 0; p <= 3; p++) {
        for (const c of [false, true] as const) {
          const e = lookupSell(d.id, q, p as PerkLevel, c)
          assert.ok(e, `missing entry ${d.id} ${q} perk ${p} c3po ${c}`)
          assert.ok(Number.isFinite(e.value), `non-finite ${d.id} ${q}`)
          assert.equal(typeof e.scaled, 'bigint')
          assert.ok(e.scaled >= 0n)
          count++
        }
      }
    }
  }
  assert.equal(count, sellTableSize())
  assert.equal(sellTableSize(), DROIDS.length * QUALITIES.length * 4 * 2)
  const samples: Array<[string, Quality]> = [
    ['kx', 'Stellar'],
    ['mouse', 'Default'],
    ['r2', 'Diamond'],
    ['tda', 'Galactic'],
  ]
  for (const [id, paint] of samples) {
    const def = getDroidDef(id)
    assert.ok(def)
    assert.equal(sellValue(id, paint, 2, true), getSellValue(def, paint) * 6 * 2)
  }
  console.log('ok table coverage')
}

// ---------- 3. cash reset rule: step 2 funded by its own sales only ----------

{
  const steps = [syn(1, 1000, FILL_REQS), syn(2, 2000, FILL_REQS)]
  const unit: UnitValueFn = id => (id.startsWith('zz-') ? 0n : 100000n)
  const roster: RosterCopy[] = [
    ...FILL_ROSTER,
    { id: 's', paint: 'Default' },
    { id: 's', paint: 'Default' },
    { id: 's', paint: 'Default' },
    { id: 's', paint: 'Default' },
    { id: 's', paint: 'Default' },
    { id: 's', paint: 'Default' },
  ]
  const plan = planRoute({ steps, fromN: 1, targetT: 2, perk: 0, c3po: false, cashOnHand: 500, roster, unitValue: unit })
  assert.equal(plan.steps.length, 2)
  assert.equal(plan.steps[0].carryIn, toScaledCredits(500))
  assert.equal(plan.steps[0].salesSum, toScaledCredits(1000))
  assert.equal(plan.steps[1].carryIn, 0n)
  assert.equal(plan.steps[1].salesSum, toScaledCredits(2000))
  assert.equal(plan.steps[1].cashAfter, 0n)
  assert.equal(plan.furthest, 2)
  console.log('ok cash reset')
}

// ---------- 4. waste optimality ----------
// Spec text claims 80+25=105 for cost 100 over 90/80/25/20, but 80+20=100
// covers exactly with waste 0 — the true optimum. The gate intent (exact
// beats greedy) holds: greedy desc takes 90+80=170 (waste 70).

{
  assert.deepEqual(chooseSubset([90n, 80n, 25n, 20n], 100n), [1, 3])
  assert.deepEqual(greedyImprove([90n, 80n, 25n, 20n], 100n), [0, 1])
  assert.equal(chooseSubset([10n], 100n), null)
  assert.deepEqual(chooseSubset([10n, 20n], 0n), [])
  assert.deepEqual(solveStep([90n, 80n, 25n, 20n], 100n), [1, 3])
  const many = new Array<bigint>(25).fill(10n)
  const r = solveStep(many, 95n)
  assert.ok(r !== null && r.length === 10)
  console.log('ok waste optimality')
}

// ---------- 5. freed-after-use + never-before + shortfall marking ----------

const ABC_STEPS = [
  syn(1, 100, r3(rq('a', 'Gold'), rq(F1, 'Default'), rq(F2, 'Default'))),
  syn(2, 500, r3(rq('d', 'Default'), rq(F1, 'Default'), rq(F2, 'Default'))),
  syn(3, 50, r3(rq('e', 'Default'), rq(F1, 'Default'), rq(F2, 'Default'))),
]
const ABC_UNIT: UnitValueFn = id => {
  if (id.startsWith('zz-')) return 0n
  if (id === 's') return 6000n
  return 100000n
}

{
  assert.equal(neededCounts(ABC_STEPS, 1).get('a|Gold'), 1)
  assert.equal(neededCounts(ABC_STEPS, 2).has('a|Gold'), false)
  assert.equal(nextRequirement(ABC_STEPS, 'a', 'Gold', 1), 1)
  assert.equal(nextRequirement(ABC_STEPS, 'a', 'Gold', 2), null)

  // Step 1: (a,Gold) is the only way to pay, yet must stay protected.
  const stuck = planRoute({
    steps: ABC_STEPS,
    fromN: 1,
    targetT: 1,
    perk: 0,
    c3po: false,
    cashOnHand: 0,
    roster: [{ id: 'a', paint: 'Gold' }, { id: 's', paint: 'Default' }, ...FILL_ROSTER.slice(0, 2)],
    unitValue: ABC_UNIT,
  })
  assert.equal(stuck.steps[0].performed, false)
  assert.equal(stuck.steps[0].shortfall, toScaledCredits(40))
  assert.equal(stuck.steps[0].nearestCover.length, 1)
  assert.equal(stuck.steps[0].nearestCover[0].id, 'a')
  assert.equal(stuck.steps[0].nearestCover[0].breaksR, 1)
  assert.equal(stuck.furthest, 0)

  // Step 2: (a,Gold) was only ever required at 1 — now sellable.
  const freed = planRoute({
    steps: ABC_STEPS,
    fromN: 2,
    targetT: 2,
    perk: 0,
    c3po: false,
    cashOnHand: 0,
    roster: [{ id: 'a', paint: 'Gold' }, { id: 'd', paint: 'Default' }, ...FILL_ROSTER.slice(0, 2)],
    unitValue: ABC_UNIT,
  })
  assert.equal(freed.steps[0].performed, true)
  assert.deepEqual(
    freed.steps[0].sales.map(s => s.id),
    ['a']
  )
  // (d,Default) is only ever required at step 2 → freed right after it.
  assert.ok(freed.steps[0].freed.some(f => f.id === 'd' && f.paint === 'Default' && f.qty === 1))
  console.log('ok freed-after-use + shortfall')
}

// ---------- 6. paint mismatch: matching copy protected, other paint sells ----------

{
  const steps = [syn(1, 50, r3(rq('a', 'Gold'), rq(F1, 'Default'), rq(F2, 'Default')))]
  const plan = planRoute({
    steps,
    fromN: 1,
    targetT: 1,
    perk: 0,
    c3po: false,
    cashOnHand: 0,
    roster: [{ id: 'a', paint: 'Gold' }, { id: 'a', paint: 'Default' }, ...FILL_ROSTER.slice(0, 2)],
    unitValue: ABC_UNIT,
  })
  assert.equal(plan.steps[0].reqOk, true)
  assert.equal(plan.steps[0].performed, true)
  assert.equal(plan.steps[0].sales.length, 1)
  assert.equal(plan.steps[0].sales[0].id, 'a')
  assert.equal(plan.steps[0].sales[0].paint, 'Default')
  console.log('ok paint mismatch')
}

// ---------- 7. req-35 never sold (synthetic + real data) ----------

{
  const p1 = REBIRTH_PATHS[0].steps
  assert.equal(lastRequirement(p1, 'sen-tri', 'Stellar'), 31)
  assert.equal(lastRequirement(p1, 'bb9', 'Stellar'), 35)
  const p3 = REBIRTH_PATHS[2].steps
  assert.equal(lastRequirement(p3, 'kx', 'Stellar'), 35)

  const steps = [
    syn(34, 50, r3(rq('m', 'Default'), rq(F1, 'Default'), rq(F2, 'Default'))),
    syn(35, 60, r3(rq('z', 'Stellar'), rq(F1, 'Default'), rq(F2, 'Default'))),
  ]
  const unit: UnitValueFn = id => {
    if (id.startsWith('zz-')) return 0n
    if (id === 's') return 10000n
    return 1000000n
  }
  const plan = planRoute({
    steps,
    fromN: 34,
    targetT: 35,
    perk: 0,
    c3po: false,
    cashOnHand: 0,
    roster: [
      { id: 'z', paint: 'Stellar' },
      { id: 'm', paint: 'Default' },
      { id: 's', paint: 'Default' },
      { id: 's', paint: 'Default' },
      ...FILL_ROSTER.slice(0, 2),
    ],
    unitValue: unit,
  })
  assert.equal(plan.furthest, 35)
  for (const st of plan.steps) {
    assert.ok(
      st.sales.every(s => s.id !== 'z'),
      'req-35 copy sold'
    )
  }
  assert.ok(plan.endingValue >= 10000n * 100n)
  const keepZ = plan.keepList.find(k => k.id === 'z')
  assert.ok(keepZ && keepZ.keepUntil === 35)
  console.log('ok req-35')
}

// ---------- 8. multi-copy surplus: one sells, one stays for later ----------

{
  const steps = [
    syn(1, 100, r3(rq('a', 'Gold'), rq(F1, 'Default'), rq(F2, 'Default'))),
    syn(2, 10, r3(rq('a', 'Gold'), rq(F1, 'Default'), rq(F2, 'Default'))),
  ]
  const plan = planRoute({
    steps,
    fromN: 1,
    targetT: 2,
    perk: 0,
    c3po: false,
    cashOnHand: 0,
    roster: [
      { id: 'a', paint: 'Gold' },
      { id: 'a', paint: 'Gold' },
      { id: 's', paint: 'Default' },
      ...FILL_ROSTER.slice(0, 2),
    ],
    unitValue: ABC_UNIT,
  })
  assert.equal(plan.steps[0].sales.length, 1)
  assert.equal(plan.steps[0].sales[0].id, 'a')
  assert.equal(plan.steps[0].sales[0].qty, 1)
  assert.equal(plan.steps[1].reqOk, true)
  assert.equal(plan.steps[1].performed, true)
  assert.equal(plan.furthest, 2)
  // (a,Gold) is still required at step 2 → not freed after step 1, but
  // freed after step 2 (its last use).
  assert.equal(plan.steps[0].freed.length, 0)
  assert.ok(plan.steps[1].freed.some(f => f.id === 'a' && f.paint === 'Gold' && f.qty === 1))
  console.log('ok surplus')
}

// ---------- 9. fusion: valued proposed, unvalued warned + excluded ----------

{
  const steps = [syn(1, 1, FILL_REQS)]
  const roster: RosterCopy[] = [{ id: 'whl-ex', paint: 'Default' }, ...FILL_ROSTER]
  const ok = planRoute({ steps, fromN: 1, targetT: 1, perk: 0, c3po: false, cashOnHand: 0, roster })
  assert.equal(ok.steps[0].performed, true)
  assert.ok(ok.steps[0].sales.some(s => s.id === 'whl-ex'))

  const bad = planRoute({
    steps,
    fromN: 1,
    targetT: 1,
    perk: 0,
    c3po: false,
    cashOnHand: 0,
    roster,
    unitValue: (id, paint) => (id === 'whl-ex' ? 0n : zeroFill(id, paint)),
  })
  assert.equal(bad.steps[0].performed, false)
  assert.ok(bad.warnings.some(w => w.includes('missing value data') && w.includes('whl-ex')))
  console.log('ok fusion')
}

// ---------- 10. horizon clamp + empty plan ----------

{
  const steps = [syn(1, 10, FILL_REQS), syn(2, 10, FILL_REQS), syn(3, 10, FILL_REQS)]
  const unit: UnitValueFn = id => (id.startsWith('zz-') ? 0n : 100000n)
  const roster: RosterCopy[] = [...FILL_ROSTER, { id: 's', paint: 'Default' }, { id: 's', paint: 'Default' }, { id: 's', paint: 'Default' }]
  const plan = planRoute({ steps, fromN: 0, targetT: 99, perk: 0, c3po: false, cashOnHand: 0, roster, unitValue: unit })
  assert.equal(plan.fromN, 1)
  assert.equal(plan.targetT, 35)
  assert.equal(plan.steps.length, 3)
  assert.equal(plan.furthest, 3)

  const empty = planRoute({ steps, fromN: 5, targetT: 2, perk: 0, c3po: false, cashOnHand: 0, roster, unitValue: unit })
  assert.equal(empty.steps.length, 0)
  assert.ok(empty.warnings.length > 0)
  console.log('ok horizon clamp')
}

// ---------- 11. formatters ----------

{
  assert.equal(formatScaled(0n), '0.00')
  assert.equal(formatScaled(100000n), '1.00K')
  assert.equal(formatScaled(99999900n), '1.00M')
  assert.equal(parseCashInput('1.5T'), 1.5e12)
  assert.equal(parseCashInput('300K'), 300000)
  assert.equal(parseCashInput('42'), 42)
  assert.equal(parseCashInput(''), 0)
  assert.ok(Number.isNaN(parseCashInput('abc')))
  assert.equal(toScaledCredits(10000), 1000000n)
  console.log('ok formatters')
}

// ---------- 12. real-data smoke: empty roster halts on missing reqs ----------

{
  const plan = planRoute({
    steps: REBIRTH_PATHS[0].steps,
    fromN: 1,
    targetT: 35,
    perk: 0,
    c3po: false,
    cashOnHand: 0,
    roster: [],
  })
  assert.equal(plan.steps.length, 1)
  assert.equal(plan.steps[0].reqOk, false)
  assert.ok(plan.warnings.length > 0)
  // Requirement filtering spans the full path even past the target.
  assert.ok(plan.keepList.some(k => k.keepUntil === 35))
  console.log('ok real-data smoke')
}

// ---------- 13. user paint rule: fulfilled req frees the mismatched spare ----------

{
  const steps = [syn(1, 50, r3(rq('a', 'Gold'), rq(F1, 'Default'), rq(F2, 'Default')))]
  const unit: UnitValueFn = id => (id.startsWith('zz-') ? 0n : 100000n)
  const plan = planRoute({
    steps,
    fromN: 1,
    targetT: 1,
    perk: 0,
    c3po: false,
    cashOnHand: 0,
    roster: [{ id: 'a', paint: 'Gold' }, { id: 'a', paint: 'Default' }, ...FILL_ROSTER.slice(0, 2)],
    unitValue: unit,
  })
  // The Gold fulfills the requirement, so the Default is disposable and sells.
  assert.equal(plan.steps[0].performed, true)
  assert.equal(plan.steps[0].sales.length, 1)
  assert.equal(plan.steps[0].sales[0].paint, 'Default')
  assert.equal(plan.endingValue, 100000n)
  console.log('ok user paint rule')
}

// ---------- 14. lone mismatch held as necessary, never sold ----------

{
  const steps = [
    syn(1, 50, r3(rq('b', 'Default'), rq(F1, 'Default'), rq(F2, 'Default'))),
    syn(2, 10, r3(rq('a', 'Gold'), rq(F1, 'Default'), rq(F2, 'Default'))),
  ]
  const unit: UnitValueFn = id => {
    if (id.startsWith('zz-')) return 0n
    if (id === 's') return 6000n
    return 100000n
  }
  const plan = planRoute({
    steps,
    fromN: 1,
    targetT: 2,
    perk: 0,
    c3po: false,
    cashOnHand: 0,
    roster: [
      { id: 'b', paint: 'Default' },
      { id: 'a', paint: 'Default' },
      { id: 's', paint: 'Default' },
      ...FILL_ROSTER.slice(0, 2),
    ],
    unitValue: unit,
  })
  assert.equal(plan.steps[0].performed, true)
  assert.deepEqual(
    plan.steps[0].sales.map(s => s.id),
    ['s']
  )
  // Step 2 needs (a, Gold); only a mismatched copy is owned → missing halt.
  assert.equal(plan.steps[1].reqOk, false)
  // The lone (a, Default) was never sold and is labeled necessary.
  assert.ok(plan.steps.every(st => st.sales.every(s => s.id !== 'a')))
  const keepA = plan.keepList.find(k => k.id === 'a' && k.paint === 'Default')
  assert.ok(keepA && keepA.note === 'necessary' && keepA.keepUntil === 2)
  console.log('ok lone mismatch held')
}

// ---------- 15. two of the same: one disposable, one necessary ----------

{
  const steps = [syn(1, 50, r3(rq('a', 'Gold'), rq(F1, 'Default'), rq(F2, 'Default')))]
  const unit: UnitValueFn = id => (id.startsWith('zz-') ? 0n : 100000n)
  const plan = planRoute({
    steps,
    fromN: 1,
    targetT: 1,
    perk: 0,
    c3po: false,
    cashOnHand: 0,
    roster: [
      { id: 'a', paint: 'Gold' },
      { id: 'a', paint: 'Default' },
      { id: 'a', paint: 'Default' },
      ...FILL_ROSTER.slice(0, 2),
    ],
    unitValue: unit,
  })
  assert.equal(plan.steps[0].performed, true)
  assert.equal(plan.steps[0].sales.length, 1)
  assert.equal(plan.steps[0].sales[0].paint, 'Default')
  assert.equal(plan.steps[0].sales[0].qty, 1)
  const keepA = plan.keepList.find(k => k.id === 'a' && k.paint === 'Default')
  assert.ok(keepA && keepA.note === 'necessary' && keepA.owned === 1)
  console.log('ok two of the same')
}

// ---------- 16. gap mode: walk continues, total missing = Σ shortfalls ----------

{
  const steps = [
    syn(1, 100, r3(rq('b', 'Default'), rq(F1, 'Default'), rq(F2, 'Default'))),
    syn(2, 200, r3(rq('c', 'Default'), rq(F1, 'Default'), rq(F2, 'Default'))),
    syn(3, 300, r3(rq('d', 'Default'), rq(F1, 'Default'), rq(F2, 'Default'))),
  ]
  const unit: UnitValueFn = id => {
    if (id.startsWith('zz-')) return 0n
    if (id === 's') return 6000n
    return 100000n
  }
  const plan = planRoute({
    steps,
    fromN: 1,
    targetT: 3,
    perk: 0,
    c3po: false,
    cashOnHand: 0,
    roster: [
      { id: 'b', paint: 'Default' },
      { id: 'c', paint: 'Default' },
      { id: 'd', paint: 'Default' },
      { id: 's', paint: 'Default' },
      ...FILL_ROSTER.slice(0, 2),
    ],
    unitValue: unit,
  })
  assert.equal(plan.steps.length, 3)
  assert.ok(plan.steps.every(st => st.hypothetical && !st.performed))
  assert.equal(plan.furthest, 0)
  // R1 is short 40; R2/R3 are fantasy-coverable (freed b, then c) with
  // zero further shortfall — each copy counted exactly once.
  assert.equal(plan.steps[0].shortfall, toScaledCredits(40))
  assert.deepEqual(
    plan.steps[1].sales.map(s => s.id),
    ['b']
  )
  assert.equal(plan.steps[1].shortfall, 0n)
  assert.deepEqual(
    plan.steps[2].sales.map(s => s.id),
    ['c']
  )
  assert.equal(plan.steps[2].shortfall, 0n)
  assert.equal(plan.totalMissing, toScaledCredits(40))
  assert.equal(plan.steps[0].nearestCover[0].id, 'b')
  // Gap accounting never distorts the real remainder.
  assert.equal(plan.endingValue, 306000n)
  console.log('ok gap total')
}

// ---------- 17. req-35 lock holds even in gap mode ----------

{
  const steps = [
    syn(34, 50, r3(rq('m', 'Default'), rq(F1, 'Default'), rq(F2, 'Default'))),
    syn(35, 60000, r3(rq('z', 'Stellar'), rq(F1, 'Default'), rq(F2, 'Default'))),
  ]
  const unit: UnitValueFn = id => {
    if (id.startsWith('zz-')) return 0n
    if (id === 's') return 10000n
    return 1000000n
  }
  const plan = planRoute({
    steps,
    fromN: 34,
    targetT: 35,
    perk: 0,
    c3po: false,
    cashOnHand: 0,
    roster: [
      { id: 'z', paint: 'Stellar' },
      { id: 'm', paint: 'Default' },
      { id: 's', paint: 'Default' },
      ...FILL_ROSTER.slice(0, 2),
    ],
    unitValue: unit,
  })
  assert.equal(plan.steps[0].performed, true)
  assert.equal(plan.steps[1].hypothetical, true)
  assert.equal(plan.furthest, 34)
  assert.equal(plan.totalMissing, toScaledCredits(60000 - 10000))
  for (const st of plan.steps) {
    assert.ok(
      st.sales.every(s => s.id !== 'z'),
      'req-35 copy touched in gap mode'
    )
  }
  assert.equal(plan.endingValue, 2000000n)
  const keepZ = plan.keepList.find(k => k.id === 'z')
  assert.ok(keepZ && keepZ.keepUntil === 35)
  console.log('ok req-35 in gap mode')
}

console.log('ALL PLANNER TESTS PASSED')
