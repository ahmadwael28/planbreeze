"use client"

import * as React from "react"
import { createPortal } from "react-dom"
import { cn } from "cn"
import { DropdownMenu as DropdownMenuPrimitive, Slot } from "radix-ui"
import { CheckIcon, ChevronRightIcon } from "lucide-react"
import { nameOf, PhoneSheet, SheetToggle, usePhone } from "@/components/ui/phone-sheet"

/*
 * On a phone, a menu is a sheet up from the bottom (see phone-sheet): its items rows grouped on cards, a submenu a page
 * of its own in the same sheet, with a way back. Elsewhere it's a menu that drops down.
 */

interface PhoneMenu {
  open: boolean
  setOpen: (open: boolean) => void
  /** Its name, from what opened it. */
  title?: string
  setTitle: (title: string | undefined) => void
  /** The submenus open, one in another: the last is the page showing. */
  pages: { id: string; title: string }[]
  push: (page: { id: string; title: string }) => void
  pop: () => void
  /** Where submenus' pages go. */
  host: HTMLElement | null
  setHost: (el: HTMLElement | null) => void
}

const PhoneMenuContext = React.createContext<PhoneMenu | null>(null)
const PhoneSubContext = React.createContext<string | null>(null)
const PhoneRadioContext = React.createContext<{ value?: string; onValueChange?: (value: string) => void } | null>(null)

