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
import { cleanPricing, pricingText } from "./pricing.mjs";

const ssm = new SSMClient({});
let anthropic;
// Exported so other modules that need the same Anthropic client (e.g. the
// help widget's assistant in guides.mjs) don't each fetch and cache their own
// copy of the SSM API key.
export async function client() {
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
  const { title, content, lab } = body || {};
  if (typeof title !== "string" || !title.trim()) return resp(400, { error: "title is required" });
  if (typeof content !== "string" || !content.trim()) return resp(400, { error: "content is required" });
  if (lab && !(await get("LAB", lab))) return resp(400, { error: "unknown lab" });
  const id = await nextId("KB", "KB-");
  const item = {
    pk: "KB", sk: id, title: title.trim().slice(0, 200),
    content: content.slice(0, 30_000), updatedBy: ctx.me.sk, updated: today(),
    ...(lab ? { lab } : {})
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
  if (body && "lab" in body) {
    if (body.lab) {
      if (!(await get("LAB", body.lab))) return resp(400, { error: "unknown lab" });
      next.lab = body.lab;
    } else {
      delete next.lab;
    }
  }
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
/* Pricing is structured data now (Base Contract PRD FR3), so The Optimist has
   to emit the numbers as well as the prose. The union of flat/tiered/itemized
   is flattened into one object with an explicit `action`, because a strict
   JSON schema handles one shape with unused fields far more reliably than a
   discriminated union, and `action: "none"` is the common case where the turn
   didn't touch pricing at all. */
const PRICING_SCHEMA = {
  type: "object",
  properties: {
    action: {
      type: "string",
      enum: ["none", "set"],
      description: "\"none\" leaves the existing pricing untouched. Use \"set\" only when you have real numbers to record."
    },
    kind: {
      type: "string",
      enum: ["flat", "tiered", "itemized"],
      description: "flat = one project fee. tiered = named packages the client picks from. itemized = line items with quantity and rate."
    },
    flatAmount: { type: "number", description: "The fee, when kind is flat. 0 otherwise." },
    flatLabel: { type: "string", description: "What the flat fee is called, e.g. \"Project fee\". Empty otherwise." },
    tiers: {
      type: "array",
      description: "Packages, when kind is tiered. Empty otherwise. Mark exactly one as recommended.",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          amount: { type: "number" },
          summary: { type: "string", description: "One line on what this package includes" },
          recommended: { type: "boolean" }
        },
        required: ["name", "amount", "summary", "recommended"],
        additionalProperties: false
      }
    },
    items: {
      type: "array",
      description: "Line items, when kind is itemized. Empty otherwise.",
      items: {
        type: "object",
        properties: {
          description: { type: "string" },
          qty: { type: "number" },
          rate: { type: "number" }
        },
        required: ["description", "qty", "rate"],
        additionalProperties: false
      }
    },
    discount: { type: "number", description: "Flat discount off an itemized subtotal, or 0." },
    notes: { type: "string", description: "Short caveat shown under the pricing table, or empty." }
  },
  required: ["action", "kind", "flatAmount", "flatLabel", "tiers", "items", "discount", "notes"],
  additionalProperties: false
};

/* Collapses the flattened schema back into the real pricing shape. Returns
   null when the turn didn't set pricing or produced something invalid — a bad
   pricing guess must never cost the Lab Leader the rest of the reply. */
