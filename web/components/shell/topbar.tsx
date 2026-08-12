"use client";

import { usePathname } from "next/navigation";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
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
  "/admin": "Admin & Invites",
};

export function Topbar() {
  const pathname = usePathname();
  const { role, people, me } = usePortalData();
  const meRecord = me ? people[me] : undefined;
  const title = TITLES[pathname] ?? "";

  return (
    <header className="sticky top-0 z-10 flex h-16 items-center justify-between border-b border-hair bg-white px-4 md:px-8">
      <span className="font-serif text-lg text-ink">{title}</span>
      <div className="flex items-center gap-3">
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
