import type { Company, Contact, Deal, Stage } from "@/lib/types";
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

export const billingRequiredAt = (stage: Stage): boolean =>
  stageIndex(stage) >= stageIndex(BILLING_GATE_STAGE);

export const proposalRequiredAt = (stage: Stage): boolean =>
  stageIndex(stage) >= stageIndex("Proposal Sent");

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
