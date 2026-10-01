import type { ReactNode } from 'react'
import { LIGHT_COLORS } from './lighting'
import type { PlanTheme } from './theme'
import type { CeilingStyle, PlanSymbol } from './types'

export type SymbolCategory =
  | 'Doors & Windows'
  | 'Lighting'
  | 'Ceilings'
  | 'Living'
  | 'Bedroom'
  | 'Kitchen'
  | 'Bathroom'
  | 'Electrical'
  | 'Other'

/** How a light fixture is mounted and how it lights the room in 3D. */
export type FixtureKind =
  | 'spot'
  | 'profile'
  | 'track'
  | 'cove'
  | 'gap'
  | 'pendant'
  | 'linear-pendant'
  | 'chandelier'
  | 'ceiling'
  | 'wall'
  | 'switch'

export interface SymbolDef {
  type: string
  name: string
  category: SymbolCategory
  width: number
  depth: number
  height: number
  /** Door/window symbols snap into walls. */
  wall?: boolean
  /** Default height of the bottom of a wall opening above the floor (windows). */
  sill?: number
  /** Light fixtures and switches. */
  fixture?: FixtureKind
  /** Default height of the bottom above the floor (suspended and wall-mounted items). */
  elevation?: number
  /** Snaps flat against the inside of a wall (switches, wall lights). */
  wallMount?: boolean
  /** Library items that apply a gypsum ceiling style to a room instead of placing a symbol. */
  ceilingStyle?: CeilingStyle
  /** Doors whose leaves or panels can be opened and closed in 3D. */
  opens?: boolean
  /** Finishes the frame comes in (the first is the default). */
  frames?: FrameColor[]
  /** Other words it's found by in the library search. */
  keywords?: string
  /** Always floor to ceiling (columns): its height follows the floor's. */
  fullHeight?: boolean
  /** Not offered in the library (added from elsewhere, e.g. a room's settings). */
  hidden?: boolean
  /** Draw the symbol centered at the origin: x ∈ [-w/2, w/2], y ∈ [-d/2, d/2]. */
  render: (w: number, d: number, t: PlanTheme, sym?: PlanSymbol) => ReactNode
}

/** A corner wardrobe's depth: a standard 60 cm, less if it's small. */
export const cornerArm = (w: number, d: number) => Math.min(60, w * 0.45, d * 0.45)

/**
 * A wardrobe's doors seen from above, along its front from x0 to x1 at y: door divisions for hinged doors, two
 * staggered tracks for sliding ones (`flip` draws them on the other side of the line, for the corner one's side run).
 */
function wardrobeFront(k: ReturnType<typeof kit>, x0: number, x1: number, y: number, sym?: PlanSymbol, flip = false) {
  const span = x1 - x0
  const s = flip ? -1 : 1
  if (sym?.doors === 'sliding') {
    const n = span > 220 ? 3 : 2
    const pw = span / n + 2
    return (
      <>
        {Array.from({ length: n }, (_, i) => {
          const a = x0 + ((span - pw) * i) / (n - 1)
          const yy = y - s * (i % 2 ? 2.5 : 5)
          return <line key={i} x1={a} y1={yy} x2={a + pw} y2={yy} {...k.line} />
        })}
      </>
    )
  }
  const n = Math.max(1, Math.round(span / 55))
  return (
    <>
      {Array.from({ length: n - 1 }, (_, i) => {
        const x = x0 + (span * (i + 1)) / n
        return <line key={i} x1={x} y1={y} x2={x} y2={y - s * 12} {...k.line} />
      })}
      {sym?.glass && <line x1={x0 + 3} y1={y - s * 2.5} x2={x1 - 3} y2={y - s * 2.5} {...k.thin} />}
    </>
  )
}

export interface FrameColor {
  name: string
  hex: string
  /** Shiny metal (anodised aluminium, brushed brass…) rather than a painted finish. */
  metal?: boolean
}

export const SPOT_FRAMES: FrameColor[] = [
  { name: 'White', hex: '#fafafa' },
  { name: 'Black', hex: '#1c1c1f' },
  { name: 'Silver', hex: '#c4c7cc', metal: true },
  { name: 'Gold', hex: '#c9a45c', metal: true },
  { name: 'Bronze', hex: '#7a5a3a', metal: true },
]

export const TRACK_FRAMES: FrameColor[] = [
  { name: 'Black', hex: '#232326' },
  { name: 'White', hex: '#f4f4f5' },
]

export const ALU_FRAMES: FrameColor[] = [
  { name: 'Silver', hex: '#b8bcc2', metal: true },
  { name: 'White', hex: '#f1f1ef' },
  { name: 'Black', hex: '#232326' },
  { name: 'Anthracite', hex: '#4a4d52' },
  { name: 'Bronze', hex: '#5b4633', metal: true },
  { name: 'Champagne', hex: '#c8b28e', metal: true },
]

/** The frame finish an item has: one of its type's, or a custom color. Null for items without a frame choice. */
export function frameOf(sym: PlanSymbol): FrameColor | null {
  const frames = SYMBOL_MAP.get(sym.type)?.frames
  if (!frames) return null
  if (!sym.frame) return frames[0]
  return frames.find((f) => f.hex.toLowerCase() === sym.frame!.toLowerCase()) ?? { name: 'Custom', hex: sym.frame }
}

const glow = (sym?: PlanSymbol) => LIGHT_COLORS[sym?.light?.color ?? 'warm'].hex

/** How many seats fit along a sofa run (about 65 cm each), so longer sofas get more cushions, not wider ones. */
export const seatsAlong = (len: number) => Math.max(1, Math.round(len / 65))
/** Chairs along one side of a table (about 60 cm each). */
export const chairsAlong = (len: number) => Math.max(1, Math.floor((len + 10) / 60))
/** Sizes that stay the same however long a sofa gets. */
export const SOFA = { arm: 20, back: 22, seat: 95 }
const AMBER = '#f59e0b'

