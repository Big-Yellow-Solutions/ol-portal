"use client";

import { useMemo, useState } from "react";
import { PlusIcon, SearchIcon } from "@/components/community/icons";
import { FIELD } from "@/components/community/primitives";
import { EditProfileDialog } from "@/components/bench/edit-profile-dialog";
import { PersonCard } from "@/components/bench/person-card";
import { toast } from "sonner";
import { startActingAs } from "@/lib/act-as";
import { ApiError } from "@/lib/api";
import { EVERYONE, type CommunityLab } from "@/lib/community";
import type { BenchPerson } from "@/lib/data";
import { useMessages } from "@/lib/messages";
import { usePortalData } from "@/lib/portal-data";
import { cn } from "@/lib/utils";

/* Members — the bench, read inside Community.
 *
 * Community v2 makes the roster the fourth tab rather than a separate
 * destination, so the same person card, the same Edit dialog and the same
 * conversation the Directory opens are what this renders: two screens, one
 * roster, no second idea of who a colleague is.
 *
 * Three filters compose — the search box, a tag chip on a card, and this
 * tab's own lab chips. The lab filter lives here rather than being shared
 * with the Feed, so filtering Members never changes what the Feed tab shows,
 * and vice versa.
 */
export function CommunityMembers({
  roster,
  labs,
  lab,
  onPickLab,
}: {
  roster: BenchPerson[];
  labs: CommunityLab[];
  lab: string;
  onPickLab: (name: string) => void;
}) {
  const { people, me, role, refresh } = usePortalData();

  /* Admin "act as", from the card the Admin is already looking at — the other
     way in is the Admin page's user table, and both call the same helper.
     Offered for every card but your own and another Admin's: the server
     refuses both, so the menu simply does not appear. */
  const impersonate = async (username: string, name: string) => {
    try {
      await startActingAs(username, name);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not act as this person.");
    }
  };
  const { openWith, openNew } = useMessages();

  const [query, setQuery] = useState("");
  const [tag, setTag] = useState<string | null>(null);
  const [editingKey, setEditingKey] = useState<string | null>(null);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return roster.filter((p) => {
      if (tag && !p.tags.includes(tag)) return false;
      if (lab !== EVERYONE && !p.labs.includes(lab)) return false;
      if (!q) return true;
      return `${p.name} ${p.role} ${p.engage ?? ""} ${p.tags.join(" ")}`
        .toLowerCase()
        .includes(q);
    });
  }, [roster, query, tag, lab]);

  const filtering = query.trim().length > 0 || !!tag || lab !== EVERYONE;
  const clearAll = () => {
    setQuery("");
    setTag(null);
    onPickLab(EVERYONE);
  };

  const editingPerson = editingKey ? people[editingKey] : null;

  return (
    <>
      <div className="flex flex-wrap items-center gap-3">
        <span className="relative flex min-w-[220px] flex-1 items-center sm:max-w-[420px]">
          <SearchIcon
            size={16}
            className="pointer-events-none absolute left-3.5 text-warm-gray"
          />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name, lab, or what they do…"
            aria-label="Search members"
            className={cn(FIELD, "w-full rounded-[12px] py-3 pr-3.5 pl-10 text-sm")}
          />
        </span>
        <span className="flex-1" />
        <button
          type="button"
          onClick={openNew}
          className="flex flex-none cursor-pointer items-center gap-2 rounded-full bg-violet-deep px-[18px] py-2.5 text-sm font-semibold whitespace-nowrap text-white transition-colors hover:bg-violet"
        >
          <PlusIcon size={15} />
          Start chat
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {labs.map((l) => {
          const on = lab === l.name;
          return (
            <button
              key={l.name}
              type="button"
              aria-pressed={on}
              onClick={() => onPickLab(l.name)}
              className={cn(
                "cursor-pointer rounded-full border px-3.5 py-[7px] text-[13px] transition-colors",
                on
                  ? "border-violet-deep bg-violet-deep font-semibold text-white"
                  : "border-hair-strong bg-white font-medium text-ink-soft hover:bg-wash"
              )}
            >
              {l.name}
            </button>
          );
        })}
      </div>

      {filtering && (
        <span className="flex items-center gap-2.5 text-[13px] text-warm-gray">
          <span>
            {shown.length} {shown.length === 1 ? "person" : "people"}
            {tag ? ` · ${tag}` : ""}
            {lab !== EVERYONE ? ` · ${lab}` : ""}
          </span>
          <button
            type="button"
            onClick={clearAll}
            className="cursor-pointer rounded-full border border-hair-strong bg-white px-3.5 py-1.5 text-xs font-medium text-violet-deep transition-colors hover:bg-violet-pale"
          >
            Clear
          </button>
        </span>
      )}

      {shown.length === 0 ? (
        <div className="rounded-[16px] border border-hair bg-white p-10 text-center text-[15px] text-warm-gray">
          No one matches that yet.{" "}
          <button
            type="button"
            onClick={clearAll}
            className="cursor-pointer text-violet-deep underline-offset-2 hover:underline"
          >
            Clear the search
          </button>
          .
        </div>
      ) : (
        <div className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(288px,1fr))]">
          {shown.map((p) => (
            <PersonCard
              key={p.id}
              person={p}
              tag={tag}
              mine={p.id === me}
              canEdit={p.id === me || role === "Admin"}
              onTag={(t) => setTag((cur) => (cur === t ? null : t))}
              onMessage={() => openWith([p.id])}
              onEdit={() => setEditingKey(p.id)}
              onImpersonate={
                role === "Admin" && p.id !== me && people[p.id]?.role !== "Admin"
                  ? () => impersonate(p.id, p.name)
                  : undefined
              }
            />
          ))}
        </div>
      )}

      {editingPerson && editingKey && (
        <EditProfileDialog
          person={editingPerson}
          username={editingKey}
          mine={editingKey === me}
          open={!!editingKey}
          onOpenChange={(open) => {
            if (!open) setEditingKey(null);
          }}
          onSaved={async () => {
            setEditingKey(null);
            await refresh();
          }}
        />
      )}
    </>
  );
}
