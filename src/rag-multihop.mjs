import { pathToFileURL } from "node:url";
import { START, END, StateGraph } from "@langchain/langgraph";
import { CONFIG } from "./common/config.mjs";
import { makeChatModel } from "./common/llm.mjs";
import { defineGraphState, V3_FIELDS } from "./common/state.mjs";
import { RouteSchema, DecomposeSchema, NextStepSchema } from "./common/schemas.mjs";
import { ROUTE_PROMPT, DIRECT_PROMPT, DECOMPOSE_PROMPT, PLAN_PROMPT, GEN_NOVEL_PROMPT, formatDocContext } from "./common/prompts.mjs";
import { getVectorStore, semanticSearch } from "./common/vector-store.mjs";
import { mergeUnique } from "./common/hybrid.mjs";
import { logBanner, logDecision, logDocs, logRound, logStream } from "./common/logger.mjs";

const model = makeChatModel();
const GraphState = defineGraphState(V3_FIELDS);

const routeQuestionNode = async (state) => {
  logBanner("___ROUTE-QUESTION___");
  const router = model.withStructuredOutput(RouteSchema);
  const route = await router.invoke(ROUTE_PROMPT(state.question));
  logDecision({ final: route.strategy, model: route.strategy, reason: route.reason });
  return {
    question: state.question,
    k: state.k,
    strategy: route.strategy,
    routeReason: route.reason,
    retrievalCount: 0,
    maxRetrievals: state.maxRetrievals ?? CONFIG.MAX_RETRIEVALS,
    documents: [],
    subQuestions: [],
    nextSubIdx: 0,
    currentQuery: "",
  };
};

const directAnswerNode = async (state) => {
  logBanner("----DIRECT_ANSWER----");
  const generation = await logStream(model.stream(DIRECT_PROMPT(state.question)));
  return { question: state.question, k: state.k, documents: [], generation };
};

const decomposeQuestionNode = async (state) => {
  logBanner("---DECOMPOSE_QUESTION---");
  const decomposer = model.withStructuredOutput(DecomposeSchema);
  const out = await decomposer.invoke(DECOMPOSE_PROMPT(state.question));

  const subQuestions = out.sub_questions.map((s) => s.trim()).filter(Boolean);
  if (subQuestions.length === 0) {
    throw new Error("decompose_question: sub_questions 为空");
  }

  console.log(`拆解 ${subQuestions.length} 条子问题(${out.reason})`);
  subQuestions.forEach((q, i) => {
    console.log(`[${i + 1}] ${q}`);
  });
  return {
    subQuestions,
    nextSubIdx: 0,
    currentQuery: subQuestions[0],
  };
};

const retrieveNode = async (state) => {
  const subs = state.subQuestions ?? [];
  const idx = state.nextSubIdx ?? 0;
  const q = subs[idx]?.trim();

  if (!q) {
    throw new Error(`retrieve: 子问题下标 ${idx} 无有效文本（共 ${subs.length} 条）`);
  }

  const round = state.retrievalCount + 1;
  const newDocs = await semanticSearch(q, state.k);
  // 多轮检索可能重复：按主键去重并保留高分，避免重复片段让模型产生错觉
  const merged = mergeUnique(state.documents ?? [], newDocs);
  logRound({ round, query: q, hits: newDocs.length, total: merged.length });
  logDocs(newDocs, { title: "本轮命中：", previewLen: 120 });

  return {
    documents: merged,
    retrievalCount: round,
    nextSubIdx: idx + 1,
    currentQuery: q,
  };
};

const planNextStepNode = async (state) => {
  logBanner("---PLAN_NEXT_STEP---");
  const subs = state.subQuestions ?? [];
  const nextIdx = state.nextSubIdx ?? 0;
  const remaining = subs.length - nextIdx;

  const subList = subs
    .map(
      (s, i) =>
        `${i + 1}.${s} ${i < nextIdx ? "已检索" : i === nextIdx ? "(下一轮将检索，若选择继续)" : "未检索"}`
    )
    .join("\n");

  const docStr =
    state.documents.length === 0
      ? "(尚无检索结果)"
      : state.documents
          .slice(0, 6)
          .map(
            (d, i) =>
              `[${i + 1}] score=${Number(d.score).toFixed(4)} 第${d.chapter_num}章：${d.content.slice(0, 200)}`
          )
          .join("\n\n");

  const prompt = PLAN_PROMPT({
    question: state.question,
    subList,
    retrievalCount: state.retrievalCount,
    remaining,
    maxRetrievals: state.maxRetrievals,
    docStr,
  });

  const planModel = model.withStructuredOutput(NextStepSchema);
  const { nextAction, reason } = await planModel.invoke(prompt);

  // 护栏写在代码里而不是提示词里：提示词是请求，代码是保证
  let finalNext = nextAction;
  if (state.retrievalCount >= state.maxRetrievals) finalNext = "generate";
  if (remaining <= 0) finalNext = "generate";
  logDecision({ final: finalNext, model: nextAction, reason });

  return { plannedNext: finalNext };
};

const generateNode = async (state) => {
  logBanner("---GENERATE---");
  const context = formatDocContext(state.documents);
  const prompt = GEN_NOVEL_PROMPT({ context, question: state.question });
  const generation = await logStream(model.stream(prompt));
  return { question: state.question, k: state.k, documents: state.documents, generation };
};

const afterRoute = (state) => (state.strategy === "simple" ? "direct_answer" : "decompose_question");

// 修复：原课程读 state.strategy（恒为 "complex"，回边永不触发、多跳静默退化单跳），
// 规划器实际写入的是 state.plannedNext
const afterPlan = (state) => (state.plannedNext === "retrieve" ? "retrieve" : "generate");

// v3：+子问题拆解 / 迭代检索 / 规划回边 —— 检索循环 + 计数护栏
const graph = new StateGraph(GraphState)
  .addNode("route_question", routeQuestionNode)
  .addNode("direct_answer", directAnswerNode)
  .addNode("decompose_question", decomposeQuestionNode)
  .addNode("retrieve", retrieveNode)
  .addNode("plan_next_step", planNextStepNode)
  .addNode("generate", generateNode)
  .addEdge(START, "route_question")
  .addConditionalEdges("route_question", afterRoute, {
    direct_answer: "direct_answer",
    decompose_question: "decompose_question",
  })
  .addEdge("decompose_question", "retrieve")
  .addEdge("retrieve", "plan_next_step")
  .addConditionalEdges("plan_next_step", afterPlan, {
    retrieve: "retrieve",
    generate: "generate",
  })
  .addEdge("direct_answer", END)
  .addEdge("generate", END)
  .compile();

export { graph };

async function main() {
  const question = `《天龙八部》中【四大恶人】排行第二的是谁？
  此人之子在身世揭晓前,其生父在武林中的公开身份是什么？`;
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
