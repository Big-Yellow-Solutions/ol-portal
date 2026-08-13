"use client";

import { useMemo, useState } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { ChevronRightIcon } from "lucide-react";
import {
  DashboardIcon,
  PipelineIcon,
  ProposalsIcon,
  InvoiceRequestsIcon,
  FilesIcon,
  BenchDirectoryIcon,
  OptimistIcon,
  ContractsIcon,
  DealFlowIcon,
  TemplatesIcon,
  LibraryIcon,
  CoursesIcon,
  AdminIcon,
  SignOutIcon,
} from "@/components/shell/portal-icons";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import { usePortalData } from "@/lib/portal-data";
import { useAuth } from "@/lib/auth";
import { fullName } from "@/lib/data";
import { cn } from "@/lib/utils";
import type { Role } from "@/lib/types";

interface NavItem {
  href: string;
  label: string;
  icon: React.ReactNode;
}

interface NavGroup {
  id: string;
  label: string;
  items: NavItem[];
  // Which section stands open on a page that belongs to none of them (the
  // dashboard), so the nav never reads as four closed words.
  defaultOpen?: boolean;
}

// Every entry needs a distinct icon: collapsed to the icon rail, the icon is
// all that's left, so Proposals and Files can't both be a page glyph. The set
// is drawn in portal-icons.tsx rather than pulled from a library so the
// silhouettes stay distinct from each other.
//
// Dashboard sits outside the sections: it is the landing page and the single
// most-visited row, so putting it behind a one-item dropdown would only cost a
// click.
const PINNED: NavItem[] = [
  { href: "/", label: "Dashboard", icon: <DashboardIcon /> },
];

// Sections follow the work, not the build order: win it (Sales), paper and
// deliver it (Operations), learn it (Learning), maintain the machinery
// (Administration). Learning is its own section rather than a corner of
// Operations because for Contributors it is the main reason to sign in.
function navGroups(role: Role | null): NavGroup[] {
  const groups: NavGroup[] = [
    {
      id: "sales",
      label: "Sales",
      defaultOpen: role !== "Contributor",
      items: [
        { href: "/pipeline", label: "Pipeline", icon: <PipelineIcon /> },
        { href: "/proposals", label: "Proposals", icon: <ProposalsIcon /> },
        ...(role !== "Contributor"
          ? [
              {
                href: "/optimist",
                label: "The Optimist",
                icon: <OptimistIcon />,
              },
            ]
          : []),
        // Base Contract PRD FR17: one board showing where every deal actually
        // sits across all labs.
        ...(role === "Admin"
          ? [{ href: "/deal-flow", label: "Deal Flow", icon: <DealFlowIcon /> }]
          : []),
      ],
    },
    {
      id: "operations",
      label: "Operations",
      items: [
        { href: "/contracts", label: "Contracts", icon: <ContractsIcon /> },
        {
          href: "/invoices",
          label: "Invoice Requests",
          icon: <InvoiceRequestsIcon />,
        },
        { href: "/files", label: "Files", icon: <FilesIcon /> },
        {
          href: "/bench",
          label: "Bench Directory",
          icon: <BenchDirectoryIcon />,
        },
      ],
    },
    {
      id: "learning",
      label: "Learning",
      defaultOpen: role === "Contributor",
      items: [
        { href: "/library", label: "Resource Library", icon: <LibraryIcon /> },
        { href: "/courses", label: "Courses", icon: <CoursesIcon /> },
      ],
    },
    {
      id: "administration",
      label: "Administration",
      items:
        role === "Admin"
          ? [
              // PRD FR1/FR12: the reusable content Admins maintain.
              { href: "/templates", label: "Templates", icon: <TemplatesIcon /> },
              { href: "/admin", label: "Admin", icon: <AdminIcon /> },
            ]
          : [],
    },
  ];

  return groups.filter((group) => group.items.length > 0);
}

function isActivePath(pathname: string, href: string) {
  return pathname === href || (href !== "/" && pathname.startsWith(href));
}

