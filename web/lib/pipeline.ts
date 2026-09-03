import type { Assignment, Company, Contact, Deal, Stage } from "@/lib/types";
import { STAGES } from "@/lib/types";

/* Pipeline v2 (design handoff): shared domain logic for the billing-entity
   gate. Mirrors backend/src/app.mjs's BILLING_GATE_STAGE and gate checks
   exactly, so the board's drag-and-drop can pre-empt a rejected save with the
   same rule the server enforces. */
export const BILLING_GATE_STAGE: Stage = "Proposal Sent";

/* The handoff's "tweakable props — surface as config, not UI". They are
   constants rather than settings because nothing in the portal stores
   per-user board preferences; a build is the place this gets changed.
   `billingRequiredFrom` is BILLING_GATE_STAGE above, and unlike these two it
   is not free to move — the backend enforces the same stage, so changing it
   here alone would only make the board lie about what the server will accept. */
export const SHOW_BILLING_ON_CARDS = true;
export const SHOW_COLUMN_TOTALS = true;

const stageIndex = (s: Stage) => STAGES.indexOf(s);

/* Pipeline v3's second closed column. A deal can be lost from anywhere, so
   losing one is gated on nothing — no billing entity, no sent proposal, no
   signed contract, no assignment. Every gate below therefore asks "is this the
   lost stage?" before it asks where the stage sits in the order, because by
   index alone Closed Lost sits past every gate there is. Mirrors the same
   carve-out in backend/src/app.mjs. */
export const CLOSED_WON: Stage = "Closed";
export const CLOSED_LOST: Stage = "Closed Lost";
export const isLost = (stage: Stage): boolean => stage === CLOSED_LOST;
export const isClosedStage = (stage: Stage): boolean => stage === CLOSED_WON || stage === CLOSED_LOST;

export const billingRequiredAt = (stage: Stage): boolean =>
  !isLost(stage) && stageIndex(stage) >= stageIndex(BILLING_GATE_STAGE);

export const proposalRequiredAt = (stage: Stage): boolean =>
  !isLost(stage) && stageIndex(stage) >= stageIndex("Proposal Sent");

/** Design's `initials()` for a freeform name — distinct from lib/data.ts's
 *  `initials()`, which reads a staff Person's firstName/lastName. */
export function initialsOf(name: string): string {
  const letters = name
    .replace(/[^A-Za-z ]/g, "")
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "");
  return letters.join("") || "?";
}

export interface BillingInfo {
  name: string;
  sub: string;
  initials: string;
  /** Which shape the tile should render: a company gets a rounded-square
   *  tile, a contact (person) gets a circular one. */
  kind: "company" | "contact";
  /** A real company or contact is linked. */
  ok: boolean;
  /** Unlinked, and the deal has reached the gate stage. */
  due: boolean;
}

/** Mirrors the design's `billingOf(d)`. `companies`/`contacts` are keyed by
 *  id for O(1) lookups on a board with many cards. */
export function billingOf(
  deal: Pick<Deal, "companyId" | "contactId" | "stage">,
  companies: Record<string, Company>,
  contacts: Record<string, Contact>
): BillingInfo {
  const company = deal.companyId ? companies[deal.companyId] : undefined;
  const contact = deal.contactId ? contacts[deal.contactId] : undefined;

  if (company) {
    return {
      name: company.name,
      sub: contact ? `${contact.name} · primary contact` : "No primary contact",
      initials: initialsOf(company.name),
      kind: "company",
      ok: true,
      due: false,
    };
  }
  if (contact) {
    const atCompany = contact.companyId ? companies[contact.companyId] : undefined;
    return {
      name: contact.name,
      sub: atCompany ? `${contact.title || "Contact"} · ${atCompany.name}` : contact.title || "Individual",
      initials: initialsOf(contact.name),
      kind: "contact",
      ok: true,
      due: false,
    };
  }
  const due = billingRequiredAt(deal.stage);
  return {
    name: due ? "Billing entity needed" : "No entity linked yet",
    sub: due ? "Required at this stage" : `Fine until ${BILLING_GATE_STAGE}`,
    initials: "?",
    kind: "company",
    ok: false,
    due,
  };
}

