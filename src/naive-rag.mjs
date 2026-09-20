import { pathToFileURL } from "node:url";
import { START, END, StateGraph } from "@langchain/langgraph";
import { CONFIG } from "./common/config.mjs";
import { makeChatModel } from "./common/llm.mjs";
import { defineGraphState, V1_FIELDS } from "./common/state.mjs";
import { GEN_NOVEL_PROMPT, formatDocContext } from "./common/prompts.mjs";
import { getVectorStore, semanticSearch } from "./common/vector-store.mjs";
import { logBanner, logDocs, logStream } from "./common/logger.mjs";

const model = makeChatModel();
const GraphState = defineGraphState(V1_FIELDS);

const retrieveNode = async (state) => {
  logBanner("___RETRIEVE___");
  const documents = await semanticSearch(state.question, state.k);
  logDocs(documents, { title: `命中 ${documents.length} 条片段：` });
  return { question: state.question, k: state.k, documents };
};

const generateNode = async (state) => {
  logBanner("___GENERATE___");
  const context = formatDocContext(state.documents);
  const prompt = GEN_NOVEL_PROMPT({ context, question: state.question });
  const generation = await logStream(model.stream(prompt));
  return { question: state.question, k: state.k, documents: state.documents, generation };
};

// v1：固定流水线，0 条条件边 —— 教科书式 RAG 的起点
const graph = new StateGraph(GraphState)
  .addNode("retrieve", retrieveNode)
  .addNode("generate", generateNode)
  .addEdge(START, "retrieve")
  .addEdge("retrieve", "generate")
  .addEdge("generate", END)
  .compile();

export { graph };

async function main() {
  const question = "阿朱的结局是什么？";
  const k = CONFIG.TOP_K;

  const drawable = await graph.getGraphAsync();
  console.log(drawable.drawMermaid({ withStyles: true }));

  console.log("=".repeat(80));
  console.log(`问题：${question}`);
  console.log("=".repeat(80));

  logBanner("连接 Milvus...");
  await getVectorStore();
  console.log("已连接");

  const result = await graph.invoke({ question, k, documents: [], generation: "" });

  if (!result.documents.length) {
    console.log("未找到相关内容");
  }
  if (!result.generation) {
    console.log("模型未返回内容。");
  }
}

const isMain = import.meta.url === pathToFileURL(process.argv[1] ?? "").href;
if (isMain) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
