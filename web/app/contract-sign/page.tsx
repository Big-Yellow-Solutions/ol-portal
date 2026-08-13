"use client";

/* Customer-facing contract signing page (Base Contract PRD 5.5, FR14).

   The four things ESIGN and UETA require are deliberate, visible acts on this
   page rather than fine print: the customer reads the agreement, ticks a
   consent box whose exact wording is stored with their signature, types or
   draws a signature, and submits. The server stamps the timestamp, IP and
   user-agent and re-checks that the document still hashes to what was sent.

   Signing is sequential. After the customer signs, the page shows that OL's
   countersignature is pending; once an Admin countersigns, the same link
   serves the fully executed PDF. */

import { Suspense, useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { PricingTable } from "@/components/pricing-table";
import {
  SignatureCapture,
  emptySignature,
  signatureReady,
  signaturePayload,
  type SignatureState,
} from "@/components/signature-capture";
import { publicApi } from "@/lib/public-api";
import { SECTION_LABELS } from "@/lib/types";
import type { ContractClause, ContractSignatures, Pricing } from "@/lib/types";

interface SigningDocument {
  contractId: string;
  client: string;
  sections: Record<string, string>;
  pricing: Pricing | null;
  clauses: ContractClause[];
  paymentSchedule: string;
  startDate: string;
  endDate: string;
  clientSignerName: string;
  clientSignerTitle: string;
}

interface SignView {
  contractId: string;
  client: string;
  status: string;
  /* What this document is called. Server-sent from the live record rather than
     the frozen copy, so a contract sent before contributor paper existed still
     labels itself instead of rendering blank. */
  docTitle?: string;
  parentId?: string | null;
  document: SigningDocument;
  documentHash: string;
  brand: { lab: string | null; accent: string | null; org: string };
  signerName: string;
  signerTitle: string;
  olSignatoryName: string;
  signatures: ContractSignatures;
  awaiting: "client" | "ol" | null;
  executedAt: string | null;
  pdfReady: boolean;
}

export default function ContractSignPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-violet-deep text-white">
          Loading…
        </div>
      }
    >
      <ContractSignView />
    </Suspense>
  );
}

