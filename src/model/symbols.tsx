import type { ReactNode } from 'react'
import { lightHex } from './lighting'
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
  | 'People'
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
  /** What the `frames` choice is called (Frame, Color…). */
  frameLabel?: string
  /** Draw the symbol centered at the origin: x ∈ [-w/2, w/2], y ∈ [-d/2, d/2]. */
  render: (w: number, d: number, t: PlanTheme, sym?: PlanSymbol) => ReactNode
}

/** Cabinets with optional glass doors and LED lighting inside; display cabinets have glass doors unless told otherwise. */
export const CABINETS = new Set(['display-cabinet', 'sideboard', 'coffee-corner'])
export const hasGlass = (sym: PlanSymbol) => sym.glass ?? sym.type === 'display-cabinet'

export interface ItemStyle {
  id: string
  name: string
  kind: 'Modern' | 'Classic' | 'Industrial'
  /** How tall the item usually is in this style (cm): it's made that tall when the style is picked. */
  height?: number
}

/** Pendant light styles; the first is the default. */
export const PENDANT_STYLES: ItemStyle[] = [
  { id: 'cone', name: 'Cone', kind: 'Industrial' },
  { id: 'dome', name: 'Dome', kind: 'Modern' },
  { id: 'globe', name: 'Glass globe', kind: 'Modern' },
  { id: 'ring', name: 'LED ring', kind: 'Modern' },
  { id: 'cluster', name: 'Cluster of globes', kind: 'Modern' },
  { id: 'drum', name: 'Fabric drum', kind: 'Classic' },
  { id: 'lantern', name: 'Lantern', kind: 'Classic' },
  { id: 'bell', name: 'Glass bell', kind: 'Classic' },
]

export const CHANDELIER_STYLES: ItemStyle[] = [
  { id: 'classic', name: 'Classic arms', kind: 'Classic' },
  { id: 'crystal', name: 'Crystal tiers', kind: 'Classic' },
  { id: 'led-rings', name: 'LED rings', kind: 'Modern' },
  { id: 'led-tilted', name: 'Tilted LED rings', kind: 'Modern' },
  { id: 'led-cascade', name: 'LED cascade', kind: 'Modern' },
  { id: 'sputnik', name: 'Sputnik', kind: 'Modern' },
]

export const COFFEE_STYLES: ItemStyle[] = [
  { id: 'classic', name: 'Classic wood', kind: 'Classic' },
  { id: 'modern', name: 'Modern niche', kind: 'Modern' },
  { id: 'industrial', name: 'Industrial shelves', kind: 'Industrial' },
  { id: 'cart', name: 'Bar cart', kind: 'Classic' },
]

export const VANITY_STYLES: ItemStyle[] = [
  { id: 'integrated', name: 'Built-in basin', kind: 'Modern' },
  { id: 'vessel', name: 'Bowl on top', kind: 'Modern' },
]

/** Finishes bathroom vanities come in. */
export const VANITY_FINISHES: FrameColor[] = [
  { name: 'White', hex: '#f4f3ef' },
  { name: 'Oak', hex: '#c19a6b' },
  { name: 'Walnut', hex: '#6e4b33' },
  { name: 'Grey', hex: '#8d8f91' },
  { name: 'Sage', hex: '#93a28a' },
  { name: 'Black', hex: '#2c2c2e' },
]

/** Range hood styles: under a chimney up to the ceiling (against a wall or over an island), or built in. */
export const HOOD_STYLES: ItemStyle[] = [
  { id: 'pyramid', name: 'Pyramid chimney', kind: 'Modern', height: 45 },
  { id: 'box', name: 'Slim chimney', kind: 'Modern', height: 8 },
  { id: 'glass', name: 'Angled glass', kind: 'Modern', height: 40 },
  { id: 'built-in', name: 'Under a cabinet', kind: 'Modern', height: 15 },
  { id: 'island', name: 'Island', kind: 'Modern', height: 45 },
  { id: 'mantel', name: 'Mantel', kind: 'Classic', height: 60 },
]

export const HOOD_FINISHES: FrameColor[] = [
  { name: 'Steel', hex: '#c9ccd0' },
  { name: 'Black', hex: '#2c2c2e' },
  { name: 'White', hex: '#f4f3ef' },
  { name: 'Cream', hex: '#ece4d4' },
]

/** Dishwasher fronts: a panel like the kitchen's doors (built in), or the machine's own steel or black. */
export const DISHWASHER_FRONTS: FrameColor[] = [
  { name: 'Built in', hex: '#f4f3ef' },
  { name: 'Steel', hex: '#c9ccd0' },
  { name: 'Black', hex: '#2c2c2e' },
]

/** Where a kitchen island's stools go along its seating side (x, cm from its middle), one per 55 cm or so. */
export function islandStools(w: number) {
  const n = Math.max(1, Math.floor((w - 20) / 55))
  return Array.from({ length: n }, (_, i) => -w / 2 + (w * (i + 0.5)) / n)
}

/** How far a kitchen island's top overhangs its cabinets on the seating side (cm). */
export const islandOverhang = (d: number) => Math.min(30, d * 0.3)

