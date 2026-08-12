/* OL Portal · structured pricing (Base Contract PRD FR3, FR11).

   Pricing used to live as prose inside `sections.pricing`, which made two PRD
   requirements impossible: offering real package tiers the customer picks from,
   and detecting that a contract's price drifted from the approved proposal's.
   Both need pricing to be data, so it is:

     flat      { kind:"flat", amount, label?, notes? }
     tiered    { kind:"tiered", tiers:[{ id, name, amount, summary?, recommended? }], selected? }
     itemized  { kind:"itemized", items:[{ description, qty, rate }], discount?, notes? }

   `null` is a legitimate value meaning "not priced yet" — a proposal in early
   draft has no pricing, and The Optimist writes one in once it knows the shape.
   The prose section survives alongside this as commentary; the numbers here are
   what the contract inherits and what deviation checks compare. */

export const PRICING_KINDS = ["flat", "tiered", "itemized"];

const MAX_AMOUNT = 100_000_000;
const MAX_TIERS = 12;
const MAX_ITEMS = 40;
const MAX_NAME = 200;
const MAX_NOTES = 2000;

const str = (v, max) => String(v ?? "").trim().slice(0, max);
/* Money is rounded to cents on the way in so that a float like 12000.000000001
   from a client-side calculation can never make samePricing() report a phantom
   deviation. */
const money = v => Math.round(Number(v) * 100) / 100;
const validAmount = v => Number.isFinite(v) && v >= 0 && v <= MAX_AMOUNT;

/* Tier ids are stable across edits so `selected` keeps pointing at the same
   tier when a Lab Leader renames one. Derived from the name, deduped. */
function tierId(name, taken) {
  const base = str(name, 40).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "tier";
  let id = base, n = 2;
  while (taken.has(id)) id = `${base}-${n++}`;
  taken.add(id);
  return id;
}

/* Returns { value } on success or { error } with a message safe to show a user.
   `null`/absent input is valid and means unpriced. */
export function cleanPricing(input) {
  if (input === null || input === undefined) return { value: null };
  if (typeof input !== "object" || Array.isArray(input)) return { error: "invalid pricing" };
  const kind = input.kind;
  if (!PRICING_KINDS.includes(kind)) return { error: "pricing kind must be flat, tiered, or itemized" };

  if (kind === "flat") {
    const amount = money(input.amount);
    if (!validAmount(amount)) return { error: "flat pricing needs a valid amount" };
    return {
      value: {
        kind: "flat", amount,
        label: str(input.label, MAX_NAME) || "Project fee",
        notes: str(input.notes, MAX_NOTES)
      }
    };
  }

  if (kind === "tiered") {
    const raw = Array.isArray(input.tiers) ? input.tiers : [];
    if (!raw.length) return { error: "tiered pricing needs at least one package" };
    if (raw.length > MAX_TIERS) return { error: `tiered pricing allows at most ${MAX_TIERS} packages` };
    const taken = new Set();
    const tiers = [];
    for (const t of raw) {
      const name = str(t?.name, MAX_NAME);
      if (!name) return { error: "every package needs a name" };
      const amount = money(t?.amount);
      if (!validAmount(amount)) return { error: `package "${name}" needs a valid amount` };
      // Reuse the incoming id when it's usable so `selected` survives a rename;
      // fall back to deriving one from the name.
      const given = str(t?.id, 40);
      let id;
      if (given && !taken.has(given)) { taken.add(given); id = given; }
      else id = tierId(name, taken);
      tiers.push({
        id, name, amount,
        summary: str(t?.summary, MAX_NOTES),
        recommended: !!t?.recommended
      });
    }
    // Exactly one recommendation, so the customer-facing page never has to pick.
    let seenRecommended = false;
    for (const t of tiers) {
      if (t.recommended && seenRecommended) t.recommended = false;
      if (t.recommended) seenRecommended = true;
    }
    const selected = str(input.selected, 40);
    if (selected && !tiers.some(t => t.id === selected))
      return { error: "the selected package is not in the list" };
    return { value: { kind: "tiered", tiers, ...(selected ? { selected } : {}) } };
  }

  const raw = Array.isArray(input.items) ? input.items : [];
  if (!raw.length) return { error: "itemized pricing needs at least one line item" };
  if (raw.length > MAX_ITEMS) return { error: `itemized pricing allows at most ${MAX_ITEMS} line items` };
  const items = [];
  for (const it of raw) {
    const description = str(it?.description, MAX_NAME);
    if (!description) return { error: "every line item needs a description" };
    const qty = money(it?.qty ?? 1);
    const rate = money(it?.rate);
    if (!Number.isFinite(qty) || qty <= 0 || qty > 100_000) return { error: `"${description}" needs a valid quantity` };
    if (!validAmount(rate)) return { error: `"${description}" needs a valid rate` };
    items.push({ description, qty, rate });
  }
  const discount = money(input.discount ?? 0);
  if (!validAmount(discount)) return { error: "invalid discount" };
  const subtotal = items.reduce((s, i) => s + i.qty * i.rate, 0);
  if (discount > subtotal) return { error: "the discount is larger than the subtotal" };
  return {
    value: {
      kind: "itemized", items,
      ...(discount ? { discount } : {}),
      notes: str(input.notes, MAX_NOTES)
    }
  };
}

