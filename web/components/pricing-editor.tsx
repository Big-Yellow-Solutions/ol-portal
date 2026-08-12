"use client";

/* Structured pricing editor (Base Contract PRD FR3).

   Until now pricing was only ever written by The Optimist onto a proposal. A
   contract written directly in the Contracts tab has no proposal behind it, so
   somebody has to type the numbers — and a contract inherited from a proposal
   sometimes has to be repriced too, which is a declared deviation rather than a
   forbidden act.

   The shape here is exactly what the API accepts, so what you see is what gets
   stored: no hidden normalization between this form and the record. */

import { Button } from "@/components/ui/button";
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
import { pricingTotal, fmtMoney, emptyPricing } from "@/lib/pricing";
import type { Pricing, PricingItem, PricingTier } from "@/lib/types";

type Kind = "none" | Pricing["kind"];

export function PricingEditor({
  value,
  onChange,
  disabled,
}: {
  value: Pricing | null;
  onChange: (p: Pricing | null) => void;
  disabled?: boolean;
}) {
  const kind: Kind = value?.kind ?? "none";
  const total = pricingTotal(value);

  const setKind = (k: Kind) => onChange(k === "none" ? null : emptyPricing(k));

  return (
    <div className="flex flex-col gap-4 rounded-md ring-1 ring-foreground/10 p-3">
      <div className="flex flex-col gap-1.5">
        <Label>Pricing structure</Label>
        <Select value={kind} onValueChange={(v) => setKind(v as Kind)} disabled={disabled}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">Not priced yet</SelectItem>
            <SelectItem value="flat">Flat fee</SelectItem>
            <SelectItem value="tiered">Packages to choose from</SelectItem>
            <SelectItem value="itemized">Line items</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {value?.kind === "flat" && (
        <div className="grid gap-3 sm:grid-cols-[2fr_1fr]">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="fee-label">What the fee is called</Label>
            <Input
              id="fee-label"
              disabled={disabled}
              value={value.label ?? ""}
              placeholder="Project fee"
              onChange={(e) => onChange({ ...value, label: e.target.value })}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="fee-amount">Amount</Label>
            <Input
              id="fee-amount"
              type="number"
              min={0}
              disabled={disabled}
              value={value.amount}
              onChange={(e) => onChange({ ...value, amount: Number(e.target.value) })}
            />
          </div>
        </div>
      )}

      {value?.kind === "tiered" && (
        <TierRows
          tiers={value.tiers}
          selected={value.selected}
          disabled={disabled}
          onChange={(tiers, selected) => onChange({ ...value, tiers, selected })}
        />
      )}

      {value?.kind === "itemized" && (
        <ItemRows
          items={value.items}
          discount={value.discount ?? 0}
          disabled={disabled}
          onChange={(items, discount) => onChange({ ...value, items, discount })}
        />
      )}

      {value && value.kind !== "tiered" && (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="pricing-notes">Note shown under the figures (optional)</Label>
          <Textarea
            id="pricing-notes"
            rows={2}
            disabled={disabled}
            value={value.notes ?? ""}
            onChange={(e) => onChange({ ...value, notes: e.target.value })}
          />
        </div>
      )}

      {value && (
        <div className="flex items-center justify-between border-t border-foreground/10 pt-3 text-sm">
          <span className="text-ink-mute">Total</span>
          <span className="font-semibold tabular-nums text-ink">
            {total === null ? (
              <span className="text-xs font-normal text-ink-mute">
                Pending package selection
              </span>
            ) : (
              fmtMoney(total)
            )}
          </span>
        </div>
      )}
    </div>
  );
}

