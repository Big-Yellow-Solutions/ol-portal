"use client";

import * as React from "react";
import { Check } from "lucide-react";
import { Avatar, Description, Label, ListBox } from "@heroui/react";

import { fullName, initials, isActive } from "@/lib/data";
import { roleLine } from "@/lib/messages";
import type { Lab, Person } from "@/lib/types";
import { cn } from "@/lib/utils";

/* The portal's one way of picking a person.

   Every screen that offers people to choose from — the deal's owner and deal
   owner, the pipeline's owner filter, a contract's OL countersignature, the
   lab leaders on an assignment, the people a message goes to — draws the same
   row: photo (initials when there is none), name, and the line underneath
   that says who they are, with a check on whatever is chosen. Before this
   they were four different rows, three of them hand-rolled.

   It is a HeroUI ListBox, the same primitive the shared <Select> already
   renders inside its panel (components/ui/select.tsx). That is what lets one
   row serve both shapes: <PersonItem> drops into a <SelectContent> for the
   dropdown-shaped pickers, and <PersonListBox> stands on its own for the two
   that are a list on the page.

   HeroUI's own colours are deliberately overridden here rather than mapped in
   globals.css: an avatar is violet-pale/violet-deep everywhere else in the
   portal, and the theme names HeroUI would reach for (--default,
   --default-soft-foreground) are its palette, not ours. */

export interface PersonOption {
  /** The person's key — a username or, post-WorkOS, their email. */
  id: string;
  name: string;
  initials: string;
  /** The second line: "Lab Leader · Faith Lab", an email, whatever fits. */
  description?: string;
  photo?: string;
  /** A trailing hint on the row, e.g. "Deal owner". */
  note?: React.ReactNode;
}

/* People, as rows. Offboarded people are dropped the way every other picker
   in the app drops them — they are still in `people` because deals and
   contracts name them, but they are not someone you assign new work to.
   `keep` is the exception that has to exist: whoever a record already names
   stays on the list even after they leave, or reopening that record shows an
   empty control where their name was. */
export function personOptions(
  people: Record<string, Person>,
  {
    labs,
    filter,
    describe,
    keep,
  }: {
    labs?: Lab[];
    filter?: (person: Person, id: string) => boolean;
    /** Overrides the role line — the countersignature picker wants emails. */
    describe?: (person: Person, id: string) => string | undefined;
    keep?: (string | undefined)[];
  } = {}
): PersonOption[] {
  return Object.entries(people)
    .filter(
      ([id, p]) =>
        (isActive(p) || keep?.includes(id)) && (filter?.(p, id) ?? true)
    )
    .map(([id, p]) => ({
      id,
      name: fullName(p) || id,
      initials: initials(p),
      description: describe
        ? describe(p, id)
        : labs
          ? roleLine(p, labs)
          : p.role,
      photo: p.photo,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function PersonAvatar({ person }: { person: PersonOption }) {
  return (
    /* size="sm" is 32px, and HeroUI rounds that one to a true circle already;
       rounded-full is here so the size never has to be the thing keeping it
       round. */
    <Avatar size="sm" className="rounded-full bg-violet-pale">
      {person.photo && <Avatar.Image src={person.photo} alt="" />}
      <Avatar.Fallback className="rounded-full bg-violet-pale text-[10px] font-semibold text-violet-deep">
        {person.initials}
      </Avatar.Fallback>
    </Avatar>
  );
}

/* One row. `textValue` is the bare name on purpose: inside a <Select> it is
   what the closed trigger shows and what typeahead matches, and the whole row
   flattened would read "Nora WeissLab Leader · Faith Lab". */
export function PersonItem({
  person,
  className,
  ...props
}: Omit<React.ComponentProps<typeof ListBox.Item>, "id" | "children"> & {
  person: PersonOption;
}) {
  return (
    <ListBox.Item
      data-slot="person-item"
      id={person.id}
      textValue={person.name}
      className={cn("gap-2.5", className)}
      {...props}
    >
      <PersonAvatar person={person} />
      <div className="flex min-w-0 flex-col">
        <Label className="truncate text-[13px] font-medium text-ink">
          {person.name}
        </Label>
        {person.description && (
          /* HeroUI's description.css is not imported — it paints `text-muted`,
             which in this app is a surface colour, not an ink one. */
          <Description className="truncate text-[11px] leading-[1.35] text-ink-mute">
            {person.description}
          </Description>
        )}
      </div>
      {person.note && (
        <span className="ms-auto shrink-0 text-[10px] font-semibold tracking-wide text-warm-gray uppercase">
          {person.note}
        </span>
      )}
      <ListBox.ItemIndicator>
        {({ isSelected }: { isSelected: boolean }) =>
          isSelected ? <Check className="size-3.5 text-violet-deep" /> : null
        }
      </ListBox.ItemIndicator>
    </ListBox.Item>
  );
}

/* The standing list, for the pickers that are not a dropdown: the assignment
   tab's lab leaders and the new-chat roster.

   Selection is an ordered array rather than react-aria's Set because both
   callers care about the order picked — the chips read left to right in the
   order you added them, the group name is built from the first two, and the
   share rows list leaders in the order they arrived. A Set would hand them
   back in whatever order the collection iterates. */
export function PersonListBox({
  people,
  value,
  onChange,
  className,
  emptyLabel = "No one to pick.",
  ...props
}: Omit<
  React.ComponentProps<typeof ListBox>,
  "children" | "selectedKeys" | "onSelectionChange" | "selectionMode"
> & {
  people: PersonOption[];
  value: string[];
  onChange: (ids: string[]) => void;
  emptyLabel?: React.ReactNode;
}) {
  return (
    <ListBox
      data-slot="person-list-box"
      selectionMode="multiple"
      /* react-aria's default is to CLEAR the selection on Escape. Both of
         these lists sit in something Escape is meant to close — a popover, a
         slide-over — so the default silently throws away everyone you picked
         on the way out. */
      escapeKeyBehavior="none"
      selectedKeys={value}
      onSelectionChange={(keys) => {
        /* Only the rows on screen are up for debate. The new-chat picker
           filters this list as you type, and someone you already added who
           has just been typed out of view must stay added — react-aria only
           ever reports the collection it can see. */
        const visible = new Set(people.map((p) => p.id));
        const chosen =
          keys === "all" ? visible : new Set([...keys].map((k) => String(k)));
        onChange([
          ...value.filter((id) => !visible.has(id) || chosen.has(id)),
          ...[...chosen].filter((id) => !value.includes(id)),
        ]);
      }}
      renderEmptyState={() => (
        <p className="m-0 px-2 py-3.5 text-[13px] text-warm-gray">
          {emptyLabel}
        </p>
      )}
      className={cn("p-0", className)}
      {...props}
    >
      {people.map((p) => (
        <PersonItem key={p.id} person={p} />
      ))}
    </ListBox>
  );
}
