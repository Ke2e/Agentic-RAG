import "dotenv/config";

const num = (value, fallback) => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

// 可选数值：未设置返回 undefined（用于「不传 vs 传默认值」有区别的 API 参数）
const numOpt = (value) => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : undefined;
};

export const CONFIG = {
  // LLM（OpenAI 兼容协议）
  MODEL_NAME: process.env.MODEL_NAME,
  OPENAI_BASE_URL: process.env.OPENAI_BASE_URL,
  OPENAI_API_KEY: process.env.OPENAI_API_KEY,

  // Embedding（专用端点可选，不填则沿用主 LLM 的 BASE_URL / API_KEY）
  // EMBEDDINGS_DIMENSIONS：Milvus 集合维度；EMBEDDINGS_API_DIMENSIONS：是否向 API 传 dimensions
  // （bge-m3 等固定维度模型不接受该参数，传了会 400，留空即可）
  EMBEDDINGS_MODEL_NAME: process.env.EMBEDDINGS_MODEL_NAME ?? "text-embedding-v3",
  EMBEDDINGS_DIMENSIONS: num(process.env.EMBEDDINGS_DIMENSIONS, 1024),
  EMBEDDINGS_API_DIMENSIONS: numOpt(process.env.EMBEDDINGS_API_DIMENSIONS),
  EMBEDDINGS_BASE_URL: process.env.EMBEDDINGS_BASE_URL || process.env.OPENAI_BASE_URL,
  EMBEDDINGS_API_KEY: process.env.EMBEDDINGS_API_KEY || process.env.OPENAI_API_KEY,

  // 联网兜底
  BOCHA_API_KEY: process.env.BOCHA_API_KEY,

  // TypeSafe（v6 判断模型，可选；未配置时 v6 行为等同 v5）
  TYPESAFE_API_KEY: process.env.TYPESAFE_API_KEY,
  TYPESAFE_ROUTE_CONFIDENCE_FLOOR: num(process.env.TYPESAFE_ROUTE_CONFIDENCE_FLOOR, 0.7),
  TYPESAFE_ENOUGH_THRESHOLD: num(process.env.TYPESAFE_ENOUGH_THRESHOLD, 0.75),

  // Milvus
  MILVUS_URL: process.env.MILVUS_URL ?? "localhost:19530",
  COLLECTION_NAME: process.env.MILVUS_COLLECTION ?? "ebook_collection",

  // Elasticsearch
  ES_NODE: process.env.ES_NODE ?? "http://localhost:9200",
  ES_INDEX: process.env.ES_INDEX ?? "ebook_chunks",

  // 语料（自备 epub，不入库）
  CORPUS_PATH: process.env.CORPUS_PATH ?? "./data/天龙八部.epub",
  BOOK_ID: num(process.env.BOOK_ID, 1),
  BOOK_TITLE: process.env.BOOK_TITLE ?? "天龙八部",

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
