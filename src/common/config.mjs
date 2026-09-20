import "dotenv/config";

const num = (value, fallback) => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

export const CONFIG = {
  // LLM（OpenAI 兼容协议）
  MODEL_NAME: process.env.MODEL_NAME,
  OPENAI_BASE_URL: process.env.OPENAI_BASE_URL,
  OPENAI_API_KEY: process.env.OPENAI_API_KEY,

  // Embedding
  EMBEDDINGS_MODEL_NAME: process.env.EMBEDDINGS_MODEL_NAME ?? "text-embedding-v3",
  EMBEDDINGS_DIMENSIONS: num(process.env.EMBEDDINGS_DIMENSIONS, 1024),

  // 联网兜底
  BOCHA_API_KEY: process.env.BOCHA_API_KEY,

  // Milvus
  MILVUS_URL: process.env.MILVUS_URL ?? "localhost:19530",
  COLLECTION_NAME: process.env.MILVUS_COLLECTION ?? "ebook_collection",

  // Elasticsearch
  ES_NODE: process.env.ES_NODE ?? "http://localhost:9200",
  ES_INDEX: process.env.ES_INDEX ?? "ebook_chunks",

  // 语料
  CORPUS_PATH: process.env.CORPUS_PATH ?? "./data/天龙八部.epub",
  BOOK_ID: num(process.env.BOOK_ID, 1),

  // 检索参数
  CHUNK_SIZE: num(process.env.CHUNK_SIZE, 500),
  CHUNK_OVERLAP: num(process.env.CHUNK_OVERLAP, 50),
  TOP_K: num(process.env.TOP_K, 5),
  ES_TOP_K: num(process.env.ES_TOP_K, 5),
  MAX_RETRIEVALS: num(process.env.MAX_RETRIEVALS, 8),
  RRF_K: num(process.env.RRF_K, 60),

  // SSE 服务
  PORT: num(process.env.PORT, 3000),
};
