import { CONFIG } from "./config.mjs";
import { semanticSearch } from "./vector-store.mjs";
import { keywordSearch } from "./es-client.mjs";

// 跨轮去重：按主键归并，保留得分更高的一条（课程原版 mergeUnique 语义）
export function mergeUnique(existingDocs, newDocs) {
  const map = new Map();
  for (const d of [...(existingDocs ?? []), ...(newDocs ?? [])]) {
    const key = String(d.id);
    const prev = map.get(key);
    if (!prev || Number(d.score) > Number(prev.score)) {
      map.set(key, d);
    }
  }
  return Array.from(map.values()).sort((a, b) => Number(b.score) - Number(a.score));
}

// 单轮内双路 RRF 融合：score = Σ 1/(RRF_K + rank)，rank 从 1 计
export function rrfFuse(milvusDocs, esDocs, { topN = CONFIG.TOP_K, rrfK = CONFIG.RRF_K } = {}) {
  const map = new Map();
  const addPath = (docs, path) => {
    (docs ?? []).forEach((d, i) => {
      const rank = i + 1;
      const prev = map.get(String(d.id)) ?? {
        ...d,
        score: 0,
        sources: [],
        milvus_rank: null,
        es_rank: null,
      };
      prev.score += 1 / (rrfK + rank);
      prev.sources.push(path);
      if (path === "milvus" && prev.milvus_rank === null) prev.milvus_rank = rank;
      if (path === "es" && prev.es_rank === null) prev.es_rank = rank;
      map.set(String(d.id), prev);
    });
  };
  addPath(milvusDocs, "milvus");
  addPath(esDocs, "es");
  return Array.from(map.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, topN);
}

// 混合检索：语义路 + 关键词路；关键词路失败时降级为单路语义检索（只起 Milvus 也能跑）
export async function hybridSearch(query, k = CONFIG.TOP_K) {
  const [semanticDocs, esDocs] = await Promise.all([
    semanticSearch(query, k),
    keywordSearch(query, CONFIG.ES_TOP_K).catch((err) => {
      console.warn(`[hybrid] 关键词路（ES）失败，降级为单路语义检索：${err.message}`);
      return [];
    }),
  ]);
  return rrfFuse(semanticDocs, esDocs, { topN: k });
}
