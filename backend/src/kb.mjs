/* OL Portal · knowledge base (PRD 3.8).

   Admin-owned reference content — past-proposal patterns, pricing frameworks,
   tone of voice — that Liz and Seth curate in the Admin page. It used to live
   in assist.mjs beside the proposal-drafting assistant that consumed it; that
   assistant is gone (The Optimist is a portal-wide assistant now, see
   optimist.mjs), so the knowledge base stands on its own here. The Optimist
   still reads it, through the search_knowledge_base tool. */

import { resp, today, get, put, del, listType, nextId } from "./util.mjs";
import { writeAudit } from "./admin.mjs";

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
