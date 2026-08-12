/* OL Portal · document PDF generator — contracts (PRD 3.6 follow-on) and
   proposal drafts (so The Optimist can hand someone a PDF mid-conversation,
   before a contract exists). Isolated from the shared src/ bundle (own
   CodeUri in template.yaml) because puppeteer-core + @sparticuz/chromium are
   large — bundling them alongside app.mjs would bloat cold starts for every
   route, including the Cognito PostAuthentication trigger that runs
   synchronously on every login.

   Two entry paths: an authenticated HTTP request (a person pressing Download),
   and a direct Lambda invoke from signing.mjs when a contract is fully executed
   (Base Contract PRD FR15). The direct path is IAM-gated and carries no JWT.

   A fully executed contract renders differently from a draft: it prints the
   frozen execution copy rather than the live record, shows the actual
   signatures, and appends a signature audit certificate — the ESIGN/UETA
   evidence page, with the document hash, both signers' identity and method,
   timestamps, IP addresses and the consent language each of them affirmed. */

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
const fullName = p => [p?.firstName, p?.lastName].filter(Boolean).join(" ").trim();

/* Deliberate duplication of the three pricing helpers from ../pricing.mjs.
   This function has its own CodeUri, so sam build never copies the sibling
   module in; importing across that boundary would break the deploy. Keep these
   in step with pricing.mjs — they must agree on what a pricing object means. */
const money = v => Math.round(Number(v) * 100) / 100;
function pricingTotal(p) {
  if (!p) return null;
  if (p.kind === "flat") return p.amount;
  if (p.kind === "tiered") return p.tiers?.find(t => t.id === p.selected)?.amount ?? null;
  if (p.kind === "itemized")
    return money((p.items || []).reduce((s, i) => s + i.qty * i.rate, 0) - (p.discount || 0));
  return null;
}
function pricingLines(p) {
  if (!p) return [];
  if (p.kind === "flat") return [{ label: p.label || "Project fee", amount: p.amount }];
  if (p.kind === "tiered")
    return (p.tiers || []).map(t => ({
      label: t.name, amount: t.amount, detail: t.summary,
      recommended: t.recommended, selected: t.id === p.selected
    }));
  const rows = (p.items || []).map(i => ({
    label: i.description, amount: money(i.qty * i.rate),
    detail: i.qty === 1 ? null : `${i.qty} × $${i.rate.toLocaleString("en-US")}`
  }));
  if (p.discount) rows.push({ label: "Discount", amount: -p.discount });
  return rows;
}

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
    const executed = c.status === "Signed" && !!c.signatures?.ol;
    // Once executed, the frozen copy is the document — the live record is only
    // metadata at that point, and printing it could contradict what was signed.
    const source = executed && c.executionCopy ? c.executionCopy : c;
    const total = pricingTotal(source.pricing);
    return {
      record: c, lab: c.lab, kindLabel: executed ? "Executed Contract" : "Contract",
      title: executed ? "Services Agreement (executed)" : "Services Agreement",
      refLine: `${esc(c.sk)} &middot; prepared for <b>${esc(c.client)}</b>`,
      meta: [
        ["Lab", esc(lab?.name || c.lab)],
        ["Lab Leader", esc(fullName(owner) || c.owner || "—")],
        ["Contract value", total === null ? fmt$(c.amount) : fmt$(total)],
        ["Status", esc(c.status) + (c.executedAt ? " &middot; executed " + esc(c.executedAt.slice(0, 10)) : "")],
        ...(source.paymentSchedule ? [["Payment schedule", esc(source.paymentSchedule)]] : []),
        ...(source.startDate || source.endDate
          ? [["Term", `${esc(source.startDate || "—")} to ${esc(source.endDate || "—")}`]] : []),
        ...(c.inherited?.version
          ? [["Approved proposal", `${esc(c.proposal || "—")} v${esc(c.inherited.version)}`]] : []),
        ...(c.contributorName || c.contributorEmail
          ? [["Contributor", esc(c.contributorName || "—") + (c.contributorEmail ? " &middot; " + esc(c.contributorEmail) : "")]]
          : []),
        ["Created", esc(c.created)]
      ],
      sections: source.sections,
      pricing: source.pricing,
      clauses: source.clauses || [],
      deviations: deviationNotes(c),
      signatures: executed ? c.signatures : null,
      documentHash: c.documentHash,
      olSignatoryName: c.olSignatoryName,
      signatureRight: source.clientSignerName || c.client
    };
  }
  if (kind === "proposals") {
    const p = await get("PROPOSAL", id);
    if (!p) return null;
    const deal = p.deal ? await get("DEAL", p.deal) : null;
    const [lab, owner] = await Promise.all([get("LAB", p.lab), deal ? get("PERSON", deal.owner) : null]);
    const pricing = p.sentPricing ?? p.pricing ?? null;
    const total = pricingTotal(pricing);
    return {
      record: p, lab: p.lab, kindLabel: "Proposal",
      title: `Proposal &middot; ${esc(p.title)}`,
      refLine: `${esc(p.sk)} &middot; prepared for <b>${esc(p.client)}</b> &middot; version ${esc(p.version)}`,
      meta: [
        ["Lab", esc(lab?.name || p.lab)],
        ["Lab Leader", esc(fullName(owner) || deal?.owner || "—")],
        [total === null ? "Deal value" : "Proposal value", total === null ? fmt$(deal?.amount) : fmt$(total)],
        ["Status", esc(p.status)],
        ...(p.sentAt ? [["Sent to client", esc(p.sentAt.slice(0, 10)) + ` (v${esc(p.sentVersion)})`]] : []),
        ["Updated", esc(p.updated)]
      ],
      // Sections lock to what the client actually saw once sent (PRD 3.5);
      // beforehand this is just the live draft, which is the whole point —
      // The Optimist can hand someone a working copy mid-conversation.
      sections: p.sentSections || p.sections,
      pricing,
      clauses: [],
      deviations: [],
      signatures: null,
      signatureRight: p.client
    };
  }
  return null;
}

