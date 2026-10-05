import { useId, useLayoutEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { ToggleGroup as ToggleGroupPrimitive } from 'radix-ui'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { cn } from '@/lib/utils'

export interface ChoiceOption<T extends string> {
  value: T
  label: ReactNode
  /** The label as plain text, for the dropdown it becomes when there's no room (when `label` isn't text). */
  text?: string
  title?: string
}

interface Base<T extends string> {
  options: ChoiceOption<T>[]
  /** Shown beside it when there's room, else above it. */
  label?: string
  /** Always under its label. */
  stacked?: boolean
  /** A note under it. */
  children?: ReactNode
  className?: string
}

type Props<T extends string> =
  | (Base<T> & { multiple?: false; value: T; onChange: (value: T) => void })
  | (Base<T> & { multiple: true; value: T[]; onChange: (value: T[]) => void })

/** Width of a field's label column, and the gap after it (as in the properties panels). */
const LABEL = 104
const GAP = 8

const ROOT = 'grid auto-cols-fr grid-flow-col gap-0.5 rounded-lg bg-muted p-0.5'
const ITEM =
  'flex h-7 min-w-0 items-center justify-center gap-1.5 rounded-md px-2.5 text-xs font-medium whitespace-nowrap text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 data-[state=on]:bg-background data-[state=on]:text-foreground data-[state=on]:shadow-sm [&_svg]:size-3.5 [&_svg]:shrink-0'

/**
 * A choice between a few options, as a segmented control that always fits: beside its label when there's room, under
 * it when there isn't, and when even that's too narrow, a dropdown (or, choosing several, two rows of options).
 */
export function Choice<T extends string>(props: Props<T>) {
  const { options, label, stacked, children, className } = props
  const id = useId()
  const rowRef = useRef<HTMLDivElement>(null)
  const sizeRef = useRef<HTMLDivElement>(null)
  const [fit, setFit] = useState<'inline' | 'stacked' | 'none'>(label && !stacked ? 'inline' : 'stacked')

  // How wide the options are side by side, against the room there is (again whenever either changes).
  useLayoutEffect(() => {
    const row = rowRef.current
    const size = sizeRef.current
    if (!row || !size) return
    const ro = new ResizeObserver(() => {
      const need = size.offsetWidth
      const room = row.clientWidth
      if (!room) return
      setFit(label && !stacked && need <= room - LABEL - GAP ? 'inline' : need <= room ? 'stacked' : 'none')
    })
    ro.observe(row)
    ro.observe(size)
    return () => ro.disconnect()
  }, [label, stacked])

  const items = options.map((o) => (
    <ToggleGroupPrimitive.Item key={o.value} value={o.value} title={o.title} className={ITEM}>
      {o.label}
    </ToggleGroupPrimitive.Item>
  ))
  const labelled = label ? { 'aria-labelledby': `${id}-label` } : {}
  let control: ReactNode
  if (fit === 'none' && !props.multiple) {
    control = (
      <Select value={props.value} onValueChange={(v) => props.onChange(v as T)}>
        <SelectTrigger id={id} size="sm" className="w-full" {...labelled}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.text ?? o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    )
  } else if (props.multiple) {
    control = (
      <ToggleGroupPrimitive.Root
        type="multiple"
        value={props.value}
        onValueChange={(v) => props.onChange(v as T[])}
        className={cn(ROOT, 'w-full', fit === 'none' && 'grid-flow-row grid-cols-2')}
        {...labelled}
      >
        {items}
      </ToggleGroupPrimitive.Root>
    )
  } else {
    control = (
      <ToggleGroupPrimitive.Root
        type="single"
        value={props.value}
        // Clicking the chosen one again keeps it chosen.
        onValueChange={(v) => v && props.onChange(v as T)}
        className={cn(ROOT, 'w-full')}
        {...labelled}
      >
        {items}
      </ToggleGroupPrimitive.Root>
    )
  }

  return (
    <div ref={rowRef} className={cn('relative min-w-0', label && fit === 'inline' ? 'grid grid-cols-[104px_1fr] items-center gap-2' : 'space-y-1.5', className)}>
      {label && (
        <Label id={`${id}-label`} htmlFor={fit === 'none' && !props.multiple ? id : undefined} className="font-normal text-muted-foreground">
          {label}
        </Label>
      )}
      <div className="min-w-0 space-y-1">
        {control}
        {children}
      </div>
      {/* The options at their natural width, to measure (never seen, and taking no room). */}
      <div aria-hidden inert className="pointer-events-none invisible absolute top-0 left-0 size-0 overflow-hidden">
        <div ref={sizeRef} className={cn(ROOT, 'w-max')}>
          {options.map((o) => (
            <span key={o.value} className={ITEM}>
              {o.label}
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}
