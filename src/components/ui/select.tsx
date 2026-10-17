"use client"

import * as React from "react"
import { cn } from "cn"
import { Select as SelectPrimitive } from "radix-ui"
import { ChevronDownIcon, CheckIcon, ChevronUpIcon } from "lucide-react"
import { nameOf, PhoneSheet, usePhone } from "@/components/ui/phone-sheet"

/*
 * On a phone, the choices come up in a sheet from the bottom (see phone-sheet), named after the field, the one chosen
 * ticked; elsewhere they drop down.
 */

interface PhoneSelect {
  value?: string
  choose: (value: string) => void
  open: boolean
  setOpen: (open: boolean) => void
  disabled?: boolean
  /** What each choice shows, by its value (for the field to show the one chosen). */
  labels: Map<string, React.ReactNode>
  title?: string
  setTitle: (title: string | undefined) => void
}

const PhoneSelectContext = React.createContext<PhoneSelect | null>(null)

/** The choices in a list (its items, wherever they are in it): what each shows, by its value. */
function choicesIn(node: React.ReactNode, out = new Map<string, React.ReactNode>()) {
  React.Children.forEach(node, (child) => {
    if (!React.isValidElement(child)) return
    const props = child.props as { value?: string; children?: React.ReactNode }
    if (child.type === SelectItem && props.value !== undefined) out.set(props.value, props.children)
    else if (props.children) choicesIn(props.children, out)
  })
  return out
}

