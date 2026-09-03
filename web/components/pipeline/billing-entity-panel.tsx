"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api, ApiError } from "@/lib/api";
import { cn } from "@/lib/utils";
import { billingRequiredAt, initialsOf, BILLING_GATE_STAGE } from "@/lib/pipeline";
import { phoneError } from "@/lib/phone";
import { usePortalData } from "@/lib/portal-data";
import type { Company, Contact, Stage } from "@/lib/types";

/* Pipeline v2 (design handoff): the "Billing entity" panel inside the deal
   drawer. A deal can carry a company, a contact ("Person" in the design's own
   copy — kept here since it's user-facing text), both, or neither below the
   gate stage (lib/pipeline.ts's BILLING_GATE_STAGE, "Proposal Sent"). */
export function BillingEntityPanel({
  stage,
  companyId,
  contactId,
  onChangeCompany,
  onChangeContact,
  onOpenRecord,
  editable,
}: {
  stage: Stage;
  companyId: string | null;
  contactId: string | null;
  onChangeCompany: (id: string | null) => void;
  onChangeContact: (id: string | null) => void;
  onOpenRecord: (type: "company" | "contact", id: string) => void;
  editable: boolean;
}) {
  const { companies, contacts, setCompanies, setContacts } = usePortalData();
  const [cq, setCq] = useState("");
  const [pq, setPq] = useState("");
  const [inline, setInline] = useState<"company" | "person" | null>(null);
  const [icName, setIcName] = useState("");
  const [icEmail, setIcEmail] = useState("");
  const [icPhone, setIcPhone] = useState("");
  const [ipName, setIpName] = useState("");
  const [ipEmail, setIpEmail] = useState("");
  const [ipPhone, setIpPhone] = useState("");
  const [saving, setSaving] = useState(false);

  const company = companies.find((c) => c.id === companyId) ?? null;
  const contact = contacts.find((c) => c.id === contactId) ?? null;
  const companyOfContact = (c: Contact) => (c.companyId ? companies.find((x) => x.id === c.companyId) : undefined);
  const linked = !!company || !!contact;
  const gated = billingRequiredAt(stage);
  const suggestion =
    company?.contactId && company.contactId !== contactId
      ? (contacts.find((c) => c.id === company.contactId) ?? null)
      : null;

  const cqLower = cq.trim().toLowerCase();
  const companyOptions = companies
    .filter((c) => !cqLower || `${c.name} ${c.email ?? ""}`.toLowerCase().includes(cqLower))
    .slice(0, 4);
  const pqLower = pq.trim().toLowerCase();
  const contactOptions = contacts
    .filter((c) => !pqLower || `${c.name} ${c.email ?? ""}`.toLowerCase().includes(pqLower))
    .slice(0, 4);

  async function saveCompany() {
    const name = icName.trim();
    if (!name) return;
    setSaving(true);
    try {
      const created = await api<Company>("/companies", {
        method: "POST",
        body: JSON.stringify({ name, email: icEmail.trim(), phone: icPhone.trim() }),
      });
      setCompanies((prev) => [...prev, created]);
      onChangeCompany(created.id);
      setInline(null);
      setCq("");
      toast.success(`${name} saved to Contacts and attached`);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not save this company.");
    } finally {
      setSaving(false);
    }
  }

  const ipPhoneErr = phoneError(ipPhone);

  async function saveContact() {
    const name = ipName.trim();
    if (!name || ipPhoneErr) return;
    setSaving(true);
    try {
      const created = await api<Contact>("/contacts", {
        method: "POST",
        body: JSON.stringify({
          name,
          email: ipEmail.trim(),
          phone: ipPhone.trim(),
          companyId: companyId || undefined,
          title: companyId ? "Primary contact" : "Individual",
        }),
      });
      setContacts((prev) => [...prev, created]);
      // A new contact becomes its company's primary contact server-side when
      // it didn't have one yet — mirror that locally so the UI matches.
      if (companyId && company && !company.contactId) {
        setCompanies((prev) => prev.map((c) => (c.id === companyId ? { ...c, contactId: created.id } : c)));
      }
      onChangeContact(created.id);
      setInline(null);
      setPq("");
      toast.success(`${name} saved to Contacts and attached`);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not save this person.");
    } finally {
      setSaving(false);
    }
  }

  const badgeText = linked
    ? (company ? company.name : contact!.name)
    : gated
      ? `Required at ${stage}`
      : `Optional at ${stage}`;
  const note = linked
    ? company && contact
      ? `${contact.name} is the contact; ${company.name} is invoiced.`
      : company
        ? "Invoiced to the company. A primary contact is still worth adding."
        : "Invoiced directly to this person."
    : gated
      ? `A deal at ${stage} must be billable. Link a company, a person, or both.`
      : `Not needed yet — early-stage deals can sit unlinked. Required once the deal reaches ${BILLING_GATE_STAGE}.`;

  return (
    <div className="rounded-2xl border border-hair bg-warm-panel p-4">
      <div className="mb-1 flex items-center gap-2">
        <span className="text-[11px] font-semibold tracking-wide text-warm-gray uppercase">Billing entity</span>
        {/* Three states the design draws distinctly: attached (filled violet),
            required-and-missing (dashed red), optional-and-missing (dashed
            violet). Badge's variants don't cover the dashed forms. */}
        <span
          className={cn(
            "rounded-full px-2.5 py-0.5 text-[11px] font-semibold whitespace-nowrap",
            linked
              ? "border border-violet-deep/30 bg-violet-pale text-violet-deep"
              : gated
                ? "border border-dashed border-red/55 bg-white text-red"
                : "border border-dashed border-hair-strong bg-white text-warm-gray"
          )}
        >
          {badgeText}
        </span>
      </div>
      <p className="mb-3.5 text-xs leading-relaxed text-ink-mute">{note}</p>

      <span className="mb-1.5 block text-[11px] font-semibold tracking-wide text-warm-gray uppercase">Company</span>
      {company ? (
        <div className="mb-4 flex items-center gap-3 rounded-xl border border-violet-deep bg-violet-pale p-2.5">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-violet-deep text-xs font-semibold text-white">
            {initialsOf(company.name)}
          </span>
          <button
            type="button"
            className="min-w-0 flex-1 text-left"
            onClick={() => onOpenRecord("company", company.id)}
          >
            <span className="block truncate text-sm font-semibold text-ink">{company.name}</span>
            <span className="block truncate text-xs text-violet-deep">{company.kind || "Company"}</span>
          </button>
          {editable && (
            <button type="button" aria-label="Remove company" className="shrink-0 p-1 text-violet-deep hover:opacity-60" onClick={() => onChangeCompany(null)}>
              <X size={14} />
            </button>
          )}
        </div>
      ) : editable ? (
        <div className="mb-4">
          <Input placeholder="Search companies…" value={cq} onChange={(e) => setCq(e.target.value)} className="mb-1" />
          <div className="flex flex-col">
            {companyOptions.map((c) => (
              <button
                key={c.id}
                type="button"
                className="-mx-2 flex items-center gap-2.5 rounded-lg px-2 py-2 text-left hover:bg-violet-pale/40"
                onClick={() => {
                  onChangeCompany(c.id);
                  setCq("");
                }}
              >
                <span className="flex size-7.5 shrink-0 items-center justify-center rounded-lg bg-violet-pale text-xs font-semibold text-violet-deep">
                  {initialsOf(c.name)}
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-sm text-ink">{c.name}</span>
                  <span className="block truncate text-xs text-ink-mute">{c.kind}</span>
                </span>
              </button>
            ))}
            <button
              type="button"
              className="mt-1.5 flex items-center gap-2.5 rounded-xl border border-dashed border-hair-strong px-3 py-2 text-left hover:border-violet-deep hover:bg-violet-pale/40"
              onClick={() => {
                setInline("company");
                setIcName(cq.trim());
                setIcEmail("");
                setIcPhone("");
              }}
            >
              <span className="flex size-7.5 shrink-0 items-center justify-center rounded-lg bg-violet-pale/60">
                <Plus size={14} className="text-violet-deep" />
              </span>
              <span className="text-sm font-medium text-violet-deep">
                {cq.trim() ? `Add new company "${cq.trim()}"` : "Add a new company"}
              </span>
            </button>
          </div>
        </div>
      ) : (
        <p className="mb-4 text-sm text-ink-mute">No company linked</p>
      )}

      {inline === "company" && (
        <div className="mb-4 rounded-xl border border-violet-deep bg-white p-3.5">
          <span className="mb-2.5 block text-[11px] font-semibold tracking-wide text-violet-deep uppercase">New company</span>
          <Input placeholder="Company name" value={icName} onChange={(e) => setIcName(e.target.value)} className="mb-2" />
          <div className="flex gap-2">
            <Input placeholder="Email" value={icEmail} onChange={(e) => setIcEmail(e.target.value)} />
            <Input placeholder="Phone" value={icPhone} onChange={(e) => setIcPhone(e.target.value)} />
          </div>
          <div className="mt-3 flex items-center gap-2.5">
            <span className="flex-1 text-[11px] text-ink-mute">Saved to Contacts and attached here</span>
            <Button variant="ghost" size="sm" onClick={() => setInline(null)}>Cancel</Button>
            <Button size="sm" disabled={!icName.trim() || saving} onClick={saveCompany}>Save &amp; attach</Button>
          </div>
        </div>
      )}

      <span className="mb-1.5 block text-[11px] font-semibold tracking-wide text-warm-gray uppercase">Person</span>
      {contact ? (
        <div className="flex items-center gap-3 rounded-xl border border-violet-deep bg-violet-pale p-2.5">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-violet-deep text-xs font-semibold text-white">
            {initialsOf(contact.name)}
          </span>
          <button
            type="button"
            className="min-w-0 flex-1 text-left"
            onClick={() => onOpenRecord("contact", contact.id)}
          >
            <span className="block truncate text-sm font-semibold text-ink">{contact.name}</span>
            <span className="block truncate text-xs text-violet-deep">
              {companyOfContact(contact) ? `${contact.title || "Contact"} · ${companyOfContact(contact)!.name}` : contact.title || "Individual"}
            </span>
          </button>
          {editable && (
            <button type="button" aria-label="Remove person" className="shrink-0 p-1 text-violet-deep hover:opacity-60" onClick={() => onChangeContact(null)}>
              <X size={14} />
            </button>
          )}
        </div>
      ) : editable ? (
        <div>
          {suggestion && (
            <button
              type="button"
              className="mb-2 flex w-full items-center gap-2.5 rounded-xl border border-hair-strong bg-[#F4F2FF] px-3 py-2 text-left hover:border-violet-deep"
              onClick={() => onChangeContact(suggestion.id)}
            >
              <span className="flex size-7.5 shrink-0 items-center justify-center rounded-full bg-white text-xs font-semibold text-violet-deep">
                {initialsOf(suggestion.name)}
              </span>
              <span className="min-w-0">
                <span className="block truncate text-sm font-semibold text-ink">{suggestion.name}</span>
                <span className="block truncate text-xs text-violet-deep">Primary contact — tap to attach</span>
              </span>
            </button>
          )}
          <Input placeholder="Search people…" value={pq} onChange={(e) => setPq(e.target.value)} className="mb-1" />
          <div className="flex flex-col">
            {contactOptions.map((c) => (
              <button
                key={c.id}
                type="button"
                className="-mx-2 flex items-center gap-2.5 rounded-lg px-2 py-2 text-left hover:bg-violet-pale/40"
                onClick={() => {
                  onChangeContact(c.id);
                  setPq("");
                }}
              >
                <span className="flex size-7.5 shrink-0 items-center justify-center rounded-full bg-violet-pale text-xs font-semibold text-violet-deep">
                  {initialsOf(c.name)}
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-sm text-ink">{c.name}</span>
                  <span className="block truncate text-xs text-ink-mute">
                    {companyOfContact(c) ? `${c.title || "Contact"} · ${companyOfContact(c)!.name}` : c.title}
                  </span>
                </span>
              </button>
            ))}
            <button
              type="button"
              className="mt-1.5 flex items-center gap-2.5 rounded-xl border border-dashed border-hair-strong px-3 py-2 text-left hover:border-violet-deep hover:bg-violet-pale/40"
              onClick={() => {
                setInline("person");
                setIpName(pq.trim());
                setIpEmail("");
                setIpPhone("");
              }}
            >
              <span className="flex size-7.5 shrink-0 items-center justify-center rounded-full bg-violet-pale/60">
                <Plus size={14} className="text-violet-deep" />
              </span>
              <span className="text-sm font-medium text-violet-deep">
                {pq.trim() ? `Add new person "${pq.trim()}"` : "Add a new person"}
              </span>
            </button>
          </div>
        </div>
      ) : (
        <p className="text-sm text-ink-mute">No person linked</p>
      )}

      {inline === "person" && (
        <div className="mt-3 rounded-xl border border-violet-deep bg-white p-3.5">
          <span className="mb-2.5 block text-[11px] font-semibold tracking-wide text-violet-deep uppercase">New person</span>
          <Input placeholder="Full name" value={ipName} onChange={(e) => setIpName(e.target.value)} className="mb-2" />
          <div className="flex gap-2">
            <Input placeholder="Email" value={ipEmail} onChange={(e) => setIpEmail(e.target.value)} />
            <div className="flex-1">
              <Input
                placeholder="Phone, e.g. +1 555 123 4567"
                value={ipPhone}
                onChange={(e) => setIpPhone(e.target.value)}
                className={ipPhoneErr ? "border-red" : undefined}
              />
            </div>
          </div>
          {ipPhoneErr && <p className="mt-1 text-xs text-red">{ipPhoneErr}</p>}
          <div className="mt-3 flex items-center gap-2.5">
            <span className="flex-1 text-[11px] text-ink-mute">
              {company ? `Linked to ${company.name}` : "Saved as an individual"}
            </span>
            <Button variant="ghost" size="sm" onClick={() => setInline(null)}>Cancel</Button>
            <Button size="sm" disabled={!ipName.trim() || !!ipPhoneErr || saving} onClick={saveContact}>Save &amp; attach</Button>
          </div>
        </div>
      )}
    </div>
  );
}