/** Towel colors. */
export const TOWELS: FrameColor[] = [
  { name: 'White', hex: '#f4f2ee' },
  { name: 'Grey', hex: '#9a9c9e' },
  { name: 'Sage', hex: '#9fae98' },
  { name: 'Sand', hex: '#d8c3a5' },
  { name: 'Navy', hex: '#34435e' },
]

/** A bathroom vanity's sinks: how many (two only on wide ones), where along it, and their size (cm). */
export function vanitySinks(sym: Pick<PlanSymbol, 'width' | 'depth' | 'sinks'>) {
  const n = sym.sinks === 2 && sym.width >= 110 ? 2 : 1
  return { xs: n === 2 ? [-sym.width / 4, sym.width / 4] : [0], rx: Math.min((sym.width / n) * 0.32, 25), rz: Math.min(sym.depth * 0.3, 17), z: 2 }
}

export const DRESSING_STYLES: ItemStyle[] = [
  { id: 'classic', name: 'Framed mirror', kind: 'Classic' },
  { id: 'round', name: 'Round mirror', kind: 'Modern' },
  { id: 'hollywood', name: 'Hollywood bulbs', kind: 'Modern' },
]

/** Items that come in styles, and theirs (the first is the default). */
export const STYLES: Record<string, ItemStyle[]> = {
  pendant: PENDANT_STYLES,
  chandelier: CHANDELIER_STYLES,
  'coffee-corner': COFFEE_STYLES,
  'dressing-table': DRESSING_STYLES,
  'bath-vanity': VANITY_STYLES,
  'range-hood': HOOD_STYLES,
}

/** A dressing table's mirror: how wide and high, round or not, and the bottom of it above the table top (cm). */
export function vanityMirror(sym: PlanSymbol) {
  const style = styleOf(sym)
  if (style === 'round') {
    const r = Math.min(sym.width * 0.32, 38)
    return { round: true, w: r * 2, h: r * 2, bottom: 8 }
  }
  return { round: false, w: Math.min(sym.width * (style === 'hollywood' ? 0.8 : 0.7), 110), h: style === 'hollywood' ? 72 : 80, bottom: 2 }
}

export const styleOf = (sym: PlanSymbol) => sym.style ?? STYLES[sym.type]?.[0].id

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

export const CURTAIN_COLORS: FrameColor[] = [
  { name: 'Ivory', hex: '#efe9df' },
  { name: 'Linen', hex: '#d9cfbf' },
  { name: 'Sand', hex: '#c9b79c' },
  { name: 'Grey', hex: '#9ca3af' },
  { name: 'Charcoal', hex: '#4b5563' },
  { name: 'Navy', hex: '#1f2a44' },
  { name: 'Sage', hex: '#8a9a7b' },
  { name: 'Terracotta', hex: '#b4664a' },
]

export const BLIND_COLORS: FrameColor[] = [
  { name: 'White', hex: '#f4f4f2' },
  { name: 'Linen', hex: '#d9cfbf' },
  { name: 'Grey', hex: '#9ca3af' },
  { name: 'Charcoal', hex: '#3f4349' },
]

export type CurtainLayer = 'sheer' | 'blackout' | 'curtain'

/** A curtain's layers, from the window out: sheer, blackout, curtain (older plans had one fabric and maybe a sheer). */
export function curtainLayers(sym: PlanSymbol): CurtainLayer[] {
  const on = new Set<string>(sym.layers ?? [...(sym.sheer ? ['sheer'] : []), sym.fabric && sym.fabric !== 'screen' ? sym.fabric : 'curtain'])
  const out = (['sheer', 'blackout', 'curtain'] as const).filter((l) => on.has(l))
  return out.length ? out : ['curtain']
}

/** Curtains and blinds that are drawn shut as designed start shut in 3D (doors start open). */
export function startsShut(sym: PlanSymbol) {
  if (sym.type === 'curtain') return (sym.open ?? 0.7) <= 0.05
  if (sym.type === 'blind') return (sym.open ?? 0) <= 0.05
  return false
}

/**
 * How far a curtain panel reaches from its end of the track, covering `span` when closed (half the track for a pair,
 * all of it for one opening to one side): gathered at the end when open.
 */
export function panelWidth(span: number, open: number) {
  const stack = Math.min(span, Math.max(14, span * 0.2))
  return stack + (span - stack) * (1 - open)
}

/** A curtain's panels: each its end of the track (-1 left, +1 right) and the width it covers closed. */
export function curtainPanels(sym: PlanSymbol, w: number): { end: -1 | 1; span: number }[] {
  if (sym.openSide === 'left') return [{ end: -1, span: w }]
  if (sym.openSide === 'right') return [{ end: 1, span: w }]
  return [
    { end: -1, span: w / 2 },
    { end: 1, span: w / 2 },
  ]
}

/** The frame finish an item has: one of its type's, or a custom color. Null for items without a frame choice. */
export function frameOf(sym: PlanSymbol): FrameColor | null {
  const frames = SYMBOL_MAP.get(sym.type)?.frames
  if (!frames) return null
  if (!sym.frame) return frames[0]
  return frames.find((f) => f.hex.toLowerCase() === sym.frame!.toLowerCase()) ?? { name: 'Custom', hex: sym.frame }
}

