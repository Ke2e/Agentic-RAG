import { parse } from "node:path";
import {
  MilvusClient,
  DataType,
  MetricType,
  IndexType,
} from "@zilliz/milvus2-sdk-node";
import { EPubLoader } from "@langchain/community/document_loaders/fs/epub";
import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import { CONFIG } from "./common/config.mjs";
import { makeEmbeddings } from "./common/llm.mjs";
import { ensureEsIndex, bulkIndexChunks } from "./common/es-client.mjs";

const BOOK_NAME = parse(CONFIG.CORPUS_PATH).name;

const client = new MilvusClient({ address: CONFIG.MILVUS_URL });

async function getEmbedding(text) {
  return makeEmbeddings().embedQuery(text);
}

async function ensureCollection() {
  const hasCollection = await client.hasCollection({
    collection_name: CONFIG.COLLECTION_NAME,
  });

  if (!hasCollection.value) {
    console.log("创建集合...");
    await client.createCollection({
      collection_name: CONFIG.COLLECTION_NAME,
      fields: [
        { name: "id", data_type: DataType.VarChar, max_length: 100, is_primary_key: true },
        { name: "book_id", data_type: DataType.VarChar, max_length: 100 },
        { name: "book_name", data_type: DataType.VarChar, max_length: 200 },
        { name: "chapter_num", data_type: DataType.Int32 },
        { name: "index", data_type: DataType.Int32 },
        { name: "content", data_type: DataType.VarChar, max_length: 10000 },
        { name: "vector", data_type: DataType.FloatVector, dim: CONFIG.EMBEDDINGS_DIMENSIONS },
      ],
    });
    console.log("✓ 集合创建成功");

    console.log("创建索引...");
    await client.createIndex({
      collection_name: CONFIG.COLLECTION_NAME,
      field_name: "vector",
      // 写入与查询统一为 HNSW + COSINE（原课程写入 IVF_FLAT、查询 HNSW，索引不一致）
      index_type: IndexType.HNSW,
      metric_type: MetricType.COSINE,
      params: { M: 16, efConstruction: 200 },
    });
    console.log("✓ 索引创建成功");
  }

  try {
    await client.loadCollection({ collection_name: CONFIG.COLLECTION_NAME });
    console.log("✓ 集合已加载");
  } catch {
    console.log("✓ 集合已处于加载状态");
  }
}

async function upsertChunksBatch(chunks, bookId, chapterNum) {
  if (chunks.length === 0) {
    return 0;
  }

  const insertData = await Promise.all(
    chunks.map(async (chunk, chunkIndex) => {
      const vector = await getEmbedding(chunk);
      return {
        // 主键手写 bookId_chapterNum_index：重跑产生相同 id，配合 upsert 幂等
        // （原课程用 insert，主键重复会追加而非覆盖，幂等是假的）
        id: `${bookId}_${chapterNum}_${chunkIndex}`,
        book_id: String(bookId),
        book_name: BOOK_NAME,
        chapter_num: chapterNum,
        index: chunkIndex,
        content: chunk,
        vector,
      };
    })
  );

  await client.upsert({
    collection_name: CONFIG.COLLECTION_NAME,
    data: insertData,
  });

  // ES 双写：同 id 覆盖（index 操作），与 Milvus 主键对齐，天然幂等
  await bulkIndexChunks(
    insertData.map(({ vector, ...doc }) => doc)
  );

  return insertData.length;
}

async function loadAndProcessEPubStreaming(bookId) {
  console.log(`\n开始加载 EPUB 文件: ${CONFIG.CORPUS_PATH}`);

  const loader = new EPubLoader(CONFIG.CORPUS_PATH, { splitChapters: true });
  const documents = await loader.load();
  console.log(`✓ 加载完成，共 ${documents.length} 个章节\n`);

  // 未指定 separators 时默认按 ["\n\n", "\n", " ", ""] 优先级递归断开，硬切是最后手段
  const textSplitter = new RecursiveCharacterTextSplitter({
    chunkSize: CONFIG.CHUNK_SIZE,
    chunkOverlap: CONFIG.CHUNK_OVERLAP,
  });

  let totalInserted = 0;

  // 逐章处理：内存峰值只有一章的片段量，某章失败不毁全量
  for (let chapterIndex = 0; chapterIndex < documents.length; chapterIndex++) {
    const chapterContent = documents[chapterIndex].pageContent;
    console.log(`处理第 ${chapterIndex + 1}/${documents.length} 章...`);

    const chunks = await textSplitter.splitText(chapterContent);
    console.log(`  拆分为 ${chunks.length} 个片段`);

    if (chunks.length === 0) {
      console.log("  跳过空章节\n");
      continue;
    }

    // 章内并发嵌入后批量插入
    const insertedCount = await upsertChunksBatch(chunks, bookId, chapterIndex + 1);
    totalInserted += insertedCount;
    console.log(`  ✓ 已插入 ${insertedCount} 条记录（累计: ${totalInserted}）\n`);
  }

  console.log(`\n总共插入 ${totalInserted} 条记录\n`);
  return totalInserted;
}

async function main() {
  console.log("=".repeat(80));
  console.log("电子书入库程序（Milvus + Elasticsearch 双写）");
  console.log("=".repeat(80));

  console.log("\n连接 Milvus...");
  await client.connectPromise;
  console.log("✓ 已连接\n");

  await ensureCollection();

  console.log("确保 Elasticsearch 索引存在...");
  const created = await ensureEsIndex();
  console.log(created ? "✓ ES 索引已创建" : "✓ ES 索引已存在");

  await loadAndProcessEPubStreaming(CONFIG.BOOK_ID);

  console.log("=".repeat(80));
  console.log("处理完成！");
  console.log("=".repeat(80));
}

main().catch((error) => {
  console.error("\n错误:", error.message);
  console.error(error.stack);
  process.exitCode = 1;
});
