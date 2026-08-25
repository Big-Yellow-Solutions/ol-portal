"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { PROPOSAL_VARIANT } from "@/lib/data";
import { usePortalData } from "@/lib/portal-data";
import { SECTION_LABELS } from "@/lib/types";
import type { Proposal } from "@/lib/types";

// Admin and Lab Leader now manage proposals from the Pipeline's Deal View
// (Proposal tab) — see components/pipeline/deal-view-proposal-tab.tsx — so
// this page redirects them there and no longer appears in their nav. A
// Contributor has no Pipeline visibility at all (PRD 3.3) and is only ever
// named on a proposal by email, so this remains their one way to see it:
// the read-only card grid below is unchanged.
export default function ProposalsPage() {
  const { loading, error, proposals, role } = usePortalData();
  const [previewing, setPreviewing] = useState<Proposal | null>(null);
  const router = useRouter();

  useEffect(() => {
    if (role && role !== "Contributor") router.replace("/pipeline");
  }, [role, router]);

  if (loading) return <p className="text-sm text-ink-mute">Loading…</p>;
  if (error) return <p className="text-sm text-red">{error}</p>;
  if (role && role !== "Contributor") return null;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-serif text-2xl italic text-ink">Proposals</h1>
        <p className="mt-1 text-sm text-ink-mute">Proposals shared with you.</p>
      </div>

      {proposals.length === 0 ? (
        <p className="text-sm text-ink-mute">You have no proposals shared with you yet.</p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {proposals.map((p) => (
            <Card key={p.id}>
              <CardHeader>
                <CardTitle className="font-serif text-base">{p.title}</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-2 text-sm">
                <div className="text-ink-mute">{p.client}</div>
                <Badge variant={PROPOSAL_VARIANT[p.status]} className="w-fit">
                  {p.status}
                </Badge>
                <Button variant="outline" size="sm" onClick={() => setPreviewing(p)}>
                  Preview
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {previewing && (
        <Dialog open onOpenChange={(open) => !open && setPreviewing(null)}>
          <DialogContent className="sm:max-w-xl">
            <DialogHeader>
              <DialogTitle>{previewing.title}</DialogTitle>
              <DialogDescription>{previewing.client}</DialogDescription>
            </DialogHeader>
            <div className="flex max-h-[60vh] flex-col gap-4 overflow-y-auto">
              {Object.entries(previewing.sections).map(([key, value]) => (
                <div key={key}>
                  <h3 className="font-serif text-sm text-ink">{SECTION_LABELS[key] ?? key}</h3>
                  <p className="mt-1 whitespace-pre-wrap text-sm text-ink-soft">
                    {value || "—"}
                  </p>
                </div>
              ))}
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