function NavLink({ item, active }: { item: NavItem; active: boolean }) {
  return (
    <SidebarMenuItem>
      <SidebarMenuButton asChild isActive={active} tooltip={item.label}>
        <Link href={item.href} aria-current={active ? "page" : undefined}>
          {item.icon}
          <span>{item.label}</span>
        </Link>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

function PortalNav({
  groups,
  pathname,
}: {
  groups: NavGroup[];
  pathname: string;
}) {
  const { state, isMobile } = useSidebar();

  // One section open at a time. The open section is derived from the current
  // page so navigating always reveals where you are; a manual toggle overrides
  // that, but only for as long as you stay on the page you toggled from. No
  // effect needed, and nothing to keep in sync.
  const [override, setOverride] = useState<{
    pathname: string;
    id: string | null;
  } | null>(null);

  const activeGroupId =
    groups.find((group) =>
      group.items.some((item) => isActivePath(pathname, item.href))
    )?.id ?? null;
  const fallbackGroupId = groups.find((group) => group.defaultOpen)?.id ?? null;
  const openId =
    override?.pathname === pathname
      ? override.id
      : (activeGroupId ?? fallbackGroupId);

  // Collapsed to the icon rail there are no labels and no room for section
  // headers, so the rail keeps the flat list it has always had: one tooltipped
  // icon per destination, everything one click away.
  if (state === "collapsed" && !isMobile) {
    const flat = [...PINNED, ...groups.flatMap((group) => group.items)];
    return (
      <SidebarGroup>
        <SidebarGroupContent>
          <SidebarMenu>
            {flat.map((item) => (
              <NavLink
                key={item.href}
                item={item}
                active={isActivePath(pathname, item.href)}
              />
            ))}
          </SidebarMenu>
        </SidebarGroupContent>
      </SidebarGroup>
    );
  }

  return (
    <>
      <SidebarGroup className="pb-1">
        <SidebarGroupContent>
          <SidebarMenu>
            {PINNED.map((item) => (
              <NavLink
                key={item.href}
                item={item}
                active={isActivePath(pathname, item.href)}
              />
            ))}
          </SidebarMenu>
        </SidebarGroupContent>
      </SidebarGroup>

      {groups.map((group) => {
        const hasActive = group.items.some((item) =>
          isActivePath(pathname, item.href)
        );
        return (
          <Collapsible
            key={group.id}
            open={openId === group.id}
            onOpenChange={(open) =>
              setOverride({ pathname, id: open ? group.id : null })
            }
            className="group/nav-section"
          >
            <SidebarGroup className="py-0.5">
              <SidebarGroupLabel asChild>
                <CollapsibleTrigger
                  className={cn(
                    "w-full cursor-pointer gap-2 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                    // A section can be closed over the page you are on; keep a
                    // trace of it in the header rather than losing it entirely.
                    hasActive && "text-sidebar-foreground"
                  )}
                >
                  <span className="truncate">{group.label}</span>
                  <ChevronRightIcon className="ml-auto transition-transform duration-200 group-data-[state=open]/nav-section:rotate-90 motion-reduce:transition-none" />
                </CollapsibleTrigger>
              </SidebarGroupLabel>
              <CollapsibleContent className="overflow-hidden data-[state=closed]:animate-collapsible-up data-[state=open]:animate-collapsible-down motion-reduce:animate-none">
                <SidebarGroupContent>
                  <SidebarMenu className="ml-2.5 border-l border-sidebar-border pl-1.5">
                    {group.items.map((item) => (
                      <NavLink
                        key={item.href}
                        item={item}
                        active={isActivePath(pathname, item.href)}
                      />
                    ))}
                  </SidebarMenu>
                </SidebarGroupContent>
              </CollapsibleContent>
            </SidebarGroup>
          </Collapsible>
        );
      })}
    </>
  );
}

export function AppSidebar() {
  const pathname = usePathname();
  const { role, people, me } = usePortalData();
  const { logout } = useAuth();

  const groups = useMemo(() => navGroups(role), [role]);
  const meRecord = me ? people[me] : undefined;

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <div className="flex items-center gap-2 px-2 py-1">
          <Image
            src="/ol-mark-white.svg"
            alt=""
            width={24}
            height={24}
            className="size-6 shrink-0"
          />
          <span className="truncate font-serif text-sm italic group-data-[collapsible=icon]:hidden">
            The Portal
          </span>
        </div>
      </SidebarHeader>

      <SidebarContent>
        <PortalNav groups={groups} pathname={pathname} />
      </SidebarContent>

      <SidebarFooter>
        <div className="truncate px-2 text-xs text-sidebar-foreground/70 group-data-[collapsible=icon]:hidden">
          Signed in as {fullName(meRecord) || me}
        </div>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton onClick={() => logout()} tooltip="Sign out">
              <SignOutIcon />
              <span>Sign out</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
