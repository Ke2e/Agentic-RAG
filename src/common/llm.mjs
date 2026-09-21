import { ChatOpenAI, OpenAIEmbeddings } from "@langchain/openai";
import { CONFIG } from "./config.mjs";

export function makeChatModel() {
  return new ChatOpenAI({
    model: CONFIG.MODEL_NAME,
    temperature: 0,
    // 生成节点上下文长（10 片段 + 联网补充），显式放宽超时并允许重试
    timeout: 300_000,
    maxRetries: 2,
    configuration: { baseURL: CONFIG.OPENAI_BASE_URL },
    apiKey: CONFIG.OPENAI_API_KEY,
  });
}

export function makeEmbeddings() {
  return new OpenAIEmbeddings({
    model: CONFIG.EMBEDDINGS_MODEL_NAME,
    // 固定维度模型（如 bge-m3）不接受 dimensions 参数，未配置时不传
    ...(CONFIG.EMBEDDINGS_API_DIMENSIONS ? { dimensions: CONFIG.EMBEDDINGS_API_DIMENSIONS } : {}),
    configuration: { baseURL: CONFIG.EMBEDDINGS_BASE_URL },
    apiKey: CONFIG.EMBEDDINGS_API_KEY,
  });
}
