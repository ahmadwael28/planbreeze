import * as React from "react"
import { cn } from "cn"
import { Dialog as DialogPrimitive } from "radix-ui"

import { Button } from "@/components/ui/button"
import { XIcon } from "lucide-react"
import { Drawer } from "vaul"
import { t } from "@/i18n"
import { SheetGrip, usePhone } from "@/components/ui/phone-sheet"

/*
 * On a phone, a dialog is a sheet up from the bottom (vaul's, dragged down to put it away), or the whole screen when
 * its content says so (data-fullscreen). Elsewhere it's in the middle of the screen.
 */
const PhoneDialogContext = React.createContext(false)

function Dialog({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Root>) {
  const phone = usePhone()
  if (phone) {
    return (
      <PhoneDialogContext.Provider value>
        <Drawer.Root open={props.open} defaultOpen={props.defaultOpen} onOpenChange={props.onOpenChange} modal={props.modal}>
          {props.children}
        </Drawer.Root>
      </PhoneDialogContext.Provider>
    )
  }
  return <DialogPrimitive.Root data-slot="dialog" {...props} />
}

function DialogTrigger({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Trigger>) {
  if (React.useContext(PhoneDialogContext)) return <Drawer.Trigger data-slot="dialog-trigger" {...props} />
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />
}

function DialogPortal({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Portal>) {
  if (React.useContext(PhoneDialogContext)) return <Drawer.Portal {...props} />
  return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />
}

function DialogClose({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Close>) {
  if (React.useContext(PhoneDialogContext)) return <Drawer.Close data-slot="dialog-close" {...props} />
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />
}

function DialogOverlay({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Overlay>) {
  return (
    <DialogPrimitive.Overlay
      data-slot="dialog-overlay"
      className={cn(
        "fixed inset-0 isolate z-50 bg-black/10 duration-100 supports-backdrop-filter:backdrop-blur-xs data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0",
        className
      )}
      {...props}
    />
  )
}

function DialogContent({
  className,
  children,
  showCloseButton = true,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & {
  showCloseButton?: boolean
}) {
  if (React.useContext(PhoneDialogContext)) {
    // The whole screen (nothing to drag away), or a sheet with its grip.
    const full = !!(props as { "data-fullscreen"?: boolean })["data-fullscreen"]
    return (
      <Drawer.Portal>
        <Drawer.Overlay className="fixed inset-0 z-50 bg-black/40" />
        <Drawer.Content
          data-slot="dialog-content"
          className={cn(
            "fixed inset-x-0 bottom-0 z-50 flex max-h-[92dvh] flex-col gap-4 rounded-t-[22px] bg-sheet p-4 pt-2 pb-[calc(16px+env(safe-area-inset-bottom))] text-[15px] text-foreground outline-none",
            className,
            full && "inset-0 h-dvh max-h-none rounded-none pt-[env(safe-area-inset-top)]"
          )}
          {...(full && { "data-vaul-no-drag": "" })}
          {...props}
        >
          {!full && <SheetGrip className="mt-0 -mb-1" />}
          {children}
          {showCloseButton && (
            <Drawer.Close
              aria-label={t("Close")}
              className="absolute end-3 top-3 grid size-[30px] place-items-center rounded-full bg-foreground/8 text-muted-foreground active:opacity-60"
            >
              <XIcon className="size-[18px]" strokeWidth={2.5} />
            </Drawer.Close>
          )}
        </Drawer.Content>
      </Drawer.Portal>
    )
  }
  return (
    <DialogPortal>
      <DialogOverlay />
      <DialogPrimitive.Content
        data-slot="dialog-content"
        className={cn(
          "fixed top-1/2 left-1/2 z-50 grid w-full max-w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 gap-4 rounded-xl bg-popover p-4 text-sm text-popover-foreground ring-1 ring-foreground/10 duration-100 outline-none sm:max-w-sm data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
          className
        )}
        {...props}
      >
        {children}
        {showCloseButton && (
          <DialogPrimitive.Close data-slot="dialog-close" asChild>
            <Button
              variant="ghost"
              className="absolute top-2 end-2"
              size="icon-sm"
            >
              <XIcon
              />
              <span className="sr-only">{t("Close")}</span>
            </Button>
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Content>
    </DialogPortal>
  )
}

function DialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-header"
      className={cn("flex flex-col gap-2", className)}
      {...props}
    />
  )
}

function DialogFooter({
  className,
  showCloseButton = false,
  children,
  ...props
}: React.ComponentProps<"div"> & {
  showCloseButton?: boolean
}) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn(
        "-mx-4 -mb-4 flex flex-col-reverse gap-2 rounded-b-xl border-t bg-muted/50 p-4 sm:flex-row sm:justify-end",
        className
      )}
      {...props}
    >
      {children}
      {showCloseButton && (
        <DialogPrimitive.Close asChild>
          <Button variant="outline">{t("Close")}</Button>
        </DialogPrimitive.Close>
      )}
    </div>
  )
}

function DialogTitle({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Title>) {
  if (React.useContext(PhoneDialogContext)) {
    return <Drawer.Title data-slot="dialog-title" className={cn("font-heading text-[17px] leading-tight font-semibold", className)} {...props} />
  }
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn(
        "font-heading text-base leading-none font-medium",
        className
      )}
      {...props}
    />
  )
}

function DialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Description>) {
  if (React.useContext(PhoneDialogContext)) {
    return <Drawer.Description data-slot="dialog-description" className={cn("text-[15px] leading-snug text-muted-foreground", className)} {...props} />
  }
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn(
        "text-sm text-muted-foreground *:[a]:underline *:[a]:underline-offset-3 *:[a]:hover:text-foreground",
        className
      )}
      {...props}
    />
  )
}

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
}
