// Card artwork for rebirth paths (batch 1: 60 cards).
// Files live in src/renderer/assets/cards/<droidId>.png (lowercase droid id,
// e.g. `amp-walker.png`, `l0.png`, `drk1-probe.png`, `imp-probe.png`).
// import.meta.glob picks up new drops automatically — batch 2 just needs
// the PNGs copied here + a rebuild, no code changes.
//
// Missing artwork (e.g. `ig`, `cyclens` until batch 2 lands) returns
// undefined so callers can fall back to the emoji icon.

const modules = import.meta.glob('../assets/cards/*.png', {
  eager: true,
  query: '?url',
  import: 'default'
}) as Record<string, string>

const CARD_MAP: Map<string, string> = new Map(
  Object.entries(modules).map(([p, url]) => {
    const file = p.split('/').pop() ?? p
    const id = file.replace(/\.png(\?.*)?$/i, '').toLowerCase()
    return [id, url as string]
  })
)

export function getDroidCard(droidId: string): string | undefined {
  return CARD_MAP.get(droidId.toLowerCase())
}

export function hasDroidCard(droidId: string): boolean {
  return CARD_MAP.has(droidId.toLowerCase())
}
