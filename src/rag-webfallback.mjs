import { pathToFileURL } from "node:url";
import { START, END, StateGraph } from "@langchain/langgraph";
import { CONFIG } from "./common/config.mjs";
import { makeChatModel } from "./common/llm.mjs";
import { defineGraphState, V4_FIELDS } from "./common/state.mjs";
import { RouteSchema, EvaluateSchema } from "./common/schemas.mjs";
import { ROUTE_PROMPT, DIRECT_PROMPT, EVALUATE_PROMPT, GEN_STRICT_PROMPT } from "./common/prompts.mjs";
import { getVectorStore, semanticSearch } from "./common/vector-store.mjs";
import { bochaWebSearch } from "./common/web-search.mjs";
import { logBanner, logDecision, logStream } from "./common/logger.mjs";

const llm = makeChatModel();
const GraphState = defineGraphState(V4_FIELDS);

const routeQuestionNode = async (state) => {
  logBanner("___ROUTE-QUESTION___");
  const router = llm.withStructuredOutput(RouteSchema);
  const route = await router.invoke(ROUTE_PROMPT(state.question));
  logDecision({ final: route.strategy, model: route.strategy, reason: route.reason });
  return {
    question: state.question,
    k: state.k,
    strategy: route.strategy,
    routeReason: route.reason,
    retrievedDocs: [],
    localContext: "",
    webContext: "",
    evaluation: null,
    generation: "",
  };
};

const directAnswerNode = async (state) => {
  logBanner("----DIRECT_ANSWER----");
  const generation = await logStream(llm.stream(DIRECT_PROMPT(state.question)));
  return { generation };
};

const retrieveLocalNode = async (state) => {
  logBanner("---LOCAL_RETRIEVE---");
  // 修复：原课程节点返回 retrieveDocs 而 state 声明的是 retrievedDocs（少一个 d），
  // 字段永远落在 state 之外——统一为 retrievedDocs
  const retrievedDocs = await semanticSearch(state.question, state.k);
  console.log(`本地检索命中 ${retrievedDocs.length} 条`);
  const localContext = retrievedDocs.map((d) => d.content).join("\n\n");
  return { retrievedDocs, localContext };
};

const evaluateNode = async (state) => {
  const hasWeb = Boolean(state.webContext && String(state.webContext).trim());
  logBanner(hasWeb ? "---EVALUATE_CONTEXT_WITH_WEB---" : "---EVALUATE_LOCAL_CONTEXT---");

  const evaluator = llm.withStructuredOutput(EvaluateSchema);
  const out = await evaluator.invoke(
    EVALUATE_PROMPT({
      question: state.question,
      localContext: state.localContext,
      hasWeb,
      webContext: state.webContext,
    })
  );

  console.log(`${hasWeb ? "二次评估" : "评估"}: enough=${out.enough} (${out.reason})`);
  if (!out.enough && out.missing?.length) {
    out.missing.forEach((m, i) => console.log(`缺失 ${i + 1}: ${m}`));
  }
  // 修复：原课程把 evaluation JSON.stringify 存字符串再 parse 取回，这里直存对象
  return { evaluation: out };
};

const generateNode = async (state) => {
  logBanner("---GENERATE---");
  const context = [state.localContext, state.webContext].filter(Boolean).join("\n\n==联网补充==\n\n");
  const generation = await logStream(llm.stream(GEN_STRICT_PROMPT({ context, question: state.question })));
  return { generation };
};

const afterRoute = (state) => (state.strategy === "simple" ? "direct_answer" : "local_retrieve");

// 幂等标记护栏：webContext 非空即强制 generate，语义为「联网只做一次」
const afterEvaluateLocal = (state) => {
  if (state.webContext && String(state.webContext).trim()) {
    return "generate";
  }
  return state.evaluation?.enough === true ? "generate" : "web_search";
};

const webSearchNode = async (state) => {
  logBanner("---WEB_SEARCH---");
  const query = (state.evaluation?.web_query ?? "").trim() || state.question;
  console.log(`联网查询：${query}`);
  const webContext = await bochaWebSearch(query, 8);
  console.log(`联网结果长度：${webContext.length}`);
  return { webContext };
};

// v4：+信息充分性评估 / 联网兜底 —— 评估循环 + 幂等标记护栏
const graph = new StateGraph(GraphState)
  .addNode("route_question", routeQuestionNode)
  .addNode("direct_answer", directAnswerNode)
  .addNode("local_retrieve", retrieveLocalNode)
  .addNode("evaluate_local", evaluateNode)
  .addNode("generate", generateNode)
  .addNode("web_search", webSearchNode)
  .addEdge(START, "route_question")
  .addConditionalEdges("route_question", afterRoute, {
    direct_answer: "direct_answer",
    local_retrieve: "local_retrieve",
  })
  .addEdge("local_retrieve", "evaluate_local")
  .addConditionalEdges("evaluate_local", afterEvaluateLocal, {
    generate: "generate",
    web_search: "web_search",
  })
  .addEdge("web_search", "evaluate_local")
  .addEdge("direct_answer", END)
  .addEdge("generate", END)
  .compile();

export { graph };

async function main() {
  const question = `请回答《天龙八部》小说里"雁门关事件"的主谋是谁， 并说明其儿子的最终结局；
  另外请补充： 在《天龙八部》2013版电视剧中，这段"雁门关事件"主要出现在哪几集？
  请给出可核对的来源链接。
  `;
  const k = 8;

  const drawable = await graph.getGraphAsync();
  console.log(drawable.drawMermaid({ withStyles: true }));

  logBanner("连接 Milvus...");
  await getVectorStore();
  console.log("已连接");

  const result = await graph.invoke({
    question,
    k,
    strategy: "",
    routeReason: "",
    retrievedDocs: [],
    localContext: "",
    webContext: "",
    evaluation: null,
    generation: "",
  });

  if (result.generation?.trim()) {
    console.log(result.generation);
  }
}

const isMain = import.meta.url === pathToFileURL(process.argv[1] ?? "").href;
if (isMain) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
