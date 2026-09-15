import { contextBridge, ipcRenderer } from 'electron'

export interface DetectionPayload {
  at: number
  matches: Array<{ droidId: string; confidence: number; rx: number; ry: number }>
}

type Unsub = () => void
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Handler = (...args: any[]) => void

function sub(channel: string, handler: Handler): Unsub {
  ipcRenderer.on(channel, handler)
  return () => ipcRenderer.removeListener(channel, handler)
}

contextBridge.exposeInMainWorld('electronAPI', {
  onClickThroughChanged: (callback: (value: boolean) => void): Unsub => {
    return sub('click-through-changed', (_, value: boolean) => callback(value))
  },
  setClickThrough: (value: boolean) => ipcRenderer.send('set-click-through', value),
  setVisible: (value: boolean) => ipcRenderer.send('set-visible', value),
  onOpenTab: (callback: (tab: string) => void): Unsub => {
    return sub('open-tab', (_, tab: string) => callback(tab))
  },
  onToggleCollapse: (callback: () => void): Unsub => {
    return sub('toggle-collapse', () => callback())
  },
  toggleTypeMode: () => ipcRenderer.send('toggle-type-mode'),
  onFocusInput: (callback: () => void): Unsub => {
    return sub('focus-input', () => callback())
  },
  getDisplays: () => ipcRenderer.invoke('get-displays'),
  setOverlayDisplay: (value: 'all' | number) => ipcRenderer.send('set-overlay-display', value),
  setTimersDetached: (detached: boolean) => ipcRenderer.send('set-timers-detached', detached),
  onTimersDetachedChanged: (callback: (detached: boolean) => void): Unsub => {
    return sub('timers-detached-changed', (_, detached: boolean) => callback(detached))
  },
  setTimerOpacity: (value: number) => ipcRenderer.send('set-timer-opacity', value),
  onTimerOpacityChanged: (callback: (value: number) => void): Unsub => {
    return sub('timer-opacity-changed', (_, value: number) => callback(value))
  },
  captureGameWindow: () => ipcRenderer.invoke('capture-game-window'),
  detectDroids: (region: { x: number; y: number; width: number; height: number }) => ipcRenderer.invoke('detect-droids', region),
  getDroidTemplates: () => ipcRenderer.invoke('get-droid-templates'),
  saveDroidTemplate: (name: string, data: string) => ipcRenderer.invoke('save-droid-template', name, data),
  setLiveScan: (enabled: boolean, intervalMs: number) => ipcRenderer.send('set-live-scan', enabled, intervalMs),
  scanOnce: () => ipcRenderer.send('scan-once'),
  spotIncomes: () => ipcRenderer.invoke('ocr-spot-income'),
  onDetectionUpdate: (callback: (payload: DetectionPayload) => void): Unsub => {
    return sub('detection-update', (_, payload: DetectionPayload) => callback(payload))
  },
  onLiveScanChanged: (callback: (enabled: boolean) => void): Unsub => {
    return sub('live-scan-changed', (_, enabled: boolean) => callback(enabled))
  },
  onIncomeSpots: (callback: (spots: Array<{ text: string; value: number; rx: number; ry: number }>) => void): Unsub => {
    return sub('income-spots', (_, spots: Array<{ text: string; value: number; rx: number; ry: number }>) => callback(spots))
  },
  openSpotWindow: (spots: Array<{ text: string; value: number; rx: number; ry: number }>) => ipcRenderer.invoke('open-spot-window', spots),
  getSpotData: () => ipcRenderer.invoke('get-spot-data'),
  onSpotData: (callback: (spots: Array<{ text: string; value: number; rx: number; ry: number }>) => void): Unsub => {
    return sub('spot-data', (_, spots: Array<{ text: string; value: number; rx: number; ry: number }>) => callback(spots))
  },
  spotPlace: (payload: { droidId: string; quality: string; station: string }) => ipcRenderer.invoke('spot-place', payload),
  spotClose: () => ipcRenderer.send('spot-close'),
  onSpotPlaceRequest: (callback: (req: { droidId: string; quality: string; station: string; reqId: number }) => void): Unsub => {
    return sub('spot-place-request', (_, req: { droidId: string; quality: string; station: string; reqId: number }) => callback(req))
  },
  reportSpotPlaceDone: (res: { reqId: number; ok: boolean; message: string }) => ipcRenderer.send('spot-place-done', res),
  onSpotStatus: (callback: (status: string) => void): Unsub => {
    return sub('spot-status', (_, status: string) => callback(status))
  },
  getVersion: () => ipcRenderer.invoke('get-version'),
  checkForUpdates: () => ipcRenderer.invoke('check-for-updates'),
  quitAndInstall: () => ipcRenderer.send('quit-and-install'),
  onUpdateStatus: (callback: (status: { state: string; version?: string; percent?: number; message?: string }) => void): Unsub => {
    return sub('update-status', (_, status: { state: string; version?: string; percent?: number; message?: string }) => callback(status))
  }
})
