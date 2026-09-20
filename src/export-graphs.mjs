import { writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { graph as v1 } from "./naive-rag.mjs";
import { graph as v2 } from "./rag-query-router.mjs";
import { graph as v3 } from "./rag-multihop.mjs";
import { graph as v4 } from "./rag-webfallback.mjs";
import { graph as v5 } from "./rag-v5-final.mjs";

const targets = [
  ["v1-naive", v1],
  ["v2-router", v2],
  ["v3-multihop", v3],
  ["v4-webfallback", v4],
  ["v5-final", v5],
];

const outDir = join(fileURLToPath(new URL("../docs/graphs/", import.meta.url)));
await mkdir(outDir, { recursive: true });

for (const [name, graph] of targets) {
  // 架构图不是手画的：从运行图结构导出，保证图与代码一致
  const drawable = await graph.getGraphAsync();
  const mermaid = drawable.drawMermaid({ withStyles: true });
  const file = join(outDir, `${name}.md`);
  await writeFile(file, `# ${name}\n\n\`\`\`mermaid\n${mermaid}\n\`\`\`\n`);
  console.log(`✓ 已导出 ${file}`);
}
