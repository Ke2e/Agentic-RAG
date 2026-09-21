export function logBanner(title) {
  console.log(`\n${title}`);
}

export function logDocs(docs, { title = "检索结果", previewLen = 200 } = {}) {
  if (!docs?.length) {
    console.log("未命中文档");
    return;
  }
  console.log(title);
  docs.forEach((item, i) => {
    const score = Number(item.score);
    const scoreText = Number.isFinite(score) ? score.toFixed(4) : "-";
    const sources = item.sources?.length ? ` sources=${item.sources.join("+")}` : "";
    console.log(`[${i + 1}] score=${scoreText} 第${item.chapter_num}章 index=${item.index}${sources}`);
    const content = item.content ?? "";
    console.log(content.length > previewLen ? `${content.slice(0, previewLen)}...` : content);
  });
}

export function logRound({ round, query, hits, total }) {
  console.log(`----第${round}轮，查询：${query}----`);
  console.log(`本轮命中${hits}条，累计去重后${total}条`);
}

// 「模型建议」与「最终决定」分开打日志：护栏触发时可归因
export function logDecision({ final, model, reason }) {
  console.log(`[决策] final=${final} (模型建议=${model})(${reason ?? ""})`);
}

export async function logStream(stream, header = "\n[AI回答（流式）]\n") {
  process.stdout.write(header);
  let text = "";
  for await (const chunk of stream) {
    const t = typeof chunk.content === "string" ? chunk.content : "";
    if (!t) continue;
    text += t;
    process.stdout.write(t);
  }
  process.stdout.write("\n");
  return text;
}

// 非流式回答的统一打印（v6 生成节点使用：部分 OpenAI 兼容端点流式响应不稳定）
export async function logAnswer(message, header = "\n[AI回答]\n") {
  const text = typeof message.content === "string" ? message.content : "";
  process.stdout.write(header + text + "\n");
  return text;
}
