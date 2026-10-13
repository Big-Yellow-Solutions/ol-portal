/* The pipeline's stages, in order — the one place their stored names live.
   Mirrors web/lib/types.ts's STAGES and web/lib/pipeline.ts.

   The stored value is also the label: a deal record says "Closed Won (Paid)",
   not a code that the UI translates.

   Proposal & Negotiation is one stage: it opens when a proposal goes out, and
   a contract may be sent and negotiated inside it. Contracted (Signed) is
   entered only on a signed contract — that is its gate. Closed Won (Paid) is
   entered only on payment, proved by an uploaded invoice, since payment terms
   vary and an invoice going out says nothing about being paid. */
export const LEAD = "Lead";
export const DISCOVERY = "Discovery";
export const PROPOSAL_NEGOTIATION = "Proposal & Negotiation";
export const CONTRACTED = "Contracted (Signed)";
export const CLOSED_WON = "Closed Won (Paid)";
export const CLOSED_LOST = "Closed Lost";

export const STAGES = [LEAD, DISCOVERY, PROPOSAL_NEGOTIATION, CONTRACTED, CLOSED_WON, CLOSED_LOST];

/* Where each pre-rename stored value lands. scripts/migrate-stages.mjs is the
   only reader; kept here so the mapping lives next to the names it targets. */
export const LEGACY_STAGE_MAP = {
  "Proposal Sent": PROPOSAL_NEGOTIATION,
  "Negotiating": PROPOSAL_NEGOTIATION,
  "Contracted": CONTRACTED,
  "Closed": CLOSED_WON
};

export const isSettled = stage => stage === CLOSED_WON || stage === CLOSED_LOST;
