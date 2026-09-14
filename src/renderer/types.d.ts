export {}

declare global {
  interface Window {
    electronAPI?: {
      onClickThroughChanged: (cb: (v: boolean) => void) => () => void
      setClickThrough: (v: boolean) => void
      setVisible: (v: boolean) => void
      onOpenTab: (cb: (tab: string) => void) => () => void
      onToggleCollapse: (cb: () => void) => () => void
      toggleTypeMode: () => void
      onFocusInput: (cb: () => void) => () => void
      getDisplays: () => Promise<Array<{ id: number; label: string; primary: boolean }>> | undefined
      setOverlayDisplay: (value: 'all' | number) => void
      setTimersDetached: (detached: boolean) => void
      onTimersDetachedChanged: (cb: (detached: boolean) => void) => () => void
      setTimerOpacity: (value: number) => void
      onTimerOpacityChanged: (cb: (value: number) => void) => () => void
      captureGameWindow: () => Promise<string | null>
      detectDroids: (region: { x: number; y: number; width: number; height: number }) => Promise<Array<{ droidId: string; slotId: string; confidence: number; x: number; y: number }>>
      getDroidTemplates: () => Promise<Array<{ id: string; name: string; category: string }>>
      saveDroidTemplate: (name: string, data: string) => Promise<boolean>
      setLiveScan: (enabled: boolean, intervalMs: number) => void
      scanOnce: () => void
      spotIncomes: () => Promise<{ spots: Array<{ text: string; value: number; rx: number; ry: number }>; meta: { frameW: number; frameH: number; lines: number; sample: string } }> | undefined
      onDetectionUpdate: (cb: (p: { at: number; matches: Array<{ droidId: string; confidence: number; rx: number; ry: number }> }) => void) => () => void
      onLiveScanChanged: (cb: (enabled: boolean) => void) => () => void
      onIncomeSpots: (cb: (spots: Array<{ text: string; value: number; rx: number; ry: number }>) => void) => () => void
      onSpotStatus: (cb: (status: string) => void) => () => void
      getVersion: () => Promise<string>
      checkForUpdates: () => Promise<void>
      quitAndInstall: () => void
      onUpdateStatus: (cb: (s: { state: string; version?: string; percent?: number; message?: string }) => void) => () => void
    }
  }
}
