import type { ReactNode } from 'react'
import { Check, X } from 'lucide-react'
import { cn } from '@/lib/utils'

/*
 * Tips for getting a drawing recognized well, each with a "do" and an "avoid" example.
 * The examples are small drawings on paper, so they read the same in light and dark mode.
 */

const INK = '#1c1917'
const FAINT = '#a8a29e'

function Paper({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <svg viewBox="0 0 120 80" className={cn('w-full rounded-md border bg-white', className)} aria-hidden>
      {children}
    </svg>
  )
}

/** A small two-room plan: thick walls with doorways, thin furniture away from the walls. */
function CleanPlan({ scale = 1, x = 0, y = 0 }: { scale?: number; x?: number; y?: number }) {
  return (
    <g transform={`translate(${x},${y}) scale(${scale})`} stroke={INK} fill="none">
      <path d="M12 10 H108 V70 H12 Z" strokeWidth={4.5} />
      <path d="M62 10 V36 M62 48 V70" strokeWidth={3.5} />
      <path d="M62 36 A12 12 0 0 1 74 48" strokeWidth={0.7} />
      <path d="M40 70 H52" stroke="#fff" strokeWidth={6} />
      <path d="M40 70 A12 12 0 0 1 52 58" strokeWidth={0.7} />
      <rect x={20} y={18} width={20} height={26} strokeWidth={0.8} />
      <rect x={72} y={54} width={26} height={9} strokeWidth={0.8} />
      <circle cx={86} cy={26} r={7} strokeWidth={0.8} />
    </g>
  )
}

const EXAMPLES: Record<string, { good: ReactNode; bad: ReactNode }> = {
  walls: {
    good: (
      <Paper>
        <CleanPlan />
      </Paper>
    ),
    bad: (
      <Paper>
        <g stroke={INK} fill="none" strokeWidth={0.9}>
          <path d="M12 10 H108 V70 H12 Z" />
          <path d="M62 10 V70" />
          <rect x={12} y={10} width={26} height={30} />
          <rect x={62} y={52} width={46} height={18} />
          <path d="M20 58 H104 M20 55 V61 M104 55 V61" />
        </g>
        <text x={50} y={34} fontSize={11} fontFamily="Arial" fontWeight={700} fill={INK}>
          LIVING
        </text>
      </Paper>
    ),
  },
  crop: {
    good: (
      <Paper>
        <CleanPlan />
      </Paper>
    ),
    bad: (
      <Paper>
        <CleanPlan scale={0.42} x={4} y={6} />
        <CleanPlan scale={0.42} x={4} y={42} />
        <g stroke={INK} fill="none" strokeWidth={0.8}>
          <rect x={60} y={6} width={54} height={68} />
          <path d="M60 58 H114 M60 66 H114 M88 58 V74" />
          <rect x={66} y={14} width={6} height={4} />
          <rect x={66} y={24} width={6} height={4} />
          <rect x={66} y={34} width={6} height={4} />
          <path d="M76 16 H104 M76 26 H100 M76 36 H106" stroke={FAINT} />
        </g>
      </Paper>
    ),
  },
  photo: {
    good: (
      <Paper>
        <CleanPlan />
      </Paper>
    ),
    bad: (
      <svg viewBox="0 0 120 80" className="w-full rounded-md border bg-stone-400" aria-hidden>
        <defs>
          <linearGradient id="tip-shadow" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0.3" stopColor="#000" stopOpacity={0} />
            <stop offset="1" stopColor="#000" stopOpacity={0.45} />
          </linearGradient>
        </defs>
        <path d="M22 4 L112 10 L124 86 L2 78 Z" fill="#fafaf9" />
        <g transform="matrix(0.86,0.06,0.1,0.9,14,4)">
          <CleanPlan />
        </g>
        <path d="M22 4 L112 10 L124 86 L2 78 Z" fill="url(#tip-shadow)" />
      </svg>
    ),
  },
  sketch: {
    good: (
      <Paper>
        <g stroke={INK} fill="none" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
          <path d="M13 11 Q60 9 107 12 Q109 40 106 69 Q80 71 54 70 M40 70 Q26 71 13 69 Q11 40 13 11" />
          <path d="M61 11 Q62 24 61 35 M61 48 Q60 60 61 70" />
        </g>
        <path d="M20 22 h16 v18 h-16 z" stroke={FAINT} strokeWidth={0.8} fill="none" />
      </Paper>
    ),
    bad: (
      <Paper>
        <g stroke={FAINT} fill="none" strokeWidth={1.2} strokeLinecap="round">
          <path d="M16 13 Q60 10 100 12" />
          <path d="M107 18 Q109 42 106 66" />
          <path d="M100 70 Q60 72 18 68" />
          <path d="M12 62 Q10 40 13 20" />
          <path d="M61 16 Q62 40 60 64" />
        </g>
        <g stroke={INK} fill="none" strokeWidth={1.4}>
          <path d="M14 30 h24 v22 h-24" />
          <path d="M84 14 q10 10 22 2" />
        </g>
      </Paper>
    ),
  },
  sharp: {
    good: (
      <Paper>
        <CleanPlan />
      </Paper>
    ),
    bad: (
      <svg viewBox="0 0 120 80" className="w-full rounded-md border bg-white" aria-hidden>
        <defs>
          <filter id="tip-blur">
            <feGaussianBlur stdDeviation="1.6" />
          </filter>
        </defs>
        <g filter="url(#tip-blur)" opacity={0.75}>
          <CleanPlan />
        </g>
      </svg>
    ),
  },
}

