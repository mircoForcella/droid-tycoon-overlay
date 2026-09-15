import { desktopCapturer, nativeImage, screen } from 'electron'

export interface TemplateMatch {
  droidId: string
  slotId: string
  confidence: number
  x: number
  y: number
}

export interface DroidTemplate {
  id: string
  name: string
  category: string
  bitmap: Buffer
  width: number
  height: number
}

const templates = new Map<string, DroidTemplate>()

export async function loadTemplates(templateDir: string): Promise<void> {
  const fs = await import('fs/promises')
  const path = await import('path')

  try {
    const files = await fs.readdir(templateDir)
    for (const file of files) {
      if (!file.match(/\.(png|jpg|jpeg)$/i)) continue
      const filePath = path.join(templateDir, file)
      const buffer = await fs.readFile(filePath)
      const img = nativeImage.createFromBuffer(buffer)
      if (img.isEmpty()) continue
      const size = img.getSize()
      const bitmap = img.toBitmap()
      const id = file.replace(/\.[^.]+$/, '')
      templates.set(id, { id, name: id, category: 'unknown', bitmap, width: size.width, height: size.height })
    }
    console.log(`[capture] loaded ${templates.size} templates from ${templateDir}`)
  } catch (e) {
    console.log('[capture] template dir not found:', templateDir)
  }
}

export async function captureGameWindow(windowTitle = 'Fortnite'): Promise<Buffer | null> {
  const frame = await captureGameFrame(1920, 1080, windowTitle)
  return frame ? frame.toPNG() : null
}

// Captures a native-res region at screen center for fast OCR.
// This game has no mouse cursor (crosshair instead): aiming at a droid
// shows its income popup next to the crosshair, i.e. near screen center.
// A ~900x600 center crop replaces a full-frame read (10-50x fewer pixels).
export interface DisplayCrop {
  png: Buffer
  displayId: number
  frameW: number
  frameH: number
  originX: number // crop origin in display coords
  originY: number
  scale: number // thumbnail px per display px
  primary: boolean // Windows primary display (where the game usually is)
  brightness: number // mean crop brightness, brightest-first tiebreak
}

// Center-crop EVERY screen. Sources are matched to displays by display_id —
// pairing by list index is WRONG (source order is not guaranteed to match
// display enumeration; that exact bug shipped a black frame once and reads
// the wrong monitor for F9). Primary display sorts first; brightness only
// breaks ties. Callers try crops in order until one yields spots.
export async function captureAllCenterCrops(
  cropW = 900,
  cropH = 600
): Promise<DisplayCrop[]> {
  const displays = screen.getAllDisplays()
  if (displays.length === 0) return []
  const primaryId = screen.getPrimaryDisplay()?.id
  const byId = new Map(displays.map(d => [d.id, d]))
  const maxW = Math.max(...displays.map(d => d.bounds.width))
  const maxH = Math.max(...displays.map(d => d.bounds.height))
  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: { width: maxW, height: maxH }
  })
  if (sources.length === 0) return []

  const crops: DisplayCrop[] = []
  for (const src of sources) {
    if (src.thumbnail.isEmpty()) continue
    const disp = byId.get(Number(src.display_id))
    if (!disp) {
      console.log(`[capture] screen source "${src.name}" has display_id=${src.display_id} matching no display — skipped`)
      continue
    }
    const thumb = src.thumbnail
    const size = thumb.getSize()
    const scale = size.width / disp.bounds.width
    const x = Math.max(0, Math.round((size.width - cropW * scale) / 2))
    const y = Math.max(0, Math.round((size.height - cropH * scale) / 2))
    const w = Math.max(1, Math.min(Math.round(cropW * scale), size.width - x))
    const h = Math.max(1, Math.min(Math.round(cropH * scale), size.height - y))
    const cropped = thumb.crop({ x, y, width: w, height: h })
    if (cropped.isEmpty()) continue
    const bmp = cropped.toBitmap()
    let sum = 0
    let count = 0
    for (let p = 0; p < bmp.length; p += 4 * 311) {
      sum += (bmp[p] + bmp[p + 1] + bmp[p + 2]) / 3
      count++
    }
    crops.push({
      png: cropped.toPNG(),
      displayId: disp.id,
      frameW: disp.bounds.width,
      frameH: disp.bounds.height,
      originX: disp.bounds.x + x / scale,
      originY: disp.bounds.y + y / scale,
      scale,
      primary: disp.id === primaryId,
      brightness: count > 0 ? sum / count : 0
    })
  }
  return crops.sort((a, b) => Number(b.primary) - Number(a.primary) || b.brightness - a.brightness)
}

// Blank-frame guard: some captures (minimized/occluded/exclusive-fullscreen
// windows) come back all-black. Sample pixels; avg brightness < 8 = blank.
function isBlank(img: Electron.NativeImage): boolean {
  if (img.isEmpty()) return true
  const size = img.getSize()
  if (size.width === 0 || size.height === 0) return true
  const bmp = img.toBitmap()
  let sum = 0
  let n = 0
  for (let i = 0; i < bmp.length; i += 4 * 977) {
    sum += bmp[i] + bmp[i + 1] + bmp[i + 2]
    n++
  }
  return n > 0 && sum / n / 3 < 8
}

