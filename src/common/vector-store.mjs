import { Milvus } from "@langchain/community/vectorstores/milvus";
import { CONFIG } from "./config.mjs";
import { makeEmbeddings } from "./llm.mjs";

let vectorStorePromise = null;

// 懒单例：首次调用才连接 Milvus，import 本模块无副作用
export async function getVectorStore() {
  if (!vectorStorePromise) {
    vectorStorePromise = (async () => {
      const store = await Milvus.fromExistingCollection(makeEmbeddings(), {
        collectionName: CONFIG.COLLECTION_NAME,
        url: CONFIG.MILVUS_URL,
        textField: "content",
        primaryField: "id",
        vectorField: "vector",
        // 写入侧与查询侧统一为 HNSW + COSINE（原课程写入 IVF_FLAT、查询 HNSW，索引不一致）
        indexCreateOptions: {
          metric_type: "COSINE",
          index_type: "HNSW",
          params: { M: 16, efConstruction: 200 },
          search_params: { ef: 64 },
        },
      });
      store.indexSearchParams = {
        metric_type: "COSINE",
        params: JSON.stringify({ ef: 64 }),
      };
      try {
        await store.client.loadCollection({ collection_name: CONFIG.COLLECTION_NAME });
      } catch (error) {
        if (!String(error?.message ?? "").includes("already loaded")) throw error;
      }
      return store;
    })();
  }
  return vectorStorePromise;
}

export async function semanticSearch(question, k = CONFIG.TOP_K) {
  const store = await getVectorStore();
  const docsWithScores = await store.similaritySearchWithScore(question, k);
  return docsWithScores.map(([doc, score]) => ({
    score,
    content: doc.pageContent,
    id: doc.metadata?.id ?? "unknown",
    book_id: doc.metadata?.book_id ?? "未知",
    chapter_num: doc.metadata?.chapter_num ?? "未知",
    index: doc.metadata?.index ?? "未知",
    source: "milvus",
  }));
}
