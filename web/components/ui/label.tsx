"use client"

import * as React from "react"
import { Label as LabelPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"

/* A label written as <Label htmlFor="x"> gets a matching id of its own, so
   anything that needs to point back at it can do so by convention rather than
   by being handed a second prop. components/ui/select.tsx relies on this: a
   react-aria Select is labelled by aria-labelledby, and htmlFor alone is
   invisible to it. Explicit ids still win. */
function Label({
  className,
  id,
  htmlFor,
  ...props
}: React.ComponentProps<typeof LabelPrimitive.Root>) {
  return (
    <LabelPrimitive.Root
      data-slot="label"
      htmlFor={htmlFor}
      id={id ?? (htmlFor ? `${htmlFor}-label` : undefined)}
      className={cn(
        "flex items-center gap-2 text-sm leading-none font-medium select-none group-data-[disabled=true]:pointer-events-none group-data-[disabled=true]:opacity-50 peer-disabled:cursor-not-allowed peer-disabled:opacity-50",
        className
      )}
      {...props}
    />
  )
}

export { Label }
