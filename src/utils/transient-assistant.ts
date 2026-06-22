const TRANSIENT_ASSISTANT_PATTERNS = [
  /^(?:正在)?(?:思考|推理|分析|搜索|浏览|读取|生成)(?:中)?[\s.。…]*$/,
  /^(?:已)?(?:思考|推理|分析|搜索|浏览|读取|生成)(?:了|用时)?\s*(?:约\s*)?(?:几|\d+(?:\.\d+)?)\s*(?:秒|分钟)[\s.。…]*$/,
  /^(?:thinking|reasoning|analyzing|working|searching|browsing|reading|generating)(?:\s+(?:for\s+)?(?:a\s+few|\d+(?:\.\d+)?)\s*(?:s|sec|secs|seconds?|m|min|mins|minutes?))?[\s.。…]*$/i,
  /^(?:reasoned|thought|searched|browsed|read)\s+for\s+(?:a\s+few|\d+(?:\.\d+)?)\s*(?:s|sec|secs|seconds?|m|min|mins|minutes?)[\s.。…]*$/i,
];

function normalizeTransientText(content: unknown): string {
  return typeof content === "string"
    ? content.replace(/[\u200B-\u200D\uFEFF]/g, "").replace(/\s+/g, " ").trim()
    : "";
}

export function isTransientAssistantContent(content: unknown): boolean {
  const text = normalizeTransientText(content);
  if (!text || text.length > 96) return false;
  return TRANSIENT_ASSISTANT_PATTERNS.some((pattern) => pattern.test(text));
}

export function isTransientAssistantMessage(role: unknown, content: unknown): boolean {
  return role === "assistant" && isTransientAssistantContent(content);
}
