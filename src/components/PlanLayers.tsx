import { memo } from 'react'
import {
  add,
  area,
  dist,
  inwardNormal,
  labelPoint,
  mul,
  normalize,
  polygonPath,
  signedArea,
  sub,
} from '@/model/geometry'
import { floorLayout } from '@/model/floors'
import { ceilingLight, ceilingRoom, ceilingZones, covePath, coveRuns, pocketWidth, SHADOW_GAP, WIRE_COLORS } from '@/model/lighting'
import { dimensionPoints, isOutdoor, railingRuns, roomOuter, symbolPose } from '@/model/project'
import { SYMBOL_MAP } from '@/model/symbols'
import type { PlanTheme } from '@/model/theme'
import { formatArea, formatLength } from '@/model/units'
import type { Dimension, Floor, PlanLayer, PlanSymbol, Point, Room, Units } from '@/model/types'

interface Props {
  floor: Floor
  units: Units
  theme: PlanTheme
  /** Screen pixels per cm; used to keep label sizes constant on screen. */
  scale: number
  showWallLengths?: boolean
  showAreas?: boolean
  /** Room names, areas and wall lengths. */
  showLabels?: boolean
  showDimensions?: boolean
  /** 'lighting' shows the ceiling plan: gypsum, fixtures and switch wiring, with furniture faded. */
  layer?: PlanLayer
  /** While wiring: the switch whose connections are emphasized. */
  activeSwitch?: string | null
  ghost?: boolean
  /** Rendering for PDF: no invisible hit areas or effects the PDF converter can't reproduce. */
  forPrint?: boolean
  /** Library categories (and 'Dimensions') shown faded and not clickable, to work around them. */
  faded?: string[]
}

const FADE = 0.15

function wallPath(room: Room) {
  return polygonPath(roomOuter(room)) + polygonPath(room.points)
}

const SymbolGraphic = memo(function SymbolGraphic({
  sym,
  rooms,
  theme,
  forPrint,
  faded,
}: {
  sym: PlanSymbol
  rooms: Room[]
  theme: PlanTheme
  forPrint?: boolean
  faded?: boolean
}) {
  const def = SYMBOL_MAP.get(sym.type)
  const pose = symbolPose(sym, rooms)
  const depth = pose.wallThickness ?? sym.depth
  const sx = sym.flipX ? -1 : 1
  const sy = sym.flipY ? -1 : 1
  return (
    <g
      data-kind="symbol"
      data-id={sym.id}
      transform={`translate(${pose.x},${pose.y}) rotate(${pose.rotation}) scale(${sx},${sy})`}
      opacity={faded ? FADE : undefined}
      pointerEvents={faded ? 'none' : undefined}
    >
      {!forPrint && <rect x={-sym.width / 2} y={-depth / 2} width={sym.width} height={depth} fill="transparent" />}
      {def ? (
        def.render(sym.width, depth, theme, sym)
      ) : (
        <rect x={-sym.width / 2} y={-depth / 2} width={sym.width} height={depth} fill="#f87171" />
      )}
    </g>
  )
})

/**
 * A balcony's or terrace's open edges: a thin railing band (a filled one for a solid parapet), or
 * just a dashed edge when there's no railing.
 */
