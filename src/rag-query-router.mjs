import { pathToFileURL } from "node:url";
import { START, END, StateGraph } from "@langchain/langgraph";
import { CONFIG } from "./common/config.mjs";
import { makeChatModel } from "./common/llm.mjs";
import { defineGraphState, V2_FIELDS } from "./common/state.mjs";
import { RouteSchema } from "./common/schemas.mjs";
import { ROUTE_PROMPT, DIRECT_PROMPT, GEN_NOVEL_PROMPT, formatDocContext } from "./common/prompts.mjs";
import { getVectorStore, semanticSearch } from "./common/vector-store.mjs";
import { logBanner, logDecision, logDocs, logStream } from "./common/logger.mjs";

const model = makeChatModel();
const GraphState = defineGraphState(V2_FIELDS);

const routeQuestionNode = async (state) => {
  logBanner("___ROUTE-QUESTION___");
  // 结构化输出：zod 约束在解码层，不靠模型自觉
  const router = model.withStructuredOutput(RouteSchema);
  const route = await router.invoke(ROUTE_PROMPT(state.question));
  logDecision({ final: route.strategy, model: route.strategy, reason: route.reason });
  return {
    question: state.question,
    k: state.k,
    strategy: route.strategy,
    routeReason: route.reason,
  };
};

const directAnswerNode = async (state) => {
  logBanner("----DIRECT_ANSWER----");
  const generation = await logStream(model.stream(DIRECT_PROMPT(state.question)));
  return { question: state.question, k: state.k, documents: [], generation };
};

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

// 条件边读 state：决策节点写 strategy，条件边消费 strategy
const afterRoute = (state) => (state.strategy === "simple" ? "direct_answer" : "retrieve");

// v2：+复杂度路由，简单问题不再走检索白烧 token
const graph = new StateGraph(GraphState)
  .addNode("route_question", routeQuestionNode)
  .addNode("direct_answer", directAnswerNode)
  .addNode("retrieve", retrieveNode)
  .addNode("rag_generate", generateNode)
  .addEdge(START, "route_question")
  .addConditionalEdges("route_question", afterRoute, {
    direct_answer: "direct_answer",
    retrieve: "retrieve",
  })
  .addEdge("retrieve", "rag_generate")
  .addEdge("direct_answer", END)
  .addEdge("rag_generate", END)
  .compile();

export { graph };

async function main() {
  const question = "阿朱是怎么死的？";
  const k = CONFIG.TOP_K;

  const drawable = await graph.getGraphAsync();
  console.log(drawable.drawMermaid({ withStyles: true }));

  console.log("=".repeat(80));
  console.log(`问题：${question}`);
  console.log("=".repeat(80));

  logBanner("连接 Milvus...");
  await getVectorStore();
  console.log("已连接");

  const result = await graph.invoke({
    question,
    k,
    strategy: "",
    routeReason: "",
    documents: [],
    generation: "",
  });

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
