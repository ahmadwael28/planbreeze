import { useId } from 'react'

/** Planbreeze mark: a two-room floor plan with a breeze flowing out of it. Same artwork as public/favicon.svg. */
export function Logo({ className }: { className?: string }) {
  const bg = `${useId()}-bg`
  return (
    <svg viewBox="0 0 64 64" fill="none" className={className} aria-hidden>
      <defs>
        <linearGradient id={bg} x1="4" y1="4" x2="60" y2="62" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#22C3EE" />
          <stop offset="0.55" stopColor="#3B82F6" />
          <stop offset="1" stopColor="#4F46E5" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="15" fill={`url(#${bg})`} />
      <path d="M38 16H14V48H48V35" stroke="#FFFFFF" strokeWidth="4.8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M30 16V24M30 48V40" stroke="#FFFFFF" strokeWidth="4.8" strokeLinecap="round" />
      <path
        d="M19.5 35C24.5 35 26 32 31 32C36.5 32 38.5 27.5 44 27C48.4 26.6 51.6 24.3 51.6 21C51.6 18.3 49.6 16.4 47.1 16.4C45 16.4 43.5 17.9 43.4 19.8"
        stroke="#E6FBFF"
        strokeWidth="3.6"
        strokeLinecap="round"
      />
    </svg>
  )
}
