"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/* The Assignment Notice's fee split: which Lab Leader(s) deliver the work and
   what share of the fee each takes. Lives beside the deal drawer rather than
   in it because the drawer renders it twice — once in the close-confirmation
   dialog, once in the notice section of a closed deal's Documents tab. */
export function LabLeaderFeeSplitEditor({
  rows,
  setRows,
  options,
  disabled,
}: {
  rows: { key: string; feeSharePct: string }[];
  setRows: (rows: { key: string; feeSharePct: string }[]) => void;
  options: { username: string; name: string }[];
  disabled?: boolean;
}) {
  const total = rows.reduce((sum, r) => sum + (Number(r.feeSharePct) || 0), 0);

  return (
    <div className="flex flex-col gap-2" role="group" aria-labelledby="pv2-fee-split-label">
      <Label id="pv2-fee-split-label">Lab Leader fee split</Label>
      {rows.map((row, i) => (
        <div key={i} className="flex items-center gap-2">
          <Select value={row.key} onValueChange={(v) => setRows(rows.map((r, idx) => (idx === i ? { ...r, key: v } : r)))} disabled={disabled}>
            <SelectTrigger className="flex-1" aria-label={`Lab Leader for fee-share row ${i + 1}`}>
              <SelectValue placeholder="Lab Leader" />
            </SelectTrigger>
            <SelectContent>
              {options.map((p) => <SelectItem key={p.username} value={p.username}>{p.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <Input
            type="number"
            min={0}
            max={100}
            value={row.feeSharePct}
            onChange={(e) => setRows(rows.map((r, idx) => (idx === i ? { ...r, feeSharePct: e.target.value } : r)))}
            disabled={disabled}
            className="w-20"
            aria-label={`Fee share percent for row ${i + 1}`}
          />
          <span className="text-xs text-ink-mute">%</span>
          {!disabled && rows.length > 1 && (
            <Button variant="ghost" size="icon-sm" onClick={() => setRows(rows.filter((_, idx) => idx !== i))}>✕</Button>
          )}
        </div>
      ))}
      {!disabled && (
        <Button type="button" variant="outline" size="sm" className="self-start" onClick={() => setRows([...rows, { key: "", feeSharePct: "" }])}>
          + Add Lab Leader
        </Button>
      )}
      <span className={`text-xs ${Math.abs(total - 100) > 0.01 ? "text-red" : "text-ink-mute"}`}>Total: {total}% (must equal 100%)</span>
    </div>
  );
}
