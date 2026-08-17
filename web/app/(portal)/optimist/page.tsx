"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { ArriveScreen } from "@/components/optimist/arrive-screen";
import { NewProposalDialog } from "@/components/optimist/new-proposal-dialog";
import { ManuscriptPanel } from "@/components/optimist/manuscript-panel";
import { QuestionCard } from "@/components/optimist/question-card";
import type { AttachmentResult } from "@/components/optimist/question-card";
import { OffScriptView } from "@/components/optimist/off-script-view";
import type { ChatMessage } from "@/components/optimist/off-script-view";
import { PricingAnswerCard } from "@/components/optimist/pricing-answer-card";
import { InterviewComplete } from "@/components/optimist/interview-complete";
import { DocumentView } from "@/components/optimist/document-view";
import { SendDialog } from "@/components/optimist/send-dialog";
import { SentScreen } from "@/components/optimist/sent-screen";
import { ContributorScreen } from "@/components/optimist/contributor-screen";
import { api, ApiError } from "@/lib/api";
import { can } from "@/lib/can";
import { usePortalData } from "@/lib/portal-data";
import { initials } from "@/lib/data";
import { SECTION_KEYS, SECTION_LABELS } from "@/lib/types";
import type { Pricing, Proposal, ProposalStatus } from "@/lib/types";

/* The Optimist: proposal interview redesign (design_handoff_the_optimist).
   The interview asks one question at a time; the manuscript assembles beside
   it. Free-form chat is the escape hatch, not the interface. When drafting is
   done, the manuscript takes over the whole screen. Backend contract is
   unchanged from the previous 3-column build — POST /assist, PATCH draft/
   commit/final, POST send — only the interaction model around it changed. */

const MAX_CACHED_MESSAGES = 60;
const MAX_ATTACHMENT_BYTES = 4 * 1024 * 1024;
const WASH_DECAY_MS = 6000;
const THIN_SECTION_CHARS = 150;
const OPENING_PROMPT = "Tell The Optimist about the client and the work, and it will start drafting.";

const LL_STATUSES: ProposalStatus[] = ["Draft", "In Review", "Sent"];
const ALL_STATUSES: ProposalStatus[] = [
  "Draft", "In Review", "Internally Approved", "Sent",
  "Customer Approved", "Customer Rejected", "Revision Requested",
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
  window.localStorage.setItem(chatKey(id), JSON.stringify(messages.slice(-MAX_CACHED_MESSAGES)));
}

