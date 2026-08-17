"use client";

import { useMemo } from "react";
import { usePathname } from "next/navigation";
import { CircleHelpIcon } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { usePortalData } from "@/lib/portal-data";

// Mirrors app-sidebar.tsx's nav hrefs: the first path segment is the page key
// a GUIDE record is stored under ("dashboard" for the root page, since "/"
// has no segment of its own).
function pageKeyFor(pathname: string): string {
  const segment = pathname.split("/").filter(Boolean)[0];
  return segment ?? "dashboard";
}

/* A small persistent "?" tab, bottom-right on every portal page, that opens a
   side panel explaining what the current page is for. Content is fetched
   once with the rest of bootstrap (lib/portal-data.tsx) and already
   role-filtered server-side, so there's nothing else to gate here. Renders
   nothing if this page has no guide yet rather than showing an empty panel. */
export function HelpWidget() {
  const pathname = usePathname();
  const { guides } = usePortalData();
  const pageKey = pageKeyFor(pathname);
  const guide = useMemo(
    () => guides.find((g) => g.page === pageKey),
    [guides, pageKey]
  );

  if (!guide) return null;

  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button
          variant="secondary"
          size="icon-lg"
          className="fixed right-5 bottom-5 z-40 rounded-full shadow-lg"
          aria-label={`Help for this page: ${guide.title}`}
        >
          <CircleHelpIcon />
        </Button>
      </SheetTrigger>
      <SheetContent className="overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="font-serif text-lg italic">
            {guide.title}
          </SheetTitle>
          <SheetDescription>{guide.summary}</SheetDescription>
        </SheetHeader>
        <div className="flex flex-col gap-4 px-4 pb-4">
          {guide.sections.map((section) => (
            <div key={section.heading} className="flex flex-col gap-1">
              <h3 className="text-sm font-medium text-foreground">
                {section.heading}
              </h3>
              <p className="text-sm whitespace-pre-line text-muted-foreground">
                {section.body}
              </p>
            </div>
          ))}
        </div>
      </SheetContent>
    </Sheet>
  );
}
