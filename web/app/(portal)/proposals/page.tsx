"use client";

import { useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { PROPOSAL_VARIANT } from "@/lib/data";
import { api, ApiError } from "@/lib/api";
import { usePortalData } from "@/lib/portal-data";
import { SECTION_LABELS } from "@/lib/types";
import type { Proposal } from "@/lib/types";

export default function ProposalsPage() {
  const { loading, error, proposals, labs, role, setProposals } = usePortalData();
  const [sharing, setSharing] = useState<Proposal | null>(null);
  const [previewing, setPreviewing] = useState<Proposal | null>(null);

  const labName = (id: string) => labs.find((l) => l.id === id)?.name ?? id;

  if (loading) return <p className="text-sm text-ink-mute">Loading…</p>;
  if (error) return <p className="text-sm text-red">{error}</p>;

  const isReadOnly = role === "Contributor";
  const canWrite = role === "Admin" || role === "Lab Leader";

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-serif text-2xl italic text-ink">Proposals</h1>
          <p className="mt-1 text-sm text-ink-mute">
            Writing happens in The Optimist — this is the tracking view.
          </p>
        </div>
        {canWrite && (
          <Button asChild>
            <Link href="/optimist?new=1">✦ Write with The Optimist</Link>
          </Button>
        )}
      </div>

      {isReadOnly ? (
        proposals.length === 0 ? (
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
        )
      ) : proposals.length === 0 ? (
        <p className="text-sm text-ink-mute">No proposals yet.</p>
      ) : (
        <div className="overflow-x-auto rounded-md ring-1 ring-foreground/10">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Title</TableHead>
                <TableHead>Client</TableHead>
                <TableHead>Lab</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Contributor</TableHead>
                <TableHead>Updated</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {proposals.map((p) => (
                <TableRow key={p.id}>
                  <TableCell className="font-medium">
                    <Link href={`/optimist?p=${p.id}`} className="hover:text-violet-deep">
                      {p.title}
                    </Link>
                  </TableCell>
                  <TableCell>{p.client}</TableCell>
                  <TableCell>{labName(p.lab)}</TableCell>
                  <TableCell>
                    <Badge variant={PROPOSAL_VARIANT[p.status]}>{p.status}</Badge>
                  </TableCell>
                  <TableCell>
                    <button
                      className="text-left hover:text-violet-deep"
                      onClick={() => setSharing(p)}
                    >
                      {p.contributorName || "— share —"}
                    </button>
                  </TableCell>
                  <TableCell className="text-ink-mute">{p.updated ?? "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {sharing && (
        <ShareDialog
          proposal={sharing}
          open={!!sharing}
          onOpenChange={(open) => !open && setSharing(null)}
          onSaved={(saved) => {
            setProposals((prev) => prev.map((p) => (p.id === saved.id ? saved : p)));
            setSharing(null);
          }}
        />
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

function ShareDialog({
  proposal,
  open,
  onOpenChange,
  onSaved,
}: {
  proposal: Proposal;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: (proposal: Proposal) => void;
}) {
  const [name, setName] = useState(proposal.contributorName ?? "");
  const [email, setEmail] = useState(proposal.contributorEmail ?? "");
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      const saved = await api<Proposal>(`/proposals/${proposal.id}`, {
        method: "PATCH",
        body: JSON.stringify({ contributorName: name, contributorEmail: email }),
      });
      toast.success("Shared with contributor");
      onSaved(saved);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not share this proposal.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Share {proposal.title} with a contributor</DialogTitle>
          <DialogDescription>
            Naming a contributor here makes this proposal visible to them (read-only).
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="share-name">Name</Label>
            <Input id="share-name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="share-email">Email</Label>
            <Input id="share-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button onClick={save} disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
