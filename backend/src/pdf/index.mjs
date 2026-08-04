/* OL Portal · document PDF generator — contracts (PRD 3.6 follow-on) and
   proposal drafts (so The Optimist can hand someone a PDF mid-conversation,
   before a contract exists). Isolated from the shared src/ bundle (own
   CodeUri in template.yaml) because puppeteer-core + @sparticuz/chromium are
   large — bundling them alongside app.mjs would bloat cold starts for every
   route, including the Cognito PostAuthentication trigger that runs
   synchronously on every login. */

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import chromium from "@sparticuz/chromium";
import puppeteer from "puppeteer-core";

const TABLE = process.env.TABLE_NAME;
const FILES_BUCKET = process.env.FILES_BUCKET;
const doc = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true }
});
const s3 = new S3Client({});

const resp = (status, body) => ({
  statusCode: status,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body)
});
const get = async (pk, sk) =>
  (await doc.send(new GetCommand({ TableName: TABLE, Key: { pk, sk } }))).Item;

const ROLE_OF_GROUP = { Admin: "Admin", LabLeader: "Lab Leader", Contributor: "Contributor" };
const SECTION_LABELS = {
  summary: "Client & problem summary", scope: "Scope", deliverables: "Deliverables",
  timeline: "Timeline", pricing: "Pricing", terms: "Terms"
};
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmt$ = n => Number.isFinite(n) ? "$" + n.toLocaleString("en-US") : "—";

function identity(event) {
  const claims = event.requestContext?.authorizer?.jwt?.claims || {};
  const username = (claims["cognito:username"] || claims.username || "").toLowerCase();
  const rawGroups = claims["cognito:groups"] || "";
  const groups = Array.isArray(rawGroups) ? rawGroups
    : String(rawGroups).replace(/[\[\]]/g, "").split(/[,\s]+/).filter(Boolean);
  const role = ROLE_OF_GROUP[groups.find(g => ROLE_OF_GROUP[g])];
  return { username, role };
}

/* Normalizes a CONTRACT or PROPOSAL record into the shape renderHtml() needs. */
async function loadDocument(kind, id) {
  if (kind === "contracts") {
    const c = await get("CONTRACT", id);
    if (!c) return null;
    const [lab, owner] = await Promise.all([get("LAB", c.lab), get("PERSON", c.owner)]);
    return {
      record: c, lab: c.lab, kindLabel: "Contract",
      title: "Service Contract",
      refLine: `${esc(c.sk)} &middot; prepared for <b>${esc(c.client)}</b>`,
      meta: [
        ["Lab", esc(lab?.name || c.lab)],
        ["Lab Leader", esc(owner?.name || c.owner || "—")],
        ["Contract value", fmt$(c.amount)],
        ["Status", esc(c.status) + (c.signedAt ? " &middot; signed " + esc(c.signedAt.slice(0, 10)) : "")],
        ...(c.contributorName || c.contributorEmail
          ? [["Contributor", esc(c.contributorName || "—") + (c.contributorEmail ? " &middot; " + esc(c.contributorEmail) : "")]]
          : []),
        ["Created", esc(c.created)]
      ],
      sections: c.sections,
      signatureRight: c.contributorName || c.client
    };
  }
  if (kind === "proposals") {
    const p = await get("PROPOSAL", id);
    if (!p) return null;
    const deal = p.deal ? await get("DEAL", p.deal) : null;
    const [lab, owner] = await Promise.all([get("LAB", p.lab), deal ? get("PERSON", deal.owner) : null]);
    return {
      record: p, lab: p.lab, kindLabel: "Proposal",
      title: `Proposal &middot; ${esc(p.title)}`,
      refLine: `${esc(p.sk)} &middot; prepared for <b>${esc(p.client)}</b> &middot; version ${esc(p.version)}`,
      meta: [
        ["Lab", esc(lab?.name || p.lab)],
        ["Lab Leader", esc(owner?.name || deal?.owner || "—")],
        ...(deal?.amount != null ? [["Deal value", fmt$(deal.amount)]] : []),
        ["Status", esc(p.status)],
        ...(p.sentAt ? [["Sent to client", esc(p.sentAt.slice(0, 10)) + ` (v${esc(p.sentVersion)})`]] : []),
        ["Updated", esc(p.updated)]
      ],
      // Sections lock to what the client actually saw once sent (PRD 3.5);
      // beforehand this is just the live draft, which is the whole point —
      // The Optimist can hand someone a working copy mid-conversation.
      sections: p.sentSections || p.sections,
      signatureRight: p.client
    };
  }
  return null;
}

/* Plain system fonts rather than the portal's Google Fonts (Playfair/Inter) —
   pulling web fonts into a headless-Chromium render adds a network hop the
   Lambda doesn't need and a failure mode (font CDN down) it shouldn't have. */