/** Small ceiling-plan icon for the gypsum ceiling styles. */
function ceilingIcon(style: CeilingStyle, t: PlanTheme) {
  const k = kit(t)
  const hatch = t.dark ? '#52525b' : '#d4d4d8'
  const W = 120
  const H = 90
  const box = (inset: number, fill: string, dash?: string) => (
    <rect
      x={-W / 2 + inset}
      y={-H / 2 + inset}
      width={W - inset * 2}
      height={H - inset * 2}
      {...k.s(fill)}
      strokeDasharray={dash}
    />
  )
  const led = (inset: number) => (
    <rect
      x={-W / 2 + inset}
      y={-H / 2 + inset}
      width={W - inset * 2}
      height={H - inset * 2}
      fill="none"
      stroke={AMBER}
      strokeWidth={2}
      strokeDasharray="2 3"
      vectorEffect="non-scaling-stroke"
    />
  )
  return (
    <>
      {box(0, style === 'floating' ? t.fill : hatch)}
      {(style === 'tray' || style === 'cove' || style === 'stepped') && box(18, t.fill, '4 3')}
      {style === 'stepped' && box(30, t.fill, '4 3')}
      {style === 'cove' && led(14)}
      {style === 'floating' && (
        <>
          {box(16, hatch, '4 3')}
          {led(12)}
        </>
      )}
    </>
  )
}

/** Drawing helpers bound to a theme. */
function kit(t: PlanTheme) {
  const base = {
    stroke: t.ink,
    strokeWidth: 1.2,
    vectorEffect: 'non-scaling-stroke',
    strokeLinejoin: 'round',
  } as const
  const s = (fill = t.fill) => ({ ...base, fill })
  const line = { ...base, fill: 'none' }
  const thin = { ...line, strokeWidth: 0.8 }

  const box = (w: number, d: number, r = 0, fill = t.fill) => (
    <rect x={-w / 2} y={-d / 2} width={w} height={d} rx={r} {...s(fill)} />
  )

  /** Door leaf + swing arc, hinged at x = hx, opening toward +y from the wall face y0. */
  const swing = (hx: number, y0: number, leaf: number, dir: 1 | -1) => {
    const tip = hx + dir * leaf
    return (
      <>
        <line x1={hx} y1={y0} x2={hx} y2={y0 + leaf} {...s()} strokeWidth={2} />
        <path
          d={`M${tip},${y0} A${leaf},${leaf} 0 0 ${dir === 1 ? 1 : 0} ${hx},${y0 + leaf}`}
          {...thin}
          strokeDasharray="4 3"
        />
      </>
    )
  }

  /** A slim glazed aluminium leaf (frame with glass along it) and its swing arc, like `swing`. */
  const glazedSwing = (hx: number, y0: number, leaf: number, dir: 1 | -1) => {
    const tip = hx + dir * leaf
    return (
      <>
        <rect x={dir === 1 ? hx : hx - 4} y={y0} width={4} height={leaf} {...s()} />
        <line x1={hx + dir * 2} y1={y0 + 4} x2={hx + dir * 2} y2={y0 + leaf - 4} {...thin} />
        <path
          d={`M${tip},${y0} A${leaf},${leaf} 0 0 ${dir === 1 ? 1 : 0} ${hx},${y0 + leaf}`}
          {...thin}
          strokeDasharray="4 3"
        />
      </>
    )
  }

  /** An aluminium frame's posts at both ends of an opening. */
  const aluPosts = (w: number, d: number) => (
    <>
      <rect x={-w / 2} y={-d / 2} width={4} height={d} {...s()} />
      <rect x={w / 2 - 4} y={-d / 2} width={4} height={d} {...s()} />
    </>
  )

  const opening = (w: number, d: number) => (
    <>
      <rect x={-w / 2} y={-d / 2 - 0.5} width={w} height={d + 1} fill={t.opening} stroke="none" />
      <line x1={-w / 2} y1={-d / 2} x2={-w / 2} y2={d / 2} {...line} />
      <line x1={w / 2} y1={-d / 2} x2={w / 2} y2={d / 2} {...line} />
    </>
  )

  const chair = (x: number, y: number, rot: number, cw = 42, cd = 42) => (
    <g transform={`translate(${x},${y}) rotate(${rot})`}>
      <rect x={-cw / 2} y={-cd / 2} width={cw} height={cd} rx={5} {...s()} />
      <rect x={-cw / 2} y={-cd / 2} width={cw} height={8} rx={3} {...s(t.fill2)} />
    </g>
  )

  return { s, line, thin, box, swing, glazedSwing, aluPosts, opening, chair }
}

