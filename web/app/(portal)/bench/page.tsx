"use client";

import { useMemo, useState } from "react";
import { PlusIcon, SearchIcon } from "@/components/community/icons";
import { FIELD } from "@/components/community/primitives";
import { EditProfileDialog } from "@/components/bench/edit-profile-dialog";
import { benchRoster, PersonCard } from "@/components/bench/person-card";
import { useMessages } from "@/lib/messages";
import { usePortalData } from "@/lib/portal-data";
import { cn } from "@/lib/utils";

/* The bench, rebuilt from the Claude Design artboard "Directory".
 *
 * One screen, one question: who do I bring in, and how do I reach them. So
 * the old filter rail — Everyone / Lab Leaders / Contributors / every lab /
 * every tag, twenty-odd chips above the grid — is gone. Search reads name,
 * role, lab, the engage line and the tags together, which is what the design's
 * placeholder promises, and the only chips left are the ones on the cards,
 * where a specialty is something you noticed on a person rather than a facet
 * you went looking for.
 *
 * Presence dots are the one thing in the artboard that is deliberately not
 * drawn: nothing in the API says whether a colleague is online, and a violet
 * dot that means nothing is worse than no dot. When a presence source exists,
 * it goes on the avatar the way Home already draws it.
 */

export default function BenchPage() {
  const { loading, error, labs, people, bench, role, me, refresh } =
    usePortalData();
  const { openWith, openNew } = useMessages();

  const [query, setQuery] = useState("");
  const [tag, setTag] = useState<string | null>(null);
  const [editingKey, setEditingKey] = useState<string | null>(null);

  /* The same roster Community's Members tab reads — see benchRoster. */
  const roster = useMemo(() => benchRoster(bench, labs), [bench, labs]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return roster.filter((p) => {
      if (tag && !p.tags.includes(tag)) return false;
      if (!q) return true;
      return `${p.name} ${p.role} ${p.engage ?? ""} ${p.tags.join(" ")}`
        .toLowerCase()
        .includes(q);
    });
  }, [roster, query, tag]);

  const filtering = query.trim().length > 0 || !!tag;
  const clearAll = () => {
    setQuery("");
    setTag(null);
  };

  const editingPerson = editingKey ? people[editingKey] : null;

  if (loading) return <p className="text-sm text-ink-mute">Loading…</p>;
  if (error) return <p className="text-sm text-red">{error}</p>;

  return (
    <>
      <div className="flex flex-col items-start justify-between gap-[18px] min-[1001px]:flex-row min-[1001px]:items-end">
        <div className="max-w-[620px]">
          <h1 className="m-0 mb-2.5 font-serif text-[30px] leading-[1.06] font-normal tracking-[-0.015em] text-ink italic sm:text-[40px]">
            The bench
          </h1>
          <p className="m-0 text-[17px] leading-[1.6] text-ink-soft text-pretty">
            All Lab Leaders and Contributors across Optimistic Labs
          </p>
        </div>
        <div className="flex flex-none items-center gap-2.5 pb-1">
          <button
            type="button"
            onClick={openNew}
            className="flex cursor-pointer items-center gap-2 rounded-full bg-violet-deep px-5 py-[11px] text-sm font-semibold whitespace-nowrap text-white transition-colors hover:bg-violet"
          >
            <PlusIcon size={15} />
            Start chat
          </button>
          {me && people[me] && (
            <button
              type="button"
              onClick={() => setEditingKey(me)}
              className="cursor-pointer rounded-full border border-hair-strong bg-white px-[18px] py-[11px] text-sm font-medium whitespace-nowrap text-ink-soft transition-colors hover:bg-violet-pale hover:text-violet-deep"
            >
              Edit my profile
            </button>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <span className="relative flex min-w-[260px] flex-1 items-center sm:max-w-[460px]">
          <SearchIcon
            size={16}
            className="pointer-events-none absolute left-3.5 text-warm-gray"
          />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name, lab, or what they do…"
            aria-label="Search the bench"
            className={cn(FIELD, "w-full rounded-[12px] py-3 pr-3.5 pl-10 text-sm")}
          />
        </span>
        {filtering && (
          <span className="flex items-center gap-2.5 text-[13px] text-warm-gray">
            <span>
              {shown.length} {shown.length === 1 ? "person" : "people"}
              {tag ? ` · ${tag}` : ""}
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
      </div>

      {shown.length === 0 ? (
        <div className="rounded-[16px] border border-hair bg-white p-10 text-center text-[15px] text-warm-gray">
          No one on the bench matches that yet.{" "}
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
        <div className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(340px,1fr))] max-[1000px]:grid-cols-1">
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
            />
          ))}
        </div>
      )}

      <p className="max-w-[720px] text-xs text-warm-gray text-pretty">
        Everyone edits their own profile; admins can edit any. Contact
        visibility is per-person: your email shows unless you hide it, your
        phone stays private until you opt in — and the server enforces it, so
        hidden details never leave the API.
      </p>

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
