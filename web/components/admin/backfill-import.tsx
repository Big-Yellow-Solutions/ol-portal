"use client";

import { useState } from "react";
import { toast } from "sonner";
import { api, ApiError } from "@/lib/api";
import { stageLabel } from "@/lib/types";
import { fmtDollars } from "@/lib/data";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

/* The Admin page's "Import data" tab: upload the three backfill CSVs, see
   exactly what would be created (and anything wrong with the files), then
   import. What the rows mean and how they are matched is decided by the
   backend (src/backfill.mjs, answered by POST /admin/backfill); this only
   sends the files and shows the answer. Checking never writes anything. */

type Kind = "companies" | "contacts" | "deals";

interface Plan {
  ok: boolean;
  errors: string[];
  warnings: string[];
  skipped: string[];
  summary: { companies: number; contacts: number; deals: number; companiesUpdated: number };
  preview: {
    companies: { id: string; name: string; kind: string; website: string }[];
    contacts: { id: string; name: string; email: string; company: string }[];
    deals: { id: string; client: string; lab: string; stage: string; amount: number; close: string; company: string }[];
  };
  imported: boolean;
  wrote?: number;
  error?: string;
}

const FILES: { kind: Kind; label: string; hint: string }[] = [
  { kind: "companies", label: "Companies", hint: "companies.csv" },
  { kind: "contacts", label: "Contacts", hint: "contacts.csv" },
  { kind: "deals", label: "Deals", hint: "deals.csv" },
];

const errMsg = (e: unknown) =>
  e instanceof ApiError ? e.message : e instanceof Error ? e.message : "Something went wrong";

export function BackfillImport() {
  const [texts, setTexts] = useState<Partial<Record<Kind, string>>>({});
  const [names, setNames] = useState<Partial<Record<Kind, string>>>({});
  const [plan, setPlan] = useState<Plan | null>(null);
  const [busy, setBusy] = useState<"check" | "import" | null>(null);

  const attached = FILES.filter((f) => texts[f.kind]);

  async function pick(kind: Kind, file: File | undefined) {
    // Any change to the files makes an earlier check stale.
    setPlan(null);
    if (!file) {
      setTexts((t) => ({ ...t, [kind]: undefined }));
      setNames((n) => ({ ...n, [kind]: undefined }));
      return;
    }
    setTexts((t) => ({ ...t, [kind]: undefined }));
    try {
      const text = await file.text();
      setTexts((t) => ({ ...t, [kind]: text }));
      setNames((n) => ({ ...n, [kind]: file.name }));
    } catch {
      toast.error(`Couldn't read ${file.name}.`);
    }
  }

  async function send(confirm: boolean) {
    setBusy(confirm ? "import" : "check");
    try {
      const out = await api<Plan>("/admin/backfill", {
        method: "POST",
        body: JSON.stringify({ ...texts, confirm }),
      });
      setPlan(out);
      if (confirm && out.imported) {
        toast.success(`Imported ${out.wrote ?? 0} record${out.wrote === 1 ? "" : "s"}.`);
      } else if (confirm) {
        toast.error(out.error ?? "Nothing was imported.");
      }
    } catch (e) {
      // A stopped import still carries the plan and the reason.
      if (e instanceof ApiError && e.body && typeof e.body === "object") setPlan(e.body as Plan);
      toast.error(errMsg(e));
    } finally {
      setBusy(null);
    }
  }

  const total = plan ? plan.summary.companies + plan.summary.contacts + plan.summary.deals : 0;
  const canImport = !!plan && plan.ok && !plan.imported && total > 0;

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle className="font-serif text-lg">Import companies, contacts and deals</CardTitle>
          <CardDescription>
            Upload the backfill CSVs, check them, then import. Checking writes nothing, and a
            single bad row stops the whole import. Records already in the portal are skipped, so
            running it twice is safe. Imported deals skip the document requirements and send no
            email.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="grid gap-4 sm:grid-cols-3">
            {FILES.map((f) => (
              <div key={f.kind} className="flex flex-col gap-1.5">
                <Label htmlFor={`backfill-${f.kind}`}>{f.label}</Label>
                <Input
                  id={`backfill-${f.kind}`}
                  type="file"
                  accept=".csv,text/csv"
                  onChange={(e) => pick(f.kind, e.target.files?.[0])}
                  disabled={busy !== null}
                />
                <p className="text-xs text-ink-mute">{names[f.kind] ?? `${f.hint} — optional`}</p>
              </div>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button onClick={() => send(false)} disabled={busy !== null || attached.length === 0}>
              {busy === "check" ? "Checking…" : "Check files"}
            </Button>
            {canImport && (
              <Button
                variant="outline"
                onClick={() => send(true)}
                disabled={busy !== null}
              >
                {busy === "import" ? "Importing…" : `Import ${total} record${total === 1 ? "" : "s"}`}
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {plan && (
        <Card>
          <CardHeader>
            <CardTitle className="font-serif text-lg">
              {plan.imported
                ? `Imported ${plan.wrote ?? 0} record${plan.wrote === 1 ? "" : "s"}`
                : plan.ok
                  ? "Ready to import"
                  : "Fix these before importing"}
            </CardTitle>
            <CardDescription>
              {plan.summary.companies} new companies · {plan.summary.contacts} new contacts ·{" "}
              {plan.summary.deals} new deals
              {plan.summary.companiesUpdated > 0
                ? ` · ${plan.summary.companiesUpdated} existing company gets a primary contact`
                : ""}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-5">
            {plan.error && !plan.imported && (
              <p className="text-sm font-medium text-red">{plan.error}</p>
            )}
            <Notes title="Errors" tone="destructive" items={plan.errors} />
            <Notes title="Worth a look" tone="warning" items={plan.warnings} />
            <Notes title="Already in the portal — skipped" tone="outline" items={plan.skipped} />

            {plan.preview.companies.length > 0 && (
              <PreviewTable title="Companies" heads={["ID", "Name", "Kind"]}
                rows={plan.preview.companies.map((c) => [c.id, c.name, c.kind])} />
            )}
            {plan.preview.contacts.length > 0 && (
              <PreviewTable title="Contacts" heads={["ID", "Name", "Email", "Company"]}
                rows={plan.preview.contacts.map((c) => [c.id, c.name, c.email, c.company])} />
            )}
            {plan.preview.deals.length > 0 && (
              <PreviewTable title="Deals" heads={["ID", "Deal", "Lab", "Stage", "Amount", "Closed", "Company"]}
                rows={plan.preview.deals.map((d) => [
                  d.id, d.client, d.lab, stageLabel(d.stage), fmtDollars(d.amount), d.close || "—", d.company,
                ])} />
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function Notes({
  title,
  tone,
  items,
}: {
  title: string;
  tone: "destructive" | "warning" | "outline";
  items: string[];
}) {
  if (items.length === 0) return null;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <Badge variant={tone}>{title}</Badge>
        <span className="text-xs text-ink-mute">{items.length}</span>
      </div>
      <ul className="flex flex-col gap-1 text-sm text-ink">
        {items.map((m, i) => (
          <li key={i} className="break-words">{m}</li>
        ))}
      </ul>
    </div>
  );
}

function PreviewTable({ title, heads, rows }: { title: string; heads: string[]; rows: string[][] }) {
  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-sm font-semibold text-ink">{title}</h3>
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              {heads.map((h) => (
                <TableHead key={h}>{h}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r, i) => (
              <TableRow key={i}>
                {r.map((c, j) => (
                  <TableCell key={j}>{c}</TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
