import * as React from "react"
import { cn } from "cn"
import { Popover as PopoverPrimitive, Slot } from "radix-ui"
import { nameOf, PhoneSheet, usePhone } from "@/components/ui/phone-sheet"

/* On a phone, a popover's panel is a sheet up from the bottom (see phone-sheet), named after what opened it. */

interface PhonePopover {
  open: boolean
  setOpen: (open: boolean) => void
  title?: string
  setTitle: (title: string | undefined) => void
}

const PhonePopoverContext = React.createContext<PhonePopover | null>(null)

function Popover({
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Root>) {
  const phone = usePhone()
  if (phone) return <PhonePopoverRoot {...props} />
  return <PopoverPrimitive.Root data-slot="popover" {...props} />
}

function PhonePopoverRoot({ open, defaultOpen, onOpenChange, children }: React.ComponentProps<typeof PopoverPrimitive.Root>) {
  const [own, setOwn] = React.useState(defaultOpen ?? false)
  const [title, setTitle] = React.useState<string>()
  const ctx: PhonePopover = {
    open: open ?? own,
    setOpen: (o) => {
      setOwn(o)
      onOpenChange?.(o)
    },
    title,
    setTitle,
  }
  return <PhonePopoverContext.Provider value={ctx}>{children}</PhonePopoverContext.Provider>
}

function PopoverTrigger({
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Trigger>) {
  const p = React.useContext(PhonePopoverContext)
  if (p) {
    const { asChild, onClick, ...rest } = props
    const Comp = asChild ? Slot.Root : "button"
    return (
      <Comp
        data-slot="popover-trigger"
        aria-haspopup="dialog"
        aria-expanded={p.open}
        data-state={p.open ? "open" : "closed"}
        {...(!asChild && { type: "button" as const })}
        {...rest}
        onClick={(e: React.MouseEvent<HTMLButtonElement>) => {
          onClick?.(e)
          if (e.defaultPrevented) return
          p.setTitle(nameOf(e.currentTarget))
          p.setOpen(!p.open)
        }}
      />
    )
  }
  return <PopoverPrimitive.Trigger data-slot="popover-trigger" {...props} />
}

function PopoverContent({
  className,
  align = "center",
  sideOffset = 4,
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Content>) {
  const p = React.useContext(PhonePopoverContext)
  if (p) {
    return (
      <PhoneSheet open={p.open} onOpenChange={p.setOpen} title={p.title}>
        <div data-slot="popover-content" className={cn("flex flex-col gap-3 text-[15px]", className, "w-auto max-w-none p-0")}>
          {props.children}
        </div>
      </PhoneSheet>
    )
  }
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        data-slot="popover-content"
        align={align}
        sideOffset={sideOffset}
        className={cn(
          "z-50 flex w-72 origin-(--radix-popover-content-transform-origin) flex-col gap-2.5 rounded-lg bg-popover p-2.5 text-sm text-popover-foreground shadow-md ring-1 ring-foreground/10 outline-hidden duration-100 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
          className
        )}
        {...props}
      />
    </PopoverPrimitive.Portal>
  )
}

function PopoverAnchor({
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Anchor>) {
  if (React.useContext(PhonePopoverContext)) {
    const { asChild, ...rest } = props
    return asChild ? <Slot.Root {...rest} /> : <div {...rest} />
  }
  return <PopoverPrimitive.Anchor data-slot="popover-anchor" {...props} />
}

function PopoverHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="popover-header"
      className={cn("flex flex-col gap-0.5 text-sm", className)}
      {...props}
    />
  )
}

function PopoverTitle({ className, ...props }: React.ComponentProps<"h2">) {
  return (
    <div
      data-slot="popover-title"
      className={cn("font-medium", className)}
      {...props}
    />
  )
}

function PopoverDescription({
  className,
  ...props
}: React.ComponentProps<"p">) {
  return (
    <p
      data-slot="popover-description"
      className={cn("text-muted-foreground", className)}
      {...props}
    />
  )
}

export {
  Popover,
  PopoverAnchor,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
}
