"use client";

import { useMemo, useState } from "react";
import { CloseIcon } from "@/components/community/icons";
import { FIELD } from "@/components/community/primitives";
import { PersonListBox } from "@/components/ui/person-select";
import { useMessages } from "@/lib/messages";
import { cn } from "@/lib/utils";

/* New-chat mode: one picker for both outcomes. Pick one person and it is a
   DM; pick more and a group-name field appears and the CTA changes under it,
   so nobody has to choose "DM or group" before choosing people. */

const PILL_INPUT = "w-full rounded-[12px] px-[13px] py-[11px] text-sm";

export function NewChat() {
  const { directory, openWith, groupPlaceholder } = useMessages();
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [groupName, setGroupName] = useState("");

  /* MessagePerson is already the picker's row shape — id, name, initials,
     photo — with `role` carrying the "Lab Leader · Faith Lab" line. */
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return directory
      .filter((p) => !q || `${p.name} ${p.role}`.toLowerCase().includes(q))
      .map((p) => ({
        id: p.id,
        name: p.name,
        initials: p.initials,
        description: p.role,
        photo: p.photo,
      }));
  }, [directory, query]);

  const toggle = (id: string) =>
    setPicked((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );

  const count = picked.length;
  const isGroup = count > 1;
  const placeholder = isGroup ? groupPlaceholder(picked) : "Group name";

  return (
    <>
      <div className="flex-1 overflow-y-auto px-[18px] py-4">
        {count > 0 && (
          <div className="mb-3.5 flex flex-wrap gap-1.5">
            {picked.map((id) => (
              <PickedChip key={id} id={id} onRemove={() => toggle(id)} />
            ))}
          </div>
        )}

        {isGroup && (
          <label className="mb-3.5 block">
            <span className="mb-[7px] block text-[11px] font-semibold tracking-[0.1em] text-warm-gray uppercase">
              Group name{" "}
              <span className="font-medium tracking-normal normal-case">
                — optional
              </span>
            </span>
            <input
              value={groupName}
              onChange={(e) => setGroupName(e.target.value)}
              placeholder={placeholder}
              className={cn(FIELD, PILL_INPUT)}
            />
          </label>
        )}

        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search people to add…"
          aria-label="Search people to add"
          className={cn(FIELD, PILL_INPUT, "mb-1.5")}
        />

        <PersonListBox
          aria-label="People to add"
          people={shown}
          value={picked}
          onChange={setPicked}
          emptyLabel="No one by that name."
          className="-mx-2"
        />
      </div>

      <div className="flex flex-none items-center gap-3 border-t border-hair px-[18px] pt-3.5 pb-[18px]">
        <span className="flex-1 text-xs text-warm-gray">
          {count === 0
            ? "No one added yet"
            : count === 1
              ? "Direct message"
              : `${count} people · group chat`}
        </span>
        <button
          type="button"
          aria-disabled={count === 0}
          onClick={() => {
            if (count === 0) return;
            openWith(picked, isGroup ? groupName : "");
          }}
          className={cn(
            "flex-none rounded-full px-5 py-[11px] text-sm font-semibold whitespace-nowrap transition-colors",
            count > 0
              ? "cursor-pointer bg-violet-deep text-white hover:bg-violet"
              : "cursor-default bg-violet-pale text-violet-light"
          )}
        >
          {isGroup ? "Start group" : "Start chat"}
        </button>
      </div>
    </>
  );
}

function PickedChip({ id, onRemove }: { id: string; onRemove: () => void }) {
  const { person } = useMessages();
  return (
    <button
      type="button"
      onClick={onRemove}
      aria-label={`Remove ${person(id).name}`}
      className="flex cursor-pointer items-center gap-1.5 rounded-full border border-violet-deep bg-violet-pale px-3 py-1.5 text-xs font-semibold text-violet-deep"
    >
      {person(id).name}
      <CloseIcon size={11} />
    </button>
  );
}
