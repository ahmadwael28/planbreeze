import type { PlanTheme } from '@/model/theme'
import type { SavedView } from '@/model/types'

const CONE_HALF_ANGLE = (36 * Math.PI) / 180

/** Which way a saved view looks on the plan, in degrees (0 = +x, clockwise on screen). */
function viewYaw(v: SavedView) {
  return (Math.atan2(v.look.y - v.eye.y, v.look.x - v.eye.x) * 180) / Math.PI
}

/**
 * Saved 3D views on the plan: a camera with a cone showing where it looks, and its name.
 * Sizes stay constant on screen. Editor only (not printed or exported).
 */
export function PlanViews({
  views,
  scale,
  theme,
  selectedId,
}: {
  views: SavedView[]
  /** Screen pixels per cm. */
  scale: number
  theme: PlanTheme
  selectedId: string | null
}) {
  const px = (n: number) => n / scale
  const R = px(48)
  const cone = `M0,0 L${R * Math.cos(CONE_HALF_ANGLE)},${-R * Math.sin(CONE_HALF_ANGLE)} A${R},${R} 0 0 1 ${R * Math.cos(CONE_HALF_ANGLE)},${R * Math.sin(CONE_HALF_ANGLE)} Z`
  const primary = { fill: 'var(--primary)' }
  return (
    <g>
      {views.map((v) => {
        const yaw = viewYaw(v)
        const sel = v.id === selectedId
        return (
          <g key={v.id} transform={`translate(${v.eye.x},${v.eye.y})`}>
            <path
              d={cone}
              transform={`rotate(${yaw})`}
              pointerEvents="none"
              strokeWidth={1}
              vectorEffect="non-scaling-stroke"
              style={{
                fill: 'var(--primary)',
                fillOpacity: sel ? 0.22 : 0.12,
                stroke: 'var(--primary)',
                strokeOpacity: 0.55,
                strokeDasharray: '4 3',
              }}
            />
            <g data-kind="view" data-id={v.id} className="plan-view">
              <title>{`${v.name}: drag to move · open it in 3D from the panel`}</title>
              <circle
                r={px(13)}
                strokeWidth={sel ? 3 : 2}
                vectorEffect="non-scaling-stroke"
                style={{ fill: 'var(--background)', stroke: 'var(--primary)' }}
              />
              {/* A video camera pointing where the view looks. */}
              <g transform={`rotate(${yaw}) scale(${px(1)})`} style={primary}>
                <rect x={-7.5} y={-4.5} width={9.5} height={9} rx={2} />
                <path d="M2.8,-1.6 L7.5,-4.2 L7.5,4.2 L2.8,1.6 Z" />
              </g>
              <text
                y={px(27)}
                fontSize={px(11)}
                fontWeight={600}
                fontFamily="system-ui, sans-serif"
                textAnchor="middle"
                fill={theme.label}
                stroke={theme.paper}
                strokeWidth={3}
                paintOrder="stroke"
                vectorEffect="non-scaling-stroke"
              >
                {v.name}
              </text>
            </g>
            {sel && (
              <g transform={`rotate(${yaw})`}>
                <line x1={px(13)} y1={0} x2={R + px(6)} y2={0} className="sel-outline" />
                <circle data-kind="view-rotate" className="handle rotate-handle" cx={R + px(6)} cy={0} r={px(7)}>
                  <title>Turn the camera (hold Shift for free rotation)</title>
                </circle>
              </g>
            )}
          </g>
        )
      })}
    </g>
  )
}
