/* OL Portal · The Optimist's retrieval tools.

   Nine ways to read the Portal, and no way to write to it. Two properties
   matter more than anything else in here:

   1. Each tool delegates to the same handler the REST API calls
      (proposals.listProposals, contracts.listContracts, and so on) with the
      caller's own ctx, then compacts what comes back. That is why the
      assistant cannot out-see the person asking, and why a permission rule
      changed in one of those modules changes here too instead of drifting.

   2. Results are compacted, not passed through. A PROPOSAL record carries
      every committed version and the full customer view log; handing that to
      the model whole would spend thousands of tokens telling it things nobody
      asked about. Search tools return summaries, the get_ tools return one
      record in full. */

import { get, listType, fullName } from "./util.mjs";
import * as proposals from "./proposals.mjs";
import * as contracts from "./contracts.mjs";
import * as resources from "./resources.mjs";
import * as courses from "./courses.mjs";

/* The list handlers return HTTP responses because that is what app.mjs needs
   from them. Unwrapping here is the price of having exactly one implementation
   of every permission rule. */
async function viaHandler(fn, ctx, ...args) {
  const res = await fn(ctx, ...args);
  const body = res.body ? JSON.parse(res.body) : null;
  if (res.statusCode >= 300) return { error: body?.error || "not available" };
  return { data: body };
}

const norm = s => String(s ?? "").toLowerCase();

/* One matcher for every search tool: an absent query means "everything",
   otherwise every whitespace-separated term must appear somewhere in the
   record's searchable text. AND rather than OR, because "faith grant" should
   narrow to the overlap rather than return every record mentioning either. */
function matches(query, ...fields) {
  const q = norm(query).trim();
  if (!q) return true;
  const hay = fields.map(norm).join(" ");
  return q.split(/\s+/).every(term => hay.includes(term));
}

/* `scope` is a lab id, or "all". It narrows retrieval the way the composer's
   scope pill promises; it can only ever narrow, never widen past what the
   caller's permissions already allow. */
const inScope = (scope, lab) => scope === "all" || !scope || lab === scope;

const money = n => (Number.isFinite(n) ? `$${Number(n).toLocaleString("en-US")}` : "unknown");

async function labNames() {
  const labs = await listType("LAB");
  return Object.fromEntries(labs.map(l => [l.sk, l.name]));
}

