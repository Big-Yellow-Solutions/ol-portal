"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowDown, ArrowUp, Search } from "lucide-react";
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
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
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
import { api } from "@/lib/api";
import { can } from "@/lib/can";
import { fmtDollars, fullName, QBO_STATUS_VARIANT, type BadgeVariant } from "@/lib/data";
import { usePortalData } from "@/lib/portal-data";
import type { InvoiceRequest } from "@/lib/types";

/*
 * NOTE on the InvoiceRequest contract:
 * lib/types.ts models an idealized shape (dealId/labId/cadence/createdAt,
 * status "Requested" | "Sent to client" | "Paid"). The real backend
 * (backend/src/app.mjs `createInvoice` / `updateInvoice`) returns a
 * different shape: {id, deal, client, lab, amount, requestedBy, date,
 * recurring, status}, with status one of "Admin review" | "Sent to client" |
 * "Paid" | "Overdue" (see INVOICE_STATUSES in app.mjs). Since
 * lib/portal-data.tsx passes the raw API response straight through as
 * `InvoiceRequest[]` with no field mapping, this page reads the real fields
 * via a local `RawInvoiceRequest` shape rather than trusting the
 * lib/types.ts field names, so the UI matches what the backend actually
 * sends. Worth reconciling lib/types.ts with the real contract later.
 */
type RawInvoiceStatus = "Admin review" | "Sent to client" | "Paid" | "Overdue";

interface RawInvoiceRequest {
  id: string;
  deal?: string;
  client: string;
  lab: string;
  amount: number;
  requestedBy: string;
  date: string;
  recurring: boolean;
  status: RawInvoiceStatus;
}

const asRawInvoices = (invoices: InvoiceRequest[]): RawInvoiceRequest[] =>
  invoices as unknown as RawInvoiceRequest[];

const STATUS_VARIANT: Record<RawInvoiceStatus, BadgeVariant> = {
  "Admin review": "outline",
  "Sent to client": "warning",
  Paid: "success",
  Overdue: "destructive",
};

function nextStatusFor(status: RawInvoiceStatus): RawInvoiceStatus | null {
  if (status === "Admin review") return "Sent to client";
  if (status === "Sent to client") return "Paid";
  return null;
}

