export function inferSessionIdFromUrl(rawUrl: string): string | undefined {
  try {
    const url = new URL(rawUrl);
    const host = url.hostname;
    const path = url.pathname;

    if ((host === "chatgpt.com" || host === "chat.openai.com") && path) {
      const match = path.match(/\/c\/([^/]+)/);
      if (match?.[1]) return `openai:${match[1]}`;
    }

    if (host === "claude.ai" && path) {
      const match = path.match(/\/chat\/([^/]+)/);
      if (match?.[1]) return `anthropic:${match[1]}`;
    }

    if (host === "gemini.google.com" && path) {
      const match = path.match(/\/app\/([^/]+)/);
      if (match?.[1]) return `google:${match[1]}`;
    }

    if (host === "grok.com" && path) {
      const match = path.match(/\/(?:c|chat)\/([^/]+)/);
      if (match?.[1]) return `xai:${match[1]}`;
    }
  } catch {
    return undefined;
  }
  return undefined;
}
