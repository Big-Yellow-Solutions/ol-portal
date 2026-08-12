"use client";

/* Customer-facing proposal page (Base Contract PRD 5.2). No login: the 32-hex
   share token in the URL is the only credential.

   Three things changed with the Base Contract PRD:
   - Pricing renders as a real table, and tiered pricing is where the customer
     picks their package. That choice is what gives the proposal a total, so
     approving a tiered proposal requires one.
   - A customer who asked for changes can come back to the revised version and
     decide again. The page is scoped to the version they were last sent, and
     earlier rounds show as history so a returning reader can see their
     comments were received.
   - The page brands to the lab that sent it, falling back to the OL master
     brand, and is built to be read on a phone from an email. */

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { PricingTable } from "@/components/pricing-table";
import { publicApi } from "@/lib/public-api";
import { SECTION_LABELS } from "@/lib/types";
import type { Pricing, ProposalDecision } from "@/lib/types";

// Matches backend/src/proposals.mjs's shareView/shareDecision response shapes.
type CustomerAction = "approve" | "revision";

interface SharedProposal {
  title: string;
  client?: string;
  version: number;
  sentAt: string;
  status: string;
  sections: Record<string, string>;
  pricing: Pricing | null;
  brand: { lab: string | null; accent: string | null; org: string };
  preparedBy: string | null;
  decision: ProposalDecision | null;
  history: ProposalDecision[];
}

const ACTION_LABEL: Record<string, string> = {
  approve: "Approved",
  revision: "Changes requested",
  reject: "Declined",
};

export default function ProposalSharePage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-violet-deep text-white">
          Loading…
        </div>
      }
    >
      <ProposalShareView />
    </Suspense>
  );
}

