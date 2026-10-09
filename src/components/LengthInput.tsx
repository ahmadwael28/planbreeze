import { useEffect, useState } from 'react'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { formatLength, parseLength } from '@/model/units'
import type { Units } from '@/model/types'

interface Props {
  value: number
  units: Units
  onChange: (cm: number) => void
  min?: number
  className?: string
  id?: string
}

/** Text field that shows a formatted length and accepts "3.4", "340 cm", "11' 2\"", etc. */
export function LengthInput({ value, units, onChange, min = 0.5, className, id }: Props) {
  const [draft, setDraft] = useState<string | null>(null)
  const [invalid, setInvalid] = useState(false)

  useEffect(() => {
    setDraft(null)
    setInvalid(false)
  }, [value, units])

  const commit = () => {
    if (draft === null) return
    const v = parseLength(draft, units)
    if (v === null || v < min) {
      setInvalid(true)
      return
    }
    setDraft(null)
    setInvalid(false)
    if (Math.abs(v - value) > 1e-6) onChange(v)
  }

  return (
    <Input dir="ltr"
      id={id}
      className={cn('h-8 tabular-nums', className)}
      aria-invalid={invalid || undefined}
      value={draft ?? formatLength(value, units)}
      title={units === 'metric' ? 'e.g. 3.45, 345 cm' : 'e.g. 11\' 4", 11.5\', 136"'}
      onChange={(e) => setDraft(e.target.value)}
      onFocus={(e) => e.target.select()}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          ;(e.target as HTMLInputElement).blur() // commits via onBlur
        } else if (e.key === 'Escape') {
          setDraft(null)
          setInvalid(false)
          ;(e.target as HTMLInputElement).blur()
        }
      }}
    />
  )
}

/** Text field that commits on blur/Enter, so one edit = one undo step. */
export function TextInput({ value, onChange, id }: { value: string; onChange: (v: string) => void; id?: string }) {
  const [draft, setDraft] = useState<string | null>(null)
  useEffect(() => setDraft(null), [value])
  const commit = () => {
    if (draft !== null && draft !== value) onChange(draft)
    setDraft(null)
  }
  return (
    <Input dir="ltr"
      id={id}
      className="h-8"
      value={draft ?? value}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
        else if (e.key === 'Escape') {
          setDraft(null)
          ;(e.target as HTMLInputElement).blur()
        }
      }}
    />
  )
}

export function NumberInput({
  value,
  onChange,
  step = 1,
  suffix,
  id,
}: {
  value: number
  onChange: (v: number) => void
  step?: number
  suffix?: string
  id?: string
}) {
  const [draft, setDraft] = useState<string | null>(null)
  useEffect(() => setDraft(null), [value])
  const commit = () => {
    if (draft === null) return
    const v = parseFloat(draft)
    setDraft(null)
    if (Number.isFinite(v) && v !== value) onChange(v)
  }
  return (
    <div className="relative">
      <Input dir="ltr"
        id={id}
        type="number"
        step={step}
        className={cn('h-8 tabular-nums', suffix && 'pr-7')}
        value={draft ?? String(Math.round(value * 100) / 100)}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
      />
      {suffix && (
        <span className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 text-sm text-muted-foreground">
          {suffix}
        </span>
      )}
    </div>
  )
}