function pricingFromModel(out) {
  if (!out || out.action !== "set") return null;
  const draft =
    out.kind === "flat" ? { kind: "flat", amount: out.flatAmount, label: out.flatLabel, notes: out.notes }
      : out.kind === "tiered" ? { kind: "tiered", tiers: out.tiers }
        : { kind: "itemized", items: out.items, discount: out.discount, notes: out.notes };
  const { value, error } = cleanPricing(draft);
  if (error) {
    console.error(JSON.stringify({ level: "warn", message: "assist produced invalid pricing", detail: error }));
    return null;
  }
  return value;
}

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
    },
    pricing: PRICING_SCHEMA
  },
  required: ["reply", "sections", "pricing"],
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

  const [deal, kb, labRec] = await Promise.all([get("DEAL", p.deal), listType("KB"), get("LAB", p.lab)]);
  const labName = labRec?.name || p.lab;
  const globalKb = kb.filter(e => !e.lab);
  const labKb = kb.filter(e => e.lab === p.lab);
  const kbSections = [
    globalKb.length ? `## OL-wide knowledge base\n${globalKb.map(e => `### ${e.title}\n${e.content}`).join("\n\n")}` : "",
    labKb.length ? `## ${labName} knowledge base\n${labKb.map(e => `### ${e.title}\n${e.content}`).join("\n\n")}` : ""
  ].filter(Boolean).join("\n\n") || "(The knowledge base is empty — draft from general consulting best practice and say so.)";

  const stableBlock = `You are The Optimist, Optimistic Labs' proposal writer, chatting with a Lab Leader inside OL's internal portal. The conversation with you IS the proposal editor: everything in the document gets written through you, and the Lab Leader watches it form in a live preview beside the chat.
Optimistic Labs is a consultancy that runs client engagements through practice "labs", each led by a Lab Leader.

Your job: interview them and build the proposal as you go.
- Early in the conversation, ask focused questions, one or two at a time: who the client is, the problem, what OL will do, budget expectations, timing, constraints. Don't interrogate; if they've already said it, don't re-ask.
- As soon as you know enough for any section, write it — update sections incrementally rather than waiting for everything. Set a section to an empty string to leave what's already there untouched.
- When you update sections, your reply should briefly say what you drafted and ask the next most useful question.
- You are the only way the document gets edited, so handle wording requests precisely: when the Lab Leader dictates exact text ("the terms should say X", "change $30k to $32k"), apply it verbatim to the right section without embellishing, and confirm briefly.
- If they attach a document (their own draft, notes, a prior proposal), extract its content into the matching sections in the same turn, preferring their wording and structure; fill obvious gaps yourself and say what you pulled in.
- If they ask you to auto-fill or auto-draft, immediately write EVERY section that's missing using your best assumptions from whatever you have — even from just a one-line summary, and even if imperfect. Don't ask questions first; state your two or three key assumptions briefly in the reply so they can correct you.
- Ground pricing and tone in OL's knowledge base below; do not invent OL policies that aren't there. Write sections in plain, confident prose. Never use em-dashes.
- Pricing is both prose and numbers. The "pricing" section holds the narrative the client reads; the separate "pricing" object holds the actual figures, which flow straight into the contract. Whenever you write or change a number, set both, and keep them saying the same thing. Use action "none" on turns that don't touch pricing. Pick tiered when you're offering packages to choose between, itemized when the client is buying discrete pieces of work, flat otherwise. Never invent a number the Lab Leader hasn't given you or that the knowledge base doesn't support; ask instead.
- You draft only. You cannot send, approve, or finalize anything; the Lab Leader reviews the preview and uses the controls under it.

${kbSections}`;

  const proposalBlock = `## This proposal
Title: "${p.title}" for client "${p.client}" (lab "${p.lab}", deal ${p.deal}${deal ? `, deal value $${deal.amount}, expected close ${deal.close}, source ${deal.source}${deal.recurring ? ", recurring engagement" : ""}` : ""}).
Current section contents as they sit in the editor right now (empty means not yet written):
${JSON.stringify(
  typeof draft === "object" && draft !== null
    ? Object.fromEntries(SECTION_KEYS.map(k => [k, String(draft[k] || "").slice(0, 20_000)]))
    : p.sections || {}
)}
Structured pricing currently recorded: ${p.pricing ? `\n${pricingText(p.pricing)}` : "(none yet)"}`;

  const c = await client();
  const response = await c.messages.create({
    model: "claude-sonnet-5",
    max_tokens: 6000,
    thinking: { type: "adaptive" },
    system: [
      { type: "text", text: stableBlock, cache_control: { type: "ephemeral" } },
      { type: "text", text: proposalBlock }
    ],
    // Effort was left at the (unset) default of "high", which combined with
    // adaptive thinking's variable depth produced latency anywhere from ~1s
    // to a full 28s Lambda timeout. This is a conversational interview turn,
    // not deep agentic work — "medium" bounds thinking spend without giving
    // up the reasoning adaptive thinking needs for pricing/extraction turns.
    output_config: { format: { type: "json_schema", schema: CHAT_SCHEMA }, effort: "medium" },
    messages: turns
  });

  console.log(JSON.stringify({
    level: "info", message: "assist.cache",
    proposalId, lab: p.lab,
    cacheRead: response.usage?.cache_read_input_tokens,
    cacheWrite: response.usage?.cache_creation_input_tokens,
    input: response.usage?.input_tokens
  }));

  if (response.stop_reason === "refusal")
    return resp(502, { error: "The assistant declined to draft this content" });
  const text = response.content.find(x => x.type === "text")?.text;
  if (!text) return resp(502, { error: "The assistant returned nothing; try again" });
  await writeAudit(ctx.me.sk, "assist.chat", `${proposalId} (${p.client})`);

  const out = JSON.parse(text);
  // The flattened pricing shape is a schema convenience, not something the
  // frontend should have to understand: hand back either a real pricing object
  // or null, matching what PATCH /proposals/{id} accepts.
  return resp(200, { reply: out.reply, sections: out.sections, pricing: pricingFromModel(out.pricing) });
}