/* Mirrors contracts.mjs deviationsOf(), reduced to what the PDF needs to print:
   a contract that departs from the approved proposal says so on its face. */
function deviationNotes(c) {
  if (!c?.inherited || !Array.isArray(c.deviationLog)) return [];
  // The log is append-only, so a field edited, reverted and edited again has
  // several entries. The contract's face should state each departure once,
  // with the most recent explanation; the full history stays on the record.
  const latest = new Map();
  for (const d of c.deviationLog) latest.set(d.field, d);
  return [...latest.values()].map(d => ({ summary: d.summary, note: d.note, at: d.at }));
}

/* `withHeading: false` when the caller has already written the Pricing heading
   above the prose that introduces the table. */
function pricingTable(pricing, withHeading = true) {
  const rows = pricingLines(pricing);
  if (!rows.length) return "";
  const total = pricingTotal(pricing);
  const body = rows.map(r => `<tr>
      <td>${esc(r.label)}${r.recommended ? ' <span class="tag">recommended</span>' : ""}${r.selected ? ' <span class="tag sel">selected</span>' : ""}
        ${r.detail ? `<div class="sub">${esc(r.detail)}</div>` : ""}</td>
      <td class="amt">${fmt$(r.amount)}</td>
    </tr>`).join("");
  const foot = total === null
    ? `<tr class="tot"><td>Total</td><td class="amt">Pending package selection</td></tr>`
    : `<tr class="tot"><td>Total</td><td class="amt">${fmt$(total)}</td></tr>`;
  const note = pricing?.notes ? `<div class="sub" style="margin-top:6px">${esc(pricing.notes)}</div>` : "";
  return `${withHeading ? "<h2>Pricing</h2>" : ""}<table class="price">${body}${foot}</table>${note}`;
}

