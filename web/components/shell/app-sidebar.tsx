"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
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
  AdminIcon,
  SignOutIcon,
} from "@/components/shell/portal-icons";
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
} from "@/components/ui/sidebar";
import { usePortalData } from "@/lib/portal-data";
import { useAuth } from "@/lib/auth";
import { fullName } from "@/lib/data";

interface NavItem {
  href: string;
  label: string;
  icon: React.ReactNode;
}

// Every entry needs a distinct icon: collapsed to the icon rail, the icon is
// all that's left, so Proposals and Files can't both be a page glyph. The set
// is drawn in portal-icons.tsx rather than pulled from a library so the
// silhouettes stay distinct from each other.
const BASE_NAV: NavItem[] = [
  { href: "/", label: "Dashboard", icon: <DashboardIcon /> },
  { href: "/pipeline", label: "Pipeline", icon: <PipelineIcon /> },
  { href: "/proposals", label: "Proposals", icon: <ProposalsIcon /> },
  { href: "/invoices", label: "Invoice Requests", icon: <InvoiceRequestsIcon /> },
  { href: "/files", label: "Files", icon: <FilesIcon /> },
  { href: "/bench", label: "Bench Directory", icon: <BenchDirectoryIcon /> },
];

export function AppSidebar() {
  const pathname = usePathname();
  const { role, people, me } = usePortalData();
  const { logout } = useAuth();

  const nav: NavItem[] = [...BASE_NAV];
  if (role !== "Contributor") {
    nav.splice(3, 0, {
      href: "/optimist",
      label: "The Optimist",
      icon: <OptimistIcon />,
    });
  }
  nav.push({
    href: "/contracts",
    label: "Contracts",
    icon: <ContractsIcon />,
  });
  if (role === "Admin") {
    // Base Contract PRD FR17: one board showing where every deal actually sits
    // across all labs, and FR1/FR12: the reusable content Admins maintain.
    nav.push({
      href: "/deal-flow",
      label: "Deal Flow",
      icon: <DealFlowIcon />,
    });
    nav.push({
      href: "/templates",
      label: "Templates",
      icon: <TemplatesIcon />,
    });
    nav.push({
      href: "/admin",
      label: "Admin",
      icon: <AdminIcon />,
    });
  }

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
        <SidebarGroup>
          <SidebarGroupLabel>Workspace</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {nav.map((item) => {
                const active =
                  pathname === item.href ||
                  (item.href !== "/" && pathname.startsWith(item.href));
                return (
                  <SidebarMenuItem key={item.href}>
                    <SidebarMenuButton
                      asChild
                      isActive={active}
                      tooltip={item.label}
                    >
                      <Link href={item.href}>
                        {item.icon}
                        <span>{item.label}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
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