const TOOLS = [
  {
    name: "search_pipeline",
    description: "Search deals in the pipeline: who the client is, which stage the deal is in, its value, expected close date, who owns it, and whether a contract is signed. Use this for anything about opportunities, revenue, forecasts, what is closing soon, or what is stuck.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Free text matched against client name, lab, stage and owner. Omit to list everything in scope." },
        stage: { type: "string", enum: ["Lead", "Discovery", "Proposal Sent", "Negotiating", "Closed"], description: "Restrict to one stage." },
        includeClosed: { type: "boolean", description: "Include closed deals. Defaults to false, so results are open opportunities." }
      },
      additionalProperties: false
    },
    async run(ctx, { query, stage, includeClosed }, scope) {
      if (ctx.role === "Contributor") return { deals: [], note: "Contributors do not have pipeline access." };
      const [items, names] = await Promise.all([listType("DEAL"), labNames()]);
      const visible = items
        .filter(d => ctx.can.seesLab(d.lab) || ctx.can.leadsDeal(d))
        .filter(d => inScope(scope, d.lab))
        .filter(d => (stage ? d.stage === stage : true))
        .filter(d => (includeClosed || stage === "Closed" ? true : d.stage !== "Closed"))
        .filter(d => matches(query, d.client, names[d.lab], d.lab, d.stage, d.owner, d.source));
      visible.sort((a, b) => String(a.close || "").localeCompare(String(b.close || "")));
      return {
        deals: visible.slice(0, 60).map(d => ({
          id: d.sk, client: d.client, lab: names[d.lab] || d.lab, stage: d.stage,
          amount: money(d.amount), expectedClose: d.close, owner: d.owner,
          source: d.source, recurring: !!d.recurring,
          ...(d.outcome ? { outcome: d.outcome } : {}),
          ...(d.contractSigned ? { contractSigned: true } : {}),
          ...(d.readyToClose ? { readyToClose: true } : {})
        })),
        total: visible.length
      };
    }
  },
  {
    name: "get_deal",
    description: "Everything recorded about one deal, including its proposals and contracts. Call this after search_pipeline when you need detail on a specific opportunity.",
    input_schema: {
      type: "object",
      properties: { id: { type: "string", description: "The deal id, e.g. D-004." } },
      required: ["id"],
      additionalProperties: false
    },
    async run(ctx, { id }) {
      if (ctx.role === "Contributor") return { error: "Contributors do not have pipeline access." };
      const d = await get("DEAL", id);
      if (!d) return { error: `No deal ${id}.` };
      if (!(ctx.can.seesLab(d.lab) || ctx.can.leadsDeal(d))) return { error: `No deal ${id} you can see.` };
      const [names, props, cons] = await Promise.all([
        labNames(),
        viaHandler(proposals.listProposals, ctx),
        viaHandler(contracts.listContracts, ctx)
      ]);
      return {
        id: d.sk, client: d.client, lab: names[d.lab] || d.lab, stage: d.stage,
        amount: money(d.amount), expectedClose: d.close, source: d.source,
        owner: d.owner, dealOwner: d.dealOwner, recurring: !!d.recurring,
        outcome: d.outcome || null,
        contractSigned: !!d.contractSigned,
        proposals: (props.data || []).filter(p => p.deal === id)
          .map(p => ({ id: p.id, title: p.title, status: p.status, version: p.version, updated: p.updated })),
        contracts: (cons.data || []).filter(c => c.deal === id)
          .map(c => ({ id: c.id, kind: c.docLabel || c.docKind, status: c.status, amount: money(c.amount) }))
      };
    }
  },
  {
    name: "search_proposals",
    description: "Search proposals: title, client, lab, status, which version is live, and whether a customer has responded. Use get_proposal to read the actual written sections.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Free text matched against title, client and lab." },
        status: {
          type: "string",
          enum: ["Draft", "In Review", "Internally Approved", "Sent", "Customer Approved", "Customer Rejected", "Revision Requested"],
          description: "Restrict to one status."
        }
      },
      additionalProperties: false
    },
    async run(ctx, { query, status }, scope) {
      const { data, error } = await viaHandler(proposals.listProposals, ctx);
      if (error) return { error };
      const names = await labNames();
      const hits = data
        .filter(p => inScope(scope, p.lab))
        .filter(p => (status ? p.status === status : true))
        .filter(p => matches(query, p.title, p.client, names[p.lab], p.lab));
      return {
        proposals: hits.slice(0, 60).map(p => ({
          id: p.id, title: p.title, client: p.client, lab: names[p.lab] || p.lab,
          status: p.status, version: p.version, updated: p.updated,
          deal: p.deal || null,
          sentAt: p.sentAt || null,
          customerDecision: p.decision ? `${p.decision.action} on ${p.decision.at}` : null,
          sectionsWritten: Object.entries(p.sections || {}).filter(([, v]) => String(v).trim()).map(([k]) => k)
        })),
        total: hits.length
      };
    }
  },
  {
    name: "get_proposal",
    description: "The full written text of one proposal: every section, its structured pricing, version history and the customer's response. Use this when asked what a proposal says, to reuse its language, or to compare it to another.",
    input_schema: {
      type: "object",
      properties: { id: { type: "string", description: "The proposal id, e.g. P-002." } },
      required: ["id"],
      additionalProperties: false
    },
    async run(ctx, { id }) {
      const { data, error } = await viaHandler(proposals.listProposals, ctx);
      if (error) return { error };
      const p = (data || []).find(x => x.id === id);
      if (!p) return { error: `No proposal ${id} you can see.` };
      const names = await labNames();
      return {
        id: p.id, title: p.title, client: p.client, lab: names[p.lab] || p.lab,
        status: p.status, version: p.version, updated: p.updated,
        sections: p.sections || {},
        pricing: p.pricing || null,
        versions: (p.versions || []).map(v => ({ v: v.v, date: v.date, author: v.author, status: v.status })),
        customerDecision: p.decision || null,
        viewCount: p.viewCount || 0
      };
    }
  },
  {
    name: "search_bench",
    description: "Search people in the Optimistic Labs directory (the bench): their role, which labs they work in, what they specialize in, and how to reach them. Use this for staffing questions and for who to pull into a piece of work.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Free text matched against name, role, lab and specialties, e.g. 'grant writing' or 'Faith Lab'." }
      },
      additionalProperties: false
    },
    async run(ctx, { query }, scope) {
      const [people, names] = await Promise.all([listType("PERSON"), labNames()]);
      const hits = people
        .filter(p => (scope === "all" || !scope ? true : (p.labs || []).includes(scope)))
        .filter(p => matches(
          query, fullName(p), p.role, (p.labs || []).map(l => names[l] || l).join(" "),
          p.bench?.blurb, (p.bench?.specialties || []).join(" ")
        ));
      return {
        people: hits.slice(0, 60).map(p => {
          // Same privacy filter the bench directory applies: contact details
          // are opt-in per person and an assistant must not route around that.
          const b = p.bench || {};
          const showEmail = ctx.role === "Admin" || p.sk === ctx.me.sk || b.showEmail !== false;
          const showPhone = ctx.role === "Admin" || p.sk === ctx.me.sk || b.showPhone === true;
          return {
            username: p.sk, name: fullName(p), role: p.role,
            labs: (p.labs || []).map(l => names[l] || l),
            specialties: b.specialties || [],
            about: b.blurb || "",
            ...(showEmail && b.email ? { email: b.email } : {}),
            ...(showPhone && b.phone ? { phone: b.phone } : {})
          };
        }),
        total: hits.length
      };
    }
  },
  {
    name: "search_resources",
    description: "Search the Resource Library and Courses: guides, posts, files, videos and structured courses published for the team. Use this when asked what OL has written about something, or what someone should read or watch.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Free text matched against title, description and tags." }
      },
      additionalProperties: false
    },
    async run(ctx, { query }, scope) {
      const [res, crs] = await Promise.all([
        viaHandler(resources.listResources, ctx),
        viaHandler(courses.listCourses, ctx)
      ]);
      const names = await labNames();
      const items = (res.data || [])
        .filter(r => inScope(scope, r.lab || scope))
        .filter(r => matches(query, r.title, r.description, (r.tags || []).join(" ")));
      const cs = (crs.data || [])
        .filter(c => inScope(scope, c.lab || scope))
        .filter(c => matches(query, c.title, c.description));
      return {
        resources: items.slice(0, 40).map(r => ({
          id: r.id, type: r.type, title: r.title, summary: r.description || "",
          tags: r.tags || [], lab: r.lab ? names[r.lab] || r.lab : "all labs",
          // The body is the whole point of a post, so it travels with the hit
          // rather than needing a second call for the one record type where
          // the text IS the resource.
          ...(r.type === "post" && r.body ? { body: String(r.body).slice(0, 6000) } : {})
        })),
        courses: cs.slice(0, 20).map(c => ({
          id: c.id, title: c.title, summary: c.description || "",
          steps: (c.steps || []).length, estimatedMinutes: c.estimatedMinutes || null
        })),
        total: items.length + cs.length
      };
    }
  },
  {
    name: "search_knowledge_base",
    description: "Search Optimistic Labs' internal knowledge base: how OL prices work, house tone of voice, patterns from past proposals, and standing policy. Consult this before writing anything client-facing so the language matches how OL actually writes.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Free text matched against entry title and content." }
      },
      additionalProperties: false
    },
    async run(ctx, { query }, scope) {
      // Deliberately readable by any signed-in user even though the /kb CRUD
      // routes are admin-only: the entries exist to shape what Lab Leaders
      // send to clients, and a Lab Leader who cannot read house pricing
      // guidance is exactly who gets it wrong. Editing stays admin-only.
      const [entries, names] = await Promise.all([listType("KB"), labNames()]);
      const hits = entries
        .filter(e => !e.lab || inScope(scope, e.lab))
        .filter(e => matches(query, e.title, e.content));
      return {
        entries: hits.slice(0, 15).map(e => ({
          id: e.sk, title: e.title,
          appliesTo: e.lab ? names[e.lab] || e.lab : "all labs",
          content: String(e.content || "").slice(0, 8000)
        })),
        total: hits.length
      };
    }
  },
  {
    name: "search_agreements",
    description: "Search contracts, MSAs and task orders, plus invoice requests. Use this for what has been signed, what is out for signature, and what has been billed.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Free text matched against counterparty, lab and status." },
        include: {
          type: "string",
          enum: ["contracts", "invoices", "both"],
          description: "Which to return. Defaults to both."
        }
      },
      additionalProperties: false
    },
    async run(ctx, { query, include = "both" }, scope) {
      const names = await labNames();
      const out = {};
      if (include !== "invoices") {
        const { data, error } = await viaHandler(contracts.listContracts, ctx);
        if (error) return { error };
        const hits = (data || [])
          .filter(c => inScope(scope, c.lab))
          .filter(c => matches(query, c.client, names[c.lab], c.status, c.docLabel));
        out.contracts = hits.slice(0, 40).map(c => ({
          id: c.id, kind: c.docLabel || c.docKind || "Contract", counterparty: c.client,
          lab: names[c.lab] || c.lab, status: c.status, amount: money(c.amount),
          deal: c.deal || null, executedAt: c.executedAt || null,
          hasDeviations: !!c.hasDeviations
        }));
      }
      if (include !== "contracts") {
        if (ctx.role === "Contributor") {
          out.invoices = [];
        } else {
          const items = await listType("INVOICE");
          const hits = items
            .filter(i => ctx.can.seesLab(i.lab) || (ctx.role === "Lab Leader" && i.requestedBy === ctx.me.sk))
            .filter(i => inScope(scope, i.lab))
            .filter(i => matches(query, i.client, names[i.lab], i.status));
          out.invoices = hits.slice(0, 40).map(i => ({
            id: i.sk, client: i.client, lab: names[i.lab] || i.lab,
            amount: money(i.amount), status: i.status, requested: i.date,
            requestedBy: i.requestedBy, recurring: !!i.recurring
          }));
        }
      }
      return out;
    }
  },
  {
    name: "how_to_use_the_portal",
    description: "The Portal's own documentation: what each page does and the exact clicks to accomplish something in the software. Use this whenever the question is about operating the Portal rather than about OL's business data.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "What they are trying to do, e.g. 'close a deal' or 'invite a contributor'." }
      },
      additionalProperties: false
    },
    async run(ctx, { query }) {
      // Role-gated at the section level, same as the help widget reads it.
      const items = await listType("GUIDE");
      const pages = items
        .filter(g => !g.roles || g.roles.includes(ctx.role))
        .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
        .map(g => ({
          page: g.sk, title: g.title, summary: g.summary,
          sections: (g.sections || []).filter(s => !s.roles || s.roles.includes(ctx.role))
        }));
      const q = norm(query).trim();
      // A page matches on its own text or on any of its sections, and then the
      // whole page travels: an answer about "closing a deal" usually needs the
      // steps either side of the one section that matched the words.
      const hits = q
        ? pages.filter(g => matches(query, g.title, g.summary, g.page,
            g.sections.map(s => `${s.heading} ${s.body}`).join(" ")))
        : pages;
      return { pages: (hits.length ? hits : pages).slice(0, 6) };
    }
  }
];

export const TOOL_BY_NAME = Object.fromEntries(TOOLS.map(t => [t.name, t]));
export const TOOL_DEFS = TOOLS.map(({ name, description, input_schema }) => ({ name, description, input_schema }));