function ContractSignView() {
  const token = useSearchParams().get("token");
  const [view, setView] = useState<SignView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [signature, setSignature] = useState<SignatureState>(() => emptySignature());
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(() => {
    if (!token) {
      setError("This link is missing its contract reference.");
      return;
    }
    publicApi<SignView>(`/sign/${token}`)
      .then((v) => {
        setView(v);
        // Prefill from the contract, but leave it editable: the person opening
        // the link may sign under a slightly different name or title.
        setSignature((s) =>
          s.name || s.title ? s : { ...s, name: v.signerName, title: v.signerTitle }
        );
      })
      .catch((err) =>
        setError(err instanceof Error ? err.message : "Could not load this agreement.")
      );
  }, [token]);

  useEffect(load, [load]);

  const sign = async () => {
    if (!token) return;
    setSubmitting(true);
    setError(null);
    try {
      await publicApi(`/sign/${token}`, {
        method: "POST",
        body: JSON.stringify(signaturePayload(signature)),
      });
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not record your signature.");
    } finally {
      setSubmitting(false);
    }
  };

  const download = async () => {
    if (!token) return;
    try {
      const { url } = await publicApi<{ url: string }>(`/sign/${token}/pdf`);
      window.open(url, "_blank");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not fetch the signed copy.");
    }
  };

  const accent = view?.brand.accent ?? null;
  const doc = view?.document;

  return (
    <div className="min-h-screen bg-violet-deep px-4 py-6 sm:py-10">
      <div className="mx-auto max-w-3xl overflow-hidden rounded-2xl bg-white shadow-xl">
        <div
          className="h-1.5 w-full"
          style={{ backgroundColor: accent ?? "var(--color-violet-deep, #3D2FD4)" }}
        />
        <div className="p-6 sm:p-8">
          {error && (
            <p className="mb-4 rounded-md bg-red-pale px-3 py-2 text-sm text-red">{error}</p>
          )}
          {!view && !error && <p className="text-sm text-ink-mute">Loading…</p>}

          {view && doc && (
            <>
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-mute">
                {view.brand.lab ? `${view.brand.org} · ${view.brand.lab}` : view.brand.org}
              </p>
              <h1 className="mt-2 font-serif text-2xl italic text-ink sm:text-3xl">
                {view.docTitle ?? "Services Agreement"}
              </h1>
              <p className="mt-1 text-sm text-ink-mute">
                {view.contractId} · between Optimistic Labs and {view.client}
                {view.parentId && ` · issued under ${view.parentId}`}
              </p>

              {/* Commercial terms first: this is what a signer checks before
                  reading the standard clauses. */}
              <dl className="mt-6 grid gap-px overflow-hidden rounded-lg bg-foreground/10 ring-1 ring-foreground/10 sm:grid-cols-2">
                <Field label="Payment schedule" value={doc.paymentSchedule} />
                <Field
                  label="Term"
                  value={
                    doc.startDate || doc.endDate
                      ? `${doc.startDate || "—"} to ${doc.endDate || "—"}`
                      : ""
                  }
                />
              </dl>

              <div className="mt-7 flex flex-col gap-6">
                {Object.entries(SECTION_LABELS).map(([key, label]) => {
                  const body = doc.sections?.[key]?.trim();
                  if (key === "pricing") {
                    if (!body && !doc.pricing) return null;
                    return (
                      <div key={key}>
                        <h2 className="font-serif text-lg text-ink">{label}</h2>
                        {body && (
                          <p className="mt-1 whitespace-pre-wrap text-sm text-ink-soft">{body}</p>
                        )}
                        <PricingTable pricing={doc.pricing} accent={accent} />
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

                {doc.clauses?.length > 0 && (
                  <div>
                    <h2 className="font-serif text-lg text-ink">Terms and conditions</h2>
                    <div className="mt-2 flex flex-col gap-4">
                      {doc.clauses.map((c, i) => (
                        <div key={`${c.heading}-${i}`}>
                          {c.heading && (
                            <h3 className="text-sm font-semibold text-ink">{c.heading}</h3>
                          )}
                          <p className="mt-1 whitespace-pre-wrap text-sm text-ink-soft">{c.text}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              <div className="mt-8 border-t border-foreground/10 pt-6">
                {view.status === "Signed" ? (
                  <ExecutedPanel view={view} onDownload={download} />
                ) : view.signatures.client ? (
                  <div className="rounded-md bg-violet-pale p-4 text-sm text-ink">
                    <p className="font-medium">
                      Signed by {view.signatures.client.name} on{" "}
                      {new Date(view.signatures.client.at).toLocaleDateString("en-US")}.
                    </p>
                    <p className="mt-1 text-ink-soft">
                      Waiting on {view.olSignatoryName || "Optimistic Labs"} to countersign. You
                      will get the fully executed copy by email, and this link will serve it too.
                    </p>
                  </div>
                ) : (
                  <>
                    <h2 className="mb-4 font-serif text-lg text-ink">Sign this agreement</h2>
                    <SignatureCapture
                      value={signature}
                      onChange={setSignature}
                      accent={accent}
                    />
                    <Button
                      disabled={submitting || !signatureReady(signature)}
                      onClick={sign}
                      style={accent ? { backgroundColor: accent } : undefined}
                      className="mt-4"
                    >
                      {submitting ? "Signing…" : "Sign agreement"}
                    </Button>
                  </>
                )}
              </div>

              <p className="mt-6 break-all text-[10px] text-ink-mute">
                Document fingerprint (SHA-256): {view.documentHash}
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  if (!value) return null;
  return (
    <div className="bg-white px-4 py-3">
      <dt className="text-[11px] uppercase tracking-wide text-ink-mute">{label}</dt>
      <dd className="mt-0.5 whitespace-pre-wrap text-sm text-ink">{value}</dd>
    </div>
  );
}

function ExecutedPanel({ view, onDownload }: { view: SignView; onDownload: () => void }) {
  return (
    <div className="rounded-md bg-green-pale p-4 text-sm text-ink">
      <p className="font-medium">This agreement is fully executed.</p>
      <ul className="mt-2 flex flex-col gap-1 text-ink-soft">
        {view.signatures.client && (
          <li>
            {view.client}: {view.signatures.client.name}
            {view.signatures.client.title && `, ${view.signatures.client.title}`} ·{" "}
            {new Date(view.signatures.client.at).toLocaleString("en-US")}
          </li>
        )}
        {view.signatures.ol && (
          <li>
            Optimistic Labs: {view.signatures.ol.name} ·{" "}
            {new Date(view.signatures.ol.at).toLocaleString("en-US")}
          </li>
        )}
      </ul>
      {view.pdfReady ? (
        <Button className="mt-3" onClick={onDownload}>
          Download the countersigned PDF
        </Button>
      ) : (
        <p className="mt-3 text-xs text-ink-mute">
          The countersigned PDF is being prepared and will arrive by email shortly.
        </p>
      )}
    </div>
  );
}