function ProposalShareView() {
  const token = useSearchParams().get("token");
  const [proposal, setProposal] = useState<SharedProposal | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [formAction, setFormAction] = useState<CustomerAction | null>(null);
  const [name, setName] = useState("");
  const [comment, setComment] = useState("");
  const [selectedTier, setSelectedTier] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!token) {
      setError("This link is missing its proposal reference.");
      return;
    }
    publicApi<SharedProposal>(`/share/${token}`)
      .then((p) => {
        setProposal(p);
        if (p.pricing?.kind === "tiered") {
          setSelectedTier(
            p.pricing.selected ?? p.pricing.tiers.find((t) => t.recommended)?.id ?? null
          );
        }
      })
      .catch((err) =>
        setError(err instanceof Error ? err.message : "Could not load this proposal.")
      );
  }, [token]);

  const accent = proposal?.brand.accent ?? null;
  const isTiered = proposal?.pricing?.kind === "tiered";
  const needsTier = isTiered && !selectedTier;

  const submitDecision = async (action: CustomerAction) => {
    if (!token || !proposal) return;
    setSubmitting(true);
    setError(null);
    try {
      await publicApi<{ recorded: string }>(`/share/${token}/decision`, {
        method: "POST",
        body: JSON.stringify({
          action,
          name,
          comment,
          ...(selectedTier ? { selectedTier } : {}),
        }),
      });
      // Re-read rather than patching local state: the server decides the
      // resulting status and, for a tiered approval, the resolved total.
      const fresh = await publicApi<SharedProposal>(`/share/${token}`);
      setProposal(fresh);
      setFormAction(null);
      setComment("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not record your response.");
    } finally {
      setSubmitting(false);
    }
  };

  const sentDate = proposal?.sentAt
    ? new Date(proposal.sentAt).toLocaleDateString("en-US", {
        month: "long",
        day: "numeric",
        year: "numeric",
      })
    : null;

  return (
    <div className="min-h-screen bg-violet-deep px-4 py-6 sm:py-10">
      <div className="mx-auto max-w-2xl overflow-hidden rounded-2xl bg-white shadow-xl">
        <div
          className="h-1.5 w-full"
          style={{ backgroundColor: accent ?? "var(--color-violet-deep, #3D2FD4)" }}
        />
        <div className="p-6 sm:p-8">
          {error && (
            <p className="mb-4 rounded-md bg-red-pale px-3 py-2 text-sm text-red">{error}</p>
          )}
          {!proposal && !error && <p className="text-sm text-ink-mute">Loading…</p>}

          {proposal && (
            <>
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-mute">
                {proposal.brand.lab
                  ? `${proposal.brand.org} · ${proposal.brand.lab}`
                  : proposal.brand.org}
              </p>
              <h1 className="mt-2 font-serif text-2xl italic text-ink sm:text-3xl">
                {proposal.title}
              </h1>
              {proposal.client && (
                <p className="mt-1 text-sm text-ink-mute">Prepared for {proposal.client}</p>
              )}
              <p className="mt-1 text-xs text-ink-mute">
                Version {proposal.version}
                {sentDate && ` · sent ${sentDate}`}
                {proposal.preparedBy && ` · ${proposal.preparedBy}`}
              </p>

              {proposal.history.length > 0 && !proposal.decision && (
                <div className="mt-6 rounded-md bg-violet-pale px-4 py-3 text-sm text-ink">
                  <p className="font-medium">This is a revised version.</p>
                  {proposal.history
                    .filter((h) => h.action === "revision")
                    .slice(-1)
                    .map((h) => (
                      <p key={h.at} className="mt-1 text-ink-soft">
                        You asked for: “{h.comment}”
                      </p>
                    ))}
                </div>
              )}

              <div className="mt-7 flex flex-col gap-6">
                {Object.entries(SECTION_LABELS).map(([key, label]) => {
                  const body = proposal.sections?.[key]?.trim();
                  // The structured table replaces the pricing prose whenever
                  // there is one, so the figures are never stated twice.
                  if (key === "pricing") {
                    if (!body && !proposal.pricing) return null;
                    return (
                      <div key={key}>
                        <h2 className="font-serif text-lg text-ink">{label}</h2>
                        {body && (
                          <p className="mt-1 whitespace-pre-wrap text-sm text-ink-soft">{body}</p>
                        )}
                        <PricingTable
                          pricing={proposal.pricing}
                          accent={accent}
                          onSelectTier={
                            isTiered && !proposal.decision
                              ? (id) => setSelectedTier(id)
                              : undefined
                          }
                        />
                        {isTiered && !proposal.decision && (
                          <p className="mt-2 text-xs text-ink-mute">
                            Choose the package that fits and we will price the agreement to match.
                          </p>
                        )}
                      </div>
                    );
                  }
                  if (!body) return null;
                  return (
                    <div key={key}>
                      <h2 className="font-serif text-lg text-ink">{label}</h2>
                      <p className="mt-1 whitespace-pre-wrap text-sm text-ink-soft">{body}</p>
                    </div>
                  );
                })}
              </div>

              {proposal.decision ? (
                <div className="mt-8 rounded-md bg-violet-pale p-4 text-sm text-ink">
                  <p>
                    <strong>{ACTION_LABEL[proposal.decision.action] ?? "Response recorded"}</strong>
                    {proposal.decision.name && ` by ${proposal.decision.name}`}
                  </p>
                  {proposal.decision.action === "approve" ? (
                    <p className="mt-1 text-ink-soft">
                      Thank you. We will send the agreement for signature shortly.
                    </p>
                  ) : (
                    <p className="mt-1 text-ink-soft">
                      Thank you. We will revise and send an updated version.
                    </p>
                  )}
                </div>
              ) : formAction ? (
                <div className="mt-8 flex flex-col gap-3 border-t border-foreground/10 pt-6">
                  <p className="text-sm font-medium text-ink">
                    {formAction === "approve" ? "Approve this proposal" : "Request changes"}
                  </p>
                  <Input
                    placeholder="Your full name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                  />
                  <Textarea
                    placeholder={
                      formAction === "approve"
                        ? "Anything you'd like us to know (optional)"
                        : "What would you like changed?"
                    }
                    value={comment}
                    onChange={(e) => setComment(e.target.value)}
                    rows={4}
                  />
                  {formAction === "approve" && needsTier && (
                    <p className="text-xs text-red">Choose a package above before approving.</p>
                  )}
                  <div className="flex flex-wrap gap-2">
                    <Button
                      disabled={
                        submitting ||
                        !name.trim() ||
                        (formAction === "revision" && !comment.trim()) ||
                        (formAction === "approve" && !!needsTier)
                      }
                      onClick={() => submitDecision(formAction)}
                      style={accent ? { backgroundColor: accent } : undefined}
                    >
                      {submitting
                        ? "Sending…"
                        : formAction === "approve"
                          ? "Confirm approval"
                          : "Send my comments"}
                    </Button>
                    <Button variant="outline" onClick={() => setFormAction(null)}>
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="mt-8 flex flex-wrap gap-3 border-t border-foreground/10 pt-6">
                  <Button
                    className="bg-green hover:bg-green/90"
                    onClick={() => setFormAction("approve")}
                  >
                    Approve this proposal
                  </Button>
                  <Button variant="outline" onClick={() => setFormAction("revision")}>
                    Request changes
                  </Button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
      <p className="mx-auto mt-4 max-w-2xl text-center text-xs text-white/60">
        Questions? Just reply to the email that brought you here.
      </p>
    </div>
  );
}
