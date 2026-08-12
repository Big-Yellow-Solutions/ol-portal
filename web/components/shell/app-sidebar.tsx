"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import Image from "next/image";
import {
  LayoutDashboard,
  KanbanSquare,
  FileText,
  Receipt,
  Users,
  Sparkles,
  FileSignature,
  ShieldCheck,
  LogOut,
} from "lucide-react";
import { Sidebar, SidebarBody, SidebarLink } from "@/components/ui/sidebar";
import { usePortalData } from "@/lib/portal-data";
import { useAuth } from "@/lib/auth";
import { fullName } from "@/lib/data";
import { cn } from "@/lib/utils";

interface NavItem {
  href: string;
  label: string;
  icon: React.ReactNode;
}

const iconClass = "h-5 w-5 flex-shrink-0";

const BASE_NAV: NavItem[] = [
  { href: "/", label: "Dashboard", icon: <LayoutDashboard className={iconClass} /> },
  { href: "/pipeline", label: "Pipeline", icon: <KanbanSquare className={iconClass} /> },
  { href: "/proposals", label: "Proposals", icon: <FileText className={iconClass} /> },
  { href: "/invoices", label: "Invoice Requests", icon: <Receipt className={iconClass} /> },
  { href: "/files", label: "Files", icon: <FileText className={iconClass} /> },
  { href: "/bench", label: "Bench Directory", icon: <Users className={iconClass} /> },
];

export function AppSidebar() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const { role, people, me } = usePortalData();
  const { logout } = useAuth();

  const nav: NavItem[] = [...BASE_NAV];
  if (role !== "Contributor") {
    nav.splice(3, 0, {
      href: "/optimist",
      label: "The Optimist",
      icon: <Sparkles className={iconClass} />,
    });
  }
  nav.push({
    href: "/contracts",
    label: "Contracts",
    icon: <FileSignature className={iconClass} />,
  });
  if (role === "Admin") {
    nav.push({
      href: "/admin",
      label: "Admin",
      icon: <ShieldCheck className={iconClass} />,
    });
  }

  const meRecord = me ? people[me] : undefined;

  return (
    <Sidebar open={open} setOpen={setOpen}>
      <SidebarBody className="justify-between gap-10 bg-violet-deep dark:bg-violet-deep text-white">
        <div className="flex flex-col flex-1 overflow-y-auto overflow-x-hidden">
          <div className="flex items-center gap-2 py-1">
            <Image
              src="/ol-mark-white.svg"
              alt=""
              width={24}
              height={24}
              className="h-6 w-6 flex-shrink-0"
            />
            <span
              className={cn(
                "font-serif italic text-white whitespace-pre text-sm",
                !open && "hidden"
              )}
            >
              The Portal
            </span>
          </div>
          <div
            className={cn(
              "mt-8 mb-2 text-xs uppercase tracking-wide text-white/75",
              !open && "hidden"
            )}
          >
            Workspace
          </div>
          <div className="mt-2 flex flex-col gap-1">
            {nav.map((item) => {
              const active =
                pathname === item.href ||
                (item.href !== "/" && pathname.startsWith(item.href));
              return (
                <SidebarLink
                  key={item.href}
                  link={item}
                  className={cn(
                    "rounded-md px-2 text-white/80 hover:text-white",
                    active && "bg-white/10 text-white"
                  )}
                />
              );
            })}
          </div>
        </div>
        <div className="border-t border-white/10 pt-4 text-xs text-white/70">
          <div className={cn("mb-2 truncate", !open && "hidden")}>
            Signed in as {fullName(meRecord) || me}
          </div>
          <button
            onClick={() => logout()}
            className="flex items-center gap-2 text-white/80 hover:text-white"
          >
            <LogOut className={iconClass} />
            <span className={cn(!open && "hidden")}>Sign out</span>
          </button>
        </div>
      </SidebarBody>
    </Sidebar>
  );
}
