import * as React from "react"

import { cn } from "@/lib/utils"

function Card({
  className,
  size = "default",
  ...props
}: React.ComponentProps<"div"> & { size?: "default" | "sm" }) {
  return (
    <div
      data-slot="card"
      data-size={size}
      className={cn(
        // PROJECT CUSTOMISATION (3): stock shadcn separates a card from the
        // page with `ring-1 ring-foreground/10` — a translucent halo that
        // sits at a different weight from the `.card` class in
        // app/globals.css, so the two card paths would frame differently on
        // adjacent screens. This matches `.card` instead: a white panel, a
        // faint frame line, and a soft blurred shadow. The border and the
        // ring cannot coexist (they read as one doubled 2px line), so the
        // ring is dropped rather than layered.
        //
        // The Ashfield paper-grain background image is gone with the rest
        // of that direction; `--paper-grain` no longer exists, and a
        // bg-[image:var(--missing)] would have quietly emitted `none`.
        // Padding widens to match the reference's generous card interior.
        "group/card flex flex-col gap-[var(--card-spacing)] overflow-hidden rounded-lg border border-[color:var(--border-frame)] bg-card py-[var(--card-spacing)] text-sm text-card-foreground shadow-raised [--card-spacing:1.5rem] has-data-[slot=card-footer]:pb-0 has-[>img:first-child]:pt-0 data-[size=sm]:[--card-spacing:1rem] data-[size=sm]:has-data-[slot=card-footer]:pb-0 *:[img:first-child]:rounded-t-lg *:[img:last-child]:rounded-b-lg",
        className
      )}
      {...props}
    />
  )
}

function CardHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-header"
      className={cn(
        "group/card-header @container/card-header grid auto-rows-min items-start gap-1 rounded-t-lg px-[var(--card-spacing)] has-data-[slot=card-action]:grid-cols-[1fr_auto] has-data-[slot=card-description]:grid-rows-[auto_auto] [.border-b]:pb-[var(--card-spacing)]",
        className
      )}
      {...props}
    />
  )
}

/**
 * PROJECT CUSTOMISATION — two deliberate changes from stock shadcn:
 *
 * 1. Renders a real heading element, not a <div>. Screen-reader users
 *    navigate by heading; a card whose title is a div is invisible to
 *    that. The level is settable because a card's correct level depends
 *    on where it sits in the page outline.
 * 2. Drops `font-heading`. That slot carried a display serif under the
 *    previous direction and a card title had no business taking it. The
 *    "Meridian" direction is sans throughout, so the slot now resolves to
 *    the same family either way — but the override stays, because it is
 *    the type SCALE decision (a 16px card title is a sub-heading) rather
 *    than a face decision, and it should survive the next direction too.
 */
function CardTitle({
  className,
  as: Comp = "h3",
  ...props
}: React.ComponentProps<"h3"> & { as?: "h1" | "h2" | "h3" | "h4" }) {
  return (
    <Comp
      data-slot="card-title"
      className={cn(
        "text-base leading-snug font-semibold group-data-[size=sm]/card:text-sm",
        className
      )}
      {...props}
    />
  )
}

function CardDescription({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-description"
      className={cn("text-sm text-muted-foreground", className)}
      {...props}
    />
  )
}

function CardAction({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-action"
      className={cn(
        "col-start-2 row-span-2 row-start-1 self-start justify-self-end",
        className
      )}
      {...props}
    />
  )
}

function CardContent({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-content"
      className={cn("px-[var(--card-spacing)]", className)}
      {...props}
    />
  )
}

function CardFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-footer"
      className={cn(
        "flex items-center rounded-b-lg border-t bg-muted/50 p-[var(--card-spacing)]",
        className
      )}
      {...props}
    />
  )
}

export {
  Card,
  CardHeader,
  CardFooter,
  CardTitle,
  CardAction,
  CardDescription,
  CardContent,
}
