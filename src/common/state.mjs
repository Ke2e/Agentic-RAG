import { Annotation } from "@langchain/langgraph";

// 无 reducer 字段为 last-write-wins：节点返回部分字段即可，
// 但 documents 这类累积字段必须由节点整组返回（先合并再覆盖）。
export function defineGraphState(fields) {
  return Annotation.Root(Object.fromEntries(fields.map((name) => [name, Annotation])));
}

export const V1_FIELDS = ["question", "k", "documents", "generation"];

export const V2_FIELDS = [...V1_FIELDS, "strategy", "routeReason"];

export const V3_FIELDS = [
  ...V2_FIELDS,
  "subQuestions",
  "nextSubIdx",
  "currentQuery",
  "retrievalCount",
  "maxRetrievals",
  "plannedNext",
];

export const V4_FIELDS = [
  "question",
  "k",
  "strategy",
  "routeReason",
  "retrievedDocs",
  "localContext",
  "webContext",
  "evaluation",
  "generation",
];

export const V5_FIELDS = [
  "question",
  "k",
  "strategy",
  "routeReason",
  "subQuestions",
  "nextSubIdx",
  "currentQuery",
  "retrievalCount",
  "maxRetrievals",
  "plannedNext",
  "documents",
  "webContext",
  "webSearched",
  "evaluation",
  "generation",
];
