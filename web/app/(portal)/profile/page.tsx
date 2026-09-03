"use client";

import { Suspense, useMemo, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { StarGlyph } from "@/components/shell/top-nav";
import { EditProfileDialog } from "@/components/bench/edit-profile-dialog";
import { benchRoster, PersonCard } from "@/components/bench/person-card";
import { PencilIcon } from "@/components/community/icons";
import { Panel } from "@/components/community/primitives";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { fullName, initials } from "@/lib/data";
import { roleLine, useMessages } from "@/lib/messages";
import { readPhoto } from "@/lib/photo";
import { usePortalData } from "@/lib/portal-data";
import { cn } from "@/lib/utils";

/* Your profile, as a page rather than the Directory's edit dialog. Every
   section maps onto a field the Person record already carries: name, photo,
   role and labs; the bench blurb and specialties; contact email and phone
   with their visibility toggles; and the account itself.

   The dialog is still the editor — Edit profile opens it — so there is one
   form for the blurb, tags and contact details. The two things a page can do
   better than a dialog are done in place: the photo and the visibility
   toggles each PATCH their own field, because the profile endpoint updates
   only what the body names.

   `?u=<username>` shows someone else's profile. Only an Admin may edit it and
   the server refuses anyone else, so the page hides the controls for a
   non-admin rather than offering a button that will 403. It follows the
   app's `?param` pattern (Community's `?tab=`, Resources' `?r=`) because the
   static export cannot serve a dynamic `/profile/[username]` route. */

export default function ProfilePage() {
  return (
    <Suspense fallback={<p className="text-sm text-ink-mute">Loading…</p>}>
      <Profile />
    </Suspense>
  );
}

function Profile() {
  const params = useSearchParams();
  const { people, labs, me, role, refresh } = usePortalData();
  const { openWith } = useMessages();
  const { logout } = useAuth();

  const requested = params.get("u")?.toLowerCase() || null;
  const username = requested && people[requested] ? requested : me;
  const person = username ? people[username] : undefined;
  const mine = !!username && username === me;
  const canEdit = mine || role === "Admin";

  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState<"photo" | "email" | "phone" | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  /* The same card the Directory draws for this person. Admins are not on the
     bench (benchRoster lists Lab Leaders and Contributors), so for them the
     aside says so instead of drawing a card nobody will see. */
  const card = useMemo(
    () =>
      person && username
        ? benchRoster([{ ...person, username }], labs)[0]
        : undefined,
    [person, username, labs]
  );

  if (!person || !username) {
    return (
      <p className="text-sm text-ink-mute">
        {requested ? "No one in the portal has that username." : "Loading…"}
      </p>
    );
  }

  const name = fullName(person) || username;
  const first = person.firstName || name;
  const path = mine ? "/profile" : `/profile/${username}`;

  const patch = async (
    body: Record<string, unknown>,
    which: "photo" | "email" | "phone",
    done: string
  ) => {
    setBusy(which);
    try {
      await api(path, { method: "PATCH", body: JSON.stringify(body) });
      await refresh();
      toast.success(done);
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : "Could not save that change."
      );
    } finally {
      setBusy(null);
    }
  };

  const onPhotoChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    let photo: string;
    try {
      photo = await readPhoto(file);
    } catch {
      toast.error("Couldn't read that image");
      return;
    }
    await patch({ photo }, "photo", "Photo updated");
  };

  const bench = person.bench;
  const showEmail = bench?.showEmail ?? true;
  const showPhone = bench?.showPhone ?? false;
  const labNames = (person.labs ?? []).map(
    (id) => labs.find((l) => l.id === id)?.name ?? id
  );

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-6">
        <div className="flex min-w-0 items-center gap-6">
          <span className="flex size-[72px] flex-none items-center justify-center overflow-hidden rounded-full border border-hair bg-violet-pale text-2xl font-semibold text-violet-deep sm:size-24">
            {person.photo ? (
              <Image
                src={person.photo}
                alt={name}
                width={96}
                height={96}
                className="size-full object-cover"
              />
            ) : (
              initials(person)
            )}
          </span>
          <div className="min-w-0">
            <span className="inline-flex items-center gap-2 text-[11px] font-semibold tracking-[0.14em] text-warm-gray uppercase">
              <StarGlyph size={13} className="text-violet-deep" />
              {mine ? "Your profile" : "Profile"}
            </span>
            <h1 className="mt-2.5 mb-0 font-serif text-[30px] leading-[1.06] font-normal tracking-[-0.015em] text-ink italic sm:text-[40px]">
              {name}
            </h1>
            <p className="mt-2 mb-0 text-[15px] leading-[1.6] text-ink-soft sm:text-[17px]">
              {roleLine(person, labs)}
            </p>
          </div>
        </div>

        <div className="flex w-full flex-none items-center gap-2.5 pb-1 sm:w-auto">
          {canEdit ? (
            <>
              <button
                type="button"
                onClick={() => setEditing(true)}
                className="flex flex-1 cursor-pointer items-center justify-center gap-2 rounded-full bg-violet-deep px-5 py-[11px] text-sm font-semibold whitespace-nowrap text-white transition-colors hover:bg-violet sm:flex-none"
              >
                <PencilIcon size={15} />
                Edit profile
              </button>
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                disabled={busy === "photo"}
                className="flex-1 cursor-pointer rounded-full border border-hair-strong bg-white px-[18px] py-[11px] text-sm font-medium whitespace-nowrap text-ink-soft transition-colors hover:bg-violet-pale hover:text-violet-deep disabled:cursor-default disabled:opacity-60 sm:flex-none"
              >
                {busy === "photo" ? "Saving…" : "Change photo"}
              </button>
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                onChange={onPhotoChange}
                className="hidden"
                aria-label="Choose a profile photo"
              />
            </>
          ) : (
            <button
              type="button"
              onClick={() => openWith([username])}
              className="flex flex-1 cursor-pointer items-center justify-center gap-2 rounded-full bg-violet-deep px-5 py-[11px] text-sm font-semibold whitespace-nowrap text-white transition-colors hover:bg-violet sm:flex-none"
            >
              Message {first}
            </button>
          )}
        </div>
      </div>

      <div className="grid items-start gap-7 lg:grid-cols-[minmax(0,1fr)_372px]">
        <main className="flex min-w-0 flex-col gap-4">
          <Panel className="p-5">
            <CardHead title="Engage me for">
              {canEdit && <EditLink onClick={() => setEditing(true)} />}
            </CardHead>
            {bench?.blurb ? (
              <p className="m-0 text-[15px] leading-[1.55] text-pretty">
                {bench.blurb}
              </p>
            ) : (
              <p className="m-0 text-[15px] leading-[1.55] text-warm-gray">
                {mine
                  ? "Nothing yet. Add what people should engage you for."
                  : `${first} has not written this yet.`}
              </p>
            )}
            {(bench?.specialties ?? []).length > 0 && (
              <div className="mt-3.5 flex flex-wrap gap-1.5">
                {bench!.specialties!.map((t) => (
                  <span
                    key={t}
                    className="rounded-full border border-hair-strong bg-paper px-3 py-[5px] text-xs font-medium text-ink-soft"
                  >
                    {t}
                  </span>
                ))}
              </div>
            )}
            <CardFoot>
              Shown on the bench card and searched by name, lab, and what you
              do.
            </CardFoot>
          </Panel>

          <Panel className="p-5">
            <CardHead title="Contact & visibility">
              {canEdit && <EditLink onClick={() => setEditing(true)} />}
            </CardHead>
            <ContactRow
              icon="mail"
              value={bench?.email}
              empty="No contact email yet"
              meta={
                showEmail
                  ? "Contact email · shown on the bench"
                  : "Contact email · hidden from the bench"
              }
              on={showEmail}
              busy={busy === "email"}
              canToggle={canEdit}
              label="Show email on the bench"
              onToggle={() =>
                patch(
                  { showEmail: !showEmail },
                  "email",
                  showEmail ? "Email hidden" : "Email shown on the bench"
                )
              }
              divider
            />
            <ContactRow
              icon="phone"
              value={bench?.phone}
              empty="No phone number yet"
              meta={
                showPhone
                  ? "Phone · shown on the bench"
                  : mine
                    ? "Phone · private until you opt in"
                    : "Phone · private unless they opt in"
              }
              on={showPhone}
              busy={busy === "phone"}
              canToggle={canEdit}
              label="Show phone on the bench"
              onToggle={() =>
                patch(
                  { showPhone: !showPhone },
                  "phone",
                  showPhone ? "Phone hidden" : "Phone shown on the bench"
                )
              }
            />
            <CardFoot>
              Visibility is enforced by the server, so anything hidden never
              leaves the API. Admins can still see everything.
            </CardFoot>
          </Panel>

          {mine && (
            <Panel className="p-5">
              <CardHead title="Account" />
              <div className="grid gap-[18px] sm:grid-cols-2">
                <div>
                  <div className="mb-[3px] text-xs text-warm-gray">
                    Signed in as
                  </div>
                  <div className="truncate text-sm text-ink">
                    {person.email || username}
                  </div>
                </div>
                <div>
                  <div className="mb-[3px] text-xs text-warm-gray">Role</div>
                  <div className="flex flex-wrap items-center gap-2 text-sm text-ink">
                    {person.role}
                    {labNames.map((lab) => (
                      <span
                        key={lab}
                        className="inline-flex items-center gap-1.5 rounded-full bg-violet-pale px-[11px] py-1 text-[10px] font-semibold tracking-[0.12em] text-violet-deep uppercase"
                      >
                        <span className="size-1.5 rounded-full bg-violet-deep" />
                        {lab}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
              <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-hair-soft pt-3.5">
                <button
                  type="button"
                  onClick={() => logout()}
                  className="cursor-pointer rounded-full border border-hair-strong bg-white px-[15px] py-[7px] text-xs font-medium text-ink-soft transition-colors hover:bg-violet-pale hover:text-violet-deep"
                >
                  Sign out
                </button>
                <span className="text-[13px] text-warm-gray">
                  Roles and labs are set by an Admin.
                </span>
              </div>
            </Panel>
          )}
        </main>

        <aside className="flex min-w-0 flex-col gap-4">
          <Panel className="p-5">
            <div className="mb-4 flex items-baseline justify-between gap-3">
              <h2 className="m-0 text-base font-bold tracking-[-0.01em]">
                On the bench
              </h2>
              <Link
                href="/bench"
                className="flex-none text-[13px] font-medium text-violet-deep hover:text-violet"
              >
                Directory →
              </Link>
            </div>
            {card ? (
              <>
                <PersonCard
                  person={card}
                  tag={null}
                  mine={mine}
                  canEdit={canEdit}
                  onTag={() => {}}
                  onMessage={() => openWith([username])}
                  onEdit={() => setEditing(true)}
                />
                <CardFoot>
                  {mine
                    ? "Your card exactly as colleagues see it in the Directory and on Community's Members tab."
                    : `${first}'s card as it appears in the Directory.`}
                </CardFoot>
              </>
            ) : (
              <p className="m-0 text-[13px] text-warm-gray">
                Admins are not listed on the bench. The Directory shows Lab
                Leaders and Contributors.
              </p>
            )}
          </Panel>
        </aside>
      </div>

      {canEdit && (
        <EditProfileDialog
          person={person}
          username={username}
          mine={mine}
          open={editing}
          onOpenChange={setEditing}
          onSaved={async () => {
            setEditing(false);
            await refresh();
          }}
        />
      )}
    </>
  );
}

function CardHead({
  title,
  children,
}: {
  title: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="mb-4 flex items-baseline justify-between gap-3">
      <h2 className="m-0 text-base font-bold tracking-[-0.01em]">{title}</h2>
      {children}
    </div>
  );
}

function EditLink({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex-none cursor-pointer text-[13px] font-medium text-violet-deep hover:text-violet"
    >
      Edit
    </button>
  );
}

function CardFoot({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-4 border-t border-hair-soft pt-3.5 text-[13px] text-warm-gray text-pretty">
      {children}
    </div>
  );
}

function ContactIcon({ kind }: { kind: "mail" | "phone" }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {kind === "mail" ? (
        <>
          <rect x="3" y="5" width="18" height="14" rx="2" />
          <path d="m3 7 9 6 9-6" />
        </>
      ) : (
        <path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.9 2z" />
      )}
    </svg>
  );
}