/** The recurring engine (backend/src/recurring.mjs) always bills monthly —
 *  there's no configurable cadence on a deal, unlike the design's prototype
 *  schedule builder (Monthly/Quarterly/.../"for N cycles"). This describes
 *  what actually happens rather than a schedule the backend can't run. */
export function cadenceOf(deal: Pick<Deal, "recurring" | "recurPaused" | "recurEnd">): string {
  if (!deal.recurring) return "";
  if (deal.recurPaused) return "Monthly · paused";
  return deal.recurEnd ? `Monthly · until ${deal.recurEnd}` : "Monthly";
}

/** The company to show for a person. Their own record wins; failing that, the
 *  company on a deal they are the point of contact for. A person named on a
 *  deal that bills to a company is not "an individual — no company", which is
 *  what reading `contact.companyId` on its own made them look like. */
export function companyForContact(
  contact: Pick<Contact, "id" | "companyId">,
  companies: Record<string, Company>,
  deals: Pick<Deal, "contactId" | "companyId">[]
): { company: Company | undefined; viaDeal: boolean } {
  const own = contact.companyId ? companies[contact.companyId] : undefined;
  if (own) return { company: own, viaDeal: false };
  for (const d of deals) {
    if (d.contactId !== contact.id || !d.companyId) continue;
    const company = companies[d.companyId];
    if (company) return { company, viaDeal: true };
  }
  return { company: undefined, viaDeal: false };
}


/* ---------- Lab Leader Assignment (Pipeline v3) ----------

   Mirrors backend/src/assignments.mjs. The server recomputes and stores these
   figures on every write — this exists so the form can show the pool moving as
   somebody types, before anything is filed. */

/* Who may approve a filed assignment. Mirrors ASSIGNMENT_APPROVER in
   backend/src/assignments.mjs, which is the authority — this only decides
   whether the button is drawn. A person rather than a role on purpose: there
   are two Admins and only one of them approves. */
export const ASSIGNMENT_APPROVER = "liz";

export const POOL_PCT = 70;
export const SOFT_RESERVE_PCT = 5;

export const CADENCES = [
  "On signature",
  "Monthly",
  "Quarterly",
  "Annually",
  "On milestones",
  "50% up front, 50% on delivery",
] as const;

export interface PoolMath {
  softReserve: number;
  net: number;
  pool: number;
  payouts: { key: string; pct: number; payout: number }[];
}

export function assignmentMath(input: {
  contractValue: number;
  hardCosts: number;
  subcontractorCosts: number;
  leaders: { key: string; pct: number }[];
}): PoolMath {
  const gross = Math.max(input.contractValue || 0, 0);
  const softReserve = Math.round((gross * SOFT_RESERVE_PCT) / 100);
  const net = Math.max(gross - (input.hardCosts || 0) - (input.subcontractorCosts || 0) - softReserve, 0);
  const pool = Math.round((net * POOL_PCT) / 100);
  return {
    softReserve,
    net,
    pool,
    payouts: input.leaders.map((l) => ({ key: l.key, pct: l.pct, payout: Math.round((pool * l.pct) / 100) })),
  };
}

/** Even split with the remainder going to the earliest leaders, so the shares
 *  always total exactly 100 rather than 99 with a rounding crumb lost. */
export function splitEvenly(keys: string[]): Record<string, number> {
  const out: Record<string, number> = {};
  if (!keys.length) return out;
  const base = Math.floor(100 / keys.length);
  let remainder = 100 - base * keys.length;
  for (const key of keys) {
    out[key] = base + (remainder > 0 ? 1 : 0);
    if (remainder > 0) remainder -= 1;
  }
  return out;
}

export type AssignmentState = "locked" | "needed" | "filed" | "approved";

/** Which of the Assignment tab's three faces a deal should show. A lost deal
 *  never needs one, which is the whole reason the stage exists. */
export function assignmentState(deal: Pick<Deal, "stage" | "assignment">): AssignmentState {
  if (deal.stage !== CLOSED_WON) return "locked";
  const a = deal.assignment;
  if (!a) return "needed";
  return a.approved ? "approved" : "filed";
}

/** The leader line as the receipt renders it: "Marcus Bell — 60%, Aliza Roth — 40%". */
export const leadersLine = (a: Assignment, nameOf: (key: string) => string): string =>
  a.leaders.map((l) => `${nameOf(l.key)} — ${l.pct}%`).join(", ");
