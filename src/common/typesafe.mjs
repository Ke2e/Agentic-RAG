import { CONFIG } from "./config.mjs";

// TypeSafe jev（System One 判断模型）：判断类任务要的是校准概率（路由阈值、置信度门控），
// 生成类任务仍走主 LLM。
//
// 调用通道：Vercel AI Gateway（model id = typesafe-ai/jev），KEY 为 vck_ 前缀的
// AI Gateway API Key（https://vercel.com/docs/ai-gateway）。未配置时本模块所有
// judge* 返回 null，调用方回退到 v5 的 zod + LLM 路径——v6 不强制使用者注册。

let gatewayModelPromise = null;

async function getModel() {
  if (!CONFIG.TYPESAFE_API_KEY) return null;
  if (!gatewayModelPromise) {
    gatewayModelPromise = import("ai")
      .then(({ experimental_evaluate, createGateway }) => {
        if (typeof experimental_evaluate !== "function") {
          throw new Error("AI SDK 版本过低：experimental_evaluate 需要 ai@>=7.0.105");
        }
        const gw = createGateway({ apiKey: CONFIG.TYPESAFE_API_KEY });
        // evaluate 需要判定模型实例（支持 choice/score/boolean 类型），而非普通语言模型
        return { evaluate: experimental_evaluate, model: gw.evaluationModel("typesafe-ai/jev") };
      })
      .catch((err) => {
        throw new Error(`已配置 TYPESAFE_API_KEY 但 AI SDK 不可用（先 npm install）：${err.message}`);
      });
  }
  return gatewayModelPromise;
}

export function isTypeSafeEnabled() {
  return Boolean(CONFIG.TYPESAFE_API_KEY);
}

const formatProbs = (probabilities) =>
  Object.entries(probabilities)
    .map(([option, p]) => `${option}=${p}`)
    .join(" / ");

const asConfidence = (probabilities) => Math.max(...Object.values(probabilities));

// AI SDK evaluate 的 state 为文本；结构化状态序列化为 JSON 传入
const asState = (state) => (typeof state === "string" ? state : JSON.stringify(state));

// 路由判断：simple / complex + 完整概率分布
export async function judgeRoute(question) {
  const m = await getModel();
  if (!m) return null;
  const res = await m.evaluate({
    model: m.model,
    state: asState({ question }),
    questions: {
      strategy: {
        type: "choice",
        instructions: `该问题是否需要检索《${CONFIG.BOOK_TITLE}》原文才能回答？`,
        criteria: {
          simple: "常识、通用知识或数学题，无需检索即可直接回答",
          complex: "涉及小说情节、人物关系或书中细节，必须检索原文",
        },
      },
    },
  });
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
  const m = await getModel();
  if (!m) return null;
  const res = await m.evaluate({
    model: m.model,
    state: asState(state),
    questions: {
      nextAction: {
        type: "choice",
        instructions: "多跳问答进行中，下一步该做什么？",
        criteria: {
          retrieve: "仍有未检索的子问题，或现有证据存在明显缺口，继续检索",
          generate: "证据已足够回答，或剩余子问题与问题关联不大，进入生成",
        },
      },
    },
  });
  const a = res.answers.nextAction;
  return {
    nextAction: a.choice,
    probabilities: a.probabilities,
    confidence: asConfidence(a.probabilities),
    detail: formatProbs(a.probabilities),
    usage: res.usage,
  };
}

// 评估判断：证据是否充分（boolean 返回「充分」的概率 0~1）
export async function judgeEnough({ question, localContext, webContext }) {
  const m = await getModel();
  if (!m) return null;
  const res = await m.evaluate({
    model: m.model,
    state: asState({
      question,
      localContext,
      webContext: webContext && String(webContext).trim() ? webContext : "(无联网补充)",
    }),
    questions: {
      enough: {
        type: "boolean",
        instructions: "现有证据（本地检索 + 可选联网补充）是否足以完整、准确地回答问题？",
        criteria: {
          true: "证据覆盖了问题的各个部分，可直接作答",
          false: "存在缺失的情节或细节，需要补充检索或联网搜索",
        },
      },
    },
  });
  return { probability: res.answers.enough.probability, usage: res.usage };
}