function Select({
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Root>) {
  const phone = usePhone()
  if (phone) return <PhoneSelectRoot {...props} />
  return <SelectPrimitive.Root data-slot="select" {...props} />
}

function PhoneSelectRoot({
  value,
  defaultValue,
  onValueChange,
  open: openProp,
  defaultOpen,
  onOpenChange,
  disabled,
  children,
}: React.ComponentProps<typeof SelectPrimitive.Root>) {
  const [own, setOwn] = React.useState(defaultValue)
  const [ownOpen, setOwnOpen] = React.useState(defaultOpen ?? false)
  const [title, setTitle] = React.useState<string>()
  const ctx: PhoneSelect = {
    value: value ?? own,
    choose: (v) => {
      setOwn(v)
      onValueChange?.(v)
    },
    open: openProp ?? ownOpen,
    setOpen: (o) => {
      setOwnOpen(o)
      onOpenChange?.(o)
    },
    disabled,
    labels: choicesIn(children),
    title,
    setTitle,
  }
  return <PhoneSelectContext.Provider value={ctx}>{children}</PhoneSelectContext.Provider>
}

/** A field's name for its sheet: its own, or its label's. */
function fieldName(el: HTMLElement) {
  const by = el.getAttribute("aria-labelledby")
  const label = (el.id ? document.querySelector(`label[for="${CSS.escape(el.id)}"]`) : null) ?? (by ? document.getElementById(by.split(" ")[0]) : null)
  return el.getAttribute("aria-label") ?? label?.textContent?.trim() ?? nameOf(el)
}

function SelectGroup({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Group>) {
  // Its label a heading over its choices.
  if (React.useContext(PhoneSelectContext)) return <>{props.children}</>
  return (
    <SelectPrimitive.Group
      data-slot="select-group"
      className={cn("scroll-my-1 p-1", className)}
      {...props}
    />
  )
}

function SelectValue({
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Value>) {
  const s = React.useContext(PhoneSelectContext)
  if (s) {
    const label = s.value !== undefined ? s.labels.get(s.value) : undefined
    return <span data-slot="select-value">{label ?? props.placeholder}</span>
  }
  return <SelectPrimitive.Value data-slot="select-value" {...props} />
}

function SelectTrigger({
  className,
  size = "default",
  children,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Trigger> & {
  size?: "sm" | "default"
}) {
  const look = cn(
    "flex w-fit items-center justify-between gap-1.5 rounded-lg border border-input bg-transparent py-2 pr-2 pl-2.5 text-sm whitespace-nowrap transition-colors outline-none select-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 data-placeholder:text-muted-foreground data-[size=default]:h-8 data-[size=sm]:h-7 data-[size=sm]:rounded-[min(var(--radius-md),10px)] *:data-[slot=select-value]:line-clamp-1 *:data-[slot=select-value]:flex *:data-[slot=select-value]:items-center *:data-[slot=select-value]:gap-1.5 dark:bg-input/30 dark:hover:bg-input/50 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
    className
  )
  const s = React.useContext(PhoneSelectContext)
  if (s) {
    const { asChild: _asChild, onClick, disabled, ...rest } = props
    return (
      <button
        type="button"
        data-slot="select-trigger"
        data-size={size}
        data-placeholder={s.value === undefined ? "" : undefined}
        aria-haspopup="listbox"
        aria-expanded={s.open}
        className={look}
        disabled={disabled || s.disabled}
        {...rest}
        onClick={(e) => {
          onClick?.(e)
          s.setTitle(fieldName(e.currentTarget))
          s.setOpen(true)
        }}
      >
        {children}
        <ChevronDownIcon className="pointer-events-none size-4 text-muted-foreground" />
      </button>
    )
  }
  return (
    <SelectPrimitive.Trigger
      data-slot="select-trigger"
      data-size={size}
      className={look}
      {...props}
    >
      {children}
      <SelectPrimitive.Icon asChild>
        <ChevronDownIcon className="pointer-events-none size-4 text-muted-foreground" />
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  )
}

function SelectContent({
  className,
  children,
  position: wanted = "item-aligned",
  align = "center",
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Content>) {
  const s = React.useContext(PhoneSelectContext)
  if (s) {
    return (
      <PhoneSheet open={s.open} onOpenChange={s.setOpen} title={s.title}>
        <div role="listbox" className="pb-page">
          {children}
        </div>
      </PhoneSheet>
    )
  }
  const position = wanted
  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Content
        data-slot="select-content"
        data-align-trigger={position === "item-aligned"}
        className={cn("relative z-50 max-h-(--radix-select-content-available-height) min-w-36 origin-(--radix-select-content-transform-origin) overflow-x-hidden overflow-y-auto rounded-lg bg-popover text-popover-foreground shadow-md ring-1 ring-foreground/10 duration-100 data-[align-trigger=true]:animate-none data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95", position ==="popper"&&"data-[side=bottom]:translate-y-1 data-[side=left]:-translate-x-1 data-[side=right]:translate-x-1 data-[side=top]:-translate-y-1", className )}
        position={position}
        align={align}
        {...props}
      >
        <SelectScrollUpButton />
        <SelectPrimitive.Viewport
          data-position={position}
          className={cn(
            "data-[position=popper]:h-(--radix-select-trigger-height) data-[position=popper]:w-full data-[position=popper]:min-w-(--radix-select-trigger-width)",
            position === "popper" && ""
          )}
        >
          {children}
        </SelectPrimitive.Viewport>
        <SelectScrollDownButton />
      </SelectPrimitive.Content>
    </SelectPrimitive.Portal>
  )
}

function SelectLabel({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Label>) {
  if (React.useContext(PhoneSelectContext)) return <div className="pb-label">{props.children}</div>
  return (
    <SelectPrimitive.Label
      data-slot="select-label"
      className={cn("px-1.5 py-1 text-xs text-muted-foreground", className)}
      {...props}
    />
  )
}

function SelectItem({
  className,
  children,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Item>) {
  const s = React.useContext(PhoneSelectContext)
  if (s) return <PhoneSelectItem s={s} value={props.value} disabled={props.disabled}>{children}</PhoneSelectItem>
  return (
    <SelectPrimitive.Item
      data-slot="select-item"
      className={cn(
        "relative flex w-full cursor-default items-center gap-1.5 rounded-md py-1 pr-8 pl-1.5 text-sm outline-hidden select-none focus:bg-accent focus:text-accent-foreground not-data-[variant=destructive]:focus:**:text-accent-foreground data-disabled:pointer-events-none data-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 *:[span]:last:flex *:[span]:last:items-center *:[span]:last:gap-2",
        className
      )}
      {...props}
    >
      <span className="pointer-events-none absolute right-2 flex size-4 items-center justify-center">
        <SelectPrimitive.ItemIndicator>
          <CheckIcon className="pointer-events-none" />
        </SelectPrimitive.ItemIndicator>
      </span>
      <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
    </SelectPrimitive.Item>
  )
}

/** A choice in the sheet: a row, ticked if it's the one chosen (and scrolled to, in a long list). */
function PhoneSelectItem({ s, value, disabled, children }: { s: PhoneSelect; value: string; disabled?: boolean; children: React.ReactNode }) {
  const chosen = s.value === value
  const ref = React.useRef<HTMLButtonElement>(null)
  React.useEffect(() => {
    if (chosen) ref.current?.scrollIntoView({ block: "center" })
    // Only as the sheet comes up.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return (
    <button
      ref={ref}
      type="button"
      role="option"
      aria-selected={chosen}
      className="pb-row"
      data-disabled={disabled || undefined}
      disabled={disabled}
      onClick={() => {
        s.choose(value)
        s.setOpen(false)
      }}
    >
      <span className="flex min-w-0 flex-1 items-center gap-3">{children}</span>
      {chosen && <CheckIcon className="pb-check pb-keep size-[22px]" strokeWidth={2.5} />}
    </button>
  )
}

function SelectSeparator({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Separator>) {
  if (React.useContext(PhoneSelectContext)) return <div role="separator" className="pb-sep" />
  return (
    <SelectPrimitive.Separator
      data-slot="select-separator"
      className={cn("pointer-events-none -mx-1 my-1 h-px bg-border", className)}
      {...props}
    />
  )
}

function SelectScrollUpButton({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.ScrollUpButton>) {
  return (
    <SelectPrimitive.ScrollUpButton
      data-slot="select-scroll-up-button"
      className={cn(
        "z-10 flex cursor-default items-center justify-center bg-popover py-1 [&_svg:not([class*='size-'])]:size-4",
        className
      )}
      {...props}
    >
      <ChevronUpIcon
      />
    </SelectPrimitive.ScrollUpButton>
  )
}

function SelectScrollDownButton({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.ScrollDownButton>) {
  return (
    <SelectPrimitive.ScrollDownButton
      data-slot="select-scroll-down-button"
      className={cn(
        "z-10 flex cursor-default items-center justify-center bg-popover py-1 [&_svg:not([class*='size-'])]:size-4",
        className
      )}
      {...props}
    >
      <ChevronDownIcon
      />
    </SelectPrimitive.ScrollDownButton>
  )
}

export {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectScrollDownButton,
  SelectScrollUpButton,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
}