const glow = (sym?: PlanSymbol) => lightHex(sym?.light)

/** How many seats fit along a sofa run (about 65 cm each), so longer sofas get more cushions, not wider ones. */
export const seatsAlong = (len: number) => Math.max(1, Math.round(len / 65))
/** Chairs along one side of a table (about 60 cm each). */
export const chairsAlong = (len: number) => Math.max(1, Math.floor((len + 10) / 60))
/** Sizes that stay the same however long a sofa gets. */
export const SOFA = { arm: 20, back: 22, seat: 95 }
const AMBER = '#f59e0b'

/** What a person wears on top (their trousers go with it). */
export const OUTFITS: FrameColor[] = [
  { name: 'Denim', hex: '#4f6f9c' },
  { name: 'White', hex: '#ecebe6' },
  { name: 'Terracotta', hex: '#b5543f' },
  { name: 'Olive', hex: '#6b7a4b' },
  { name: 'Black', hex: '#2b2c2f' },
  { name: 'Mustard', hex: '#c8973b' },
]

/** Skin tones for people. */
export const SKIN_TONES: FrameColor[] = [
  { name: 'Fair', hex: '#f2cfb0' },
  { name: 'Light', hex: '#e2b48f' },
  { name: 'Medium', hex: '#c68c62' },
  { name: 'Tan', hex: '#a26a43' },
  { name: 'Deep', hex: '#6f452b' },
]

