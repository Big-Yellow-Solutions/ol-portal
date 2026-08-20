/* OL Portal · The Optimist.

   The Optimist used to be one thing: a proposal-drafting interview bolted to a
   single PROPOSAL record. The redesign makes it what the name always implied —
   the assistant for the whole Portal. You ask it anything ("where does every
   open deal stand", "who on the bench should write a faith-based grant
   narrative", "how do I close a deal") and it answers from OL's real records.

   Two rules shape everything below.

   1. It never answers from memory. Every fact comes back through a tool call
      against DynamoDB, so the assistant can say "GRACE-2 closes on the 14th"
      and be right, or say it doesn't know. The prompt forbids inventing
      portal entities, and there is no fallback corpus for it to hallucinate
      from.

   2. It sees exactly what the caller sees. The tools live in
      optimist-tools.mjs and each one routes through the same list handler the
      REST API uses, with the caller's own ctx. A Contributor asking about the
      pipeline gets an empty result set, not a leak.

   The transport lives next door in optimist-stream.mjs: API Gateway cannot
   stream a response, so the chat runs on its own Lambda behind a Function URL.
   This module is transport-agnostic — it takes an `onEvent` callback and does
   not know or care whether the bytes are going to a stream or a buffer. */

import { SSMClient, GetParameterCommand } from "@aws-sdk/client-ssm";
import Anthropic from "@anthropic-ai/sdk";
import { randomUUID } from "node:crypto";
import { get, put, listType, today, fullName } from "./util.mjs";
import { writeAudit } from "./admin.mjs";
import { TOOL_BY_NAME, TOOL_DEFS } from "./optimist-tools.mjs";

const ssm = new SSMClient({});
let anthropic;
/* Exported so other modules that need the same Anthropic client (the help
   widget's assistant in guides.mjs) don't each fetch and cache their own copy
   of the SSM API key. */
export async function client() {
  if (anthropic) return anthropic;
  const p = await ssm.send(new GetParameterCommand({
    Name: process.env.ANTHROPIC_KEY_PARAM, WithDecryption: true
  }));
  anthropic = new Anthropic({ apiKey: p.Parameter.Value });
  return anthropic;
}

const MODEL = "claude-sonnet-5";
const MAX_TOOL_ROUNDS = 6;
const MAX_MSG_CHARS = 8000;
/* Turns kept on a conversation. Pairs, so 40 is 20 exchanges — past that the
   oldest fall off rather than growing the prompt without bound. */
const MAX_TURNS = 40;
const CONV_TTL_DAYS = 180;

/* ---------- conversation storage ----------
   pk = "CONV#<username>" so one person's conversations are a single query and
   nobody else's key range is reachable. Only the plain text of each turn is
   kept: tool calls and their results are working memory for one answer, not
   part of the transcript, and replaying them would grow every follow-up
   request for no gain. The model re-reads whatever it needs. */

const convPk = username => `CONV#${username}`;

async function loadConversation(username, id) {
  if (!id || typeof id !== "string") return null;
  const item = await get(convPk(username), id);
  return item || null;
}

async function saveConversation(username, conv) {
  await put({
    ...conv,
    pk: convPk(username),
    sk: conv.sk,
    turns: conv.turns.slice(-MAX_TURNS),
    updated: new Date().toISOString(),
    ttl: Math.floor(Date.now() / 1000) + CONV_TTL_DAYS * 86400
  });
}

/* ---------- attachments ----------
   Carried over from the proposal assistant: someone can hand The Optimist a
   PDF, notes, or a screenshot and ask about it. */
const ATTACH_KIND = {
  "application/pdf": "document",
  "text/plain": "text", "text/markdown": "text", "text/csv": "text",
  "image/png": "image", "image/jpeg": "image"
};
const MAX_ATTACH_B64 = 5_500_000; // ~4MB file

