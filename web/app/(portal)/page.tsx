"use client";

import Link from "next/link";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { usePortalData } from "@/lib/portal-data";
import { STAGES } from "@/lib/types";
import { STAGE_VARIANT, fmtDollars, fmtK, fullName } from "@/lib/data";

const DONUT_COLORS = [
  "var(--color-violet-deep)",
  "var(--color-violet)",
  "var(--color-violet-light)",
  "var(--color-amber)",
  "var(--color-green)",
];

export default function DashboardPage() {
  const { deals, invoices, files, labs, people, me } = usePortalData();

  const meRecord = me ? people[me] : undefined;
  const openDeals = deals.filter((d) => d.stage !== "Closed");
  const pipelineValue = openDeals.reduce((sum, d) => sum + (d.amount ?? 0), 0);
  const closedWonValue = deals
    .filter((d) => d.stage === "Closed" && d.outcome === "Won")
    .reduce((sum, d) => sum + (d.amount ?? 0), 0);
  const openInvoices = invoices.filter((i) => i.status !== "Paid");

  const stageBars = STAGES.filter((s) => s !== "Closed").map((stage) => ({
    stage,
    count: deals.filter((d) => d.stage === stage).length,
  }));

  const labDonut = labs
    .map((lab) => ({
      name: lab.name,
      value: openDeals
        .filter((d) => d.lab === lab.id)
        .reduce((sum, d) => sum + (d.amount ?? 0), 0),
    }))
    .filter((d) => d.value > 0);

  const recentDeals = [...deals]
    .sort((a, b) => (b.close > a.close ? 1 : -1))
    .slice(0, 5);

  const recentFiles = [...files]
    .sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""))
    .slice(0, 5);

  return (
    <div className="flex flex-col gap-6">
      <h1 className="font-serif text-2xl italic text-ink">
        Hello, {fullName(meRecord) || "there"}
      </h1>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatCard label="Open deals" value={String(openDeals.length)} />
        <StatCard label="Open pipeline" value={fmtK(pipelineValue)} />
        <StatCard label="Closed won" value={fmtK(closedWonValue)} />
        <StatCard label="Open invoice requests" value={String(openInvoices.length)} />
      </div>

      <div className="grid gap-6 md:grid-cols-[2fr_1fr]">
        <Card>
          <CardHeader>
            <CardTitle className="font-serif text-lg">Pipeline by stage</CardTitle>
          </CardHeader>
          <CardContent className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={stageBars}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="stage" tick={{ fontSize: 12 }} />
                <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
                <Tooltip />
                <Bar dataKey="count" fill="var(--color-violet)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="font-serif text-lg">Open pipeline by lab</CardTitle>
          </CardHeader>
          <CardContent className="h-64">
            {labDonut.length === 0 ? (
              <p className="text-sm text-ink-mute">No open pipeline yet.</p>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={labDonut}
                    dataKey="value"
                    nameKey="name"
                    innerRadius={50}
                    outerRadius={80}
                  >
                    {labDonut.map((entry, i) => (
                      <Cell key={entry.name} fill={DONUT_COLORS[i % DONUT_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(v) => fmtDollars(typeof v === "number" ? v : Number(v))} />
                </PieChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 md:grid-cols-[2fr_1fr]">
        <Card>
          <CardHeader>
            <CardTitle className="font-serif text-lg">Recent deals</CardTitle>
          </CardHeader>
          <CardContent>
            {recentDeals.length === 0 ? (
              <p className="text-sm text-ink-mute">No deals yet.</p>
            ) : (
              <ul className="flex flex-col divide-y divide-hair">
                {recentDeals.map((deal) => (
                  <li key={deal.id} className="flex items-center justify-between py-2">
                    <Link href="/pipeline" className="text-sm text-ink hover:text-violet-deep">
                      {deal.client}
                    </Link>
                    <div className="flex items-center gap-3">
                      <span className="text-sm tabular-nums text-ink-mute">
                        {fmtDollars(deal.amount)}
                      </span>
                      <Badge variant={STAGE_VARIANT[deal.stage]}>
                        {deal.stage === "Closed" && deal.outcome
                          ? `Closed ${deal.outcome}`
                          : deal.stage}
                      </Badge>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="font-serif text-lg">Recent files</CardTitle>
          </CardHeader>
          <CardContent>
            {recentFiles.length === 0 ? (
              <p className="text-sm text-ink-mute">No files yet.</p>
            ) : (
              <ul className="flex flex-col divide-y divide-hair">
                {recentFiles.map((file) => (
                  <li key={file.id} className="py-2 text-sm text-ink">
                    <Link href="/files" className="hover:text-violet-deep">
                      {file.name}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-xs uppercase tracking-wide text-ink-mute">{label}</div>
        <div className="mt-1 text-2xl font-semibold tabular-nums text-ink">{value}</div>
      </CardContent>
    </Card>
  );
}
