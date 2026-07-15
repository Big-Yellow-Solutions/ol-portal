/* OL Portal · AI Proposal Assistant + knowledge base (PRD 3.4/3.8).
   The assistant drafts proposal sections grounded in OL's own knowledge base
   (past-proposal patterns, pricing frameworks, tone of voice — admin-owned,
   PRD 3.8) plus the live deal context. Scope boundary per PRD: it only
   suggests text; a human always reviews, marks Final, and sends. */

import { SSMClient, GetParameterCommand } from "@aws-sdk/client-ssm";
import Anthropic from "@anthropic-ai/sdk";
import { resp, today, get, put, del, listType, nextId } from "./util.mjs";
import { writeAudit } from "./admin.mjs";
import { SECTION_KEYS } from "./proposals.mjs";

const ssm = new SSMClient({});
let anthropic;
async function client() {
  if (anthropic) return anthropic;
  const p = await ssm.send(new GetParameterCommand({
    Name: process.env.ANTHROPIC_KEY_PARAM, WithDecryption: true
  }));
  anthropic = new Anthropic({ apiKey: p.Parameter.Value });
  return anthropic;
}

/* ---------- knowledge base (admin-owned, PRD 3.8) ---------- */
export async function listKb(ctx) {
  if (ctx.role !== "Admin") return resp(403, { error: "Knowledge base is admin-only" });
  const items = await listType("KB");
  return resp(200, items.map(({ pk, sk, ...rest }) => ({ id: sk, ...rest })));
}

export async function createKb(ctx, body) {
  if (ctx.role !== "Admin") return resp(403, { error: "Knowledge base is admin-only" });
  const { title, content } = body || {};
  if (typeof title !== "string" || !title.trim()) return resp(400, { error: "title is required" });
  if (typeof content !== "string" || !content.trim()) return resp(400, { error: "content is required" });
  const id = await nextId("KB", "KB-");
  const item = {
    pk: "KB", sk: id, title: title.trim().slice(0, 200),
    content: content.slice(0, 30_000), updatedBy: ctx.me.sk, updated: today()
  };
  await put(item);
  await writeAudit(ctx.me.sk, "kb.created", `${id} · ${item.title}`);
  const { pk, sk, ...rest } = item;
  return resp(201, { id: sk, ...rest });
}

export async function updateKb(ctx, id, body) {
  if (ctx.role !== "Admin") return resp(403, { error: "Knowledge base is admin-only" });
  const item = await get("KB", id);
  if (!item) return resp(404, { error: "entry not found" });
  const next = { ...item, updatedBy: ctx.me.sk, updated: today() };
  if (typeof body?.title === "string" && body.title.trim()) next.title = body.title.trim().slice(0, 200);
  if (typeof body?.content === "string" && body.content.trim()) next.content = body.content.slice(0, 30_000);
  await put(next);
  const { pk, sk, ...rest } = next;
  return resp(200, { id: sk, ...rest });
}

export async function deleteKb(ctx, id) {
  if (ctx.role !== "Admin") return resp(403, { error: "Knowledge base is admin-only" });
  await del("KB", id);
  await writeAudit(ctx.me.sk, "kb.deleted", id);
  return resp(200, { deleted: id });
}

/* ---------- conversational draft assistant ----------
   A chat, not a one-shot: the assistant interviews the Lab Leader (client,
   problem, scope, budget, timing) and writes/updates the proposal sections as
   it learns. The client sends the running conversation; every reply may carry
   section updates (empty string = leave that section alone). */
const CHAT_SCHEMA = {
  type: "object",
  properties: {
    reply: {
      type: "string",
      description: "Your conversational message to the Lab Leader: a focused question, a short confirmation of what you drafted, or advice. Keep it under 120 words."
    },
    sections: {
      type: "object",
      properties: Object.fromEntries(SECTION_KEYS.map(k => [k, {
        type: "string",
        description: "New full text for this section, or an empty string to leave it unchanged"
      }])),
      required: SECTION_KEYS,
      additionalProperties: false
    }
  },
  required: ["reply", "sections"],
  additionalProperties: false
};

const MAX_TURNS = 30;
const MAX_MSG_CHARS = 4000;

/* Attachments: the Lab Leader can hand The Optimist their own draft/notes
   (PDF, text, image) and it pulls the content into the sections. */
const ATTACH_KIND = {
  "application/pdf": "document",
  "text/plain": "text", "text/markdown": "text", "text/csv": "text",
  "image/png": "image", "image/jpeg": "image"
};
const MAX_ATTACH_B64 = 5_500_000; // ~4MB file

