import { pathToFileURL } from "node:url";
import { START, END, StateGraph } from "@langchain/langgraph";
import { CONFIG } from "./common/config.mjs";
import { makeChatModel } from "./common/llm.mjs";
import { defineGraphState, V5_FIELDS } from "./common/state.mjs";
import { RouteSchema, DecomposeSchema, NextStepSchema, EvaluateSchema } from "./common/schemas.mjs";
import {
  ROUTE_PROMPT,
  DIRECT_PROMPT,
  DECOMPOSE_PROMPT,
  PLAN_PROMPT,
  EVALUATE_PROMPT,
  GEN_STRICT_PROMPT,
} from "./common/prompts.mjs";
import { getVectorStore } from "./common/vector-store.mjs";
import { hybridSearch, mergeUnique } from "./common/hybrid.mjs";
import { bochaWebSearch } from "./common/web-search.mjs";
import { logBanner, logDecision, logDocs, logRound, logStream } from "./common/logger.mjs";

const model = makeChatModel();
const GraphState = defineGraphState(V5_FIELDS);

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
    webContext: "",
    webSearched: false,
    evaluation: null,
    generation: "",
  };
};

const directAnswerNode = async (state) => {
  logBanner("----DIRECT_ANSWER----");
  const generation = await logStream(model.stream(DIRECT_PROMPT(state.question)));
  return { generation };
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

// 每轮检索 = 当前子问题走混合检索（语义路 + 关键词路 RRF 融合），
// 再 mergeUnique 跨轮去重后整组覆盖 documents（无 reducer，last-write-wins）
const retrieveNode = async (state) => {
  const subs = state.subQuestions ?? [];
  const idx = state.nextSubIdx ?? 0;
  const q = subs[idx]?.trim();

  if (!q) {
    throw new Error(`retrieve: 子问题下标 ${idx} 无有效文本（共 ${subs.length} 条）`);
  }

  const round = state.retrievalCount + 1;
  const fused = await hybridSearch(q, state.k);
  const merged = mergeUnique(state.documents ?? [], fused);
  logRound({ round, query: q, hits: fused.length, total: merged.length });
  logDocs(fused, { title: "本轮命中（RRF 融合后）：", previewLen: 120 });

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
          .map((d, i) => {
            const scoreText = Number.isFinite(Number(d.score)) ? Number(d.score).toFixed(4) : "-";
            return `[${i + 1}] score=${scoreText} 第${d.chapter_num}章：${d.content.slice(0, 200)}`;
          })
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

  // 护栏一/二写在代码里：计数上限 + 子问题消费尽，均强制 generate
  let finalNext = nextAction;
  if (state.retrievalCount >= state.maxRetrievals) finalNext = "generate";
  if (remaining <= 0) finalNext = "generate";
  logDecision({ final: finalNext, model: nextAction, reason });

  return { plannedNext: finalNext };
};

const evaluateNode = async (state) => {
  const hasWeb = Boolean(state.webContext && String(state.webContext).trim());
  logBanner(hasWeb ? "---EVALUATE_CONTEXT_WITH_WEB---" : "---EVALUATE_LOCAL_CONTEXT---");

  const localContext = (state.documents ?? [])
    .slice(0, 10)
    .map((d) => `第${d.chapter_num}章：${d.content}`)
    .join("\n\n");

  const evaluator = model.withStructuredOutput(EvaluateSchema);
  const out = await evaluator.invoke(
    EVALUATE_PROMPT({
      question: state.question,
      localContext,
      hasWeb,
      webContext: state.webContext,
    })
  );

  console.log(`${hasWeb ? "二次评估" : "评估"}: enough=${out.enough} (${out.reason})`);
  if (!out.enough && out.missing?.length) {
    out.missing.forEach((m, i) => console.log(`缺失 ${i + 1}: ${m}`));
  }
  return { evaluation: out };
};

const webSearchNode = async (state) => {
  logBanner("---WEB_SEARCH---");
  const query = (state.evaluation?.web_query ?? "").trim() || state.question;
  console.log(`联网查询：${query}`);
  // 联网失败不让整图崩溃：错误信息进 webContext，由生成节点如实说明
  let webContext;
  try {
    webContext = await bochaWebSearch(query, 8);
  } catch (err) {
    webContext = `联网搜索失败：${err.message}`;
  }
  console.log(`联网结果长度：${webContext.length}`);
  return { webContext, webSearched: true };
};

const generateNode = async (state) => {
  logBanner("---GENERATE---");
  const localContext = (state.documents ?? [])
    .slice(0, 10)
    .map((d, i) => `[片段 ${i + 1}] 第${d.chapter_num}章：${d.content}`)
    .join("\n\n");
  const context = [localContext, state.webContext].filter(Boolean).join("\n\n==联网补充==\n\n");
  const generation = await logStream(model.stream(GEN_STRICT_PROMPT({ context, question: state.question })));
  return { generation };
};

const afterRoute = (state) => (state.strategy === "simple" ? "direct_answer" : "decompose_question");
const afterPlan = (state) => (state.plannedNext === "retrieve" ? "retrieve" : "generate");

// 护栏三：联网幂等标记（webSearched 置位后必出 generate），
// 且图中没有「联网后回检索」的边，结构上杜绝「评估→搜索→评估」死循环
const afterEvaluateLocal = (state) => {
  if (state.webSearched) {
    return "generate";
  }
  return state.evaluation?.enough === true ? "generate" : "web_search";
};

// v5 终态图 = v3 的「拆解→迭代检索→规划」+ v4 的「评估→联网兜底」+ 混合检索
export function buildGraph() {
  return new StateGraph(GraphState)
    .addNode("route_question", routeQuestionNode)
    .addNode("direct_answer", directAnswerNode)
    .addNode("decompose_question", decomposeQuestionNode)
    .addNode("retrieve", retrieveNode)
    .addNode("plan_next_step", planNextStepNode)
    .addNode("evaluate_local", evaluateNode)
    .addNode("web_search", webSearchNode)
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
      generate: "evaluate_local",
    })
    .addConditionalEdges("evaluate_local", afterEvaluateLocal, {
      generate: "generate",
      web_search: "web_search",
    })
    .addEdge("web_search", "evaluate_local")
    .addEdge("direct_answer", END)
    .addEdge("generate", END)
    .compile();
}

export const graph = buildGraph();

async function main() {
  const question = `请回答《天龙八部》小说里"雁门关事件"的主谋是谁， 并说明其儿子的最终结局；
  另外请补充： 在《天龙八部》2013版电视剧中，这段"雁门关事件"主要出现在哪几集？
  请给出可核对的来源链接。
  `;
  const k = CONFIG.TOP_K;

  const drawable = await graph.getGraphAsync();
  console.log(drawable.drawMermaid({ withStyles: true }));

  console.log("=".repeat(80));
  console.log(`问题：${question}`);
  console.log("=".repeat(80));

  logBanner("连接 Milvus...");
  await getVectorStore();
  console.log("已连接");

  const result = await graph.invoke(
    { question, k },
    { recursionLimit: 50 }
  );

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
