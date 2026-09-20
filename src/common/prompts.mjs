// 所有 prompt 与课程原版措辞保持一致，便于逐版本对照学习。

export const ROUTE_PROMPT = (question) => `
  你是问答路由器，请判断用户问题是否需要外部检索。

  规则：
  - simple: 常识问答、简短定义、无需特定小说细节即可回答。
  - complex: 需要《天龙八部》具体情节、任务关系、章节事实、原文细节或证据支持。

  用户问题： ${question}
  `;

export const DIRECT_PROMPT = (question) => `
  你是一个中文回答助手,
  请直简洁回答问题。
  问题：${question}
  `;

export const DECOMPOSE_PROMPT = (question) => `
    你是《天龙八部》多跳问答的【子问题拆解器】。
    用户原始问题：
    ${question}

    任务：将问题拆成**有序**子问题列表 sub_questions, 用于**依次向量检索**。要求：
    1. 链式推理、多层关系、应果先后的问题，必须拆成多条；单跳即可答的也可只输出1条。
    2. 每条子问题必须是**可独立检索**的完整中文问句，**禁止**使用「他/她/此人/上文」等指代；可写全人物名与事件名。
    3. 顺序必须符合推理链：先搞清前置实体/事实，再查后续结论。
    4. **不要**把整句原题原样复制成唯一一条（除非确实无法拆分）；不要拆成过碎的关键词列表。
    5. 输出 1～8 条即可。

    请输出 sub_questions 与简短 reason。
  `;

export const PLAN_PROMPT = ({ question, subList, retrievalCount, remaining, maxRetrievals, docStr }) => `
  你是多跳 RAG 规划器。检索查询已由前置步骤拆解为**有序子问题**,
  若需要继续检索， 下一轮将自动使用 [下一条子问题] 做向量检索， 你**不要**
  自拟新的检索句。
  用户原始问题： ${question}
  子问题序列：
  ${subList || "无"}

  已检索轮次：${retrievalCount}; 剩余未检索子问题条数：${remaining}
  最大检索轮数上限：${maxRetrievals}

  已召回文档摘要:
  ${docStr}

  请判断下一步：
  1） 已有足够依据回答用户原始问题 -> nextAction=generate
  2) 仍缺关键事实、且仍存在未检索的子问题、且未超过轮数上限 -> nextAction=retrieve
  硬性规则：
  - 若剩余未检索子问题条数为0, 必须 nextAction=generate。
  - 若已检索轮数已到达或超过最大检索轮数， 必须 nextAction=generate。
  `;

export const EVALUATE_PROMPT = ({ question, localContext, hasWeb, webContext }) => `
    你是信息充分性评估器。判断当前上下文是否足以回答用户问题。
    用户问题： ${question}
    已检索上下文(来自本地知识库) :
    ${localContext || "  (空) "}
    ${hasWeb ? `联网搜索结果:\n ${webContext || "  (空) "}` : ""}

    输出字段：
    - enough: 是否足够回答(true/false)
    - missing: 若不够，列出缺失信息点（最多6条）
    - reason: 简短原因
    ${hasWeb ? "" : "- web_query: 若不够， 给出一个适合互联网搜索的中文查询句（完整句， 为空也可）"}
  `;

// v1/v3 的小说问答生成 prompt
export const GEN_NOVEL_PROMPT = ({ context, question }) => `
  你是一个专业的《天龙八部》小说助手。基于小说内容回答问题，用准确，详细的语言。
  请根据以下《天龙八部》小说片段内容回答问题：
  ${context}
  用户问题：${question}

  回答要求：
  1. 如果片段中有相关信息，请结合小说内容给出详细、准确的回答
  2. 可以综合多个片段的内容，提供完整的答案
  3. 如果片段中没有相关信息，请如实告知用户
  4. 回答要准确，符合小说的情节和人物设定
  5. 可以引用原文内容来支持你的回答

  AI 助手的回答：
  `;

// v4/v5 的严格生成 prompt（允许联网补充，要求可核对来源）
export const GEN_STRICT_PROMPT = ({ context, question }) => `
    你是一个严谨的中文问答助手。
    优先依据上下文回答，不要编造。
    上下文（本地知识库 + 可选联网补充）:
    ${context || "(空)"}
    用户问题: ${question}

    回答要求：
    1. 如果上下文足够， 给出清晰， 可核对的回答： 需要时引用 [n] / URL 或小说片段来支撑。
    2. 如果上下文仍不足以确定关键事实，明确说明“不确定/无法从上下文确认”，并说明缺失点。
    3. 不要输出表情符号。

    回答：
  `;

export const formatDocContext = (docs, { previewLen = 200, limit = 10 } = {}) =>
  (docs ?? [])
    .slice(0, limit)
    .map(
      (item, i) =>
        `[片段 ${i + 1}]\n    章节: 第 ${item.chapter_num}章\n    内容：${item.content}`
    )
    .join("\n\n----------\n\n");
