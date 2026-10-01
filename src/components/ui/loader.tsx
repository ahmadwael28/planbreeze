import { useId } from 'react'
import type { ComponentProps } from 'react'
import { cn } from '@/lib/utils'

/** The logo's floor plan, open at the top right corner, with a doorway in the middle wall. */
const WALLS = ['M38 16H14V48H48V35', 'M30 16V24M30 48V40']
/** The breeze: in through the doorway and out of the open corner. */
const BREEZE = 'M19.5 35C24.5 35 26 32 31 32C36.5 32 38.5 27.5 44 27C48.4 26.6 51.6 24.3 51.6 21C51.6 18.3 49.6 16.4 47.1 16.4C45 16.4 43.5 17.9 43.4 19.8'

/**
 * Planbreeze's loading indicator, used instead of a spinner: the logo's floor plan with its breeze flowing through,
 * over and over. In the text color (fits buttons and status lines), or `brand` colored for bigger waits.
 */
export function Loader({ className, brand = false, label = 'Loading', ...props }: ComponentProps<'svg'> & { brand?: boolean; label?: string }) {
  const gradient = `pb-breeze-${useId().replace(/[^\w-]/g, '')}`
  return (
    <svg
      viewBox="0 0 64 64"
      fill="none"
      role="status"
      aria-label={label}
      data-slot="loader"
      className={cn('size-4 shrink-0', className)}
      {...props}
    >
      {brand && (
        <defs>
          <linearGradient id={gradient} x1="18" y1="35" x2="52" y2="16" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor="#22C3EE" />
            <stop offset="0.55" stopColor="#3B82F6" />
            <stop offset="1" stopColor="#4F46E5" />
          </linearGradient>
        </defs>
      )}
      <g stroke="currentColor" strokeWidth={5.5} strokeLinecap="round" strokeLinejoin="round" opacity={brand ? 0.9 : 0.5}>
        {WALLS.map((d) => (
          <path key={d} d={d} />
        ))}
      </g>
      <path
        className="pb-loader-breeze"
        d={BREEZE}
        pathLength={100}
        stroke={brand ? `url(#${gradient})` : 'currentColor'}
        strokeWidth={5}
        strokeLinecap="round"
      />
    </svg>
  )
}
