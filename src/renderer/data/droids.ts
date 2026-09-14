// Fixed 31-slot base layout. Droid definitions live in droidValues.ts.
export const BASE_SLOTS = {
  workers: {
    main: Array.from({ length: 8 }, (_, i) => ({ id: `w-main-${i}`, x: 50 + i * 110, y: 100, category: 'workers' as const })),
    small: Array.from({ length: 3 }, (_, i) => ({ id: `w-small-${i}`, x: 50 + i * 110, y: 230, category: 'workers' as const }))
  },
  astromechs: {
    main: Array.from({ length: 9 }, (_, i) => ({ id: `a-${i}`, x: 50 + (i % 3) * 110, y: 380 + Math.floor(i / 3) * 110, category: 'astromechs' as const }))
  },
  battle: {
    floor1: Array.from({ length: 5 }, (_, i) => ({ id: `b1-${i}`, x: 50 + i * 110, y: 730, category: 'battle' as const })),
    floor2: Array.from({ length: 6 }, (_, i) => ({ id: `b2-${i}`, x: 50 + i * 110, y: 860, category: 'battle' as const }))
  }
} as const

export interface BaseSlot {
  id: string
  x: number
  y: number
  category: string
}

export const ALL_SLOTS: BaseSlot[] = [
  ...BASE_SLOTS.workers.main.map(s => ({ ...s })),
  ...BASE_SLOTS.workers.small.map(s => ({ ...s })),
  ...BASE_SLOTS.astromechs.main.map(s => ({ ...s })),
  ...BASE_SLOTS.battle.floor1.map(s => ({ ...s })),
  ...BASE_SLOTS.battle.floor2.map(s => ({ ...s }))
]

export function getSlotsByCategory(category: BaseSlot['category']): BaseSlot[] {
  return ALL_SLOTS.filter(s => s.category === category)
}