"use client";

import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useMessages } from "@/lib/messages";
import { usePortalData } from "@/lib/portal-data";
import { useAuth } from "@/lib/auth";
import { fullName, initials } from "@/lib/data";
import { cn } from "@/lib/utils";
import type { Role } from "@/lib/types";

/* The Portal's chrome, rebuilt from the Claude Design project. The violet
   sidebar rail is gone: every artboard draws a sticky horizontal nav over the
   paper background, with the brand lockup on the left, pill links in the
   middle, and presence + identity on the right.

   The nav is three destinations: Community, Pipeline, Resources. Community
   is also the landing page, so it and the logo lead to the same screen.
   There is no "More" — every other page is reached by its URL or by the
   in-app links that already point at it, not from here. Deliberate: the
   routes all still exist and still enforce their own roles, so this is a
   change to what the nav advertises, not to what anyone may open. */

interface NavItem {
  href: string;
  label: string;
  /* Other paths this item is the current page for. Community is the portal's
     landing page, so it answers at "/" and at the "/community" URL its own
     deep links still use. */
  also?: string[];
  /* Undefined means "everyone". */
  roles?: Role[];
}

const PRIMARY: NavItem[] = [
  { href: "/", label: "Community", also: ["/community"] },
  { href: "/pipeline", label: "Pipeline" },
  { href: "/resources", label: "Resources" },
];

function visible(items: NavItem[], role: Role | null) {
  return items.filter((item) => !item.roles || (role && item.roles.includes(role)));
}

function owns(pathname: string, path: string) {
  if (pathname === path) return true;
  // "/" is every path's prefix, so it only ever matches exactly.
  return path !== "/" && pathname.startsWith(`${path}/`);
}

function isActivePath(pathname: string, item: NavItem) {
  return owns(pathname, item.href) || (item.also ?? []).some(p => owns(pathname, p));
}

// The 8-point star, the design system's eyebrow glyph and section divider.
// Exported because every page's eyebrow uses it.
export function StarGlyph({
  size = 11,
  className,
}: {
  size?: number;
  className?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 733 733"
      fill="none"
      aria-hidden="true"
      className={cn("flex-none", className)}
    >
      <path
        d="M365.401 0.547271L372.871 204.253C375.973 288.93 444.191 356.731 528.884 359.313L732.573 365.555L528.867 373.025C444.191 376.127 376.39 444.345 373.808 529.038L367.565 732.728L360.095 529.022C356.994 444.345 288.775 376.544 204.083 373.962L0.393095 367.72L204.099 360.249C288.776 357.148 356.576 288.93 359.158 204.237L365.401 0.547271Z"
        fill="currentColor"
      />
    </svg>
  );
}

function MessageIcon() {
  return (
    <svg
      width="19"
      height="19"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 9.9 9.9 0 0 1-3.2-.5L3 21l1.6-4.6A8.4 8.4 0 0 1 12 3.1a8.4 8.4 0 0 1 9 8.4z" />
    </svg>
  );
}

function BellIcon() {
  return (
    <svg
      width="19"
      height="19"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M18 8a6 6 0 1 0-12 0c0 7-3 8-3 8h18s-3-1-3-8" />
      <path d="M13.7 21a2 2 0 0 1-3.4 0" />
    </svg>
  );
}

const PILL =
  "flex-none rounded-full px-[15px] py-[9px] text-sm whitespace-nowrap transition-colors";

function NavPill({ item, active }: { item: NavItem; active: boolean }) {
  return (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      className={cn(
        PILL,
        active
          ? "bg-violet-pale font-semibold text-violet-deep"
          : "font-medium text-ink-soft hover:bg-wash hover:text-violet-deep"
      )}
    >
      {item.label}
    </Link>
  );
}

export function TopNav() {
  const pathname = usePathname();
  const router = useRouter();
  const { role, people, me } = usePortalData();
  const { openList } = useMessages();
  const { logout } = useAuth();
  const meRecord = me ? people[me] : undefined;

  const primary = visible(PRIMARY, role);

  return (
    <header className="sticky top-0 z-40 border-b border-hair bg-paper/92 backdrop-blur-[8px]">
      <div className="mx-auto flex max-w-[1420px] items-center gap-[26px] px-4 py-3.5 md:px-8">
        {/* The logo carries the left of the bar on its own now: the "The
            Portal" wordmark and the rule that separated it are gone, so it is
            sized to hold that space rather than share it. */}
        <Link href="/" className="flex flex-none items-center" aria-label="Optimistic Labs">
          <Image
            src="/ol-logo.svg"
            alt="Optimistic Labs"
            width={104}
            height={36}
            className="h-9 w-auto"
            priority
          />
        </Link>

        <nav
          aria-label="Primary"
          className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto"
        >
          {primary.map((item) => (
            <NavPill
              key={item.href}
              item={item}
              active={isActivePath(pathname, item)}
            />
          ))}
        </nav>

        <div className="flex flex-none items-center gap-[18px]">
          <button
            type="button"
            onClick={openList}
            aria-label="Messages"
            className="relative flex cursor-pointer items-center text-ink transition-colors hover:text-violet-deep"
          >
            <MessageIcon />
            <span
              aria-hidden="true"
              className="absolute -top-0.5 -right-[3px] size-[7px] rounded-full bg-violet-deep"
            />
          </button>

          <span className="relative hidden items-center text-ink sm:flex">
            <BellIcon />
            <span
              aria-hidden="true"
              className="absolute -top-0.5 -right-[3px] size-[7px] rounded-full bg-violet-deep"
            />
          </span>

          <DropdownMenu>
            <DropdownMenuTrigger className="flex items-center gap-2.5 rounded-full outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
              <span className="flex size-[34px] flex-none items-center justify-center overflow-hidden rounded-full bg-violet-deep text-[13px] font-semibold text-white">
                {meRecord?.photo ? (
                  <Image
                    src={meRecord.photo}
                    alt=""
                    width={34}
                    height={34}
                    className="size-full object-cover"
                  />
                ) : (
                  initials(meRecord)
                )}
              </span>
              <span className="hidden text-sm font-medium whitespace-nowrap lg:block">
                {fullName(meRecord) || me}
              </span>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-52">
              <div className="px-2 py-1.5">
                <div className="truncate text-sm font-medium">
                  {fullName(meRecord) || me}
                </div>
                {role && <div className="text-xs text-ink-mute">{role}</div>}
              </div>
              <DropdownMenuItem onSelect={() => router.push("/profile")}>
                Your profile
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => logout()}>
                Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </header>
  );
}