// Frame priority: 1) the Fortnite window wherever it is,
// 2) the primary screen. Skips our own overlay windows.
export async function captureGameFrame(
  thumbW: number, thumbH: number, windowTitle = 'Fortnite'
): Promise<Electron.NativeImage | null> {
  const wins = await desktopCapturer.getSources({
    types: ['window'],
    thumbnailSize: { width: thumbW, height: thumbH }
  })
  const game = wins.find(s => s.name.includes(windowTitle) && !s.name.includes('Droid'))
  if (game && !isBlank(game.thumbnail)) return game.thumbnail

  const screens = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: { width: thumbW, height: thumbH }
  })
  const primary = screens[0]
  if (primary && !isBlank(primary.thumbnail)) return primary.thumbnail
  return null
}

function matchTemplate(
  src: Buffer, srcW: number, srcH: number,
  tpl: DroidTemplate, threshold = 0.75, step = 6
): TemplateMatch[] {
  const matches: TemplateMatch[] = []
  const tW = tpl.width
  const tH = tpl.height
  if (tW > srcW || tH > srcH || tW < 8 || tH < 8) return matches

  const sample = 2
  // Count comparable pixels once (alpha > 128)
  let total = 0
  for (let ty = 0; ty < tH; ty += sample) {
    for (let tx = 0; tx < tW; tx += sample) {
      if (tpl.bitmap[(ty * tW + tx) * 4 + 3] > 128) total++
    }
  }
  if (total === 0) return matches
  const need = threshold * total

  for (let y = 0; y <= srcH - tH; y += step) {
    for (let x = 0; x <= srcW - tW; x += step) {
      let score = 0
      let done = 0
      let abort = false
      for (let ty = 0; ty < tH && !abort; ty += sample) {
        for (let tx = 0; tx < tW; tx += sample) {
          const tIdx = (ty * tW + tx) * 4
          if (tpl.bitmap[tIdx + 3] <= 128) continue
          const sIdx = ((y + ty) * srcW + (x + tx)) * 4
          const dr = src[sIdx] - tpl.bitmap[tIdx]
          const dg = src[sIdx + 1] - tpl.bitmap[tIdx + 1]
          const db = src[sIdx + 2] - tpl.bitmap[tIdx + 2]
          // fast approx: normalized manhattan instead of sqrt
          const diff = (Math.abs(dr) + Math.abs(dg) + Math.abs(db)) / 765
          score += 1 - diff
          done++
          // Early abort: even perfect remaining pixels can't reach threshold
          if (score + (total - done) < need) { abort = true; break }
        }
      }
      if (!abort && score >= need) {
        matches.push({ droidId: tpl.id, slotId: '', confidence: score / total, x, y })
      }
    }
  }
  return matches.sort((a, b) => b.confidence - a.confidence).slice(0, 20)
}

export interface ScanMatch {
  droidId: string
  confidence: number
  rx: number // 0..1 relative position in frame
  ry: number
}

// Full-frame snapshot scan at near-native resolution so user-cropped
// templates match 1:1. Runs in the main process (never blocks the UI),
// one scan at a time, only while the user toggles Live Scan on.
export async function scanBase(): Promise<ScanMatch[]> {
  const thumb = await captureGameFrame(1920, 1080)
  if (!thumb) return []

  const size = thumb.getSize()
  const bitmap = thumb.toBitmap()
  const out: ScanMatch[] = []
  for (const tpl of templates.values()) {
    for (const m of matchTemplate(bitmap, size.width, size.height, tpl, 0.75, 8)) {
      out.push({
        droidId: tpl.id,
        confidence: m.confidence,
        rx: (m.x + tpl.width / 2) / size.width,
        ry: (m.y + tpl.height / 2) / size.height
      })
    }
  }
  return out.sort((a, b) => b.confidence - a.confidence).slice(0, 100)
}

export async function detectDroids(region: { x: number; y: number; width: number; height: number }): Promise<TemplateMatch[]> {
  const thumb = await captureGameFrame(1920, 1080)
  if (!thumb) return []

  const fullSize = thumb.getSize()
  const cropped = thumb.crop({
    x: Math.max(0, Math.min(region.x, fullSize.width - 1)),
    y: Math.max(0, Math.min(region.y, fullSize.height - 1)),
    width: Math.min(region.width, fullSize.width),
    height: Math.min(region.height, fullSize.height)
  })
  if (cropped.isEmpty()) return []

  const size = cropped.getSize()
  const bitmap = cropped.toBitmap()
  const all: TemplateMatch[] = []
  for (const tpl of templates.values()) {
    all.push(...matchTemplate(bitmap, size.width, size.height, tpl).map(m => ({ ...m, droidId: tpl.id })))
  }
  return all.filter(m => m.confidence > 0.75)
}

export function getLoadedTemplates(): DroidTemplate[] {
  return Array.from(templates.values())
}