function attachmentBlock(att) {
  const kind = ATTACH_KIND[att?.type];
  const data = String(att?.data || "");
  if (!kind) return { error: "attach a PDF, text/markdown/CSV file, or an image" };
  if (!data || data.length > MAX_ATTACH_B64 || !/^[A-Za-z0-9+/=]+$/.test(data))
    return { error: "attachment must be under 4 MB" };
  const name = String(att.name || "attachment").slice(0, 120);
  if (kind === "document")
    return { block: { type: "document", source: { type: "base64", media_type: "application/pdf", data } } };
  if (kind === "image")
    return { block: { type: "image", source: { type: "base64", media_type: att.type, data } } };
  return { block: { type: "text", text: `Contents of the attached file "${name}":\n\n` + Buffer.from(data, "base64").toString("utf8").slice(0, 150_000) } };
}

export async function assist(ctx, body) {
  const { proposalId, messages, draft, attachment } = body || {};
  const p = await get("PROPOSAL", proposalId);
  if (!p) return resp(404, { error: "proposal not found" });
  if (!ctx.can.editProposal(p)) return resp(403, { error: "Not allowed to edit this proposal" });
  if (!Array.isArray(messages) || !messages.length) return resp(400, { error: "messages are required" });
  const turns = messages.slice(-MAX_TURNS).map(m => ({
    role: m?.role === "assistant" ? "assistant" : "user",
    content: String(m?.content || "").slice(0, MAX_MSG_CHARS)
  })).filter(m => m.content.trim());
  while (turns.length && turns[0].role !== "user") turns.shift(); // API requires a user turn first
  if (!turns.length) return resp(400, { error: "say something first" });

  if (attachment) {
    const { block, error } = attachmentBlock(attachment);
    if (error) return resp(400, { error });
    const last = turns[turns.length - 1];
    if (last.role !== "user") return resp(400, { error: "attach files alongside your own message" });
    last.content = [block, { type: "text", text: last.content }];
  }

  const [deal, kb] = await Promise.all([get("DEAL", p.deal), listType("KB")]);
  const kbText = kb.length
    ? kb.map(e => `### ${e.title}\n${e.content}`).join("\n\n")
    : "(The knowledge base is empty — draft from general consulting best practice and say so.)";

  const c = await client();
  const response = await c.messages.create({
    model: "claude-opus-4-8",
    max_tokens: 6000,
    thinking: { type: "adaptive" },
    system: `You are The Optimist, Optimistic Labs' proposal writer, chatting with a Lab Leader inside OL's internal portal. The conversation with you IS the proposal editor: everything in the document gets written through you, and the Lab Leader watches it form in a live preview beside the chat.
Optimistic Labs is a consultancy that runs client engagements through practice "labs", each led by a Lab Leader.

Your job: interview them and build the proposal as you go.
- Early in the conversation, ask focused questions, one or two at a time: who the client is, the problem, what OL will do, budget expectations, timing, constraints. Don't interrogate; if they've already said it, don't re-ask.
- As soon as you know enough for any section, write it — update sections incrementally rather than waiting for everything. Set a section to an empty string to leave what's already there untouched.
- When you update sections, your reply should briefly say what you drafted and ask the next most useful question.
- You are the only way the document gets edited, so handle wording requests precisely: when the Lab Leader dictates exact text ("the terms should say X", "change $30k to $32k"), apply it verbatim to the right section without embellishing, and confirm briefly.
- If they attach a document (their own draft, notes, a prior proposal), extract its content into the matching sections in the same turn, preferring their wording and structure; fill obvious gaps yourself and say what you pulled in.
- If they ask you to auto-fill or auto-draft, immediately write EVERY section that's missing using your best assumptions from whatever you have — even from just a one-line summary, and even if imperfect. Don't ask questions first; state your two or three key assumptions briefly in the reply so they can correct you.
- Ground pricing and tone in OL's knowledge base below; do not invent OL policies that aren't there. Write sections in plain, confident prose. Never use em-dashes.
- You draft only. You cannot send, approve, or finalize anything; the Lab Leader reviews the preview and uses the controls under it.

## OL knowledge base
${kbText}

## This proposal
Title: "${p.title}" for client "${p.client}" (lab "${p.lab}", deal ${p.deal}${deal ? `, deal value $${deal.amount}, expected close ${deal.close}, source ${deal.source}${deal.recurring ? ", recurring engagement" : ""}` : ""}).
Current section contents as they sit in the editor right now (empty means not yet written):
${JSON.stringify(
  typeof draft === "object" && draft !== null
    ? Object.fromEntries(SECTION_KEYS.map(k => [k, String(draft[k] || "").slice(0, 20_000)]))
    : p.sections || {}
)}`,
    output_config: { format: { type: "json_schema", schema: CHAT_SCHEMA } },
    messages: turns
  });

  if (response.stop_reason === "refusal")
    return resp(502, { error: "The assistant declined to draft this content" });
  const text = response.content.find(x => x.type === "text")?.text;
  if (!text) return resp(502, { error: "The assistant returned nothing; try again" });
  await writeAudit(ctx.me.sk, "assist.chat", `${proposalId} (${p.client})`);
  return resp(200, JSON.parse(text));
}
