import type { Role } from "@/lib/types";

// These are UI affordance checks only — the server re-enforces the real
// permission matrix, mirroring the original store.js `can` helpers.
export const can = {
  addDeal: (role: Role) => role === "Admin" || role === "Lab Leader",
  editDeal: (role: Role) => role === "Admin" || role === "Lab Leader",
  deleteDeal: (role: Role) => role === "Admin",
  changeLab: (role: Role) => role === "Admin",
  reviewInvoices: (role: Role) => role === "Admin",
  editProposal: (role: Role) => role === "Admin" || role === "Lab Leader",
  approveProposal: (role: Role) => role === "Admin" || role === "Lab Leader",
};
