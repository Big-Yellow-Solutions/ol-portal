"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { publicApi } from "@/lib/public-api";
import { SECTION_LABELS } from "@/lib/types";

// Matches backend/src/proposals.mjs's shareView/shareDecision response
// shapes exactly.
type DecisionAction = "approve" | "reject" | "revision";

interface Decision {
  action: DecisionAction;
  comment?: string;
  name?: string;
  at: string;
  version: number;
}

interface SharedProposal {
  title: string;
  client?: string;
  version: number;
  sentAt: string;
  status: string;
  sections: Record<string, string>;
  decision: Decision | null;
}

const ACTION_LABEL: Record<DecisionAction, string> = {
  approve: "Approve",
  reject: "Decline",
  revision: "Request revisions",
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
  const [showDecisionForm, setShowDecisionForm] = useState<DecisionAction | null>(null);
  const [name, setName] = useState("");
  const [comment, setComment] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!token) {
      setError("Missing proposal link.");
      return;
    }
    publicApi<SharedProposal>(`/share/${token}`)
      .then(setProposal)
      .catch((err) => setError(err instanceof Error ? err.message : "Could not load proposal."));
  }, [token]);

  const submitDecision = async (action: DecisionAction) => {
    if (!token) return;
    setSubmitting(true);
    try {
      const result = await publicApi<{ recorded: DecisionAction }>(
        `/share/${token}/decision`,
        {
          method: "POST",
          body: JSON.stringify({ action, name, comment }),
        }
      );
      setProposal((p) =>
        p
          ? {
              ...p,
              decision: {
                action: result.recorded,
                name,
                comment,
                at: new Date().toISOString(),
                version: p.version,
              },
            }
          : p
      );
      setShowDecisionForm(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not submit your decision.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-violet-deep px-4 py-10">
      <div className="mx-auto max-w-2xl rounded-2xl bg-white p-8 shadow-xl">
        {error && <p className="text-sm text-red">{error}</p>}
        {!proposal && !error && <p className="text-sm text-ink-mute">Loading…</p>}

        {proposal && (
          <>
            <h1 className="font-serif text-2xl italic text-ink">{proposal.title}</h1>
            {proposal.client && (
              <p className="mt-1 text-sm text-ink-mute">for {proposal.client}</p>
            )}
            <p className="mt-1 text-xs text-ink-mute">Version {proposal.version}</p>

            <div className="mt-6 flex flex-col gap-6">
              {Object.entries(proposal.sections).map(([key, value]) => (
                <div key={key}>
                  <h2 className="font-serif text-lg text-ink">
                    {SECTION_LABELS[key] ?? key}
                  </h2>
                  <p className="mt-1 whitespace-pre-wrap text-sm text-ink-soft">{value}</p>
                </div>
              ))}
            </div>

            {proposal.decision ? (
              <div className="mt-8 rounded-md bg-violet-pale p-4 text-sm text-ink">
                Decision recorded: <strong>{ACTION_LABEL[proposal.decision.action]}</strong>
                {proposal.decision.name && ` by ${proposal.decision.name}`}
              </div>
            ) : showDecisionForm ? (
              <div className="mt-8 flex flex-col gap-3">
                <Input
                  placeholder="Your name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
                <Textarea
                  placeholder="Comment (optional)"
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  rows={3}
                />
                <div className="flex gap-2">
                  <Button
                    disabled={submitting || !name}
                    onClick={() => submitDecision(showDecisionForm)}
                    className="bg-violet-deep hover:bg-violet"
                  >
                    Confirm {ACTION_LABEL[showDecisionForm].toLowerCase()}
                  </Button>
                  <Button variant="outline" onClick={() => setShowDecisionForm(null)}>
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <div className="mt-8 flex flex-wrap gap-3">
                <Button
                  className="bg-green hover:bg-green/90"
                  onClick={() => setShowDecisionForm("approve")}
                >
                  Approve
                </Button>
                <Button variant="outline" onClick={() => setShowDecisionForm("revision")}>
                  Request revisions
                </Button>
                <Button
                  variant="outline"
                  className="border-red text-red hover:bg-red-pale"
                  onClick={() => setShowDecisionForm("reject")}
                >
                  Decline
                </Button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