export const SYMBOLS: SymbolDef[] = [
  // ---------- Doors & Windows ----------
  {
    type: 'door',
    opens: true,
    name: 'Door',
    category: 'Doors & Windows',
    width: 90,
    depth: 10,
    height: 210,
    wall: true,
    render: (w, d, t) => {
      const k = kit(t)
      return (
        <>
          {k.opening(w, d)}
          {k.swing(-w / 2, d / 2, w, 1)}
        </>
      )
    },
  },
  {
    type: 'door-double',
    opens: true,
    name: 'Double door',
    category: 'Doors & Windows',
    width: 160,
    depth: 10,
    height: 210,
    wall: true,
    render: (w, d, t) => {
      const k = kit(t)
      return (
        <>
          {k.opening(w, d)}
          {k.swing(-w / 2, d / 2, w / 2, 1)}
          {k.swing(w / 2, d / 2, w / 2, -1)}
        </>
      )
    },
  },
  {
    type: 'door-sliding',
    opens: true,
    name: 'Sliding door',
    category: 'Doors & Windows',
    width: 180,
    depth: 10,
    height: 210,
    wall: true,
    render: (w, d, t) => {
      const k = kit(t)
      return (
        <>
          {k.opening(w, d)}
          <rect x={-w / 2} y={-d / 4} width={w * 0.55} height={d / 4} {...k.s()} />
          <rect x={w / 2 - w * 0.55} y={0} width={w * 0.55} height={d / 4} {...k.s()} />
        </>
      )
    },
  },
  {
    type: 'door-barn',
    opens: true,
    name: 'Barn sliding door',
    category: 'Doors & Windows',
    width: 90,
    depth: 10,
    height: 210,
    wall: true,
    render: (w, d, t) => {
      const k = kit(t)
      // A panel hung on a rail on the room side of the wall, slid partly open.
      const pw = w + 10
      const x = -w * 0.6
      const y = d / 2 + 2
      return (
        <>
          {k.opening(w, d)}
          <line x1={-w / 2 - pw - 5} y1={y - 1} x2={w / 2 + 10} y2={y - 1} {...k.thin} strokeDasharray="6 3" />
          <rect x={x - pw / 2} y={y} width={pw} height={5} {...k.s()} strokeWidth={1.8} />
          <path d={`M${x - 12},${y + 11} h24 m-4,-3 l4,3 l-4,3 m-16,-6 l-4,3 l4,3`} {...k.thin} />
        </>
      )
    },
  },
  {
    type: 'door-alu',
    opens: true,
    name: 'Aluminium door',
    keywords: 'alumetal aluminum glass glazed',
    category: 'Doors & Windows',
    width: 90,
    depth: 10,
    height: 210,
    wall: true,
    frames: ALU_FRAMES,
    render: (w, d, t) => {
      const k = kit(t)
      return (
        <>
          {k.opening(w, d)}
          {k.aluPosts(w, d)}
          {k.glazedSwing(-w / 2 + 4, d / 2, w - 8, 1)}
        </>
      )
    },
  },
  {
    type: 'door-alu-double',
    opens: true,
    name: 'Aluminium double door',
    keywords: 'alumetal aluminum glass glazed',
    category: 'Doors & Windows',
    width: 160,
    depth: 10,
    height: 210,
    wall: true,
    frames: ALU_FRAMES,
    render: (w, d, t) => {
      const k = kit(t)
      return (
        <>
          {k.opening(w, d)}
          {k.aluPosts(w, d)}
          {k.glazedSwing(-w / 2 + 4, d / 2, w / 2 - 4, 1)}
          {k.glazedSwing(w / 2 - 4, d / 2, w / 2 - 4, -1)}
        </>
      )
    },
  },
  {
    type: 'door-alu-sliding',
    opens: true,
    name: 'Aluminium sliding door',
    keywords: 'alumetal aluminum glass glazed slider',
    category: 'Doors & Windows',
    width: 180,
    depth: 10,
    height: 210,
    wall: true,
    frames: ALU_FRAMES,
    render: (w, d, t) => {
      const k = kit(t)
      // Two glazed panels on two tracks, overlapping in the middle.
      const pw = (w - 8) / 2 + 4
      const ph = d / 5
      const panel = (x: number, y: number) => (
        <>
          <rect x={x} y={y} width={pw} height={ph} {...k.s()} />
          <line x1={x + 4} y1={y + ph / 2} x2={x + pw - 4} y2={y + ph / 2} {...k.thin} />
        </>
      )
      return (
        <>
          {k.opening(w, d)}
          {k.aluPosts(w, d)}
          {panel(-w / 2 + 4, -ph - 0.5)}
          {panel(w / 2 - 4 - pw, 0.5)}
          <path d={`M${w / 4 - 12},${d / 2 + 8} h24 m-20,-3 l-4,3 l4,3`} {...k.thin} />
        </>
      )
    },
  },
  {
    type: 'opening',
    name: 'Opening',
    category: 'Doors & Windows',
    width: 90,
    depth: 10,
    height: 210,
    wall: true,
    render: (w, d, t) => kit(t).opening(w, d),
  },
  {
    type: 'window',
    name: 'Window',
    category: 'Doors & Windows',
    width: 120,
    depth: 10,
    height: 120,
    sill: 90,
    wall: true,
    render: (w, d, t) => {
      const k = kit(t)
      return (
        <>
          {k.opening(w, d)}
          <rect x={-w / 2} y={-d / 2} width={w} height={d} {...k.s()} />
          <line x1={-w / 2} y1={0} x2={w / 2} y2={0} {...k.line} />
        </>
      )
    },
  },
  {
    type: 'window-wide',
    name: 'Double window',
    category: 'Doors & Windows',
    width: 180,
    depth: 10,
    height: 140,
    sill: 80,
    wall: true,
    render: (w, d, t) => {
      const k = kit(t)
      return (
        <>
          {k.opening(w, d)}
          <rect x={-w / 2} y={-d / 2} width={w} height={d} {...k.s()} />
          <line x1={-w / 2} y1={0} x2={w / 2} y2={0} {...k.line} />
          <line x1={0} y1={-d / 2} x2={0} y2={d / 2} {...k.line} />
        </>
      )
    },
  },

  // ---------- Living ----------
  {
    type: 'sofa',
    name: 'Sofa',
    category: 'Living',
    width: 210,
    depth: 90,
    height: 80,
    render: (w, d, t) => {
      const k = kit(t)
      // Arms and back keep their size; a longer sofa gets more seats.
      const arm = Math.min(SOFA.arm, w * 0.15)
      const back = Math.min(SOFA.back, d * 0.3)
      const inner = w - arm * 2
      const n = seatsAlong(inner)
      return (
        <>
          {k.box(w, d, 8)}
          <rect x={-w / 2} y={-d / 2} width={w} height={back} rx={6} {...k.s(t.fill2)} />
          <rect x={-w / 2} y={-d / 2} width={arm} height={d} rx={6} {...k.s(t.fill2)} />
          <rect x={w / 2 - arm} y={-d / 2} width={arm} height={d} rx={6} {...k.s(t.fill2)} />
          {Array.from({ length: n - 1 }, (_, i) => {
            const x = -inner / 2 + (inner * (i + 1)) / n
            return <line key={i} x1={x} y1={-d / 2 + back} x2={x} y2={d / 2} {...k.thin} />
          })}
        </>
      )
    },
  },
  {
    type: 'sofa-corner',
    name: 'Corner sofa',
    category: 'Living',
    width: 260,
    depth: 200,
    height: 80,
    render: (w, d, t) => {
      const k = kit(t)
      // An L: seats along the back (top) and down the left side; flip it for the other hand.
      const arm = Math.min(SOFA.arm, w * 0.12, d * 0.12)
      const back = Math.min(SOFA.back, d * 0.2, w * 0.2)
      const seat = Math.min(SOFA.seat, d * 0.6, w * 0.6)
      const L = -w / 2
      const T = -d / 2
      const runX = w - back - arm
      const runY = d - seat - arm
      const nx = seatsAlong(runX)
      const ny = seatsAlong(runY)
      return (
        <>
          <path d={`M${L},${T} H${w / 2} V${T + seat} H${L + seat} V${d / 2} H${L} Z`} {...k.s()} />
          <rect x={L} y={T} width={w} height={back} rx={6} {...k.s(t.fill2)} />
          <rect x={L} y={T} width={back} height={d} rx={6} {...k.s(t.fill2)} />
          <rect x={w / 2 - arm} y={T} width={arm} height={seat} rx={6} {...k.s(t.fill2)} />
          <rect x={L} y={d / 2 - arm} width={seat} height={arm} rx={6} {...k.s(t.fill2)} />
          {Array.from({ length: nx - 1 }, (_, i) => {
            const x = L + back + (runX * (i + 1)) / nx
            return <line key={`x${i}`} x1={x} y1={T + back} x2={x} y2={T + seat} {...k.thin} />
          })}
          <line x1={L + back} y1={T + seat} x2={L + seat} y2={T + seat} {...k.thin} />
          {Array.from({ length: ny - 1 }, (_, i) => {
            const y = T + seat + (runY * (i + 1)) / ny
            return <line key={`y${i}`} x1={L + back} y1={y} x2={L + seat} y2={y} {...k.thin} />
          })}
        </>
      )
    },
  },
  {
    type: 'armchair',
    name: 'Armchair',
    category: 'Living',
    width: 85,
    depth: 85,
    height: 80,
    render: (w, d, t) => {
      const k = kit(t)
      return (
        <>
          {k.box(w, d, 8)}
          <rect x={-w / 2} y={-d / 2} width={w} height={Math.min(SOFA.back, d * 0.3)} rx={6} {...k.s(t.fill2)} />
          <rect x={-w / 2} y={-d / 2} width={Math.min(18, w * 0.22)} height={d} rx={6} {...k.s(t.fill2)} />
          <rect x={w / 2 - Math.min(18, w * 0.22)} y={-d / 2} width={Math.min(18, w * 0.22)} height={d} rx={6} {...k.s(t.fill2)} />
        </>
      )
    },
  },
  {
    type: 'coffee-table',
    name: 'Coffee table',
    category: 'Living',
    width: 110,
    depth: 60,
    height: 45,
    render: (w, d, t) => {
      const k = kit(t)
      return (
        <>
          {k.box(w, d, 4)}
          <rect x={-w / 2 + 6} y={-d / 2 + 6} width={w - 12} height={d - 12} rx={2} {...k.thin} />
        </>
      )
    },
  },
  {
    type: 'tv-unit',
    name: 'TV unit with TV',
    category: 'Living',
    width: 160,
    depth: 45,
    height: 50,
    render: (w, d, t) => {
      const k = kit(t)
      return (
        <>
          {k.box(w, d)}
          <rect x={-Math.min(w * 0.35, 82)} y={-d / 2 + 4} width={Math.min(w * 0.7, 165)} height={6} {...k.s(t.ink)} />
        </>
      )
    },
  },
  {
    type: 'tv-stand',
    name: 'TV table',
    category: 'Living',
    width: 180,
    depth: 45,
    height: 50,
    render: (w, d, t) => {
      const k = kit(t)
      const n = Math.max(2, Math.round(w / 60))
      return (
        <>
          {k.box(w, d)}
          {Array.from({ length: n - 1 }, (_, i) => {
            const x = -w / 2 + (w * (i + 1)) / n
            return <line key={i} x1={x} y1={-d / 2} x2={x} y2={d / 2} {...k.thin} />
          })}
        </>
      )
    },
  },
  {
    type: 'tv',
    name: 'TV',
    category: 'Living',
    width: 125,
    depth: 8,
    height: 72,
    // Wall-mounted by default: the bottom of the screen above the floor. Set it to 0 to stand it on its feet.
    elevation: 100,
    render: (w, d, t) => {
      const k = kit(t)
      return (
        <>
          <rect x={-w / 2} y={-d / 2} width={w} height={d} rx={1.5} {...k.s(t.ink)} />
          <line x1={-w / 2 + 4} y1={d / 2 + 5} x2={w / 2 - 4} y2={d / 2 + 5} {...k.thin} strokeDasharray="3 3" />
        </>
      )
    },
  },
  {
    type: 'dining-table',
    name: 'Dining table',
    category: 'Living',
    width: 160,
    depth: 90,
    height: 75,
    render: (w, d, t) => {
      const k = kit(t)
      return (
        <>
          {Array.from({ length: chairsAlong(w) }, (_, i) => {
            const n = chairsAlong(w)
            const x = -w / 2 + (w * (i + 0.5)) / n
            return (
              <g key={i}>
                {k.chair(x, -d / 2 - 10, 0)}
                {k.chair(x, d / 2 + 10, 180)}
              </g>
            )
          })}
          {k.box(w, d, 3)}
        </>
      )
    },
  },
  {
    type: 'round-table',
    name: 'Round table',
    category: 'Living',
    width: 110,
    depth: 110,
    height: 75,
    render: (w, d, t) => {
      const k = kit(t)
      return (
        <>
          {k.chair(0, -d / 2 - 8, 0)}
          {k.chair(0, d / 2 + 8, 180)}
          {k.chair(-w / 2 - 8, 0, -90)}
          {k.chair(w / 2 + 8, 0, 90)}
          <ellipse cx={0} cy={0} rx={w / 2} ry={d / 2} {...k.s()} />
        </>
      )
    },
  },
  {
    type: 'chair',
    name: 'Chair',
    category: 'Living',
    width: 45,
    depth: 45,
    height: 90,
    render: (w, d, t) => kit(t).chair(0, 0, 0, w, d),
  },
  {
    type: 'bookshelf',
    name: 'Bookshelf',
    category: 'Living',
    width: 100,
    depth: 35,
    height: 200,
    render: (w, d, t) => {
      const k = kit(t)
      return (
        <>
          {k.box(w, d)}
          {[-0.25, 0, 0.25].map((f) => (
            <line key={f} x1={f * w} y1={-d / 2} x2={f * w} y2={d / 2} {...k.thin} />
          ))}
        </>
      )
    },
  },
  {
    type: 'plant',
    name: 'Plant',
    category: 'Living',
    width: 50,
    depth: 50,
    height: 100,
    render: (w, d, t) => {
      const k = kit(t)
      return (
        <>
          <ellipse cx={0} cy={0} rx={w / 2} ry={d / 2} {...k.s(t.tint('#dcfce7'))} />
          {[0, 60, 120].map((a) => (
            <ellipse key={a} cx={0} cy={0} rx={w / 2} ry={d / 7} transform={`rotate(${a})`} {...k.thin} />
          ))}
        </>
      )
    },
  },

  // ---------- Bedroom ----------
  {
    type: 'bed-double',
    name: 'Double bed',
    category: 'Bedroom',
    width: 160,
    depth: 200,
    height: 50,
    render: (w, d, t) => {
      const k = kit(t)
      return (
        <>
          {k.box(w, d, 3)}
          <rect x={-w / 2 + 8} y={-d / 2 + 8} width={w / 2 - 12} height={Math.min(30, d * 0.14)} rx={6} {...k.s(t.fill2)} />
          <rect x={4} y={-d / 2 + 8} width={w / 2 - 12} height={Math.min(30, d * 0.14)} rx={6} {...k.s(t.fill2)} />
          <path d={`M${-w / 2},${-d / 2 + Math.min(60, d * 0.3)} H${w / 2} V${d / 2} H${-w / 2} Z`} {...k.s(t.tint('#e0e7ff'))} />
        </>
      )
    },
  },
  {
    type: 'bed-single',
    name: 'Single bed',
    category: 'Bedroom',
    width: 90,
    depth: 200,
    height: 50,
    render: (w, d, t) => {
      const k = kit(t)
      return (
        <>
          {k.box(w, d, 3)}
          <rect x={-w / 2 + 8} y={-d / 2 + 8} width={w - 16} height={d * 0.14} rx={6} {...k.s(t.fill2)} />
          <path d={`M${-w / 2},${-d / 2 + d * 0.3} H${w / 2} V${d / 2} H${-w / 2} Z`} {...k.s(t.tint('#e0e7ff'))} />
        </>
      )
    },
  },
  {
    type: 'wardrobe',
    name: 'Wardrobe',
    keywords: 'closet cupboard',
    category: 'Bedroom',
    width: 120,
    depth: 60,
    height: 220,
    render: (w, d, t, sym) => {
      const k = kit(t)
      return (
        <>
          {k.box(w, d)}
          {wardrobeFront(k, -w / 2, w / 2, d / 2, sym)}
          <line x1={-w / 2 + 5} y1={0} x2={w / 2 - 5} y2={0} {...k.thin} strokeDasharray="6 4" />
        </>
      )
    },
  },
  {
    type: 'wardrobe-corner',
    name: 'Corner wardrobe',
    keywords: 'closet cupboard L shaped',
    category: 'Bedroom',
    width: 200,
    depth: 180,
    height: 240,
    render: (w, d, t, sym) => {
      const k = kit(t)
      // An L along the back (top) and down the left side; flip it for the other hand.
      const a = cornerArm(w, d)
      const L = -w / 2
      const T = -d / 2
      return (
        <>
          <path d={`M${L},${T} H${w / 2} V${T + a} H${L + a} V${d / 2} H${L} Z`} {...k.s()} />
          {wardrobeFront(k, L + a, w / 2, T + a, sym)}
          <g transform={`translate(${L + a},${T + a}) rotate(90)`}>{wardrobeFront(k, 0, d - a, 0, sym, true)}</g>
          <line x1={L + a} y1={T + a / 2} x2={w / 2 - 5} y2={T + a / 2} {...k.thin} strokeDasharray="6 4" />
          <line x1={L + a / 2} y1={T + a} x2={L + a / 2} y2={d / 2 - 5} {...k.thin} strokeDasharray="6 4" />
        </>
      )
    },
  },
  {
    type: 'nightstand',
    name: 'Nightstand',
    category: 'Bedroom',
    width: 45,
    depth: 40,
    height: 55,
    render: (w, d, t) => {
      const k = kit(t)
      return (
        <>
          {k.box(w, d, 2)}
          <circle cx={0} cy={0} r={Math.min(w, d) / 5} {...k.thin} />
        </>
      )
    },
  },
  {
    type: 'desk',
    name: 'Desk',
    category: 'Bedroom',
    width: 120,
    depth: 60,
    height: 75,
    render: (w, d, t) => {
      const k = kit(t)
      return (
        <>
          {k.chair(0, d / 2 + 5, 180)}
          {k.box(w, d)}
        </>
      )
    },
  },

  // ---------- Kitchen ----------
  {
    type: 'counter',
    name: 'Counter',
    category: 'Kitchen',
    width: 120,
    depth: 60,
    height: 90,
    render: (w, d, t) => {
      const k = kit(t)
      return (
        <>
          {k.box(w, d, 0, t.fill)}
          <line x1={-w / 2} y1={d / 2 - 4} x2={w / 2} y2={d / 2 - 4} {...k.thin} />
        </>
      )
    },
  },
  {
    type: 'kitchen-sink',
    name: 'Sink',
    category: 'Kitchen',
    width: 80,
    depth: 60,
    height: 90,
    render: (w, d, t) => {
      const k = kit(t)
      return (
        <>
          {k.box(w, d)}
          <rect x={-Math.min(w - 16, 72) / 2} y={-d / 2 + 12} width={Math.min(w - 16, 72)} height={d - 20} rx={6} {...k.s(t.fill2)} />
          <circle cx={0} cy={-d / 2 + 7} r={2.5} {...k.s(t.ink)} />
        </>
      )
    },
  },
  {
    type: 'stove',
    name: 'Stove',
    category: 'Kitchen',
    width: 60,
    depth: 60,
    height: 90,
    render: (w, d, t) => {
      const k = kit(t)
      return (
        <>
          {k.box(w, d)}
          {[
            [-1, -1],
            [1, -1],
            [-1, 1],
            [1, 1],
          ].map(([a, b]) => (
            <circle key={`${a}${b}`} cx={(a * w) / 4.5} cy={(b * d) / 4.5} r={Math.min(w, d) / 7} {...k.line} />
          ))}
        </>
      )
    },
  },
  {
    type: 'fridge',
    name: 'Fridge',
    category: 'Kitchen',
    width: 70,
    depth: 70,
    height: 180,
    render: (w, d, t) => {
      const k = kit(t)
      return (
        <>
          {k.box(w, d)}
          <line x1={-w / 2} y1={d / 2 - 8} x2={w / 2} y2={d / 2 - 8} {...k.line} />
          <text x={0} y={4} fontSize={Math.min(w, d) / 3.5} textAnchor="middle" fill={t.ink} fontFamily="sans-serif">
            REF
          </text>
        </>
      )
    },
  },

  // ---------- Bathroom ----------
  {
    type: 'toilet',
    name: 'Toilet',
    category: 'Bathroom',
    width: 40,
    depth: 65,
    height: 80,
    render: (w, d, t) => {
      const k = kit(t)
      return (
        <>
          <rect x={-w / 2} y={-d / 2} width={w} height={d * 0.3} rx={3} {...k.s()} />
          <ellipse cx={0} cy={d * 0.12} rx={w * 0.42} ry={d * 0.36} {...k.s()} />
        </>
      )
    },
  },
  {
    type: 'washbasin',
    name: 'Washbasin',
    category: 'Bathroom',
    width: 60,
    depth: 45,
    height: 85,
    render: (w, d, t) => {
      const k = kit(t)
      return (
        <>
          {k.box(w, d, 4)}
          <ellipse cx={0} cy={d * 0.06} rx={w * 0.36} ry={d * 0.3} {...k.s(t.fill2)} />
          <circle cx={0} cy={-d / 2 + 6} r={2.5} {...k.s(t.ink)} />
        </>
      )
    },
  },
  {
    type: 'bathtub',
    name: 'Bathtub',
    category: 'Bathroom',
    width: 170,
    depth: 75,
    height: 55,
    render: (w, d, t) => {
      const k = kit(t)
      return (
        <>
          {k.box(w, d, 6)}
          <rect x={-w / 2 + 8} y={-d / 2 + 8} width={w - 16} height={d - 16} rx={d / 3} {...k.s(t.fill2)} />
          <circle cx={-w / 2 + 18} cy={0} r={3} {...k.s(t.ink)} />
        </>
      )
    },
  },
  {
    type: 'shower',
    name: 'Shower',
    category: 'Bathroom',
    width: 90,
    depth: 90,
    height: 200,
    render: (w, d, t, sym) => {
      const k = kit(t)
      const leaf = w * 0.6
      return (
        <>
          {k.box(w, d)}
          <line x1={-w / 2} y1={-d / 2} x2={w / 2} y2={d / 2} {...k.thin} />
          <line x1={w / 2} y1={-d / 2} x2={-w / 2} y2={d / 2} {...k.thin} />
          <circle cx={0} cy={0} r={4} {...k.s()} />
          {sym?.doors === 'sliding' ? (
            <>
              <line x1={-w / 2} y1={d / 2 - 2} x2={-w / 2 + w * 0.55} y2={d / 2 - 2} {...k.line} />
              <line x1={w / 2 - w * 0.55} y1={d / 2 + 1.5} x2={w / 2} y2={d / 2 + 1.5} {...k.line} />
            </>
          ) : (
            <path d={`M${w / 2},${d / 2} A${leaf},${leaf} 0 0 1 ${w / 2 - leaf},${d / 2 + leaf}`} {...k.thin} strokeDasharray="4 3" />
          )}
        </>
      )
    },
  },

  {
    type: 'shower-quadrant',
    name: 'Curved corner shower',
    keywords: 'quadrant round shower',
    category: 'Bathroom',
    width: 90,
    depth: 90,
    height: 200,
    render: (w, d, t) => {
      const k = kit(t)
      // Walls along the back and left; a quarter-round glass front with sliding doors.
      return (
        <>
          <path d={`M${-w / 2},${-d / 2} L${w / 2},${-d / 2} A${w},${d} 0 0 1 ${-w / 2},${d / 2} Z`} {...k.s()} />
          <path d={`M${w / 2 - 7},${-d / 2} A${w - 7},${d - 7} 0 0 1 ${-w / 2},${d / 2 - 7}`} {...k.thin} strokeDasharray="4 3" />
          <circle cx={-w / 2 + w * 0.35} cy={-d / 2 + d * 0.35} r={4} {...k.s()} />
        </>
      )
    },
  },

  // ---------- Electrical ----------
  {
    type: 'outlet',
    name: 'Outlet',
    category: 'Electrical',
    width: 20,
    depth: 20,
    height: 30,
    render: (w, d, t) => {
      const k = kit(t)
      return (
        <>
          <circle cx={0} cy={0} r={Math.min(w, d) / 2} {...k.s()} />
          <line x1={-w / 2} y1={0} x2={w / 2} y2={0} {...k.line} />
          <line x1={-w / 5} y1={-d / 2} x2={-w / 5} y2={0} {...k.line} />
          <line x1={w / 5} y1={-d / 2} x2={w / 5} y2={0} {...k.line} />
        </>
      )
    },
  },
  {
    type: 'switch',
    name: 'Light switch',
    category: 'Lighting',
    width: 20,
    depth: 20,
    height: 110,
    fixture: 'switch',
    wallMount: true,
    render: (w, d, t) => {
      const k = kit(t)
      return (
        <>
          <circle cx={0} cy={0} r={Math.min(w, d) / 3} {...k.s()} />
          <line x1={w / 5} y1={-d / 5} x2={w / 2} y2={-d / 2} {...k.line} />
        </>
      )
    },
  },
  {
    type: 'light',
    name: 'Ceiling light',
    category: 'Lighting',
    width: 30,
    depth: 30,
    height: 8,
    fixture: 'ceiling',
    render: (w, d, t, sym) => {
      const k = kit(t)
      return (
        <>
          <circle cx={0} cy={0} r={Math.min(w, d) / 2} {...k.s(glow(sym))} />
          <line x1={-w / 2.8} y1={-d / 2.8} x2={w / 2.8} y2={d / 2.8} {...k.line} />
          <line x1={w / 2.8} y1={-d / 2.8} x2={-w / 2.8} y2={d / 2.8} {...k.line} />
        </>
      )
    },
  },

  // ---------- Lighting ----------
  {
    type: 'spot',
    name: 'Recessed spot',
    keywords: 'downlight',
    category: 'Lighting',
    frames: SPOT_FRAMES,
    width: 16,
    depth: 16,
    height: 8,
    fixture: 'spot',
    render: (w, _d, t, sym) => {
      const k = kit(t)
      return (
        <>
          <circle cx={0} cy={0} r={w / 2} {...k.s()} />
          <circle cx={0} cy={0} r={w / 4} {...k.s(glow(sym))} />
          <line x1={-w * 0.7} y1={0} x2={w * 0.7} y2={0} {...k.thin} />
          <line x1={0} y1={-w * 0.7} x2={0} y2={w * 0.7} {...k.thin} />
        </>
      )
    },
  },
  {
    type: 'led-profile',
    name: 'LED profile',
    category: 'Lighting',
    width: 120,
    depth: 6,
    height: 7,
    fixture: 'profile',
    render: (w, d, t, sym) => {
      const k = kit(t)
      return (
        <>
          <rect x={-w / 2} y={-d / 2} width={w} height={d} rx={1} {...k.s(glow(sym))} />
          <line x1={-w / 2 + 3} y1={0} x2={w / 2 - 3} y2={0} {...k.thin} strokeDasharray="6 4" />
        </>
      )
    },
  },
  {
    type: 'track',
    name: 'Magnetic track',
    category: 'Lighting',
    frames: TRACK_FRAMES,
    width: 200,
    depth: 5,
    height: 5,
    fixture: 'track',
    render: (w, d, t, sym) => {
      const k = kit(t)
      const mods = sym?.modules ?? [
        { id: 'a', kind: 'spot' as const, offset: w * 0.2 },
        { id: 'b', kind: 'linear' as const, offset: w * 0.5 },
        { id: 'c', kind: 'spot' as const, offset: w * 0.8 },
      ]
      return (
        <>
          <rect x={-w / 2} y={-d / 2} width={w} height={d} {...k.s(t.ink)} />
          {mods.map((m) => {
            const x = m.offset - w / 2
            if (m.kind === 'spot') return <circle key={m.id} cx={x} cy={0} r={7} {...k.s(glow(sym))} />
            if (m.kind === 'linear') {
              return <rect key={m.id} x={x - 18} y={-5} width={36} height={10} rx={2} {...k.s(glow(sym))} />
            }
            return (
              <g key={m.id}>
                <rect x={x - 14} y={-6} width={28} height={12} rx={2} {...k.s()} />
                {[-8, 0, 8].map((o) => (
                  <circle key={o} cx={x + o} cy={0} r={3} {...k.s(glow(sym))} />
                ))}
              </g>
            )
          })}
        </>
      )
    },
  },
  {
    type: 'cove-light',
    name: 'Cove / hidden light',
    category: 'Lighting',
    width: 90,
    depth: 70,
    height: 2,
    fixture: 'cove',
    render: (w, d, t, sym) => (
      <>
        <rect x={-w / 2} y={-d / 2} width={w} height={d} fill="none" stroke={t.ink} strokeWidth={1} vectorEffect="non-scaling-stroke" />
        <rect
          x={-w / 2 + 8}
          y={-d / 2 + 8}
          width={w - 16}
          height={d - 16}
          fill="none"
          stroke={sym?.light?.color === 'cool' ? '#60a5fa' : AMBER}
          strokeWidth={2.5}
          strokeDasharray="3 3"
          vectorEffect="non-scaling-stroke"
        />
      </>
    ),
  },
  {
    // The LED in a room's shadow gaps; added from the room's ceiling settings.
    type: 'gap-light',
    name: 'Shadow gap light',
    category: 'Lighting',
    width: 90,
    depth: 70,
    height: 1,
    fixture: 'gap',
    hidden: true,
    render: (w, d, _t, sym) => (
      <rect x={-w / 2} y={-d / 2} width={w} height={d} fill="none" stroke={glow(sym)} strokeWidth={2.5} strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />
    ),
  },
  {
    type: 'pendant',
    name: 'Pendant light',
    category: 'Lighting',
    width: 40,
    depth: 40,
    height: 30,
    elevation: 165,
    fixture: 'pendant',
    render: (w, _d, t, sym) => {
      const k = kit(t)
      return (
        <>
          <circle cx={0} cy={0} r={w / 2} {...k.s()} strokeDasharray="4 3" />
          <circle cx={0} cy={0} r={w / 5} {...k.s(glow(sym))} />
          <line x1={-w / 2} y1={0} x2={w / 2} y2={0} {...k.thin} />
          <line x1={0} y1={-w / 2} x2={0} y2={w / 2} {...k.thin} />
        </>
      )
    },
  },
  {
    type: 'linear-pendant',
    name: 'Linear pendant',
    category: 'Lighting',
    width: 120,
    depth: 12,
    height: 8,
    elevation: 170,
    fixture: 'linear-pendant',
    render: (w, d, t, sym) => {
      const k = kit(t)
      return (
        <>
          <rect x={-w / 2} y={-d / 2} width={w} height={d} rx={d / 2} {...k.s()} strokeDasharray="4 3" />
          <rect x={-w / 2 + 6} y={-d / 6} width={w - 12} height={d / 3} {...k.s(glow(sym))} />
        </>
      )
    },
  },
  {
    type: 'chandelier',
    name: 'Chandelier',
    category: 'Lighting',
    width: 70,
    depth: 70,
    height: 60,
    elevation: 190,
    fixture: 'chandelier',
    render: (w, _d, t, sym) => {
      const k = kit(t)
      const r = w / 2
      return (
        <>
          <circle cx={0} cy={0} r={r} {...k.thin} strokeDasharray="4 3" />
          {[0, 60, 120, 180, 240, 300].map((a) => {
            const x = Math.cos((a * Math.PI) / 180) * r * 0.75
            const y = Math.sin((a * Math.PI) / 180) * r * 0.75
            return (
              <g key={a}>
                <line x1={0} y1={0} x2={x} y2={y} {...k.line} />
                <circle cx={x} cy={y} r={r * 0.14} {...k.s(glow(sym))} />
              </g>
            )
          })}
          <circle cx={0} cy={0} r={r * 0.16} {...k.s(t.ink)} />
        </>
      )
    },
  },
  {
    type: 'wall-light',
    name: 'Wall light',
    category: 'Lighting',
    width: 30,
    depth: 15,
    height: 25,
    elevation: 180,
    fixture: 'wall',
    wallMount: true,
    render: (w, d, t, sym) => {
      const k = kit(t)
      return (
        <>
          <path d={`M${-w / 2},${-d / 2} A${w / 2},${d} 0 0 0 ${w / 2},${-d / 2} Z`} {...k.s(glow(sym))} />
          <line x1={-w / 2} y1={-d / 2} x2={w / 2} y2={-d / 2} {...k.s()} strokeWidth={2} />
        </>
      )
    },
  },

  // ---------- Ceilings (gypsum board) ----------
  ...(['flat', 'tray', 'cove', 'floating', 'stepped'] as const).map(
    (style): SymbolDef => ({
      type: `ceiling-${style}`,
      name: {
        flat: 'Flat drop ceiling',
        tray: 'Tray ceiling',
        cove: 'Cove ceiling',
        floating: 'Floating panel',
        stepped: 'Double step',
      }[style],
      category: 'Ceilings',
      width: 120,
      depth: 90,
      height: 0,
      ceilingStyle: style,
      render: (_w, _d, t) => ceilingIcon(style, t),
    }),
  ),
  {
    type: 'gypsum-box',
    name: 'Gypsum box',
    category: 'Ceilings',
    width: 120,
    depth: 60,
    height: 30,
    render: (w, d, t) => {
      const k = kit(t)
      const hatch = t.dark ? '#52525b' : '#d4d4d8'
      return (
        <>
          <rect x={-w / 2} y={-d / 2} width={w} height={d} {...k.s(hatch)} strokeDasharray="6 4" />
          <line x1={-w / 2} y1={-d / 2} x2={w / 2} y2={d / 2} {...k.thin} />
          <line x1={w / 2} y1={-d / 2} x2={-w / 2} y2={d / 2} {...k.thin} />
        </>
      )
    },
  },

  // ---------- Other ----------
  {
    type: 'stairs',
    name: 'Stairs',
    category: 'Other',
    width: 100,
    depth: 280,
    height: 280,
    render: (w, d, t) => {
      const k = kit(t)
      const steps = Math.max(2, Math.round(d / 28))
      return (
        <>
          {k.box(w, d)}
          {Array.from({ length: steps - 1 }, (_, i) => {
            const y = -d / 2 + ((i + 1) * d) / steps
            return <line key={i} x1={-w / 2} y1={y} x2={w / 2} y2={y} {...k.thin} />
          })}
          <path
            d={`M0,${d / 2 - 10} V${-d / 2 + 14} M-8,${-d / 2 + 26} L0,${-d / 2 + 12} L8,${-d / 2 + 26}`}
            {...k.line}
          />
        </>
      )
    },
  },
  {
    type: 'column',
    name: 'Column',
    keywords: 'pillar post',
    category: 'Other',
    width: 30,
    depth: 30,
    height: 250,
    fullHeight: true,
    render: (w, d, t) => kit(t).box(w, d, 0, t.wall),
  },
  {
    // A column partly built into a wall, standing out of it into the room.
    type: 'wall-post',
    name: 'Column in a wall',
    keywords: 'post pillar pilaster wall column',
    category: 'Other',
    width: 30,
    depth: 20,
    height: 250,
    wallMount: true,
    fullHeight: true,
    render: (w, d, t) => kit(t).box(w, d, 0, t.wall),
  },
  {
    type: 'label',
    name: 'Text label',
    category: 'Other',
    width: 120,
    depth: 30,
    height: 0,
    render: (_w, d, t, sym) => (
      <text
        x={0}
        y={0}
        fontSize={d}
        textAnchor="middle"
        dominantBaseline="central"
        fill={t.label}
        fontFamily="system-ui, sans-serif"
      >
        {sym?.label || 'Label'}
      </text>
    ),
  },
]

export const SYMBOL_MAP = new Map(SYMBOLS.map((d) => [d.type, d]))

export const CATEGORIES: SymbolCategory[] = [
  'Doors & Windows',
  'Lighting',
  'Ceilings',
  'Living',
  'Bedroom',
  'Kitchen',
  'Bathroom',
  'Electrical',
  'Other',
]