function renderHtml(docModel) {
  const sections = Object.entries(SECTION_LABELS)
    .filter(([k]) => (docModel.sections?.[k] || "").trim())
    .map(([k, label]) => `<h2>${label}</h2><div class="sec">${esc(docModel.sections[k])}</div>`).join("");
  const metaRows = docModel.meta.map(([k, v]) => `<tr><td class="k">${esc(k)}</td><td>${v}</td></tr>`).join("");
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>
    * { box-sizing: border-box; margin: 0; }
    body { font: 12px/1.6 Helvetica, Arial, sans-serif; color: #1d1a16; padding: 0 8mm; }
    .brand { font-weight: 700; font-size: 11px; letter-spacing: .12em; color: #3D2FD4; margin: 20px 0 16px; }
    h1 { font-size: 24px; margin-bottom: 4px; }
    .meta { color: #6b655d; font-size: 11px; margin-bottom: 6px; }
    .meta b { color: #1d1a16; }
    table.info { width: 100%; border-collapse: collapse; margin: 18px 0 24px; }
    table.info td { padding: 8px 10px; border: 1px solid #e5e0d8; font-size: 11.5px; }
    table.info td.k { color: #6b655d; width: 32%; background: #f8f6f2; }
    h2 { font-size: 11px; letter-spacing: .08em; text-transform: uppercase; color: #3D2FD4; margin: 20px 0 6px; }
    .sec { white-space: pre-wrap; font-size: 12px; }
    .sign { margin-top: 46px; display: flex; gap: 40px; page-break-inside: avoid; }
    .sign div { flex: 1; }
    .line { border-top: 1px solid #1d1a16; margin-top: 40px; padding-top: 6px; font-size: 11px; color: #6b655d; }
    .foot { margin-top: 30px; font-size: 10px; color: #9E9589; border-top: 1px solid #e5e0d8; padding-top: 10px; }
  </style></head><body>
    <div class="brand">OPTIMISTIC LABS</div>
    <h1>${docModel.title}</h1>
    <div class="meta">${docModel.refLine}</div>
    <table class="info">${metaRows}</table>
    ${sections || "<p>No sections on file yet.</p>"}
    <div class="sign">
      <div><div class="line">Optimistic Labs, authorized representative &mdash; date</div></div>
      <div><div class="line">${esc(docModel.signatureRight)} &mdash; date</div></div>
    </div>
    <div class="foot">Generated by the Optimistic Labs Portal on ${new Date().toISOString().slice(0, 10)}. ${esc(docModel.record.sk)}.</div>
  </body></html>`;
}

export const handler = async event => {
  let browser;
  try {
    const { username, role } = identity(event);
    if (!username || !role) return resp(403, { error: "No portal role on this account" });
    const me = await get("PERSON", username);
    if (!me) return resp(403, { error: "No portal profile for this user" });

    const seg = event.rawPath.replace(/\/+$/, "").split("/").filter(Boolean);
    const kind = seg[0]; // "contracts" | "proposals"
    const id = seg[1];
    if (kind !== "contracts" && kind !== "proposals") return resp(404, { error: "no such route" });

    const docModel = await loadDocument(kind, id);
    if (!docModel) return resp(404, { error: `${kind === "proposals" ? "proposal" : "contract"} not found` });

    // Contracts are admin-only (mutation already is, in contracts.mjs).
    // Proposals follow the same rule as editing one: Admin, or the Lab
    // Leader who owns that lab — matches ctx.can.editProposal in app.mjs.
    const allowed = role === "Admin" ||
      (kind === "proposals" && role === "Lab Leader" && (me.labs || []).includes(docModel.lab));
    if (!allowed) return resp(403, { error: "Generating this PDF isn't allowed for your role" });

    // @sparticuz/chromium@143 dropped the defaultViewport/headless getters
    // (chromium.args already bakes in --headless='shell'); set the viewport
    // explicitly to preserve prior rendering dimensions.
    browser = await puppeteer.launch({
      args: chromium.args,
      defaultViewport: { width: 1920, height: 1080 },
      executablePath: await chromium.executablePath(),
      headless: true
    });
    const page = await browser.newPage();
    await page.setContent(renderHtml(docModel));
    const pdf = await page.pdf({ format: "letter", printBackground: true, margin: { top: "18mm", bottom: "16mm" } });
    await browser.close();
    browser = null;

    const name = `${id} - ${docModel.record.client} - ${docModel.kindLabel}.pdf`;
    const key = `${kind}/${id}/${name.replace(/[^\w.\- ]/g, "_")}`;
    await s3.send(new PutObjectCommand({
      Bucket: FILES_BUCKET, Key: key, Body: pdf, ContentType: "application/pdf"
    }));

    // Deterministic per document: regenerating overwrites the same FILE
    // record + S3 key instead of piling up duplicates in the Files list.
    const fileId = docModel.record.pdfFileId || `F-PDF-${id}`;
    const fileRecord = {
      pk: "FILE", sk: fileId, name, key, size: pdf.length, type: "application/pdf",
      lab: docModel.lab, [kind === "proposals" ? "proposal" : "contract"]: id,
      ...(kind === "contracts" && docModel.record.contributorEmail ? { contributorEmail: docModel.record.contributorEmail } : {}),
      uploader: me.sk, date: new Date().toISOString(), status: "Stored"
    };
    await doc.send(new PutCommand({ TableName: TABLE, Item: fileRecord }));
    await doc.send(new PutCommand({
      TableName: TABLE, Item: { ...docModel.record, pdfFileId: fileId, pdfGeneratedAt: new Date().toISOString() }
    }));

    return resp(200, { fileId, id, kind });
  } catch (err) {
    if (browser) await browser.close().catch(() => {});
    console.error(JSON.stringify({ level: "error", message: "document PDF generation failed", detail: err.message, stack: err.stack }));
    return resp(500, { error: "PDF generation failed" });
  }
};