function DropdownMenu({
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Root>) {
  const phone = usePhone()
  if (phone) return <PhoneMenuRoot {...props} />
  return <DropdownMenuPrimitive.Root data-slot="dropdown-menu" {...props} />
}

function PhoneMenuRoot({
  open: openProp,
  defaultOpen,
  onOpenChange,
  children,
}: React.ComponentProps<typeof DropdownMenuPrimitive.Root>) {
  const [own, setOwn] = React.useState(defaultOpen ?? false)
  const [title, setTitle] = React.useState<string>()
  const [pages, setPages] = React.useState<{ id: string; title: string }[]>([])
  const [host, setHost] = React.useState<HTMLElement | null>(null)
  const open = openProp ?? own
  const value: PhoneMenu = {
    open,
    setOpen: (o) => {
      setOwn(o)
      onOpenChange?.(o)
      // Back to its first page for next time, once it's away.
      if (!o) window.setTimeout(() => setPages([]), 350)
    },
    title,
    setTitle,
    pages,
    push: (p) => setPages((s) => [...s, p]),
    pop: () => setPages((s) => s.slice(0, -1)),
    host,
    setHost,
  }
  return <PhoneMenuContext.Provider value={value}>{children}</PhoneMenuContext.Provider>
}

function DropdownMenuPortal({
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Portal>) {
  if (React.useContext(PhoneMenuContext)) return <>{props.children}</>
  return (
    <DropdownMenuPrimitive.Portal data-slot="dropdown-menu-portal" {...props} />
  )
}

function DropdownMenuTrigger({
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Trigger>) {
  const menu = React.useContext(PhoneMenuContext)
  if (menu) {
    const { asChild, onClick, ...rest } = props
    const Comp = asChild ? Slot.Root : "button"
    return (
      <Comp
        data-slot="dropdown-menu-trigger"
        aria-haspopup="menu"
        aria-expanded={menu.open}
        data-state={menu.open ? "open" : "closed"}
        {...(!asChild && { type: "button" as const })}
        {...rest}
        onClick={(e: React.MouseEvent<HTMLButtonElement>) => {
          onClick?.(e)
          if (e.defaultPrevented) return
          menu.setTitle(nameOf(e.currentTarget))
          menu.setOpen(!menu.open)
        }}
      />
    )
  }
  return (
    <DropdownMenuPrimitive.Trigger
      data-slot="dropdown-menu-trigger"
      {...props}
    />
  )
}

function DropdownMenuContent({
  className,
  align = "start",
  sideOffset = 4,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Content>) {
  const menu = React.useContext(PhoneMenuContext)
  if (menu) return <PhoneMenuContent menu={menu}>{props.children}</PhoneMenuContent>
  return (
    <DropdownMenuPrimitive.Portal>
      <DropdownMenuPrimitive.Content
        data-slot="dropdown-menu-content"
        sideOffset={sideOffset}
        align={align}
        className={cn("z-50 max-h-(--radix-dropdown-menu-content-available-height) w-(--radix-dropdown-menu-trigger-width) min-w-32 origin-(--radix-dropdown-menu-content-transform-origin) overflow-x-hidden overflow-y-auto rounded-lg bg-popover p-1 text-popover-foreground shadow-md ring-1 ring-foreground/10 duration-100 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-[state=closed]:overflow-hidden data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95", className )}
        {...props}
      />
    </DropdownMenuPrimitive.Portal>
  )
}

/** The sheet: the menu's first page, and the page of the submenu open, if one is. */
function PhoneMenuContent({ menu, children }: { menu: PhoneMenu; children: React.ReactNode }) {
  const top = menu.pages.at(-1)
  return (
    <PhoneSheet open={menu.open} onOpenChange={menu.setOpen} title={top?.title ?? menu.title} onBack={top ? menu.pop : undefined}>
      <div role="menu" className="pb-page" hidden={!!top}>
        {children}
      </div>
      <div ref={menu.setHost} />
    </PhoneSheet>
  )
}

function DropdownMenuGroup({
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Group>) {
  if (React.useContext(PhoneMenuContext)) {
    return (
      <div role="group" className="pb-group">
        {props.children}
      </div>
    )
  }
  return (
    <DropdownMenuPrimitive.Group data-slot="dropdown-menu-group" {...props} />
  )
}

function DropdownMenuItem({
  className,
  inset,
  variant = "default",
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Item> & {
  inset?: boolean
  variant?: "default" | "destructive"
}) {
  const menu = React.useContext(PhoneMenuContext)
  if (menu) {
    const { onSelect, disabled, children } = props
    return (
      <button
        type="button"
        role="menuitem"
        className="pb-row"
        data-variant={variant}
        data-disabled={disabled || undefined}
        disabled={disabled}
        onClick={() => {
          // As in a menu: done once chosen, unless what's chosen keeps it open.
          const e = new Event("select", { cancelable: true })
          onSelect?.(e)
          if (!e.defaultPrevented) menu.setOpen(false)
        }}
      >
        {children}
      </button>
    )
  }
  return (
    <DropdownMenuPrimitive.Item
      data-slot="dropdown-menu-item"
      data-inset={inset}
      data-variant={variant}
      className={cn(
        "group/dropdown-menu-item relative flex cursor-default items-center gap-1.5 rounded-md px-1.5 py-1 text-sm outline-hidden select-none focus:bg-accent focus:text-accent-foreground not-data-[variant=destructive]:focus:**:text-accent-foreground data-inset:pl-7 data-[variant=destructive]:text-destructive data-[variant=destructive]:focus:bg-destructive/10 data-[variant=destructive]:focus:text-destructive dark:data-[variant=destructive]:focus:bg-destructive/20 data-disabled:pointer-events-none data-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 data-[variant=destructive]:*:[svg]:text-destructive",
        className
      )}
      {...props}
    />
  )
}

function DropdownMenuCheckboxItem({
  className,
  children,
  checked,
  inset,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.CheckboxItem> & {
  inset?: boolean
}) {
  if (React.useContext(PhoneMenuContext)) {
    // A switch in a row, on or off as it's tapped; the sheet stays up for the next.
    const on = checked === true
    return (
      <button
        type="button"
        role="menuitemcheckbox"
        aria-checked={on}
        className="pb-row"
        data-disabled={props.disabled || undefined}
        disabled={props.disabled}
        onClick={() => props.onCheckedChange?.(!on)}
      >
        {children}
        <SheetToggle on={on} />
      </button>
    )
  }
  return (
    <DropdownMenuPrimitive.CheckboxItem
      data-slot="dropdown-menu-checkbox-item"
      data-inset={inset}
      className={cn(
        "relative flex cursor-default items-center gap-1.5 rounded-md py-1 pr-8 pl-1.5 text-sm outline-hidden select-none focus:bg-accent focus:text-accent-foreground focus:**:text-accent-foreground data-inset:pl-7 data-disabled:pointer-events-none data-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className
      )}
      checked={checked}
      {...props}
    >
      <span
        className="pointer-events-none absolute right-2 flex items-center justify-center"
        data-slot="dropdown-menu-checkbox-item-indicator"
      >
        <DropdownMenuPrimitive.ItemIndicator>
          <CheckIcon
          />
        </DropdownMenuPrimitive.ItemIndicator>
      </span>
      {children}
    </DropdownMenuPrimitive.CheckboxItem>
  )
}

function DropdownMenuRadioGroup({
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.RadioGroup>) {
  if (React.useContext(PhoneMenuContext)) {
    return (
      <PhoneRadioContext.Provider value={{ value: props.value, onValueChange: props.onValueChange }}>
        <div role="group" className="pb-group">
          {props.children}
        </div>
      </PhoneRadioContext.Provider>
    )
  }
  return (
    <DropdownMenuPrimitive.RadioGroup
      data-slot="dropdown-menu-radio-group"
      {...props}
    />
  )
}

function DropdownMenuRadioItem({
  className,
  children,
  inset,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.RadioItem> & {
  inset?: boolean
}) {
  const menu = React.useContext(PhoneMenuContext)
  const radio = React.useContext(PhoneRadioContext)
  if (menu) {
    const on = radio?.value === props.value
    return (
      <button
        type="button"
        role="menuitemradio"
        aria-checked={on}
        lang={props.lang}
        className="pb-row"
        data-disabled={props.disabled || undefined}
        disabled={props.disabled}
        onClick={() => {
          radio?.onValueChange?.(props.value)
          menu.setOpen(false)
        }}
      >
        {children}
        {on && <CheckIcon className="pb-check pb-keep size-[22px]" strokeWidth={2.5} />}
      </button>
    )
  }
  return (
    <DropdownMenuPrimitive.RadioItem
      data-slot="dropdown-menu-radio-item"
      data-inset={inset}
      className={cn(
        "relative flex cursor-default items-center gap-1.5 rounded-md py-1 pr-8 pl-1.5 text-sm outline-hidden select-none focus:bg-accent focus:text-accent-foreground focus:**:text-accent-foreground data-inset:pl-7 data-disabled:pointer-events-none data-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className
      )}
      {...props}
    >
      <span
        className="pointer-events-none absolute right-2 flex items-center justify-center"
        data-slot="dropdown-menu-radio-item-indicator"
      >
        <DropdownMenuPrimitive.ItemIndicator>
          <CheckIcon
          />
        </DropdownMenuPrimitive.ItemIndicator>
      </span>
      {children}
    </DropdownMenuPrimitive.RadioItem>
  )
}

function DropdownMenuLabel({
  className,
  inset,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Label> & {
  inset?: boolean
}) {
  if (React.useContext(PhoneMenuContext)) return <div className={cn("pb-label", className)}>{props.children}</div>
  return (
    <DropdownMenuPrimitive.Label
      data-slot="dropdown-menu-label"
      data-inset={inset}
      className={cn(
        "px-1.5 py-1 text-xs font-medium text-muted-foreground data-inset:pl-7",
        className
      )}
      {...props}
    />
  )
}

function DropdownMenuSeparator({
  className,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Separator>) {
  if (React.useContext(PhoneMenuContext)) return <div role="separator" className="pb-sep" />
  return (
    <DropdownMenuPrimitive.Separator
      data-slot="dropdown-menu-separator"
      className={cn("-mx-1 my-1 h-px bg-border", className)}
      {...props}
    />
  )
}

function DropdownMenuShortcut({
  className,
  ...props
}: React.ComponentProps<"span">) {
  // No keyboard to press them on, on a phone.
  if (React.useContext(PhoneMenuContext)) return null
  return (
    <span
      data-slot="dropdown-menu-shortcut"
      className={cn(
        "ml-auto text-xs tracking-widest text-muted-foreground group-focus/dropdown-menu-item:text-accent-foreground",
        className
      )}
      {...props}
    />
  )
}

function DropdownMenuSub({
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Sub>) {
  const id = React.useId()
  if (React.useContext(PhoneMenuContext)) return <PhoneSubContext.Provider value={id}>{props.children}</PhoneSubContext.Provider>
  return <DropdownMenuPrimitive.Sub data-slot="dropdown-menu-sub" {...props} />
}

function DropdownMenuSubTrigger({
  className,
  inset,
  children,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.SubTrigger> & {
  inset?: boolean
}) {
  const menu = React.useContext(PhoneMenuContext)
  const sub = React.useContext(PhoneSubContext)
  if (menu && sub) {
    // A way into the submenu's page.
    return (
      <button
        type="button"
        className="pb-row"
        aria-haspopup="menu"
        data-disabled={props.disabled || undefined}
        disabled={props.disabled}
        onClick={(e) => menu.push({ id: sub, title: e.currentTarget.textContent?.trim() ?? "" })}
      >
        {children}
        <ChevronRightIcon className="pb-more rtl-flip" />
      </button>
    )
  }
  return (
    <DropdownMenuPrimitive.SubTrigger
      data-slot="dropdown-menu-sub-trigger"
      data-inset={inset}
      className={cn(
        "flex cursor-default items-center gap-1.5 rounded-md px-1.5 py-1 text-sm outline-hidden select-none focus:bg-accent focus:text-accent-foreground not-data-[variant=destructive]:focus:**:text-accent-foreground data-inset:pl-7 data-open:bg-accent data-open:text-accent-foreground [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className
      )}
      {...props}
    >
      {children}
      <ChevronRightIcon className="ml-auto" />
    </DropdownMenuPrimitive.SubTrigger>
  )
}

function DropdownMenuSubContent({
  className,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.SubContent>) {
  const menu = React.useContext(PhoneMenuContext)
  const sub = React.useContext(PhoneSubContext)
  if (menu && sub) {
    // Its page, while it's open (kept while a submenu in it is, for that one's).
    const at = menu.pages.findIndex((p) => p.id === sub)
    if (at < 0 || !menu.host) return null
    return createPortal(
      <div role="menu" className="pb-page" hidden={at !== menu.pages.length - 1}>
        {props.children}
      </div>,
      menu.host
    )
  }
  return (
    <DropdownMenuPrimitive.SubContent
      data-slot="dropdown-menu-sub-content"
      className={cn("z-50 min-w-[96px] origin-(--radix-dropdown-menu-content-transform-origin) overflow-hidden rounded-lg bg-popover p-1 text-popover-foreground shadow-lg ring-1 ring-foreground/10 duration-100 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95", className )}
      {...props}
    />
  )
}

export {
  DropdownMenu,
  DropdownMenuPortal,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuItem,
  DropdownMenuCheckboxItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
}
