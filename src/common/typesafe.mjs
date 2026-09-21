import { CONFIG } from "./config.mjs";

// TypeSafe jev（System One 判断模型）：判断类任务要的是校准概率（路由阈值、置信度门控），
// 生成类任务仍走主 LLM。
//
// 调用通道：TypeSafe 官方 API（https://api.typesafe.ai/v1/systemone，Bearer 认证，
// console.typesafe.ai 获取 key）。直接 fetch 而不经 SDK，保证请求结构与官方 v1 文档
// 一致且不引入额外依赖。未配置 key 或调用失败时，本模块所有 judge* 返回 null，
// 调用方回退到 v5 的 zod + LLM 路径——v6 不强制使用者注册。

const SYSTEM_ONE_URL = "https://api.typesafe.ai/v1/systemone";

async function callSystemOne(state, questions) {
  if (!CONFIG.TYPESAFE_API_KEY) return null;
  const res = await fetch(SYSTEM_ONE_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${CONFIG.TYPESAFE_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ state, model: "jev-latest", questions }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`TypeSafe API ${res.status}: ${detail.slice(0, 200)}`);
  }
  return res.json();
}

export function isTypeSafeEnabled() {
  return Boolean(CONFIG.TYPESAFE_API_KEY);
}

const formatProbs = (probabilities) =>
  Object.entries(probabilities)
    .map(([option, p]) => `${option}=${p}`)
    .join(" / ");

const asConfidence = (probabilities) => Math.max(...Object.values(probabilities));

// state 为文本；结构化状态序列化为 JSON 传入
const asState = (state) => (typeof state === "string" ? state : JSON.stringify(state));

// 路由判断：simple / complex + 完整概率分布
export async function judgeRoute(question) {
  const res = await callSystemOne(asState({ question }), {
    strategy: {
      type: "choice",
      instructions: `该问题是否需要检索《${CONFIG.BOOK_TITLE}》原文才能回答？`,
      criteria: {
        simple: "常识、通用知识或数学题，无需检索即可直接回答",
        complex: "涉及小说情节、人物关系或书中细节，必须检索原文",
      },
    },
  });
  if (!res) return null;
  const a = res.answers.strategy;
  return {
    strategy: a.choice,
    probabilities: a.probabilities,
    confidence: asConfidence(a.probabilities),
    detail: formatProbs(a.probabilities),
    usage: res.usage,
  };
}

// 规划判断：继续检索 or 生成（消费检索轮次状态）
export async function judgeNextStep(state) {
  const res = await callSystemOne(asState(state), {
    nextAction: {
      type: "choice",
      instructions: "多跳问答进行中，下一步该做什么？",
      criteria: {
        retrieve: "仍有未检索的子问题，或现有证据存在明显缺口，继续检索",
        generate: "证据已足够回答，或剩余子问题与问题关联不大，进入生成",
      },
    },
  });
  if (!res) return null;
  const a = res.answers.nextAction;
  return {
    nextAction: a.choice,
    probabilities: a.probabilities,
    confidence: asConfidence(a.probabilities),
    detail: formatProbs(a.probabilities),
    usage: res.usage,
  };
}

// 评估判断：证据是否充分（noul 返回「充分」的概率 0~1）
export async function judgeEnough({ question, localContext, webContext }) {
  const res = await callSystemOne(
    asState({
      question,
      localContext,
      webContext: webContext && String(webContext).trim() ? webContext : "(无联网补充)",
    }),
    {
      enough: {
        type: "noul",
        instructions: "现有证据（本地检索 + 可选联网补充）是否足以完整、准确地回答问题？",
      },
    },
  );
  if (!res) return null;
  return { probability: res.answers.enough.noul, usage: res.usage };
}
