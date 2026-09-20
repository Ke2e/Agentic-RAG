import { ChatOpenAI, OpenAIEmbeddings } from "@langchain/openai";
import { CONFIG } from "./config.mjs";

export function makeChatModel() {
  return new ChatOpenAI({
    model: CONFIG.MODEL_NAME,
    temperature: 0,
    configuration: { baseURL: CONFIG.OPENAI_BASE_URL },
    apiKey: CONFIG.OPENAI_API_KEY,
  });
}

export function makeEmbeddings() {
  return new OpenAIEmbeddings({
    model: CONFIG.EMBEDDINGS_MODEL_NAME,
    dimensions: CONFIG.EMBEDDINGS_DIMENSIONS,
    configuration: { baseURL: CONFIG.OPENAI_BASE_URL },
    apiKey: CONFIG.OPENAI_API_KEY,
  });
}
