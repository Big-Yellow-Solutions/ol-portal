import type { Deal, Proposal, Role } from "@/lib/types";

// Mirrors backend/src/app.mjs's perms() exactly. These are UI-affordance
// checks only — the server re-enforces the real permission matrix on every
// request.
export const can = {
  seesLab: (role: Role, myLabs: string[], lab: string) =>
    role === "Admin" || (role === "Lab Leader" && myLabs.includes(lab)),
  addDeal: (role: Role, myLabs: string[]) =>
    role === "Admin" || (role === "Lab Leader" && myLabs.length > 0),
  editDeal: (deal: Deal, role: Role, myLabs: string[], myKey: string | null) =>
    role === "Admin" ||
    (role === "Lab Leader" && (myLabs.includes(deal.lab) || deal.owner === myKey)),
  deleteDeal: (role: Role) => role === "Admin",
  changeLab: (role: Role) => role === "Admin",
  reviewInvoices: (role: Role) => role === "Admin",
  editProposal: (
    proposal: Proposal,
    role: Role,
    myLabs: string[],
    myKey: string | null
  ) =>
    role === "Admin" ||
    (role === "Lab Leader" &&
      (myLabs.includes(proposal.lab) || proposal.owner === myKey)),
  approveProposal: (role: Role) => role === "Admin",
  // Companies/Contacts aren't lab-scoped — see backend/src/identity.mjs's
  // manageContacts, which this mirrors exactly.
  manageContacts: (role: Role) => role === "Admin" || role === "Lab Leader",
};