export interface Tip {
  id: keyof typeof EXAMPLES
  title: string
  body: string
  good: string
  bad: string
}

const TIPS: Tip[] = [
  {
    id: 'walls',
    title: 'Walls stand out',
    body: 'Walls should be darker and thicker than furniture, text and dimension lines. Leave doorways as gaps.',
    good: 'Thick, dark walls',
    bad: 'Walls as thin as the furniture',
  },
  {
    id: 'crop',
    title: 'One floor, cropped close',
    body: 'Crop away title blocks, legends, logos and other floors. One floor per import.',
    good: 'Just the plan',
    bad: 'Two floors and a title block',
  },
  {
    id: 'photo',
    title: 'Photos: flat, square on, evenly lit',
    body: 'Lay the page flat, shoot from straight above and fill the frame. A slight tilt is fixed for you.',
    good: 'Straight above',
    bad: 'At an angle, in shadow',
  },
  {
    id: 'sketch',
    title: 'Sketches: closed rooms, dark pen',
    body: 'Make walls meet at the corners and draw them with a dark pen. Skip furniture, or keep it away from the walls.',
    good: 'Closed rooms',
    bad: 'Gaps at corners, faint pencil',
  },
  {
    id: 'sharp',
    title: 'Sharp and big enough',
    body: 'Use the original file or a sharp scan, at least 1500 px across. Tiny, blurry screenshots lose thin walls.',
    good: 'Crisp lines',
    bad: 'Blurry or tiny',
  },
]

function Example({ ok, label, children }: { ok: boolean; label: string; children: ReactNode }) {
  return (
    <figure className="min-w-0 space-y-1">
      {children}
      <figcaption className={cn('flex items-center gap-1 text-[11px] leading-tight', ok ? 'text-emerald-700 dark:text-emerald-400' : 'text-red-700 dark:text-red-400')}>
        {ok ? <Check className="size-3 shrink-0" /> : <X className="size-3 shrink-0" />}
        <span className="truncate">{label}</span>
      </figcaption>
    </figure>
  )
}

export function TipCard({ tip }: { tip: Tip }) {
  const ex = EXAMPLES[tip.id]
  return (
    <div className="space-y-2 rounded-lg border bg-card p-3">
      <div>
        <p className="text-sm font-medium">{tip.title}</p>
        <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{tip.body}</p>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Example ok label={tip.good}>
          {ex.good}
        </Example>
        <Example ok={false} label={tip.bad}>
          {ex.bad}
        </Example>
      </div>
    </div>
  )
}

/** The tips as a grid of cards. */
export function DrawingTips({ only, className }: { only?: Tip['id'][]; className?: string }) {
  const tips = only ? TIPS.filter((t) => only.includes(t.id)) : TIPS
  return (
    <div className={cn('grid gap-3 sm:grid-cols-2', className)}>
      {tips.map((t) => (
        <TipCard key={t.id} tip={t} />
      ))}
    </div>
  )
}