function signatureBlock(sig, fallbackLabel) {
  if (!sig) return `<div class="line">${esc(fallbackLabel)} &mdash; date</div>`;
  const mark = sig.signatureType === "drawn" && sig.signatureImage
    ? `<img class="sigimg" src="${sig.signatureImage}" alt="signature">`
    : `<div class="sigtyped">${esc(sig.name)}</div>`;
  return `${mark}<div class="line">${esc(sig.name)}${sig.title ? ", " + esc(sig.title) : ""}
    <br>${esc(String(sig.at).replace("T", " ").slice(0, 16))} UTC</div>`;
}

/* The ESIGN/UETA evidence page. Printed only for fully executed contracts. */
function certificatePage(d) {
  if (!d.signatures?.client || !d.signatures?.ol) return "";
  const row = (label, sig) => `
    <table class="info cert">
      <tr><td class="k">Party</td><td>${esc(label)}</td></tr>
      <tr><td class="k">Name</td><td>${esc(sig.name)}${sig.title ? ", " + esc(sig.title) : ""}</td></tr>
      ${sig.email ? `<tr><td class="k">Email</td><td>${esc(sig.email)}</td></tr>` : ""}
      <tr><td class="k">Signed at</td><td>${esc(sig.at)} (UTC)</td></tr>
      <tr><td class="k">Method</td><td>${esc(sig.signatureType === "drawn" ? "Drawn signature" : "Typed signature")}</td></tr>
      <tr><td class="k">IP address</td><td>${esc(sig.ip || "not recorded")}</td></tr>
      <tr><td class="k">Device</td><td>${esc(sig.userAgent || "not recorded")}</td></tr>
      ${sig.verifiedAccount ? `<tr><td class="k">Authenticated account</td><td>${esc(sig.verifiedAccount)} (signed in to the OL Portal)</td></tr>` : ""}
      <tr><td class="k">Consent</td><td>${esc(sig.consentText || "Affirmed at signing")}</td></tr>
    </table>`;
  return `<div class="pagebreak"></div>
    <div class="brand">OPTIMISTIC LABS</div>
    <h1>Signature audit certificate</h1>
    <div class="meta">${esc(d.record.sk)} &middot; ${esc(d.record.client)}</div>
    <p class="sub" style="margin:14px 0">This certificate records the electronic signatures applied to this
    agreement. Each signer affirmed their consent to sign electronically and their intent to be bound, as
    required by the U.S. ESIGN Act and the Uniform Electronic Transactions Act.</p>
    <table class="info cert">
      <tr><td class="k">Document</td><td>${esc(d.record.sk)} &middot; ${esc(d.title.replace(/ \(executed\)$/, ""))}</td></tr>
      <tr><td class="k">Document fingerprint</td><td class="mono">SHA-256 ${esc(d.documentHash || "not recorded")}</td></tr>
      <tr><td class="k">Fully executed</td><td>${esc(d.record.executedAt || "—")} (UTC)</td></tr>
    </table>
    ${row(d.record.client, d.signatures.client)}
    ${row("Optimistic Labs", d.signatures.ol)}
    <div class="foot">The fingerprint above is a SHA-256 hash of the exact agreement presented to both signers.
    Any change to the agreement text, pricing or terms produces a different fingerprint, so this value can be
    used to confirm that this copy is the one that was signed.</div>`;
}

/* Plain system fonts rather than the portal's Google Fonts (Playfair/Inter) —
   pulling web fonts into a headless-Chromium render adds a network hop the
   Lambda doesn't need and a failure mode (font CDN down) it shouldn't have. */
