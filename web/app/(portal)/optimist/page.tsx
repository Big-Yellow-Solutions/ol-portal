"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { api, ApiError } from "@/lib/api";
import { can } from "@/lib/can";
import { usePortalData } from "@/lib/portal-data";
import { SECTION_KEYS, SECTION_LABELS } from "@/lib/types";
import type { Proposal, ProposalStatus } from "@/lib/types";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

const MAX_CACHED_MESSAGES = 60;
const MAX_ATTACHMENT_BYTES = 4 * 1024 * 1024;
const LL_STATUSES: ProposalStatus[] = ["Draft", "In Review", "Sent"];
const ALL_STATUSES: ProposalStatus[] = [
  "Draft",
  "In Review",
  "Internally Approved",
  "Sent",
  "Customer Approved",
  "Customer Rejected",
  "Revision Requested",
];

function chatKey(id: string) {
  return `olportal.optimist.${id}`;
}

function loadChat(id: string): ChatMessage[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(chatKey(id));
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveChat(id: string, messages: ChatMessage[]) {
  window.localStorage.setItem(
    chatKey(id),
    JSON.stringify(messages.slice(-MAX_CACHED_MESSAGES))
  );
}

export default function OptimistPage() {
  return (
    <Suspense fallback={<p className="text-sm text-ink-mute">Loading…</p>}>
      <OptimistView />
    </Suspense>
  );
}

function OptimistView() {
  const router = useRouter();
  const params = useSearchParams();
  const { loading, error, role, proposals, deals, myLabs, me, setProposals } =
    usePortalData();

  const selectedId = params.get("p");
  const wantsNew = params.get("new") === "1";
  const [showNew, setShowNew] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draftSections, setDraftSections] = useState<Record<string, string>>({});
  const [input, setInput] = useState("");
  const [attachment, setAttachment] = useState<{ type: string; data: string; name: string } | null>(
    null
  );
  const [sending, setSending] = useState(false);
  const [showSend, setShowSend] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);

  const selected = proposals.find((p) => p.id === selectedId) ?? null;

  useEffect(() => {
    if (wantsNew) setShowNew(true);
  }, [wantsNew]);

  useEffect(() => {
    if (selected) {
      setMessages(loadChat(selected.id));
      setDraftSections({ ...selected.sections });
    } else {
      setMessages([]);
      setDraftSections({});
    }
  }, [selected?.id]);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [messages]);

  if (loading) return <p className="text-sm text-ink-mute">Loading…</p>;
  if (error) return <p className="text-sm text-red">{error}</p>;

  if (role === "Contributor") {
    return (
      <p className="text-sm text-ink-mute">
        The Optimist is available to Lab Leaders and Admins.
      </p>
    );
  }

  const select = (id: string | null) => {
    const qs = id ? `?p=${id}` : "";
    router.replace(`/optimist${qs}`, { scroll: false });
  };

  const updateProposal = (updated: Proposal) => {
    setProposals((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
  };

  const persistDraft = async (sections: Record<string, string>) => {
    if (!selected) return;
    try {
      const saved = await api<Proposal>(`/proposals/${selected.id}`, {
        method: "PATCH",
        body: JSON.stringify({ sections, draft: true }),
      });
      updateProposal(saved);
    } catch {
      // The chat reply already landed; a failed background draft-save isn't
      // worth interrupting the conversation over.
    }
  };

  const send = async (text: string) => {
    if (!selected || !text.trim() || sending) return;
    setSending(true);
    const userMsg: ChatMessage = { role: "user", content: text.trim() };
    const nextMessages = [...messages, userMsg];
    setMessages(nextMessages);
    saveChat(selected.id, nextMessages);
    setInput("");
    const sentAttachment = attachment;
    setAttachment(null);

    try {
      const result = await api<{ reply: string; sections: Record<string, string> }>(
        "/assist",
        {
          method: "POST",
          body: JSON.stringify({
            proposalId: selected.id,
            messages: nextMessages,
            draft: draftSections,
            ...(sentAttachment ? { attachment: sentAttachment } : {}),
          }),
        }
      );
      const merged = { ...draftSections };
      for (const key of SECTION_KEYS) {
        if (result.sections[key]) merged[key] = result.sections[key];
      }
      setDraftSections(merged);
      const withReply: ChatMessage[] = [
        ...nextMessages,
        { role: "assistant", content: result.reply },
      ];
      setMessages(withReply);
      saveChat(selected.id, withReply);
      await persistDraft(merged);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "The Optimist didn't respond.");
    } finally {
      setSending(false);
    }
  };

  const onAttach = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > MAX_ATTACHMENT_BYTES) {
      toast.error("Attachments must be under 4MB.");
      return;
    }
    const data = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });
    setAttachment({ type: file.type, data, name: file.name });
  };

  const autoFill = () => send("Auto-fill the rest of the sections using your best assumptions.");

  const saveVersion = async () => {
    if (!selected) return;
    try {
      const saved = await api<Proposal>(`/proposals/${selected.id}`, {
        method: "PATCH",
        body: JSON.stringify({ sections: draftSections, commit: true }),
      });
      updateProposal(saved);
      toast.success(`Saved as v${saved.version}`);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not save this version.");
    }
  };

  const setStatus = async (status: ProposalStatus) => {
    if (!selected) return;
    try {
      const saved = await api<Proposal>(`/proposals/${selected.id}`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      });
      updateProposal(saved);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not update the status.");
    }
  };

  const markFinal = async () => {
    if (!selected) return;
    try {
      const saved = await api<Proposal>(`/proposals/${selected.id}`, {
        method: "PATCH",
        body: JSON.stringify({ final: true }),
      });
      updateProposal(saved);
      toast.success("Marked Final");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not mark this Final.");
    }
  };

  const draftPdf = async () => {
    if (!selected) return;
    try {
      const { fileId } = await api<{ fileId: string }>(`/proposals/${selected.id}/pdf`, {
        method: "POST",
      });
      const { url } = await api<{ url: string }>(`/files/${fileId}/download`);
      window.open(url, "_blank");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not generate the PDF.");
    }
  };

  const draftAhead = !!(
    selected?.dirty || (selected?.finalVersion && selected.finalVersion !== selected.version)
  );

  const statusOptions = role === "Admin" ? ALL_STATUSES : LL_STATUSES;

  return (
    <div className="grid h-[calc(100vh-8rem)] gap-4 md:grid-cols-[220px_1fr_360px]">
      <div className="flex flex-col gap-2 overflow-y-auto rounded-lg bg-card p-3 ring-1 ring-foreground/10">
        <Button size="sm" className="bg-violet-deep hover:bg-violet" onClick={() => setShowNew(true)}>
          + New
        </Button>
        {proposals.map((p) => (
          <button
            key={p.id}
            onClick={() => select(p.id)}
            className={cn(
              "rounded-md px-2 py-2 text-left text-sm",
              p.id === selectedId
                ? "bg-violet-pale text-violet-deep"
                : "text-ink hover:bg-paper"
            )}
          >
            <div className="truncate font-medium">{p.title}</div>
            <div className="truncate text-xs text-ink-mute">{p.client}</div>
          </button>
        ))}
      </div>

      {!selected ? (
        <div className="flex items-center justify-center rounded-lg bg-card text-sm text-ink-mute ring-1 ring-foreground/10">
          Pick a proposal, or start a new one.
        </div>
      ) : (
        <>
          <div className="flex flex-col rounded-lg bg-card ring-1 ring-foreground/10">
            <div ref={logRef} className="flex-1 overflow-y-auto p-4">
              {messages.length === 0 && (
                <p className="text-sm text-ink-mute">
                  Tell The Optimist about the client and the work, and it will start drafting.
                </p>
              )}
              <div className="flex flex-col gap-3">
                {messages.map((m, i) => (
                  <div
                    key={i}
                    className={cn(
                      "max-w-[85%] rounded-lg px-3 py-2 text-sm",
                      m.role === "user"
                        ? "self-end bg-violet-deep text-white"
                        : "self-start bg-paper text-ink"
                    )}
                  >
                    {m.content}
                  </div>
                ))}
              </div>
            </div>
            <div className="flex flex-col gap-2 border-t border-hair p-3">
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={autoFill} disabled={sending}>
                  Auto-fill the rest
                </Button>
                <label className="flex cursor-pointer items-center text-xs text-ink-mute underline underline-offset-2">
                  {attachment ? attachment.name : "Attach a file"}
                  <input type="file" className="hidden" onChange={onAttach} />
                </label>
              </div>
              <div className="flex gap-2">
                <Textarea
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      send(input);
                    }
                  }}
                  rows={2}
                  placeholder="Message The Optimist…"
                  disabled={sending}
                />
                <Button
                  className="bg-violet-deep hover:bg-violet"
                  onClick={() => send(input)}
                  disabled={sending || !input.trim()}
                >
                  Send
                </Button>
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-3 overflow-y-auto rounded-lg bg-card p-4 ring-1 ring-foreground/10">
            <div className="flex items-center justify-between">
              <h2 className="font-serif text-lg text-ink">{selected.title}</h2>
              <Select value={selected.status} onValueChange={(v) => setStatus(v as ProposalStatus)}>
                <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {statusOptions.map((s) => (
                    <SelectItem key={s} value={s}>{s}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {draftAhead && (
              <div className="rounded-md bg-amber-pale px-3 py-2 text-xs text-amber">
                The draft has changed since the last saved version
                {selected.finalVersion ? ` (v${selected.finalVersion} is Final)` : ""}.
              </div>
            )}

            {SECTION_KEYS.map((key) => (
              <div key={key}>
                <h3 className="text-sm font-medium text-ink">{SECTION_LABELS[key]}</h3>
                <p className="mt-1 whitespace-pre-wrap text-sm text-ink-soft">
                  {draftSections[key] || <span className="text-ink-mute">Not yet written.</span>}
                </p>
              </div>
            ))}

            <div className="mt-2 flex flex-wrap gap-2 border-t border-hair pt-3">
              <Button size="sm" variant="outline" onClick={saveVersion}>
                Save version
              </Button>
              <Button size="sm" variant="outline" onClick={markFinal} disabled={!!selected.final}>
                {selected.final ? "Final ✓" : "Mark Final"}
              </Button>
              <Button size="sm" variant="outline" onClick={draftPdf}>
                Draft PDF
              </Button>
              <Button
                size="sm"
                className="bg-violet-deep hover:bg-violet"
                onClick={() => setShowSend(true)}
                disabled={!selected.final}
              >
                Send to client
              </Button>
            </div>
          </div>
        </>
      )}

      {showNew && (
        <NewProposalDialog
          open={showNew}
          onOpenChange={(open) => {
            setShowNew(open);
            if (!open && wantsNew) router.replace("/optimist", { scroll: false });
          }}
          deals={deals.filter((d) => can.editDeal(d, role!, myLabs, me))}
          onCreated={(created) => {
            setProposals((prev) => [created, ...prev]);
            setShowNew(false);
            select(created.id);
          }}
        />
      )}

      {showSend && selected && (
        <SendDialog
          proposal={selected}
          open={showSend}
          onOpenChange={setShowSend}
          onSent={updateProposal}
        />
      )}
    </div>
  );
}

