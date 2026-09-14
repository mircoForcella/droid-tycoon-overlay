// Super Rebirth paths data (source: DROID TYCOON REBIRTH CYCLES masterdoc).
// 5 paths (cycles) x 35 rebirths. Each rebirth: credit cost + 3 required droids
// (droidId + paint quality + sell flag).
// Sell flags: 'safe' = named in sheet Sell column or blank row (instance not needed later).
//             'keep' = sheet says "Do not sell", or unnamed in a partially-named row.

import { Quality } from './droidValues'

export interface RebirthRequirement {
  droidId: string
  quality: Quality
  sell: 'safe' | 'needed21' | 'keep'
}

export interface RebirthStep {
  n: number
  cost: number
  requires: [RebirthRequirement, RebirthRequirement, RebirthRequirement]
  xpMult?: number
  coinMult?: number
}

export interface RebirthPath {
  path: number
  name: string
  steps: RebirthStep[]
}

function req(droidId: string, quality: Quality, sell: RebirthRequirement['sell'] = 'safe'): RebirthRequirement {
  return { droidId, quality, sell }
}

const K = 1e3, M = 1e6, B = 1e9, T = 1e12

export const REBIRTH_PATHS: RebirthPath[] = [
  {
    path: 1,
    name: 'Cycle 1',
    steps: [
      { n: 1, cost: 10 * K, requires: [req('cb', 'Default'), req('pit', 'Default'), req('drk1-probe', 'Default')] },
      { n: 2, cost: 150 * K, requires: [req('bdx-explorer', 'Default'), req('2bb', 'Default'), req('bal-core', 'Default')] },
      { n: 3, cost: 975 * K, requires: [req('a-lt', 'Default', 'keep'), req('b-u4d', 'Default', 'keep'), req('r9', 'Gold', 'keep')] },
      { n: 4, cost: 2.95 * M, requires: [req('arg', 'Gold', 'keep'), req('b1-security', 'Gold', 'keep'), req('groundmech', 'Default', 'keep')] },
      { n: 5, cost: 5.35 * M, requires: [req('b-u4d', 'Gold', 'keep'), req('hov-r', 'Gold', 'keep'), req('r9', 'Diamond')] },
      { n: 6, cost: 9.85 * M, requires: [req('groundmech', 'Gold', 'keep'), req('arg', 'Diamond'), req('a-lt', 'Diamond')] },
      { n: 7, cost: 14.5 * M, requires: [req('bb', 'Gold', 'keep'), req('b1-security', 'Diamond'), req('b-u4d', 'Diamond')] },
      { n: 8, cost: 36 * M, requires: [req('util-tec', 'Gold'), req('l0', 'Gold', 'keep'), req('hov-r', 'Diamond')] },
      { n: 9, cost: 89 * M, requires: [req('groundmech', 'Rainbow', 'keep'), req('r6', 'Gold'), req('trak-r', 'Gold')] },
      { n: 10, cost: 220 * M, requires: [req('l0', 'Rainbow'), req('haul-r', 'Rainbow'), req('strike-orb', 'Gold')] },
      { n: 11, cost: 550 * M, requires: [req('amp-walker', 'Rainbow', 'keep'), req('b1-heavy', 'Rainbow', 'keep'), req('bb9', 'Default', 'keep')] },
      { n: 12, cost: 1.36 * B, requires: [req('proto-roller', 'Gold', 'keep'), req('mono-wlkr', 'Default', 'keep'), req('mecha-droid', 'Default', 'keep')] },
      { n: 13, cost: 3.4 * B, requires: [req('r7', 'Default', 'keep'), req('cyclo-grav', 'Default', 'keep'), req('b2-rp', 'Default', 'keep')] },
      { n: 14, cost: 8.45 * B, requires: [req('opti-strk', 'Default', 'keep'), req('mono-wlkr', 'Gold', 'keep'), req('mecha-droid', 'Gold', 'keep')] },
      { n: 15, cost: 21 * B, requires: [req('b2-rp', 'Gold', 'keep'), req('bb9', 'Gold', 'keep'), req('r7', 'Gold', 'keep')] },
      { n: 16, cost: 52 * B, requires: [req('opti-strk', 'Gold', 'keep'), req('mono-wlkr', 'Diamond', 'keep'), req('proto-roller', 'Diamond', 'keep')] },
      { n: 17, cost: 130 * B, requires: [req('b2-rp', 'Diamond', 'keep'), req('cyclo-grav', 'Diamond', 'keep'), req('mecha-droid', 'Diamond', 'keep')] },
      { n: 18, cost: 325 * B, requires: [req('bb9', 'Diamond', 'keep'), req('r7', 'Diamond', 'keep'), req('mono-wlkr', 'Rainbow', 'keep')] },
      { n: 19, cost: 810 * B, requires: [req('b2-rp', 'Rainbow', 'keep'), req('cyclo-grav', 'Rainbow', 'keep'), req('proto-roller', 'Rainbow', 'keep')] },
      { n: 20, cost: 2 * T, requires: [req('r7', 'Rainbow', 'keep'), req('opti-strk', 'Rainbow', 'keep'), req('mecha-droid', 'Rainbow', 'keep')] },
      { n: 21, cost: 3 * T, requires: [req('bb', 'Beskar'), req('orb-walker', 'Beskar'), req('groundmech', 'Beskar')] },
      { n: 22, cost: 4.5 * T, requires: [req('amp-walker', 'Beskar'), req('b1-heavy', 'Beskar'), req('proto-roller', 'Beskar', 'keep')] },
      { n: 23, cost: 6 * T, requires: [req('opti-strk', 'Beskar'), req('mono-wlkr', 'Beskar'), req('r7', 'Beskar')] },
      { n: 24, cost: 9 * T, requires: [req('bb9', 'Beskar'), req('cyclo-grav', 'Beskar'), req('mo-trak', 'Default', 'keep')] },
      { n: 25, cost: 13.5 * T, requires: [req('b2-rp', 'Beskar', 'keep'), req('ig', 'Default', 'keep'), req('drft-r', 'Gold', 'keep')] },
      { n: 26, cost: 21 * T, requires: [req('cyclens', 'Gold', 'keep'), req('loadlifter', 'Diamond', 'keep'), req('ric-1200', 'Rainbow')] },
      { n: 27, cost: 32 * T, requires: [req('kx', 'Diamond'), req('tri-tek', 'Rainbow'), req('snow-mouse', 'Beskar')] },
      { n: 28, cost: 45 * T, requires: [req('mo-trak', 'Rainbow'), req('drft-r', 'Beskar'), req('proto-roller', 'Galactic')] },
      { n: 29, cost: 68 * T, requires: [req('ig', 'Beskar'), req('mono-wlkr', 'Galactic'), req('mecha-droid', 'Galactic')] },
      { n: 30, cost: 100 * T, requires: [req('b2-rp', 'Galactic'), req('cyclens', 'Beskar'), req('loadlifter', 'Galactic')] },
      { n: 31, cost: 150 * T, requires: [req('proto-roller', 'Beskar'), req('kx', 'Beskar'), req('sen-tri', 'Stellar')] },
      { n: 32, cost: 230 * T, requires: [req('ric', 'Beskar'), req('opti-pod', 'Galactic'), req('orb-walker', 'Galactic')] },
      { n: 33, cost: 345 * T, requires: [req('cyclo-grav', 'Galactic'), req('drft-r', 'Galactic'), req('b1-heavy', 'Stellar')] },
      { n: 34, cost: 520 * T, requires: [req('cyclens', 'Galactic'), req('bb', 'Stellar'), req('groundmech', 'Stellar')] },
      { n: 35, cost: 778 * T, requires: [req('bb9', 'Stellar'), req('ig', 'Stellar'), req('snow-mouse', 'Stellar')] }
    ]
  },
  {
    path: 2,
    name: 'Cycle 2',
    steps: [
      { n: 1, cost: 10 * K, requires: [req('mouse', 'Default'), req('gonk', 'Default'), req('id10', 'Default')] },
      { n: 2, cost: 150 * K, requires: [req('roll-r', 'Default', 'keep'), req('nav-ex', 'Default', 'keep'), req('senate-hovercam', 'Default')] },
      { n: 3, cost: 975 * K, requires: [req('r4', 'Default', 'keep'), req('vect-arm', 'Default', 'keep'), req('bdx-explorer', 'Gold', 'keep')] },
      { n: 4, cost: 2.95 * M, requires: [req('2bb', 'Gold', 'keep'), req('bal-core', 'Gold', 'keep'), req('orb-walker', 'Default', 'keep')] },
      { n: 5, cost: 5.35 * M, requires: [req('r4', 'Gold', 'keep'), req('vect-arm', 'Gold', 'keep'), req('nav-ex', 'Gold', 'keep')] },
      { n: 6, cost: 9.85 * M, requires: [req('gunrunner', 'Default', 'keep'), req('2bb', 'Diamond'), req('bal-core', 'Diamond', 'keep')] },
      { n: 7, cost: 14.5 * M, requires: [req('roll-r', 'Diamond'), req('bdx-explorer', 'Diamond'), req('r2', 'Gold', 'keep')] },
      { n: 8, cost: 36 * M, requires: [req('r4', 'Diamond'), req('b2-super', 'Gold', 'keep'), req('gunrunner', 'Gold')] },
      { n: 9, cost: 89 * M, requires: [req('nav-ex', 'Rainbow'), req('strike-orb', 'Gold', 'keep'), req('amp-walker', 'Gold', 'keep')] },
      { n: 10, cost: 220 * M, requires: [req('vect-arm', 'Rainbow'), req('r2', 'Diamond', 'keep'), req('b2-super', 'Diamond', 'keep')] },
      { n: 11, cost: 550 * M, requires: [req('strike-orb', 'Diamond', 'keep'), req('b2-heavy', 'Diamond', 'keep'), req('bal-core', 'Rainbow')] },
      { n: 12, cost: 1.36 * B, requires: [req('orb-walker', 'Rainbow'), req('r2', 'Rainbow'), req('bb9', 'Default', 'keep')] },
      { n: 13, cost: 3.4 * B, requires: [req('b2-super', 'Rainbow'), req('mecha-droid', 'Default', 'keep'), req('proto-roller', 'Default', 'keep')] },
      { n: 14, cost: 8.45 * B, requires: [req('b2-heavy', 'Rainbow'), req('b2-rp', 'Default', 'keep'), req('r7', 'Gold', 'keep')] },
      { n: 15, cost: 21 * B, requires: [req('strike-orb', 'Rainbow', 'keep'), req('bb9', 'Gold', 'keep'), req('proto-roller', 'Gold', 'keep')] },
      { n: 16, cost: 52 * B, requires: [req('b2-rp', 'Diamond', 'keep'), req('mecha-droid', 'Gold', 'keep'), req('amp-walker', 'Rainbow')] },
      { n: 17, cost: 130 * B, requires: [req('opti-pod', 'Rainbow'), req('r7', 'Diamond', 'keep'), req('mono-wlkr', 'Gold', 'keep')] },
      { n: 18, cost: 325 * B, requires: [req('util-tec', 'Rainbow'), req('bb9', 'Diamond', 'keep'), req('proto-roller', 'Diamond', 'keep')] },
      { n: 19, cost: 810 * B, requires: [req('mecha-droid', 'Diamond', 'keep'), req('r7', 'Rainbow', 'keep'), req('b2-rp', 'Rainbow', 'keep')] },
      { n: 20, cost: 2 * T, requires: [req('mono-wlkr', 'Rainbow', 'keep'), req('opti-strk', 'Rainbow', 'keep'), req('cyclo-grav', 'Rainbow', 'keep')] },
      { n: 21, cost: 3 * T, requires: [req('l0', 'Beskar'), req('r6', 'Beskar'), req('haul-r', 'Beskar')] },
      { n: 22, cost: 4.5 * T, requires: [req('sen-tri', 'Beskar'), req('strike-orb', 'Beskar'), req('proto-roller', 'Beskar')] },
      { n: 23, cost: 6 * T, requires: [req('bb9', 'Beskar'), req('cyclo-grav', 'Beskar', 'keep'), req('b2-rp', 'Beskar', 'keep')] },
      { n: 24, cost: 9 * T, requires: [req('snow-mouse', 'Default', 'keep'), req('opti-strk', 'Beskar', 'keep'), req('b2-rp', 'Beskar')] },
      { n: 25, cost: 13.5 * T, requires: [req('ric-1200', 'Default'), req('tri-tek', 'Gold', 'keep'), req('mono-wlkr', 'Beskar')] },
      { n: 26, cost: 21 * T, requires: [req('kx', 'Gold', 'keep'), req('drft-r', 'Diamond', 'keep'), req('ig', 'Rainbow')] },
      { n: 27, cost: 32 * T, requires: [req('lep', 'Diamond'), req('loadlifter', 'Rainbow'), req('mo-trak', 'Beskar')] },
      { n: 28, cost: 45 * T, requires: [req('snow-mouse', 'Rainbow'), req('tri-tek', 'Beskar'), req('mecha-droid', 'Galactic')] },
      { n: 29, cost: 68 * T, requires: [req('ric', 'Beskar'), req('cyclo-grav', 'Galactic'), req('r7', 'Galactic')] },
      { n: 30, cost: 100 * T, requires: [req('kx', 'Beskar'), req('opti-strk', 'Galactic'), req('drft-r', 'Galactic')] },
      { n: 31, cost: 150 * T, requires: [req('b2-rp', 'Beskar'), req('loadlifter', 'Beskar'), req('b2-super', 'Stellar')] },
      { n: 32, cost: 230 * T, requires: [req('lep', 'Beskar'), req('gunrunner', 'Galactic'), req('b1-heavy', 'Galactic')] },
      { n: 33, cost: 345 * T, requires: [req('kx', 'Galactic'), req('opti-strk', 'Galactic'), req('r2', 'Stellar')] },
      { n: 34, cost: 520 * T, requires: [req('ric', 'Galactic'), req('l0', 'Stellar'), req('r6', 'Stellar')] },
      { n: 35, cost: 778 * T, requires: [req('r7', 'Stellar'), req('drft-r', 'Stellar'), req('cyclens', 'Stellar')] }
    ]
  },
  {
    path: 3,
    name: 'Cycle 3',
    steps: [
      { n: 1, cost: 10 * K, requires: [req('mouse', 'Default'), req('pit', 'Default'), req('gonk', 'Default')] },
      { n: 2, cost: 150 * K, requires: [req('2bb', 'Default'), req('r3', 'Default'), req('senate-hovercam', 'Default')] },
      { n: 3, cost: 975 * K, requires: [req('r4', 'Default'), req('r5', 'Default'), req('r8', 'Default')] },
      { n: 4, cost: 2.95 * M, requires: [req('r9', 'Gold'), req('b1-battle', 'Gold'), req('b1-security', 'Gold')] },
      { n: 5, cost: 5.35 * M, requires: [req('2bb', 'Gold'), req('r3', 'Gold'), req('senate-hovercam', 'Gold')] },
      { n: 6, cost: 9.85 * M, requires: [req('bdx-explorer', 'Diamond'), req('r4', 'Diamond'), req('r5', 'Diamond')] },
      { n: 7, cost: 14.5 * M, requires: [req('r8', 'Diamond'), req('r9', 'Diamond'), req('b1-battle', 'Diamond')] },
      { n: 8, cost: 36 * M, requires: [req('b1-security', 'Rainbow'), req('r3', 'Rainbow'), req('2bb', 'Rainbow')] },
      { n: 9, cost: 89 * M, requires: [req('bdx-explorer', 'Rainbow'), req('r4', 'Rainbow'), req('r5', 'Rainbow')] },
      { n: 10, cost: 220 * M, requires: [req('trak-r', 'Default'), req('groundmech', 'Default'), req('senate-hovercam', 'Rainbow')] },
      { n: 11, cost: 550 * M, requires: [req('b2-heavy', 'Default'), req('b2-super', 'Default'), req('util-tec', 'Default')] },
      { n: 12, cost: 1.36 * B, requires: [req('trak-r', 'Gold'), req('groundmech', 'Gold'), req('bal-core', 'Rainbow')] },
      { n: 13, cost: 3.4 * B, requires: [req('b2-super', 'Rainbow'), req('mecha-droid', 'Default'), req('proto-roller', 'Default')] },
      { n: 14, cost: 8.45 * B, requires: [req('b2-heavy', 'Rainbow'), req('b2-rp', 'Default'), req('r7', 'Gold')] },
      { n: 15, cost: 21 * B, requires: [req('strike-orb', 'Rainbow'), req('bb9', 'Gold'), req('proto-roller', 'Gold')] },
      { n: 16, cost: 52 * B, requires: [req('amp-walker', 'Rainbow'), req('b2-rp', 'Diamond'), req('mecha-droid', 'Gold')] },
      { n: 17, cost: 130 * B, requires: [req('opti-pod', 'Rainbow'), req('r7', 'Diamond'), req('mono-wlkr', 'Gold')] },
      { n: 18, cost: 325 * B, requires: [req('util-tec', 'Rainbow'), req('bb9', 'Diamond'), req('proto-roller', 'Diamond')] },
      { n: 19, cost: 810 * B, requires: [req('mecha-droid', 'Diamond'), req('r7', 'Rainbow'), req('b2-rp', 'Rainbow')] },
      { n: 20, cost: 2 * T, requires: [req('mono-wlkr', 'Rainbow'), req('opti-strk', 'Rainbow'), req('cyclo-grav', 'Rainbow')] },
      { n: 21, cost: 3 * T, requires: [req('b2-super', 'Beskar'), req('opti-pod', 'Beskar'), req('r2', 'Beskar')] },
      { n: 22, cost: 4.5 * T, requires: [req('gunrunner', 'Beskar'), req('lng-shot', 'Beskar'), req('b2-rp', 'Beskar')] },
      { n: 23, cost: 6 * T, requires: [req('mono-wlkr', 'Beskar'), req('mecha-droid', 'Beskar'), req('cyclo-grav', 'Beskar')] },
      { n: 24, cost: 9 * T, requires: [req('ric', 'Default'), req('bb9', 'Beskar'), req('b2-rp', 'Beskar')] },
      { n: 25, cost: 13.5 * T, requires: [req('loadlifter', 'Default'), req('mo-trak', 'Gold'), req('proto-roller', 'Beskar')] },
      { n: 26, cost: 21 * T, requires: [req('lep', 'Gold'), req('tri-tek', 'Diamond'), req('snow-mouse', 'Rainbow')] },
      { n: 27, cost: 32 * T, requires: [req('ric-1200', 'Diamond'), req('ig', 'Rainbow'), req('drft-r', 'Beskar')] },
      { n: 28, cost: 45 * T, requires: [req('ric', 'Rainbow'), req('mo-trak', 'Beskar'), req('bb9', 'Galactic')] },
      { n: 29, cost: 68 * T, requires: [req('ig', 'Beskar'), req('mecha-droid', 'Galactic'), req('opti-strk', 'Galactic')] },
      { n: 30, cost: 100 * T, requires: [req('lep', 'Beskar'), req('r7', 'Galactic'), req('drft-r', 'Galactic')] },
      { n: 31, cost: 150 * T, requires: [req('mecha-droid', 'Beskar'), req('ric-1200', 'Beskar'), req('b2-heavy', 'Stellar')] },
      { n: 32, cost: 230 * T, requires: [req('mo-trak', 'Beskar'), req('bb', 'Galactic'), req('groundmech', 'Galactic')] },
      { n: 33, cost: 345 * T, requires: [req('mono-wlkr', 'Galactic'), req('loadlifter', 'Galactic'), req('trak-r', 'Stellar')] },
      { n: 34, cost: 520 * T, requires: [req('lep', 'Galactic'), req('b2-super', 'Stellar'), req('orb-walker', 'Stellar')] },
      { n: 35, cost: 778 * T, requires: [req('kx', 'Stellar'), req('ric', 'Stellar'), req('proto-roller', 'Stellar')] }
    ]
  },
  {
    path: 4,
    name: 'Cycle 4',
    steps: [
      { n: 1, cost: 10 * K, requires: [req('id10', 'Default'), req('pit', 'Default'), req('drk1-probe', 'Default')] },
      { n: 2, cost: 150 * K, requires: [req('r3', 'Default'), req('2bb', 'Default'), req('senate-hovercam', 'Default')] },
      { n: 3, cost: 975 * K, requires: [req('r4', 'Default'), req('r5', 'Gold'), req('r8', 'Gold')] },
      { n: 4, cost: 2.95 * M, requires: [req('r9', 'Gold'), req('b1-battle', 'Gold'), req('b1-security', 'Gold')] },
      { n: 5, cost: 5.35 * M, requires: [req('2bb', 'Gold'), req('r3', 'Gold'), req('senate-hovercam', 'Gold')] },
      { n: 6, cost: 9.85 * M, requires: [req('bdx-explorer', 'Diamond'), req('r4', 'Diamond'), req('r5', 'Diamond')] },
      { n: 7, cost: 14.5 * M, requires: [req('r8', 'Diamond'), req('r9', 'Diamond'), req('b1-battle', 'Diamond')] },
      { n: 8, cost: 36 * M, requires: [req('b1-security', 'Rainbow'), req('r3', 'Rainbow'), req('2bb', 'Rainbow')] },
      { n: 9, cost: 89 * M, requires: [req('bdx-explorer', 'Rainbow'), req('r4', 'Rainbow'), req('r5', 'Rainbow')] },
      { n: 10, cost: 220 * M, requires: [req('groundmech', 'Default'), req('trak-r', 'Default'), req('senate-hovercam', 'Rainbow')] },
      { n: 11, cost: 550 * M, requires: [req('b2-heavy', 'Default'), req('b2-super', 'Default'), req('util-tec', 'Default')] },
      { n: 12, cost: 1.36 * B, requires: [req('groundmech', 'Gold'), req('trak-r', 'Gold'), req('bal-core', 'Rainbow')] },
      { n: 13, cost: 3.4 * B, requires: [req('b2-super', 'Rainbow'), req('mecha-droid', 'Default'), req('proto-roller', 'Default')] },
      { n: 14, cost: 8.45 * B, requires: [req('bal-core', 'Diamond'), req('groundmech', 'Diamond'), req('trak-r', 'Rainbow')] },
      { n: 15, cost: 21 * B, requires: [req('b2-rp', 'Default'), req('b2-heavy', 'Diamond'), req('b2-super', 'Rainbow')] },
      { n: 16, cost: 52 * B, requires: [req('bb9', 'Default'), req('r7', 'Gold'), req('util-tec', 'Rainbow')] },
      { n: 17, cost: 130 * B, requires: [req('opti-strk', 'Default'), req('cyclo-grav', 'Gold'), req('mecha-droid', 'Gold')] },
      { n: 18, cost: 325 * B, requires: [req('b2-rp', 'Gold'), req('bb9', 'Gold'), req('r7', 'Diamond')] },
      { n: 19, cost: 810 * B, requires: [req('mecha-droid', 'Diamond'), req('r7', 'Rainbow'), req('b2-rp', 'Rainbow')] },
      { n: 20, cost: 2 * T, requires: [req('mono-wlkr', 'Rainbow'), req('opti-strk', 'Rainbow'), req('cyclo-grav', 'Rainbow')] },
      { n: 21, cost: 3 * T, requires: [req('amp-walker', 'Beskar'), req('groundmech', 'Beskar'), req('haul-r', 'Beskar')] },
      { n: 22, cost: 4.5 * T, requires: [req('b2-super', 'Beskar'), req('strike-orb', 'Beskar'), req('gunrunner', 'Beskar')] },
      { n: 23, cost: 6 * T, requires: [req('mono-wlkr', 'Beskar'), req('cyclo-grav', 'Beskar'), req('b2-rp', 'Beskar')] },
      { n: 24, cost: 9 * T, requires: [req('mo-trak', 'Default'), req('proto-roller', 'Beskar'), req('mecha-droid', 'Beskar')] },
      { n: 25, cost: 13.5 * T, requires: [req('tri-tek', 'Default'), req('drft-r', 'Gold'), req('opti-strk', 'Beskar')] },
      { n: 26, cost: 21 * T, requires: [req('cyclens', 'Gold'), req('lep', 'Diamond'), req('mo-trak', 'Rainbow')] },
      { n: 27, cost: 32 * T, requires: [req('ric-1200', 'Diamond'), req('snow-mouse', 'Rainbow'), req('loadlifter', 'Beskar')] },
      { n: 28, cost: 45 * T, requires: [req('ig', 'Rainbow'), req('kx', 'Beskar'), req('opti-strk', 'Galactic')] },
      { n: 29, cost: 68 * T, requires: [req('tri-tek', 'Beskar'), req('r7', 'Galactic'), req('bb9', 'Galactic')] },
      { n: 30, cost: 100 * T, requires: [req('cyclens', 'Beskar'), req('mono-wlkr', 'Galactic'), req('ig', 'Galactic')] },
      { n: 31, cost: 150 * T, requires: [req('cyclo-grav', 'Beskar'), req('tri-tek', 'Beskar'), req('trak-r', 'Stellar')] },
      { n: 32, cost: 230 * T, requires: [req('ig', 'Beskar'), req('r6', 'Galactic'), req('r2', 'Galactic')] },
      { n: 33, cost: 345 * T, requires: [req('bb9', 'Galactic'), req('ric-1200', 'Galactic'), req('b2-heavy', 'Stellar')] },
      { n: 34, cost: 520 * T, requires: [req('mo-trak', 'Galactic'), req('strike-orb', 'Stellar'), req('amp-walker', 'Stellar')] },
      { n: 35, cost: 778 * T, requires: [req('b2-rp', 'Stellar'), req('loadlifter', 'Stellar'), req('lep', 'Stellar')] }
    ]
  },
  {
    path: 5,
    name: 'Cycle 5',
    steps: [
      { n: 1, cost: 10 * K, requires: [req('id10', 'Default'), req('mouse', 'Default'), req('gonk', 'Default')] },
      { n: 2, cost: 150 * K, requires: [req('2bb', 'Default'), req('roll-r', 'Default'), req('imp-probe', 'Gold')] },
      { n: 3, cost: 975 * K, requires: [req('r4', 'Default'), req('vect-arm', 'Default'), req('bdx-explorer', 'Gold')] },
      { n: 4, cost: 2.95 * M, requires: [req('r9', 'Gold'), req('b1-battle', 'Gold'), req('b1-security', 'Gold')] },
      { n: 5, cost: 5.35 * M, requires: [req('bal-core', 'Gold'), req('r4', 'Gold'), req('r3', 'Gold')] },
      { n: 6, cost: 9.85 * M, requires: [req('gunrunner', 'Default'), req('2bb', 'Diamond'), req('bdx-explorer', 'Diamond')] },
      { n: 7, cost: 14.5 * M, requires: [req('r2', 'Gold'), req('roll-r', 'Diamond'), req('r5', 'Diamond')] },
      { n: 8, cost: 36 * M, requires: [req('b2-super', 'Gold'), req('r8', 'Diamond'), req('b1-battle', 'Diamond')] },
      { n: 9, cost: 89 * M, requires: [req('strike-orb', 'Gold'), req('amp-walker', 'Gold'), req('nav-ex', 'Rainbow')] },
      { n: 10, cost: 220 * M, requires: [req('groundmech', 'Default'), req('trak-r', 'Default'), req('imp-probe', 'Beskar')] },
      { n: 11, cost: 550 * M, requires: [req('b2-heavy', 'Default'), req('b2-super', 'Default'), req('util-tec', 'Default')] },
      { n: 12, cost: 1.36 * B, requires: [req('groundmech', 'Gold'), req('trak-r', 'Gold'), req('bal-core', 'Rainbow')] },
      { n: 13, cost: 3.4 * B, requires: [req('b2-super', 'Gold'), req('b2-heavy', 'Gold'), req('r2', 'Diamond')] },
      { n: 14, cost: 8.45 * B, requires: [req('groundmech', 'Diamond'), req('trak-r', 'Diamond'), req('util-tec', 'Rainbow')] },
      { n: 15, cost: 21 * B, requires: [req('b2-rp', 'Default'), req('b2-heavy', 'Diamond'), req('b2-super', 'Diamond')] },
      { n: 16, cost: 52 * B, requires: [req('bb9', 'Default'), req('r7', 'Gold'), req('proto-roller', 'Gold')] },
      { n: 17, cost: 130 * B, requires: [req('opti-strk', 'Default'), req('cyclo-grav', 'Gold'), req('mecha-droid', 'Gold')] },
      { n: 18, cost: 325 * B, requires: [req('bb9', 'Gold'), req('b2-rp', 'Gold'), req('r7', 'Diamond')] },
      { n: 19, cost: 810 * B, requires: [req('opti-strk', 'Diamond'), req('cyclo-grav', 'Diamond'), req('mecha-droid', 'Rainbow')] },
      { n: 20, cost: 2 * T, requires: [req('b2-rp', 'Rainbow'), req('bb9', 'Rainbow'), req('r7', 'Rainbow')] },
      { n: 21, cost: 3 * T, requires: [req('l0', 'Beskar'), req('strike-orb', 'Beskar'), req('haul-r', 'Beskar')] },
      { n: 22, cost: 4.5 * T, requires: [req('sen-tri', 'Beskar'), req('r6', 'Beskar'), req('gunrunner', 'Beskar')] },
      { n: 23, cost: 6 * T, requires: [req('bb9', 'Beskar'), req('cyclo-grav', 'Beskar'), req('b2-rp', 'Beskar')] },
      { n: 24, cost: 9 * T, requires: [req('mo-trak', 'Default'), req('mono-wlkr', 'Beskar'), req('opti-strk', 'Beskar')] },
      { n: 25, cost: 13.5 * T, requires: [req('ric', 'Default'), req('tri-tek', 'Gold'), req('mecha-droid', 'Beskar')] },
      { n: 26, cost: 21 * T, requires: [req('cyclens', 'Gold'), req('lep', 'Diamond'), req('snow-mouse', 'Rainbow')] },
      { n: 27, cost: 32 * T, requires: [req('ric-1200', 'Diamond'), req('ig', 'Rainbow'), req('loadlifter', 'Beskar')] },
      { n: 28, cost: 45 * T, requires: [req('ric', 'Rainbow'), req('mo-trak', 'Beskar'), req('bb9', 'Galactic')] },
      { n: 29, cost: 68 * T, requires: [req('ig', 'Beskar'), req('mecha-droid', 'Galactic'), req('opti-strk', 'Galactic')] },
      { n: 30, cost: 100 * T, requires: [req('lep', 'Beskar'), req('r7', 'Galactic'), req('cyclens', 'Galactic')] },
      { n: 31, cost: 150 * T, requires: [req('opti-strk', 'Beskar'), req('snow-mouse', 'Beskar'), req('amp-walker', 'Stellar')] },
      { n: 32, cost: 230 * T, requires: [req('drft-r', 'Beskar'), req('l0', 'Galactic'), req('trak-r', 'Galactic')] },
      { n: 33, cost: 345 * T, requires: [req('r7', 'Galactic'), req('tri-tek', 'Galactic'), req('util-tec', 'Stellar')] },
      { n: 34, cost: 520 * T, requires: [req('ig', 'Galactic'), req('haul-r', 'Stellar'), req('lng-shot', 'Stellar')] },
      { n: 35, cost: 778 * T, requires: [req('mecha-droid', 'Stellar'), req('ric-1200', 'Stellar'), req('mo-trak', 'Stellar')] }
    ]
  }
]
