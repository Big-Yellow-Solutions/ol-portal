"use client";

/* Template manager (Base Contract PRD FR1, FR12) — Admin only.

   Three kinds of reusable content live here:
     Contract terms   the Legal-approved agreement body, per lab or OL-wide.
                      A contract cannot be sent for signature without one, so
                      this is the page that unblocks the signature flow.
     Proposal starts  a pre-filled set of the six proposal sections.
     Content blocks   single reusable paragraphs bound to one section.

   Contract clauses carry {{placeholders}} that merge against the contract at
   generation time. Anything left unfilled surfaces on the contract and blocks
   sending, so the author can be liberal with them. */

import { useCallback, useEffect, useState } from "react";
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
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { api, ApiError } from "@/lib/api";
import { usePortalData } from "@/lib/portal-data";
import { SECTION_KEYS, SECTION_LABELS } from "@/lib/types";
import type { ContentTemplate, ContractClause, TemplateKind } from "@/lib/types";

/* Mirrors TEMPLATE_VAR_KEYS in backend/src/templates.mjs. Shown to authors so
   they don't have to guess what merges. */
const TEMPLATE_VARS = [
  "client", "clientSigner", "clientSignerTitle", "lab", "labLeader", "olSignatory",
  "contractId", "total", "paymentSchedule", "startDate", "endDate", "dealId", "today",
];

const KIND_LABEL: Record<TemplateKind, string> = {
  contract: "Contract terms",
  proposal: "Proposal start",
  block: "Content block",
};

