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

/* ---------- draft assistant ---------- */
const DRAFT_SCHEMA = {
  type: "object",
  properties: {
    sections: {
      type: "object",
      properties: Object.fromEntries(SECTION_KEYS.map(k => [k, { type: "string" }])),
      required: SECTION_KEYS,
      additionalProperties: false
    },
    note: { type: "string", description: "One or two sentences to the Lab Leader: assumptions made, what to verify before sending" }
  },
  required: ["sections", "note"],
  additionalProperties: false
};

export async function assist(ctx, body) {
  const { proposalId, guidance } = body || {};
  const p = await get("PROPOSAL", proposalId);
  if (!p) return resp(404, { error: "proposal not found" });
  if (!ctx.can.editProposal(p)) return resp(403, { error: "Not allowed to edit this proposal" });

  const [deal, kb] = await Promise.all([get("DEAL", p.deal), listType("KB")]);
  const kbText = kb.length
    ? kb.map(e => `### ${e.title}\n${e.content}`).join("\n\n")
    : "(The knowledge base is empty — draft from general consulting best practice and say so in your note.)";

  const existing = SECTION_KEYS.some(k => (p.sections?.[k] || "").trim())
    ? `The proposal has existing draft sections — improve and complete them rather than discarding what's written:\n${JSON.stringify(p.sections)}`
    : "The proposal sections are empty — draft all of them.";

  const c = await client();
  const response = await c.messages.create({
    model: "claude-opus-4-8",
    max_tokens: 6000,
    thinking: { type: "adaptive" },
    system: `You are Optimistic Labs' proposal assistant, embedded in their internal portal.
Optimistic Labs is a consultancy that runs client engagements through practice "labs", each led by a Lab Leader.
You draft and refine client proposals grounded in OL's own knowledge base below. Follow OL's pricing frameworks and tone of voice where the knowledge base defines them; do not invent OL policies that aren't there. Write in plain, confident prose. Never use em-dashes.

## OL knowledge base
${kbText}`,
    output_config: { format: { type: "json_schema", schema: DRAFT_SCHEMA } },
    messages: [{
      role: "user",
      content: `Draft the six OL proposal template sections (summary, scope, deliverables, timeline, pricing, terms) for this deal.

Deal context: client "${p.client}", lab "${p.lab}", deal ${p.deal}${deal ? `, value $${deal.amount}, expected close ${deal.close}, source ${deal.source}${deal.recurring ? ", recurring engagement" : ""}` : ""}.
Proposal title: "${p.title}".
${existing}
${guidance ? `Lab Leader guidance for this draft: ${String(guidance).slice(0, 2000)}` : ""}`
    }]
  });

  if (response.stop_reason === "refusal")
    return resp(502, { error: "The assistant declined to draft this content" });
  const text = response.content.find(x => x.type === "text")?.text;
  if (!text) return resp(502, { error: "The assistant returned no draft; try again" });
  await writeAudit(ctx.me.sk, "assist.drafted", `${proposalId} (${p.client})`);
  return resp(200, JSON.parse(text));
}
