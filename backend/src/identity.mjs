/* OL Portal · identity and the permission matrix (PRD 3.3).

   This used to live inside app.mjs, which was fine while a single Lambda
   served every request. The Optimist's streaming assistant runs in its own
   function (see optimist-stream.mjs — API Gateway cannot stream a response),
   and it has to answer questions using exactly the data the caller is allowed
   to see. Two copies of a permission matrix is how the two drift apart, so
   both functions build their context here.

   Identity always comes from the Cognito JWT (username = person key, group =
   role) and is never trusted from the client. */

import { get } from "./util.mjs";

export const ROLE_OF_GROUP = { Admin: "Admin", LabLeader: "Lab Leader", Contributor: "Contributor" };

/* Reads the claim shapes both entry points produce: the HTTP API's JWT
   authorizer hands over pre-parsed claims where `cognito:groups` may arrive as
   a bracketed string, while a token verified in-process gives a real array. */
export function identityFromClaims(claims = {}) {
  const username = (claims["cognito:username"] || claims.username || "").toLowerCase();
  const rawGroups = claims["cognito:groups"] || "";
  const groups = Array.isArray(rawGroups) ? rawGroups
    : String(rawGroups).replace(/[\[\]]/g, "").split(/[,\s]+/).filter(Boolean);
  const role = ROLE_OF_GROUP[groups.find(g => ROLE_OF_GROUP[g])];
  return { username, role };
}

export const perms = (role, myLabs, myKey) => ({
  inMyLabs: lab => myLabs.includes(lab),
  seesLab: lab => role === "Admin" || (role === "Lab Leader" && myLabs.includes(lab)),
  // PRD 3.3: a Lab Leader also sees/edits a deal (and can request its invoices)
  // outside their own lab(s) when they're the Lab Leader named on that deal —
  // "projects in other labs that they are leading."
  leadsDeal: d => role === "Lab Leader" && d.owner === myKey,
  addDeal: () => role === "Admin" || (role === "Lab Leader" && myLabs.length > 0),
  editDeal: d => role === "Admin" || (role === "Lab Leader" && (myLabs.includes(d.lab) || d.owner === myKey)),
  deleteDeal: () => role === "Admin",
  changeLab: () => role === "Admin",
  reviewInvoices: () => role === "Admin",
  editProposal: p => role === "Admin" || (role === "Lab Leader" && (myLabs.includes(p.lab) || p.owner === myKey)),
  approveProposal: () => role === "Admin"
});

/* Admin "act as" (god-mode view/edit as another user): the caller's own JWT
   never changes — this only substitutes who ctx.me/ctx.role/ctx.can resolve to
   for this request. Every downstream permission check runs against the
   *substituted* identity, so acting as a non-Admin naturally locks the caller
   out of admin-only routes for the duration — no separate allowlist needed.
   ctx.realMe/ctx.realRole keep the true caller available so the act-as
   start/stop routes (and audit logging) always know who's really here.

   Returns { ctx } or { error: { status, message } } rather than an HTTP
   response, because the two callers frame their errors differently (JSON body
   vs. a stream event). */
export async function buildContext({ username, role, actAsTarget, meta = {}, query = {} }) {
  if (!username || !role) return { error: { status: 403, message: "No portal role on this account" } };
  const me = await get("PERSON", username);
  if (!me) return { error: { status: 403, message: "No portal profile for this user" } };

  if (actAsTarget) {
    if (role !== "Admin") return { error: { status: 403, message: "Only Admins can act as another user" } };
    const target = await get("PERSON", actAsTarget);
    if (!target) return { error: { status: 404, message: "No such user to act as" } };
    if (target.role === "Admin") return { error: { status: 403, message: "Can't act as another Admin" } };
    return {
      ctx: {
        me: target, role: target.role,
        can: perms(target.role, target.labs || [], target.sk),
        realMe: me, realRole: role, actingAs: true, meta, query
      }
    };
  }

  return {
    ctx: {
      me, role, can: perms(role, me.labs || [], me.sk),
      realMe: me, realRole: role, actingAs: false, meta, query
    }
  };
}