export function attachmentBlock(att) {
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


/* ---------- the prompt ---------- */

function systemPrompt(ctx, scopeLabel, labList) {
  return `You are The Optimist, the assistant built into The Portal, the internal web app of Optimistic Labs. Optimistic Labs is a consultancy that runs client engagements through practice "labs", each led by a Lab Leader, with contributors staffed onto the work from a shared bench.

You are talking to ${fullName(ctx.me) || ctx.me.sk}, whose role is ${ctx.role}. Today is ${today()}. Their retrieval scope for this conversation is ${scopeLabel}.
The labs in the Portal: ${labList || "(none recorded)"}.

# How you answer
The person you are talking to does not know you have tools, and must never find out. Your tools' names (search_pipeline, get_deal and the rest) are yours alone: they never appear in your answer, and you never narrate calling one. Refer to what you read the way a colleague would, as the pipeline, the bench, the knowledge base. Write "there are no open deals you can see", never "search_pipeline returned nothing".
- Everything factual you say about Optimistic Labs comes from a tool call. You have no other knowledge of this company's deals, proposals, people, contracts or resources. If the tools return nothing, say so plainly and say what you would need. Never invent a client, a person, a number, a date or a document.
- Call tools before answering whenever the question touches portal data, including when you are only fairly sure. Several tools in one turn is normal and cheap. Reading is always better than guessing.
- Name what you found: refer to deals, proposals and people by their real names and ids so the answer can be checked. When a number came from a record, it is the record's number.
- If the question is about operating the software rather than the business, use how_to_use_the_portal and give the actual clicks in order.
- Their scope narrows what you retrieve. If the answer clearly lies outside it, say which lab it is in rather than silently reaching past it.
- You can only read. You cannot create, edit, send or delete anything in the Portal. When something needs doing, say exactly where in the Portal to do it.

# Format, which is not negotiable
Your answer is displayed as plain text. Nothing renders markup, so any you write is shown to them literally, asterisks and all.
- No asterisks, no #, no backticks, no tables, no markdown of any kind. To emphasise something, write a sentence that carries the weight.
  This is about markup, not about ordinary characters: money keeps its dollar sign and its commas, written $10,000 and never "10,000 dollars".
- Structure with short paragraphs separated by a blank line. When a list is genuinely a list, run it as short lines starting with a name or an id, not with a bullet character.
- Never use an em dash or an en dash as punctuation. Use a comma, a full stop, or restructure the sentence.
  Ordinary hyphens are not dashes and must be preserved exactly: dates stay 2026-08-26, ids stay D-001, and hyphenated words stay hyphenated.

# Voice
- Write like a sharp colleague: plain, specific, confident, no filler and no throat-clearing. Lead with the answer, then the reasoning.
- Say what you would actually do next when there is an obvious next move, and be concrete about it.
- Do not flatter, and do not open by restating the question.
- Hedge only where the data is genuinely thin, and then say which part is thin.

# Care
- Anything you draft may go to a funder or a client. Ground tone and pricing language in the knowledge base rather than in generic consulting habit.
- People's contact details are opt-in. If a phone or email did not come back from a tool, it was withheld on purpose; do not work around it.`;
}

/* ---------- the turn ----------

   Runs one exchange: model, tools, model again, until it stops asking for
   tools. Text deltas go out through onEvent as they arrive, so the caller can
   put them on the wire immediately.

   `onEvent` receives { t: "meta" | "tool" | "text" | "done" | "error", ... }. */
export async function runOptimist({ ctx, message, scope = "all", conversationId, attachment, historyLength, onEvent = () => {} }) {
  const text = String(message || "").trim().slice(0, MAX_MSG_CHARS);
  if (!text && !attachment) return { error: { status: 400, message: "say something first" } };

  const labs = await listType("LAB");
  const names = Object.fromEntries(labs.map(l => [l.sk, l.name]));
  // A scope the caller cannot see would silently return nothing, which reads
  // as "there is no such work" rather than "you can't see that lab".
  const wantScope = scope && scope !== "all" ? String(scope) : "all";
  if (wantScope !== "all") {
    if (!names[wantScope]) return { error: { status: 400, message: "unknown lab scope" } };
    if (!ctx.can.seesLab(wantScope)) return { error: { status: 403, message: "That lab is outside your access" } };
  }
  const scopeLabel = wantScope === "all" ? "all labs they can see" : names[wantScope];
  const labList = labs
    .filter(l => ctx.can.seesLab(l.sk))
    .map(l => `${l.name} (id ${l.sk})`).join(", ");

  const existing = await loadConversation(ctx.me.sk, conversationId);
  const conv = existing || {
    sk: randomUUID(), title: text.slice(0, 80) || "New conversation",
    turns: [], created: new Date().toISOString()
  };
  conv.scope = wantScope;

  /* Retry. The client re-sends a message it has already sent, having dropped
     that answer and everything after it from its own view, and says how many
     stored turns should survive. Without this the server would append a
     second copy of the question and the two transcripts would drift apart
     from the first retry onwards. */
  if (Number.isInteger(historyLength) && historyLength >= 0 && historyLength < conv.turns.length) {
    conv.turns = conv.turns.slice(0, historyLength);
  }

  onEvent({ t: "meta", conversationId: conv.sk });

  /* The stored transcript is plain text; the live turn may also carry an
     attachment, which is a content block rather than a string. */
  const history = conv.turns.slice(-MAX_TURNS).map(m => ({
    role: m.role === "assistant" ? "assistant" : "user",
    content: String(m.content || "").slice(0, MAX_MSG_CHARS)
  })).filter(m => m.content.trim());
  while (history.length && history[0].role !== "user") history.shift();

  let userContent = text;
  if (attachment) {
    const { block, error } = attachmentBlock(attachment);
    if (error) return { error: { status: 400, message: error } };
    userContent = [block, { type: "text", text: text || "What do you make of this?" }];
  }

  const messages = [...history, { role: "user", content: userContent }];
  const system = systemPrompt(ctx, scopeLabel, labList);
  const c = await client();

  let answer = "";
  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const stream = c.messages.stream({
      model: MODEL,
      max_tokens: 4000,
      thinking: { type: "adaptive" },
      // The old proposal assistant had to bound thinking to survive API
      // Gateway's 29 second ceiling. This function streams from its own URL
      // and has no such ceiling, but a chat still wants its first token
      // quickly, and "medium" is enough reasoning to pick the right tools.
      output_config: { effort: "medium" },
      system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
      tools: TOOL_DEFS,
      messages
    });

    stream.on("text", delta => {
      answer += delta;
      onEvent({ t: "text", v: delta });
    });

    const final = await stream.finalMessage();

    if (final.stop_reason === "refusal")
      return { error: { status: 502, message: "The Optimist declined to answer that" } };

    if (final.stop_reason !== "tool_use") {
      messages.push({ role: "assistant", content: final.content });
      break;
    }

    // Thinking blocks have to travel back with the assistant turn for the
    // model to continue the same line of reasoning after a tool result.
    messages.push({ role: "assistant", content: final.content });
    const calls = final.content.filter(b => b.type === "tool_use");
    const results = await Promise.all(calls.map(async call => {
      const tool = TOOL_BY_NAME[call.name];
      onEvent({ t: "tool", name: call.name });
      if (!tool) return { type: "tool_result", tool_use_id: call.id, content: `No tool named ${call.name}.` };
      try {
        const out = await tool.run(ctx, call.input || {}, wantScope);
        return { type: "tool_result", tool_use_id: call.id, content: JSON.stringify(out) };
      } catch (err) {
        console.error(JSON.stringify({ level: "error", message: "optimist.tool", tool: call.name, detail: err.message }));
        // Handed back as a result rather than thrown: one failing lookup
        // should cost that fact, not the whole answer.
        return { type: "tool_result", tool_use_id: call.id, is_error: true, content: `That lookup failed: ${err.message}` };
      }
    }));
    messages.push({ role: "user", content: results });
  }

  if (!answer.trim())
    return { error: { status: 502, message: "The Optimist returned nothing; try again" } };

  conv.turns.push({ role: "user", content: text || "(attachment)" }, { role: "assistant", content: answer });
  await saveConversation(ctx.me.sk, conv);
  await writeAudit(ctx.realMe?.sk || ctx.me.sk, "optimist.chat", `${conv.sk} · ${text.slice(0, 80)}`);

  onEvent({ t: "done", conversationId: conv.sk });
  return { conversationId: conv.sk, text: answer };
}
