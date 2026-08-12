"use client";

import { useState } from "react";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { CONTRACT_VARIANT, fmtDollars, fullName } from "@/lib/data";
import { api, ApiError } from "@/lib/api";
import { usePortalData } from "@/lib/portal-data";
import type { Contract, ContractStatus } from "@/lib/types";

const CONTRACT_STATUSES: ContractStatus[] = ["Draft", "Internal Review", "Sent", "Signed"];

export default function ContractsPage() {
  const { loading, error, contracts, labs, people, role, me, setContracts } = usePortalData();
  const [editing, setEditing] = useState<Contract | null>(null);
  const [inviting, setInviting] = useState<Contract | null>(null);

  const labName = (id: string) => labs.find((l) => l.id === id)?.name ?? id;
  const personName = (username?: string) =>
    username ? fullName(people[username]) || username : "—";

  if (loading) return <p className="text-sm text-ink-mute">Loading…</p>;
  if (error) return <p className="text-sm text-red">{error}</p>;

  const isReadOnly = role === "Contributor";

  const setStatus = async (contract: Contract, status: ContractStatus) => {
    try {
      const saved = await api<Contract>(`/contracts/${contract.id}`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      });
      setContracts((prev) => prev.map((c) => (c.id === saved.id ? saved : c)));
      toast.success(`Contract marked ${status}`);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not update this contract.");
    }
  };

  const generatePdf = async (contract: Contract) => {
    try {
      const { fileId } = await api<{ fileId: string }>(`/contracts/${contract.id}/pdf`, {
        method: "POST",
      });
      const { url } = await api<{ url: string }>(`/files/${fileId}/download`);
      window.open(url, "_blank");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not generate the PDF.");
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-serif text-2xl italic text-ink">Contracts</h1>
        <p className="mt-1 text-sm text-ink-mute">
          Auto-created once a proposal is customer-approved. Draft → Internal Review → Sent →
          Signed.
        </p>
      </div>

      {isReadOnly ? (
        contracts.length === 0 ? (
          <p className="text-sm text-ink-mute">You have no contracts yet.</p>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {contracts.map((c) => (
              <Card key={c.id}>
                <CardHeader>
                  <CardTitle className="font-serif text-base">{c.client}</CardTitle>
                </CardHeader>
                <CardContent className="flex flex-col gap-2 text-sm">
                  <div className="text-ink-mute">{labName(c.lab)}</div>
                  <Badge variant={CONTRACT_VARIANT[c.status]} className="w-fit">
                    {c.status}
                  </Badge>
                  {c.amount != null && (
                    <div className="tabular-nums text-ink">{fmtDollars(c.amount)}</div>
                  )}
                  {c.pdfFileId && (
                    <Button variant="outline" size="sm" onClick={() => generatePdf(c)}>
                      Download PDF
                    </Button>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        )
      ) : contracts.length === 0 ? (
        <p className="text-sm text-ink-mute">No contracts yet.</p>
      ) : (
        <div className="overflow-x-auto rounded-md ring-1 ring-foreground/10">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Client</TableHead>
                <TableHead>Lab</TableHead>
                <TableHead>Owner</TableHead>
                <TableHead>Amount</TableHead>
                <TableHead>Contributor</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>PDF</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {contracts.map((c) => (
                <TableRow key={c.id}>
                  <TableCell className="font-medium text-ink">{c.client}</TableCell>
                  <TableCell>{labName(c.lab)}</TableCell>
                  <TableCell>{personName(c.owner)}</TableCell>
                  <TableCell className="tabular-nums">{fmtDollars(c.amount)}</TableCell>
                  <TableCell>
                    <button
                      className="text-left hover:text-violet-deep"
                      onClick={() => setEditing(c)}
                    >
                      {c.contributorName || "— add contributor —"}
                    </button>
                  </TableCell>
                  <TableCell>
                    {role === "Admin" ? (
                      <Select
                        value={c.status}
                        onValueChange={(v) => setStatus(c, v as ContractStatus)}
                      >
                        <SelectTrigger className="w-40">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {CONTRACT_STATUSES.map((s) => (
                            <SelectItem key={s} value={s}>{s}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <Badge variant={CONTRACT_VARIANT[c.status]}>{c.status}</Badge>
                    )}
                  </TableCell>
                  <TableCell className="flex gap-2">
                    {role === "Admin" && (
                      <Button variant="outline" size="sm" onClick={() => generatePdf(c)}>
                        Generate
                      </Button>
                    )}
                    {c.status === "Signed" && c.contributorEmail && (
                      <Button variant="outline" size="sm" onClick={() => setInviting(c)}>
                        Invite
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {editing && (
        <ContributorDialog
          contract={editing}
          open={!!editing}
          onOpenChange={(open) => !open && setEditing(null)}
          onSaved={(saved) => {
            setContracts((prev) => prev.map((c) => (c.id === saved.id ? saved : c)));
            setEditing(null);
          }}
        />
      )}

      {inviting && (
        <InviteDialog
          contract={inviting}
          open={!!inviting}
          onOpenChange={(open) => !open && setInviting(null)}
        />
      )}
    </div>
  );
}

function ContributorDialog({
  contract,
  open,
  onOpenChange,
  onSaved,
}: {
  contract: Contract;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: (contract: Contract) => void;
}) {
  const [name, setName] = useState(contract.contributorName ?? "");
  const [email, setEmail] = useState(contract.contributorEmail ?? "");
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      const saved = await api<Contract>(`/contracts/${contract.id}`, {
        method: "PATCH",
        body: JSON.stringify({ contributorName: name, contributorEmail: email }),
      });
      toast.success("Contributor saved");
      onSaved(saved);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not save the contributor.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Contributor for {contract.client}</DialogTitle>
          <DialogDescription>
            Once this contract is Signed, the named contributor can be invited to the portal.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label>Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Email</Label>
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button className="bg-violet-deep hover:bg-violet" onClick={save} disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function InviteDialog({
  contract,
  open,
  onOpenChange,
}: {
  contract: Contract;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [sending, setSending] = useState(false);
  const name = contract.contributorName ?? "";
  const [first, ...rest] = name.trim().split(/\s+/);
  const last = rest.join(" ");

  const send = async () => {
    setSending(true);
    try {
      await api("/admin/invites", {
        method: "POST",
        body: JSON.stringify({
          firstName: first || name || "Contributor",
          lastName: last || "",
          email: contract.contributorEmail,
          role: "Contributor",
          labs: [contract.lab],
        }),
      });
      toast.success(`Invite sent to ${contract.contributorEmail}`);
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not send the invite.");
    } finally {
      setSending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Invite {contract.contributorName}</DialogTitle>
          <DialogDescription>
            Sends a portal invite to {contract.contributorEmail} as a Contributor on{" "}
            {contract.client}.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button className="bg-violet-deep hover:bg-violet" onClick={send} disabled={sending}>
            {sending ? "Sending…" : "Send invite"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
