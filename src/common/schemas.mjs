import { z } from "zod";

// 路由：把输出空间压缩成两个合法值，条件边才能用 === 消费
export const RouteSchema = z.object({
  strategy: z.enum(["simple", "complex"]),
  reason: z.string(),
});

// 拆解：1~8 条有序子问题
export const DecomposeSchema = z.object({
  sub_questions: z.array(z.string()).min(1).max(8),
  reason: z.string(),
});

// 规划：继续检索还是生成
export const NextStepSchema = z.object({
  nextAction: z.enum(["retrieve", "generate"]),
  reason: z.string(),
});

// 评估：证据充分性 + 可选联网查询词
export const EvaluateSchema = z.object({
  enough: z.boolean(),
  missing: z.array(z.string()).max(6),
  reason: z.string(),
  web_query: z.string().optional(),
});