/* One contact line: the value, what its visibility means right now, and the
   switch. The switch reads as chosen by filling violet, never by moving text
   around — the same rule the Community pills follow. */
function ContactRow({
  icon,
  value,
  empty,
  meta,
  on,
  busy,
  canToggle,
  label,
  onToggle,
  divider,
}: {
  icon: "mail" | "phone";
  value?: string;
  empty: string;
  meta: string;
  on: boolean;
  busy: boolean;
  canToggle: boolean;
  label: string;
  onToggle: () => void;
  divider?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex items-center justify-between gap-4 py-3",
        divider && "border-b border-hair-soft"
      )}
    >
      <div className="flex min-w-0 items-center gap-3">
        <span
          className={cn(
            "flex size-[34px] flex-none items-center justify-center rounded-full text-violet-deep",
            on
              ? "bg-violet-pale"
              : "border border-hair-strong bg-paper"
          )}
        >
          <ContactIcon kind={icon} />
        </span>
        <div className="min-w-0">
          <div
            className={cn(
              "truncate text-sm font-semibold",
              value ? "text-ink" : "font-normal text-warm-gray"
            )}
          >
            {value || empty}
          </div>
          <div className="mt-0.5 text-xs text-warm-gray">{meta}</div>
        </div>
      </div>
      <div className="flex flex-none items-center gap-2.5">
        <span
          className={cn(
            "hidden text-xs font-medium sm:block",
            on ? "text-violet-deep" : "text-warm-gray"
          )}
        >
          {on ? "Visible" : "Hidden"}
        </span>
        <button
          type="button"
          role="switch"
          aria-checked={on}
          aria-label={label}
          disabled={!canToggle || busy}
          onClick={onToggle}
          className={cn(
            "relative block h-[22px] w-[38px] flex-none cursor-pointer rounded-full transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-default",
            on ? "bg-violet-deep" : "bg-presence-away",
            busy && "opacity-60"
          )}
        >
          <span
            className={cn(
              "absolute top-0.5 size-[18px] rounded-full bg-white shadow-[0_1px_2px_rgba(17,17,17,0.16)] transition-[left]",
              on ? "left-[18px]" : "left-0.5"
            )}
          />
        </button>
      </div>
    </div>
  );
}