function renderHtml(d) {
  const sections = Object.entries(SECTION_LABELS)
    // Pricing prose is replaced by the structured table below, so it isn't
    // printed twice.
    .filter(([k]) => k !== "pricing" && (d.sections?.[k] || "").trim())
    .map(([k, label]) => `<h2>${label}</h2><div class="sec">${esc(d.sections[k])}</div>`).join("");
  const metaRows = d.meta.map(([k, v]) => `<tr><td class="k">${esc(k)}</td><td>${v}</td></tr>`).join("");
  const prosePricing = (d.sections?.pricing || "").trim()
    ? `<div class="sec" style="margin-top:8px">${esc(d.sections.pricing)}</div>` : "";
  const clauses = (d.clauses || []).length
    ? `<h2>Terms and conditions</h2>` + d.clauses.map(c =>
      `${c.heading ? `<h3>${esc(c.heading)}</h3>` : ""}<div class="sec">${esc(c.text)}</div>`).join("")
    : "";
  const deviations = (d.deviations || []).length
    ? `<div class="dev"><b>Departures from the approved proposal</b><ul>${d.deviations.map(x =>
      `<li>${esc(x.summary)}${x.note ? ` &mdash; ${esc(x.note)}` : ""}</li>`).join("")}</ul></div>`
    : "";

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
    table.cert { margin: 12px 0; page-break-inside: avoid; }
    h2 { font-size: 11px; letter-spacing: .08em; text-transform: uppercase; color: #3D2FD4; margin: 20px 0 6px; }
    h3 { font-size: 12px; margin: 14px 0 2px; }
    .sec { white-space: pre-wrap; font-size: 12px; }
    .sub { color: #6b655d; font-size: 10.5px; }
    .mono { font-family: "SFMono-Regular", Consolas, monospace; font-size: 10px; word-break: break-all; }
    table.price { width: 100%; border-collapse: collapse; margin-top: 6px; }
    table.price td { padding: 7px 10px; border-bottom: 1px solid #e5e0d8; font-size: 11.5px; vertical-align: top; }
    table.price td.amt { text-align: right; white-space: nowrap; width: 30%; }
    table.price tr.tot td { border-top: 2px solid #1d1a16; border-bottom: none; font-weight: 700; }
    .tag { font-size: 9px; letter-spacing: .06em; text-transform: uppercase; color: #3D2FD4;
           border: 1px solid #3D2FD4; border-radius: 3px; padding: 1px 4px; }
    .tag.sel { color: #1a7f46; border-color: #1a7f46; }
    .dev { margin-top: 18px; border-left: 3px solid #C08A2E; background: #fdf7ec; padding: 10px 12px; font-size: 11px; }
    .dev ul { margin: 6px 0 0 16px; }
    .sign { margin-top: 46px; display: flex; gap: 40px; page-break-inside: avoid; }
    .sign div.col { flex: 1; }
    .line { border-top: 1px solid #1d1a16; margin-top: 6px; padding-top: 6px; font-size: 11px; color: #6b655d; }
    .sigtyped { font-family: "Snell Roundhand", "Apple Chancery", cursive; font-size: 22px; height: 40px;
                display: flex; align-items: flex-end; }
    .sigimg { height: 40px; display: block; }
    .blank { height: 40px; }
    .pagebreak { page-break-before: always; }
    .foot { margin-top: 30px; font-size: 10px; color: #9E9589; border-top: 1px solid #e5e0d8; padding-top: 10px; }
  </style></head><body>
    <div class="brand">OPTIMISTIC LABS</div>
    <h1>${d.title}</h1>
    <div class="meta">${d.refLine}</div>
    <table class="info">${metaRows}</table>
    ${sections || (d.clauses || []).length ? "" : "<p>No sections on file yet.</p>"}
    ${sections}
    ${prosePricing
      ? `<h2>Pricing</h2>${prosePricing}${pricingTable(d.pricing, false)}`
      : pricingTable(d.pricing)}
    ${clauses}
    ${deviations}
    <div class="sign">
      <div class="col">
        ${d.signatures?.ol ? "" : '<div class="blank"></div>'}
        ${signatureBlock(d.signatures?.ol, `Optimistic Labs${d.olSignatoryName ? " · " + d.olSignatoryName : ""}, authorized representative`)}
      </div>
      <div class="col">
        ${d.signatures?.client ? "" : '<div class="blank"></div>'}
        ${signatureBlock(d.signatures?.client, d.signatureRight)}
      </div>
    </div>
    <div class="foot">Generated by the Optimistic Labs Portal on ${new Date().toISOString().slice(0, 10)}. ${esc(d.record.sk)}.</div>
    ${certificatePage(d)}
  </body></html>`;
}

export const handler = async event => {
  let browser;
  try {
    /* Direct invoke from signing.mjs on full execution (FR15). API Gateway
       events always carry requestContext, so an HTTP caller can't reach this
       branch by putting `direct` in a request body. */
    const isDirect = event?.direct === true && !event.requestContext;

    let kind, id, actorKey;
    if (isDirect) {
      kind = event.kind;
      id = event.id;
      actorKey = event.actor;
    } else {
      const { username, role } = identity(event);
      if (!username || !role) return resp(403, { error: "No portal role on this account" });
      const me = await get("PERSON", username);
      if (!me) return resp(403, { error: "No portal profile for this user" });
      const seg = event.rawPath.replace(/\/+$/, "").split("/").filter(Boolean);
      kind = seg[0];   // "contracts" | "proposals"
      id = seg[1];
      actorKey = me.sk;

      if (kind !== "contracts" && kind !== "proposals") return resp(404, { error: "no such route" });
      const preview = await loadDocument(kind, id);
      if (!preview) return resp(404, { error: `${kind === "proposals" ? "proposal" : "contract"} not found` });
      // Contracts and proposals follow the same rule as editing one: Admin, or
      // the Lab Leader who owns that lab — matches ctx.can in app.mjs. A
      // Contributor named on a contract gets their own copy.
      const allowed = role === "Admin" ||
        (role === "Lab Leader" && ((me.labs || []).includes(preview.lab) || preview.record.owner === me.sk)) ||
        (role === "Contributor" && kind === "contracts" &&
          (preview.record.contributorEmail || "").toLowerCase() === (me.email || "").toLowerCase());
      if (!allowed) return resp(403, { error: "Generating this PDF isn't allowed for your role" });
    }

    if (kind !== "contracts" && kind !== "proposals") return resp(404, { error: "no such route" });
    const docModel = await loadDocument(kind, id);
    if (!docModel) return resp(404, { error: `${kind === "proposals" ? "proposal" : "contract"} not found` });

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

    /* Deterministic per document: regenerating overwrites the same FILE record
       + S3 key instead of piling up duplicates in the Files list. The executed
       copy gets its own id so a later regeneration of the draft can never
       overwrite the signed one. */
    const executed = !!docModel.signatures?.ol;
    const fileId = executed
      ? `F-PDF-${id}-EXECUTED`
      : (docModel.record.pdfFileId || `F-PDF-${id}`);
    const fileRecord = {
      pk: "FILE", sk: fileId, name, key, size: pdf.length, type: "application/pdf",
      lab: docModel.lab, [kind === "proposals" ? "proposal" : "contract"]: id,
      ...(kind === "contracts" && docModel.record.contributorEmail ? { contributorEmail: docModel.record.contributorEmail } : {}),
      uploader: actorKey || "system", date: new Date().toISOString(), status: "Stored"
    };
    await doc.send(new PutCommand({ TableName: TABLE, Item: fileRecord }));
    // Re-read before writing back: signing.mjs may have touched the record
    // between load and now, and this write must not clobber a signature.
    const fresh = await get(kind === "proposals" ? "PROPOSAL" : "CONTRACT", id);
    await doc.send(new PutCommand({
      TableName: TABLE,
      Item: {
        ...(fresh || docModel.record),
        ...(executed ? { executedFileId: fileId } : { pdfFileId: fileId }),
        pdfGeneratedAt: new Date().toISOString()
      }
    }));

    return resp(200, { fileId, id, kind });
  } catch (err) {
    if (browser) await browser.close().catch(() => {});
    console.error(JSON.stringify({ level: "error", message: "document PDF generation failed", detail: err.message, stack: err.stack }));
    return resp(500, { error: "PDF generation failed" });
  }
};
