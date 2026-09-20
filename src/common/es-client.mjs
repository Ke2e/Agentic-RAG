import { Client } from "@elastic/elasticsearch";
import { CONFIG } from "./config.mjs";

let client = null;

export function getEsClient() {
  if (!client) {
    client = new Client({ node: CONFIG.ES_NODE });
  }
  return client;
}

// id 与 Milvus 主键完全一致（`${bookId}_${chapterNum}_${chunkIndex}`），是双路归并去重的前提
export async function ensureEsIndex() {
  const es = getEsClient();
  const exists = await es.indices.exists({ index: CONFIG.ES_INDEX });
  if (!exists) {
    await es.indices.create({
      index: CONFIG.ES_INDEX,
      settings: {
        number_of_shards: 1,
        number_of_replicas: 0,
      },
      mappings: {
        properties: {
          id: { type: "keyword" },
          book_id: { type: "keyword" },
          book_name: { type: "keyword" },
          chapter_num: { type: "integer" },
          index: { type: "integer" },
          // 写入 ik_max_word 切细提高召回，查询 ik_smart 切粗提高精度
          content: {
            type: "text",
            analyzer: "ik_max_word",
            search_analyzer: "ik_smart",
          },
        },
      },
    });
    return true;
  }
  return false;
}

export async function keywordSearch(query, k = CONFIG.ES_TOP_K) {
  const es = getEsClient();
  const res = await es.search({
    index: CONFIG.ES_INDEX,
    size: k,
    query: {
      match: { content: { query } },
    },
  });
  return res.hits.hits.map((hit) => ({
    score: hit._score ?? 0,
    content: hit._source?.content ?? "",
    id: hit._id,
    book_id: hit._source?.book_id ?? "未知",
    chapter_num: hit._source?.chapter_num ?? "未知",
    index: hit._source?.index ?? "未知",
    source: "es",
  }));
}

export async function bulkIndexChunks(docs) {
  const es = getEsClient();
  const operations = docs.flatMap((d) => [
    { index: { _index: CONFIG.ES_INDEX, _id: d.id } },
    d,
  ]);
  const res = await es.helpers.bulk({ operations });
  return res;
}
