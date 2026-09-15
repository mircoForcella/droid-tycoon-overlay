// Game-accurate rarity + paint tags (see styles.css .tier-* / .paint-*,
// sampled from in-game reference shots).
export function TierTag({ tier }: { tier: string }) {
  return <span className={`tier tier-${tier.toLowerCase()}`}>{tier.toUpperCase()}</span>
}

export function PaintTag({ quality }: { quality: string }) {
  return <span className={`paint paint-${quality.toLowerCase()}`}>{quality.toUpperCase()}</span>
}
