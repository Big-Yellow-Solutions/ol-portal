"use client"

import * as React from "react"
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp } from "lucide-react"
import { DayPicker, type ChevronProps } from "react-day-picker"

import { cn } from "@/lib/utils"
import { buttonVariants } from "@/components/ui/button"

export type CalendarProps = React.ComponentProps<typeof DayPicker>

function CalendarChevron({ orientation, className }: ChevronProps) {
  const Icon =
    orientation === "left"
      ? ChevronLeft
      : orientation === "up"
        ? ChevronUp
        : orientation === "down"
          ? ChevronDown
          : ChevronRight

  return <Icon className={cn("size-4", className)} />
}

function Calendar({
  className,
  classNames,
  showOutsideDays = true,
  ...props
}: CalendarProps) {
  return (
    <DayPicker
      data-slot="calendar"
      showOutsideDays={showOutsideDays}
      className={cn("p-3", className)}
      classNames={{
        months: "relative flex flex-col gap-4 sm:flex-row",
        month: "flex flex-col gap-4",
        month_caption: "flex h-7 items-center justify-center",
        caption_label: "text-sm font-medium",
        nav: "absolute inset-x-0 top-0 flex items-center justify-between",
        button_previous: cn(
          buttonVariants({ variant: "outline" }),
          "size-7 bg-transparent p-0 opacity-50 hover:opacity-100 aria-disabled:pointer-events-none aria-disabled:opacity-30"
        ),
        button_next: cn(
          buttonVariants({ variant: "outline" }),
          "size-7 bg-transparent p-0 opacity-50 hover:opacity-100 aria-disabled:pointer-events-none aria-disabled:opacity-30"
        ),
        chevron: "size-4",
        month_grid: "w-full border-collapse",
        weekdays: "flex",
        weekday:
          "w-9 rounded-md text-[0.8rem] font-normal text-muted-foreground",
        week: "mt-2 flex w-full",
        // The modifier classes below are merged onto this same <td>.
        day: cn(
          "group/day relative size-9 p-0 text-center text-sm",
          "focus-within:relative focus-within:z-20",
          "data-[selected=true]:bg-accent",
          "first:data-[selected=true]:rounded-l-md last:data-[selected=true]:rounded-r-md"
        ),
        day_button: cn(
          buttonVariants({ variant: "ghost" }),
          "size-9 p-0 font-normal",
          "group-data-[selected=true]/day:bg-primary group-data-[selected=true]/day:text-primary-foreground",
          "group-data-[selected=true]/day:hover:bg-primary group-data-[selected=true]/day:hover:text-primary-foreground"
        ),
        // `today` sits on the cell so a selected day's button paints over it.
        today: "rounded-md bg-accent text-accent-foreground",
        selected: "",
        range_start: "rounded-l-md",
        range_end: "rounded-r-md",
        // `!` keeps this ahead of the selected styles on the same button.
        range_middle:
          "[&>button]:bg-accent! [&>button]:text-accent-foreground! [&>button]:hover:bg-accent!",
        outside: "text-muted-foreground data-[selected=true]:bg-accent/50",
        disabled: "text-muted-foreground opacity-50",
        hidden: "invisible",
        ...classNames,
      }}
      components={{
        Chevron: CalendarChevron,
      }}
      {...props}
    />
  )
}
Calendar.displayName = "Calendar"

export { Calendar }
