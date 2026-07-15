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

export async function nextId(pk, prefix) {
  const items = await listType(pk);
  const max = items.reduce((m, x) => Math.max(m, parseInt(x.sk.replace(/\D/g, ""), 10) || 0), 0);
  return prefix + String(max + 1).padStart(3, "0");
}
