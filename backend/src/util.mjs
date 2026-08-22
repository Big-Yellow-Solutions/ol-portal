/* OL Portal · shared data helpers for the API modules. */

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient, GetCommand, PutCommand, DeleteCommand, QueryCommand
} from "@aws-sdk/lib-dynamodb";

export const TABLE = process.env.TABLE_NAME;
export const doc = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true }
});

export const resp = (status, body) => ({
  statusCode: status,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body)
});
export const today = () => new Date().toISOString().slice(0, 10);
export const fullName = p => [p?.firstName, p?.lastName].filter(Boolean).join(" ").trim();

/* For the HTML half of the emails the portal sends. Everything interpolated
   into one is a name a person typed, so none of it can be trusted as markup. */
export const esc = s => String(s ?? "").replace(/[&<>"']/g, ch =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));

/* The counterparty's way back to a document they have no login for. The token
   is the credential, so this is also how they reach the executed copy
   afterwards. */
export const signUrl = token => `${process.env.FRONTEND_URL}/contract-sign.html?token=${token}`;

export const get = async (pk, sk) =>
  (await doc.send(new GetCommand({ TableName: TABLE, Key: { pk, sk } }))).Item;

export const listType = async pk => {
  const out = [];
  let ExclusiveStartKey;
  do {
    const page = await doc.send(new QueryCommand({
      TableName: TABLE, KeyConditionExpression: "pk = :p",
      ExpressionAttributeValues: { ":p": pk }, ExclusiveStartKey
    }));
    out.push(...page.Items);
    ExclusiveStartKey = page.LastEvaluatedKey;
  } while (ExclusiveStartKey);
  return out;
};

export const put = item => doc.send(new PutCommand({ TableName: TABLE, Item: item }));
export const del = (pk, sk) => doc.send(new DeleteCommand({ TableName: TABLE, Key: { pk, sk } }));

/* `match` narrows which existing items the counter looks at. Several kinds of
   agreement share pk="CONTRACT" (see DOC_KINDS below), and without a filter a
   new MSA would take its number from the highest contract — the sequences
   would interleave and skip. Filtering gives each prefix its own run. Distinct
   prefixes mean distinct sks, so two sequences at the same number never
   collide on the key. */
export async function nextId(pk, prefix, match) {
  const items = await listType(pk);
  const scoped = match ? items.filter(match) : items;
  const max = scoped.reduce((m, x) => Math.max(m, parseInt(x.sk.replace(/\D/g, ""), 10) || 0), 0);
  return prefix + String(max + 1).padStart(3, "0");
}

/* ---------- document kinds (Contributor MSA PRD) ----------

   Every agreement the portal executes is a CONTRACT record; `docKind` says
   which kind of paper it is. The signing flow, the tamper hash, the PDF
   renderer and the audit trail don't care which — they operate on the record
   shape, so a new kind inherits all of it.

     client      OL to customer services agreement. The original, and the
                 only kind that inherits from a proposal.
     msa         OL to Contributor master services agreement. No deal, no
                 proposal, no customer. Parent record for task orders.
     task-order  one scoped engagement under a signed MSA (`parentId`), which
                 supplies its standard terms by reference.

   Absent `docKind` reads as "client" so every contract written before this
   existed keeps working untouched — there is no migration.

   Change orders are the next kind to land here (they amend a signed task
   order or contract via the same `parentId` link). Deliberately not in
   DOC_KINDS yet: the enum is what the API validates against, and a
   half-built kind shouldn't be reachable. */
export const DOC_KINDS = ["client", "msa", "task-order"];

export const DOC_META = {
  client: {
    label: "Contract", title: "Services Agreement", prefix: "C-",
    templateKind: "contract", counterparty: "client", parentKind: null
  },
  msa: {
    label: "MSA", title: "Master Services Agreement", prefix: "MSA-",
    templateKind: "msa", counterparty: "contributor", parentKind: null
  },
  "task-order": {
    label: "Task Order", title: "Task Order", prefix: "TO-",
    templateKind: "task-order", counterparty: "contributor", parentKind: "msa"
  }
};

export const docKind = c => (DOC_META[c?.docKind] ? c.docKind : "client");
export const docMeta = c => DOC_META[docKind(c)];

/* The counterparty's public entry point into a document they have no login
   for — the 32-hex signToken is the credential. Shared by signing.mjs (native
   flow) and docusign.mjs (embedded-signing view, webhook → contract sync) so
   the two don't import each other just for this lookup. No GSI on this table,
   so this is a linear scan of the CONTRACT partition, same as every other
   "list" here. */
export async function byToken(token) {
  if (!/^[0-9a-f]{32}$/.test(token || "")) return null;
  return (await listType("CONTRACT")).find(c => c.signToken === token) || null;
}

/* The contributor-side papers share counterparty wording, template resolution
   and Contributor visibility, so most branches want this rather than an
   equality check against a specific kind. */
export const isContributorDoc = c => docMeta(c).counterparty === "contributor";
