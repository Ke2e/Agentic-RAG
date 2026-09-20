import { CONFIG } from "./config.mjs";

export async function bochaWebSearch(query, count) {
  const apiKey = CONFIG.BOCHA_API_KEY;
  if (!apiKey) {
    throw new Error("Bocha Web Search 的 API KEY 未配置（环境变量 BOCHA_API_KEY）。");
  }
  const url = "https://api.bochaai.com/v1/web-search";
  const body = {
    query,
    freshness: "noLimit",
    summary: true,
    count: count ?? 10,
  };

  let response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
  } catch (error) {
    throw new Error(`搜索API 请求失败(网络错误): ${error.message}`);
  }

  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    throw new Error(`搜索API 请求失败，状态码:${response.status}，错误信息：${errorText}`);
  }

  let json;
  try {
    json = await response.json();
  } catch (err) {
    throw new Error(`搜索结果解析失败：${err.message}`);
  }

  const webpages = json.data.webPages?.value ?? [];
  // 原课程此处写反（if (webpages.length) 返回“未找到”），已修复
  if (!webpages.length) {
    return "未找到相关结果。";
  }

  return webpages
    .map(
      (page, idx) => `引用: ${idx + 1}
      标题：${page.name}
      URL: ${page.url}
      摘要：${page.summary}
      网站名称：${page.siteName}
      发布时间：${page.dateLastCrawled}`
    )
    .join("\n\n");
}