/* The single number that flows to the deal, the invoice, and the contract.
   Tiered pricing has no total until the customer picks a package, so this
   returns null and callers show "pending selection" rather than a wrong $0. */
export function pricingTotal(p) {
  if (!p) return null;
  if (p.kind === "flat") return p.amount;
  if (p.kind === "tiered") {
    const chosen = p.tiers?.find(t => t.id === p.selected);
    return chosen ? chosen.amount : null;
  }
  if (p.kind === "itemized") {
    const subtotal = (p.items || []).reduce((s, i) => s + i.qty * i.rate, 0);
    return money(subtotal - (p.discount || 0));
  }
  return null;
}

/* Rows for a rendered table (PDF, customer page, contract). Kept here rather
   than in each renderer so the three surfaces can never disagree about what a
   given pricing object means. */
export function pricingLines(p) {
  if (!p) return [];
  if (p.kind === "flat") return [{ label: p.label || "Project fee", amount: p.amount }];
  if (p.kind === "tiered")
    return (p.tiers || []).map(t => ({
      label: t.name, amount: t.amount, detail: t.summary,
      recommended: t.recommended, selected: t.id === p.selected
    }));
  const rows = (p.items || []).map(i => ({
    label: i.description, amount: money(i.qty * i.rate),
    detail: i.qty === 1 ? null : `${i.qty} × $${i.rate.toLocaleString("en-US")}`
  }));
  if (p.discount) rows.push({ label: "Discount", amount: -p.discount });
  return rows;
}

const fmt = n => (n < 0 ? "-" : "") + "$" + Math.abs(n).toLocaleString("en-US", { maximumFractionDigits: 2 });

/* Plain-text rendering, used where structure can't be shown: email bodies, the
   text fallback in `sections.pricing`, and The Optimist's context block. */
export function pricingText(p) {
  if (!p) return "";
  const lines = pricingLines(p).map(r =>
    `${r.label}: ${fmt(r.amount)}${r.detail ? ` (${r.detail})` : ""}${r.recommended ? " [recommended]" : ""}${r.selected ? " [selected]" : ""}`);
  const total = pricingTotal(p);
  if (total !== null) lines.push(`Total: ${fmt(total)}`);
  else if (p.kind === "tiered") lines.push("Total: pending package selection");
  return lines.join("\n");
}

export const formatMoney = fmt;

/* A proposal offers a menu; a contract is for one thing at one price. Once the
   customer has picked a package, collapse the tier list to that single line so
   the agreement they sign doesn't also quote the options they declined. Only
   used at contract generation — the proposal keeps its full tier list. */
export function collapseToSelected(p) {
  if (p?.kind !== "tiered") return p || null;
  const chosen = p.tiers?.find(t => t.id === p.selected);
  if (!chosen) return p;
  return {
    kind: "flat",
    amount: chosen.amount,
    label: chosen.name,
    notes: chosen.summary || ""
  };
}

/* Deviation detection (FR11). Compares the priced substance only: a renamed
   package or an edited summary is presentation, a changed number is a
   deviation the contract has to declare. Tier order is normalized so
   reordering the packages doesn't read as a price change. */
export function samePricing(a, b) {
  if (!a && !b) return true;
  if (!a || !b) return false;
  if (a.kind !== b.kind) return false;
  if (a.kind === "flat") return a.amount === b.amount;
  if (a.kind === "tiered") {
    const key = p => (p.tiers || []).map(t => `${t.id}:${t.amount}`).sort().join("|") + `#${p.selected || ""}`;
    return key(a) === key(b);
  }
  const key = p => (p.items || []).map(i => `${i.description}:${i.qty}:${i.rate}`).sort().join("|")
    + `#${p.discount || 0}`;
  return key(a) === key(b);
}

/* One-line human summary of what changed, for the deviation banner. */
export function pricingDiffSummary(before, after) {
  const a = pricingTotal(before), b = pricingTotal(after);
  if (a === null && b === null) return "Pricing structure changed";
  if (a === null) return `Pricing set to ${fmt(b)}`;
  if (b === null) return `Pricing total removed (was ${fmt(a)})`;
  if (a === b) return "Pricing structure changed, total unchanged";
  return `Total changed from ${fmt(a)} to ${fmt(b)}`;
}
