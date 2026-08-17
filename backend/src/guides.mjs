/* OL Portal · in-app help (contextual guide widget).

   One GUIDE record per portal page (pk="GUIDE", sk=<pageKey>, matching the
   sidebar's route segments — "dashboard" for the root page). Content is
   maintained by editing backend/scripts/seed-guides.mjs and re-running it,
   the same way sample data was originally loaded — there's no in-app editor
   for this, unlike the Knowledge Base (assist.mjs's /kb routes) which Liz/Seth
   curate directly; guide copy describes the software itself, not sales
   playbooks, so only a dev needs to touch it.

   Role-awareness lives at the section level rather than as separate records
   per role: most of a page reads the same for everyone who can reach it, and
   only a handful of sections are role-specific (e.g. "as an Admin you can
   also ..."). `roles` on the top-level record and on each section is an
   allowlist; omitting it means "everyone who can see this page at all".

   The widget itself is a chat, not just a static reference panel: "how do I
   close a deal" should work no matter which page you're asking it from. The
   assistant (helpAssist below) is grounded in the SAME guide content GET
   /guides serves, so there's exactly one place this copy lives; it just gets
   consumed two ways. */

import { resp, listType } from "./util.mjs";
import { client } from "./assist.mjs";

async function visibleGuidesFor(role) {
  const items = await listType("GUIDE");
  return items
    .filter(g => !g.roles || g.roles.includes(role))
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    .map(({ pk, sk, order, roles, sections, ...rest }) => ({
      page: sk,
      ...rest,
      sections: (sections || []).filter(s => !s.roles || s.roles.includes(role))
    }));
}

export async function listGuides(ctx) {
  return resp(200, await visibleGuidesFor(ctx.role));
}

/* ---------- help chat ----------
   A plain Q&A assistant, not a document editor like The Optimist: one field
   out (`reply`), no sections, no drafting state to track between turns. */
const HELP_CHAT_SCHEMA = {
  type: "object",
  properties: {
    reply: {
      type: "string",
      description: "Your answer. If it involves clicking through the app, give the exact steps in order, naming the real page, tab, button, or field by its label rather than describing generically. Under 150 words."
    }
  },
  required: ["reply"],
  additionalProperties: false
};

const MAX_TURNS = 20;
const MAX_MSG_CHARS = 2000;

export async function helpAssist(ctx, body) {
  const { messages } = body || {};
  if (!Array.isArray(messages) || !messages.length) return resp(400, { error: "messages are required" });
  const turns = messages.slice(-MAX_TURNS).map(m => ({
    role: m?.role === "assistant" ? "assistant" : "user",
    content: String(m?.content || "").slice(0, MAX_MSG_CHARS)
  })).filter(m => m.content.trim());
  while (turns.length && turns[0].role !== "user") turns.shift(); // API requires a user turn first
  if (!turns.length) return resp(400, { error: "ask a question first" });

  const guides = await visibleGuidesFor(ctx.role);
  const docs = guides.map(g =>
    `## ${g.title} (page key: "${g.page}")\n${g.summary}\n${g.sections.map(s => `### ${s.heading}\n${s.body}`).join("\n")}`
  ).join("\n\n");

  const system = `You are the help assistant built into OL Portal, Optimistic Labs' internal web app. Someone signed in as a ${ctx.role} is asking how to do something in the software.

Answer only from the documentation below; it describes exactly what exists in the app today, for this person's role. If something isn't covered, say you're not sure rather than guessing at a feature that might not exist.
- Be concrete: name the actual page, tab, button, or field, and the order of clicks, so the answer reads like directions.
- Keep it short: a few sentences or a short numbered list, not an essay.
- If the answer lives on a page other than where they're likely asking from, say which page to go to.
- Never use em-dashes.

# Portal documentation, scoped to this person's role
${docs}`;

  const c = await client();
  const response = await c.messages.create({
    model: "claude-sonnet-5",
    max_tokens: 1000,
    system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
    output_config: { format: { type: "json_schema", schema: HELP_CHAT_SCHEMA } },
    messages: turns
  });

  if (response.stop_reason === "refusal")
    return resp(502, { error: "The assistant declined to answer" });
  const text = response.content.find(x => x.type === "text")?.text;
  if (!text) return resp(502, { error: "The assistant returned nothing; try again" });

  return resp(200, { reply: JSON.parse(text).reply });
}