function Railings({ room, rooms, theme }: { room: Room; rooms: Room[]; theme: PlanTheme }) {
  const sa = signedArea(room.points)
  const style = room.railing?.style
  const solid = style === 'solid'
  const runs = railingRuns(room, rooms)
  if (style === 'none') {
    return (
      <g data-kind="room" data-id={room.id}>
        {runs.map(({ a, b }, i) => (
          <line key={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={theme.ink} strokeWidth={1} strokeDasharray="6 4" vectorEffect="non-scaling-stroke" />
        ))}
      </g>
    )
  }
  return (
    <g data-kind="room" data-id={room.id}>
      {runs.map(({ a, b }, i) => {
        const out = mul(inwardNormal(a, b, sa), -room.wallThickness)
        return (
          <path
            key={i}
            d={polygonPath([a, b, add(b, out), add(a, out)])}
            fill={solid ? theme.wall : theme.paper}
            stroke={theme.ink}
            strokeWidth={solid ? 0 : 0.9}
            vectorEffect="non-scaling-stroke"
          />
        )
      })}
    </g>
  )
}

/** A hidden LED running around its room's ceiling (only along the walls it's on for). */
function CoveLight({ sym, room, scale, forPrint }: { sym: PlanSymbol; room: Room; scale: number; forPrint?: boolean }) {
  const { runs } = coveRuns(room, ceilingLight(sym, room))
  const color = sym.light?.color === 'cool' ? '#60a5fa' : sym.light?.color === 'white' ? '#eab308' : '#f59e0b'
  const d = runs.map(({ a, b }) => `M${a.x},${a.y}L${b.x},${b.y}`).join('')
  if (!d) return null
  return (
    <g data-kind="symbol" data-id={sym.id}>
      {!forPrint && <path d={d} fill="none" stroke="transparent" strokeWidth={14 / scale} />}
      <path d={d} fill="none" stroke={color} strokeWidth={2.5} strokeDasharray="5 4" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
    </g>
  )
}

/** Shadow gaps: a dark groove along the walls where they meet the ceiling (ceiling plan). */
function ShadowGaps({ room, theme }: { room: Room; theme: PlanTheme }) {
  // A curtain pocket, or a hidden light's gap, on the same wall takes its place.
  const pockets = new Set([...(room.ceiling && room.ceiling.style !== 'floating' ? (room.curtainPockets ?? []) : []), ...(room.hiddenGaps ?? [])])
  const gaps = room.shadowGaps?.filter((i) => !pockets.has(i))
  if (!gaps?.length) return null
  const pts = room.points
  const sa = signedArea(pts)
  return (
    <g pointerEvents="none">
      {gaps.map((i) => {
        const a = pts[i]
        const b = pts[(i + 1) % pts.length]
        if (!a || !b) return null
        const n = mul(inwardNormal(a, b, sa), SHADOW_GAP.width)
        const quad = [a, b, add(b, n), add(a, n)]
        return <path key={i} d={polygonPath(quad)} fill={theme.ink} fillOpacity={0.75} />
      })}
    </g>
  )
}

/** Curtain pockets: a strip along the wall where the gypsum ceiling stops short, with the curtain track in it. */
function CurtainPockets({ room, theme }: { room: Room; theme: PlanTheme }) {
  const pockets = room.ceiling && room.ceiling.style !== 'floating' ? room.curtainPockets : undefined
  // A hidden light's gap too, where there's no pocket.
  const hidden = (room.hiddenGaps ?? []).filter((i) => !pockets?.includes(i))
  if (!pockets?.length && !hidden.length) return null
  const pts = room.points
  const sa = signedArea(pts)
  return (
    <g pointerEvents="none">
      {hidden.map((i) => {
        const a = pts[i]
        const b = pts[(i + 1) % pts.length]
        if (!a || !b) return null
        const n = mul(inwardNormal(a, b, sa), room.hiddenGapWidth ?? 10)
        return <path key={`h${i}`} d={polygonPath([a, b, add(b, n), add(a, n)])} fill={theme.paper} stroke={theme.ink} strokeWidth={1} vectorEffect="non-scaling-stroke" />
      })}
      {(pockets ?? []).map((i) => {
        const w = pocketWidth(room)
        const a = pts[i]
        const b = pts[(i + 1) % pts.length]
        if (!a || !b) return null
        const n = inwardNormal(a, b, sa)
        const quad = [a, b, add(b, mul(n, w)), add(a, mul(n, w))]
        const m1 = add(a, mul(n, w / 2))
        const m2 = add(b, mul(n, w / 2))
        return (
          <g key={i}>
            <path d={polygonPath(quad)} fill={theme.paper} stroke={theme.ink} strokeWidth={1} vectorEffect="non-scaling-stroke" />
            <line x1={m1.x} y1={m1.y} x2={m2.x} y2={m2.y} stroke={theme.ink} strokeWidth={1} strokeDasharray="8 3 2 3" vectorEffect="non-scaling-stroke" />
          </g>
        )
      })}
    </g>
  )
}

/** A room's floor finish on the plan: its tiles' or planks' joints as faint lines, laid from the room's corner. */
function FloorFinish({ room, theme }: { room: Room; theme: PlanTheme }) {
  const layout = room.floor && floorLayout(room.floor)
  if (!layout) return null
  const [bw, bh] = layout.block
  const xs = room.points.map((p) => p.x)
  const ys = room.points.map((p) => p.y)
  const id = `floor-${room.id}`
  return (
    <g pointerEvents="none">
      <defs>
        <pattern
          id={id}
          width={bw}
          height={bh}
          patternUnits="userSpaceOnUse"
          patternTransform={`translate(${Math.min(...xs)} ${Math.min(...ys)}) rotate(${layout.angle})`}
        >
          {layout.pieces.flatMap((p) =>
            [-bw, 0, bw].flatMap((dx) =>
              [-bh, 0, bh].map((dy) => (
                <path
                  key={`${p.id}-${p.pts[0].x}-${p.pts[0].y}-${dx}-${dy}`}
                  d={polygonPath(p.pts.map((q) => ({ x: q.x + dx, y: q.y + dy })))}
                  fill="none"
                  stroke={theme.ink}
                  strokeOpacity={0.22}
                  strokeWidth={0.8}
                  vectorEffect="non-scaling-stroke"
                />
              )),
            ),
          )}
        </pattern>
      </defs>
      <path d={polygonPath(room.points)} fill={`url(#${id})`} />
    </g>
  )
}

function uprightAngle(deg: number) {
  return deg > 90 || deg < -90 ? deg + 180 : deg
}

function RoomLabels({
  room,
  units,
  scale,
  theme,
  showWallLengths,
  showAreas,
}: { room: Room } & Pick<Props, 'units' | 'scale' | 'theme' | 'showWallLengths' | 'showAreas'>) {
  const fs = 12 / scale
  const pts = room.points
  const sa = signedArea(pts)
  const lp = labelPoint(pts)
  return (
    <g pointerEvents="none" fontFamily="system-ui, sans-serif" fill={theme.label}>
      <text x={lp.x} y={lp.y} fontSize={fs * 1.15} fontWeight={600} textAnchor="middle">
        {room.name}
      </text>
      {showAreas && (
        <text x={lp.x} y={lp.y + fs * 1.4} fontSize={fs} textAnchor="middle" fill={theme.labelMuted}>
          {formatArea(area(pts), units)}
        </text>
      )}
      {showWallLengths &&
        pts.map((a, i) => {
          const b = pts[(i + 1) % pts.length]
          const L = dist(a, b)
          if (L * scale < 40) return null
          const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
          const pos = add(mid, mul(inwardNormal(a, b, sa), fs * 1.1))
          const ang = uprightAngle((Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI)
          return (
            <text
              key={i}
              x={pos.x}
              y={pos.y}
              fontSize={fs * 0.9}
              textAnchor="middle"
              dominantBaseline="central"
              fill={theme.lengthLabel}
              transform={`rotate(${ang},${pos.x},${pos.y})`}
            >
              {formatLength(L, units)}
            </text>
          )
        })}
    </g>
  )
}

/** Gypsum ceiling zones of one room (lighting layer). */
function CeilingZones({ room, theme }: { room: Room; theme: PlanTheme }) {
  const fill = theme.dark ? '#71717a' : '#a1a1aa'
  return (
    <g pointerEvents="none">
      {ceilingZones(room).map((z, i) => (
        <g key={i}>
          <path
            d={polygonPath(z.outer) + (z.inner ? polygonPath(z.inner) : '')}
            fill={fill}
            fillOpacity={0.22 + i * 0.08}
            fillRule="evenodd"
          />
          <path
            d={polygonPath(z.inner ?? z.outer)}
            fill="none"
            stroke={theme.ink}
            strokeWidth={1}
            strokeDasharray="6 4"
            vectorEffect="non-scaling-stroke"
          />
        </g>
      ))}
    </g>
  )
}

/** Where a wire should end on a light: its center, or for cove lights the nearest point of the strip. */
function wireEnd(sym: PlanSymbol, floor: Floor, from: Point): Point {
  if (sym.room) {
    const plain = floor.rooms.find((r) => r.id === sym.room)
    if (plain) {
      const room = ceilingRoom(plain, floor)
      const { path } = covePath(room, ceilingLight(sym, room))
      let best = path[0]
      for (const p of path) if (dist(p, from) < dist(best, from)) best = p
      return best
    }
  }
  return symbolPose(sym, floor.rooms)
}

function Wiring({ floor, scale, activeSwitch }: { floor: Floor; scale: number; activeSwitch?: string | null }) {
  const switches = floor.symbols.filter((s) => s.type === 'switch')
  const byId = new Map(floor.symbols.map((s) => [s.id, s]))
  return (
    <g pointerEvents="none">
      {switches.map((sw, i) => {
        const color = WIRE_COLORS[i % WIRE_COLORS.length]
        const from = symbolPose(sw, floor.rooms)
        const dim = activeSwitch && activeSwitch !== sw.id
        return (
          <g key={sw.id} opacity={dim ? 0.25 : 1}>
            {(sw.controls ?? []).map((id) => {
              const light = byId.get(id)
              if (!light) return null
              const to = wireEnd(light, floor, from)
              const L = dist(from, to)
              if (L < 1) return null
              const n = normalize({ x: -(to.y - from.y), y: to.x - from.x })
              const c = add(mul(add(from, to), 0.5), mul(n, L * 0.18))
              return (
                <g key={id}>
                  <path
                    d={`M${from.x},${from.y} Q${c.x},${c.y} ${to.x},${to.y}`}
                    fill="none"
                    stroke={color}
                    strokeWidth={activeSwitch === sw.id ? 2.5 : 1.6}
                    strokeDasharray="7 4"
                    vectorEffect="non-scaling-stroke"
                  />
                  <circle cx={to.x} cy={to.y} r={3.5 / scale} fill={color} />
                </g>
              )
            })}
            <circle cx={from.x} cy={from.y} r={4 / scale} fill={color} />
          </g>
        )
      })}
    </g>
  )
}

function SwitchLabels({ floor, scale, theme, forPrint }: { floor: Floor; scale: number; theme: PlanTheme; forPrint?: boolean }) {
  const fs = 11 / scale
  return (
    <g pointerEvents="none" fontFamily="system-ui, sans-serif" fontWeight={600} fill={theme.label}>
      {floor.symbols
        .filter((s) => s.type === 'switch')
        .map((s, i) => {
          // Place the name inside the room, away from the wall the switch is on.
          const p = symbolPose(s, floor.rooms)
          const r = (p.rotation * Math.PI) / 180
          const at = add(p, mul({ x: -Math.sin(r), y: Math.cos(r) }, fs * 1.7))
          return (
            <text
              key={s.id}
              x={at.x}
              y={at.y}
              fontSize={fs}
              textAnchor="middle"
              dominantBaseline="central"
              fill={WIRE_COLORS[i % WIRE_COLORS.length]}
              {...(forPrint ? {} : { stroke: theme.paper, strokeWidth: 3, paintOrder: 'stroke', vectorEffect: 'non-scaling-stroke' })}
            >
              {s.label || `S${i + 1}`}
            </text>
          )
        })}
    </g>
  )
}

export function DimensionGraphic({
  d,
  units,
  scale,
  theme,
  forPrint,
}: {
  d: Dimension
  units: Units
  scale: number
  theme: PlanTheme
  forPrint?: boolean
}) {
  const [p, q] = dimensionPoints(d)
  const L = dist(d.a, d.b)
  if (L < 1) return null
  const dir = normalize(sub(d.b, d.a))
  const n = { x: dir.y, y: -dir.x }
  const side = d.offset >= 0 ? 1 : -1
  const gap = 4 / scale
  const over = 5 / scale
  const tick = 5 / scale
  const fs = 11 / scale
  const ext = (from: Point, to: Point) => {
    const s = add(from, mul(n, side * Math.min(gap, Math.abs(d.offset))))
    const e = add(to, mul(n, side * over))
    return <line x1={s.x} y1={s.y} x2={e.x} y2={e.y} />
  }
  const slash = (c: Point) => {
    const v = normalize(add(dir, n))
    return <line x1={c.x - v.x * tick} y1={c.y - v.y * tick} x2={c.x + v.x * tick} y2={c.y + v.y * tick} strokeWidth={1.8} />
  }
  const mid = add(mul(add(p, q), 0.5), mul(n, side * fs * 0.7))
  const ang = uprightAngle((Math.atan2(dir.y, dir.x) * 180) / Math.PI)
  return (
    <g data-kind="dimension" data-id={d.id}>
      {!forPrint && <line x1={p.x} y1={p.y} x2={q.x} y2={q.y} stroke="transparent" strokeWidth={12 / scale} />}
      <g stroke={theme.ink} strokeWidth={1} vectorEffect="non-scaling-stroke" fill="none">
        {ext(d.a, p)}
        {ext(d.b, q)}
        <line x1={p.x - dir.x * over} y1={p.y - dir.y * over} x2={q.x + dir.x * over} y2={q.y + dir.y * over} />
        {slash(p)}
        {slash(q)}
      </g>
      <text
        x={mid.x}
        y={mid.y}
        fontSize={fs}
        fontFamily="system-ui, sans-serif"
        fontWeight={500}
        textAnchor="middle"
        dominantBaseline="central"
        fill={theme.label}
        transform={`rotate(${ang},${mid.x},${mid.y})`}
        pointerEvents="none"
      >
        {formatLength(L, units)}
      </text>
    </g>
  )
}

export function PlanLayers({
  floor,
  units,
  theme,
  scale,
  showWallLengths = true,
  showAreas = true,
  showLabels = true,
  showDimensions = true,
  layer = 'plan',
  activeSwitch,
  ghost,
  forPrint,
  faded = [],
}: Props) {
  if (ghost) {
    return (
      <g pointerEvents="none" opacity={0.35}>
        {floor.rooms.map((r) => (
          <path key={r.id} d={wallPath(r)} fill={theme.ghost} fillRule="evenodd" />
        ))}
      </g>
    )
  }
  const lighting = layer === 'lighting'
  const fadedSet = new Set(faded)
  const fade = (s: PlanSymbol) => fadedSet.has(SYMBOL_MAP.get(s.type)?.category ?? '')
  const isFixture = (s: PlanSymbol) => !!SYMBOL_MAP.get(s.type)?.fixture
  const furniture = floor.symbols.filter((s) => !s.wall && !isFixture(s) && s.type !== 'gypsum-box')
  const fixtures = floor.symbols.filter((s) => isFixture(s) && !s.room)
  const coves = floor.symbols.filter((s) => s.room)
  const boxes = floor.symbols.filter((s) => s.type === 'gypsum-box')
  const roomById = new Map(floor.rooms.map((r) => [r.id, r]))

  return (
    <g>
      <g>
        {floor.rooms.map((r) => (
          <path
            key={r.id}
            data-kind="room"
            data-id={r.id}
            d={polygonPath(r.points)}
            fill={theme.tint(r.color)}
            fillOpacity={lighting ? 0.55 : 1}
          />
        ))}
        {!lighting && !forPrint && floor.rooms.map((r) => <FloorFinish key={r.id} room={r} theme={theme} />)}
      </g>
      {lighting && (
        <g>
          {floor.rooms.map((r) => (
            <CeilingZones key={r.id} room={ceilingRoom(r, floor)} theme={theme} />
          ))}
          {floor.rooms.map((r) => (
            <CurtainPockets key={r.id} room={ceilingRoom(r, floor)} theme={theme} />
          ))}
          {floor.rooms.map((r) => (
            <ShadowGaps key={r.id} room={ceilingRoom(r, floor)} theme={theme} />
          ))}
        </g>
      )}
      <g>
        {floor.rooms.filter(isOutdoor).map((r) => (
          <Railings key={r.id} room={r} rooms={floor.rooms} theme={theme} />
        ))}
        {floor.rooms
          .filter((r) => !isOutdoor(r))
          .map((r) => (
            <path key={r.id} data-kind="room" data-id={r.id} d={wallPath(r)} fill={theme.wall} fillRule="evenodd" />
          ))}
      </g>
      <g opacity={lighting ? 0.22 : 1} pointerEvents={lighting ? 'none' : undefined}>
        {furniture.map((s) => (
          <SymbolGraphic key={s.id} sym={s} rooms={floor.rooms} theme={theme} forPrint={forPrint} faded={fade(s)} />
        ))}
      </g>
      {lighting && (
        <g>
          {boxes.map((s) => (
            <SymbolGraphic key={s.id} sym={s} rooms={floor.rooms} theme={theme} forPrint={forPrint} faded={fade(s)} />
          ))}
        </g>
      )}
      <g>
        {floor.symbols
          .filter((s) => s.wall)
          .map((s) => (
            <SymbolGraphic key={s.id} sym={s} rooms={floor.rooms} theme={theme} forPrint={forPrint} faded={fade(s)} />
          ))}
      </g>
      {lighting && (
        <g opacity={fadedSet.has('Lighting') ? FADE : undefined} pointerEvents={fadedSet.has('Lighting') ? 'none' : undefined}>
          {coves.map((s) => {
            const room = roomById.get(s.room!)
            return room ? <CoveLight key={s.id} sym={s} room={ceilingRoom(room, floor)} scale={scale} forPrint={forPrint} /> : null
          })}
        </g>
      )}
      <g opacity={lighting ? 1 : 0.85}>
        {fixtures.map((s) => (
          <SymbolGraphic key={s.id} sym={s} rooms={floor.rooms} theme={theme} forPrint={forPrint} faded={fade(s)} />
        ))}
      </g>
      {lighting && (
        <g opacity={fadedSet.has('Lighting') ? FADE : undefined}>
          <Wiring floor={floor} scale={scale} activeSwitch={activeSwitch} />
        </g>
      )}
      {showLabels && (
        <g>
          {floor.rooms.map((r) => (
            <RoomLabels
              key={r.id}
              room={r}
              units={units}
              theme={theme}
              scale={scale}
              showWallLengths={showWallLengths && !lighting}
              showAreas={showAreas}
            />
          ))}
          {lighting && <SwitchLabels floor={floor} scale={scale} theme={theme} forPrint={forPrint} />}
        </g>
      )}
      {showDimensions && (
        <g opacity={fadedSet.has('Dimensions') ? FADE : undefined} pointerEvents={fadedSet.has('Dimensions') ? 'none' : undefined}>
          {(floor.dimensions ?? []).map((d) => (
            <DimensionGraphic key={d.id} d={d} units={units} scale={scale} theme={theme} forPrint={forPrint} />
          ))}
        </g>
      )}
    </g>
  )
}