function TierRows({
  tiers,
  selected,
  disabled,
  onChange,
}: {
  tiers: PricingTier[];
  selected?: string;
  disabled?: boolean;
  onChange: (tiers: PricingTier[], selected?: string) => void;
}) {
  const set = (i: number, patch: Partial<PricingTier>) =>
    onChange(tiers.map((t, idx) => (idx === i ? { ...t, ...patch } : t)), selected);

  return (
    <div className="flex flex-col gap-3">
      <Label>Packages</Label>
      {tiers.map((t, i) => (
        <div key={t.id || i} className="flex flex-col gap-2 rounded-md bg-paper p-3">
          <div className="grid gap-2 sm:grid-cols-[2fr_1fr]">
            <Input
              placeholder="Package name"
              disabled={disabled}
              value={t.name}
              onChange={(e) => set(i, { name: e.target.value })}
            />
            <Input
              type="number"
              min={0}
              placeholder="Amount"
              disabled={disabled}
              value={t.amount}
              onChange={(e) => set(i, { amount: Number(e.target.value) })}
            />
          </div>
          <Input
            placeholder="One line on what this includes"
            disabled={disabled}
            value={t.summary ?? ""}
            onChange={(e) => set(i, { summary: e.target.value })}
          />
          <div className="flex flex-wrap items-center gap-4 text-sm">
            <label className="flex items-center gap-2 text-ink-soft">
              <input
                type="radio"
                name="recommended-tier"
                disabled={disabled}
                checked={!!t.recommended}
                onChange={() =>
                  onChange(
                    tiers.map((x, idx) => ({ ...x, recommended: idx === i })),
                    selected
                  )
                }
              />
              Recommended
            </label>
            <label className="flex items-center gap-2 text-ink-soft">
              <input
                type="radio"
                name="selected-tier"
                disabled={disabled}
                checked={selected === t.id}
                onChange={() => onChange(tiers, t.id)}
              />
              Chosen by the client
            </label>
            <button
              type="button"
              disabled={disabled || tiers.length === 1}
              className="ml-auto text-xs text-red hover:underline disabled:opacity-40"
              onClick={() => onChange(tiers.filter((_, idx) => idx !== i), selected)}
            >
              Remove
            </button>
          </div>
        </div>
      ))}
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="w-fit"
        disabled={disabled}
        onClick={() =>
          onChange([...tiers, { id: `tier-${tiers.length + 1}`, name: "", amount: 0 }], selected)
        }
      >
        Add package
      </Button>
      <p className="text-xs text-ink-mute">
        A contract is normally for one package. Mark which one the client chose, and the agreement
        prices to that single line.
      </p>
    </div>
  );
}

function ItemRows({
  items,
  discount,
  disabled,
  onChange,
}: {
  items: PricingItem[];
  discount: number;
  disabled?: boolean;
  onChange: (items: PricingItem[], discount: number) => void;
}) {
  const set = (i: number, patch: Partial<PricingItem>) =>
    onChange(items.map((x, idx) => (idx === i ? { ...x, ...patch } : x)), discount);

  return (
    <div className="flex flex-col gap-3">
      <Label>Line items</Label>
      {items.map((it, i) => (
        <div key={i} className="grid items-center gap-2 sm:grid-cols-[3fr_1fr_1fr_auto]">
          <Input
            placeholder="Description"
            disabled={disabled}
            value={it.description}
            onChange={(e) => set(i, { description: e.target.value })}
          />
          <Input
            type="number"
            min={1}
            placeholder="Qty"
            disabled={disabled}
            value={it.qty}
            onChange={(e) => set(i, { qty: Number(e.target.value) })}
          />
          <Input
            type="number"
            min={0}
            placeholder="Rate"
            disabled={disabled}
            value={it.rate}
            onChange={(e) => set(i, { rate: Number(e.target.value) })}
          />
          <button
            type="button"
            disabled={disabled || items.length === 1}
            className="text-xs text-red hover:underline disabled:opacity-40"
            onClick={() => onChange(items.filter((_, idx) => idx !== i), discount)}
          >
            Remove
          </button>
        </div>
      ))}
      <div className="flex flex-wrap items-end gap-3">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled}
          onClick={() => onChange([...items, { description: "", qty: 1, rate: 0 }], discount)}
        >
          Add line item
        </Button>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="discount">Discount</Label>
          <Input
            id="discount"
            type="number"
            min={0}
            className="w-32"
            disabled={disabled}
            value={discount}
            onChange={(e) => onChange(items, Number(e.target.value))}
          />
        </div>
      </div>
    </div>
  );
}