function NewProposalDialog({
  open,
  onOpenChange,
  deals,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  deals: { id: string; client: string }[];
  onCreated: (proposal: Proposal) => void;
}) {
  const [dealId, setDealId] = useState(deals[0]?.id ?? "");
  const [title, setTitle] = useState("");
  const [creating, setCreating] = useState(false);

  const create = async () => {
    if (!dealId || !title.trim()) return;
    setCreating(true);
    try {
      const created = await api<Proposal>("/proposals", {
        method: "POST",
        body: JSON.stringify({ dealId, title: title.trim() }),
      });
      onCreated(created);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not create this proposal.");
    } finally {
      setCreating(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New proposal</DialogTitle>
          <DialogDescription>
            Every proposal starts from a deal — its client, lab, and owner come from there.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label>Deal</Label>
            <Select value={dealId} onValueChange={setDealId}>
              <SelectTrigger><SelectValue placeholder="Pick a deal" /></SelectTrigger>
              <SelectContent>
                {deals.map((d) => (
                  <SelectItem key={d.id} value={d.id}>{d.client}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Title</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button
            className="bg-violet-deep hover:bg-violet"
            onClick={create}
            disabled={creating || !dealId || !title.trim()}
          >
            {creating ? "Creating…" : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SendDialog({
  proposal,
  open,
  onOpenChange,
  onSent,
}: {
  proposal: Proposal;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSent: (proposal: Proposal) => void;
}) {
  const [clientEmail, setClientEmail] = useState(proposal.clientEmail ?? "");
  const [sending, setSending] = useState(false);

  const sendVia = async (sendEmail: boolean) => {
    setSending(true);
    try {
      const result = await api<{
        id: string;
        sentVersion: number;
        draftAhead: boolean;
        url: string;
        text: string;
        emailSent: boolean;
        emailError?: string;
      }>(`/proposals/${proposal.id}/send`, {
        method: "POST",
        body: JSON.stringify({ clientEmail, sendEmail }),
      });
      onSent({
        ...proposal,
        status: "Sent",
        sentVersion: result.sentVersion,
        clientEmail,
      });
      if (sendEmail) {
        toast.success(result.emailSent ? "Emailed to client" : result.emailError || "Send failed");
      } else {
        await navigator.clipboard.writeText(result.text);
        toast.success("Copied the client email text to your clipboard");
      }
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not send this proposal.");
    } finally {
      setSending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Send {proposal.title} to the client</DialogTitle>
          <DialogDescription>
            Freezes the Final version behind a one-time link. Choose how to deliver it.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-1.5">
          <Label>Client email</Label>
          <Input
            type="email"
            value={clientEmail}
            onChange={(e) => setClientEmail(e.target.value)}
          />
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => sendVia(false)} disabled={sending}>
            Copy email text
          </Button>
          <Button
            className="bg-violet-deep hover:bg-violet"
            onClick={() => sendVia(true)}
            disabled={sending || !clientEmail}
          >
            {sending ? "Sending…" : "Email the client"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