function fmtDate(d: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return d;
  return new Date(`${d}T00:00:00`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

type SortKey = "client" | "lab" | "requestedBy" | "amount" | "cadence" | "status" | "date";

/* ---------- QuickBooks card (admin-only) ---------- */

interface QboStatus {
  configured: boolean;
  connected: boolean;
  realmId: string | null;
  env: string;
}

interface QboInvoice {
  id: string;
  number: string | number;
  customer: string;
  total: number;
  balance: number;
  status: "Paid" | "Open";
  txnDate: string | null;
  dueDate: string | null;
}

function QboCard() {
  const [status, setStatus] = useState<QboStatus | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [statusLoading, setStatusLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [qboInvoices, setQboInvoices] = useState<QboInvoice[] | null>(null);
  const [qboInvoicesError, setQboInvoicesError] = useState<string | null>(null);
  const [qboInvoicesLoading, setQboInvoicesLoading] = useState(false);

  const loadStatus = useCallback(async () => {
    setStatusLoading(true);
    setStatusError(null);
    try {
      setStatus(await api<QboStatus>("/qbo/status"));
    } catch (err) {
      setStatusError(err instanceof Error ? err.message : "QuickBooks status unavailable.");
    } finally {
      setStatusLoading(false);
    }
  }, []);

  useEffect(() => {
    loadStatus();
  }, [loadStatus]);

  useEffect(() => {
    if (!status?.connected) {
      setQboInvoices(null);
      return;
    }
    let active = true;
    setQboInvoicesLoading(true);
    setQboInvoicesError(null);
    api<QboInvoice[]>("/qbo/invoices")
      .then((invs) => {
        if (active) setQboInvoices(invs);
      })
      .catch((err) => {
        if (active) {
          setQboInvoicesError(
            err instanceof Error ? err.message : "Could not load QuickBooks invoices."
          );
        }
      })
      .finally(() => {
        if (active) setQboInvoicesLoading(false);
      });
    return () => {
      active = false;
    };
  }, [status?.connected]);

  async function connect() {
    setConnecting(true);
    try {
      const { url } = await api<{ url: string }>("/qbo/connect");
      window.location.href = url;
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Could not start the QuickBooks connection."
      );
      setConnecting(false);
    }
  }

  async function disconnect() {
    setDisconnecting(true);
    try {
      await api("/qbo/disconnect", { method: "POST" });
      setConfirmOpen(false);
      toast.success("Disconnected from QuickBooks.");
      await loadStatus();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not disconnect from QuickBooks.");
    } finally {
      setDisconnecting(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-serif text-lg">QuickBooks</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {statusLoading ? (
          <p className="text-sm text-ink-mute">Checking QuickBooks connection…</p>
        ) : statusError ? (
          <p className="text-sm text-ink-mute">QuickBooks status unavailable ({statusError}).</p>
        ) : !status?.configured ? (
          <p className="text-sm text-ink-mute">
            Not configured yet. Add the Intuit app credentials to SSM parameter{" "}
            <code className="rounded bg-violet-pale px-1 py-0.5 text-xs">
              /ol-portal/qbo-credentials
            </code>{" "}
            and redeploy the backend to enable connecting.
          </p>
        ) : !status.connected ? (
          <>
            <p className="text-sm text-ink-mute">
              Connect the portal to QuickBooks Online ({status.env}) so invoice requests can be
              checked against real invoices. PRD Option A groundwork.
            </p>
            <Button
              onClick={connect}
              disabled={connecting}
              className="w-fit"
            >
              {connecting ? "Connecting…" : "Connect to QuickBooks"}
            </Button>
          </>
        ) : (
          <>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm text-ink-mute">
                Connected to QuickBooks Online ({status.env}), company {status.realmId}.
              </p>
              <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
                <DialogTrigger asChild>
                  <Button variant="outline" size="sm">
                    Disconnect
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Disconnect from QuickBooks?</DialogTitle>
                    <DialogDescription>
                      The portal will stop showing live QuickBooks invoices until it&apos;s
                      reconnected.
                    </DialogDescription>
                  </DialogHeader>
                  <DialogFooter>
                    <Button variant="outline" onClick={() => setConfirmOpen(false)}>
                      Cancel
                    </Button>
                    <Button variant="destructive" onClick={disconnect} disabled={disconnecting}>
                      {disconnecting ? "Disconnecting…" : "Disconnect"}
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </div>

            <div className="overflow-x-auto rounded-lg border border-hair">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Invoice</TableHead>
                    <TableHead>Customer</TableHead>
                    <TableHead>Total</TableHead>
                    <TableHead>Balance</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Date</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {qboInvoicesLoading ? (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center text-ink-mute">
                        Loading live invoices…
                      </TableCell>
                    </TableRow>
                  ) : qboInvoicesError ? (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center text-ink-mute">
                        Could not load QuickBooks invoices ({qboInvoicesError}).
                      </TableCell>
                    </TableRow>
                  ) : !qboInvoices || qboInvoices.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center text-ink-mute">
                        No invoices in this QuickBooks company yet.
                      </TableCell>
                    </TableRow>
                  ) : (
                    qboInvoices.map((inv) => (
                      <TableRow key={inv.id}>
                        <TableCell className="font-medium text-ink">#{inv.number}</TableCell>
                        <TableCell>{inv.customer}</TableCell>
                        <TableCell>{fmtDollars(inv.total)}</TableCell>
                        <TableCell>{fmtDollars(inv.balance)}</TableCell>
                        <TableCell>
                          <Badge variant={QBO_STATUS_VARIANT[inv.status] ?? "outline"}>
                            {inv.status}
                          </Badge>
                        </TableCell>
                        <TableCell>{inv.txnDate ?? "—"}</TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

/* ---------- invoice requests table + page ---------- */

function InvoicesPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { loading, error, invoices, setInvoices, labs, people, role } = usePortalData();

  const rawInvoices = useMemo(() => asRawInvoices(invoices), [invoices]);
  const isAdmin = role ? can.reviewInvoices(role) : false;

  const [search, setSearch] = useState("");
  const [labFilter, setLabFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [cadenceFilter, setCadenceFilter] = useState<"all" | "recurring" | "one-time">("all");
  const [sortKey, setSortKey] = useState<SortKey>("date");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  // One-time flash after the QBO OAuth round trip (?qbo=connected|error).
  useEffect(() => {
    const flash = searchParams.get("qbo");
    if (!flash) return;
    if (flash === "connected") toast.success("Connected to QuickBooks.");
    else if (flash === "error")
      toast.error("Connection to QuickBooks failed. Check the Intuit app settings and try again.");
    router.replace("/invoices", { scroll: false });
  }, [searchParams, router]);

  const labName = useCallback(
    (id: string) => labs.find((l) => l.id === id)?.name ?? id,
    [labs]
  );

  const presentLabIds = useMemo(
    () => Array.from(new Set(rawInvoices.map((i) => i.lab))),
    [rawInvoices]
  );
  const presentStatuses = useMemo(
    () => Array.from(new Set(rawInvoices.map((i) => i.status))),
    [rawInvoices]
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rawInvoices.filter((i) => {
      if (labFilter !== "all" && i.lab !== labFilter) return false;
      if (statusFilter !== "all" && i.status !== statusFilter) return false;
      if (cadenceFilter !== "all" && (cadenceFilter === "recurring" ? !i.recurring : i.recurring))
        return false;
      if (
        q &&
        !i.client.toLowerCase().includes(q) &&
        !fullName(people[i.requestedBy]).toLowerCase().includes(q)
      )
        return false;
      return true;
    });
  }, [rawInvoices, labFilter, statusFilter, cadenceFilter, search, people]);

  const sortValue = useCallback(
    (i: RawInvoiceRequest): string | number => {
      switch (sortKey) {
        case "client":
          return (i.client || "").toLowerCase();
        case "lab":
          return labName(i.lab).toLowerCase();
        case "requestedBy":
          return fullName(people[i.requestedBy]).toLowerCase();
        case "amount":
          return i.amount || 0;
        case "cadence":
          return i.recurring ? 1 : 0;
        case "status":
          return i.status || "";
        case "date":
          return i.date || "";
        default:
          return "";
      }
    },
    [sortKey, labName, people]
  );

  const sorted = useMemo(() => {
    const copy = [...filtered];
    copy.sort((a, b) => {
      const av = sortValue(a);
      const bv = sortValue(b);
      const cmp =
        typeof av === "number" && typeof bv === "number"
          ? av - bv
          : String(av).localeCompare(String(bv));
      return sortDir === "asc" ? cmp : -cmp;
    });
    return copy;
  }, [filtered, sortValue, sortDir]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setSortDir("asc");
    }
  }

  async function advanceStatus(inv: RawInvoiceRequest, next: RawInvoiceStatus) {
    setUpdatingId(inv.id);
    try {
      await api(`/invoices/${inv.id}`, {
        method: "PATCH",
        body: JSON.stringify({ status: next }),
      });
      setInvoices((prev) =>
        asRawInvoices(prev).map((i) =>
          i.id === inv.id ? { ...i, status: next } : i
        ) as unknown as InvoiceRequest[]
      );
      toast.success(`Marked ${inv.client}'s request "${next.toLowerCase()}".`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not update invoice status.");
    } finally {
      setUpdatingId(null);
    }
  }

  const sortHead = (key: SortKey, label: string) => {
    const active = sortKey === key;
    return (
      <TableHead aria-sort={active ? (sortDir === "asc" ? "ascending" : "descending") : "none"}>
        <button
          type="button"
          onClick={() => toggleSort(key)}
          className="inline-flex items-center gap-1 whitespace-nowrap hover:text-violet-deep"
        >
          {label}
          {active ? (
            sortDir === "asc" ? (
              <ArrowUp className="size-3" />
            ) : (
              <ArrowDown className="size-3" />
            )
          ) : null}
        </button>
      </TableHead>
    );
  };

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-serif text-2xl italic text-ink">Invoice requests</h1>
        <p className="mt-1 max-w-2xl text-sm text-ink-mute">
          Lab Leaders click &ldquo;Request Invoice&rdquo; on a deal; all details pull in
          automatically, with no manual re-entry. Every request passes admin review before
          anything reaches a client.
        </p>
      </div>

      {loading ? (
        <p className="text-sm text-ink-mute">Loading invoice requests…</p>
      ) : error ? (
        <p className="text-sm text-red">{error}</p>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="font-serif text-lg">Recent requests</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative w-full max-w-64">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-ink-mute" />
                <Input
                  type="search"
                  placeholder="Search by client or requester…"
                  aria-label="Search invoice requests"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-8"
                />
              </div>

              <Select value={labFilter} onValueChange={setLabFilter}>
                <SelectTrigger aria-label="Filter by lab" className="w-40">
                  <SelectValue placeholder="All labs" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All labs</SelectItem>
                  {presentLabIds.map((id) => (
                    <SelectItem key={id} value={id}>
                      {labName(id)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger aria-label="Filter by status" className="w-40">
                  <SelectValue placeholder="All statuses" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All statuses</SelectItem>
                  {presentStatuses.map((s) => (
                    <SelectItem key={s} value={s}>
                      {s}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select
                value={cadenceFilter}
                onValueChange={(v) => setCadenceFilter(v as "all" | "recurring" | "one-time")}
              >
                <SelectTrigger aria-label="Filter by cadence" className="w-40">
                  <SelectValue placeholder="All cadences" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All cadences</SelectItem>
                  <SelectItem value="recurring">Recurring</SelectItem>
                  <SelectItem value="one-time">One-time</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <p className="text-sm text-ink-mute">
              {sorted.length} of {rawInvoices.length} invoice request
              {rawInvoices.length === 1 ? "" : "s"}
            </p>

            <div className="overflow-x-auto rounded-lg border border-hair">
              <Table>
                <TableHeader>
                  <TableRow>
                    {sortHead("client", "Client")}
                    {sortHead("lab", "Lab")}
                    {sortHead("requestedBy", "Requested by")}
                    {sortHead("amount", "Amount")}
                    {sortHead("cadence", "Cadence")}
                    {sortHead("status", "Status")}
                    {sortHead("date", "Date")}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sorted.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center text-ink-mute">
                        {rawInvoices.length
                          ? "No invoice requests match these filters."
                          : "No invoice requests visible for this role."}
                      </TableCell>
                    </TableRow>
                  ) : (
                    sorted.map((inv) => {
                      const next = nextStatusFor(inv.status);
                      return (
                        <TableRow key={inv.id}>
                          <TableCell>
                            <div className="font-medium text-ink">{inv.client}</div>
                            <div className="text-xs text-ink-mute">
                              {inv.id}
                              {inv.deal ? ` · deal ${inv.deal}` : ""}
                            </div>
                          </TableCell>
                          <TableCell>{labName(inv.lab)}</TableCell>
                          <TableCell>{fullName(people[inv.requestedBy]) || inv.requestedBy}</TableCell>
                          <TableCell className="tabular-nums">{fmtDollars(inv.amount)}</TableCell>
                          <TableCell>
                            <Badge variant={inv.recurring ? "secondary" : "outline"}>
                              {inv.recurring ? "Recurring" : "One-time"}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-2">
                              <Badge variant={STATUS_VARIANT[inv.status] ?? "outline"}>
                                {inv.status}
                              </Badge>
                              {isAdmin && next && (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  disabled={updatingId === inv.id}
                                  onClick={() => advanceStatus(inv, next)}
                                >
                                  {updatingId === inv.id ? "Updating…" : `Mark ${next.toLowerCase()}`}
                                </Button>
                              )}
                            </div>
                          </TableCell>
                          <TableCell>{fmtDate(inv.date)}</TableCell>
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      {isAdmin && <QboCard />}

      <p className="max-w-3xl text-xs text-ink-mute">
        PRD Option A (QuickBooks path): the card above connects the portal to QuickBooks Online,
        so admins see real invoices next to the requests. Auto-drafting an approved request in
        QuickBooks is the natural next step. Recurring deals can auto-trigger a request monthly.
      </p>
    </div>
  );
}

export default function InvoicesPage() {
  return (
    <Suspense fallback={<p className="text-sm text-ink-mute">Loading…</p>}>
      <InvoicesPageContent />
    </Suspense>
  );
}
