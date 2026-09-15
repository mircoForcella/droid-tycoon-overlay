import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { ALL_SLOTS, BaseSlot } from './data/droids'
import { DroidDef, Quality, QUALITIES, getSellValue, getDroidDef, formatCredits } from './data/droidValues'
import { getIncome } from './data/income'

export interface PlacedDroid {
  slotId: string
  droidId: string
  quality: Quality
  auto?: boolean
  confidence?: number
}

export interface SlotSuggestion {
  slotId: string
  droidId: string
  confidence: number
}

export interface ScanInput {
  droidId: string
  confidence: number
  rx: number
  ry: number
}

interface AppState {
  activeTab: 'droids' | 'calculator' | 'timers' | 'settings' | 'rebirth'
  placedDroids: PlacedDroid[]
  hasC3PO: boolean
  clickThrough: boolean
  collapsed: boolean
  overlayDisplay: string
  setOverlayDisplayPref: (v: string) => void
  panelSize: 'S' | 'M' | 'L'
  setPanelSize: (v: 'S' | 'M' | 'L') => void
  panelW: number | null
  setPanelW: (v: number | null) => void
  panelH: number | null
  setPanelH: (v: number | null) => void
  liveScan: boolean
  scanIntervalMs: number
  lastScanAt: number
  lastMatchCount: number
  suggestions: SlotSuggestion[]
  spots: Array<{ text: string; value: number; rx: number; ry: number }>
  setSpots: (spots: AppState['spots']) => void
  // Post-spot match popup (F9 result): confirm card, pick station + slot.
  spotMatchOpen: boolean
  setSpotMatchOpen: (v: boolean) => void
  // Step 2 payload: droid confirmed in step 1, awaiting station + slot.
  spotPlace: { droidId: string; quality: Quality } | null
  setSpotPlace: (v: { droidId: string; quality: Quality } | null) => void
  toast: { msg: string; at: number } | null
  showToast: (msg: string) => void
  rebirthProgress: Record<string, number>
  setRebirthProgress: (path: number, n: number) => void
  timersDetached: boolean
  setTimersDetached: (v: boolean) => void
  applyTimersDetached: (v: boolean) => void
  timerBgOpacity: number
  setTimerBgOpacity: (v: number) => void
  applyTimerBgOpacity: (v: number) => void
  pickerSlot: string | null
  pickerCategory: string
  openPicker: (slotId: string, category: string) => void
  closePicker: () => void
  autoAccept: boolean
  setAutoAccept: (v: boolean) => void
  setActiveTab: (tab: AppState['activeTab']) => void
  placeDroid: (slotId: string, droidId: string, quality?: Quality) => void
  removeDroid: (slotId: string) => void
  clearAll: () => void
  toggleC3PO: () => void
  setClickThrough: (value: boolean) => void
  toggleCollapsed: () => void
  setCollapsed: (v: boolean) => void
  setLiveScan: (v: boolean) => void
  setScanIntervalMs: (ms: number) => void
  // Stage scan matches as reviewable suggestions (never auto-overwrites manual slots)
  stageDetections: (matches: ScanInput[]) => void
  acceptSuggestion: (index: number, quality?: Quality) => void
  acceptAllSuggestions: () => void
  clearSuggestions: () => void
  getPlaced: (slotId: string) => (PlacedDroid & { def: DroidDef; sell: number }) | null
  getTotalSellValue: () => number
  getTotalIncome: () => number
  getDroidsByCategory: (category: BaseSlot['category']) => (PlacedDroid & { def: DroidDef; sell: number })[]
  history: PlacedDroid[][]
  undo: () => void
  exportData: () => string
  importData: (json: string) => boolean
}

// Normalized design-space bounds for mapping scan coords to slots
function slotBounds() {
  const xs = ALL_SLOTS.map(s => s.x)
  const ys = ALL_SLOTS.map(s => s.y)
  return {
    minX: Math.min(...xs), maxX: Math.max(...xs),
    minY: Math.min(...ys), maxY: Math.max(...ys)
  }
}

