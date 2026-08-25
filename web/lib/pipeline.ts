import type { Company, Contact, Deal, Stage } from "@/lib/types";
import { STAGES } from "@/lib/types";

/* Pipeline v2 (design handoff): shared domain logic for the billing-entity
   gate. Mirrors backend/src/app.mjs's BILLING_GATE_STAGE and gate checks
   exactly, so the board's drag-and-drop can pre-empt a rejected save with the
   same rule the server enforces. */
export const BILLING_GATE_STAGE: Stage = "Proposal Sent";

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
