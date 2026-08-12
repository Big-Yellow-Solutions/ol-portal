"use client";

import { usePathname } from "next/navigation";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Separator } from "@/components/ui/separator";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { usePortalData } from "@/lib/portal-data";
import { initials } from "@/lib/data";

const TITLES: Record<string, string> = {
  "/": "Dashboard",
  "/pipeline": "Pipeline",
  "/proposals": "Proposals",
  "/invoices": "Invoice Requests",
  "/files": "Files",
  "/bench": "Bench Directory",
  "/optimist": "The Optimist",
  "/contracts": "Contracts",
  "/deal-flow": "Deal Flow",
  "/templates": "Templates",
  "/admin": "Admin & Invites",
};

export function Topbar() {
  const pathname = usePathname();
  const { role, people, me } = usePortalData();
  const meRecord = me ? people[me] : undefined;
  const title = TITLES[pathname] ?? "";

  return (
    <header className="sticky top-0 z-10 flex h-16 items-center justify-between gap-2 border-b border-hair bg-white px-4 md:px-8">
      <div className="flex min-w-0 items-center gap-2">
        <SidebarTrigger />
        <Separator orientation="vertical" className="mr-1 h-4" />
        <span className="truncate font-serif text-lg text-ink">{title}</span>
      </div>
      <div className="flex shrink-0 items-center gap-3">
        {role && (
          <span className="hidden text-sm text-ink-mute sm:inline">{role}</span>
        )}
        <Avatar className="h-8 w-8">
          {meRecord?.photo && <AvatarImage src={meRecord.photo} alt="" />}
          <AvatarFallback className="bg-violet-pale text-violet-deep">
            {initials(meRecord)}
          </AvatarFallback>
        </Avatar>
      </div>
    </header>
  );
}