/** A person seen from above: standing (shoulders, head, toes), sitting (legs forward) or lying (head at the back). */
function personGlyph(w: number, d: number, t: PlanTheme, sym?: PlanSymbol) {
  const k = kit(t)
  const H = sym?.height ?? 175
  const head = H * 0.06
  const body = k.s(t.fill2)
  const skin = k.s(t.fill)
  const top = -d / 2
  if (sym?.pose === 'lie') {
    return (
      <>
        {[-1, 1].map((s) => (
          <rect key={s} x={s * w * 0.17 - w * 0.14} y={top + H * 0.46} width={w * 0.28} height={H * 0.5} rx={w * 0.12} {...body} />
        ))}
        <rect x={-w / 2} y={top + H * 0.15} width={w} height={H * 0.34} rx={w * 0.25} {...body} />
        <circle cx={0} cy={top + head * 1.1} r={head} {...skin} />
      </>
    )
  }
  if (sym?.pose === 'sit') {
    const cy = top + w * 0.25
    const knee = cy + H * 0.245
    return (
      <>
        {[-1, 1].map((s) => (
          <g key={s}>
            <rect x={s * w * 0.18 - w * 0.08} y={knee - 2} width={w * 0.16} height={Math.max(4, d / 2 - knee + 2)} rx={w * 0.06} {...skin} />
            <rect x={s * w * 0.18 - w * 0.14} y={cy} width={w * 0.28} height={knee - cy} rx={w * 0.12} {...body} />
          </g>
        ))}
        <ellipse cx={0} cy={cy} rx={w / 2} ry={w * 0.25} {...body} />
        <circle cx={0} cy={cy} r={head} {...skin} />
      </>
    )
  }
  const cy = top + w * 0.25
  return (
    <>
      {[-1, 1].map((s) => (
        <ellipse key={s} cx={s * w * 0.18} cy={d / 2 - H * 0.045} rx={w * 0.09} ry={H * 0.045} {...skin} />
      ))}
      <ellipse cx={0} cy={cy} rx={w / 2} ry={w * 0.25} {...body} />
      <circle cx={0} cy={cy + 1} r={head} {...skin} />
    </>
  )
}

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
    // Hung from the ceiling (up in a curtain pocket if there's one) against a wall, floor to ceiling.
    type: 'curtain',
    name: 'Curtain',
    keywords: 'drape drapes sheer blackout',
    category: 'Doors & Windows',
    opens: true,
    width: 200,
    depth: 15,
    height: 250,
    wallMount: true,
    fullHeight: true,
    frames: CURTAIN_COLORS,
    frameLabel: 'Color',
    render: (w, d, t, sym) => {
      const k = kit(t)
      const layers = sym ? curtainLayers(sym) : (['curtain'] as CurtainLayer[])
      // A zig-zag for each panel of each layer, from its end of the track; sheers thinner.
      const folds = (x0: number, x1: number, y: number) => {
        const n = Math.max(2, Math.round(Math.abs(x1 - x0) / 7))
        return Array.from({ length: n + 1 }, (_, i) => `${i ? 'L' : 'M'}${x0 + ((x1 - x0) * i) / n},${y + (i % 2 ? 2.5 : -2.5)}`).join('')
      }
      return (
        <>
          {layers.map((l, i) => {
            const y = -d / 2 + ((i + 1) * d) / (layers.length + 1)
            const open = l === 'sheer' && layers.length > 1 ? 0 : (sym?.open ?? 0.7)
            const style = l === 'sheer' ? k.thin : k.line
            return (
              <g key={l}>
                {(sym ? curtainPanels(sym, w) : curtainPanels({ openSide: 'both' } as PlanSymbol, w)).map(({ end, span }) => (
                  <path key={end} d={folds((end * w) / 2, (end * w) / 2 - end * panelWidth(span, open), y)} {...style} strokeDasharray={l === 'sheer' ? '3 2' : undefined} />
                ))}
              </g>
            )
          })}
        </>
      )
    },
  },
  {
    // A roller blind hung from the ceiling against a wall (or a window); its height is how far down it reaches.
    type: 'blind',
    name: 'Roller blind',
    keywords: 'blackout shade screen roller blinds',
    category: 'Doors & Windows',
    opens: true,
    width: 120,
    depth: 8,
    height: 160,
    wallMount: true,
    frames: BLIND_COLORS,
    frameLabel: 'Color',
    render: (w, d, t) => {
      const k = kit(t)
      return (
        <>
          <rect x={-w / 2} y={-d / 2} width={w} height={d * 0.6} rx={1} {...k.s()} />
          <line x1={-w / 2 + 2} y1={-d / 2 + d * 0.8} x2={w / 2 - 2} y2={-d / 2 + d * 0.8} {...k.thin} strokeDasharray="4 3" />
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
    // A narrow table behind a sofa, a little lower than its back.
    type: 'sofa-table',
    name: 'Sofa table',
    keywords: 'console behind sofa table',
    category: 'Living',
    width: 150,
    depth: 35,
    height: 70,
    render: (w, d, t) => {
      const k = kit(t)
      return (
        <>
          {k.box(w, d, 2)}
          <line x1={-w / 2 + 6} y1={0} x2={w / 2 - 6} y2={0} {...k.thin} strokeDasharray="4 3" />
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
    type: 'display-cabinet',
    name: 'Display cabinet',
    keywords: 'china cabinet vitrine curio showcase glass antiques',
    category: 'Living',
    width: 120,
    depth: 45,
    height: 200,
    render: (w, d, t, sym) => {
      const k = kit(t)
      const n = Math.max(2, Math.round(w / 55))
      return (
        <>
          {k.box(w, d)}
          {Array.from({ length: n - 1 }, (_, i) => {
            const x = -w / 2 + (w * (i + 1)) / n
            return <line key={i} x1={x} y1={d / 2 - 10} x2={x} y2={d / 2} {...k.line} />
          })}
          <line x1={-w / 2 + 3} y1={-d / 2 + 4} x2={w / 2 - 3} y2={-d / 2 + 4} {...k.thin} />
          {sym && hasGlass(sym) && <line x1={-w / 2 + 3} y1={d / 2 - 2.5} x2={w / 2 - 3} y2={d / 2 - 2.5} {...k.thin} />}
          <circle cx={-w / 4} cy={0} r={Math.min(6, d / 6)} {...k.thin} fill="none" />
          <circle cx={w / 4} cy={0} r={Math.min(6, d / 6)} {...k.thin} fill="none" />
        </>
      )
    },
  },
  {
    type: 'sideboard',
    name: 'Sideboard',
    keywords: 'buffet credenza console cabinet',
    category: 'Living',
    width: 180,
    depth: 45,
    height: 85,
    render: (w, d, t, sym) => {
      const k = kit(t)
      const n = Math.max(2, Math.round(w / 50))
      return (
        <>
          {k.box(w, d, 2)}
          {Array.from({ length: n - 1 }, (_, i) => {
            const x = -w / 2 + (w * (i + 1)) / n
            return <line key={i} x1={x} y1={d / 2 - 10} x2={x} y2={d / 2} {...k.line} />
          })}
          {sym && hasGlass(sym) && <line x1={-w / 2 + 3} y1={d / 2 - 2.5} x2={w / 2 - 3} y2={d / 2 - 2.5} {...k.thin} />}
        </>
      )
    },
  },
  {
    type: 'coffee-corner',
    name: 'Coffee corner',
    keywords: 'coffee station bar espresso machine cart',
    category: 'Kitchen',
    width: 120,
    depth: 50,
    height: 220,
    render: (w, d, t, sym) => {
      const k = kit(t)
      const style = sym ? styleOf(sym) : 'classic'
      if (style === 'cart') {
        return (
          <>
            <rect x={-w / 2} y={-d / 2} width={w} height={d} rx={4} {...k.s()} />
            <rect x={-w / 2 + 4} y={-d / 2 + 4} width={w - 8} height={d - 8} rx={3} {...k.thin} fill="none" />
            {[-1, 1].map((s) => (
              <line key={s} x1={s * (w / 2 + 4)} y1={-d / 2 + 6} x2={s * (w / 2 + 4)} y2={d / 2 - 6} {...k.line} />
            ))}
          </>
        )
      }
      return (
        <>
          {k.box(w, d, 1)}
          {style === 'industrial' && [-1, 1].flatMap((sx) => [-1, 1].map((sy) => <circle key={`${sx}${sy}`} cx={sx * (w / 2 - 2)} cy={sy * (d / 2 - 2)} r={1.6} {...k.s(t.ink)} />))}
          {style === 'modern' && <line x1={-w / 2 + 4} y1={d / 2 - 3} x2={w / 2 - 4} y2={d / 2 - 3} {...k.thin} />}
          <rect x={-w / 2 + 6} y={-d / 2 + 4} width={30} height={Math.min(30, d - 10)} rx={3} {...k.s(t.fill2)} />
          <circle cx={-w / 2 + 21} cy={-d / 2 + 4 + Math.min(30, d - 10) / 2} r={4} {...k.thin} fill="none" />
          <circle cx={w / 6} cy={0} r={3.5} {...k.thin} fill="none" />
          <circle cx={w / 6 + 10} cy={0} r={3.5} {...k.thin} fill="none" />
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
    type: 'dressing-table',
    name: 'Dressing table',
    keywords: 'vanity makeup mirror dresser table stool',
    category: 'Bedroom',
    width: 110,
    depth: 45,
    height: 76,
    render: (w, d, t, sym) => {
      const k = kit(t)
      const m = vanityMirror(sym ?? ({ type: 'dressing-table', width: w } as PlanSymbol))
      return (
        <>
          {sym?.stool !== false && <circle cx={0} cy={d / 2 + 6} r={17} {...k.s(t.fill2)} />}
          {k.box(w, d, 2)}
          <line x1={-w / 2 + w * 0.32} y1={-d / 2 + 6} x2={-w / 2 + w * 0.32} y2={d / 2} {...k.thin} />
          <line x1={w / 2 - w * 0.32} y1={-d / 2 + 6} x2={w / 2 - w * 0.32} y2={d / 2} {...k.thin} />
          <rect x={-m.w / 2} y={-d / 2 + 1} width={m.w} height={4} rx={m.round ? 2 : 0.5} {...k.s(t.tint('#bae6fd'))} />
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
    // Seen from above, drawn dashed: it's overhead, over the counter.
    type: 'wall-cabinet',
    name: 'Upper cabinet',
    keywords: 'wall cabinet upper kitchen cupboard overhead glass open shelves',
    category: 'Kitchen',
    width: 80,
    depth: 35,
    height: 70,
    elevation: 145,
    wallMount: true,
    frames: VANITY_FINISHES,
    frameLabel: 'Finish',
    render: (w, d, t, sym) => {
      const k = kit(t)
      const n = Math.max(1, Math.round(w / 50))
      return (
        <>
          <rect x={-w / 2} y={-d / 2} width={w} height={d} {...k.s()} fillOpacity={0.5} strokeDasharray="6 4" />
          {sym?.fronts !== 'open' &&
            Array.from({ length: n - 1 }, (_, i) => {
              const x = -w / 2 + (w * (i + 1)) / n
              return <line key={i} x1={x} y1={d / 2 - 8} x2={x} y2={d / 2} {...k.thin} strokeDasharray="3 2" />
            })}
          {sym?.fronts === 'glass' && <line x1={-w / 2 + 3} y1={d / 2 - 2.5} x2={w / 2 - 3} y2={d / 2 - 2.5} {...k.thin} strokeDasharray="3 2" />}
        </>
      )
    },
  },
  {
    // Over the hob, drawn dashed; its chimney (the small box) goes up to the ceiling.
    type: 'range-hood',
    name: 'Range hood',
    keywords: 'range hood extractor cooker hood chimney kitchen exhaust vent',
    category: 'Kitchen',
    width: 90,
    depth: 50,
    height: 45,
    elevation: 155,
    wallMount: true,
    frames: HOOD_FINISHES,
    frameLabel: 'Finish',
    render: (w, d, t, sym) => {
      const k = kit(t)
      const style = sym ? styleOf(sym) : 'pyramid'
      const cw = Math.min(w * 0.35, 30)
      const cd = Math.min(d * 0.55, 26)
      const cy = style === 'island' ? 0 : -d / 2 + cd / 2
      const sloped = style === 'pyramid' || style === 'island' || style === 'mantel'
      return (
        <>
          <rect x={-w / 2} y={-d / 2} width={w} height={d} rx={1.5} {...k.s()} fillOpacity={0.5} strokeDasharray="6 4" />
          {sloped &&
            [
              [-1, -1],
              [1, -1],
              [1, 1],
              [-1, 1],
            ].map(([sx, sy]) => (
              <line key={`${sx}${sy}`} x1={(sx * w) / 2} y1={(sy * d) / 2} x2={(sx * cw) / 2} y2={cy + (sy * cd) / 2} {...k.thin} />
            ))}
          {style !== 'built-in' && <rect x={-cw / 2} y={cy - cd / 2} width={cw} height={cd} {...k.s(t.fill2)} />}
          {style === 'built-in' && <line x1={-w / 2 + 4} y1={d / 2 - 6} x2={w / 2 - 4} y2={d / 2 - 6} {...k.thin} />}
        </>
      )
    },
  },
  {
    type: 'dishwasher',
    name: 'Dishwasher',
    keywords: 'dishwasher dish washer appliance built-in',
    category: 'Kitchen',
    width: 60,
    depth: 60,
    height: 90,
    frames: DISHWASHER_FRONTS,
    frameLabel: 'Front',
    render: (w, d, t) => {
      const k = kit(t)
      return (
        <>
          {k.box(w, d)}
          <line x1={-w / 2} y1={d / 2 - 4} x2={w / 2} y2={d / 2 - 4} {...k.thin} />
          <text x={0} y={4} fontSize={Math.min(w, d) / 3.5} textAnchor="middle" fill={t.ink} fontFamily="sans-serif">
            DW
          </text>
        </>
      )
    },
  },
  {
    // A tall unit: drawers, an oven at a comfortable height and a microwave or second oven above it, a cupboard on top.
    type: 'oven-tower',
    name: 'Oven tower',
    keywords: 'oven tower tall unit built-in oven microwave column housing',
    category: 'Kitchen',
    width: 60,
    depth: 60,
    height: 220,
    frames: VANITY_FINISHES,
    frameLabel: 'Finish',
    render: (w, d, t) => {
      const k = kit(t)
      return (
        <>
          {k.box(w, d)}
          <line x1={-w / 2} y1={-d / 2} x2={w / 2} y2={d / 2 - 6} {...k.thin} />
          <line x1={-w / 2} y1={d / 2 - 6} x2={w / 2} y2={-d / 2} {...k.thin} />
          <line x1={-w / 2} y1={d / 2 - 6} x2={w / 2} y2={d / 2 - 6} {...k.line} />
        </>
      )
    },
  },
  {
    // Cabinets on the cooking side (its back), the top overhanging the other side for stools.
    type: 'kitchen-island',
    name: 'Kitchen island',
    keywords: 'kitchen island breakfast bar counter stools peninsula',
    category: 'Kitchen',
    width: 200,
    depth: 100,
    height: 90,
    frames: VANITY_FINISHES,
    frameLabel: 'Finish',
    render: (w, d, t, sym) => {
      const k = kit(t)
      const over = islandOverhang(d)
      const work = d - over
      const cz = -d / 2 + work / 2
      return (
        <>
          {sym?.stool !== false && islandStools(w).map((x) => <circle key={x} cx={x} cy={d / 2 + 8} r={17} {...k.s()} />)}
          {k.box(w, d, 2)}
          <line x1={-w / 2} y1={d / 2 - over} x2={w / 2} y2={d / 2 - over} {...k.thin} strokeDasharray="4 3" />
          {sym?.islandTop === 'sink' && (
            <rect x={-Math.min(w - 20, 72) / 2} y={cz - Math.min(work - 20, 42) / 2} width={Math.min(w - 20, 72)} height={Math.min(work - 20, 42)} rx={5} {...k.s(t.fill2)} />
          )}
          {sym?.islandTop === 'hob' &&
            [
              [-1, -1],
              [1, -1],
              [-1, 1],
              [1, 1],
            ].map(([a, b]) => <circle key={`${a}${b}`} cx={a * 14} cy={cz + b * 12} r={7} {...k.line} />)}
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
    type: 'bath-vanity',
    name: 'Bathroom vanity',
    keywords: 'vanity sink basin washbasin bathroom cabinet mirror cabinet double sink unit',
    category: 'Bathroom',
    width: 80,
    depth: 48,
    height: 85,
    wallMount: true,
    frames: VANITY_FINISHES,
    frameLabel: 'Finish',
    render: (w, d, t, sym) => {
      const k = kit(t)
      const s = vanitySinks({ width: w, depth: d, sinks: sym?.sinks })
      return (
        <>
          {k.box(w, d, 2)}
          {(sym?.mirror ?? 'cabinet') === 'cabinet' && <rect x={-w / 2 + 1} y={-d / 2 + 1} width={w - 2} height={14} {...k.thin} strokeDasharray="4 3" />}
          {s.xs.map((x) => (
            <g key={x}>
              <ellipse cx={x} cy={s.z} rx={s.rx} ry={s.rz} {...k.s(t.fill2)} />
              <circle cx={x} cy={s.z - s.rz - 4} r={2} {...k.s(t.ink)} />
            </g>
          ))}
        </>
      )
    },
  },
  {
    // A recess in the wall (tiled like it), with a sill; part of the wall's depth.
    type: 'shower-niche',
    name: 'Shower niche',
    keywords: 'niche recess shelf shower bathroom alcove wall',
    category: 'Bathroom',
    width: 30,
    depth: 10,
    height: 60,
    sill: 110,
    wall: true,
    render: (w, d, t, sym) => {
      const k = kit(t)
      const r = Math.max(2, Math.min(9, d - 3))
      return (
        <>
          {k.opening(w, d)}
          <rect x={-w / 2} y={-d / 2} width={w} height={d - r} fill={t.wall} stroke="none" />
          <rect x={-w / 2} y={d / 2 - r} width={w} height={r} {...k.s()} />
          {sym?.shelf && <line x1={-w / 2} y1={d / 2 - r / 2} x2={w / 2} y2={d / 2 - r / 2} {...k.thin} strokeDasharray="3 2" />}
        </>
      )
    },
  },
  {
    type: 'towel-rail',
    name: 'Towel rail',
    keywords: 'towel bar rail holder bathroom hook',
    category: 'Bathroom',
    width: 60,
    depth: 10,
    height: 6,
    wallMount: true,
    elevation: 110,
    frames: TOWELS,
    frameLabel: 'Towel',
    render: (w, d, t) => {
      const k = kit(t)
      return (
        <>
          {[-1, 1].map((s) => (
            <rect key={s} x={s * (w / 2 - 3) - 1.5} y={-d / 2} width={3} height={d - 2} {...k.s()} />
          ))}
          <rect x={-w / 2} y={d / 2 - 3} width={w} height={2.5} rx={1.2} {...k.s(t.fill2)} />
        </>
      )
    },
  },
  {
    type: 'towel-radiator',
    name: 'Heated towel rail',
    keywords: 'towel radiator ladder heated warmer rail bathroom',
    category: 'Bathroom',
    width: 50,
    depth: 10,
    height: 120,
    wallMount: true,
    elevation: 15,
    frames: TOWELS,
    frameLabel: 'Towel',
    render: (w, d, t) => {
      const k = kit(t)
      return (
        <>
          <rect x={-w / 2} y={-d / 2 + 2} width={w} height={d - 2} rx={1.5} {...k.s()} />
          {[-1, 1].map((s) => (
            <circle key={s} cx={s * (w / 2 - 2)} cy={d / 2 - 3} r={1.8} {...k.s(t.fill2)} />
          ))}
          <line x1={-w / 2 + 2} y1={d / 2 - 3} x2={w / 2 - 2} y2={d / 2 - 3} {...k.line} />
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
    type: 'ac-split',
    name: 'Wall AC',
    keywords: 'ac aircon air conditioning conditioner split unit hvac cooling heating',
    category: 'Electrical',
    width: 90,
    depth: 22,
    height: 30,
    wallMount: true,
    elevation: 210,
    render: (w, d, t) => {
      const k = kit(t)
      // The unit, and the air it blows into the room.
      return (
        <>
          {k.box(w, d, 4)}
          <line x1={-w / 2 + 6} y1={d / 2 - 5} x2={w / 2 - 6} y2={d / 2 - 5} {...k.thin} />
          {[-0.3, 0, 0.3].map((f) => (
            <line key={f} x1={f * w} y1={d / 2 + 4} x2={f * w * 1.6} y2={d / 2 + 34} {...k.thin} strokeDasharray="4 4" />
          ))}
        </>
      )
    },
  },
  {
    type: 'ac-cassette',
    name: 'Ceiling AC',
    keywords: 'ac aircon air conditioning conditioner cassette ceiling 4 way hvac cooling',
    category: 'Electrical',
    width: 70,
    depth: 70,
    height: 25,
    render: (w, d, t) => {
      const k = kit(t)
      const s = Math.min(w, d) * 0.36
      return (
        <>
          {k.box(w, d, 3)}
          <rect x={-w * 0.25} y={-d * 0.25} width={w * 0.5} height={d * 0.5} {...k.thin} />
          {[-1, 1].map((v) => (
            <g key={v}>
              <rect x={-s / 2} y={v * (d / 2 - 7) - 2} width={s} height={4} {...k.s(t.fill2)} />
              <rect x={v * (w / 2 - 7) - 2} y={-s / 2} width={4} height={s} {...k.s(t.fill2)} />
            </g>
          ))}
        </>
      )
    },
  },
  {
    type: 'ac-slot',
    name: 'AC slot diffuser',
    keywords: 'ac aircon air conditioning ducted concealed linear slot diffuser grille hvac',
    category: 'Electrical',
    width: 150,
    depth: 12,
    height: 5,
    render: (w, d, t) => {
      const k = kit(t)
      return (
        <>
          {k.box(w, d, 1)}
          {[-1, 1].map((v) => (
            <line key={v} x1={-w / 2 + 3} y1={(v * d) / 5} x2={w / 2 - 3} y2={(v * d) / 5} {...k.line} />
          ))}
        </>
      )
    },
  },
  {
    type: 'ac-floor',
    name: 'Floor AC',
    keywords: 'ac aircon air conditioning conditioner floor standing tower cabinet hvac cooling',
    category: 'Electrical',
    width: 50,
    depth: 32,
    height: 180,
    render: (w, d, t) => {
      const k = kit(t)
      return (
        <>
          {k.box(w, d, 6)}
          {[-0.25, 0, 0.25].map((f) => (
            <line key={f} x1={f * w} y1={d / 2 - 2} x2={f * w} y2={d / 2 - 9} {...k.thin} />
          ))}
        </>
      )
    },
  },
  {
    type: 'ac-outdoor',
    name: 'Outdoor AC',
    keywords: 'ac aircon air conditioning outdoor unit condenser compressor balcony hvac',
    category: 'Electrical',
    width: 85,
    depth: 32,
    height: 60,
    render: (w, d, t) => {
      const k = kit(t)
      const r = Math.min(w * 0.3, d * 0.42)
      return (
        <>
          {k.box(w, d, 2)}
          <circle cx={-w * 0.12} cy={0} r={r} {...k.thin} />
          <line x1={-w * 0.12 - r} y1={0} x2={-w * 0.12 + r} y2={0} {...k.thin} />
          <line x1={-w * 0.12} y1={-r} x2={-w * 0.12} y2={r} {...k.thin} />
        </>
      )
    },
  },
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
    // The LED in a room's curtain pockets, lighting the curtains; added from the room's ceiling settings.
    type: 'pocket-light',
    name: 'Curtain pocket light',
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
    keywords: 'hanging lamp dome globe ring cluster drum lantern bell',
    render: (w, _d, t, sym) => {
      const k = kit(t)
      const r = w / 2
      const style = sym?.style ?? 'cone'
      if (style === 'cluster') {
        return (
          <>
            <circle cx={0} cy={0} r={r} {...k.thin} strokeDasharray="4 3" fill="none" />
            {[0, 1, 2, 3, 4].map((i) => {
              const a = (i / 5) * Math.PI * 2
              return <circle key={i} cx={Math.cos(a) * r * 0.55} cy={Math.sin(a) * r * 0.55} r={r * 0.25} {...k.s(glow(sym))} />
            })}
          </>
        )
      }
      if (style === 'lantern') {
        return (
          <>
            <rect x={-r} y={-r} width={w} height={w} {...k.s()} strokeDasharray="4 3" />
            <rect x={-r * 0.55} y={-r * 0.55} width={r * 1.1} height={r * 1.1} {...k.s(glow(sym))} />
          </>
        )
      }
      return (
        <>
          <circle cx={0} cy={0} r={r} {...k.s()} strokeDasharray={style === 'globe' || style === 'drum' ? undefined : '4 3'} />
          {style === 'ring' ? (
            <circle cx={0} cy={0} r={r * 0.8} fill="none" stroke={glow(sym)} strokeWidth={3} vectorEffect="non-scaling-stroke" />
          ) : (
            <circle cx={0} cy={0} r={style === 'globe' || style === 'drum' ? r * 0.7 : w / 5} {...k.s(glow(sym))} />
          )}
          {(style === 'cone' || style === 'dome') && (
            <>
              <line x1={-r} y1={0} x2={r} y2={0} {...k.thin} />
              <line x1={0} y1={-r} x2={0} y2={r} {...k.thin} />
            </>
          )}
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
    keywords: 'crystal led rings cascade sputnik',
    render: (w, _d, t, sym) => {
      const k = kit(t)
      const r = w / 2
      const style = sym ? styleOf(sym) : 'classic'
      if (style === 'led-rings' || style === 'led-tilted') {
        return (
          <>
            {[1, 0.72, 0.46].map((f, i) =>
              style === 'led-rings' ? (
                <circle key={i} cx={0} cy={0} r={r * f} fill="none" stroke={glow(sym)} strokeWidth={2.5} vectorEffect="non-scaling-stroke" />
              ) : (
                <ellipse key={i} cx={0} cy={0} rx={r * f} ry={r * f * 0.45} transform={`rotate(${i * 60})`} fill="none" stroke={glow(sym)} strokeWidth={2.5} vectorEffect="non-scaling-stroke" />
              ),
            )}
          </>
        )
      }
      if (style === 'led-cascade' || style === 'crystal') {
        return (
          <>
            <circle cx={0} cy={0} r={r} {...k.thin} strokeDasharray="4 3" />
            {Array.from({ length: 14 }, (_, i) => {
              const a = i * 2.4
              const rr = r * (0.2 + 0.75 * ((i + 1) / 14))
              return <circle key={i} cx={Math.cos(a) * rr} cy={Math.sin(a) * rr} r={r * 0.06} {...k.s(style === 'crystal' ? t.fill : glow(sym))} />
            })}
          </>
        )
      }
      if (style === 'sputnik') {
        return (
          <>
            {Array.from({ length: 12 }, (_, i) => {
              const a = (i / 12) * Math.PI * 2
              return (
                <g key={i}>
                  <line x1={0} y1={0} x2={Math.cos(a) * r * 0.9} y2={Math.sin(a) * r * 0.9} {...k.line} />
                  <circle cx={Math.cos(a) * r * 0.9} cy={Math.sin(a) * r * 0.9} r={r * 0.09} {...k.s(glow(sym))} />
                </g>
              )
            })}
            <circle cx={0} cy={0} r={r * 0.12} {...k.s()} />
          </>
        )
      }
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
    type: 'person',
    name: 'Person',
    keywords: 'people human man woman child figure scale body',
    category: 'People',
    width: 45,
    depth: 30,
    height: 175,
    frames: OUTFITS,
    frameLabel: 'Outfit',
    render: (w, d, t, sym) => personGlyph(w, d, t, sym),
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

/** Light fixtures and cabinets with LEDs: the items with light settings. */
export function givesLight(sym: PlanSymbol) {
  const f = SYMBOL_MAP.get(sym.type)?.fixture
  return (!!f && f !== 'switch') || !!sym.led
}

export const CATEGORIES: SymbolCategory[] = [
  'Doors & Windows',
  'Lighting',
  'Ceilings',
  'Living',
  'Bedroom',
  'Kitchen',
  'Bathroom',
  'Electrical',
  'People',
  'Other',
]