function computeFlagged(draftSections: Record<string, string>): string[] {
  return SECTION_KEYS.filter((k) => {
    const content = draftSections[k]?.trim() ?? "";
    return content.length > 0 && content.length < THIN_SECTION_CHARS;
  });
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
  const { loading, error, role, proposals, deals, labs, myLabs, me, people, setProposals } = usePortalData();

  const selectedId = params.get("p");
  const wantsNew = params.get("new") === "1";
  const [showNew, setShowNew] = useState(false);
  const [showSend, setShowSend] = useState(false);
  const [view, setView] = useState<"interview" | "document">("interview");
  const [mode, setMode] = useState<"question" | "freeform">("question");

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draftSections, setDraftSections] = useState<Record<string, string>>({});
  const [draftPricing, setDraftPricing] = useState<Pricing | null>(null);
  const [answeredCount, setAnsweredCount] = useState(0);
  const [recentlyWritten, setRecentlyWritten] = useState<Set<string>>(new Set());
  const [attachmentResult, setAttachmentResult] = useState<AttachmentResult | null>(null);
  const [pricingJustSet, setPricingJustSet] = useState(false);
  const [sentInfo, setSentInfo] = useState<{ version: number; clientEmail: string; url: string } | null>(null);

  const [input, setInput] = useState("");
  const [attachment, setAttachment] = useState<{ type: string; data: string; name: string; sizeMB: number } | null>(null);
  const [sending, setSending] = useState(false);

  const washTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const attachInputRef = useRef<HTMLInputElement>(null);

  const selected = proposals.find((p) => p.id === selectedId) ?? null;
  const labNames: Record<string, string> = Object.fromEntries(labs.map((l) => [l.id, l.name]));

  useEffect(() => {
    if (wantsNew) setShowNew(true);
  }, [wantsNew]);

  useEffect(() => {
    if (selected) {
      setMessages(loadChat(selected.id));
      setDraftSections({ ...selected.sections });
      setDraftPricing(selected.pricing ?? null);
    } else {
      setMessages([]);
      setDraftSections({});
      setDraftPricing(null);
    }
    setAnsweredCount(0);
    setRecentlyWritten(new Set());
    setAttachmentResult(null);
    setPricingJustSet(false);
    setSentInfo(null);
    setView("interview");
    setMode("question");
    Object.values(washTimers.current).forEach(clearTimeout);
    washTimers.current = {};
  }, [selected?.id]);

  useEffect(() => {
    return () => {
      Object.values(washTimers.current).forEach(clearTimeout);
    };
  }, []);

  if (loading) return <p className="text-sm text-ink-mute">Loading…</p>;
  if (error) return <p className="text-sm text-red">{error}</p>;
  if (role === "Contributor") return <ContributorScreen />;

  const select = (id: string | null) => {
    router.replace(id ? `/optimist?p=${id}` : "/optimist", { scroll: false });
  };

  const updateProposal = (updated: Proposal) => {
    setProposals((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
  };

  const markWritten = (keys: string[]) => {
    if (!keys.length) return;
    setRecentlyWritten((prev) => new Set([...prev, ...keys]));
    keys.forEach((key) => {
      clearTimeout(washTimers.current[key]);
      washTimers.current[key] = setTimeout(() => {
        setRecentlyWritten((prev) => {
          const next = new Set(prev);
          next.delete(key);
          return next;
        });
      }, WASH_DECAY_MS);
    });
  };

  const persistDraft = async (sections: Record<string, string>, pricing: Pricing | null) => {
    if (!selected) return;
    try {
      const saved = await api<Proposal>(`/proposals/${selected.id}`, {
        method: "PATCH",
        body: JSON.stringify({ sections, pricing, draft: true }),
      });
      updateProposal(saved);
    } catch {
      // The chat reply already landed; a failed background draft-save isn't
      // worth interrupting the conversation over.
    }
  };

  /** Core round trip, shared by in-interview answers and off-script messages. */
  const sendMessage = async (text: string) => {
    if (!selected || !text.trim() || sending) return;
    setSending(true);
    const userMsg: ChatMessage = { role: "user", content: text.trim() };
    const nextMessages = [...messages, userMsg];
    setMessages(nextMessages);
    saveChat(selected.id, nextMessages);
    setInput("");
    const sentAttachment = attachment;
    setAttachment(null);
    setAttachmentResult(null);
    setPricingJustSet(false);

    try {
      const result = await api<{ reply: string; sections: Record<string, string>; pricing: Pricing | null }>("/assist", {
        method: "POST",
        body: JSON.stringify({
          proposalId: selected.id,
          messages: nextMessages,
          draft: draftSections,
          ...(sentAttachment ? { attachment: { type: sentAttachment.type, data: sentAttachment.data, name: sentAttachment.name } } : {}),
        }),
      });
      const merged = { ...draftSections };
      const writtenKeys: string[] = [];
      for (const key of SECTION_KEYS) {
        if (result.sections[key]) {
          merged[key] = result.sections[key];
          writtenKeys.push(key);
        }
      }
      setDraftSections(merged);
      markWritten(writtenKeys);
      const mergedPricing = result.pricing ?? draftPricing;
      setDraftPricing(mergedPricing);
      if (result.pricing) setPricingJustSet(true);
      if (sentAttachment) {
        setAttachmentResult({
          name: sentAttachment.name,
          meta: `${sentAttachment.sizeMB.toFixed(1)} MB · read in this turn`,
          landed: writtenKeys.map((k) => ({
            label: "Updated",
            sectionLabel: `${String(SECTION_KEYS.indexOf(k) + 1).padStart(2, "0")} ${SECTION_LABELS[k]}`,
          })),
          unresolved: [],
        });
      }
      const withReply: ChatMessage[] = [...nextMessages, { role: "assistant", content: result.reply }];
      setMessages(withReply);
      saveChat(selected.id, withReply);
      await persistDraft(merged, mergedPricing);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "The Optimist didn't respond.");
    } finally {
      setSending(false);
    }
  };

  const answerQuestion = async (text: string) => {
    setAnsweredCount((n) => n + 1);
    await sendMessage(text);
  };

  const onAttachFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
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
    setAttachment({ type: file.type, data, name: file.name, sizeMB: file.size / (1024 * 1024) });
  };

  const saveVersion = async () => {
    if (!selected) return;
    try {
      const saved = await api<Proposal>(`/proposals/${selected.id}`, {
        method: "PATCH",
        body: JSON.stringify({ sections: draftSections, pricing: draftPricing, commit: true }),
      });
      updateProposal(saved);
      toast.success(`Saved as v${saved.version}`);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not save this version.");
    }
  };

  const revertToFinal = async () => {
    if (!selected?.finalVersion) return;
    const snap = selected.versions?.find((v) => v.v === selected.finalVersion);
    if (!snap) return;
    try {
      const saved = await api<Proposal>(`/proposals/${selected.id}`, {
        method: "PATCH",
        body: JSON.stringify({ sections: snap.sections, pricing: snap.pricing ?? null, draft: true }),
      });
      updateProposal(saved);
      setDraftSections({ ...snap.sections });
      setDraftPricing(snap.pricing ?? null);
      toast.success(`Reverted to v${selected.finalVersion}`);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not revert this draft.");
    }
  };

  const setStatus = async (status: ProposalStatus) => {
    if (!selected) return;
    try {
      const saved = await api<Proposal>(`/proposals/${selected.id}`, { method: "PATCH", body: JSON.stringify({ status }) });
      updateProposal(saved);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not update the status.");
    }
  };

  const markFinal = async () => {
    if (!selected) return;
    try {
      const saved = await api<Proposal>(`/proposals/${selected.id}`, { method: "PATCH", body: JSON.stringify({ final: true }) });
      updateProposal(saved);
      toast.success("Marked Final");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not mark this Final.");
    }
  };

  const draftPdf = async () => {
    if (!selected) return;
    try {
      const { fileId } = await api<{ fileId: string }>(`/proposals/${selected.id}/pdf`, { method: "POST" });
      const { url } = await api<{ url: string }>(`/files/${fileId}/download`);
      window.open(url, "_blank");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not generate the PDF.");
    }
  };

  if (!selected) {
    return (
      <div className="flex h-[calc(100vh-8rem)] flex-col">
        <ArriveScreen proposals={proposals} labNames={labNames} onSelect={select} onNew={() => setShowNew(true)} />
        {showNew && (
          <NewProposalDialog
            open={showNew}
            onOpenChange={(open) => {
              setShowNew(open);
              if (!open && wantsNew) router.replace("/optimist", { scroll: false });
            }}
            deals={deals.filter((d) => can.editDeal(d, role!, myLabs, me)).map((d) => ({ id: d.id, client: d.client, lab: d.lab, amount: d.amount }))}
            labNames={labNames}
            onCreated={(created) => {
              setProposals((prev) => [created, ...prev]);
              setShowNew(false);
              select(created.id);
            }}
          />
        )}
      </div>
    );
  }

  const draftedCount = SECTION_KEYS.filter((k) => draftSections[k]?.trim()).length;
  const activeKey = SECTION_KEYS.find((k) => !draftSections[k]?.trim()) ?? null;
  const activeIndex = activeKey ? SECTION_KEYS.indexOf(activeKey) : -1;
  const sectionHint = activeKey ? `— builds section ${String(activeIndex + 1).padStart(2, "0")}` : "";
  const lastAssistant = [...messages].reverse().find((m) => m.role === "assistant");
  const questionText = lastAssistant ? lastAssistant.content : OPENING_PROMPT;
  const draftAhead = !!(selected.dirty || (selected.finalVersion && selected.finalVersion !== selected.version));
  const finalSnap = selected.versions?.find((v) => v.v === selected.finalVersion);
  const baselineSections = finalSnap?.sections ?? selected.sections ?? {};
  const changedKeys = SECTION_KEYS.filter((k) => (draftSections[k] ?? "") !== (baselineSections[k] ?? ""));
  const flagged = computeFlagged(draftSections);
  const meRecord = me ? people[me] : undefined;
  const statusOptions = role === "Admin" ? ALL_STATUSES : LL_STATUSES;

  return (
    <div className="flex h-[calc(100vh-8rem)] flex-col">
      {view === "document" ? (
        sentInfo ? (
          <SentScreen
            clientName={selected.client ?? ""}
            sentVersion={sentInfo.version}
            clientEmail={sentInfo.clientEmail}
            shareUrl={sentInfo.url}
            onBack={() => setSentInfo(null)}
          />
        ) : (
          <DocumentView
            proposal={selected}
            clientName={selected.client}
            labName={labNames[selected.lab] ?? selected.lab}
            draftSections={draftSections}
            draftPricing={draftPricing}
            draftAhead={draftAhead}
            changedKeys={changedKeys}
            flaggedCount={flagged.length}
            statusOptions={statusOptions}
            onStatusChange={setStatus}
            avatarInitials={initials(meRecord)}
            avatarPhoto={meRecord?.photo}
            onBack={() => setView("interview")}
            onSaveVersion={saveVersion}
            onRevert={revertToFinal}
            onDraftPdf={draftPdf}
            onMarkFinal={markFinal}
            onSendClick={() => setShowSend(true)}
            onAskToChange={() => {
              setView("interview");
              setMode("freeform");
            }}
          />
        )
      ) : mode === "freeform" ? (
        <div className="grid h-full min-h-0 grid-cols-[1fr_440px]">
          <OffScriptView
            messages={messages}
            pendingQuestionNumber={answeredCount + 1}
            remainingCount={Math.max(0, 6 - draftedCount)}
            input={input}
            onInputChange={setInput}
            onSend={() => sendMessage(input)}
            sending={sending}
            onBack={() => setMode("question")}
          />
          <ManuscriptPanel
            proposalTitle={selected.title}
            draftSections={draftSections}
            draftPricing={draftPricing}
            activeKey={activeKey}
            recentlyWritten={recentlyWritten}
            flaggedKeys={draftedCount === 6 ? new Set(flagged) : undefined}
          />
        </div>
      ) : draftedCount === 6 ? (
        <div className="grid h-full min-h-0 grid-cols-[1fr_440px]">
          <InterviewComplete
            proposalTitle={selected.title}
            clientName={selected.client}
            flagged={flagged.map((key) => ({ key, label: SECTION_LABELS[key] }))}
            questionsAnswered={answeredCount}
            onFixIt={(key) => answerQuestion(`Let's revisit ${SECTION_LABELS[key]} — I want to add more detail. What am I missing?`)}
            onReadThrough={() => setView("document")}
            onSaveVersion={saveVersion}
            onOffScript={() => setMode("freeform")}
          />
          <ManuscriptPanel
            proposalTitle={selected.title}
            draftSections={draftSections}
            draftPricing={draftPricing}
            recentlyWritten={recentlyWritten}
            flaggedKeys={new Set(flagged)}
            versionLabel={`v${selected.version} draft`}
          />
        </div>
      ) : pricingJustSet && draftPricing ? (
        <div className="grid h-full min-h-0 grid-cols-[1fr_440px]">
          <PricingAnswerCard
            proposalTitle={selected.title}
            clientName={selected.client}
            preamble={questionText}
            pricing={draftPricing}
            quickReplies={["Keep it", "Change a number", "Add a note"]}
            onQuickReply={(label) => answerQuestion(label)}
            onContinue={() => setPricingJustSet(false)}
          />
          <ManuscriptPanel
            proposalTitle={selected.title}
            draftSections={draftSections}
            draftPricing={draftPricing}
            activeKey={activeKey}
            recentlyWritten={recentlyWritten}
          />
        </div>
      ) : (
        <div className="grid h-full min-h-0 grid-cols-[1fr_440px]">
          <QuestionCard
            proposalTitle={selected.title}
            clientName={selected.client}
            questionNumber={answeredCount + 1}
            sectionHint={sectionHint}
            questionText={questionText}
            applySignalWord={!!lastAssistant}
            attachmentResult={attachmentResult ?? undefined}
            input={input}
            onInputChange={setInput}
            onAnswer={() => answerQuestion(input)}
            onAttachClick={() => attachInputRef.current?.click()}
            attachInputRef={attachInputRef}
            onAttachFile={onAttachFile}
            attachedFileName={attachment?.name}
            sending={sending}
            onSkip={() => answerQuestion("Skip this question for now and move on to the next one.")}
            transcriptSummary={answeredCount > 0 ? `${answeredCount} question${answeredCount === 1 ? "" : "s"} answered · transcript` : undefined}
            onOffScript={() => setMode("freeform")}
            onAutoFill={() => answerQuestion("Auto-fill the rest of the sections using your best assumptions.")}
          />
          <ManuscriptPanel
            proposalTitle={selected.title}
            draftSections={draftSections}
            draftPricing={draftPricing}
            activeKey={activeKey}
            recentlyWritten={recentlyWritten}
            justWrittenTag={attachmentResult ? "from the RFP" : "Just written"}
          />
        </div>
      )}

      {showNew && (
        <NewProposalDialog
          open={showNew}
          onOpenChange={(open) => {
            setShowNew(open);
            if (!open && wantsNew) router.replace("/optimist", { scroll: false });
          }}
          deals={deals.filter((d) => can.editDeal(d, role!, myLabs, me)).map((d) => ({ id: d.id, client: d.client, lab: d.lab, amount: d.amount }))}
          labNames={labNames}
          onCreated={(created) => {
            setProposals((prev) => [created, ...prev]);
            setShowNew(false);
            select(created.id);
          }}
        />
      )}

      {showSend && (
        <SendDialog
          proposal={selected}
          open={showSend}
          onOpenChange={setShowSend}
          onSent={(updated, result) => {
            updateProposal(updated);
            setSentInfo({ version: updated.sentVersion ?? updated.version, clientEmail: updated.clientEmail ?? "", url: result.url });
          }}
        />
      )}
    </div>
  );
}
