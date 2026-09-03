"use client"

import * as React from "react"
import { Label, ListBox, Select as HeroSelect } from "@heroui/react"

import { cn } from "@/lib/utils"

/* The portal's select, rebuilt on HeroUI v3.

   It keeps the prop names the ~30 call sites already pass — `value`,
   `onValueChange`, `disabled`, and a `<SelectItem value=…>` per option — so
   this file is the only place that knows the control is HeroUI now. The names
   are the old ones; nothing underneath them is.

   The reason for the swap was positioning. Radix's default `item-aligned`
   mode places the panel *over* the trigger, with the selected option under
   the cursor, so anything selected past the first item opens upward. HeroUI's
   popover always drops below the trigger (`placement="bottom start"`), and
   only flips when the viewport genuinely has no room below. */

/* react-aria wants a plain string per option for typeahead and for the text
   the trigger shows once something is chosen. Most options here are already a
   bare string child; the few that interpolate ({t.name}{suffix}) flatten to
   one, and anything exotic falls back to the option's own value rather than
   rendering an empty trigger. */
function textOf(node: React.ReactNode): string {
  if (node === null || node === undefined || typeof node === "boolean") return ""
  if (typeof node === "string" || typeof node === "number") return String(node)
  if (Array.isArray(node)) return node.map(textOf).join("")
  if (React.isValidElement(node))
    return textOf((node.props as { children?: React.ReactNode }).children)
  return ""
}

/* react-aria names the control from the root, and warns loudly when nothing
   names it. The call sites label their selects the way Radix wanted — either an
   external <Label htmlFor> pointing at the trigger's id, or a placeholder and
   no label at all — and neither reaches the root on its own.

   Both are recoverable from the children without touching a single call site:
   the trigger carries the id its label points at, and the value carries the
   placeholder. ui/label.tsx gives every htmlFor label the id this composes, so
   the visible label really is what a screen reader reads; the placeholder is
   only the fallback for the filter selects that have no visible label. */
function labellingFrom(children: React.ReactNode): {
  "aria-labelledby"?: string
  "aria-label"?: string
} {
  let triggerId: string | undefined
  let placeholder: string | undefined

  const walk = (node: React.ReactNode) => {
    React.Children.forEach(node, (child) => {
      if (!React.isValidElement(child)) return
      const props = child.props as { id?: string; placeholder?: unknown; children?: React.ReactNode }
      if (child.type === SelectTrigger && props.id) triggerId = props.id
      if (child.type === SelectValue && typeof props.placeholder === "string")
        placeholder = props.placeholder
      walk(props.children)
    })
  }
  walk(children)

  if (triggerId) return { "aria-labelledby": `${triggerId}-label` }
  if (placeholder) return { "aria-label": placeholder }
  return {}
}

function Select({
  value,
  defaultValue,
  onValueChange,
  disabled,
  children,
  className,
  ...props
}: Omit<React.ComponentProps<typeof HeroSelect>, "value" | "defaultValue" | "onSelectionChange" | "selectedKey" | "children"> & {
  children?: React.ReactNode
  value?: string
  defaultValue?: string
  onValueChange?: (value: string) => void
  disabled?: boolean
}) {
  /* A call site that passes onValueChange is driving the value, so the control
     stays controlled even while nothing is selected — `value={lab || undefined}`
     is a real pattern here and has to mean "no selection", not "uncontrolled".
     react-aria spells that null; undefined would hand the state back to the
     component and warn the moment a value arrived. */
  const controlled = onValueChange !== undefined || value !== undefined

  return (
    <HeroSelect
      data-slot="select"
      className={cn("w-fit", className)}
      isDisabled={disabled}
      {...labellingFrom(children)}
      {...(controlled ? { selectedKey: value ?? null } : {})}
      {...(defaultValue !== undefined ? { defaultSelectedKey: defaultValue } : {})}
      onSelectionChange={(key) => onValueChange?.(key === null ? "" : String(key))}
      {...props}
    >
      {children}
    </HeroSelect>
  )
}

