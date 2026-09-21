# Agentic RAG 多跳问答系统

基于 **LangGraph (JS)** 实现的 Agentic RAG：由 Agent 自主决策「要不要检索、怎么检索、信息够不够、要不要联网重搜」，而不是一条流水线跑到底。

检索侧最终形态为**混合检索**：Milvus 语义路 + Elasticsearch 关键词路（IK 分词），RRF 融合排序；对外提供 **Express SSE** 流式问答服务。

---

## 目录

- [演进脉络](#演进脉络)
- [架构图（v5 终态）](#架构图v5-终态)
- [快速开始](#快速开始)

---

## 演进脉络

六个版本各自独立可运行，`npm run rag:vN` 直接体验：

| 版本 | 文件                         | 新增能力                                                                                                      | 图结构                           |
| ---- | ---------------------------- | ------------------------------------------------------------------------------------------------------------- | -------------------------------- |
| v1   | `src/naive-rag.mjs`        | 基础流水线：向量检索 → 生成                                                                                  | 线性，无决策                     |
| v2   | `src/rag-query-router.mjs` | 复杂度路由：常识题直答，小说细节题走检索                                                                      | 1 个决策点                       |
| v3   | `src/rag-multihop.mjs`     | 多跳问答：子问题拆解（1\~8 条）→ 逐轮检索 → 规划节点决定「继续检索 or 生成」，8 轮硬上限                    | 首个循环图                       |
| v4   | `src/rag-webfallback.mjs`  | 兜底问答：评估节点判断上下文充分性，不足时联网搜索（Bocha）后二次评估（**独立图，不含 v3 的拆解循环**） | 2 个决策点                       |
| v5   | `src/rag-v5-final.mjs`     | 终态整合：路由 + 拆解 + 迭代检索 + 规划 + 评估 + 联网兜底 + 混合检索                                          | 8 节点 / 3 个决策点 / 6 条条件边 |
| v6   | `src/rag-v6-typesafe.mjs`  | 判断后端实验：三个判断点改用 TypeSafe（System One 判断模型）出校准概率，生成类任务仍走主 LLM                  | 图结构与 v5 完全一致             |

注意 v3 与 v4 是**两条并行的实验分支**（拆解循环 vs 联网兜底），不是功能累加；v5 才把两条线合到一张图里。v6 是在 v5 图结构不变的前提下替换判断后端的对照实验。

## 架构图（v5 终态）

```mermaid
%%{init: {'flowchart': {'curve': 'linear'}}}%%
graph TD;
	__start__([<p>__start__</p>]):::first
	route_question(route_question)
	direct_answer(direct_answer)
	decompose_question(decompose_question)
	retrieve(retrieve)
	plan_next_step(plan_next_step)
	evaluate_local(evaluate_local)
	web_search(web_search)
	generate(generate)
	__end__([<p>__end__</p>]):::last
	__start__ --> route_question;
	decompose_question --> retrieve;
	direct_answer --> __end__;
	generate --> __end__;
	retrieve --> plan_next_step;
	web_search --> evaluate_local;
	route_question -.-> direct_answer;
	route_question -.-> decompose_question;
	plan_next_step -.-> retrieve;
	plan_next_step -.  generate  .-> evaluate_local;
	evaluate_local -.-> generate;
	evaluate_local -.-> web_search;
	classDef default fill:#f2f0ff,line-height:1.2;
	classDef first fill-opacity:0;
	classDef last fill:#bfb6fc;
```

全部 5 张图可用 `npm run graph` 重新导出到 `docs/graphs/`。

## 快速开始

环境要求：**Node.js >= 20**、Docker。

```bash
# 1. 安装依赖
npm install

# 2. 启动基础设施（etcd + MinIO + Milvus + Elasticsearch/IK，ES 为自建镜像自动 build）
npm run docker:up

# 3. 配置环境变量
cp .env.example .env
#    填写 MODEL_NAME / OPENAI_BASE_URL / OPENAI_API_KEY（任意 OpenAI 兼容端点）
#    v4/v5 需要联网兜底：申请 https://open.bochaai.com 的 BOCHA_API_KEY
#    v6 需要判断模型：申请 https://console.typesafe.ai/keys 的 TYPESAFE_API_KEY（可选，不填则 v6 行为等同 v5）

# 4. 自备语料：放一本 epub 到 data/ 目录（默认天龙八部，可通过 CORPUS_PATH 换）
#    注意：epub 不入库 git（.gitignore 已排除 *.epub），请使用自备文件

# 5. 入库（向量 + 关键词双写，可重复执行，upsert 幂等）
npm run ingest

# 6. 逐版体验
npm run rag:v1   # 验证：阿朱的结局是什么
npm run rag:v2   # 验证：1+1 等于几（应直答，不走检索）
npm run rag:v3   # 验证：四大恶人分别是谁（应拆解多轮检索）
npm run rag:v4   # 验证：雁门关事件 + 2013 版电视剧集数（本地不够，联网兜底）
npm run rag:v5   # 全链路：路由 + 拆解 + 混合检索 + 评估 + 联网
npm run rag:v6   # 判断后端实验：路由/规划/评估交给 TypeSafe（需 TYPESAFE_API_KEY，否则自动回退 v5 行为）

# 7. 启动 SSE 服务
npm run server
```

## License & 致谢

[MIT](LICENSE)。
