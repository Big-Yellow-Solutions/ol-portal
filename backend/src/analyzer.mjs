/* OL Portal file analyzer — fires on S3 upload.
   Reads the file, has Claude analyze the content, and writes the result
   onto the FILE record so every page of the portal can show it. */

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { SSMClient, GetParameterCommand } from "@aws-sdk/client-ssm";
import Anthropic from "@anthropic-ai/sdk";

const TABLE = process.env.TABLE_NAME;
const doc = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true }
});
const s3 = new S3Client({});
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

const IMAGE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"];
const TEXT_TYPES = ["text/plain", "text/markdown", "text/csv", "application/json", "text/html"];
const MAX_ANALYZE_BYTES = 10 * 1024 * 1024;

const ANALYSIS_SCHEMA = {
  type: "object",
  properties: {
    docType: { type: "string", description: "Short label, e.g. Proposal, Contract, Invoice, Report, Spreadsheet export, Meeting notes" },
    summary: { type: "string", description: "2-3 sentence summary of what this document is and what it says" },
    keyPoints: { type: "array", items: { type: "string" }, description: "3-6 key facts: amounts, dates, parties, decisions, action items" }
  },
  required: ["docType", "summary", "keyPoints"],
  additionalProperties: false
};

function contentBlock(mime, bytes) {
  if (mime === "application/pdf") {
    return { type: "document", source: { type: "base64", media_type: "application/pdf", data: bytes.toString("base64") } };
  }
  if (IMAGE_TYPES.includes(mime)) {
    return { type: "image", source: { type: "base64", media_type: mime, data: bytes.toString("base64") } };
  }
  if (TEXT_TYPES.includes(mime) || mime.startsWith("text/")) {
    return { type: "text", text: "File contents:\n\n" + bytes.toString("utf8").slice(0, 200_000) };
  }
  return null;
}

async function setStatus(id, fields) {
  const names = {}, values = {}, sets = [];
  for (const [k, v] of Object.entries(fields)) {
    names["#" + k] = k; values[":" + k] = v; sets.push(`#${k} = :${k}`);
  }
  await doc.send(new UpdateCommand({
    TableName: TABLE, Key: { pk: "FILE", sk: id },
    UpdateExpression: "SET " + sets.join(", "),
    ExpressionAttributeNames: names, ExpressionAttributeValues: values
  }));
}

export const handler = async event => {
  for (const rec of event.Records || []) {
    const bucket = rec.s3.bucket.name;
    const key = decodeURIComponent(rec.s3.object.key.replace(/\+/g, " "));
    const id = key.split("/")[1];
    if (!id) continue;

    const file = (await doc.send(new GetCommand({ TableName: TABLE, Key: { pk: "FILE", sk: id } }))).Item;
    if (!file) { console.error(JSON.stringify({ level: "error", message: "no FILE record for " + key })); continue; }

    try {
      if (rec.s3.object.size > MAX_ANALYZE_BYTES) {
        await setStatus(id, { status: "Stored", analysis: { docType: "File", summary: "Too large for automatic analysis (over 10 MB). Stored and available for download.", keyPoints: [] } });
        continue;
      }
      const obj = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
      const bytes = Buffer.from(await obj.Body.transformToByteArray());
      const b = contentBlock(file.type || "", bytes);
      if (!b) {
        await setStatus(id, { status: "Stored", analysis: { docType: "File", summary: `Stored. Automatic analysis doesn't support ${file.type || "this file type"} yet — download to view.`, keyPoints: [] } });
        continue;
      }

      await setStatus(id, { status: "Analyzing" });
      const c = await client();
      const response = await c.messages.create({
        model: "claude-opus-4-8",
        max_tokens: 8192,
        thinking: { type: "adaptive" },
        system: "You analyze business documents for Optimistic Labs' internal portal (a consultancy running deals, proposals, and invoices across several practice labs). Be factual and specific; pull real names, amounts, and dates from the document.",
        output_config: { format: { type: "json_schema", schema: ANALYSIS_SCHEMA } },
        messages: [{
          role: "user",
          content: [
            b,
            { type: "text", text: `Analyze this file (filename: ${file.name}). Classify it, summarize it, and extract the key points.` }
          ]
        }]
      });
      if (response.stop_reason === "refusal") {
        await setStatus(id, { status: "Stored", analysis: { docType: "File", summary: "Stored. Automatic analysis was declined for this document.", keyPoints: [] } });
        continue;
      }
      const text = response.content.find(x => x.type === "text")?.text || "{}";
      await setStatus(id, { status: "Analyzed", analysis: JSON.parse(text) });
    } catch (err) {
      console.error(JSON.stringify({ level: "error", file: id, message: err.message, stack: err.stack }));
      await setStatus(id, { status: "Analysis failed", analysis: { docType: "File", summary: "Automatic analysis failed: " + err.message, keyPoints: [] } }).catch(() => {});
    }
  }
};