function SelectTrigger({
  className,
  children,
  ...props
}: Omit<React.ComponentProps<typeof HeroSelect.Trigger>, "children"> & {
  children?: React.ReactNode
}) {
  return (
    <HeroSelect.Trigger
      data-slot="select-trigger"
      className={cn("justify-between gap-1.5", className)}
      {...props}
    >
      {children}
      {/* HeroUI paints the chevron in --default-foreground, which its own theme
          pairs with a dark --default. This app keeps its own light surfaces, so
          that lands near-white on white; ink-mute is what the previous chevron
          used. */}
      <HeroSelect.Indicator className="text-ink-mute" />
    </HeroSelect.Trigger>
  )
}

/* Radix carried the placeholder on this element; react-aria carries it on the
   root. Rather than lift it out of ~20 call sites, the render prop answers the
   same question locally: the value slot already knows whether what it is about
   to draw is a real selection. */
function SelectValue({
  className,
  placeholder,
  ...props
}: Omit<React.ComponentProps<typeof HeroSelect.Value>, "children"> & {
  placeholder?: React.ReactNode
}) {
  return (
    <HeroSelect.Value
      data-slot="select-value"
      className={cn("line-clamp-1 text-left", className)}
      {...props}
    >
      {({ isPlaceholder, selectedText }) =>
        isPlaceholder ? <span className="text-ink-mute">{placeholder}</span> : selectedText
      }
    </HeroSelect.Value>
  )
}

function SelectContent({
  className,
  children,
  ...props
}: React.ComponentProps<typeof HeroSelect.Popover>) {
  return (
    <HeroSelect.Popover
      data-slot="select-content"
      /* "start" pins the panel's left edge to the trigger's, the way the old
         one behaved. Flipping stays on: forcing bottom would push the list off
         a short viewport instead of merely looking wrong. */
      placement="bottom start"
      /* Down, always. react-aria would otherwise flip the panel above the
         trigger whenever the space below is tighter than the list — which is
         the behaviour we just left Radix to get away from. With flipping off
         it stays below and react-aria caps the panel to the room that is
         actually there, so a cramped viewport gets a shorter scrolling list
         rather than a list that jumps overhead. */
      shouldFlip={false}
      /* pointer-events-auto is load-bearing, not defensive. Half of these
         selects live inside a Radix dialog or drawer, and a modal Radix layer
         sets `pointer-events: none` on <body>. HeroUI portals its popover to
         the body, outside the dialog's subtree, so it inherits that and the
         panel opens looking perfectly normal while every click passes straight
         through it — the selection silently never happens. Radix's own Select
         escaped this by portalling inside its own layer stack; this one has to
         opt back in. */
      className={cn("pointer-events-auto min-w-(--trigger-width)", className)}
      {...props}
    >
      {/* max-h-[inherit] is what makes the list scroll instead of being cut
          off. react-aria puts an inline max-height on the popover equal to the
          room below the trigger; without inheriting it the list keeps its full
          height, overflows a shorter panel, and the options past the fold
          cannot be reached at all. */}
      <ListBox className="max-h-[inherit] overflow-y-auto">{children}</ListBox>
    </HeroSelect.Popover>
  )
}

function SelectItem({
  className,
  children,
  value,
  textValue,
  ...props
}: Omit<React.ComponentProps<typeof ListBox.Item>, "id" | "children"> & {
  children?: React.ReactNode
  value: string
  textValue?: string
}) {
  return (
    <ListBox.Item
      data-slot="select-item"
      id={value}
      textValue={textValue || textOf(children) || value}
      className={cn(className)}
      {...props}
    >
      <Label>{children}</Label>
      <ListBox.ItemIndicator />
    </ListBox.Item>
  )
}

export { Select, SelectContent, SelectItem, SelectTrigger, SelectValue }