export default function TemplatesPage() {
  const { role, labs } = usePortalData();
  const [templates, setTemplates] = useState<ContentTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<ContentTemplate | null>(null);
  const [creatingKind, setCreatingKind] = useState<TemplateKind | null>(null);

  const load = useCallback(async () => {
    try {
      setTemplates(await api<ContentTemplate[]>("/templates"));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load templates.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (role !== "Admin")
    return <p className="text-sm text-ink-mute">Templates are managed by Admins.</p>;
  if (loading) return <p className="text-sm text-ink-mute">Loading…</p>;
  if (error) return <p className="text-sm text-red">{error}</p>;

  const labName = (id?: string) => (id ? (labs.find((l) => l.id === id)?.name ?? id) : "All labs");
  const byKind = (kind: TemplateKind) => templates.filter((t) => t.kind === kind);

  const remove = async (t: ContentTemplate) => {
    try {
      await api(`/templates/${t.id}`, { method: "DELETE" });
      setTemplates((prev) => prev.filter((x) => x.id !== t.id));
      toast.success(`Deleted ${t.name}`);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not delete this template.");
    }
  };

  const saved = (t: ContentTemplate) => {
    setTemplates((prev) =>
      prev.some((x) => x.id === t.id) ? prev.map((x) => (x.id === t.id ? t : x)) : [...prev, t]
    );
    setEditing(null);
    setCreatingKind(null);
  };

  const noContractTemplate = byKind("contract").length === 0;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-serif text-2xl italic text-ink">Templates</h1>
        <p className="mt-1 text-sm text-ink-mute">
          Pre-approved content Lab Leaders build from. Contract terms are merged into every
          contract at generation.
        </p>
      </div>

      {noContractTemplate && (
        <div className="rounded-md border-l-4 border-amber bg-amber-pale px-4 py-3 text-sm">
          <p className="font-medium text-ink">No contract terms on file</p>
          <p className="mt-1 text-ink-soft">
            Contracts generate without standard terms and cannot be sent for signature until at
            least one contract template exists. Add an OL-wide one to cover every lab.
          </p>
        </div>
      )}

      <Tabs defaultValue="contract">
        <TabsList>
          <TabsTrigger value="contract">Contract terms</TabsTrigger>
          <TabsTrigger value="proposal">Proposal starts</TabsTrigger>
          <TabsTrigger value="block">Content blocks</TabsTrigger>
        </TabsList>

        {(["contract", "proposal", "block"] as TemplateKind[]).map((kind) => (
          <TabsContent key={kind} value={kind} className="mt-4 flex flex-col gap-4">
            <div>
              <Button
                onClick={() => setCreatingKind(kind)}
              >
                New {KIND_LABEL[kind].toLowerCase()}
              </Button>
            </div>
            {byKind(kind).length === 0 ? (
              <p className="text-sm text-ink-mute">Nothing here yet.</p>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2">
                {byKind(kind).map((t) => (
                  <Card key={t.id}>
                    <CardHeader className="flex-row items-start justify-between gap-2">
                      <CardTitle className="font-serif text-base">{t.name}</CardTitle>
                      <div className="flex shrink-0 gap-1">
                        <Badge variant="outline">{labName(t.lab)}</Badge>
                        {t.active === false && <Badge variant="secondary">Inactive</Badge>}
                      </div>
                    </CardHeader>
                    <CardContent className="flex flex-col gap-3 text-sm">
                      <p className="text-ink-mute">
                        {t.kind === "contract" && `${t.clauses?.length ?? 0} clauses`}
                        {t.kind === "block" &&
                          `${SECTION_LABELS[t.section ?? ""] ?? t.section} · ${(t.text ?? "").slice(0, 80)}…`}
                        {t.kind === "proposal" &&
                          `${Object.values(t.sections ?? {}).filter(Boolean).length} sections prefilled`}
                      </p>
                      <div className="flex gap-2">
                        <Button size="sm" variant="outline" onClick={() => setEditing(t)}>
                          Edit
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="border-red text-red hover:bg-red-pale"
                          onClick={() => remove(t)}
                        >
                          Delete
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </TabsContent>
        ))}
      </Tabs>

      {(editing || creatingKind) && (
        <TemplateDialog
          template={editing}
          kind={editing?.kind ?? creatingKind!}
          labs={labs}
          open
          onOpenChange={(open) => {
            if (!open) {
              setEditing(null);
              setCreatingKind(null);
            }
          }}
          onSaved={saved}
        />
      )}
    </div>
  );
}

function TemplateDialog({
  template,
  kind,
  labs,
  open,
  onOpenChange,
  onSaved,
}: {
  template: ContentTemplate | null;
  kind: TemplateKind;
  labs: { id: string; name: string }[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: (t: ContentTemplate) => void;
}) {
  const [name, setName] = useState(template?.name ?? "");
  const [lab, setLab] = useState(template?.lab ?? "");
  const [active, setActive] = useState(template?.active !== false);
  const [clauses, setClauses] = useState<ContractClause[]>(
    template?.clauses ?? [{ heading: "", text: "" }]
  );
  const [section, setSection] = useState(template?.section ?? SECTION_KEYS[0]);
  const [text, setText] = useState(template?.text ?? "");
  const [sections, setSections] = useState<Record<string, string>>(template?.sections ?? {});
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      const body = {
        kind,
        name,
        // An empty lab means OL-wide, which the API expresses as an absent key.
        lab: lab || null,
        active,
        ...(kind === "contract" ? { clauses } : {}),
        ...(kind === "block" ? { section, text } : {}),
        ...(kind === "proposal" ? { sections } : {}),
      };
      const result = template
        ? await api<ContentTemplate>(`/templates/${template.id}`, {
            method: "PATCH",
            body: JSON.stringify(body),
          })
        : await api<ContentTemplate>("/templates", {
            method: "POST",
            body: JSON.stringify(body),
          });
      toast.success(template ? "Template updated" : "Template created");
      onSaved(result);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not save this template.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {template ? "Edit" : "New"} {KIND_LABEL[kind].toLowerCase()}
          </DialogTitle>
          <DialogDescription>
            {kind === "contract"
              ? "Merged into every contract generated for this lab. Leave the lab blank to cover all of them."
              : kind === "proposal"
                ? "Offered when a Lab Leader starts a new proposal."
                : "A reusable paragraph a Lab Leader can drop into one section."}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="tpl-name">Name</Label>
            <Input id="tpl-name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="tpl-lab">Lab</Label>
            <Select value={lab || "__all"} onValueChange={(v) => setLab(v === "__all" ? "" : v)}>
              <SelectTrigger id="tpl-lab">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all">All labs (OL master)</SelectItem>
                {labs.map((l) => (
                  <SelectItem key={l.id} value={l.id}>
                    {l.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {kind === "contract" && (
            <ClauseEditor clauses={clauses} onChange={setClauses} />
          )}

          {kind === "block" && (
            <>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="tpl-section">Section</Label>
                <Select value={section} onValueChange={setSection}>
                  <SelectTrigger id="tpl-section">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {SECTION_KEYS.map((k) => (
                      <SelectItem key={k} value={k}>
                        {SECTION_LABELS[k]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="tpl-text">Text</Label>
                <Textarea
                  id="tpl-text"
                  rows={6}
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                />
              </div>
            </>
          )}

          {kind === "proposal" &&
            SECTION_KEYS.map((k) => (
              <div key={k} className="flex flex-col gap-1.5">
                <Label htmlFor={`tpl-${k}`}>{SECTION_LABELS[k]}</Label>
                <Textarea
                  id={`tpl-${k}`}
                  rows={3}
                  value={sections[k] ?? ""}
                  onChange={(e) => setSections((s) => ({ ...s, [k]: e.target.value }))}
                />
              </div>
            ))}

          <label className="flex items-center gap-2 text-sm text-ink-soft">
            <input
              type="checkbox"
              checked={active}
              onChange={(e) => setActive(e.target.checked)}
              className="size-4"
            />
            Active
          </label>
        </div>

        <DialogFooter>
          <Button
            onClick={save}
            disabled={saving || !name.trim()}
          >
            {saving ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ClauseEditor({
  clauses,
  onChange,
}: {
  clauses: ContractClause[];
  onChange: (c: ContractClause[]) => void;
}) {
  const set = (i: number, patch: Partial<ContractClause>) =>
    onChange(clauses.map((c, idx) => (idx === i ? { ...c, ...patch } : c)));

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-md bg-paper p-3 text-xs text-ink-soft">
        <p className="font-medium text-ink">Placeholders you can use</p>
        <p className="mt-1 font-mono leading-relaxed">
          {TEMPLATE_VARS.map((v) => `{{${v}}}`).join("  ")}
        </p>
        <p className="mt-1">
          Anything left unfilled stays visible on the contract and blocks sending, so nothing
          silently goes out blank.
        </p>
      </div>

      {clauses.map((c, i) => (
        <div key={i} className="flex flex-col gap-2 rounded-md ring-1 ring-foreground/10 p-3">
          <div className="flex items-center gap-2">
            <Input
              placeholder="Clause heading, e.g. Fees and payment"
              value={c.heading}
              onChange={(e) => set(i, { heading: e.target.value })}
            />
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="shrink-0 border-red text-red hover:bg-red-pale"
              onClick={() => onChange(clauses.filter((_, idx) => idx !== i))}
              disabled={clauses.length === 1}
            >
              Remove
            </Button>
          </div>
          <Textarea
            rows={4}
            placeholder="Clause text"
            value={c.text}
            onChange={(e) => set(i, { text: e.target.value })}
          />
        </div>
      ))}

      <Button
        type="button"
        variant="outline"
        className="w-fit"
        onClick={() => onChange([...clauses, { heading: "", text: "" }])}
      >
        Add clause
      </Button>
    </div>
  );
}
