import express from "express";
import cors from "cors";
import { CONFIG } from "../common/config.mjs";
import { getVectorStore } from "../common/vector-store.mjs";
import { ensureEsIndex } from "../common/es-client.mjs";
import { graph } from "../rag-v5-final.mjs";

const app = express();
app.use(cors());

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

// node 事件里的 documents 只下发摘要，避免大段原文撑爆 SSE 流
function toNodeEvent(node, update) {
  const data = { node, ...update };
  if (Array.isArray(update?.documents)) {
    data.documents = {
      count: update.documents.length,
      samples: update.documents.slice(0, 3).map((d) => ({
        id: d.id,
        chapter_num: d.chapter_num,
        score: d.score,
      })),
    };
  }
  return data;
}

// SSE 端点：GET /api/rag/stream?question=...&k=...
// 事件类型：node（节点完成，含状态更新）/ token（generate|direct_answer 的流式增量）/ done / error
app.get("/api/rag/stream", async (req, res) => {
  const question = String(req.query.question ?? "").trim();
  const kNum = Number(req.query.k);
  const k = Number.isFinite(kNum) && kNum > 0 ? kNum : CONFIG.TOP_K;

  if (!question) {
    res.status(400).json({ error: "缺少 question 参数" });
    return;
  }

  res.set({
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.flushHeaders();

  const send = (event, data) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  // 客户端断开时中止图执行，释放 LLM/检索请求
  const controller = new AbortController();
  req.on("close", () => controller.abort());

  try {
    const stream = await graph.stream(
      { question, k },
      { streamMode: ["updates", "messages"], recursionLimit: 50, signal: controller.signal }
    );

    for await (const [mode, payload] of stream) {
      if (controller.signal.aborted) break;

      if (mode === "updates") {
        // updates 事件形如 { 节点名: 状态增量 }，可能一个节点多个 key
        for (const [node, update] of Object.entries(payload)) {
          send("node", toNodeEvent(node, update));
        }
      } else if (mode === "messages") {
        const [message, metadata] = payload;
        // 只转发回答类节点的 token，路由/拆解/评估等内部推理不下发
        const node = metadata?.langgraph_node;
        if (node === "generate" || node === "direct_answer") {
          const text = typeof message.content === "string" ? message.content : "";
          if (text) send("token", { node, text });
        }
      }
    }
    send("done", { ok: true });
  } catch (err) {
    if (!controller.signal.aborted) {
      send("error", { message: err.message });
    }
  } finally {
    res.end();
  }
});

async function bootstrap() {
  // 启动前预热依赖：连不上直接退出，避免服务起来后每个请求都失败
  console.log("预热：连接 Milvus...");
  await getVectorStore();
  console.log("预热：检查 ES 索引...");
  await ensureEsIndex();

  app.listen(CONFIG.PORT, () => {
    console.log(`SSE 服务已启动: http://localhost:${CONFIG.PORT}`);
    console.log(`  GET /health`);
    console.log(`  GET /api/rag/stream?question=...&k=${CONFIG.TOP_K}`);
  });
}

bootstrap().catch((err) => {
  console.error("启动失败:", err.message);
  process.exit(1);
});
