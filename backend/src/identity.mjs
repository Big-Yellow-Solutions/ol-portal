/* OL Portal · identity and the permission matrix (PRD 3.3).

   This used to live inside app.mjs, which was fine while a single Lambda
   served every request. The Optimist's streaming assistant runs in its own
   function (see optimist-stream.mjs — API Gateway cannot stream a response),
   and it has to answer questions using exactly the data the caller is allowed
   to see. Two copies of a permission matrix is how the two drift apart, so
   both functions build their context here.

   Identity always comes from the verified JWT (person key + role) and is never
   trusted from the client. Which JWT depends on AUTH_PROVIDER: Cognito puts
   the person key in `cognito:username` and the role in `cognito:groups`, while
   WorkOS carries neither and has to be read differently — see below. */

import { get } from "./util.mjs";

export const ROLE_OF_GROUP = { Admin: "Admin", LabLeader: "Lab Leader", Contributor: "Contributor" };

/* WorkOS role *slugs* (the dashboard's own spelling) mapped to the portal's
   role names. The seeded `member` role is deliberately absent: it carries no
   portal meaning, and leaving it unmapped makes an unmigrated account fail
   closed at buildContext's "No portal role on this account" rather than
   silently inheriting one. */
export const ROLE_OF_WORKOS = { admin: "Admin", "lab-leader": "Lab Leader", contributor: "Contributor" };

const PROVIDER = process.env.AUTH_PROVIDER === "workos" ? "workos" : "cognito";

/* Reads the claim shapes both entry points produce: the HTTP API's JWT
   authorizer hands over pre-parsed claims where `cognito:groups` may arrive as
   a bracketed string, while a token verified in-process gives a real array. */
function fromCognitoClaims(claims) {
  const username = (claims["cognito:username"] || claims.username || "").toLowerCase();
  const rawGroups = claims["cognito:groups"] || "";
  const groups = Array.isArray(rawGroups) ? rawGroups
    : String(rawGroups).replace(/[\[\]]/g, "").split(/[,\s]+/).filter(Boolean);
  const role = ROLE_OF_GROUP[groups.find(g => ROLE_OF_GROUP[g])];
  return { username, role };
}

/* WorkOS access tokens carry no email claim at all — only sub, sid, org_id,
   role and permissions — so the portal's environments define a JWT template
   adding `urn:olportal:email`. That avoids both re-keying every PERSON row off
   the WorkOS user id and a per-request lookup against the WorkOS API.

   `email` is accepted as well because the Lambda authorizer flattens the
   namespaced claim to a plain key: API Gateway authorizer context is a flat
   string map addressed as $context.authorizer.<key>, and a colon in the key
   has no business being in that position.

   `role` is only present when a membership put an organization on the session.
   Absent role means absent membership, which fails closed one layer up. */
function fromWorkosClaims(claims) {
  const username = (claims["urn:olportal:email"] || claims.email || "").toLowerCase();
  const slugs = [claims.role, ...(Array.isArray(claims.roles) ? claims.roles : [])];
  const role = ROLE_OF_WORKOS[slugs.find(s => ROLE_OF_WORKOS[s])];
  return { username, role };
}

export function identityFromClaims(claims = {}) {
  return PROVIDER === "workos"
    ? fromWorkosClaims(claims)
    : fromCognitoClaims(claims);
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
  approveProposal: () => role === "Admin",
  // Companies/Contacts (Pipeline v2 billing entities) aren't lab-scoped — any
  // deal, in any lab, can bill to any of them — so this is a flat role check
  // rather than a per-record one, same shape as addDeal.
  manageContacts: () => role === "Admin" || role === "Lab Leader"
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
  if (!username) return { error: { status: 403, message: "No portal profile for this user" } };
  const me = await get("PERSON", username);
  if (!me) return { error: { status: 403, message: "No portal profile for this user" } };

  /* The PERSON record is the source of truth for role; the token's claim is
     only a fallback.

     Under Cognito the two always agreed — the invite wrote the group and the
     record together — so this changes nothing there. It matters for WorkOS:
     a `role` claim only appears when an organization was selected at sign-in,
     so a self-serve sign-in carries none at all. Reading the record instead
     means access is granted by adding someone to the portal rather than by
     configuring WorkOS RBAC, which is also the only place a Lab Leader's labs
     have ever lived. */
  const myRole = me.role || role;
  if (!myRole) return { error: { status: 403, message: "No portal role on this account" } };

  if (actAsTarget) {
    if (myRole !== "Admin") return { error: { status: 403, message: "Only Admins can act as another user" } };
    const target = await get("PERSON", actAsTarget);
    if (!target) return { error: { status: 404, message: "No such user to act as" } };
    if (target.role === "Admin") return { error: { status: 403, message: "Can't act as another Admin" } };
    return {
      ctx: {
        me: target, role: target.role,
        can: perms(target.role, target.labs || [], target.sk),
        realMe: me, realRole: myRole, actingAs: true, meta, query
      }
    };
  }

  return {
    ctx: {
      me, role: myRole, can: perms(myRole, me.labs || [], me.sk),
      realMe: me, realRole: myRole, actingAs: false, meta, query
    }
  };
}