export const useStore = create<AppState>()(
  persist(
    (set, get) => ({
      activeTab: 'droids',
      placedDroids: [],
      hasC3PO: false,
      clickThrough: true,
      collapsed: false,
      overlayDisplay: 'all',
      setOverlayDisplayPref: (v) => {
        set({ overlayDisplay: v })
        window.electronAPI?.setOverlayDisplay(v === 'all' ? 'all' : Number(v))
      },
      panelSize: 'M',
      setPanelSize: (v) => set({ panelSize: v }),
      // Manual drag-resize overrides (null = follow the S/M/L preset).
      panelW: null,
      setPanelW: (v) => set({ panelW: v === null ? null : Math.max(260, Math.min(640, Math.round(v))) }),
      panelH: null,
      setPanelH: (v) => set({ panelH: v === null ? null : Math.max(280, Math.round(v)) }),
      liveScan: false,
      scanIntervalMs: 5000,
      lastScanAt: 0,
      lastMatchCount: 0,
      suggestions: [],
      spots: [],

      setSpots: (spots) => set({ spots }),

      spotMatchOpen: false,

      setSpotMatchOpen: (v) => set({ spotMatchOpen: v }),

      spotPlace: null,

      setSpotPlace: (v) => set({ spotPlace: v }),

      rebirthProgress: {},

      setRebirthProgress: (path, n) => set((state) => ({
        rebirthProgress: { ...state.rebirthProgress, [path]: Math.max(1, Math.min(35, n)) }
      })),

      timersDetached: true,

      setTimersDetached: (v) => {
        set({ timersDetached: v })
        window.electronAPI?.setTimersDetached(v)
      },

      // Applied from main-process broadcast (other window changed it).
      applyTimersDetached: (v) => set({ timersDetached: v }),

      timerBgOpacity: 40,

      setTimerBgOpacity: (v) => {
        const clamped = Math.max(0, Math.min(100, Math.round(v)))
        set({ timerBgOpacity: clamped })
        window.electronAPI?.setTimerOpacity(clamped)
      },

      applyTimerBgOpacity: (v) => set({ timerBgOpacity: v }),

      pickerSlot: null,
      pickerCategory: 'workers',
      openPicker: (slotId, category) => set({ pickerSlot: slotId, pickerCategory: category }),
      closePicker: () => set({ pickerSlot: null }),

      autoAccept: false,
      setAutoAccept: (v) => set({ autoAccept: v }),

      toast: null,

      showToast: (msg) => {
        const at = Date.now()
        set({ toast: { msg, at } })
        setTimeout(() => {
          const t = get().toast
          if (t && t.at === at) set({ toast: null })
        }, 6000)
      },

      setActiveTab: (tab) => set({ activeTab: tab }),

      placeDroid: (slotId, droidId, quality = 'Default') => set((state) => ({
        history: [...state.history.slice(-19), state.placedDroids],
        placedDroids: [
          ...state.placedDroids.filter(d => d.slotId !== slotId),
          { slotId, droidId, quality, auto: false }
        ],
        suggestions: state.suggestions.filter(s => s.slotId !== slotId),
        pickerSlot: null
      })),

      removeDroid: (slotId) => set((state) => ({
        history: [...state.history.slice(-19), state.placedDroids],
        placedDroids: state.placedDroids.filter(d => d.slotId !== slotId)
      })),

      clearAll: () => set((state) => ({
        history: [...state.history.slice(-19), state.placedDroids],
        placedDroids: [],
        hasC3PO: false
      })),

      toggleC3PO: () => set((state) => ({ hasC3PO: !state.hasC3PO })),

      setClickThrough: (value) => set({ clickThrough: value }),

      toggleCollapsed: () => set((state) => ({ collapsed: !state.collapsed })),

      setCollapsed: (v) => set({ collapsed: v }),

      setLiveScan: (v) => set({ liveScan: v }),

      setScanIntervalMs: (ms) => set({ scanIntervalMs: ms }),

      stageDetections: (matches) => set((state) => {
        const { minX, maxX, minY, maxY } = slotBounds()
        const norm = (s: BaseSlot) => ({
          id: s.id,
          nx: (s.x - minX) / Math.max(1, maxX - minX),
          ny: (s.y - minY) / Math.max(1, maxY - minY)
        })
        const slots = ALL_SLOTS.map(norm)
        const taken = new Set(state.placedDroids.filter(p => !p.auto).map(p => p.slotId))
        const suggestions: SlotSuggestion[] = []
        const autoPlaced: PlacedDroid[] = []
        const usedSlots = new Set<string>()
        for (const m of [...matches].sort((a, b) => b.confidence - a.confidence)) {
          if (!getDroidDef(m.droidId)) continue
          let best: { id: string; dist: number } | null = null
          for (const s of slots) {
            if (taken.has(s.id) || usedSlots.has(s.id)) continue
            const dist = Math.hypot(s.nx - m.rx, s.ny - m.ry)
            if (!best || dist < best.dist) best = { id: s.id, dist }
          }
          // Distance gate: ignore matches that land far from any free station
          if (best && best.dist < 0.3) {
            usedSlots.add(best.id)
            // Zero-touch: high-confidence matches place themselves when enabled.
            // Manual placements are never overwritten (see `taken` above).
            if (state.autoAccept && m.confidence >= 0.9) {
              autoPlaced.push({ slotId: best.id, droidId: m.droidId, quality: 'Default', auto: true, confidence: m.confidence })
            } else {
              suggestions.push({ slotId: best.id, droidId: m.droidId, confidence: m.confidence })
            }
          }
          if (suggestions.length + autoPlaced.length >= 31) break
        }
        const placedIds = new Set(autoPlaced.map(a => a.slotId))
        return {
          suggestions,
          placedDroids: [...state.placedDroids.filter(d => !placedIds.has(d.slotId)), ...autoPlaced],
          lastScanAt: Date.now(),
          lastMatchCount: matches.length
        }
      }),

      acceptSuggestion: (index, quality = 'Default') => set((state) => {
        const s = state.suggestions[index]
        if (!s) return state
        return {
          history: [...state.history.slice(-19), state.placedDroids],
          placedDroids: [
            ...state.placedDroids.filter(d => d.slotId !== s.slotId),
            { slotId: s.slotId, droidId: s.droidId, quality, auto: true, confidence: s.confidence }
          ],
          suggestions: state.suggestions.filter((_, i) => i !== index)
        }
      }),

      acceptAllSuggestions: () => set((state) => {
        const auto = state.suggestions.map(s => ({
          slotId: s.slotId, droidId: s.droidId, quality: 'Default' as Quality,
          auto: true, confidence: s.confidence
        }))
        const ids = new Set(auto.map(a => a.slotId))
        return {
          history: [...state.history.slice(-19), state.placedDroids],
          placedDroids: [...state.placedDroids.filter(d => !ids.has(d.slotId)), ...auto],
          suggestions: []
        }
      }),

      clearSuggestions: () => set({ suggestions: [] }),

      getPlaced: (slotId) => {
        const placed = get().placedDroids.find(p => p.slotId === slotId)
        if (!placed) return null
        const def = getDroidDef(placed.droidId)
        if (!def) return null
        return { ...placed, def, sell: getSellValue(def, placed.quality) }
      },

      getTotalSellValue: () => {
        const { placedDroids, hasC3PO } = get()
        const total = placedDroids.reduce((sum, p) => {
          const def = getDroidDef(p.droidId)
          return sum + (def ? getSellValue(def, p.quality) : 0)
        }, 0)
        return hasC3PO ? total * 2 : total
      },

      getTotalIncome: () => {
        const { placedDroids } = get()
        return placedDroids.reduce((sum, p) => {
          const def = getDroidDef(p.droidId)
          return sum + (def ? getIncome(def, p.quality) : 0)
        }, 0)
      },

      getDroidsByCategory: (category) => {
        const { placedDroids } = get()
        const categorySlots = ALL_SLOTS.filter(s => s.category === category).map(s => s.id)
        return placedDroids
          .filter(p => categorySlots.includes(p.slotId))
          .map(p => {
            const def = getDroidDef(p.droidId)
            return def ? { ...p, def, sell: getSellValue(def, p.quality) } : null
          })
          .filter((x): x is PlacedDroid & { def: DroidDef; sell: number } => !!x)
      },

      history: [],

      undo: () => {
        const h = get().history
        if (h.length === 0) return
        set({ placedDroids: h[h.length - 1], history: h.slice(0, -1), suggestions: [] })
        get().showToast('↩ Placement undone')
      },

      exportData: () => JSON.stringify({
        app: 'droid-tycoon-overlay',
        version: 1,
        placedDroids: get().placedDroids,
        rebirthProgress: get().rebirthProgress,
        hasC3PO: get().hasC3PO
      }, null, 2),

      importData: (json) => {
        try {
          const data = JSON.parse(json) as {
            placedDroids?: unknown; rebirthProgress?: unknown; hasC3PO?: unknown
          }
          if (!data || !Array.isArray(data.placedDroids)) return false
          const validQ = new Set<string>(QUALITIES as readonly string[])
          const placed: PlacedDroid[] = []
          for (const p of data.placedDroids) {
            const c = p as Partial<PlacedDroid>
            if (!c || typeof c.slotId !== 'string' || typeof c.droidId !== 'string') continue
            if (!getDroidDef(c.droidId)) continue
            if (!ALL_SLOTS.some(s => s.id === c.slotId)) continue
            if (!validQ.has(c.quality ?? '')) continue
            placed.push({ slotId: c.slotId, droidId: c.droidId, quality: c.quality as Quality, auto: false })
          }
          set((state) => ({
            history: [...state.history.slice(-19), state.placedDroids],
            placedDroids: placed,
            rebirthProgress: (data.rebirthProgress && typeof data.rebirthProgress === 'object' ? data.rebirthProgress : {}) as Record<string, number>,
            hasC3PO: !!data.hasC3PO,
            suggestions: []
          }))
          return true
        } catch {
          return false
        }
      }
    }),
    {
      name: 'droid-tycoon-overlay',
      // Persist only user data + prefs; never transient scan state.
      partialize: (s) => ({
        activeTab: s.activeTab === 'timers' && s.timersDetached ? 'droids' : s.activeTab,
        placedDroids: s.placedDroids,
        hasC3PO: s.hasC3PO,
        clickThrough: s.clickThrough,
        collapsed: s.collapsed,
        overlayDisplay: s.overlayDisplay,
        panelSize: s.panelSize,
        panelW: s.panelW,
        panelH: s.panelH,
        scanIntervalMs: s.scanIntervalMs,
        rebirthProgress: s.rebirthProgress,
        timersDetached: s.timersDetached,
        timerBgOpacity: s.timerBgOpacity
      })
    }
  )
)

export { formatCredits }
