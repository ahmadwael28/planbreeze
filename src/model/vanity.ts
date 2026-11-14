/** A bathroom vanity's basins: which kind, and a tiled one's basin of the same tiles sunk into its top. */
import type { PlanSymbol } from './types'

/** What a vanity's basins are (see PlanSymbol.basin). */
export type VanityBasin = 'integrated' | 'vessel' | 'undermount' | 'tiled'

/**
 * A vanity's basins: as chosen; a tiled basin only on a vanity built in and tiled (else built in). If not chosen, built
 * into a ceramic top; a tiled vanity's, bowls on its stone top.
 */
export function vanityBasin(sym: Pick<PlanSymbol, 'basin' | 'style'>): VanityBasin {
  const tiled = sym.style === 'tiled'
  if (sym.basin === 'tiled') return tiled ? 'tiled' : 'integrated'
  return sym.basin ?? (tiled ? 'vessel' : 'integrated')
}

/** How high over a vanity's top a faucet built into the wall has its spout (cm): clear of a bowl standing on it. */
export const wallSpout = (sym: Pick<PlanSymbol, 'basin' | 'style'>) => (vanityBasin(sym) === 'vessel' ? 20 : 14)

/** How deep a tiled vanity's basin of its own tiles is sunk into its top (cm). */
export const TILED_BASIN = 12

/**
 * A built-in, tiled vanity's basin of the same tiles, sunk into its top: its opening, in the vanity's frame (x across,
 * z from its back at -depth/2 to its front), and where its faucets are along it (behind it, on the top). With one
 * faucet, up to 60 cm wide where its sink is (see sinkAt); with two, a trough across the vanity, a faucet over each half.
 * Kept 12 cm in from its ends and its back (room for the faucets) and as far from its front as it can be.
 */
export function tiledBasin(sym: Pick<PlanSymbol, 'width' | 'depth' | 'sinkAt' | 'faucets'>) {
  const w = sym.width
  const d = sym.depth
  const two = sym.faucets === 2
  const bw = Math.max(20, two ? w - 24 : Math.min(w - 24, 60))
  const mid = !two && sym.sinkAt ? Math.max(0, w / 2 - bw / 2 - 12) * (sym.sinkAt === 'left' ? -1 : 1) : 0
  const bd = Math.max(15, Math.min(d - 22, 36))
  const z0 = -d / 2 + 12
  return { x0: mid - bw / 2, x1: mid + bw / 2, z0, z1: z0 + bd, depth: TILED_BASIN, faucets: two ? [mid - bw / 4, mid + bw / 4] : [mid] }
}
